from __future__ import annotations

import argparse
import json
import random
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"
EMOTIONS = ["neutral", "happy", "fear", "sad", "anger", "surprise", "disgust"]


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        ensure_sessions_schema(conn)
        conn.commit()


def generate_session(ts: datetime, focus_mode: bool) -> dict:
    mode = "focus" if focus_mode else "passive"
    if focus_mode:
        posture = round(random.uniform(0.50, 0.90), 3)
        emotion = random.choices(
            population=EMOTIONS,
            weights=[34, 15, 16, 10, 12, 7, 6],
            k=1,
        )[0]
        duration_seconds = round(random.uniform(18 * 60, 55 * 60), 2)
        focus_duration_seconds = int(duration_seconds)
        rr_confidence = random.choices(["full", "partial"], weights=[80, 20], k=1)[0]
        respiratory_rate = round(random.uniform(11.0, 24.0), 1)
    else:
        posture = round(random.uniform(0.36, 0.88), 3)
        emotion = random.choices(
            population=EMOTIONS,
            weights=[40, 18, 11, 11, 8, 8, 4],
            k=1,
        )[0]
        duration_seconds = round(random.uniform(22.0, 70.0), 2)
        focus_duration_seconds = 0
        rr_confidence = "none"
        respiratory_rate = round(random.uniform(11.0, 24.0), 1)

    emotion_score = round(random.uniform(0.45, 0.97), 3)

    heart_rate = None
    if random.random() > 0.08:
        base = 77 if not focus_mode else 80
        if emotion in {"fear", "anger", "disgust"}:
            base = 93
        elif emotion == "happy":
            base = 74
        heart_rate = round(random.uniform(base - 9, base + 12), 1)

    baseline_posture_score = round(random.uniform(0.60, 0.72), 3)
    posture_deviation = max(0.0, round((baseline_posture_score - posture) / max(baseline_posture_score, 0.001), 4))
    posture_is_poor = posture_deviation > 0.15

    return {
        "timestamp": ts.isoformat(timespec="seconds"),
        "presence_detected": True,
        "analysis_skipped": False,
        "posture_score": posture,
        "baseline_posture_score": baseline_posture_score,
        "posture_deviation": posture_deviation,
        "posture_is_poor": posture_is_poor,
        "dominant_emotion": emotion,
        "emotion_score": emotion_score,
        "heart_rate_bpm": heart_rate,
        "respiratory_rate": respiratory_rate,
        "rr_confidence": rr_confidence,
        "emotion_backend": "hsemotion",
        "mode": mode,
        "focus_duration_seconds": focus_duration_seconds,
        "session_duration_seconds": duration_seconds,
        "focus_mode": focus_mode,
        "notification_sent": "none",
        "notification_dismissed_by": "none",
    }


def seed(db_path: Path, days: int, sessions_per_day: int) -> int:
    init_db(db_path)
    inserted = 0

    now = datetime.now().replace(second=0, microsecond=0)
    with sqlite3.connect(db_path) as conn:
        for day_offset in range(days):
            day = now - timedelta(days=(days - 1 - day_offset))
            short_checkins = max(2, int(round(sessions_per_day * 0.65)))
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
                        analysis_skipped,
                        posture_score,
                        baseline_posture_score,
                        posture_deviation,
                        posture_is_poor,
                        dominant_emotion,
                        emotion_score,
                        heart_rate_bpm,
                        respiratory_rate,
                        rr_confidence,
                        emotion_backend,
                        mode,
                        focus_duration_seconds,
                        session_duration_seconds,
                        focus_mode,
                        notification_sent,
                        notification_dismissed_by,
                        raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        session["timestamp"],
                        1,
                        0,
                        session["posture_score"],
                        session["baseline_posture_score"],
                        session["posture_deviation"],
                        1 if session["posture_is_poor"] else 0,
                        session["dominant_emotion"],
                        session["emotion_score"],
                        session["heart_rate_bpm"],
                        session["respiratory_rate"],
                        session["rr_confidence"],
                        session["emotion_backend"],
                        session["mode"],
                        session["focus_duration_seconds"],
                        session["session_duration_seconds"],
                        0,
                        session["notification_sent"],
                        session["notification_dismissed_by"],
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
                        analysis_skipped,
                        posture_score,
                        baseline_posture_score,
                        posture_deviation,
                        posture_is_poor,
                        dominant_emotion,
                        emotion_score,
                        heart_rate_bpm,
                        respiratory_rate,
                        rr_confidence,
                        emotion_backend,
                        mode,
                        focus_duration_seconds,
                        session_duration_seconds,
                        focus_mode,
                        notification_sent,
                        notification_dismissed_by,
                        raw_json
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        session["timestamp"],
                        1,
                        0,
                        session["posture_score"],
                        session["baseline_posture_score"],
                        session["posture_deviation"],
                        1 if session["posture_is_poor"] else 0,
                        session["dominant_emotion"],
                        session["emotion_score"],
                        session["heart_rate_bpm"],
                        session["respiratory_rate"],
                        session["rr_confidence"],
                        session["emotion_backend"],
                        session["mode"],
                        session["focus_duration_seconds"],
                        session["session_duration_seconds"],
                        1,
                        session["notification_sent"],
                        session["notification_dismissed_by"],
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
