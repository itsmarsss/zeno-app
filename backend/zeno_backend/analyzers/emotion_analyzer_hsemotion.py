from __future__ import annotations

import argparse
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from urllib.error import HTTPError
import inspect

import cv2
import numpy as np
import torch

try:
    import hsemotion.facial_emotions as hsemotion_module
    from hsemotion.facial_emotions import HSEmotionRecognizer
except ImportError as exc:
    raise RuntimeError(
        "hsemotion is not installed. Run: pip install -r backend/requirements.txt"
    ) from exc


def _show_preview(cap: cv2.VideoCapture, seconds: float) -> None:
    if seconds <= 0:
        return

    window_name = "Zeno HSEmotion Preview"
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


def _largest_face_box(face_boxes: np.ndarray | tuple | list) -> tuple[int, int, int, int] | None:
    if face_boxes is None or len(face_boxes) == 0:
        return None
    x, y, w, h = max(face_boxes, key=lambda box: int(box[2]) * int(box[3]))
    return int(x), int(y), int(w), int(h)


def _extract_score(scores, label: str) -> float:
    if scores is None:
        return 0.0

    if isinstance(scores, dict):
        for key, value in scores.items():
            if str(key).lower() == label.lower():
                return float(value)
        return float(max(scores.values())) if scores else 0.0

    if isinstance(scores, (list, tuple, np.ndarray)):
        if len(scores) == 0:
            return 0.0
        return float(np.max(np.asarray(scores, dtype=float)))

    return 0.0


def _build_recognizer(model_name: str, model_path: str | None) -> HSEmotionRecognizer:
    def _init_with_torch_compat() -> HSEmotionRecognizer:
        load_signature = inspect.signature(torch.load)
        if "weights_only" not in load_signature.parameters:
            return HSEmotionRecognizer(model_name=model_name, device="cpu")

        original_torch_load = torch.load

        def _torch_load_compat(*args, **kwargs):
            kwargs.setdefault("weights_only", False)
            return original_torch_load(*args, **kwargs)

        torch.load = _torch_load_compat
        try:
            return HSEmotionRecognizer(model_name=model_name, device="cpu")
        finally:
            torch.load = original_torch_load

    if not model_path:
        try:
            return _init_with_torch_compat()
        except HTTPError as exc:
            if exc.code == 429:
                raise RuntimeError(
                    "HSEmotion model download was rate-limited (HTTP 429). "
                    "Download the .pt model manually and pass --model-path."
                ) from exc
            raise

    resolved_path = Path(model_path).expanduser().resolve()
    if not resolved_path.is_file():
        raise RuntimeError(f"Model file not found: {resolved_path}")

    original_get_model_path = hsemotion_module.get_model_path
    hsemotion_module.get_model_path = lambda _model_name: str(resolved_path)
    try:
        return _init_with_torch_compat()
    finally:
        hsemotion_module.get_model_path = original_get_model_path


def analyze_emotion(
    camera_index: int = 0,
    warmup_seconds: float = 0.6,
    preview_seconds: float = 0.0,
    sample_frames: int = 5,
    model_name: str = "enet_b0_8_best_afew",
    model_path: str | None = None,
) -> tuple[str, float]:
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        return "unknown", 0.0

    face_detector = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )
    recognizer = _build_recognizer(model_name=model_name, model_path=model_path)
    aggregate_scores: dict[str, float] = defaultdict(float)
    detections_used = 0

    try:
        _show_preview(cap, preview_seconds)

        if warmup_seconds > 0:
            end_ticks = cv2.getTickCount() + int(warmup_seconds * cv2.getTickFrequency())
            while cv2.getTickCount() < end_ticks:
                cap.read()

        for _ in range(sample_frames):
            ok, frame = cap.read()
            if not ok:
                continue

            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
            faces = face_detector.detectMultiScale(
                gray,
                scaleFactor=1.1,
                minNeighbors=4,
                minSize=(40, 40),
            )
            face_box = _largest_face_box(faces)
            if not face_box:
                continue

            x, y, w, h = face_box
            face_img = frame[y : y + h, x : x + w]
            if face_img.size == 0:
                continue

            prediction = recognizer.predict_emotions(face_img, logits=False)
            if isinstance(prediction, tuple) and len(prediction) == 2:
                label, scores = prediction
            else:
                label, scores = prediction, None

            if not label:
                continue

            label = str(label).lower()
            aggregate_scores[label] += _extract_score(scores, label)
            detections_used += 1

        if detections_used == 0 or not aggregate_scores:
            return "unknown", 0.0

        dominant, total_score = max(aggregate_scores.items(), key=lambda item: item[1])
        confidence = total_score / detections_used
        return dominant, float(confidence)
    finally:
        cap.release()


def main() -> None:
    parser = argparse.ArgumentParser(
        description="One-shot dominant emotion analyzer using HSEmotion."
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Show a 1-second camera preview before analysis.",
    )
    parser.add_argument(
        "--model",
        default="enet_b0_8_best_afew",
        help="HSEmotion model name (default: enet_b0_8_best_afew).",
    )
    parser.add_argument(
        "--model-path",
        default=None,
        help="Local .pt path for HSEmotion model (skips auto-download).",
    )
    args = parser.parse_args()

    emotion, score = analyze_emotion(
        preview_seconds=1.0 if args.preview else 0.0,
        model_name=args.model,
        model_path=args.model_path,
    )
    timestamp = datetime.now().isoformat(timespec="seconds")
    print(f"[{timestamp}] dominant_emotion={emotion} score={score:.3f}")


if __name__ == "__main__":
    main()
