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
                if result.pose_landmarks:
                    landmarks = result.pose_landmarks[0]
                    landmarks_payload = {
                        "nose": _point_payload(landmarks[NOSE]),
                        "left_shoulder": _point_payload(landmarks[LEFT_SHOULDER]),
                        "right_shoulder": _point_payload(landmarks[RIGHT_SHOULDER]),
                    }
                    posture_score = _posture_score_from_landmarks(landmarks)
                    feedback = _exercise_feedback(exercise_id, landmarks, posture_score)

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
