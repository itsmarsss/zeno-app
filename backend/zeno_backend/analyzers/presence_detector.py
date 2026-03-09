from __future__ import annotations

import argparse
import threading
from datetime import datetime
from pathlib import Path
from urllib.request import urlretrieve

import cv2
import mediapipe as mp
import numpy as np

from zeno_backend.core.camera_manager import CameraManager

TASK_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"
)
TASK_MODEL_PATH = (
    Path(__file__).resolve().parents[2] / "models" / "blaze_face_short_range.tflite"
)
FACE_CASCADE_PATH = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"


def _ensure_task_model() -> Path:
    if TASK_MODEL_PATH.exists():
        return TASK_MODEL_PATH

    TASK_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    urlretrieve(TASK_MODEL_URL, TASK_MODEL_PATH)
    return TASK_MODEL_PATH


def _show_preview(cap: cv2.VideoCapture, seconds: float) -> None:
    if seconds <= 0:
        return

    window_name = "Zeno Presence Preview"
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


def _largest_face_box(boxes) -> tuple[int, int, int, int] | None:
    if boxes is None or len(boxes) == 0:
        return None
    x, y, w, h = max(boxes, key=lambda b: int(b[2]) * int(b[3]))
    return int(x), int(y), int(w), int(h)


def _detect_with_tasks(rgb_frame, min_detection_confidence: float) -> bool:
    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    model_path = _ensure_task_model()
    options = vision.FaceDetectorOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(model_path)),
        running_mode=vision.RunningMode.IMAGE,
        min_detection_confidence=min_detection_confidence,
    )
    mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
    with vision.FaceDetector.create_from_options(options) as detector:
        result = detector.detect(mp_image)
    return bool(result.detections)


def _detect_with_legacy(rgb_frame, min_detection_confidence: float) -> bool:
    try:
        with mp.solutions.face_detection.FaceDetection(
            model_selection=0,
            min_detection_confidence=min_detection_confidence,
        ) as detector:
            result = detector.process(rgb_frame)
            return bool(result.detections)
    except AttributeError:
        pass

    try:
        from mediapipe.python.solutions import face_detection

        with face_detection.FaceDetection(
            model_selection=0,
            min_detection_confidence=min_detection_confidence,
        ) as detector:
            result = detector.process(rgb_frame)
            return bool(result.detections)
    except Exception:
        pass

    raise RuntimeError("Legacy MediaPipe Solutions face detection is unavailable.")


class PresenceDetector:
    def __init__(self, min_detection_confidence: float = 0.5) -> None:
        self._min_detection_confidence = float(min_detection_confidence)
        self._latest_result = False
        self._lock = threading.Lock()
        self._subscriber_name = "presence-detector"

    def analyze_frame(self, frame: np.ndarray) -> bool:
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        try:
            return _detect_with_tasks(rgb_frame, self._min_detection_confidence)
        except Exception as tasks_error:
            try:
                return _detect_with_legacy(rgb_frame, self._min_detection_confidence)
            except Exception as legacy_error:
                version = getattr(mp, "__version__", "unknown")
                raise RuntimeError(
                    "MediaPipe face detection is unavailable in this install "
                    f"(mediapipe=={version}). "
                    f"Tasks API error: {tasks_error}. "
                    f"Legacy API error: {legacy_error}."
                ) from legacy_error

    def start_live(self, camera_manager: CameraManager) -> None:
        camera_manager.subscribe(self._subscriber_name, self._process_frame)

    def stop_live(self, camera_manager: CameraManager) -> None:
        camera_manager.unsubscribe(self._subscriber_name)

    def latest_result(self) -> bool:
        with self._lock:
            return bool(self._latest_result)

    def _process_frame(self, frame: np.ndarray) -> None:
        presence = self.analyze_frame(frame)
        with self._lock:
            self._latest_result = bool(presence)


def detect_presence(
    camera_index: int = 0,
    min_detection_confidence: float = 0.5,
    warmup_seconds: float = 0.6,
    preview_seconds: float = 0.0,
    live_check_seconds: float = 0.8,
    min_face_frames: int = 3,
    liveness_diff_threshold: float = 1.2,
    allow_static_face: bool = False,
) -> bool:
    detector = PresenceDetector(min_detection_confidence=min_detection_confidence)
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        return False
    face_cascade = cv2.CascadeClassifier(FACE_CASCADE_PATH)
    if face_cascade.empty():
        allow_static_face = True

    try:
        _show_preview(cap, preview_seconds)
        if warmup_seconds > 0:
            end_ticks = cv2.getTickCount() + int(warmup_seconds * cv2.getTickFrequency())
            while cv2.getTickCount() < end_ticks:
                cap.read()

        live_check_seconds = max(0.2, float(live_check_seconds))
        min_face_frames = max(1, int(min_face_frames))
        deadline = cv2.getTickCount() + int(live_check_seconds * cv2.getTickFrequency())
        face_frames = 0
        liveness_diffs: list[float] = []
        previous_face_patch: np.ndarray | None = None

        while cv2.getTickCount() < deadline:
            ok, frame = cap.read()
            if not ok:
                continue

            if detector.analyze_frame(frame):
                face_frames += 1

                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                boxes = face_cascade.detectMultiScale(
                    gray,
                    scaleFactor=1.1,
                    minNeighbors=5,
                    minSize=(60, 60),
                )
                box = _largest_face_box(boxes)
                if box is None:
                    continue
                x, y, w, h = box
                patch = gray[y : y + h, x : x + w]
                if patch.size == 0:
                    continue
                patch = cv2.resize(patch, (64, 64), interpolation=cv2.INTER_AREA)

                if previous_face_patch is not None:
                    diff = float(
                        np.mean(
                            cv2.absdiff(
                                patch.astype(np.float32),
                                previous_face_patch.astype(np.float32),
                            )
                        )
                    )
                    liveness_diffs.append(diff)
                previous_face_patch = patch

            if face_frames >= min_face_frames and allow_static_face:
                return True

        if face_frames < min_face_frames:
            return False

        if allow_static_face:
            return True

        if not liveness_diffs:
            return False
        return float(np.mean(liveness_diffs)) >= float(liveness_diff_threshold)
    finally:
        cap.release()


def main() -> None:
    parser = argparse.ArgumentParser(description="One-shot face presence detection.")
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Show a 1-second camera preview before detection.",
    )
    parser.add_argument(
        "--allow-static-face",
        action="store_true",
        help="Disable micro-motion liveness guard (useful for debugging only).",
    )
    args = parser.parse_args()

    presence = detect_presence(
        preview_seconds=1.0 if args.preview else 0.0,
        allow_static_face=bool(args.allow_static_face),
    )
    timestamp = datetime.now().isoformat(timespec="seconds")
    print(f"[{timestamp}] presence_detected={str(presence).lower()}")


if __name__ == "__main__":
    main()
