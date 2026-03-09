from __future__ import annotations

import argparse
import threading
from datetime import datetime
from pathlib import Path
from urllib.request import urlretrieve

import cv2
import mediapipe as mp
import numpy as np

from camera_manager import CameraManager

POSE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
)
POSE_MODEL_PATH = Path(__file__).resolve().parent / "models" / "pose_landmarker_lite.task"

NOSE = 0
LEFT_EAR = 7
RIGHT_EAR = 8
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_HIP = 23
RIGHT_HIP = 24


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


def _calculate_angle_degrees(a: np.ndarray, b: np.ndarray, c: np.ndarray) -> float:
    ba = a - b
    bc = c - b
    ba_norm = np.linalg.norm(ba)
    bc_norm = np.linalg.norm(bc)
    if ba_norm < 1e-6 or bc_norm < 1e-6:
        return 0.0
    cosine = float(np.dot(ba, bc) / (ba_norm * bc_norm))
    cosine = max(-1.0, min(1.0, cosine))
    return float(np.degrees(np.arccos(cosine)))


def calculate_ear_shoulder_offset(landmarks) -> float:
    left_ear = landmarks[LEFT_EAR]
    right_ear = landmarks[RIGHT_EAR]
    left_shoulder = landmarks[LEFT_SHOULDER]
    right_shoulder = landmarks[RIGHT_SHOULDER]

    ear_mid_x = (left_ear.x + right_ear.x) / 2.0
    shoulder_mid_x = (left_shoulder.x + right_shoulder.x) / 2.0
    return shoulder_mid_x - ear_mid_x


def calculate_neck_spine_angle(landmarks) -> float:
    nose = landmarks[NOSE]
    left_shoulder = landmarks[LEFT_SHOULDER]
    right_shoulder = landmarks[RIGHT_SHOULDER]
    left_hip = landmarks[LEFT_HIP]
    right_hip = landmarks[RIGHT_HIP]

    shoulder_mid = np.array(
        [(left_shoulder.x + right_shoulder.x) / 2.0, (left_shoulder.y + right_shoulder.y) / 2.0],
        dtype=np.float32,
    )
    hip_mid = np.array(
        [(left_hip.x + right_hip.x) / 2.0, (left_hip.y + right_hip.y) / 2.0],
        dtype=np.float32,
    )
    nose_pt = np.array([nose.x, nose.y], dtype=np.float32)
    return _calculate_angle_degrees(nose_pt, shoulder_mid, hip_mid)


def _posture_score_from_landmarks(landmarks) -> float:
    left_shoulder = landmarks[LEFT_SHOULDER]
    right_shoulder = landmarks[RIGHT_SHOULDER]

    shoulder_width = abs(left_shoulder.x - right_shoulder.x)
    if shoulder_width < 1e-6:
        return 0.0

    # Shoulder tilt indicates uneven posture; lower tilt means better alignment.
    shoulder_tilt = abs(left_shoulder.y - right_shoulder.y) / shoulder_width
    shoulder_alignment = 1.0 - _clamp(shoulder_tilt / 0.35)

    # Dual-signal forward-head estimate:
    # 1) ear-shoulder horizontal offset catches chin drift,
    # 2) neck-spine angle catches whole-body forward lean.
    ear_shoulder_offset = calculate_ear_shoulder_offset(landmarks)
    neck_spine_angle = calculate_neck_spine_angle(landmarks)

    # Normalize around practical webcam ranges without requiring per-user baseline here.
    head_forward_alignment = _clamp((ear_shoulder_offset + shoulder_width * 0.05) / (shoulder_width * 0.30))
    neck_alignment = _clamp((neck_spine_angle - 118.0) / 46.0)

    score = 0.45 * head_forward_alignment + 0.35 * neck_alignment + 0.20 * shoulder_alignment
    return round(_clamp(score), 3)


class PostureAnalyzer:
    def __init__(self, min_pose_presence_confidence: float = 0.5) -> None:
        self._min_pose_presence_confidence = float(min_pose_presence_confidence)
        self._latest_score = 0.0
        self._lock = threading.Lock()
        self._subscriber_name = "posture-analyzer"

    def analyze_frame(self, frame: np.ndarray) -> float:
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)

        from mediapipe.tasks import python as mp_python
        from mediapipe.tasks.python import vision

        options = vision.PoseLandmarkerOptions(
            base_options=mp_python.BaseOptions(model_asset_path=str(_ensure_pose_model())),
            running_mode=vision.RunningMode.IMAGE,
            min_pose_presence_confidence=self._min_pose_presence_confidence,
            num_poses=1,
        )
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
        with vision.PoseLandmarker.create_from_options(options) as landmarker:
            result = landmarker.detect(mp_image)

        if not result.pose_landmarks:
            return 0.0
        return _posture_score_from_landmarks(result.pose_landmarks[0])

    def start_live(self, camera_manager: CameraManager) -> None:
        camera_manager.subscribe(self._subscriber_name, self._process_frame)

    def stop_live(self, camera_manager: CameraManager) -> None:
        camera_manager.unsubscribe(self._subscriber_name)

    def latest_score(self) -> float:
        with self._lock:
            return float(self._latest_score)

    def _process_frame(self, frame: np.ndarray) -> None:
        score = self.analyze_frame(frame)
        with self._lock:
            self._latest_score = float(score)


def analyze_posture(
    camera_index: int = 0,
    min_pose_presence_confidence: float = 0.5,
    warmup_seconds: float = 0.6,
    preview_seconds: float = 0.0,
) -> float:
    analyzer = PostureAnalyzer(min_pose_presence_confidence=min_pose_presence_confidence)
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

        return analyzer.analyze_frame(frame)
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
