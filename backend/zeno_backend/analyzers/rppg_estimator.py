from __future__ import annotations

import argparse
from dataclasses import dataclass
from datetime import datetime
import json
from typing import Any

import cv2
import numpy as np

MIN_BPM = 48.0
MAX_BPM = 180.0

try:
    import mediapipe as mp
except Exception:
    mp = None

MESH_FOREHEAD_IDX = [10, 67, 103, 109, 338, 297, 332, 284]
MESH_LEFT_CHEEK_IDX = [50, 187, 205, 207, 213, 192, 147, 123, 116, 117, 118]
MESH_RIGHT_CHEEK_IDX = [280, 411, 425, 427, 436, 416, 376, 352, 345, 346, 347]


@dataclass
class FaceTrack:
    box: tuple[int, int, int, int]
    landmarks: np.ndarray | None = None


def _normalize_signal_method(signal_method: str) -> str:
    method = str(signal_method or "hybrid").strip().lower()
    if method in {"chrom", "lab", "hybrid"}:
        return method
    return "hybrid"


def _pulse_signal_from_roi(roi: np.ndarray, signal_method: str = "chrom") -> float:
    method = _normalize_signal_method(signal_method)

    green_mean = float(np.mean(roi[:, :, 1]))
    red_mean = float(np.mean(roi[:, :, 2]))
    blue_mean = float(np.mean(roi[:, :, 0]))
    # Chrominance-like signal robust to global brightness changes.
    chrom_signal = green_mean - 0.5 * red_mean - 0.5 * blue_mean
    if method == "chrom":
        return float(chrom_signal)

    # CIELab signal drops luminance (L*) and uses chroma axes only.
    lab = cv2.cvtColor(roi, cv2.COLOR_BGR2LAB)
    a_mean = float(np.mean(lab[:, :, 1])) - 128.0
    b_mean = float(np.mean(lab[:, :, 2])) - 128.0
    lab_signal = a_mean - 0.5 * b_mean

    if method == "lab":
        return float(lab_signal)
    # Hybrid keeps compatibility while testing Lab robustness.
    return float(0.65 * chrom_signal + 0.35 * lab_signal)


def _largest_face_box(face_boxes: np.ndarray | tuple | list) -> tuple[int, int, int, int] | None:
    if face_boxes is None or len(face_boxes) == 0:
        return None
    x, y, w, h = max(face_boxes, key=lambda box: int(box[2]) * int(box[3]))
    return int(x), int(y), int(w), int(h)


def _pad_face_box(
    frame: np.ndarray,
    face_box: tuple[int, int, int, int],
    x_pad_ratio: float = 0.10,
    y_pad_top_ratio: float = 0.22,
    y_pad_bottom_ratio: float = 0.08,
) -> tuple[int, int, int, int] | None:
    x, y, w, h = face_box
    x1 = int(x - w * x_pad_ratio)
    x2 = int(x + w * (1.0 + x_pad_ratio))
    y1 = int(y - h * y_pad_top_ratio)
    y2 = int(y + h * (1.0 + y_pad_bottom_ratio))

    fw, fh = frame.shape[1], frame.shape[0]
    x1 = max(0, min(fw - 1, x1))
    y1 = max(0, min(fh - 1, y1))
    x2 = max(0, min(fw, x2))
    y2 = max(0, min(fh, y2))

    nw = x2 - x1
    nh = y2 - y1
    if nw <= 0 or nh <= 0:
        return None
    return x1, y1, nw, nh


def _build_face_detectors() -> dict[str, Any]:
    frontal = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")
    profile = cv2.CascadeClassifier(cv2.data.haarcascades + "haarcascade_profileface.xml")
    mesh = None
    mp_detector = None
    if mp is not None and hasattr(mp, "solutions") and hasattr(mp.solutions, "face_detection"):
        try:
            mp_detector = mp.solutions.face_detection.FaceDetection(
                model_selection=0,
                min_detection_confidence=0.5,
            )
        except Exception:
            mp_detector = None
    if mp is not None and hasattr(mp, "solutions") and hasattr(mp.solutions, "face_mesh"):
        try:
            mesh = mp.solutions.face_mesh.FaceMesh(
                static_image_mode=False,
                max_num_faces=1,
                refine_landmarks=False,
                min_detection_confidence=0.5,
                min_tracking_confidence=0.5,
            )
        except Exception:
            mesh = None
    return {"mp": mp_detector, "mesh": mesh, "frontal": frontal, "profile": profile}


def _close_face_detectors(detectors: dict[str, Any]) -> None:
    mesh = detectors.get("mesh")
    if mesh is not None:
        try:
            mesh.close()
        except Exception:
            pass
    mp_detector = detectors.get("mp")
    if mp_detector is not None:
        try:
            mp_detector.close()
        except Exception:
            pass


