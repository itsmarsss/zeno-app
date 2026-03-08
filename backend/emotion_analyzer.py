from __future__ import annotations

import argparse
from datetime import datetime

import cv2
from fer import FER


def _show_preview(cap: cv2.VideoCapture, seconds: float) -> None:
    if seconds <= 0:
        return

    window_name = "Zeno Emotion Preview"
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


def _select_primary_face(detections: list[dict]) -> dict | None:
    if not detections:
        return None

    def face_area(detection: dict) -> int:
        x, y, w, h = detection.get("box", [0, 0, 0, 0])
        return max(0, int(w)) * max(0, int(h))

    return max(detections, key=face_area)


def analyze_emotion(
    camera_index: int = 0,
    warmup_seconds: float = 0.6,
    preview_seconds: float = 0.0,
) -> tuple[str, float]:
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        return "unknown", 0.0

    try:
        _show_preview(cap, preview_seconds)

        if warmup_seconds > 0:
            end_ticks = cv2.getTickCount() + int(warmup_seconds * cv2.getTickFrequency())
            while cv2.getTickCount() < end_ticks:
                cap.read()

        ok, frame = cap.read()
        if not ok:
            return "unknown", 0.0

        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        detector = FER(mtcnn=False)
        detections = detector.detect_emotions(rgb_frame)
        primary_face = _select_primary_face(detections)
        if not primary_face:
            return "unknown", 0.0

        emotions = primary_face.get("emotions", {})
        if not emotions:
            return "unknown", 0.0

        dominant, score = max(emotions.items(), key=lambda item: item[1])
        return dominant, float(score)
    finally:
        cap.release()


def main() -> None:
    parser = argparse.ArgumentParser(description="One-shot dominant emotion analyzer.")
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Show a 1-second camera preview before analysis.",
    )
    args = parser.parse_args()

    emotion, score = analyze_emotion(preview_seconds=1.0 if args.preview else 0.0)
    timestamp = datetime.now().isoformat(timespec="seconds")
    print(f"[{timestamp}] dominant_emotion={emotion} score={score:.3f}")


if __name__ == "__main__":
    main()
