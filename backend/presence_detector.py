from __future__ import annotations

from datetime import datetime

import cv2
import mediapipe as mp


def _build_face_detector(min_detection_confidence: float):
    try:
        return mp.solutions.face_detection.FaceDetection(
            model_selection=0,
            min_detection_confidence=min_detection_confidence,
        )
    except AttributeError:
        pass

    try:
        from mediapipe.python.solutions import face_detection

        return face_detection.FaceDetection(
            model_selection=0,
            min_detection_confidence=min_detection_confidence,
        )
    except Exception:
        pass

    version = getattr(mp, "__version__", "unknown")
    raise RuntimeError(
        "MediaPipe FaceDetection is unavailable in this install "
        f"(detected mediapipe=={version}). "
        "Use mediapipe==0.10.14 for Week 1 Day 1."
    )


def detect_presence(camera_index: int = 0, min_detection_confidence: float = 0.5) -> bool:
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        return False

    face_detector = _build_face_detector(min_detection_confidence)

    try:
        ok, frame = cap.read()
        if not ok:
            return False

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        result = face_detector.process(rgb_frame)
        return bool(result.detections)
    finally:
        face_detector.close()
        cap.release()


def main() -> None:
    presence = detect_presence()
    timestamp = datetime.now().isoformat(timespec="seconds")
    print(f"[{timestamp}] presence_detected={str(presence).lower()}")


if __name__ == "__main__":
    main()
