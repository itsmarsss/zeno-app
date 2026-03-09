from __future__ import annotations

import argparse
import json
import time
from datetime import datetime

from camera_manager import CameraManager
from posture_analyzer import PostureAnalyzer
from presence_detector import PresenceDetector
from stress_analyzer import StressAnalyzer


def run_passive_checkin(duration_seconds: float = 30.0) -> dict:
    duration_seconds = max(3.0, float(duration_seconds))
    manager = CameraManager()
    presence = PresenceDetector()
    posture = PostureAnalyzer()
    stress = StressAnalyzer(hr_window_seconds=min(20.0, duration_seconds))
    started = time.perf_counter()
    started_at = datetime.now()

    try:
        presence.start_live(manager)
        posture.start_live(manager)
        stress.start_live(manager)
        time.sleep(duration_seconds)
    except RuntimeError:
        return {
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "presence_detected": False,
            "analysis_skipped": True,
            "posture_score": 0.0,
            "baseline_posture_score": 0.0,
            "posture_deviation": 0.0,
            "posture_is_poor": False,
            "dominant_emotion": "unknown",
            "emotion_score": 0.0,
            "heart_rate_bpm": None,
            "respiratory_rate": 0.0,
            "rr_confidence": "none",
            "emotion_backend": "fer",
            "mode": "passive",
            "focus_duration_seconds": 0,
            "session_duration_seconds": round(time.perf_counter() - started, 2),
            "capture_window_seconds": duration_seconds,
            "started_at": started_at.isoformat(timespec="seconds"),
        }
    finally:
        stress.stop_live(manager)
        posture.stop_live(manager)
        presence.stop_live(manager)
        manager.stop()

    duration = round(time.perf_counter() - started, 2)
    presence_detected = bool(presence.latest_result())
    stress_result = stress.latest_result()
    if not presence_detected:
        return {
            "timestamp": datetime.now().isoformat(timespec="seconds"),
            "presence_detected": False,
            "analysis_skipped": True,
            "posture_score": 0.0,
            "baseline_posture_score": 0.0,
            "posture_deviation": 0.0,
            "posture_is_poor": False,
        "dominant_emotion": "unknown",
        "emotion_score": 0.0,
        "heart_rate_bpm": None,
        "respiratory_rate": 0.0,
        "rr_confidence": "none",
        "emotion_backend": "fer",
        "mode": "passive",
        "focus_duration_seconds": 0,
        "session_duration_seconds": duration,
        "capture_window_seconds": duration_seconds,
        "started_at": started_at.isoformat(timespec="seconds"),
        }
    return {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "presence_detected": presence_detected,
        "analysis_skipped": False,
        "posture_score": float(posture.latest_score()),
        "baseline_posture_score": 0.0,
        "posture_deviation": 0.0,
        "posture_is_poor": False,
        "dominant_emotion": str(stress_result.get("dominant_emotion", "unknown")),
        "emotion_score": float(stress_result.get("emotion_score", 0.0)),
        "heart_rate_bpm": stress_result.get("heart_rate_bpm"),
        "respiratory_rate": 0.0,
        "rr_confidence": "none",
        "emotion_backend": "fer",
        "mode": "passive",
        "focus_duration_seconds": 0,
        "session_duration_seconds": duration,
        "capture_window_seconds": duration_seconds,
        "started_at": started_at.isoformat(timespec="seconds"),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run passive check-in on shared camera manager.")
    parser.add_argument("--duration-seconds", type=float, default=30.0)
    args = parser.parse_args()

    result = run_passive_checkin(duration_seconds=args.duration_seconds)
    print(json.dumps(result))


if __name__ == "__main__":
    main()
