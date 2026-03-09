from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import date, datetime
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


def _stress_index(
    dominant_emotion: str,
    emotion_score: float,
    heart_rate_bpm: float | None,
    respiratory_rate: float | None,
    rr_confidence: str,
    mode: str,
    resting_hr: float,
    resting_rr: float,
) -> int:
    emotion = (dominant_emotion or "unknown").lower()
    emotion_points = {
        "happy": 20.0,
        "happiness": 20.0,
        "neutral": 35.0,
        "surprise": 45.0,
        "sad": 55.0,
        "sadness": 55.0,
        "disgust": 70.0,
        "contempt": 70.0,
        "angry": 85.0,
        "anger": 85.0,
        "fear": 85.0,
    }.get(emotion, 50.0)
    emotion_points *= max(float(emotion_score), 0.25)

    if heart_rate_bpm is None:
        hr_points = 0.0
    else:
        hr_points = max(0.0, min(100.0, (float(heart_rate_bpm) - resting_hr) * 3.2))

    rr = float(respiratory_rate or 0.0)
    if rr <= 0:
        rr_points = 0.0
    else:
        rr_points = max(0.0, min(100.0, (rr - resting_rr) * 6.0))

    if mode == "focus" and rr_confidence == "full":
        hr_weight, rr_weight, emotion_weight = 0.35, 0.30, 0.35
    elif mode == "focus" and rr_confidence == "partial":
        hr_weight, rr_weight, emotion_weight = 0.40, 0.15, 0.45
    else:
        hr_weight, rr_weight, emotion_weight = 0.50, 0.00, 0.50

    weighted = hr_points * hr_weight + rr_points * rr_weight + emotion_points * emotion_weight
    return int(max(0, min(100, round(weighted))))


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
            "average_respiratory_rate": None,
            "focused_minutes": 0,
            "peak_stress": None,
            "posture_trend": [],
            "stress_trend": [],
            "rr_trend": [],
            "recommendation": "No data yet. Run a few check-ins to generate insights.",
        }

    day_start = datetime.combine(target_day, datetime.min.time()).isoformat(timespec="seconds")
    day_end = datetime.combine(target_day, datetime.max.time()).isoformat(timespec="seconds")

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        ensure_sessions_schema(conn)
        baseline_row = conn.execute(
            """
            SELECT resting_hr, resting_rr
            FROM baseline
            WHERE id = 1
            """
        ).fetchone()
        resting_hr = (
            float(baseline_row["resting_hr"])
            if baseline_row is not None and baseline_row["resting_hr"] is not None
            else 75.0
        )
        resting_rr = (
            float(baseline_row["resting_rr"])
            if baseline_row is not None and baseline_row["resting_rr"] is not None
            else 14.0
        )
        rows = conn.execute(
            """
            SELECT
                created_at,
                posture_score,
                dominant_emotion,
                emotion_score,
                heart_rate_bpm,
                respiratory_rate,
                rr_confidence,
                mode
            FROM sessions
            WHERE created_at BETWEEN ? AND ?
              AND presence_detected = 1
              AND analysis_skipped = 0
            ORDER BY created_at ASC
            """,
            (day_start, day_end),
        ).fetchall()

    if not rows:
        return {
            "date": target_day.isoformat(),
            "sessions": 0,
            "average_stress_index": 0,
            "average_respiratory_rate": None,
            "focused_minutes": 0,
            "peak_stress": None,
            "posture_trend": [],
            "stress_trend": [],
            "rr_trend": [],
            "recommendation": "No data yet. Run a few check-ins to generate insights.",
        }

    items = []
    rr_points: list[float] = []
    for row in rows:
        stress = _stress_index(
            dominant_emotion=row["dominant_emotion"],
            emotion_score=row["emotion_score"],
            heart_rate_bpm=row["heart_rate_bpm"],
            respiratory_rate=row["respiratory_rate"],
            rr_confidence=str(row["rr_confidence"] or "none"),
            mode=str(row["mode"] or "passive"),
            resting_hr=resting_hr,
            resting_rr=resting_rr,
        )
        items.append(
            {
                "time": row["created_at"],
                "posture_score": float(row["posture_score"]),
                "stress_index": stress,
                "dominant_emotion": str(row["dominant_emotion"]),
                "respiratory_rate": float(row["respiratory_rate"] or 0.0),
                "rr_confidence": str(row["rr_confidence"] or "none"),
                "mode": str(row["mode"] or "passive"),
            }
        )
        rr_value = float(row["respiratory_rate"] or 0.0)
        rr_confidence = str(row["rr_confidence"] or "none")
        if rr_value > 0.0 and rr_confidence in {"partial", "full"} and str(row["mode"] or "passive") == "focus":
            rr_points.append(rr_value)

    avg_stress = sum(i["stress_index"] for i in items) / len(items)
    avg_posture = sum(i["posture_score"] for i in items) / len(items)
    focused_sessions = sum(1 for i in items if i["stress_index"] < 40)
    peak = max(items, key=lambda i: i["stress_index"])
    avg_rr = round(sum(rr_points) / len(rr_points), 1) if rr_points else None

    return {
        "date": target_day.isoformat(),
        "sessions": len(items),
        "average_stress_index": round(avg_stress, 1),
        "average_respiratory_rate": avg_rr,
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
        "stress_trend": [
            {
                "time": i["time"],
                "score": int(i["stress_index"]),
            }
            for i in items
        ],
        "rr_trend": [
            {
                "time": i["time"],
                "score": round(float(i["respiratory_rate"]), 1),
                "confidence": i["rr_confidence"],
                "mode": i["mode"],
            }
            for i in items
            if float(i["respiratory_rate"]) > 0
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
