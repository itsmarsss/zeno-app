from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


def fetch_session_days(db_path: Path) -> dict:
    if not db_path.exists():
        return {"days": [], "min_date": None, "max_date": None, "total_days": 0}

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        ensure_sessions_schema(conn)
        rows = conn.execute(
            """
            SELECT substr(created_at, 1, 10) AS day, COUNT(*) AS sessions
            FROM sessions
            GROUP BY day
            ORDER BY day DESC
            """
        ).fetchall()

    days = [{"date": str(row["day"]), "sessions": int(row["sessions"])} for row in rows]
    min_date = days[-1]["date"] if days else None
    max_date = days[0]["date"] if days else None
    return {
        "days": days,
        "min_date": min_date,
        "max_date": max_date,
        "total_days": len(days),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="List distinct session days from SQLite.")
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB_PATH),
        help="SQLite database path (default: backend/data/zeno_sessions.db).",
    )
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    print(json.dumps(fetch_session_days(db_path=db_path)))


if __name__ == "__main__":
    main()
