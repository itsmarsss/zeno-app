from __future__ import annotations

import argparse
import json
import time
from datetime import datetime

from zeno_backend.analyzers.posture_analyzer import PostureAnalyzer
from zeno_backend.analyzers.presence_detector import PresenceDetector
from zeno_backend.analyzers.stress_analyzer import StressAnalyzer
from zeno_backend.core.camera_manager import CameraManager


def _skipped_payload(duration: float, duration_seconds: float, started_at: datetime) -> dict:
    return {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "presence_detected": False,
        "analysis_skipped": True,
        "posture_score": 0.0,
        "baseline_posture_score": 0.0,
        "posture_deviation": 0.0,
        "posture_is_poor": False,
        "ear_shoulder_offset": 0.0,
        "neck_spine_angle": 0.0,
        "tracking_confidence": 0.0,
        "head_offset_norm": 0.0,
        "shoulder_tilt_signed_norm": 0.0,
        "shoulder_tilt_norm": 0.0,
        "posture_stability_std": 0.0,
        "posture_stability_label": "learning",
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


def run_passive_checkin(duration_seconds: float = 18.0) -> dict:
    # Cap total capture — keep check-ins snappy (still enough for rPPG samples).
    duration_seconds = max(3.0, min(float(duration_seconds), 22.0))
    # Fast presence gate: confirm face quickly, then load heavier analyzers.
    presence_gate_seconds = min(1.5, duration_seconds)
    manager = CameraManager()
    presence = PresenceDetector()
    posture: PostureAnalyzer | None = None
    stress: StressAnalyzer | None = None
    started = time.perf_counter()
    started_at = datetime.now()
    presence_confirmed = False

    try:
        # Phase 1: open camera + light face detector only.
        presence.start_live(manager)
        gate_deadline = started + presence_gate_seconds
        while time.perf_counter() < gate_deadline:
            if bool(presence.latest_result()):
                presence_confirmed = True
                break
            time.sleep(0.03)
        if not presence_confirmed:
            duration = round(time.perf_counter() - started, 2)
            return _skipped_payload(duration, duration_seconds, started_at)

        # Phase 2: load posture + stress only after a face is confirmed.
        posture = PostureAnalyzer()
        stress = StressAnalyzer(hr_window_seconds=min(16.0, duration_seconds))
        posture.start_live(manager)
        stress.start_live(manager)
        remaining = max(0.0, duration_seconds - (time.perf_counter() - started))
        if remaining > 0.0:
            time.sleep(remaining)
    except RuntimeError:
        duration = round(time.perf_counter() - started, 2)
        return _skipped_payload(duration, duration_seconds, started_at)
    finally:
        if stress is not None:
            stress.stop_live(manager)
        if posture is not None:
            posture.stop_live(manager)
            posture.close()
        presence.stop_live(manager)
        presence.close()
        manager.stop()

    duration = round(time.perf_counter() - started, 2)
    presence_detected = bool(presence.latest_result()) or presence_confirmed
    if not presence_detected or posture is None or stress is None:
        return _skipped_payload(duration, duration_seconds, started_at)

    posture_metrics = posture.latest_metrics()
    stress_result = stress.latest_result()
    return {
        "timestamp": datetime.now().isoformat(timespec="seconds"),
        "presence_detected": presence_detected,
        "analysis_skipped": False,
        "posture_score": float(posture_metrics.get("posture_score", posture.latest_score())),
        "baseline_posture_score": 0.0,
        "posture_deviation": 0.0,
        "posture_is_poor": False,
        "ear_shoulder_offset": float(posture_metrics.get("ear_shoulder_offset", 0.0)),
        "neck_spine_angle": float(posture_metrics.get("neck_spine_angle", 0.0)),
        "tracking_confidence": float(posture_metrics.get("tracking_confidence", 0.0)),
        "head_offset_norm": float(posture_metrics.get("head_offset_norm", 0.0)),
        "shoulder_tilt_signed_norm": float(posture_metrics.get("shoulder_tilt_signed_norm", 0.0)),
        "shoulder_tilt_norm": float(posture_metrics.get("shoulder_tilt_norm", 0.0)),
        "posture_stability_std": float(posture_metrics.get("posture_stability_std", 0.0)),
        "posture_stability_label": str(posture_metrics.get("posture_stability_label", "learning")),
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
