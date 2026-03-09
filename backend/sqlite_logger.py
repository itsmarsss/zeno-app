from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime
from pathlib import Path

from db_schema import ensure_sessions_schema
from session_runner import run_session

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "zeno_sessions.db"


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        ensure_sessions_schema(conn)
        conn.commit()


def _stress_index(
    dominant_emotion: str,
    emotion_score: float,
    heart_rate_bpm: float | None,
    respiratory_rate: float,
    rr_confidence: str,
    mode: str,
) -> int:
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

    rr = float(respiratory_rate or 0.0)
    if rr <= 0:
        rr_points = 0.0
    elif rr >= 25:
        rr_points = 28.0
    elif rr >= 21:
        rr_points = 20.0
    elif rr >= 17:
        rr_points = 12.0
    else:
        rr_points = 4.0

    if mode == "focus" and rr_confidence == "full":
        hr_weight, rr_weight, emotion_weight = 0.35, 0.30, 0.35
    elif mode == "focus" and rr_confidence == "partial":
        hr_weight, rr_weight, emotion_weight = 0.40, 0.15, 0.45
    else:
        hr_weight, rr_weight, emotion_weight = 0.50, 0.00, 0.50

    weighted = hr_points * hr_weight + rr_points * rr_weight + emotion_points * emotion_weight
    return int(max(0, min(100, round(weighted))))


def _sync_baseline_state(conn: sqlite3.Connection, result: dict) -> tuple[float, float, bool]:
    posture_score = float(result["posture_score"])
    ear_offset = float(result.get("ear_shoulder_offset", 0.0))
    neck_angle = float(result.get("neck_spine_angle", 0.0))
    heart_rate_bpm = result.get("heart_rate_bpm")
    respiratory_rate = float(result.get("respiratory_rate", 0.0))
    rr_confidence = str(result.get("rr_confidence", "none"))
    mode = str(result.get("mode", "passive"))

    stress = _stress_index(
        dominant_emotion=str(result.get("dominant_emotion", "unknown")),
        emotion_score=float(result.get("emotion_score", 0.0)),
        heart_rate_bpm=None if heart_rate_bpm is None else float(heart_rate_bpm),
        respiratory_rate=respiratory_rate,
        rr_confidence=rr_confidence,
        mode=mode,
    )
    calm_for_resting = stress <= 35

    baseline_row = conn.execute(
        """
        SELECT
          resting_hr,
          resting_rr,
          ear_shoulder_offset,
          neck_spine_angle,
          posture_baseline_score,
          calibration_sessions_completed,
          is_calibrated
        FROM baseline
        WHERE id = 1
        """
    ).fetchone()
    resting_hr = float(baseline_row[0]) if baseline_row and baseline_row[0] is not None else None
    resting_rr = float(baseline_row[1]) if baseline_row and baseline_row[1] is not None else None
    baseline_ear = float(baseline_row[2]) if baseline_row and baseline_row[2] is not None else None
    baseline_neck = float(baseline_row[3]) if baseline_row and baseline_row[3] is not None else None
    baseline_score = float(baseline_row[4]) if baseline_row and baseline_row[4] is not None else None
    sessions_completed = int(baseline_row[5]) if baseline_row else 0
    is_calibrated = bool(baseline_row[6]) if baseline_row else False

    if not is_calibrated:
        new_completed = min(3, sessions_completed + 1)
        if baseline_score is None:
            new_baseline = float(posture_score)
        else:
            new_baseline = ((baseline_score * sessions_completed) + float(posture_score)) / max(
                1, new_completed
            )
        new_calibrated = new_completed >= 3
        conn.execute(
            """
            UPDATE baseline
            SET
              updated_at = CURRENT_TIMESTAMP,
              resting_hr = ?,
              resting_rr = ?,
              ear_shoulder_offset = ?,
              neck_spine_angle = ?,
              posture_baseline_score = ?,
              calibration_sessions_completed = ?,
              is_calibrated = ?
            WHERE id = 1
            """,
            (
                resting_hr,
                resting_rr,
                float(ear_offset) if baseline_ear is None else ((baseline_ear * sessions_completed) + ear_offset) / max(1, new_completed),
                float(neck_angle) if baseline_neck is None else ((baseline_neck * sessions_completed) + neck_angle) / max(1, new_completed),
                float(new_baseline),
                int(new_completed),
                1 if new_calibrated else 0,
            ),
        )
        return float(new_baseline), 0.0, False

    if baseline_score is None or baseline_score <= 0:
        baseline_score = float(posture_score)

    posture_deviation = max(0.0, (baseline_score - float(posture_score)) / baseline_score)
    drift_alpha = 0.02
    drifted_baseline = (baseline_score * (1.0 - drift_alpha)) + (float(posture_score) * drift_alpha)
    drifted_ear = (
        float(ear_offset)
        if baseline_ear is None
        else (baseline_ear * (1.0 - drift_alpha)) + (float(ear_offset) * drift_alpha)
    )
    drifted_neck = (
        float(neck_angle)
        if baseline_neck is None
        else (baseline_neck * (1.0 - drift_alpha)) + (float(neck_angle) * drift_alpha)
    )

    if heart_rate_bpm is not None and calm_for_resting:
        hr_alpha = 0.10
        hr_value = float(heart_rate_bpm)
        resting_hr = hr_value if resting_hr is None else (resting_hr * (1.0 - hr_alpha)) + (hr_value * hr_alpha)

    if mode == "focus" and rr_confidence in {"partial", "full"} and respiratory_rate > 0 and calm_for_resting:
        rr_alpha = 0.10 if rr_confidence == "full" else 0.05
        rr_value = float(respiratory_rate)
        resting_rr = rr_value if resting_rr is None else (resting_rr * (1.0 - rr_alpha)) + (rr_value * rr_alpha)

    conn.execute(
        """
        UPDATE baseline
        SET
          updated_at = CURRENT_TIMESTAMP,
          resting_hr = ?,
          resting_rr = ?,
          ear_shoulder_offset = ?,
          neck_spine_angle = ?,
          posture_baseline_score = ?
        WHERE id = 1
        """,
        (
            None if resting_hr is None else float(resting_hr),
            None if resting_rr is None else float(resting_rr),
            float(drifted_ear),
            float(drifted_neck),
            float(drifted_baseline),
        ),
    )
    return float(baseline_score), float(posture_deviation), True


