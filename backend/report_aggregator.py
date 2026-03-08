from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import date, datetime
from pathlib import Path

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "zeno_sessions.db"


def _stress_index(dominant_emotion: str, emotion_score: float, heart_rate_bpm: float | None) -> int:
    emotion = (dominant_emotion or "unknown").lower()
    emotion_points = {
        "fear": 28.0,
        "angry": 25.0,
        "anger": 25.0,
        "disgust": 22.0,
        "contempt": 22.0,
        "sad": 16.0,
        "sadness": 16.0,
        "neutral": 8.0,
        "surprise": 12.0,
        "happy": 4.0,
        "happiness": 4.0,
    }.get(emotion, 10.0)
    emotion_points *= max(float(emotion_score), 0.25)

    if heart_rate_bpm is None:
        hr_points = 8.0
    elif heart_rate_bpm >= 105:
        hr_points = 52.0
    elif heart_rate_bpm >= 95:
        hr_points = 40.0
    elif heart_rate_bpm >= 85:
        hr_points = 28.0
    elif heart_rate_bpm >= 75:
        hr_points = 14.0
    else:
        hr_points = 6.0

    return int(max(0, min(100, round(emotion_points + hr_points))))


def _recommendation(avg_stress: float, avg_posture: float) -> str:
    if avg_stress >= 65:
        return "Schedule two short breaks tomorrow and reduce session intensity in the afternoon."
    if avg_posture < 0.5:
        return "Do a 2-minute posture reset every hour and raise your screen slightly."
    if avg_stress <= 35 and avg_posture >= 0.65:
        return "Great balance today. Keep the same cadence and hydration routine tomorrow."
    return "Keep a steady pace tomorrow and add one short standing break before lunch."


def generate_daily_report(db_path: Path, target_day: date, session_minutes: int = 10) -> dict:
    if not db_path.exists():
        return {
            "date": target_day.isoformat(),
            "sessions": 0,
            "average_stress_index": 0,
            "focused_minutes": 0,
            "peak_stress": None,
            "posture_trend": [],
            "recommendation": "No data yet. Run a few check-ins to generate insights.",
        }

    day_start = datetime.combine(target_day, datetime.min.time()).isoformat(timespec="seconds")
    day_end = datetime.combine(target_day, datetime.max.time()).isoformat(timespec="seconds")

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            """
            SELECT
                created_at,
                posture_score,
                dominant_emotion,
                emotion_score,
                heart_rate_bpm
            FROM sessions
            WHERE created_at BETWEEN ? AND ?
            ORDER BY created_at ASC
            """,
            (day_start, day_end),
        ).fetchall()

    if not rows:
        return {
            "date": target_day.isoformat(),
            "sessions": 0,
            "average_stress_index": 0,
            "focused_minutes": 0,
            "peak_stress": None,
            "posture_trend": [],
            "recommendation": "No data yet. Run a few check-ins to generate insights.",
        }

    items = []
    for row in rows:
        stress = _stress_index(
            dominant_emotion=row["dominant_emotion"],
            emotion_score=row["emotion_score"],
            heart_rate_bpm=row["heart_rate_bpm"],
        )
        items.append(
            {
                "time": row["created_at"],
                "posture_score": float(row["posture_score"]),
                "stress_index": stress,
                "dominant_emotion": str(row["dominant_emotion"]),
            }
        )

    avg_stress = sum(i["stress_index"] for i in items) / len(items)
    avg_posture = sum(i["posture_score"] for i in items) / len(items)
    focused_sessions = sum(1 for i in items if i["stress_index"] < 40)
    peak = max(items, key=lambda i: i["stress_index"])

    return {
        "date": target_day.isoformat(),
        "sessions": len(items),
        "average_stress_index": round(avg_stress, 1),
        "focused_minutes": focused_sessions * session_minutes,
        "peak_stress": {
            "stress_index": peak["stress_index"],
            "time": peak["time"],
        },
        "posture_trend": [
            {
                "time": i["time"],
                "score": round(i["posture_score"], 3),
            }
            for i in items
        ],
        "recommendation": _recommendation(avg_stress=avg_stress, avg_posture=avg_posture),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate daily report summary from SQLite.")
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB_PATH),
        help="SQLite database path (default: backend/data/zeno_sessions.db).",
    )
    parser.add_argument(
        "--date",
        default=date.today().isoformat(),
        help="Target date in YYYY-MM-DD (default: today).",
    )
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    target_day = date.fromisoformat(args.date)
    report = generate_daily_report(db_path=db_path, target_day=target_day)
    print(json.dumps(report))


if __name__ == "__main__":
    main()
