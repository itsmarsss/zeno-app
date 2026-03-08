from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "zeno_sessions.db"


def clear_data(db_path: Path) -> int:
    if not db_path.exists():
        return 0

    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute("DELETE FROM sessions")
        conn.commit()
        return int(cursor.rowcount)


def main() -> None:
    parser = argparse.ArgumentParser(description="Clear all local session data.")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    deleted = clear_data(db_path)
    print(json.dumps({"deleted": deleted, "db_path": str(db_path)}))


if __name__ == "__main__":
    main()
