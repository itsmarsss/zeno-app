from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"
LOCAL_TZ = datetime.now().astimezone().tzinfo or timezone.utc


def parse_iso_utc(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=LOCAL_TZ).astimezone(timezone.utc)
    return parsed.astimezone(timezone.utc)


def normalize_point_type(mode: str | None) -> str:
    if mode == "focus":
        return "focus"
    if mode == "passive":
        return "passive"
    return "unknown"


def resolve_interval_seconds(
    start_time: str,
    end_time: str,
    interval_seconds: int | None,
    resolution: str | None,
) -> int:
    if interval_seconds is not None:
        return max(1, min(interval_seconds, 600))

    if not resolution:
        return 5

    start_dt = parse_iso_utc(start_time)
    end_dt = parse_iso_utc(end_time)
    span_seconds = max(1.0, (end_dt - start_dt).total_seconds())

    if resolution == "fine":
        return max(1, min(int(span_seconds / 60.0), 600))
    if resolution == "coarse":
        return max(5, min(int(span_seconds / 20.0), 600))
    return max(2, min(int(span_seconds / 40.0), 600))


def _confidence_rank(value: str | None) -> int:
    if value == "full":
        return 3
    if value == "partial":
        return 2
    return 1


def _best_confidence(values: list[str | None]) -> str:
    if not values:
        return "none"
    best = max(values, key=_confidence_rank)
    return best if best in {"none", "partial", "full"} else "none"


def _avg_or_none(values: list[float | int | None]) -> float | None:
    valid = [float(v) for v in values if isinstance(v, (int, float))]
    if not valid:
        return None
    return sum(valid) / len(valid)


def _unknown_point(created_at: datetime) -> dict:
    return {
        "id": None,
        "created_at": created_at.isoformat(),
        "presence_detected": None,
        "analysis_skipped": 1,
        "posture_score": None,
        "baseline_posture_score": None,
        "posture_deviation": None,
        "posture_is_poor": None,
        "dominant_emotion": None,
        "emotion_score": None,
        "stress_index": None,
        "heart_rate_bpm": None,
        "respiratory_rate": None,
        "rr_confidence": "none",
        "emotion_backend": None,
        "mode": None,
        "focus_duration_seconds": None,
        "focus_mode": None,
        "session_duration_seconds": 0,
        "interpolated": True,
        "point_type": "unknown",
        "focus_active": False,
        "passive_marker_active": False,
    }


def _filled_point(created_at: datetime, last_known: dict) -> dict:
    return {
        "id": None,
        "created_at": created_at.isoformat(),
        "presence_detected": last_known.get("presence_detected"),
        "analysis_skipped": 0,
        "posture_score": last_known.get("posture_score"),
        "baseline_posture_score": last_known.get("baseline_posture_score"),
        "posture_deviation": last_known.get("posture_deviation"),
        "posture_is_poor": last_known.get("posture_is_poor", 0),
        "dominant_emotion": last_known.get("dominant_emotion"),
        "emotion_score": last_known.get("emotion_score"),
        "stress_index": last_known.get("stress_index"),
        "heart_rate_bpm": last_known.get("heart_rate_bpm"),
        "respiratory_rate": last_known.get("respiratory_rate"),
        "rr_confidence": last_known.get("rr_confidence") or "none",
        "emotion_backend": last_known.get("emotion_backend"),
        "mode": last_known.get("mode"),
        "focus_duration_seconds": last_known.get("focus_duration_seconds"),
        "focus_mode": last_known.get("focus_mode"),
        "session_duration_seconds": 0,
        "interpolated": True,
        "point_type": "filled",
        "focus_active": (last_known.get("mode") or "") == "focus",
        "passive_marker_active": False,
    }


