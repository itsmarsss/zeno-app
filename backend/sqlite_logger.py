from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime
from pathlib import Path

from session_runner import run_session

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "zeno_sessions.db"


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS sessions (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                created_at TEXT NOT NULL,
                presence_detected INTEGER NOT NULL,
                posture_score REAL NOT NULL,
                dominant_emotion TEXT NOT NULL,
                emotion_score REAL NOT NULL,
                heart_rate_bpm REAL,
                emotion_backend TEXT NOT NULL,
                focus_mode INTEGER NOT NULL DEFAULT 0,
                session_duration_seconds REAL NOT NULL,
                raw_json TEXT NOT NULL
            )
            """
        )
        columns = {
            row[1]
            for row in conn.execute("PRAGMA table_info(sessions)").fetchall()
        }
        if "focus_mode" not in columns:
            conn.execute(
                "ALTER TABLE sessions ADD COLUMN focus_mode INTEGER NOT NULL DEFAULT 0"
            )
        conn.commit()


def log_session(result: dict, db_path: Path) -> int:
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        cursor = conn.execute(
            """
            INSERT INTO sessions (
                created_at,
                presence_detected,
                posture_score,
                dominant_emotion,
                emotion_score,
                heart_rate_bpm,
                emotion_backend,
                focus_mode,
                session_duration_seconds,
                raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result["timestamp"],
                1 if result["presence_detected"] else 0,
                float(result["posture_score"]),
                str(result["dominant_emotion"]),
                float(result["emotion_score"]),
                None if result["heart_rate_bpm"] is None else float(result["heart_rate_bpm"]),
                str(result["emotion_backend"]),
                1 if result.get("focus_mode") else 0,
                float(result["session_duration_seconds"]),
                json.dumps(result),
            ),
        )
        conn.commit()
        return int(cursor.lastrowid)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run one session and store results in local SQLite."
    )
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB_PATH),
        help="SQLite database path (default: backend/data/zeno_sessions.db).",
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Show capture previews while running analyzers.",
    )
    parser.add_argument(
        "--emotion-backend",
        choices=["fer", "hsemotion"],
        default="hsemotion",
        help="Emotion backend for session runner.",
    )
    parser.add_argument(
        "--hsemotion-model",
        default="enet_b0_8_best_afew",
        help="HSEmotion model name.",
    )
    parser.add_argument(
        "--hsemotion-model-path",
        default=None,
        help="Local HSEmotion .pt model path.",
    )
    parser.add_argument(
        "--focus-mode",
        action="store_true",
        help="Mark this session as captured during Focus Mode.",
    )
    args = parser.parse_args()

    result = run_session(
        emotion_backend=args.emotion_backend,
        preview=args.preview,
        hsemotion_model=args.hsemotion_model,
        hsemotion_model_path=args.hsemotion_model_path,
    )
    result["focus_mode"] = bool(args.focus_mode)

    db_path = Path(args.db_path).expanduser().resolve()
    row_id = log_session(result, db_path)

    output = {
        "inserted_id": row_id,
        "db_path": str(db_path),
        "logged_at": datetime.now().isoformat(timespec="seconds"),
        "session": result,
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()