def _largest_mp_face_box(
    frame: np.ndarray,
    detections: Any,
) -> tuple[int, int, int, int] | None:
    if detections is None:
        return None
    boxes: list[tuple[int, int, int, int]] = []
    h, w = frame.shape[:2]
    for detection in detections:
        try:
            rel_box = detection.location_data.relative_bounding_box
            x1 = int(rel_box.xmin * w)
            y1 = int(rel_box.ymin * h)
            x2 = int((rel_box.xmin + rel_box.width) * w)
            y2 = int((rel_box.ymin + rel_box.height) * h)
            x1 = max(0, min(w - 1, x1))
            y1 = max(0, min(h - 1, y1))
            x2 = max(0, min(w, x2))
            y2 = max(0, min(h, y2))
            bw = x2 - x1
            bh = y2 - y1
            if bw > 0 and bh > 0:
                padded = _pad_face_box(frame, (x1, y1, bw, bh))
                if padded is not None:
                    boxes.append(padded)
        except Exception:
            continue
    return _largest_face_box(boxes)


def _extract_mesh_landmarks(
    frame: np.ndarray,
    mesh_result: Any,
) -> np.ndarray | None:
    face_landmarks = getattr(mesh_result, "multi_face_landmarks", None)
    if not face_landmarks:
        return None
    lm_list = face_landmarks[0].landmark
    if not lm_list:
        return None
    h, w = frame.shape[:2]
    points: list[tuple[int, int]] = []
    for lm in lm_list:
        x = int(lm.x * w)
        y = int(lm.y * h)
        x = max(0, min(w - 1, x))
        y = max(0, min(h - 1, y))
        points.append((x, y))
    if not points:
        return None
    return np.asarray(points, dtype=np.int32)


def _track_from_landmarks(frame: np.ndarray, landmarks: np.ndarray) -> FaceTrack | None:
    if landmarks.size == 0:
        return None
    x, y, w, h = cv2.boundingRect(landmarks)
    padded = _pad_face_box(frame, (int(x), int(y), int(w), int(h)))
    if padded is None:
        return None
    return FaceTrack(box=padded, landmarks=landmarks)


def _detect_primary_face(
    frame: np.ndarray,
    gray: np.ndarray,
    detectors: dict[str, Any],
) -> FaceTrack | None:
    mesh = detectors.get("mesh")
    if mesh is not None:
        try:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            mesh_result = mesh.process(rgb)
            landmarks = _extract_mesh_landmarks(frame, mesh_result)
            if landmarks is not None:
                track = _track_from_landmarks(frame, landmarks)
                if track is not None:
                    return track
        except Exception:
            pass

    mp_detector = detectors.get("mp")
    if mp_detector is not None:
        try:
            rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            result = mp_detector.process(rgb)
            mp_face = _largest_mp_face_box(frame, getattr(result, "detections", None))
            if mp_face is not None:
                return FaceTrack(box=mp_face, landmarks=None)
        except Exception:
            # Fail open to Haar fallback if MediaPipe has runtime issues.
            pass

    frontal_detector = detectors["frontal"]
    profile_detector = detectors["profile"]
    candidates: list[tuple[int, int, int, int]] = []

    frontal_faces = frontal_detector.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(60, 60),
    )
    frontal = _largest_face_box(frontal_faces)
    if frontal is not None:
        padded = _pad_face_box(frame, frontal, x_pad_ratio=0.08, y_pad_top_ratio=0.18, y_pad_bottom_ratio=0.08)
        if padded is not None:
            candidates.append(padded)

    profile_faces = profile_detector.detectMultiScale(
        gray,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(60, 60),
    )
    left_profile = _largest_face_box(profile_faces)
    if left_profile is not None:
        padded = _pad_face_box(
            frame,
            left_profile,
            x_pad_ratio=0.10,
            y_pad_top_ratio=0.20,
            y_pad_bottom_ratio=0.08,
        )
        if padded is not None:
            candidates.append(padded)

    flipped = cv2.flip(gray, 1)
    flipped_faces = profile_detector.detectMultiScale(
        flipped,
        scaleFactor=1.1,
        minNeighbors=5,
        minSize=(60, 60),
    )
    right_profile_flipped = _largest_face_box(flipped_faces)
    if right_profile_flipped is not None:
        fx, fy, fw, fh = right_profile_flipped
        x = gray.shape[1] - (fx + fw)
        padded = _pad_face_box(
            frame,
            (x, fy, fw, fh),
            x_pad_ratio=0.10,
            y_pad_top_ratio=0.20,
            y_pad_bottom_ratio=0.08,
        )
        if padded is not None:
            candidates.append(padded)

    fallback = _largest_face_box(candidates)
    if fallback is None:
        return None
    return FaceTrack(box=fallback, landmarks=None)