def _bucket_timeline(
    sessions: list[dict],
    start_dt: datetime,
    end_dt: datetime,
    bucket_seconds: int,
    fill_from_previous: bool,
    previous_session: dict | None,
    aggregate_mode: str,
) -> list[dict]:
    now_utc = datetime.now(timezone.utc)
    fill_end_dt = min(end_dt, now_utc)
    delta = timedelta(seconds=max(1, bucket_seconds))

    prepared = []
    for item in sessions:
        session_time = parse_iso_utc(item["created_at"])
        if session_time < start_dt or session_time > fill_end_dt:
            continue
        entry = dict(item)
        entry["created_at"] = session_time.isoformat()
        entry["point_type"] = normalize_point_type(entry.get("mode"))
        entry["_at"] = session_time
        prepared.append(entry)
    prepared.sort(key=lambda row: row["_at"])

    points: list[dict] = []
    last_known = dict(previous_session) if (fill_from_previous and previous_session is not None) else None
    idx = 0
    total = len(prepared)
    cursor = start_dt

    while cursor <= end_dt:
        bucket_end = min(end_dt + timedelta(microseconds=1), cursor + delta)
        if cursor > fill_end_dt:
            points.append(_unknown_point(cursor))
            cursor += delta
            continue

        bucket_rows: list[dict] = []
        while idx < total:
            row = prepared[idx]
            at = row["_at"]
            if at < cursor:
                idx += 1
                continue
            if at >= bucket_end:
                break
            bucket_rows.append(row)
            idx += 1

        if bucket_rows:
            latest = bucket_rows[-1]
            has_focus = any((row.get("mode") or "") == "focus" or row.get("point_type") == "focus" for row in bucket_rows)
            has_passive = any(row.get("point_type") == "passive" and (row.get("mode") or "passive") != "focus" for row in bucket_rows)
            bucket_type = "focus" if has_focus else ("passive" if has_passive else "unknown")

            if aggregate_mode == "mean":
                point = {
                    "id": None,
                    "created_at": cursor.isoformat(),
                    "presence_detected": latest.get("presence_detected"),
                    "analysis_skipped": 0,
                    "posture_score": _avg_or_none([row.get("posture_score") for row in bucket_rows]),
                    "baseline_posture_score": latest.get("baseline_posture_score"),
                    "posture_deviation": latest.get("posture_deviation"),
                    "posture_is_poor": latest.get("posture_is_poor", 0),
                    "dominant_emotion": latest.get("dominant_emotion"),
                    "emotion_score": _avg_or_none([row.get("emotion_score") for row in bucket_rows]),
                    "stress_index": _avg_or_none([row.get("stress_index") for row in bucket_rows]),
                    "heart_rate_bpm": _avg_or_none(
                        [row.get("heart_rate_bpm") for row in bucket_rows if (row.get("heart_rate_bpm") or 0) > 0]
                    ),
                    "respiratory_rate": _avg_or_none(
                        [row.get("respiratory_rate") for row in bucket_rows if (row.get("respiratory_rate") or 0) > 0]
                    ),
                    "rr_confidence": _best_confidence([row.get("rr_confidence") for row in bucket_rows]),
                    "emotion_backend": latest.get("emotion_backend"),
                    "mode": "focus" if has_focus else "passive",
                    "focus_duration_seconds": latest.get("focus_duration_seconds"),
                    "focus_mode": 1 if has_focus else 0,
                    "session_duration_seconds": latest.get("session_duration_seconds", 0),
                    "interpolated": False,
                    "point_type": bucket_type,
                    "focus_active": has_focus,
                    "passive_marker_active": has_passive,
                }
            else:
                point = {
                    "id": latest.get("id"),
                    "created_at": cursor.isoformat(),
                    "presence_detected": latest.get("presence_detected"),
                    "analysis_skipped": latest.get("analysis_skipped", 0),
                    "posture_score": latest.get("posture_score"),
                    "baseline_posture_score": latest.get("baseline_posture_score"),
                    "posture_deviation": latest.get("posture_deviation"),
                    "posture_is_poor": latest.get("posture_is_poor", 0),
                    "dominant_emotion": latest.get("dominant_emotion"),
                    "emotion_score": latest.get("emotion_score"),
                    "stress_index": latest.get("stress_index"),
                    "heart_rate_bpm": latest.get("heart_rate_bpm"),
                    "respiratory_rate": latest.get("respiratory_rate"),
                    "rr_confidence": latest.get("rr_confidence") or "none",
                    "emotion_backend": latest.get("emotion_backend"),
                    "mode": latest.get("mode"),
                    "focus_duration_seconds": latest.get("focus_duration_seconds"),
                    "focus_mode": latest.get("focus_mode"),
                    "session_duration_seconds": latest.get("session_duration_seconds", 0),
                    "interpolated": False,
                    "point_type": bucket_type,
                    "focus_active": has_focus,
                    "passive_marker_active": has_passive,
                }
            points.append(point)
            last_known = latest
            cursor += delta
            continue

        points.append(_filled_point(cursor, last_known) if last_known is not None else _unknown_point(cursor))
        cursor += delta

    return points


def _dense_timeline(
    sessions: list[dict],
    start_dt: datetime,
    end_dt: datetime,
    start_time: str,
    interval_seconds: int | None,
    resolution: str | None,
    previous_session: dict | None,
) -> list[dict]:
    timeline_points = []
    resolved_interval_seconds = resolve_interval_seconds(start_time, end_dt.isoformat(), interval_seconds, resolution)
    current_time = start_dt
    last_known_values = previous_session
    now_utc = datetime.now(timezone.utc)
    fill_end_dt = min(end_dt, now_utc)
    interval_delta = timedelta(seconds=resolved_interval_seconds)

    for session in sessions:
        session_time = parse_iso_utc(session["created_at"])
        if session_time < start_dt or session_time > fill_end_dt:
            continue
        while current_time <= fill_end_dt and current_time < session_time:
            if last_known_values:
                timeline_points.append(_filled_point(current_time, last_known_values))
            current_time += interval_delta
        session["created_at"] = session_time.isoformat()
        session["point_type"] = normalize_point_type(session.get("mode"))
        session["interpolated"] = False
        session["focus_active"] = session["point_type"] == "focus"
        session["passive_marker_active"] = session["point_type"] == "passive"
        timeline_points.append(session)
        last_known_values = session

    while current_time <= fill_end_dt:
        if last_known_values:
            timeline_points.append(_filled_point(current_time, last_known_values))
        current_time += interval_delta

    while current_time <= end_dt:
        timeline_points.append(_unknown_point(current_time))
        current_time += interval_delta

    timeline_points.sort(key=lambda point: parse_iso_utc(point["created_at"]))
    return timeline_points


