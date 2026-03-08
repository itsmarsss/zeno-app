from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from datetime import datetime
from pathlib import Path
from urllib.request import urlretrieve

import cv2
import mediapipe as mp

POSE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
)
POSE_MODEL_PATH = Path(__file__).resolve().parent / "models" / "pose_landmarker_lite.task"

NOSE = 0
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12


def _ensure_pose_model() -> Path:
    if POSE_MODEL_PATH.exists():
        return POSE_MODEL_PATH

    POSE_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    urlretrieve(POSE_MODEL_URL, POSE_MODEL_PATH)
    return POSE_MODEL_PATH


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(value, high))


def _posture_score_from_landmarks(landmarks) -> float:
    nose = landmarks[NOSE]
    left_shoulder = landmarks[LEFT_SHOULDER]
    right_shoulder = landmarks[RIGHT_SHOULDER]

    shoulder_width = abs(left_shoulder.x - right_shoulder.x)
    if shoulder_width < 1e-6:
        return 0.0

    shoulder_mid_y = (left_shoulder.y + right_shoulder.y) / 2.0
    vertical_head_offset = shoulder_mid_y - nose.y
    head_upright = _clamp(vertical_head_offset / (shoulder_width * 1.2))

    shoulder_tilt = abs(left_shoulder.y - right_shoulder.y) / shoulder_width
    shoulder_alignment = 1.0 - _clamp(shoulder_tilt / 0.35)

    score = 0.7 * head_upright + 0.3 * shoulder_alignment
    return round(_clamp(score), 3)


def _point_payload(landmark) -> dict[str, float]:
    return {
        "x": round(float(landmark.x), 5),
        "y": round(float(landmark.y), 5),
        "visibility": round(float(getattr(landmark, "visibility", 0.0)), 5),
    }


def _exercise_feedback(exercise_id: str | None, landmarks, posture_score: float) -> str | None:
    if not exercise_id or landmarks is None:
        return None

    nose = landmarks[NOSE]
    left_shoulder = landmarks[LEFT_SHOULDER]
    right_shoulder = landmarks[RIGHT_SHOULDER]
    shoulder_width = abs(left_shoulder.x - right_shoulder.x)
    shoulder_tilt = abs(left_shoulder.y - right_shoulder.y) / max(shoulder_width, 1e-6)
    shoulder_mid_y = (left_shoulder.y + right_shoulder.y) / 2.0
    head_offset = shoulder_mid_y - nose.y

    if posture_score < 0.45:
        return "Lift your chest and stack head over shoulders."

    if exercise_id in {"chin-tuck", "scap-squeeze", "thoracic-extension"}:
        if head_offset < shoulder_width * 0.25:
            return "Gently draw the chin back."
    if exercise_id in {"wall-angels", "doorway-pec-stretch"}:
        if shoulder_tilt > 0.18:
            return "Level your shoulders before next rep."
    if exercise_id == "seated-side-bend":
        if shoulder_tilt < 0.08:
            return "Lean slightly more to find a side stretch."

    return "Good form. Keep breathing steadily."


def _exercise_target_active(exercise_id: str, landmarks) -> bool:
    nose = landmarks[NOSE]
    left_shoulder = landmarks[LEFT_SHOULDER]
    right_shoulder = landmarks[RIGHT_SHOULDER]
    shoulder_width = abs(left_shoulder.x - right_shoulder.x)
    shoulder_mid_y = (left_shoulder.y + right_shoulder.y) / 2.0
    head_offset = shoulder_mid_y - nose.y
    shoulder_tilt = abs(left_shoulder.y - right_shoulder.y) / max(shoulder_width, 1e-6)

    if exercise_id == "chin-tuck":
        return head_offset > shoulder_width * 0.28
    if exercise_id == "scap-squeeze":
        return shoulder_tilt < 0.1 and head_offset > shoulder_width * 0.24
    if exercise_id == "thoracic-extension":
        return head_offset > shoulder_width * 0.31
    if exercise_id == "wall-angels":
        return shoulder_tilt < 0.12
    if exercise_id == "doorway-pec-stretch":
        return shoulder_tilt < 0.16
    if exercise_id == "seated-side-bend":
        return shoulder_tilt > 0.1
    return False


def _exercise_target_reps(exercise_id: str) -> int:
    if exercise_id in {"wall-angels", "thoracic-extension"}:
        return 8
    if exercise_id == "doorway-pec-stretch":
        return 6
    return 10


