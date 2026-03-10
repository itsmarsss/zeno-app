from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema
from zeno_backend.pipelines.session_runner import run_session

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


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


def _sync_baseline_state(conn: sqlite3.Connection, result: dict) -> tuple[float, float, bool, float | None, float | None]:
    posture_score = float(result["posture_score"])
    ear_offset = float(result.get("ear_shoulder_offset", 0.0))
    neck_angle = float(result.get("neck_spine_angle", 0.0))
    heart_rate_bpm = result.get("heart_rate_bpm")
    respiratory_rate = float(result.get("respiratory_rate", 0.0))
    rr_confidence = str(result.get("rr_confidence", "none"))
    mode = str(result.get("mode", "passive"))

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

    stress = _stress_index(
        dominant_emotion=str(result.get("dominant_emotion", "unknown")),
        emotion_score=float(result.get("emotion_score", 0.0)),
        heart_rate_bpm=None if heart_rate_bpm is None else float(heart_rate_bpm),
        respiratory_rate=respiratory_rate,
        rr_confidence=rr_confidence,
        mode=mode,
        resting_hr=75.0 if resting_hr is None else float(resting_hr),
        resting_rr=14.0 if resting_rr is None else float(resting_rr),
    )
    calm_for_resting = stress <= 35

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
        return float(new_baseline), 0.0, False, resting_hr, resting_rr

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
    return float(baseline_score), float(posture_deviation), True, resting_hr, resting_rr


def _posture_quality_flags(
    *,
    posture_score: float,
    baseline_posture_score: float,
    current_ear: float,
    baseline_ear: float | None,
    current_neck: float,
    baseline_neck: float | None,
    calibrated: bool,
) -> tuple[float, float, float, bool]:
    posture_deviation = (
        max(0.0, (baseline_posture_score - posture_score) / baseline_posture_score)
        if baseline_posture_score > 0
        else 0.0
    )
    ear_deviation = 0.0
    neck_deviation = 0.0
    if baseline_ear is not None:
        ear_deviation = max(0.0, (baseline_ear - current_ear) / max(abs(baseline_ear), 0.02))
    if baseline_neck is not None:
        neck_deviation = max(0.0, (baseline_neck - current_neck) / max(abs(baseline_neck), 1.0))

    combined = (0.40 * posture_deviation) + (0.25 * ear_deviation) + (0.35 * neck_deviation)
    posture_is_poor = calibrated and combined > 0.15
    return posture_deviation, ear_deviation, neck_deviation, posture_is_poor


def log_session(result: dict, db_path: Path) -> int:
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        posture_score = float(result["posture_score"])
        baseline_score, posture_deviation, is_calibrated, resting_hr, resting_rr = _sync_baseline_state(conn, result)
        baseline_geom = conn.execute(
            """
            SELECT ear_shoulder_offset, neck_spine_angle
            FROM baseline
            WHERE id = 1
            """
        ).fetchone()
        baseline_ear = float(baseline_geom[0]) if baseline_geom and baseline_geom[0] is not None else None
        baseline_neck = float(baseline_geom[1]) if baseline_geom and baseline_geom[1] is not None else None
        posture_deviation, ear_deviation, neck_deviation, posture_is_poor = _posture_quality_flags(
            posture_score=posture_score,
            baseline_posture_score=baseline_score,
            current_ear=float(result.get("ear_shoulder_offset", 0.0)),
            baseline_ear=baseline_ear,
            current_neck=float(result.get("neck_spine_angle", 0.0)),
            baseline_neck=baseline_neck,
            calibrated=is_calibrated,
        )

        result["baseline_posture_score"] = baseline_score
        result["posture_deviation"] = posture_deviation
        result["ear_shoulder_deviation"] = round(float(ear_deviation), 4)
        result["neck_spine_deviation"] = round(float(neck_deviation), 4)
        result["posture_is_poor"] = bool(posture_is_poor)
        result["resting_hr"] = None if resting_hr is None else round(float(resting_hr), 1)
        result["resting_rr"] = None if resting_rr is None else round(float(resting_rr), 1)

        cursor = conn.execute(
            """
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
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result["timestamp"],
                1 if result["presence_detected"] else 0,
                1 if result.get("analysis_skipped") else 0,
                posture_score,
                float(result.get("tracking_confidence", 0.0)),
                float(result.get("head_offset_norm", 0.0)),
                float(result.get("shoulder_tilt_signed_norm", 0.0)),
                float(result.get("shoulder_tilt_norm", 0.0)),
                float(result.get("posture_stability_std", 0.0)),
                str(result.get("posture_stability_label", "learning")),
                baseline_score,
                posture_deviation,
                1 if posture_is_poor else 0,
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
