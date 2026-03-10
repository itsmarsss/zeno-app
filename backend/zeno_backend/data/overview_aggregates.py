from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import date, datetime, timedelta
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


def _mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def _to_day_bounds(target_day: date) -> tuple[str, str]:
    start = datetime.combine(target_day, datetime.min.time()).isoformat(timespec="seconds")
    end = datetime.combine(target_day, datetime.max.time()).isoformat(timespec="seconds")
    return start, end


def _base_series_payload() -> dict[str, list[int]]:
    return {
        "peak_stress": [0, 0, 0, 0, 0, 0, 0],
        "avg_focus_session": [0, 0, 0, 0, 0, 0, 0],
        "posture_avg": [0, 0, 0, 0, 0, 0, 0],
        "break_minutes": [0, 0, 0, 0, 0, 0, 0],
    }


def compute_overview_aggregates(db_path: Path, target_day: date) -> dict:
    default_payload = {
        "date": target_day.isoformat(),
        "sessions": 0,
        "average_stress_index": 0,
        "previous_average_stress_index": 0,
        "stress_delta_vs_yesterday": 0,
        "focused_minutes": 0,
        "break_count": 0,
        "average_heart_rate": 0,
        "average_respiratory_rate": None,
        "hr_delta_baseline": None,
        "secondary_metric_series": _base_series_payload(),
    }
    if not db_path.exists():
        return default_payload

    today_start, today_end = _to_day_bounds(target_day)
    yesterday = target_day - timedelta(days=1)
    yesterday_start, yesterday_end = _to_day_bounds(yesterday)
    seven_day_start, _ = _to_day_bounds(target_day - timedelta(days=6))

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        ensure_sessions_schema(conn)

        today_rows = conn.execute(
            """
            SELECT
                created_at,
                stress_index,
                focus_mode,
                mode,
                session_duration_seconds,
                heart_rate_bpm,
                respiratory_rate,
                rr_confidence
            FROM sessions
            WHERE created_at BETWEEN ? AND ?
              AND presence_detected = 1
              AND analysis_skipped = 0
            ORDER BY created_at ASC
            """,
            (today_start, today_end),
        ).fetchall()

        yesterday_rows = conn.execute(
            """
            SELECT stress_index
            FROM sessions
            WHERE created_at BETWEEN ? AND ?
              AND presence_detected = 1
              AND analysis_skipped = 0
            """,
            (yesterday_start, yesterday_end),
        ).fetchall()

        baseline_rows = conn.execute(
            """
            SELECT heart_rate_bpm
            FROM sessions
            WHERE created_at NOT BETWEEN ? AND ?
              AND presence_detected = 1
              AND analysis_skipped = 0
              AND heart_rate_bpm IS NOT NULL
              AND heart_rate_bpm > 0
            """,
            (today_start, today_end),
        ).fetchall()

        seven_day_rows = conn.execute(
            """
            SELECT created_at, stress_index, focus_mode, posture_score, session_duration_seconds
            FROM sessions
            WHERE created_at BETWEEN ? AND ?
              AND presence_detected = 1
              AND analysis_skipped = 0
            ORDER BY created_at ASC
            """,
            (seven_day_start, today_end),
        ).fetchall()

    today_stress = [int(row["stress_index"] or 0) for row in today_rows]
    yesterday_stress = [int(row["stress_index"] or 0) for row in yesterday_rows]
    avg_stress_today = round(_mean([float(value) for value in today_stress]))
    avg_stress_yesterday = round(_mean([float(value) for value in yesterday_stress]))

    focused_seconds = sum(
        float(row["session_duration_seconds"] or 0.0)
        for row in today_rows
        if int(row["focus_mode"] or 0) == 1
    )
    break_count = sum(1 for row in today_rows if int(row["focus_mode"] or 0) == 0)

    today_hr_values = [
        float(row["heart_rate_bpm"])
        for row in today_rows
        if row["heart_rate_bpm"] is not None and float(row["heart_rate_bpm"]) > 0
    ]
    avg_hr_today = round(_mean(today_hr_values))

    today_rr_values = [
        float(row["respiratory_rate"])
        for row in today_rows
        if float(row["respiratory_rate"] or 0.0) > 0
        and str(row["rr_confidence"] or "none") != "none"
        and (int(row["focus_mode"] or 0) == 1 or str(row["mode"] or "passive") == "focus")
    ]
    avg_rr_today = round(_mean(today_rr_values), 1) if today_rr_values else None

    baseline_hr_values = [float(row["heart_rate_bpm"]) for row in baseline_rows]
    baseline_hr_avg = round(_mean(baseline_hr_values)) if baseline_hr_values else None
    hr_delta_baseline = (
        int(avg_hr_today - baseline_hr_avg)
        if baseline_hr_avg is not None and avg_hr_today > 0
        else None
    )

    day_buckets: dict[str, list[sqlite3.Row]] = {}
    for offset in range(6, -1, -1):
        bucket_day = target_day - timedelta(days=offset)
        day_buckets[bucket_day.isoformat()] = []

    for row in seven_day_rows:
        key = str(row["created_at"]).split("T")[0]
        if key in day_buckets:
            day_buckets[key].append(row)

    peak_stress: list[int] = []
    avg_focus_session: list[int] = []
    posture_avg: list[int] = []
    break_minutes: list[int] = []

    for rows in day_buckets.values():
        if not rows:
            peak_stress.append(0)
            avg_focus_session.append(0)
            posture_avg.append(0)
            break_minutes.append(0)
            continue

        day_stress_values = [int(row["stress_index"] or 0) for row in rows]
        day_focus_rows = [row for row in rows if int(row["focus_mode"] or 0) == 1]
        day_passive_rows = [row for row in rows if int(row["focus_mode"] or 0) == 0]
        focus_minutes_list = [float(row["session_duration_seconds"] or 0.0) / 60.0 for row in day_focus_rows]
        posture_scores = [float(row["posture_score"] or 0.0) * 100.0 for row in rows]
        passive_minutes = sum(float(row["session_duration_seconds"] or 0.0) for row in day_passive_rows) / 60.0

        peak_stress.append(max(day_stress_values) if day_stress_values else 0)
        avg_focus_session.append(round(_mean(focus_minutes_list)) if focus_minutes_list else 0)
        posture_avg.append(round(_mean(posture_scores)) if posture_scores else 0)
        break_minutes.append(round(passive_minutes))

    return {
        "date": target_day.isoformat(),
        "sessions": len(today_rows),
        "average_stress_index": int(avg_stress_today),
        "previous_average_stress_index": int(avg_stress_yesterday),
        "stress_delta_vs_yesterday": int(avg_stress_today - avg_stress_yesterday),
        "focused_minutes": int(round(focused_seconds / 60.0)),
        "break_count": int(break_count),
        "average_heart_rate": int(avg_hr_today),
        "average_respiratory_rate": avg_rr_today,
        "hr_delta_baseline": hr_delta_baseline,
        "secondary_metric_series": {
            "peak_stress": peak_stress,
            "avg_focus_session": avg_focus_session,
            "posture_avg": posture_avg,
            "break_minutes": break_minutes,
        },
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Compute overview aggregates from SQLite.")
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB_PATH),
        help="SQLite database path (default: backend/data/zeno_sessions.db).",
    )
    parser.add_argument(
        "--date",
        default=date.today().isoformat(),
        help="Target date in YYYY-MM-DD (default: today).",
    )
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    target_day = date.fromisoformat(args.date)
    payload = compute_overview_aggregates(db_path=db_path, target_day=target_day)
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
