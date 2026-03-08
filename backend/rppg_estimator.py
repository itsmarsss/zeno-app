from __future__ import annotations

import argparse
from datetime import datetime
import json

import cv2
import numpy as np

MIN_BPM = 48.0
MAX_BPM = 180.0


def _largest_face_box(face_boxes: np.ndarray | tuple | list) -> tuple[int, int, int, int] | None:
    if face_boxes is None or len(face_boxes) == 0:
        return None
    x, y, w, h = max(face_boxes, key=lambda box: int(box[2]) * int(box[3]))
    return int(x), int(y), int(w), int(h)


def _forehead_roi(frame: np.ndarray, face_box: tuple[int, int, int, int]) -> np.ndarray:
    x, y, w, h = face_box
    # Upper-center region of the face is a stable rPPG area for quick estimates.
    rx1 = x + int(w * 0.2)
    rx2 = x + int(w * 0.8)
    ry1 = y + int(h * 0.12)
    ry2 = y + int(h * 0.38)

    rx1 = max(0, rx1)
    ry1 = max(0, ry1)
    rx2 = min(frame.shape[1], rx2)
    ry2 = min(frame.shape[0], ry2)

    if rx2 <= rx1 or ry2 <= ry1:
        return np.empty((0, 0, 3), dtype=frame.dtype)

    return frame[ry1:ry2, rx1:rx2]


def _estimate_bpm(signal: list[float], timestamps: list[float]) -> float:
    if len(signal) < 90 or len(timestamps) < 90:
        return 0.0

    values = np.asarray(signal, dtype=np.float64)
    times = np.asarray(timestamps, dtype=np.float64)

    duration = times[-1] - times[0]
    if duration <= 8.0:
        return 0.0

    sample_rate = (len(times) - 1) / duration
    if sample_rate < 8.0:
        return 0.0

    values = values - np.mean(values)

    # Remove slow illumination drift with a 1-second moving-average detrend.
    window = max(3, int(sample_rate))
    trend = np.convolve(values, np.ones(window) / window, mode="same")
    detrended = values - trend

    if np.std(detrended) < 1e-6:
        return 0.0

    window_fn = np.hanning(len(detrended))
    spectrum_signal = detrended * window_fn

    fft = np.fft.rfft(spectrum_signal)
    freqs = np.fft.rfftfreq(len(detrended), d=1.0 / sample_rate)

    min_hz = MIN_BPM / 60.0
    max_hz = MAX_BPM / 60.0
    band_mask = (freqs >= min_hz) & (freqs <= max_hz)
    if not np.any(band_mask):
        return 0.0

    band_power = np.abs(fft[band_mask]) ** 2
    if band_power.size == 0 or float(np.sum(band_power)) <= 0.0:
        return 0.0

    peak_idx = int(np.argmax(band_power))
    peak_freq = freqs[band_mask][peak_idx]

    # Basic quality gate: dominant peak should have a meaningful band share.
    peak_ratio = float(band_power[peak_idx] / np.sum(band_power))
    if peak_ratio < 0.06:
        return 0.0

    return round(float(peak_freq * 60.0), 1)


