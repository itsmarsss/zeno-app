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
        # User-preferred monitor density: interval = duration / 60.
        return max(1, min(int(span_seconds / 60.0), 600))
    if resolution == "coarse":
        return max(5, min(int(span_seconds / 20.0), 600))
    # medium default
    return max(2, min(int(span_seconds / 40.0), 600))


def fetch_monitor_timeline(
    db_path: Path,
    start_time: str,
    end_time: str,
    interval_seconds: int | None = None,
    resolution: str | None = None,
    fill_from_previous: bool = False,
) -> list[dict]:
    """
    Fetch sessions in time range and fill gaps with interpolated points every interval_seconds.

    Args:
        db_path: Path to SQLite database
        start_time: ISO format start time
        end_time: ISO format end time
        interval_seconds: Optional fixed seconds between interpolated points
        resolution: Optional quality hint (fine|medium|coarse)
        fill_from_previous: Start filling from range start using last pre-range sample

    Returns:
        List of data points (actual sessions + interpolated points)
    """
    if not db_path.exists():
        return []

    start_dt = parse_iso_utc(start_time)
    end_dt = parse_iso_utc(end_time)
    start_local_text = start_dt.astimezone(LOCAL_TZ).replace(tzinfo=None).isoformat(timespec="seconds")
    end_local_text = end_dt.astimezone(LOCAL_TZ).replace(tzinfo=None).isoformat(timespec="seconds")

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        ensure_sessions_schema(conn)

        # Fetch all sessions in time range
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
            return []  # No usable data in database

    # Build timeline preserving all real sessions, while adding regular fillers in gaps.
    timeline_points = []
    resolved_interval_seconds = resolve_interval_seconds(start_time, end_time, interval_seconds, resolution)

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
                timeline_points.append(
                    {
                        "id": None,
                        "created_at": current_time.isoformat(),
                        "presence_detected": last_known_values["presence_detected"],
                        "analysis_skipped": 0,
                        "posture_score": last_known_values["posture_score"],
                        "baseline_posture_score": last_known_values.get("baseline_posture_score"),
                        "posture_deviation": last_known_values.get("posture_deviation"),
                        "posture_is_poor": last_known_values.get("posture_is_poor", 0),
                        "dominant_emotion": last_known_values["dominant_emotion"],
                        "emotion_score": last_known_values["emotion_score"],
                        "heart_rate_bpm": last_known_values["heart_rate_bpm"],
                        "respiratory_rate": last_known_values["respiratory_rate"],
                        "rr_confidence": last_known_values["rr_confidence"],
                        "emotion_backend": last_known_values["emotion_backend"],
                        "mode": last_known_values["mode"],
                        "focus_duration_seconds": last_known_values["focus_duration_seconds"],
                        "focus_mode": last_known_values["focus_mode"],
                        "session_duration_seconds": 0,
                        "interpolated": True,
                        "point_type": "filled",
                    }
                )
            current_time += interval_delta

        session["created_at"] = session_time.isoformat()
        session["point_type"] = normalize_point_type(session.get("mode"))
        session["interpolated"] = False
        timeline_points.append(session)
        last_known_values = session

    while current_time <= fill_end_dt:
        if last_known_values:
            timeline_points.append(
                {
                    "id": None,
                    "created_at": current_time.isoformat(),
                    "presence_detected": last_known_values["presence_detected"],
                    "analysis_skipped": 0,
                    "posture_score": last_known_values["posture_score"],
                    "baseline_posture_score": last_known_values.get("baseline_posture_score"),
                    "posture_deviation": last_known_values.get("posture_deviation"),
                    "posture_is_poor": last_known_values.get("posture_is_poor", 0),
                    "dominant_emotion": last_known_values["dominant_emotion"],
                    "emotion_score": last_known_values["emotion_score"],
                    "heart_rate_bpm": last_known_values["heart_rate_bpm"],
                    "respiratory_rate": last_known_values["respiratory_rate"],
                    "rr_confidence": last_known_values["rr_confidence"],
                    "emotion_backend": last_known_values["emotion_backend"],
                    "mode": last_known_values["mode"],
                    "focus_duration_seconds": last_known_values["focus_duration_seconds"],
                    "focus_mode": last_known_values["focus_mode"],
                    "session_duration_seconds": 0,
                    "interpolated": True,
                    "point_type": "filled",
                }
            )
        current_time += interval_delta

    # Keep timeline shape for the full requested range but do not invent
    # future values after "now". These points are explicit no-data.
    while current_time <= end_dt:
        timeline_points.append(
            {
                "id": None,
                "created_at": current_time.isoformat(),
                "presence_detected": None,
                "analysis_skipped": 1,
                "posture_score": None,
                "baseline_posture_score": None,
                "posture_deviation": None,
                "posture_is_poor": None,
                "dominant_emotion": None,
                "emotion_score": None,
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
            }
        )
        current_time += interval_delta

    timeline_points.sort(key=lambda point: parse_iso_utc(point["created_at"]))
    return timeline_points


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
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    points = fetch_monitor_timeline(
        db_path=db_path,
        start_time=args.start_time,
        end_time=args.end_time,
        interval_seconds=args.interval_seconds,
        resolution=args.resolution,
        fill_from_previous=args.fill_from_previous,
    )
    print(json.dumps({"points": points}))


if __name__ == "__main__":
    main()
