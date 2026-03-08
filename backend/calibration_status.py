from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "zeno_sessions.db"
BASELINE_SESSIONS = 3


def get_calibration_status(db_path: Path) -> dict:
    if not db_path.exists():
        return {
            "calibrated": False,
            "baseline_sessions_required": BASELINE_SESSIONS,
            "sessions_collected": 0,
            "sessions_remaining": BASELINE_SESSIONS,
            "baseline_posture_score": None,
            "deviation_threshold": 0.15,
        }

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        all_rows = conn.execute(
            "SELECT id, created_at, posture_score FROM sessions ORDER BY id ASC"
        ).fetchall()

    sessions_collected = len(all_rows)
    sessions_remaining = max(0, BASELINE_SESSIONS - sessions_collected)
    calibrated = sessions_collected >= BASELINE_SESSIONS

    baseline_rows = all_rows[:BASELINE_SESSIONS]
    baseline_score = None
    if baseline_rows:
        baseline_score = round(
            sum(float(row["posture_score"]) for row in baseline_rows) / len(baseline_rows),
            3,
        )

    return {
        "calibrated": calibrated,
        "baseline_sessions_required": BASELINE_SESSIONS,
        "sessions_collected": sessions_collected,
        "sessions_remaining": sessions_remaining,
        "baseline_posture_score": baseline_score,
        "deviation_threshold": 0.15,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Return baseline calibration status.")
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB_PATH),
        help="SQLite database path (default: backend/data/zeno_sessions.db).",
    )
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    status = get_calibration_status(db_path)
    print(json.dumps(status))


if __name__ == "__main__":
    main()
