from __future__ import annotations

import argparse
import json
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema
from zeno_backend.data.db_utils import (
    connect_db,
    ensure_breathing_sessions_table,
    ensure_break_sessions_table,
    ensure_exercise_sessions_table,
    safe_int,
)

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


def fetch_activity_stats(db_path: Path) -> dict:
    if not db_path.exists():
        return {
            "breathing_today": 0,
            "exercises_today": 0,
            "exercises_completed_today": 0,
            "breaks_today": 0,
        }

    with connect_db(db_path) as conn:
        ensure_sessions_schema(conn)
        ensure_breathing_sessions_table(conn)
        ensure_exercise_sessions_table(conn)
        ensure_break_sessions_table(conn)

        breathing_today = safe_int(
            conn.execute(
                """
                SELECT COUNT(*) FROM breathing_sessions
                WHERE substr(COALESCE(timestamp, ''), 1, 10) = date('now', 'localtime')
                """
            ).fetchone()[0],
            0,
        ) or 0
        exercise_row = conn.execute(
            """
            SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed
            FROM exercise_sessions
            WHERE substr(COALESCE(timestamp, ''), 1, 10) = date('now', 'localtime')
            """
        ).fetchone()
        breaks_today = safe_int(
            conn.execute(
                """
                SELECT COUNT(*) FROM break_sessions
                WHERE substr(COALESCE(timestamp, ''), 1, 10) = date('now', 'localtime')
                """
            ).fetchone()[0],
            0,
        ) or 0

    return {
        "breathing_today": breathing_today,
        "exercises_today": safe_int(exercise_row[0] if exercise_row else 0, 0) or 0,
        "exercises_completed_today": safe_int(exercise_row[1] if exercise_row else 0, 0) or 0,
        "breaks_today": breaks_today,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch daily activity counters.")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    args = parser.parse_args()
    print(json.dumps(fetch_activity_stats(Path(args.db_path).expanduser().resolve())))


if __name__ == "__main__":
    main()
