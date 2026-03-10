from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

from zeno_backend.data.daily_aggregates import refresh_all_daily_aggregates
from zeno_backend.data.db_schema import ensure_sessions_schema
from zeno_backend.data.posture_daily_insights import refresh_all_posture_daily_insights

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


def main() -> None:
    parser = argparse.ArgumentParser(description="Rebuild all daily aggregates from sessions.")
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB_PATH),
        help="SQLite database path (default: backend/data/zeno_sessions.db).",
    )
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    if not db_path.exists():
        print(json.dumps({"db_path": str(db_path), "updated_days": 0}))
        return

    with sqlite3.connect(db_path) as conn:
        ensure_sessions_schema(conn)
        updated_days = refresh_all_daily_aggregates(conn)
        posture_updated_days = refresh_all_posture_daily_insights(conn)
        conn.commit()
    print(
        json.dumps(
            {
                "db_path": str(db_path),
                "updated_days": updated_days,
                "posture_updated_days": posture_updated_days,
            }
        )
    )


if __name__ == "__main__":
    main()