def log_session(result: dict, db_path: Path) -> int:
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        posture_score = float(result["posture_score"])
        baseline_score, posture_deviation, is_calibrated = _sync_baseline_state(conn, result)
        posture_is_poor = 1 if is_calibrated and posture_deviation > 0.15 else 0

        result["baseline_posture_score"] = baseline_score
        result["posture_deviation"] = posture_deviation
        result["posture_is_poor"] = bool(posture_is_poor)

        cursor = conn.execute(
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
                focus_mode,
                notification_sent,
                notification_dismissed_by,
                session_duration_seconds,
                raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result["timestamp"],
                1 if result["presence_detected"] else 0,
                1 if result.get("analysis_skipped") else 0,
                posture_score,
                baseline_score,
                posture_deviation,
                posture_is_poor,
                str(result["dominant_emotion"]),
                float(result["emotion_score"]),
                None if result["heart_rate_bpm"] is None else float(result["heart_rate_bpm"]),
                float(result.get("respiratory_rate", 0.0)),
                str(result.get("rr_confidence", "none")),
                str(result["emotion_backend"]),
                str(result.get("mode", "passive")),
                int(result.get("focus_duration_seconds", 0)),
                1 if result.get("focus_mode") else 0,
                "none",
                "none",
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
        focus_mode=bool(args.focus_mode),
        shared_camera=not bool(args.focus_mode),
        passive_duration_seconds=30.0,
        hsemotion_model=args.hsemotion_model,
        hsemotion_model_path=args.hsemotion_model_path,
    )
    result["focus_mode"] = bool(args.focus_mode)

    db_path = Path(args.db_path).expanduser().resolve()
    row_id = None
    if not result.get("analysis_skipped"):
        row_id = log_session(result, db_path)

    output = {
        "inserted_id": row_id,
        "db_path": str(db_path),
        "logged_at": datetime.now().isoformat(timespec="seconds"),
        "skipped": bool(result.get("analysis_skipped")),
        "session": result,
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()
