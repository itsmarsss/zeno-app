from __future__ import annotations

import argparse
import json
from datetime import datetime

from emotion_analyzer_fer import analyze_emotion as analyze_emotion_fer
from emotion_analyzer_hsemotion import analyze_emotion as analyze_emotion_hsemotion
from posture_analyzer import analyze_posture
from presence_detector import detect_presence
from rppg_estimator import estimate_heart_rate


def run_session(
    emotion_backend: str = "hsemotion",
    preview: bool = False,
    hsemotion_model: str = "enet_b0_8_best_afew",
    hsemotion_model_path: str | None = None,
) -> dict:
    started_at = datetime.now()

    presence_detected = detect_presence(preview_seconds=1.0 if preview else 0.0)
    posture_score = analyze_posture(preview_seconds=1.0 if preview else 0.0)

    if emotion_backend == "fer":
        dominant_emotion, emotion_score = analyze_emotion_fer(
            preview_seconds=1.0 if preview else 0.0
        )
    else:
        dominant_emotion, emotion_score = analyze_emotion_hsemotion(
            preview_seconds=1.0 if preview else 0.0,
            model_name=hsemotion_model,
            model_path=hsemotion_model_path,
        )

    heart_rate_bpm = estimate_heart_rate(preview=preview, capture_seconds=30.0)

    completed_at = datetime.now()
    duration_seconds = round((completed_at - started_at).total_seconds(), 2)

    return {
        "timestamp": completed_at.isoformat(timespec="seconds"),
        "presence_detected": bool(presence_detected),
        "posture_score": float(posture_score),
        "dominant_emotion": dominant_emotion,
        "emotion_score": round(float(emotion_score), 3),
        "heart_rate_bpm": None if heart_rate_bpm <= 0 else round(float(heart_rate_bpm), 1),
        "emotion_backend": emotion_backend,
        "session_duration_seconds": duration_seconds,
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run one full Zeno session (presence, posture, emotion, rPPG)."
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
        help="Emotion analyzer backend (default: hsemotion).",
    )
    parser.add_argument(
        "--hsemotion-model",
        default="enet_b0_8_best_afew",
        help="HSEmotion model name (used when --emotion-backend=hsemotion).",
    )
    parser.add_argument(
        "--hsemotion-model-path",
        default=None,
        help="Local HSEmotion .pt path (used when --emotion-backend=hsemotion).",
    )
    args = parser.parse_args()

    result = run_session(
        emotion_backend=args.emotion_backend,
        preview=args.preview,
        hsemotion_model=args.hsemotion_model,
        hsemotion_model_path=args.hsemotion_model_path,
    )
    print(json.dumps(result))


if __name__ == "__main__":
    main()
