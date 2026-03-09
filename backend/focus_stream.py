from __future__ import annotations

import argparse
import json
import sqlite3
import time
from datetime import datetime
from pathlib import Path

from camera_manager import CameraManager
from db_schema import ensure_sessions_schema
from posture_analyzer import PostureAnalyzer
from presence_detector import PresenceDetector
from respiratory_analyzer import RespiratoryAnalyzer
from stress_analyzer import StressAnalyzer

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "zeno_sessions.db"


def _stress_index(
    dominant_emotion: str,
    emotion_score: float,
    heart_rate_bpm: float | None,
    respiratory_rate: float,
    rr_confidence: str,
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

    if rr_confidence == "full":
        hr_weight, rr_weight, emotion_weight = 0.35, 0.30, 0.35
    elif rr_confidence == "partial":
        hr_weight, rr_weight, emotion_weight = 0.40, 0.15, 0.45
    else:
        hr_weight, rr_weight, emotion_weight = 0.50, 0.00, 0.50

    weighted = hr_points * hr_weight + rr_points * rr_weight + emotion_points * emotion_weight
    return int(max(0, min(100, round(weighted))))


def stream_focus_updates(
    update_every_seconds: float = 5.0,
    max_seconds: float = 0.0,
    db_path: Path = DEFAULT_DB_PATH,
) -> None:
    update_every_seconds = max(1.0, float(update_every_seconds))
    max_seconds = max(0.0, float(max_seconds))

    manager = CameraManager()
    presence = PresenceDetector()
    posture = PostureAnalyzer()
    stress = StressAnalyzer(hr_window_seconds=20.0)
    respiratory = RespiratoryAnalyzer(window_seconds=90.0)
    smoothed_stress: float | None = None
    smoothing_alpha = 0.3
    baseline_posture_score: float | None = None
    baseline_calibrated = False

    try:
        with sqlite3.connect(db_path) as conn:
            ensure_sessions_schema(conn)
            row = conn.execute(
                """
                SELECT posture_baseline_score, is_calibrated
                FROM baseline
                WHERE id = 1
                """
            ).fetchone()
            if row:
                baseline_posture_score = (
                    float(row[0]) if row[0] is not None and float(row[0]) > 0 else None
                )
                baseline_calibrated = bool(row[1])
    except Exception:
        baseline_posture_score = None
        baseline_calibrated = False

    started = time.perf_counter()
    next_emit = started + update_every_seconds
    try:
        try:
            presence.start_live(manager)
            posture.start_live(manager)
            stress.start_live(manager)
            respiratory.start_live(manager)
        except RuntimeError:
            payload = {
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "elapsed_seconds": 0.0,
                "presence_detected": False,
                "posture_score": 0.0,
                "heart_rate_bpm": None,
                "dominant_emotion": "unknown",
                "emotion_score": 0.0,
                "respiratory_rate": 0.0,
                "rr_confidence": "none",
                "mode": "focus",
                "analysis_skipped": True,
            }
            print(json.dumps(payload), flush=True)
            return

        while True:
            now = time.perf_counter()
            elapsed = now - started
            if max_seconds > 0 and elapsed >= max_seconds:
                break

            if now < next_emit:
                time.sleep(0.05)
                continue
            next_emit += update_every_seconds

            payload = {
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "elapsed_seconds": round(elapsed, 1),
                "presence_detected": bool(presence.latest_result()),
                "posture_score": float(posture.latest_score()),
                "heart_rate_bpm": stress.latest_result().get("heart_rate_bpm"),
                "dominant_emotion": stress.latest_result().get("dominant_emotion", "unknown"),
                "emotion_score": float(stress.latest_result().get("emotion_score", 0.0)),
                "respiratory_rate": respiratory.latest_result().get("respiratory_rate_bpm") or 0.0,
                "rr_confidence": respiratory.latest_result().get("rr_confidence", "none"),
                "mode": "focus",
            }
            posture_score = float(payload["posture_score"])
            if baseline_calibrated and baseline_posture_score and baseline_posture_score > 0:
                posture_deviation = max(0.0, (baseline_posture_score - posture_score) / baseline_posture_score)
                posture_is_poor = posture_deviation > 0.15
                payload["baseline_posture_score"] = round(float(baseline_posture_score), 3)
                payload["posture_deviation"] = round(float(posture_deviation), 4)
                payload["posture_is_poor"] = bool(posture_is_poor)
            else:
                payload["baseline_posture_score"] = 0.0
                payload["posture_deviation"] = 0.0
                payload["posture_is_poor"] = posture_score < 0.45

            stress_score = _stress_index(
                dominant_emotion=str(payload["dominant_emotion"]),
                emotion_score=float(payload["emotion_score"]),
                heart_rate_bpm=payload["heart_rate_bpm"],
                respiratory_rate=float(payload["respiratory_rate"]),
                rr_confidence=str(payload["rr_confidence"]),
            )
            if smoothed_stress is None:
                smoothed_stress = float(stress_score)
            else:
                smoothed_stress = (smoothing_alpha * float(stress_score)) + (
                    (1.0 - smoothing_alpha) * smoothed_stress
                )
            payload["stress_index"] = int(stress_score)
            payload["stress_index_smoothed"] = int(round(smoothed_stress))
            print(json.dumps(payload), flush=True)
    finally:
        respiratory.stop_live(manager)
        stress.stop_live(manager)
        posture.stop_live(manager)
        presence.stop_live(manager)
        manager.stop()


def main() -> None:
    parser = argparse.ArgumentParser(description="Shared-camera focus mode stream.")
    parser.add_argument("--update-every", type=float, default=5.0)
    parser.add_argument("--max-seconds", type=float, default=0.0)
    parser.add_argument("--db-path", type=str, default=str(DEFAULT_DB_PATH))
    args = parser.parse_args()

    stream_focus_updates(
        update_every_seconds=args.update_every,
        max_seconds=args.max_seconds,
        db_path=Path(args.db_path).expanduser().resolve(),
    )


if __name__ == "__main__":
    main()
