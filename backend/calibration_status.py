from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

from db_schema import ensure_sessions_schema

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
        ensure_sessions_schema(conn)
        baseline_row = conn.execute(
            """
            SELECT
              posture_baseline_score,
              ear_shoulder_offset,
              neck_spine_angle,
              resting_hr,
              resting_rr,
              calibration_sessions_completed,
              is_calibrated
            FROM baseline
            WHERE id = 1
            """
        ).fetchone()

    sessions_collected = int(baseline_row["calibration_sessions_completed"]) if baseline_row else 0
    sessions_remaining = max(0, BASELINE_SESSIONS - sessions_collected)
    calibrated = bool(baseline_row["is_calibrated"]) if baseline_row else False
    baseline_score = (
        round(float(baseline_row["posture_baseline_score"]), 3)
        if baseline_row and baseline_row["posture_baseline_score"] is not None
        else None
    )
    baseline_ear = (
        round(float(baseline_row["ear_shoulder_offset"]), 5)
        if baseline_row and baseline_row["ear_shoulder_offset"] is not None
        else None
    )
    baseline_neck = (
        round(float(baseline_row["neck_spine_angle"]), 3)
        if baseline_row and baseline_row["neck_spine_angle"] is not None
        else None
    )
    resting_hr = (
        round(float(baseline_row["resting_hr"]), 1)
        if baseline_row and baseline_row["resting_hr"] is not None
        else None
    )
    resting_rr = (
        round(float(baseline_row["resting_rr"]), 1)
        if baseline_row and baseline_row["resting_rr"] is not None
        else None
    )

    return {
        "calibrated": calibrated,
        "baseline_sessions_required": BASELINE_SESSIONS,
        "sessions_collected": sessions_collected,
        "sessions_remaining": sessions_remaining,
        "baseline_posture_score": baseline_score,
        "baseline_ear_shoulder_offset": baseline_ear,
        "baseline_neck_spine_angle": baseline_neck,
        "resting_hr": resting_hr,
        "resting_rr": resting_rr,
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
