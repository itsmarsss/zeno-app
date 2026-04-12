from __future__ import annotations

import argparse
import json
import random
from datetime import datetime, timedelta
from pathlib import Path
from uuid import uuid4

from zeno_backend.data.db_schema import ensure_sessions_schema
from zeno_backend.data.daily_aggregates import refresh_all_daily_aggregates
from zeno_backend.data.db_utils import connect_db
from zeno_backend.data.posture_daily_insights import refresh_all_posture_daily_insights
from zeno_backend.core.stress_index import compute_stress_index

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"
EMOTIONS = ["neutral", "happy", "fear", "sad", "anger", "surprise", "disgust"]


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with connect_db(db_path) as conn:
        ensure_sessions_schema(conn)
        conn.commit()


def generate_session(ts: datetime, focus_mode: bool, focus_session_id: str | None = None) -> dict:
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
    tracking_confidence = round(random.uniform(0.74, 0.99), 5)
    head_offset_norm = round(random.uniform(-0.22, 0.22), 5)
    shoulder_tilt_signed_norm = round(random.uniform(-0.16, 0.16), 5)
    shoulder_tilt_norm = round(abs(shoulder_tilt_signed_norm), 5)
    posture_stability_std = round(random.uniform(0.015, 0.135), 5)
    posture_stability_label = (
        "stable" if posture_stability_std < 0.06 else "moderate" if posture_stability_std < 0.12 else "variable"
    )
    if posture_is_poor:
        posture_state = "poor_posture"
        if abs(head_offset_norm) >= shoulder_tilt_norm:
            posture_dominant_issue = "head_forward"
        elif shoulder_tilt_signed_norm >= 0.05:
            posture_dominant_issue = "shoulder_tilt"
        else:
            posture_dominant_issue = "trunk_lean"
    elif posture_deviation > 0.08:
        posture_state = "mild_drift"
        posture_dominant_issue = "head_forward" if abs(head_offset_norm) >= 0.08 else "trunk_lean"
    else:
        posture_state = "good"
        posture_dominant_issue = "unknown"
    posture_signal_quality = (
        "high" if tracking_confidence >= 0.85 else "medium" if tracking_confidence >= 0.70 else "low"
    )

    return {
        "timestamp": ts.isoformat(timespec="seconds"),
        "presence_detected": True,
        "analysis_skipped": False,
        "posture_score": posture,
        "tracking_confidence": tracking_confidence,
        "head_offset_norm": head_offset_norm,
        "shoulder_tilt_signed_norm": shoulder_tilt_signed_norm,
        "shoulder_tilt_norm": shoulder_tilt_norm,
        "posture_stability_std": posture_stability_std,
        "posture_stability_label": posture_stability_label,
        "posture_state": posture_state,
        "posture_dominant_issue": posture_dominant_issue,
        "posture_signal_quality": posture_signal_quality,
        "posture_nudge_eligible": 1 if posture_state == "poor_posture" and not focus_mode else 0,
        "baseline_posture_score": baseline_posture_score,
        "posture_deviation": posture_deviation,
        "posture_is_poor": posture_is_poor,
        "dominant_emotion": emotion,
        "emotion_score": emotion_score,
        "stress_index": compute_stress_index(
            dominant_emotion=emotion,
            emotion_score=emotion_score,
            heart_rate_bpm=heart_rate,
            respiratory_rate=respiratory_rate,
            rr_confidence=rr_confidence,
            mode=mode,
            resting_hr=75.0,
            resting_rr=14.0,
        ),
        "heart_rate_bpm": heart_rate,
        "respiratory_rate": respiratory_rate,
        "rr_confidence": rr_confidence,
        "emotion_backend": "hsemotion",
        "mode": mode,
        "focus_session_id": focus_session_id if focus_mode else None,
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
    insert_sql = """
        INSERT INTO sessions (
            created_at,
            presence_detected,
            analysis_skipped,
            posture_score,
            tracking_confidence,
            head_offset_norm,
            shoulder_tilt_signed_norm,
            shoulder_tilt_norm,
            posture_stability_std,
            posture_stability_label,
            posture_state,
            posture_dominant_issue,
            posture_signal_quality,
            posture_nudge_eligible,
            baseline_posture_score,
            posture_deviation,
            posture_is_poor,
            dominant_emotion,
            emotion_score,
            stress_index,
            heart_rate_bpm,
            respiratory_rate,
            rr_confidence,
            emotion_backend,
            mode,
            focus_session_id,
            focus_duration_seconds,
            session_duration_seconds,
            focus_mode,
            notification_sent,
            notification_dismissed_by,
            raw_json
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """

    def row_values(session: dict, focus_flag: int) -> tuple:
        return (
            session["timestamp"],
            1,
            0,
            session["posture_score"],
            session["tracking_confidence"],
            session["head_offset_norm"],
            session["shoulder_tilt_signed_norm"],
            session["shoulder_tilt_norm"],
            session["posture_stability_std"],
            session["posture_stability_label"],
            session["posture_state"],
            session["posture_dominant_issue"],
            session["posture_signal_quality"],
            session["posture_nudge_eligible"],
            session["baseline_posture_score"],
            session["posture_deviation"],
            1 if session["posture_is_poor"] else 0,
            session["dominant_emotion"],
            session["emotion_score"],
            session["stress_index"],
            session["heart_rate_bpm"],
            session["respiratory_rate"],
            session["rr_confidence"],
            session["emotion_backend"],
            session["mode"],
            session.get("focus_session_id"),
            session["focus_duration_seconds"],
            session["session_duration_seconds"],
            focus_flag,
            session["notification_sent"],
            session["notification_dismissed_by"],
            json.dumps(session),
        )

    with connect_db(db_path) as conn:
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
                conn.execute(insert_sql, row_values(session, 0))
                inserted += 1

            # Focus sessions clustered in typical focus windows.
            focus_minutes = sorted(
                random.sample(range(9 * 60, 19 * 60), k=min(focus_blocks, 10 * 60))
            )
            for minute_offset in focus_minutes:
                ts = day.replace(hour=0, minute=0) + timedelta(minutes=minute_offset)
                session = generate_session(ts, focus_mode=True, focus_session_id=str(uuid4()))
                conn.execute(insert_sql, row_values(session, 1))
                inserted += 1
        conn.commit()
        refresh_all_daily_aggregates(conn)
        refresh_all_posture_daily_insights(conn)
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
