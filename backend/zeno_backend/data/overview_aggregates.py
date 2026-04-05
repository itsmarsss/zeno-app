from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path

from zeno_backend.data.daily_aggregates import fetch_daily_aggregate, recompute_daily_aggregate
from zeno_backend.data.db_schema import ensure_sessions_schema
from zeno_backend.data.db_utils import connect_db, safe_float, safe_int, valid_heart_rate

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


def _base_series_payload() -> dict[str, list[int]]:
    return {
        "peak_stress": [0, 0, 0, 0, 0, 0, 0],
        "avg_focus_session": [0, 0, 0, 0, 0, 0, 0],
        "posture_avg": [0, 0, 0, 0, 0, 0, 0],
        "break_minutes": [0, 0, 0, 0, 0, 0, 0],
    }


def _ensure_day(conn: sqlite3.Connection, day_key: str) -> dict:
    cached = fetch_daily_aggregate(conn, day_key)
    if cached is not None:
        return cached
    return recompute_daily_aggregate(conn, day_key)


def _baseline_hr_delta(conn: sqlite3.Connection, day_key: str, current_avg_hr: float | None) -> int | None:
    if current_avg_hr is None or current_avg_hr <= 0:
        return None
    rows = conn.execute(
        """
        SELECT heart_rate_bpm
        FROM sessions
        WHERE substr(created_at, 1, 10) <> ?
          AND presence_detected = 1
          AND analysis_skipped = 0
          AND heart_rate_bpm IS NOT NULL
        ORDER BY created_at DESC
        LIMIT 240
        """,
        (day_key,),
    ).fetchall()
    values = [hr for hr in (valid_heart_rate(row[0]) for row in rows) if hr is not None]
    if not values:
        return None
    baseline = sum(values) / len(values)
    return int(round(float(current_avg_hr) - baseline))


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

    target_key = target_day.isoformat()
    previous_key = (target_day - timedelta(days=1)).isoformat()

    with connect_db(db_path) as conn:
        ensure_sessions_schema(conn)

        today = _ensure_day(conn, target_key)
        previous = _ensure_day(conn, previous_key)

        peak_stress: list[int] = []
        avg_focus_session: list[int] = []
        posture_avg: list[int] = []
        break_minutes: list[int] = []
        for offset in range(6, -1, -1):
            day_key = (target_day - timedelta(days=offset)).isoformat()
            day_row = _ensure_day(conn, day_key)
            peak_stress.append(safe_int(day_row.get("peak_stress_index"), 0) or 0)
            avg_focus_session.append(safe_int(day_row.get("avg_focus_session_minutes"), 0) or 0)
            posture_avg.append(
                int(round((safe_float(day_row.get("average_posture_score"), 0.0) or 0.0) * 100))
            )
            break_minutes.append(safe_int(day_row.get("break_minutes"), 0) or 0)

        average_heart_rate = safe_float(today.get("average_heart_rate"), None)
        hr_delta_baseline = _baseline_hr_delta(conn, target_key, average_heart_rate)
        conn.commit()

    avg_stress_today = int(round(safe_float(today.get("average_stress_index"), 0.0) or 0.0))
    avg_stress_previous = int(round(safe_float(previous.get("average_stress_index"), 0.0) or 0.0))
    return {
        "date": target_key,
        "sessions": safe_int(today.get("sessions_count"), 0) or 0,
        "average_stress_index": avg_stress_today,
        "previous_average_stress_index": avg_stress_previous,
        "stress_delta_vs_yesterday": avg_stress_today - avg_stress_previous,
        "focused_minutes": safe_int(today.get("focused_minutes"), 0) or 0,
        "break_count": safe_int(today.get("break_count"), 0) or 0,
        "average_heart_rate": int(round(average_heart_rate or 0.0)),
        "average_respiratory_rate": (
            round(safe_float(today.get("average_respiratory_rate"), 0.0) or 0.0, 1)
            if today.get("average_respiratory_rate") is not None
            else None
        ),
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
