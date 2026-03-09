from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS break_sessions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
              break_seconds INTEGER NOT NULL,
              away_seconds INTEGER NOT NULL,
              quality_score REAL NOT NULL,
              genuine_break INTEGER NOT NULL,
              triggered_by TEXT
            )
            """
        )
        conn.commit()


def log_break_session(
    db_path: Path,
    break_seconds: int,
    away_seconds: int,
    quality_score: float,
    genuine_break: bool,
    triggered_by: str,
) -> int:
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO break_sessions (
              break_seconds,
              away_seconds,
              quality_score,
              genuine_break,
              triggered_by
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                max(0, int(break_seconds)),
                max(0, int(away_seconds)),
                max(0.0, min(100.0, float(quality_score))),
                1 if genuine_break else 0,
                triggered_by,
            ),
        )
        conn.commit()
        return int(cursor.lastrowid)


def main() -> None:
    parser = argparse.ArgumentParser(description="Log break quality data into SQLite.")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--break-seconds", type=int, required=True)
    parser.add_argument("--away-seconds", type=int, required=True)
    parser.add_argument("--quality-score", type=float, required=True)
    parser.add_argument("--genuine-break", action="store_true")
    parser.add_argument("--triggered-by", default="manual")
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    row_id = log_break_session(
        db_path=db_path,
        break_seconds=args.break_seconds,
        away_seconds=args.away_seconds,
        quality_score=args.quality_score,
        genuine_break=args.genuine_break,
        triggered_by=args.triggered_by,
    )
    print(json.dumps({"ok": True, "inserted_id": row_id, "db_path": str(db_path)}))


if __name__ == "__main__":
    main()