def _face_region_rect(
    frame: np.ndarray,
    face_track: FaceTrack,
    x1_rel: float,
    x2_rel: float,
    y1_rel: float,
    y2_rel: float,
) -> tuple[int, int, int, int] | None:
    x, y, w, h = face_track.box
    rx1 = x + int(w * x1_rel)
    rx2 = x + int(w * x2_rel)
    ry1 = y + int(h * y1_rel)
    ry2 = y + int(h * y2_rel)

    rx1 = max(0, rx1)
    ry1 = max(0, ry1)
    rx2 = min(frame.shape[1], rx2)
    ry2 = min(frame.shape[0], ry2)

    if rx2 <= rx1 or ry2 <= ry1:
        return None
    return rx1, ry1, rx2, ry2


def _forehead_roi(frame: np.ndarray, face_track: FaceTrack) -> np.ndarray:
    rect = _face_region_rect(frame, face_track, 0.2, 0.8, 0.12, 0.38)
    if rect is None:
        return np.empty((0, 0, 3), dtype=frame.dtype)
    rx1, ry1, rx2, ry2 = rect
    return frame[ry1:ry2, rx1:rx2]


def _left_cheek_roi(frame: np.ndarray, face_track: FaceTrack) -> np.ndarray:
    rect = _face_region_rect(frame, face_track, 0.10, 0.38, 0.42, 0.76)
    if rect is None:
        return np.empty((0, 0, 3), dtype=frame.dtype)
    rx1, ry1, rx2, ry2 = rect
    return frame[ry1:ry2, rx1:rx2]


def _right_cheek_roi(frame: np.ndarray, face_track: FaceTrack) -> np.ndarray:
    rect = _face_region_rect(frame, face_track, 0.62, 0.90, 0.42, 0.76)
    if rect is None:
        return np.empty((0, 0, 3), dtype=frame.dtype)
    rx1, ry1, rx2, ry2 = rect
    return frame[ry1:ry2, rx1:rx2]


def _roi_from_landmark_indices(
    frame: np.ndarray,
    landmarks: np.ndarray,
    indices: list[int],
) -> tuple[np.ndarray, tuple[int, int, int, int] | None]:
    points = [landmarks[idx] for idx in indices if 0 <= idx < len(landmarks)]
    if len(points) < 3:
        return np.empty((0, 0, 3), dtype=frame.dtype), None
    poly = np.asarray(points, dtype=np.int32)
    hull = cv2.convexHull(poly)
    mask = np.zeros(frame.shape[:2], dtype=np.uint8)
    cv2.fillConvexPoly(mask, hull, 255)
    x, y, w, h = cv2.boundingRect(hull)
    if w <= 0 or h <= 0:
        return np.empty((0, 0, 3), dtype=frame.dtype), None
    cropped = frame[y : y + h, x : x + w]
    cropped_mask = mask[y : y + h, x : x + w]
    roi = cv2.bitwise_and(cropped, cropped, mask=cropped_mask)
    return roi, (x, y, x + w, y + h)


def _mesh_signal_rois(
    frame: np.ndarray,
    landmarks: np.ndarray,
) -> list[tuple[str, np.ndarray, tuple[int, int, int, int]]]:
    regions = [
        ("forehead", MESH_FOREHEAD_IDX),
        ("left cheek", MESH_LEFT_CHEEK_IDX),
        ("right cheek", MESH_RIGHT_CHEEK_IDX),
    ]
    out: list[tuple[str, np.ndarray, tuple[int, int, int, int]]] = []
    for name, indices in regions:
        roi, rect = _roi_from_landmark_indices(frame, landmarks, indices)
        if rect is not None and roi.size > 0:
            out.append((name, roi, rect))
    return out


def _roi_preview_rects(
    frame: np.ndarray,
    face_track: FaceTrack,
) -> list[tuple[str, tuple[int, int, int], tuple[int, int, int, int]]]:
    if face_track.landmarks is not None:
        mesh_regions = _mesh_signal_rois(frame, face_track.landmarks)
        if mesh_regions:
            colors = {
                "forehead": (24, 186, 255),
                "left cheek": (91, 219, 114),
                "right cheek": (233, 135, 61),
            }
            return [(name, colors.get(name, (200, 200, 200)), rect) for name, _, rect in mesh_regions]
    regions = [
        ("forehead", (24, 186, 255), _face_region_rect(frame, face_track, 0.2, 0.8, 0.12, 0.38)),
        ("left cheek", (91, 219, 114), _face_region_rect(frame, face_track, 0.10, 0.38, 0.42, 0.76)),
        ("right cheek", (233, 135, 61), _face_region_rect(frame, face_track, 0.62, 0.90, 0.42, 0.76)),
    ]
    return [(name, color, rect) for name, color, rect in regions if rect is not None]


