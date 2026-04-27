from __future__ import annotations

import argparse
import json
import sqlite3
import time
from datetime import datetime
from pathlib import Path
from uuid import uuid4

from zeno_backend.data.db_schema import ensure_sessions_schema
from zeno_backend.data.sqlite_logger import log_session
from zeno_backend.analyzers.posture_analyzer import PostureAnalyzer
from zeno_backend.analyzers.presence_detector import PresenceDetector
from zeno_backend.analyzers.respiratory_analyzer import RespiratoryAnalyzer
from zeno_backend.analyzers.stress_analyzer import StressAnalyzer
from zeno_backend.core.camera_manager import CameraManager
from zeno_backend.core.stress_index import compute_stress_index

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


def stream_focus_updates(
    update_every_seconds: float = 5.0,
    max_seconds: float = 0.0,
    capture_seconds: float = 12.0,
    db_path: Path = DEFAULT_DB_PATH,
) -> None:
    update_every_seconds = max(1.0, float(update_every_seconds))
    max_seconds = max(0.0, float(max_seconds))
    capture_seconds = max(6.0, float(capture_seconds))
    capture_seconds = min(capture_seconds, max(6.0, update_every_seconds))

    manager = CameraManager()
    presence = PresenceDetector()
    posture = PostureAnalyzer()
    stress = StressAnalyzer(hr_window_seconds=20.0)
    respiratory = RespiratoryAnalyzer(window_seconds=90.0)
    smoothed_stress: float | None = None
    smoothing_alpha = 0.3
    posture_bad_counter = 0
    baseline_posture_score: float | None = None
    baseline_ear_offset: float | None = None
    baseline_neck_angle: float | None = None
    baseline_calibrated = False
    resting_hr = 75.0
    resting_rr = 14.0

    try:
        with sqlite3.connect(db_path) as conn:
            ensure_sessions_schema(conn)
            row = conn.execute(
                """
                SELECT
                  posture_baseline_score,
                  ear_shoulder_offset,
                  neck_spine_angle,
                  is_calibrated,
                  resting_hr,
                  resting_rr
                FROM baseline
                WHERE id = 1
                """
            ).fetchone()
            if row:
                baseline_posture_score = (
                    float(row[0]) if row[0] is not None and float(row[0]) > 0 else None
                )
                baseline_ear_offset = float(row[1]) if row[1] is not None else None
                baseline_neck_angle = float(row[2]) if row[2] is not None else None
                baseline_calibrated = bool(row[3])
                if row[4] is not None:
                    resting_hr = float(row[4])
                if row[5] is not None:
                    resting_rr = float(row[5])
    except Exception:
        baseline_posture_score = None
        baseline_ear_offset = None
        baseline_neck_angle = None
        baseline_calibrated = False
        resting_hr = 75.0
        resting_rr = 14.0

    started = time.perf_counter()
    focus_session_id = str(uuid4())
    next_emit_at = started + max(2.0, min(capture_seconds, update_every_seconds))
    streams_active = False

    def start_streams() -> bool:
        try:
            # Keep camera + models warm for the whole focus session.
            presence.start_live(manager)
            posture.start_live(manager)
            stress.start_live(manager)
            respiratory.start_live(manager)
            return True
        except RuntimeError:
            return False

    def stop_streams() -> None:
        respiratory.stop_live(manager)
        stress.stop_live(manager)
        posture.stop_live(manager)
        presence.stop_live(manager)
        presence.close()
        posture.close()

    try:
        # Open once at session start — reopening every emit was a major delay.
        streams_active = start_streams()
        if not streams_active:
            payload = {
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "elapsed_seconds": 0.0,
                "presence_detected": False,
                "posture_score": 0.0,
                "ear_shoulder_offset": 0.0,
                "neck_spine_angle": 0.0,
                "tracking_confidence": 0.0,
                "head_offset_norm": 0.0,
                "shoulder_tilt_signed_norm": 0.0,
                "shoulder_tilt_norm": 0.0,
                "posture_stability_std": 0.0,
                "posture_stability_label": "learning",
                "heart_rate_bpm": None,
                "dominant_emotion": "unknown",
                "emotion_score": 0.0,
                "respiratory_rate": 0.0,
                "rr_confidence": "none",
                "resting_hr": resting_hr,
                "resting_rr": resting_rr,
                "mode": "focus",
                "focus_session_id": focus_session_id,
                "analysis_skipped": True,
            }
            print(json.dumps(payload), flush=True)

        while streams_active:
            now = time.perf_counter()
            elapsed = now - started
            if max_seconds > 0 and elapsed >= max_seconds:
                break

            if now < next_emit_at:
                time.sleep(0.05)
                continue

            posture_metrics = posture.latest_metrics()
            stress_result = stress.latest_result()
            rr_result = respiratory.latest_result()
            payload = {
                "timestamp": datetime.now().isoformat(timespec="seconds"),
                "elapsed_seconds": round(elapsed, 1),
                "presence_detected": bool(presence.latest_result()),
                "posture_score": float(posture_metrics.get("posture_score", posture.latest_score())),
                "ear_shoulder_offset": float(posture_metrics.get("ear_shoulder_offset", 0.0)),
                "neck_spine_angle": float(posture_metrics.get("neck_spine_angle", 0.0)),
                "tracking_confidence": float(posture_metrics.get("tracking_confidence", 0.0)),
                "head_offset_norm": float(posture_metrics.get("head_offset_norm", 0.0)),
                "shoulder_tilt_signed_norm": float(posture_metrics.get("shoulder_tilt_signed_norm", 0.0)),
                "shoulder_tilt_norm": float(posture_metrics.get("shoulder_tilt_norm", 0.0)),
                "posture_stability_std": float(posture_metrics.get("posture_stability_std", 0.0)),
                "posture_stability_label": str(posture_metrics.get("posture_stability_label", "learning")),
                "heart_rate_bpm": stress_result.get("heart_rate_bpm"),
                "dominant_emotion": stress_result.get("dominant_emotion", "unknown"),
                "emotion_score": float(stress_result.get("emotion_score", 0.0)),
                "respiratory_rate": rr_result.get("respiratory_rate_bpm") or 0.0,
                "rr_confidence": rr_result.get("rr_confidence", "none"),
                "resting_hr": resting_hr,
                "resting_rr": resting_rr,
                "mode": "focus",
                "focus_session_id": focus_session_id,
            }
            posture_score = float(payload["posture_score"])
            ear_offset = float(payload["ear_shoulder_offset"])
            neck_angle = float(payload["neck_spine_angle"])
            raw_posture_is_poor = False
            if baseline_calibrated and baseline_posture_score and baseline_posture_score > 0:
                posture_deviation = max(0.0, (baseline_posture_score - posture_score) / baseline_posture_score)
                ear_deviation = (
                    max(0.0, (baseline_ear_offset - ear_offset) / max(abs(baseline_ear_offset), 0.02))
                    if baseline_ear_offset is not None
                    else 0.0
                )
                neck_deviation = (
                    max(0.0, (baseline_neck_angle - neck_angle) / max(abs(baseline_neck_angle), 1.0))
                    if baseline_neck_angle is not None
                    else 0.0
                )
                combined = (0.40 * posture_deviation) + (0.25 * ear_deviation) + (0.35 * neck_deviation)
                raw_posture_is_poor = combined > 0.15
                payload["baseline_posture_score"] = round(float(baseline_posture_score), 3)
                payload["posture_deviation"] = round(float(posture_deviation), 4)
                payload["ear_shoulder_deviation"] = round(float(ear_deviation), 4)
                payload["neck_spine_deviation"] = round(float(neck_deviation), 4)
            else:
                payload["baseline_posture_score"] = 0.0
                payload["posture_deviation"] = 0.0
                payload["ear_shoulder_deviation"] = 0.0
                payload["neck_spine_deviation"] = 0.0
                raw_posture_is_poor = posture_score < 0.45

            if raw_posture_is_poor:
                posture_bad_counter += 1
            else:
                posture_bad_counter = max(0, posture_bad_counter - 2)
            payload["posture_bad_counter"] = int(posture_bad_counter)
            payload["posture_is_poor"] = bool(posture_bad_counter >= 3)

            stress_score = compute_stress_index(
                dominant_emotion=str(payload["dominant_emotion"]),
                emotion_score=float(payload["emotion_score"]),
                heart_rate_bpm=payload["heart_rate_bpm"],
                respiratory_rate=float(payload["respiratory_rate"]),
                rr_confidence=str(payload["rr_confidence"]),
                mode="focus",
                resting_hr=resting_hr,
                resting_rr=resting_rr,
            )
            if smoothed_stress is None:
                smoothed_stress = float(stress_score)
            else:
                smoothed_stress = (smoothing_alpha * float(stress_score)) + (
                    (1.0 - smoothing_alpha) * smoothed_stress
                )
            payload["stress_index"] = int(stress_score)
            payload["stress_index_smoothed"] = int(round(smoothed_stress))

            analysis_skipped = not bool(payload.get("presence_detected"))
            payload["analysis_skipped"] = analysis_skipped
            payload["focus_mode"] = True
            payload["emotion_backend"] = "fer"
            payload["focus_duration_seconds"] = int(round(float(payload.get("elapsed_seconds", 0.0))))
            payload["session_duration_seconds"] = float(update_every_seconds)

            row_id = None
            if not analysis_skipped:
                try:
                    row_id = log_session(dict(payload), db_path)
                except Exception as err:
                    print(f"[focus_stream] failed to log session: {err}", flush=True)
                    row_id = None
            payload["session_id"] = row_id
            payload["session_skipped"] = analysis_skipped
            print(json.dumps(payload), flush=True)
            next_emit_at = now + update_every_seconds
    finally:
        if streams_active:
            stop_streams()
        manager.stop()

def main() -> None:
    parser = argparse.ArgumentParser(description="Shared-camera focus mode stream.")
    parser.add_argument("--update-every", type=float, default=5.0)
    parser.add_argument("--max-seconds", type=float, default=0.0)
    parser.add_argument("--capture-seconds", type=float, default=12.0)
    parser.add_argument("--db-path", type=str, default=str(DEFAULT_DB_PATH))
    args = parser.parse_args()

    stream_focus_updates(
        update_every_seconds=args.update_every,
        max_seconds=args.max_seconds,
        capture_seconds=args.capture_seconds,
        db_path=Path(args.db_path).expanduser().resolve(),
    )


if __name__ == "__main__":
    main()
