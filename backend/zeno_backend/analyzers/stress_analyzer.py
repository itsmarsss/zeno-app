from __future__ import annotations

import argparse
import threading
import time
from collections import defaultdict
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from zeno_backend.analyzers.rppg_estimator import _estimate_bpm, _forehead_roi, _largest_face_box
from zeno_backend.core.camera_manager import CameraManager

try:
    from fer import FER  # type: ignore
except Exception:
    try:
        from fer.fer import FER  # type: ignore
    except Exception:
        FER = None


class StressAnalyzer:
    def __init__(
        self,
        hr_window_seconds: float = 20.0,
        emotion_sample_every_seconds: float = 1.2,
    ) -> None:
        self._hr_window_seconds = max(8.0, float(hr_window_seconds))
        self._emotion_sample_every_seconds = max(0.4, float(emotion_sample_every_seconds))
        self._face_detector = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        self._emotion_detector = (
            FER(mtcnn=False, min_face_size=30, min_neighbors=3) if FER is not None else None
        )
        self._subscriber_name = "stress-analyzer"
        self._lock = threading.Lock()

        self._signal: list[float] = []
        self._times: list[float] = []
        self._started_at = time.perf_counter()
        self._last_face: tuple[int, int, int, int] | None = None
        self._last_emotion_sample_at = 0.0
        self._emotion_scores: dict[str, float] = defaultdict(float)
        self._emotion_count = 0
        self._latest: dict = {
            "heart_rate_bpm": None,
            "dominant_emotion": "unknown",
            "emotion_score": 0.0,
        }

    def analyze_frame(self, frame: np.ndarray) -> dict:
        now = time.perf_counter()
        elapsed = now - self._started_at
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        faces = self._face_detector.detectMultiScale(
            gray,
            scaleFactor=1.1,
            minNeighbors=5,
            minSize=(60, 60),
        )
        found_face = _largest_face_box(faces)
        if found_face is not None:
            self._last_face = found_face

        if self._last_face is None:
            return self.latest_result()

        roi = _forehead_roi(frame, self._last_face)
        if roi.size > 0:
            green_mean = float(np.mean(roi[:, :, 1]))
            red_mean = float(np.mean(roi[:, :, 2]))
            blue_mean = float(np.mean(roi[:, :, 0]))
            pulse_signal = green_mean - 0.5 * red_mean - 0.5 * blue_mean
            self._signal.append(pulse_signal)
            self._times.append(elapsed)

        if self._times:
            window_start = self._times[-1] - self._hr_window_seconds
            trim_idx = 0
            for idx, t in enumerate(self._times):
                if t >= window_start:
                    trim_idx = idx
                    break
            if trim_idx > 0:
                self._signal = self._signal[trim_idx:]
                self._times = self._times[trim_idx:]

        bpm = _estimate_bpm(self._signal, self._times)

        if (
            self._emotion_detector is not None
            and (now - self._last_emotion_sample_at) >= self._emotion_sample_every_seconds
        ):
            self._last_emotion_sample_at = now
            detections = self._emotion_detector.detect_emotions(frame)
            if detections:
                primary = max(
                    detections,
                    key=lambda detection: int(detection.get("box", [0, 0, 0, 0])[2])
                    * int(detection.get("box", [0, 0, 0, 0])[3]),
                )
                emotions = primary.get("emotions", {})
                if emotions:
                    for emotion, score in emotions.items():
                        self._emotion_scores[str(emotion).lower()] += float(score)
                    self._emotion_count += 1

        dominant = "unknown"
        confidence = 0.0
        if self._emotion_count > 0 and self._emotion_scores:
            dominant, total = max(self._emotion_scores.items(), key=lambda item: item[1])
            confidence = total / self._emotion_count

        current = {
            "heart_rate_bpm": None if bpm <= 0 else float(round(bpm, 1)),
            "dominant_emotion": dominant,
            "emotion_score": float(round(confidence, 3)),
        }
        with self._lock:
            self._latest = current
        return current

    def start_live(self, camera_manager: CameraManager) -> None:
        with self._lock:
            self._started_at = time.perf_counter()
            self._signal = []
            self._times = []
            self._last_face = None
            self._last_emotion_sample_at = 0.0
            self._emotion_scores = defaultdict(float)
            self._emotion_count = 0
            self._latest = {
                "heart_rate_bpm": None,
                "dominant_emotion": "unknown",
                "emotion_score": 0.0,
            }
        camera_manager.subscribe(self._subscriber_name, self._process_frame)

    def stop_live(self, camera_manager: CameraManager) -> None:
        camera_manager.unsubscribe(self._subscriber_name)

    def latest_result(self) -> dict:
        with self._lock:
            return dict(self._latest)

    def _process_frame(self, frame: np.ndarray) -> None:
        self.analyze_frame(frame)


def main() -> None:
    parser = argparse.ArgumentParser(description="Stress analyzer standalone frame test.")
    parser.add_argument("frame_path", nargs="?", default=None, help="Optional frame path for one-shot analysis.")
    args = parser.parse_args()

    analyzer = StressAnalyzer()
    if args.frame_path:
        frame = cv2.imread(str(Path(args.frame_path).expanduser().resolve()))
        if frame is None:
            raise RuntimeError("Unable to read image frame.")
        result = analyzer.analyze_frame(frame)
        print(result)
        return

    manager = CameraManager()
    analyzer.start_live(manager)
    time.sleep(6.0)
    analyzer.stop_live(manager)
    manager.stop()
    result = analyzer.latest_result()
    ts = datetime.now().isoformat(timespec="seconds")
    print(
        f"[{ts}] heart_rate_bpm={result['heart_rate_bpm']} "
        f"dominant_emotion={result['dominant_emotion']} score={result['emotion_score']:.3f}"
    )


if __name__ == "__main__":
    main()