def fetch_monitor_timeline(
    db_path: Path,
    start_time: str,
    end_time: str,
    interval_seconds: int | None = None,
    resolution: str | None = None,
    fill_from_previous: bool = False,
    bucket_seconds: int | None = None,
    aggregate_mode: str = "latest",
) -> list[dict]:
    if not db_path.exists():
        return []

    start_dt = parse_iso_utc(start_time)
    end_dt = parse_iso_utc(end_time)
    start_local_text = start_dt.astimezone(LOCAL_TZ).replace(tzinfo=None).isoformat(timespec="seconds")
    end_local_text = end_dt.astimezone(LOCAL_TZ).replace(tzinfo=None).isoformat(timespec="seconds")

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        ensure_sessions_schema(conn)

        rows = conn.execute(
            """
            SELECT
                id,
                created_at,
                presence_detected,
                analysis_skipped,
                posture_score,
                baseline_posture_score,
                posture_deviation,
                posture_is_poor,
                dominant_emotion,
                emotion_score,
                stress_index,
                heart_rate_bpm,
                respiratory_rate,
                rr_confidence,
                emotion_backend,
                mode,
                focus_duration_seconds,
                focus_mode,
                session_duration_seconds
            FROM sessions
            WHERE created_at BETWEEN ? AND ?
            ORDER BY created_at ASC
            """,
            (start_local_text, end_local_text),
        ).fetchall()
        sessions = [dict(row) for row in rows]

        previous_session = None
        if fill_from_previous:
            previous_row = conn.execute(
                """
                SELECT
                    id,
                    created_at,
                    presence_detected,
                    analysis_skipped,
                    posture_score,
                    baseline_posture_score,
                    posture_deviation,
                    posture_is_poor,
                    dominant_emotion,
                    emotion_score,
                    stress_index,
                    heart_rate_bpm,
                    respiratory_rate,
                    rr_confidence,
                    emotion_backend,
                    mode,
                    focus_duration_seconds,
                    focus_mode,
                    session_duration_seconds
                FROM sessions
                WHERE created_at < ?
                ORDER BY created_at DESC
                LIMIT 1
                """,
                (start_local_text,),
            ).fetchone()
            if previous_row is not None:
                previous_session = dict(previous_row)

        if not sessions and previous_session is None:
            return []

    if bucket_seconds is not None:
        return _bucket_timeline(
            sessions=sessions,
            start_dt=start_dt,
            end_dt=end_dt,
            bucket_seconds=max(1, bucket_seconds),
            fill_from_previous=fill_from_previous,
            previous_session=previous_session,
            aggregate_mode="mean" if aggregate_mode == "mean" else "latest",
        )

    return _dense_timeline(
        sessions=sessions,
        start_dt=start_dt,
        end_dt=end_dt,
        start_time=start_time,
        interval_seconds=interval_seconds,
        resolution=resolution,
        previous_session=previous_session,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch monitor timeline with gap filling.")
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB_PATH),
        help="SQLite database path (default: backend/data/zeno_sessions.db).",
    )
    parser.add_argument(
        "--start-time",
        required=True,
        help="ISO format start time (e.g., 2024-01-01T00:00:00Z)",
    )
    parser.add_argument(
        "--end-time",
        required=True,
        help="ISO format end time (e.g., 2024-01-01T23:59:59Z)",
    )
    parser.add_argument(
        "--interval-seconds",
        type=int,
        default=None,
        help="Fixed seconds between interpolated points.",
    )
    parser.add_argument(
        "--resolution",
        choices=["fine", "medium", "coarse"],
        default=None,
        help="Resolution hint; backend computes interval from range.",
    )
    parser.add_argument(
        "--fill-from-previous",
        action="store_true",
        help="Fill initial gap from latest sample before start-time.",
    )
    parser.add_argument(
        "--bucket-seconds",
        type=int,
        default=None,
        help="If set, returns one aggregated point per bucket interval.",
    )
    parser.add_argument(
        "--aggregate-mode",
        choices=["latest", "mean"],
        default="latest",
        help="Bucket aggregation mode.",
    )
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    points = fetch_monitor_timeline(
        db_path=db_path,
        start_time=args.start_time,
        end_time=args.end_time,
        interval_seconds=args.interval_seconds,
        resolution=args.resolution,
        fill_from_previous=args.fill_from_previous,
        bucket_seconds=args.bucket_seconds,
        aggregate_mode=args.aggregate_mode,
    )
    print(json.dumps({"points": points}))


if __name__ == "__main__":
    main()