def _face_signal_rois(frame: np.ndarray, face_track: FaceTrack) -> list[np.ndarray]:
    if face_track.landmarks is not None:
        mesh_regions = _mesh_signal_rois(frame, face_track.landmarks)
        if mesh_regions:
            return [roi for _, roi, _ in mesh_regions]
    rois = [
        _forehead_roi(frame, face_track),
        _left_cheek_roi(frame, face_track),
        _right_cheek_roi(frame, face_track),
    ]
    return [roi for roi in rois if roi.size > 0]


def _pulse_signal_from_face_regions(
    frame: np.ndarray,
    face_track: FaceTrack,
    signal_method: str = "hybrid",
) -> float | None:
    rois = _face_signal_rois(frame, face_track)
    if not rois:
        return None
    values = [float(_pulse_signal_from_roi(roi, signal_method=signal_method)) for roi in rois]
    if not values:
        return None
    # Median fusion is robust when one region is occluded (e.g., bangs on forehead).
    return float(np.median(np.asarray(values, dtype=np.float64)))


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
    signal_method: str = "hybrid",
) -> float:
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        return 0.0

    face_detectors = _build_face_detectors()

    signal: list[float] = []
    timestamps: list[float] = []
    last_face: FaceTrack | None = None

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
                found = _detect_primary_face(frame, gray, face_detectors)
                if found is not None:
                    last_face = found

            if last_face is None:
                if preview:
                    cv2.imshow("Zeno rPPG Capture", frame)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        break
                continue

            pulse_signal = _pulse_signal_from_face_regions(frame, last_face, signal_method=signal_method)
            if pulse_signal is not None:
                timestamp = (cv2.getTickCount() - start) / cv2.getTickFrequency()
                signal.append(pulse_signal)
                timestamps.append(timestamp)

            if preview:
                x, y, w, h = last_face.box
                cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 200, 0), 2)
                for name, color, rect in _roi_preview_rects(frame, last_face):
                    rx1, ry1, rx2, ry2 = rect
                    cv2.rectangle(frame, (rx1, ry1), (rx2, ry2), color, 2)
                    cv2.putText(
                        frame,
                        name,
                        (rx1, max(12, ry1 - 6)),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.45,
                        color,
                        1,
                        cv2.LINE_AA,
                    )
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
        _close_face_detectors(face_detectors)


def _update_point_due(now_tick: int, next_update_tick: int) -> bool:
    return now_tick >= next_update_tick


def stream_heart_rate_updates(
    camera_index: int = 0,
    update_every_seconds: float = 5.0,
    analysis_window_seconds: float = 30.0,
    warmup_seconds: float = 0.8,
    max_seconds: float = 0.0,
    preview: bool = False,
    signal_method: str = "hybrid",
) -> list[dict]:
    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        return []

    face_detectors = _build_face_detectors()

    signal: list[float] = []
    timestamps: list[float] = []
    updates: list[dict] = []
    last_face: FaceTrack | None = None

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
                found = _detect_primary_face(frame, gray, face_detectors)
                if found is not None:
                    last_face = found

            if last_face is not None:
                pulse_signal = _pulse_signal_from_face_regions(frame, last_face, signal_method=signal_method)
                if pulse_signal is not None:
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
                    x, y, w, h = last_face.box
                    cv2.rectangle(frame, (x, y), (x + w, y + h), (0, 200, 0), 2)
                    for name, color, rect in _roi_preview_rects(frame, last_face):
                        rx1, ry1, rx2, ry2 = rect
                        cv2.rectangle(frame, (rx1, ry1), (rx2, ry2), color, 2)
                        cv2.putText(
                            frame,
                            name,
                            (rx1, max(12, ry1 - 6)),
                            cv2.FONT_HERSHEY_SIMPLEX,
                            0.45,
                            color,
                            1,
                            cv2.LINE_AA,
                        )
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
        _close_face_detectors(face_detectors)


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
    parser.add_argument(
        "--signal-method",
        choices=["chrom", "lab", "hybrid"],
        default="hybrid",
        help="Pulse extraction method: chrom, lab, or hybrid (default: hybrid).",
    )
    args = parser.parse_args()

    if args.continuous:
        try:
            stream_heart_rate_updates(
                update_every_seconds=args.update_every,
                analysis_window_seconds=args.window_seconds,
                max_seconds=args.max_seconds,
                preview=args.preview,
                signal_method=args.signal_method,
            )
        except KeyboardInterrupt:
            pass
        return

    bpm = estimate_heart_rate(
        capture_seconds=args.seconds,
        preview=args.preview,
        signal_method=args.signal_method,
    )
    timestamp = datetime.now().isoformat(timespec="seconds")
    if bpm > 0:
        print(f"[{timestamp}] heart_rate_bpm={bpm:.1f}")
    else:
        print(f"[{timestamp}] heart_rate_bpm=unknown")


if __name__ == "__main__":
    main()
