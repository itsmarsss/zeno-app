from __future__ import annotations

import argparse
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


def _show_preview(cap: cv2.VideoCapture, seconds: float) -> None:
    if seconds <= 0:
        return

    window_name = "Zeno Posture Preview"
    cv2.namedWindow(window_name, cv2.WINDOW_AUTOSIZE)
    end_ticks = cv2.getTickCount() + int(seconds * cv2.getTickFrequency())
    try:
        while cv2.getTickCount() < end_ticks:
            ok, preview_frame = cap.read()
            if not ok:
                break
            cv2.imshow(window_name, preview_frame)
            if cv2.waitKey(1) & 0xFF == ord("q"):
                break
    finally:
        cv2.destroyWindow(window_name)


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

    # Nose should sit above shoulder midpoint in a neutral seated posture.
    vertical_head_offset = shoulder_mid_y - nose.y
    head_upright = _clamp(vertical_head_offset / (shoulder_width * 1.2))

    # Shoulder tilt indicates uneven posture; lower tilt means better alignment.
    shoulder_tilt = abs(left_shoulder.y - right_shoulder.y) / shoulder_width
    shoulder_alignment = 1.0 - _clamp(shoulder_tilt / 0.35)

    score = 0.7 * head_upright + 0.3 * shoulder_alignment
    return round(_clamp(score), 3)


def analyze_posture(
    camera_index: int = 0,
    min_pose_presence_confidence: float = 0.5,
    warmup_seconds: float = 0.6,
    preview_seconds: float = 0.0,
) -> float:
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        return 0.0

    try:
        _show_preview(cap, preview_seconds)
        if warmup_seconds > 0:
            end_ticks = cv2.getTickCount() + int(warmup_seconds * cv2.getTickFrequency())
            while cv2.getTickCount() < end_ticks:
                cap.read()

        ok, frame = cap.read()
        if not ok:
            return 0.0

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision

        options = vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(_ensure_pose_model())),
            running_mode=vision.RunningMode.IMAGE,
            min_pose_presence_confidence=min_pose_presence_confidence,
            num_poses=1,
        )

        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        with vision.PoseLandmarker.create_from_options(options) as landmarker:
            result = landmarker.detect(mp_image)

        if not result.pose_landmarks:
            return 0.0

        return _posture_score_from_landmarks(result.pose_landmarks[0])
    finally:
        cap.release()


def main() -> None:
    parser = argparse.ArgumentParser(description="One-shot posture score analyzer.")
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Show a 1-second camera preview before analysis.",
    )
    args = parser.parse_args()

    posture_score = analyze_posture(preview_seconds=1.0 if args.preview else 0.0)
    timestamp = datetime.now().isoformat(timespec="seconds")
    print(f"[{timestamp}] posture_score={posture_score:.3f}")


if __name__ == "__main__":
    main()