def run_stream(camera_index: int, fps: float, jpeg_quality: int, exercise_id: str | None) -> int:
    fps = max(1.0, min(30.0, fps))
    quality = max(40, min(95, jpeg_quality))
    frame_interval = 1.0 / fps

    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        print(json.dumps({"error": "Unable to open camera"}), flush=True)
        return 1

    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(_ensure_pose_model())),
        running_mode=vision.RunningMode.VIDEO,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        num_poses=1,
    )
    exercise_state = {
        "rep_count": 0,
        "hold_seconds": 0.0,
        "active_prev": False,
        "quality_ema": 0.0,
        "last_tick": time.perf_counter(),
    }

    try:
        with vision.PoseLandmarker.create_from_options(options) as landmarker:
            while True:
                tick = time.perf_counter()
                ok, frame = cap.read()
                if not ok:
                    break

                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
                timestamp_ms = int(time.time() * 1000)
                result = landmarker.detect_for_video(mp_image, timestamp_ms)

                landmarks_payload = None
                posture_score = 0.0
                feedback = None
                exercise_metrics = None
                if result.pose_landmarks:
                    landmarks = result.pose_landmarks[0]
                    landmarks_payload = {
                        "nose": _point_payload(landmarks[NOSE]),
                        "left_shoulder": _point_payload(landmarks[LEFT_SHOULDER]),
                        "right_shoulder": _point_payload(landmarks[RIGHT_SHOULDER]),
                    }
                    posture_score = _posture_score_from_landmarks(landmarks)
                    feedback = _exercise_feedback(exercise_id, landmarks, posture_score)
                    if exercise_id:
                        now_tick = time.perf_counter()
                        elapsed = max(0.0, now_tick - float(exercise_state["last_tick"]))
                        exercise_state["last_tick"] = now_tick

                        active_now = _exercise_target_active(exercise_id, landmarks)
                        if active_now and not exercise_state["active_prev"]:
                            exercise_state["rep_count"] = int(exercise_state["rep_count"]) + 1
                        if active_now:
                            exercise_state["hold_seconds"] = float(exercise_state["hold_seconds"]) + elapsed
                        exercise_state["active_prev"] = active_now

                        previous_q = float(exercise_state["quality_ema"])
                        exercise_state["quality_ema"] = (
                            posture_score if previous_q <= 0 else previous_q * 0.9 + posture_score * 0.1
                        )
                        target_reps = _exercise_target_reps(exercise_id)
                        rep_count = int(exercise_state["rep_count"])
                        hold_seconds = round(float(exercise_state["hold_seconds"]), 1)
                        progress_pct = min(100, int((rep_count / max(1, target_reps)) * 100))
                        exercise_metrics = {
                            "rep_count": rep_count,
                            "target_reps": target_reps,
                            "hold_seconds": hold_seconds,
                            "quality_score": round(float(exercise_state["quality_ema"]), 3),
                            "target_active": active_now,
                            "progress_pct": progress_pct,
                        }
                elif exercise_id:
                    exercise_state["active_prev"] = False

                ok, encoded = cv2.imencode(
                    ".jpg",
                    frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), quality],
                )
                if not ok:
                    continue

                payload = {
                    "timestamp": datetime.now().isoformat(timespec="seconds"),
                    "frame_jpeg_b64": base64.b64encode(encoded).decode("ascii"),
                    "landmarks": landmarks_payload,
                    "posture_score": posture_score,
                    "exercise_feedback": feedback,
                    "exercise_metrics": exercise_metrics,
                }
                print(json.dumps(payload), flush=True)

                sleep_time = frame_interval - (time.perf_counter() - tick)
                if sleep_time > 0:
                    time.sleep(sleep_time)
    except KeyboardInterrupt:
        pass
    finally:
        cap.release()

    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Continuous posture stream (JSON lines).")
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument("--fps", type=float, default=8.0)
    parser.add_argument("--jpeg-quality", type=int, default=72)
    parser.add_argument("--exercise-id", type=str, default=None)
    args = parser.parse_args()

    code = run_stream(
        camera_index=args.camera_index,
        fps=args.fps,
        jpeg_quality=args.jpeg_quality,
        exercise_id=args.exercise_id,
    )
    sys.exit(code)


if __name__ == "__main__":
    main()
