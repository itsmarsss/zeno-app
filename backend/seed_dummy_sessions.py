from __future__ import annotations

import argparse
import json
import random
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "zeno_sessions.db"
EMOTIONS = ["neutral", "happy", "stressed", "sad", "angry", "surprise"]


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
                session_duration_seconds REAL NOT NULL,
                raw_json TEXT NOT NULL
            )
            """
        )
        conn.commit()


def generate_session(ts: datetime) -> dict:
    posture = round(random.uniform(0.35, 0.92), 3)
    emotion = random.choices(
        population=EMOTIONS,
        weights=[30, 18, 22, 10, 12, 8],
        k=1,
    )[0]
    emotion_score = round(random.uniform(0.45, 0.97), 3)

    heart_rate = None
    if random.random() > 0.08:
        base = 78
        if emotion in {"stressed", "angry"}:
            base = 93
        elif emotion == "happy":
            base = 74
        heart_rate = round(random.uniform(base - 9, base + 12), 1)

    return {
        "timestamp": ts.isoformat(timespec="seconds"),
        "presence_detected": True,
        "posture_score": posture,
        "dominant_emotion": emotion,
        "emotion_score": emotion_score,
        "heart_rate_bpm": heart_rate,
        "emotion_backend": "hsemotion",
        "session_duration_seconds": round(random.uniform(31.0, 39.0), 2),
    }


def seed(db_path: Path, days: int, sessions_per_day: int) -> int:
    init_db(db_path)
    inserted = 0

    now = datetime.now().replace(second=0, microsecond=0)
    with sqlite3.connect(db_path) as conn:
        for day_offset in range(days):
            day = now - timedelta(days=(days - 1 - day_offset))
            start_hour = random.randint(8, 10)
            start = day.replace(hour=start_hour, minute=random.randint(0, 20))

            for i in range(sessions_per_day):
                ts = start + timedelta(minutes=i * random.choice([8, 10, 12]))
                session = generate_session(ts)
                conn.execute(
                    """
                    INSERT INTO sessions (
                        created_at,
                        presence_detected,
                        posture_score,
                        dominant_emotion,
                        emotion_score,
                        heart_rate_bpm,
                        emotion_backend,
                        session_duration_seconds,
                        raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        session["timestamp"],
                        1,
                        session["posture_score"],
                        session["dominant_emotion"],
                        session["emotion_score"],
                        session["heart_rate_bpm"],
                        session["emotion_backend"],
                        session["session_duration_seconds"],
                        json.dumps(session),
                    ),
                )
                inserted += 1
        conn.commit()

    return inserted


def main() -> None:
    parser = argparse.ArgumentParser(description="Seed local SQLite with dummy Zeno sessions.")
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB_PATH),
        help="SQLite database path (default: backend/data/zeno_sessions.db).",
    )
    parser.add_argument("--days", type=int, default=4, help="Number of days to seed.")
    parser.add_argument(
        "--sessions-per-day",
        type=int,
        default=14,
        help="Synthetic sessions per day.",
    )
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    inserted = seed(
        db_path=db_path,
        days=max(1, min(args.days, 30)),
        sessions_per_day=max(1, min(args.sessions_per_day, 96)),
    )
    print(json.dumps({"db_path": str(db_path), "inserted": inserted}))


if __name__ == "__main__":
    main()
