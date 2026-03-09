from __future__ import annotations

import argparse
import json
import time
from datetime import datetime

from camera_manager import CameraManager
from posture_analyzer import PostureAnalyzer
from presence_detector import PresenceDetector
from respiratory_analyzer import RespiratoryAnalyzer
from stress_analyzer import StressAnalyzer


def stream_focus_updates(
    update_every_seconds: float = 5.0,
    max_seconds: float = 0.0,
) -> None:
    update_every_seconds = max(1.0, float(update_every_seconds))
    max_seconds = max(0.0, float(max_seconds))

    manager = CameraManager()
    presence = PresenceDetector()
    posture = PostureAnalyzer()
    stress = StressAnalyzer(hr_window_seconds=20.0)
    respiratory = RespiratoryAnalyzer(window_seconds=90.0)

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
    args = parser.parse_args()

    stream_focus_updates(update_every_seconds=args.update_every, max_seconds=args.max_seconds)


if __name__ == "__main__":
    main()
