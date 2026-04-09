from __future__ import annotations

import argparse
import json
from datetime import date, datetime
from pathlib import Path

from zeno_backend.data.daily_aggregates import fetch_daily_aggregate, recompute_daily_aggregate
from zeno_backend.data.db_schema import ensure_sessions_schema
from zeno_backend.data.db_utils import connect_db, safe_float, safe_int

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


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
    day_key = target_day.isoformat()

    with connect_db(db_path) as conn:
        ensure_sessions_schema(conn)
        # Always recompute so focus-session grouping and break tables stay fresh.
        aggregate = recompute_daily_aggregate(conn, day_key)
        conn.commit()
        rows = conn.execute(
            """
            SELECT
                created_at,
                posture_score,
                dominant_emotion,
                emotion_score,
                stress_index,
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
            "focused_minutes": safe_int(aggregate.get("focused_minutes"), 0) or 0,
            "peak_stress": None,
            "posture_trend": [],
            "stress_trend": [],
            "rr_trend": [],
            "recommendation": str(
                aggregate.get("recommendation")
                or "No data yet. Run a few check-ins to generate insights."
            ),
        }

    items = []
    rr_points: list[float] = []
    for row in rows:
        stress = safe_int(row["stress_index"], 0) or 0
        items.append(
            {
                "time": row["created_at"],
                "posture_score": safe_float(row["posture_score"], 0.0) or 0.0,
                "stress_index": stress,
                "dominant_emotion": str(row["dominant_emotion"] or "unknown"),
                "respiratory_rate": safe_float(row["respiratory_rate"], 0.0) or 0.0,
                "rr_confidence": str(row["rr_confidence"] or "none"),
                "mode": str(row["mode"] or "passive"),
            }
        )
        rr_value = safe_float(row["respiratory_rate"], 0.0) or 0.0
        rr_confidence = str(row["rr_confidence"] or "none")
        if rr_value > 0.0 and rr_confidence in {"partial", "full"} and str(row["mode"] or "passive") == "focus":
            rr_points.append(rr_value)

    peak_stress = None
    if aggregate.get("peak_stress_index") is not None and aggregate.get("peak_stress_time"):
        peak_stress = {
            "stress_index": safe_int(aggregate["peak_stress_index"], 0) or 0,
            "time": str(aggregate["peak_stress_time"]),
        }

    return {
        "date": target_day.isoformat(),
        "sessions": safe_int(aggregate.get("sessions_count"), len(items)) or len(items),
        "average_stress_index": safe_float(aggregate.get("average_stress_index"), 0.0) or 0.0,
        "average_respiratory_rate": (
            round(safe_float(aggregate["average_respiratory_rate"], 0.0) or 0.0, 1)
            if aggregate.get("average_respiratory_rate") is not None
            else (round(sum(rr_points) / len(rr_points), 1) if rr_points else None)
        ),
        "focused_minutes": safe_int(aggregate.get("focused_minutes"), 0) or 0,
        "peak_stress": peak_stress,
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
        "recommendation": str(aggregate.get("recommendation") or "Keep a steady pace tomorrow."),
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
