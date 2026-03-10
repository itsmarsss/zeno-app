from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema
from zeno_backend.data.posture_daily_insights import (
    fetch_posture_daily_insight,
    recompute_posture_daily_insight,
)

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"

def _percent(numerator: int, denominator: int) -> int:
    if denominator <= 0:
        return 0
    return round((numerator / denominator) * 100)


def _recommended_ids(top_issue: str) -> list[str]:
    if top_issue == "chin-forward":
        return ["chin-tuck", "scap-squeeze"]
    if top_issue == "rounded-shoulders":
        return ["wall-angels", "doorway-pec-stretch"]
    return ["seated-side-bend", "thoracic-extension"]


def compute_posture_insights(db_path: Path, days: int) -> dict:
    if not db_path.exists():
        return {
            "days": days,
            "total_sessions": 0,
            "issue_rows": [
                {"key": "chin-forward", "label": "Chin forward", "pct": 0},
                {"key": "rounded-shoulders", "label": "Rounded shoulders", "pct": 0},
                {"key": "head-tilt-right", "label": "Head tilt right", "pct": 0},
            ],
            "top_issue": "chin-forward",
            "recommended_ids": ["chin-tuck", "scap-squeeze"],
        }

    now = datetime.now()
    start_day = (now - timedelta(days=max(1, days) - 1)).date()
    end_day = now.date()
    day_keys = []
    cursor = start_day
    while cursor <= end_day:
        day_keys.append(cursor.isoformat())
        cursor = cursor + timedelta(days=1)

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        ensure_sessions_schema(conn)
        rows = []
        for day_key in day_keys:
            entry = fetch_posture_daily_insight(conn, day_key)
            if entry is None:
                entry = recompute_posture_daily_insight(conn, day_key)
            rows.append(entry)
        conn.commit()

    total = sum(int(row.get("sessions_count") or 0) for row in rows)
    if total == 0:
        return {
            "days": days,
            "total_sessions": 0,
            "issue_rows": [
                {"key": "chin-forward", "label": "Chin forward", "pct": 0},
                {"key": "rounded-shoulders", "label": "Rounded shoulders", "pct": 0},
                {"key": "head-tilt-right", "label": "Head tilt right", "pct": 0},
            ],
            "top_issue": "chin-forward",
            "recommended_ids": ["chin-tuck", "scap-squeeze"],
        }

    chin_forward_count = sum(int(row.get("chin_forward_count") or 0) for row in rows)
    rounded_count = sum(int(row.get("rounded_shoulders_count") or 0) for row in rows)
    tilt_right_count = sum(int(row.get("head_tilt_right_count") or 0) for row in rows)

    issue_rows = [
        {"key": "chin-forward", "label": "Chin forward", "pct": _percent(chin_forward_count, total)},
        {"key": "rounded-shoulders", "label": "Rounded shoulders", "pct": _percent(rounded_count, total)},
        {"key": "head-tilt-right", "label": "Head tilt right", "pct": _percent(tilt_right_count, total)},
    ]
    top_issue = max(issue_rows, key=lambda row: int(row["pct"]))["key"]

    return {
        "days": days,
        "total_sessions": total,
        "issue_rows": issue_rows,
        "top_issue": top_issue,
        "recommended_ids": _recommended_ids(top_issue),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Compute posture issues and recommendations.")
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB_PATH),
        help="SQLite database path (default: backend/data/zeno_sessions.db).",
    )
    parser.add_argument(
        "--days",
        type=int,
        default=7,
        help="Lookback days for posture insights (default: 7).",
    )
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    days = max(1, min(args.days, 30))
    print(json.dumps(compute_posture_insights(db_path=db_path, days=days)))


if __name__ == "__main__":
    main()
