from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "zeno_sessions.db"


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS exercise_sessions (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
              exercise_id TEXT NOT NULL,
              completed INTEGER NOT NULL,
              form_score REAL,
              duration_seconds REAL,
              triggered_by TEXT
            )
            """
        )
        conn.commit()


def log_exercise_session(
    db_path: Path,
    exercise_id: str,
    completed: bool,
    form_score: float | None,
    duration_seconds: float | None,
    triggered_by: str,
) -> int:
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO exercise_sessions (
              exercise_id,
              completed,
              form_score,
              duration_seconds,
              triggered_by
            ) VALUES (?, ?, ?, ?, ?)
            """,
            (
                exercise_id.strip(),
                1 if completed else 0,
                None if form_score is None else max(0.0, min(1.0, float(form_score))),
                None if duration_seconds is None else max(0.0, float(duration_seconds)),
                triggered_by.strip() or "manual",
            ),
        )
        conn.commit()
        return int(cursor.lastrowid)


def main() -> None:
    parser = argparse.ArgumentParser(description="Log exercise session into SQLite.")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--exercise-id", required=True)
    parser.add_argument("--completed", action="store_true")
    parser.add_argument("--form-score", type=float, default=None)
    parser.add_argument("--duration-seconds", type=float, default=None)
    parser.add_argument("--triggered-by", default="manual")
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    row_id = log_exercise_session(
        db_path=db_path,
        exercise_id=args.exercise_id,
        completed=args.completed,
        form_score=args.form_score,
        duration_seconds=args.duration_seconds,
        triggered_by=args.triggered_by,
    )
    print(json.dumps({"ok": True, "inserted_id": row_id, "db_path": str(db_path)}))


if __name__ == "__main__":
    main()
