from __future__ import annotations

import argparse
import threading
import time
from datetime import datetime

import cv2
import numpy as np

from zeno_backend.analyzers.rppg_estimator import (
    FaceTrack,
    _build_face_detectors,
    _detect_primary_face,
    _normalize_signal_method,
    _pulse_signal_from_face_regions,
)
from zeno_backend.core.camera_manager import CameraManager

MIN_RR_BPM = 6.0
MAX_RR_BPM = 30.0


def _estimate_rr_details(signal: list[float], timestamps: list[float]) -> tuple[float, float, float, int]:
    if len(signal) < 40 or len(timestamps) < 40:
        return 0.0, 0.0, 0.0, len(signal)

    values = np.asarray(signal, dtype=np.float64)
    times = np.asarray(timestamps, dtype=np.float64)
    duration = times[-1] - times[0]
    if duration < 8.0:
        return 0.0, 0.0, float(max(0.0, duration)), len(signal)

    sample_rate = (len(times) - 1) / duration
    if sample_rate < 6.0:
        return 0.0, 0.0, float(duration), len(signal)

    values = values - np.mean(values)
    if np.std(values) < 1e-6:
        return 0.0, 0.0, float(duration), len(signal)

    window_fn = np.hanning(len(values))
    fft = np.fft.rfft(values * window_fn)
    freqs = np.fft.rfftfreq(len(values), d=1.0 / sample_rate)

    min_hz = MIN_RR_BPM / 60.0
    max_hz = MAX_RR_BPM / 60.0
    band_mask = (freqs >= min_hz) & (freqs <= max_hz)
    if not np.any(band_mask):
        return 0.0, 0.0, float(duration), len(signal)

    band_power = np.abs(fft[band_mask]) ** 2
    if band_power.size == 0 or float(np.sum(band_power)) <= 0.0:
        return 0.0, 0.0, float(duration), len(signal)

    peak_idx = int(np.argmax(band_power))
    peak_ratio = float(band_power[peak_idx] / np.sum(band_power))
    min_peak_ratio = 0.05 if duration >= 25.0 else 0.03
    if peak_ratio < min_peak_ratio:
        return 0.0, peak_ratio, float(duration), len(signal)

    peak_hz = float(freqs[band_mask][peak_idx])
    return round(peak_hz * 60.0, 1), peak_ratio, float(duration), len(signal)


class RespiratoryAnalyzer:
    def __init__(self, window_seconds: float = 90.0, signal_method: str = "hybrid") -> None:
        self._window_seconds = max(30.0, float(window_seconds))
        self._signal_method = _normalize_signal_method(signal_method)
        self._face_detectors = _build_face_detectors()
        self._subscriber_name = "respiratory-analyzer"
        self._lock = threading.Lock()
        self._started_at = time.perf_counter()
        self._signal: list[float] = []
        self._times: list[float] = []
        self._last_face: FaceTrack | None = None
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
        found_face = _detect_primary_face(frame, gray, self._face_detectors)
        if found_face is not None:
            self._last_face = found_face

        if self._last_face is not None:
            pulse_signal = _pulse_signal_from_face_regions(
                frame,
                self._last_face,
                signal_method=self._signal_method,
            )
            if pulse_signal is not None:
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

        rr, peak_ratio, window_duration, samples = _estimate_rr_details(self._signal, self._times)
        if rr > 0:
            if self._smoothed_rr is None:
                self._smoothed_rr = rr
            else:
                # Adapt faster while confidence is still partial.
                alpha = 0.28 if window_duration < 30.0 else 0.15
                self._smoothed_rr = self._smoothed_rr * (1.0 - alpha) + rr * alpha

        if self._smoothed_rr is None:
            confidence = "none"
        elif window_duration < 30.0 or samples < 120 or peak_ratio < 0.08:
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
