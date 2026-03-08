from __future__ import annotations

from datetime import datetime
from pathlib import Path
from urllib.request import urlretrieve

import cv2
import mediapipe as mp

TASK_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/face_detector/"
    "blaze_face_short_range/float16/latest/blaze_face_short_range.tflite"
)
TASK_MODEL_PATH = (
    Path(__file__).resolve().parent / "models" / "blaze_face_short_range.tflite"
)


def _ensure_task_model() -> Path:
    if TASK_MODEL_PATH.exists():
        return TASK_MODEL_PATH

    TASK_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    urlretrieve(TASK_MODEL_URL, TASK_MODEL_PATH)
    return TASK_MODEL_PATH


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


def detect_presence(
    camera_index: int = 0,
    min_detection_confidence: float = 0.5,
    preview_seconds: float = 1.0,
) -> bool:
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        return False

    try:
        if preview_seconds > 0:
            cv2.namedWindow("Zeno Presence Test", cv2.WINDOW_AUTOSIZE)
            end_ticks = cv2.getTickCount() + int(preview_seconds * cv2.getTickFrequency())
            while cv2.getTickCount() < end_ticks:
                ok, preview_frame = cap.read()
                if not ok:
                    break
                cv2.imshow("Zeno Presence Test", preview_frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break
            cv2.destroyWindow("Zeno Presence Test")

        ok, frame = cap.read()
        if not ok:
            return False

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        try:
            return _detect_with_tasks(rgb_frame, min_detection_confidence)
        except Exception as tasks_error:
            try:
                return _detect_with_legacy(rgb_frame, min_detection_confidence)
            except Exception as legacy_error:
                version = getattr(mp, "__version__", "unknown")
                raise RuntimeError(
                    "MediaPipe face detection is unavailable in this install "
                    f"(mediapipe=={version}). "
                    f"Tasks API error: {tasks_error}. "
                    f"Legacy API error: {legacy_error}."
                ) from legacy_error
    finally:
        cv2.destroyAllWindows()
        cap.release()


def main() -> None:
    presence = detect_presence()
    timestamp = datetime.now().isoformat(timespec="seconds")
    print(f"[{timestamp}] presence_detected={str(presence).lower()}")


if __name__ == "__main__":
    main()
