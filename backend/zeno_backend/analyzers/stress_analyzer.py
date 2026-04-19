from __future__ import annotations

import argparse
import threading
import time
from collections import defaultdict, deque
from datetime import datetime
from pathlib import Path

import cv2
import numpy as np

from zeno_backend.analyzers.rppg_estimator import (
    FaceTrack,
    _build_face_detectors,
    _detect_primary_face,
    _estimate_bpm,
    _pulse_signal_from_face_regions,
    _normalize_signal_method,
)
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
        hr_hold_seconds: float = 8.0,
        signal_method: str = "hybrid",
    ) -> None:
        self._hr_window_seconds = max(8.0, float(hr_window_seconds))
        self._emotion_sample_every_seconds = max(0.4, float(emotion_sample_every_seconds))
        self._hr_hold_seconds = max(0.0, float(hr_hold_seconds))
        self._signal_method = _normalize_signal_method(signal_method)
        # Lazy-load heavy models (OpenCV cascades / FER) on first frame or start_live.
        self._face_detectors = None
        self._emotion_detector = None
        self._models_ready = False
        self._subscriber_name = "stress-analyzer"
        self._lock = threading.Lock()

        self._signal: list[float] = []
        self._times: list[float] = []
        self._started_at = time.perf_counter()
        self._last_face: FaceTrack | None = None
        self._last_valid_bpm: float | None = None
        self._last_valid_bpm_at = 0.0
        self._bootstrap_bpm: deque[float] = deque(maxlen=10)
        self._recent_bpm: deque[float] = deque(maxlen=7)
        self._smoothed_bpm: float | None = None
        self._last_smooth_at = 0.0
        self._last_emotion_sample_at = 0.0
        self._emotion_scores: dict[str, float] = defaultdict(float)
        self._emotion_count = 0
        self._latest: dict = {
            "heart_rate_bpm": None,
            "dominant_emotion": "unknown",
            "emotion_score": 0.0,
        }

    def _ensure_models(self) -> None:
        if self._models_ready:
            return
        self._face_detectors = _build_face_detectors()
        self._emotion_detector = (
            FER(mtcnn=False, min_face_size=30, min_neighbors=3) if FER is not None else None
        )
        self._models_ready = True

    def _smooth_hr(self, bpm: float, now: float) -> float | None:
        if self._smoothed_bpm is None:
            self._bootstrap_bpm.append(float(bpm))
            if len(self._bootstrap_bpm) < 4:
                return None
            boot = np.asarray(self._bootstrap_bpm, dtype=np.float64)
            med = float(np.median(boot))
            inliers = boot[np.abs(boot - med) <= 12.0]
            if len(inliers) < 4:
                return None
            spread = float(np.max(inliers) - np.min(inliers))
            if spread > 15.0:
                return None
            seed = float(np.median(inliers))
            self._smoothed_bpm = seed
            self._recent_bpm.clear()
            for v in inliers[-self._recent_bpm.maxlen :]:
                self._recent_bpm.append(float(v))
            self._last_smooth_at = now
            return float(round(self._smoothed_bpm, 1))

        # Ignore extreme one-off spikes before they perturb smoothing.
        if abs(float(bpm) - self._smoothed_bpm) > 28.0:
            return float(round(self._smoothed_bpm, 1))

        self._recent_bpm.append(float(bpm))
        robust_bpm = float(np.median(np.asarray(self._recent_bpm, dtype=np.float64)))

        dt = max(0.05, now - self._last_smooth_at)
        self._last_smooth_at = now

        # Limit sudden swings to keep HR stable in passive/desktop conditions.
        max_step = 2.0 * dt + 0.2
        delta = robust_bpm - self._smoothed_bpm
        limited_target = self._smoothed_bpm + max(-max_step, min(max_step, delta))

        alpha = 0.22 if abs(delta) <= 3.0 else 0.12
        self._smoothed_bpm = (1.0 - alpha) * self._smoothed_bpm + alpha * limited_target
        return float(round(self._smoothed_bpm, 1))

    def analyze_frame(self, frame: np.ndarray) -> dict:
        self._ensure_models()
        now = time.perf_counter()
        elapsed = now - self._started_at
        gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

        found_face = _detect_primary_face(frame, gray, self._face_detectors or [])
        if found_face is not None:
            self._last_face = found_face

        if self._last_face is None:
            return self.latest_result()

        pulse_signal = _pulse_signal_from_face_regions(
            frame,
            self._last_face,
            signal_method=self._signal_method,
        )
        if pulse_signal is not None:
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
        bpm_out: float | None = None
        if bpm > 0:
            smoothed = self._smooth_hr(float(bpm), now)
            if smoothed is not None:
                bpm_out = smoothed
                self._last_valid_bpm = bpm_out
                self._last_valid_bpm_at = now
        elif self._last_valid_bpm is not None and (now - self._last_valid_bpm_at) <= self._hr_hold_seconds:
            # Keep last stable HR briefly to avoid UI flicker between adjacent windows.
            bpm_out = float(self._last_valid_bpm)

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
            "heart_rate_bpm": bpm_out,
            "dominant_emotion": dominant,
            "emotion_score": float(round(confidence, 3)),
        }
        with self._lock:
            self._latest = current
        return current

    def start_live(self, camera_manager: CameraManager) -> None:
        self._ensure_models()
        with self._lock:
            self._started_at = time.perf_counter()
            self._signal = []
            self._times = []
            self._last_face = None
            self._last_valid_bpm = None
            self._last_valid_bpm_at = 0.0
            self._bootstrap_bpm = deque(maxlen=10)
            self._recent_bpm = deque(maxlen=7)
            self._smoothed_bpm = None
            self._last_smooth_at = 0.0
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
