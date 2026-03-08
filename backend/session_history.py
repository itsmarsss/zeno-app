from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "zeno_sessions.db"


def fetch_history(db_path: Path, limit: int = 20) -> list[dict]:
    if not db_path.exists():
        return []

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT
                id,
                created_at,
                presence_detected,
                posture_score,
                dominant_emotion,
                emotion_score,
                heart_rate_bpm,
                emotion_backend,
                focus_mode,
                session_duration_seconds
            FROM sessions
            ORDER BY id DESC
            LIMIT ?
            """,
            (max(1, min(limit, 200)),),
        ).fetchall()

    return [dict(row) for row in rows]


def main() -> None:
    parser = argparse.ArgumentParser(description="Read recent sessions from local SQLite.")
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB_PATH),
        help="SQLite database path (default: backend/data/zeno_sessions.db).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=20,
        help="Max number of records to return (default: 20).",
    )
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    history = fetch_history(db_path=db_path, limit=args.limit)
    print(json.dumps({"items": history}))


if __name__ == "__main__":
    main()
