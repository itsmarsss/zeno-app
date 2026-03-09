from __future__ import annotations

import argparse
import threading
import time
from datetime import datetime

import cv2
import numpy as np

from zeno_backend.analyzers.rppg_estimator import _forehead_roi, _largest_face_box
from zeno_backend.core.camera_manager import CameraManager

MIN_RR_BPM = 6.0
MAX_RR_BPM = 30.0


def _estimate_rr(signal: list[float], timestamps: list[float]) -> float:
    if len(signal) < 120 or len(timestamps) < 120:
        return 0.0

    values = np.asarray(signal, dtype=np.float64)
    times = np.asarray(timestamps, dtype=np.float64)
    duration = times[-1] - times[0]
    if duration < 45.0:
        return 0.0

    sample_rate = (len(times) - 1) / duration
    if sample_rate < 8.0:
        return 0.0

    values = values - np.mean(values)
    if np.std(values) < 1e-6:
        return 0.0

    window_fn = np.hanning(len(values))
    fft = np.fft.rfft(values * window_fn)
    freqs = np.fft.rfftfreq(len(values), d=1.0 / sample_rate)

    min_hz = MIN_RR_BPM / 60.0
    max_hz = MAX_RR_BPM / 60.0
    band_mask = (freqs >= min_hz) & (freqs <= max_hz)
    if not np.any(band_mask):
        return 0.0

    band_power = np.abs(fft[band_mask]) ** 2
    if band_power.size == 0 or float(np.sum(band_power)) <= 0.0:
        return 0.0

    peak_idx = int(np.argmax(band_power))
    peak_ratio = float(band_power[peak_idx] / np.sum(band_power))
    if peak_ratio < 0.08:
        return 0.0

    peak_hz = float(freqs[band_mask][peak_idx])
    return round(peak_hz * 60.0, 1)


class RespiratoryAnalyzer:
    def __init__(self, window_seconds: float = 90.0) -> None:
        self._window_seconds = max(30.0, float(window_seconds))
        self._face_detector = cv2.CascadeClassifier(
            cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
        )
        self._subscriber_name = "respiratory-analyzer"
        self._lock = threading.Lock()
        self._started_at = time.perf_counter()
        self._signal: list[float] = []
        self._times: list[float] = []
        self._last_face: tuple[int, int, int, int] | None = None
        self._smoothed_rr: float | None = None
        self._latest = {
            "respiratory_rate_bpm": None,
            "rr_confidence": "none",
            "elapsed_seconds": 0.0,
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

        if self._last_face is not None:
            roi = _forehead_roi(frame, self._last_face)
            if roi.size > 0:
                green_mean = float(np.mean(roi[:, :, 1]))
                red_mean = float(np.mean(roi[:, :, 2]))
                blue_mean = float(np.mean(roi[:, :, 0]))
                pulse_signal = green_mean - 0.5 * red_mean - 0.5 * blue_mean
                self._signal.append(pulse_signal)
                self._times.append(elapsed)

        if self._times:
            window_start = self._times[-1] - self._window_seconds
            trim_idx = 0
            for idx, t in enumerate(self._times):
                if t >= window_start:
                    trim_idx = idx
                    break
            if trim_idx > 0:
                self._signal = self._signal[trim_idx:]
                self._times = self._times[trim_idx:]

        rr = _estimate_rr(self._signal, self._times)
        if rr > 0:
            if self._smoothed_rr is None:
                self._smoothed_rr = rr
            else:
                self._smoothed_rr = self._smoothed_rr * 0.85 + rr * 0.15

        if elapsed < 60.0:
            confidence = "none"
        elif elapsed < 90.0:
            confidence = "partial"
        else:
            confidence = "full"

        latest = {
            "respiratory_rate_bpm": None if self._smoothed_rr is None else round(float(self._smoothed_rr), 1),
            "rr_confidence": confidence,
            "elapsed_seconds": round(elapsed, 1),
        }
        with self._lock:
            self._latest = latest
        return latest

    def start_live(self, camera_manager: CameraManager) -> None:
        with self._lock:
            self._started_at = time.perf_counter()
            self._signal = []
            self._times = []
            self._last_face = None
            self._smoothed_rr = None
            self._latest = {
                "respiratory_rate_bpm": None,
                "rr_confidence": "none",
                "elapsed_seconds": 0.0,
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
    parser = argparse.ArgumentParser(description="Respiratory analyzer shared-camera smoke test.")
    parser.add_argument("--seconds", type=float, default=12.0)
    args = parser.parse_args()

    manager = CameraManager()
    analyzer = RespiratoryAnalyzer()
    try:
        analyzer.start_live(manager)
        time.sleep(max(1.0, float(args.seconds)))
    except RuntimeError:
        result = {"respiratory_rate_bpm": None, "rr_confidence": "none", "elapsed_seconds": 0.0}
        ts = datetime.now().isoformat(timespec="seconds")
        print(f"[{ts}] respiratory_rate_bpm={result['respiratory_rate_bpm']} rr_confidence={result['rr_confidence']}")
        return
    finally:
        analyzer.stop_live(manager)
        manager.stop()
    result = analyzer.latest_result()
    ts = datetime.now().isoformat(timespec="seconds")
    print(
        f"[{ts}] respiratory_rate_bpm={result['respiratory_rate_bpm']} "
        f"rr_confidence={result['rr_confidence']}"
    )


if __name__ == "__main__":
    main()
