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
                focus_mode INTEGER NOT NULL DEFAULT 0,
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


def generate_session(ts: datetime, focus_mode: bool) -> dict:
    if focus_mode:
        posture = round(random.uniform(0.56, 0.93), 3)
        emotion = random.choices(
            population=EMOTIONS,
            weights=[30, 22, 24, 4, 12, 8],
            k=1,
        )[0]
        duration_seconds = round(random.uniform(20 * 60, 55 * 60), 2)
    else:
        posture = round(random.uniform(0.35, 0.90), 3)
        emotion = random.choices(
            population=EMOTIONS,
            weights=[34, 16, 21, 11, 10, 8],
            k=1,
        )[0]
        duration_seconds = round(random.uniform(25.0, 65.0), 2)

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
        "session_duration_seconds": duration_seconds,
        "focus_mode": focus_mode,
    }


def seed(db_path: Path, days: int, sessions_per_day: int) -> int:
    init_db(db_path)
    inserted = 0

    now = datetime.now().replace(second=0, microsecond=0)
    with sqlite3.connect(db_path) as conn:
        for day_offset in range(days):
            day = now - timedelta(days=(days - 1 - day_offset))
            short_checkins = max(2, sessions_per_day // 3)
            focus_blocks = max(1, sessions_per_day - short_checkins)

            # Short check-ins spread throughout work hours.
            checkin_slots = sorted(
                random.sample(range(8 * 60, 20 * 60), k=min(short_checkins, 12 * 60))
            )
            for minute_offset in checkin_slots:
                ts = day.replace(hour=0, minute=0) + timedelta(minutes=minute_offset)
                session = generate_session(ts, focus_mode=False)
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
                        focus_mode,
                        raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        0,
                        json.dumps(session),
                    ),
                )
                inserted += 1

            # Focus sessions clustered in typical focus windows.
            focus_minutes = sorted(
                random.sample(range(9 * 60, 19 * 60), k=min(focus_blocks, 10 * 60))
            )
            for minute_offset in focus_minutes:
                ts = day.replace(hour=0, minute=0) + timedelta(minutes=minute_offset)
                session = generate_session(ts, focus_mode=True)
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
                        focus_mode,
                        raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                        1,
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
    parser.add_argument("--days", type=int, default=30, help="Number of days to seed.")
    parser.add_argument(
        "--sessions-per-day",
        type=int,
        default=10,
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