def estimate_heart_rate(
    camera_index: int = 0,
    capture_seconds: float = 30.0,
    warmup_seconds: float = 0.8,
    preview: bool = False,
) -> float:
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        return 0.0

    face_detector = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )

    signal: list[float] = []
    timestamps: list[float] = []
    last_face: tuple[int, int, int, int] | None = None

    try:
        if warmup_seconds > 0:
            warmup_end = cv2.getTickCount() + int(warmup_seconds * cv2.getTickFrequency())
            while cv2.getTickCount() < warmup_end:
                cap.read()

        start = cv2.getTickCount()
        end = start + int(capture_seconds * cv2.getTickFrequency())
        frame_count = 0

        while cv2.getTickCount() < end:
            ok, frame = cap.read()
            if not ok:
                continue

            frame_count += 1
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

            if frame_count % 3 == 1 or last_face is None:
                faces = face_detector.detectMultiScale(
                    gray,
                    scaleFactor=1.1,
                    minNeighbors=5,
                    minSize=(60, 60),
                )
                found = _largest_face_box(faces)
                if found is not None:
                    last_face = found

            if last_face is None:
                if preview:
                    cv2.imshow("Zeno rPPG Capture", frame)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break
                continue

            roi = _forehead_roi(frame, last_face)
            if roi.size > 0:
                green_mean = float(np.mean(roi[:, :, 1]))
                red_mean = float(np.mean(roi[:, :, 2]))
                blue_mean = float(np.mean(roi[:, :, 0]))
                # Chrominance-like signal is more robust to overall brightness changes.
                pulse_signal = green_mean - 0.5 * red_mean - 0.5 * blue_mean
                timestamp = (cv2.getTickCount() - start) / cv2.getTickFrequency()
                signal.append(pulse_signal)
                timestamps.append(timestamp)

            if preview:
                x, y, w, h = last_face
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 200, 0), 2)
                remaining = max(0.0, capture_seconds - timestamps[-1] if timestamps else capture_seconds)
                cv2.putText(
                    frame,
                    f"Capturing... {remaining:04.1f}s",
                    (12, 28),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.8,
                    (0, 220, 0),
                    2,
                    cv2.LINE_AA,
                )
                cv2.imshow("Zeno rPPG Capture", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

        return _estimate_bpm(signal, timestamps)
    finally:
        if preview:
            cv2.destroyAllWindows()
        cap.release()


def _update_point_due(now_tick: int, next_update_tick: int) -> bool:
    return now_tick >= next_update_tick


def stream_heart_rate_updates(
    camera_index: int = 0,
    update_every_seconds: float = 5.0,
    analysis_window_seconds: float = 30.0,
    warmup_seconds: float = 0.8,
    max_seconds: float = 0.0,
    preview: bool = False,
) -> list[dict]:
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        return []

    face_detector = cv2.CascadeClassifier(
        cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
    )

    signal: list[float] = []
    timestamps: list[float] = []
    updates: list[dict] = []
    last_face: tuple[int, int, int, int] | None = None

    tick_hz = cv2.getTickFrequency()
    update_every_seconds = max(1.0, float(update_every_seconds))
    analysis_window_seconds = max(8.0, float(analysis_window_seconds))
    max_seconds = max(0.0, float(max_seconds))

    try:
        if warmup_seconds > 0:
            warmup_end = cv2.getTickCount() + int(warmup_seconds * tick_hz)
            while cv2.getTickCount() < warmup_end:
                cap.read()

        start = cv2.getTickCount()
        next_update_tick = start + int(update_every_seconds * tick_hz)
        max_end_tick = (
            start + int(max_seconds * tick_hz)
            if max_seconds > 0
            else None
        )
        frame_count = 0

        while True:
            now_tick = cv2.getTickCount()
            if max_end_tick is not None and now_tick >= max_end_tick:
                break

            ok, frame = cap.read()
            if not ok:
                if preview and cv2.waitKey(1) & 0xFF == ord("q"):
                    break
                continue

            frame_count += 1
            gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)

            if frame_count % 3 == 1 or last_face is None:
                faces = face_detector.detectMultiScale(
                    gray,
                    scaleFactor=1.1,
                    minNeighbors=5,
                    minSize=(60, 60),
                )
                found = _largest_face_box(faces)
                if found is not None:
                    last_face = found

            if last_face is not None:
                roi = _forehead_roi(frame, last_face)
                if roi.size > 0:
                    green_mean = float(np.mean(roi[:, :, 1]))
                    red_mean = float(np.mean(roi[:, :, 2]))
                    blue_mean = float(np.mean(roi[:, :, 0]))
                    pulse_signal = green_mean - 0.5 * red_mean - 0.5 * blue_mean
                    t = (cv2.getTickCount() - start) / tick_hz
                    signal.append(pulse_signal)
                    timestamps.append(t)

            if _update_point_due(now_tick, next_update_tick):
                if timestamps:
                    latest_t = timestamps[-1]
                    window_start = latest_t - analysis_window_seconds
                    start_idx = 0
                    for idx, t in enumerate(timestamps):
                        if t >= window_start:
                            start_idx = idx
                            break
                    bpm = _estimate_bpm(signal[start_idx:], timestamps[start_idx:])
                else:
                    latest_t = (now_tick - start) / tick_hz
                    bpm = 0.0

                update = {
                    "timestamp": datetime.now().isoformat(timespec="seconds"),
                    "elapsed_seconds": round(float(latest_t), 1),
                    "heart_rate_bpm": None if bpm <= 0 else float(bpm),
                }
                updates.append(update)
                print(json.dumps(update), flush=True)
                next_update_tick += int(update_every_seconds * tick_hz)

            if preview:
                if last_face is not None:
                    x, y, w, h = last_face
                    cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 200, 0), 2)
                cv2.putText(
                    frame,
                    "Live rPPG (press q to stop)",
                    (12, 28),
                    cv2.FONT_HERSHEY_SIMPLEX,
                    0.7,
                    (0, 220, 0),
                    2,
                    cv2.LINE_AA,
                )
                cv2.imshow("Zeno rPPG Capture", frame)
                if cv2.waitKey(1) & 0xFF == ord("q"):
                    break

        return updates
    finally:
        if preview:
            cv2.destroyAllWindows()
        cap.release()


def main() -> None:
    parser = argparse.ArgumentParser(description="One-shot 30s rPPG heart rate estimator.")
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Show live capture window while collecting rPPG signal.",
    )
    parser.add_argument(
        "--seconds",
        type=float,
        default=30.0,
        help="Capture duration in seconds (default: 30).",
    )
    parser.add_argument(
        "--continuous",
        action="store_true",
        help="Run continuously and emit JSON heart-rate updates every interval.",
    )
    parser.add_argument(
        "--update-every",
        type=float,
        default=5.0,
        help="Continuous mode update interval in seconds (default: 5).",
    )
    parser.add_argument(
        "--window-seconds",
        type=float,
        default=30.0,
        help="Signal analysis window for continuous mode (default: 30).",
    )
    parser.add_argument(
        "--max-seconds",
        type=float,
        default=0.0,
        help="Stop continuous mode after N seconds (0 = run until interrupted).",
    )
    args = parser.parse_args()

    if args.continuous:
        try:
            stream_heart_rate_updates(
                update_every_seconds=args.update_every,
                analysis_window_seconds=args.window_seconds,
                max_seconds=args.max_seconds,
                preview=args.preview,
            )
        except KeyboardInterrupt:
            pass
        return

    bpm = estimate_heart_rate(capture_seconds=args.seconds, preview=args.preview)
    timestamp = datetime.now().isoformat(timespec="seconds")
    if bpm > 0:
        print(f"[{timestamp}] heart_rate_bpm={bpm:.1f}")
    else:
        print(f"[{timestamp}] heart_rate_bpm=unknown")


if __name__ == "__main__":
    main()
