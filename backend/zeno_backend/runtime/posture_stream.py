from __future__ import annotations

import argparse
import base64
import json
import sys
import time
from collections import deque
from datetime import datetime
from pathlib import Path
from urllib.request import urlretrieve

import cv2
import mediapipe as mp

POSE_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/pose_landmarker/"
    "pose_landmarker_lite/float16/latest/pose_landmarker_lite.task"
)
POSE_MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "pose_landmarker_lite.task"

NOSE = 0
LEFT_SHOULDER = 11
RIGHT_SHOULDER = 12
LEFT_ELBOW = 13
RIGHT_ELBOW = 14
LEFT_WRIST = 15
RIGHT_WRIST = 16
LEFT_HIP = 23
RIGHT_HIP = 24


def _ensure_pose_model() -> Path:
    if POSE_MODEL_PATH.exists():
        return POSE_MODEL_PATH

    POSE_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    urlretrieve(POSE_MODEL_URL, POSE_MODEL_PATH)
    return POSE_MODEL_PATH


def _clamp(value: float, low: float = 0.0, high: float = 1.0) -> float:
    return max(low, min(value, high))


def _posture_score_from_landmarks(landmarks) -> float:
    nose = landmarks[NOSE]
    left_shoulder = landmarks[LEFT_SHOULDER]
    right_shoulder = landmarks[RIGHT_SHOULDER]

    shoulder_width = abs(left_shoulder.x - right_shoulder.x)
    if shoulder_width < 1e-6:
        return 0.0

    shoulder_mid_y = (left_shoulder.y + right_shoulder.y) / 2.0
    vertical_head_offset = shoulder_mid_y - nose.y
    head_upright = _clamp(vertical_head_offset / (shoulder_width * 1.2))

    shoulder_tilt = abs(left_shoulder.y - right_shoulder.y) / shoulder_width
    shoulder_alignment = 1.0 - _clamp(shoulder_tilt / 0.35)

    score = 0.7 * head_upright + 0.3 * shoulder_alignment
    return round(_clamp(score), 3)


def _point_payload(landmark) -> dict[str, float]:
    return {
        "x": round(float(landmark.x), 5),
        "y": round(float(landmark.y), 5),
        "visibility": round(float(getattr(landmark, "visibility", 0.0)), 5),
    }


def _exercise_features(landmarks) -> dict[str, float | bool]:
    nose = landmarks[NOSE]
    left_shoulder = landmarks[LEFT_SHOULDER]
    right_shoulder = landmarks[RIGHT_SHOULDER]
    left_elbow = landmarks[LEFT_ELBOW]
    right_elbow = landmarks[RIGHT_ELBOW]
    left_wrist = landmarks[LEFT_WRIST]
    right_wrist = landmarks[RIGHT_WRIST]
    left_hip = landmarks[LEFT_HIP]
    right_hip = landmarks[RIGHT_HIP]

    shoulder_width = abs(left_shoulder.x - right_shoulder.x)
    shoulder_mid_x = (left_shoulder.x + right_shoulder.x) / 2.0
    shoulder_mid_y = (left_shoulder.y + right_shoulder.y) / 2.0
    shoulder_tilt_signed = (left_shoulder.y - right_shoulder.y) / max(shoulder_width, 1e-6)
    shoulder_tilt = abs(shoulder_tilt_signed)
    # Lateral head offset normalized by shoulder width (negative=left, positive=right in mirrored UI mapping).
    head_offset_norm = (shoulder_mid_x - nose.x) / max(shoulder_width, 1e-6)
    # Forward/upright proxy kept for exercise gating logic.
    head_forward_norm = (shoulder_mid_y - nose.y) / max(shoulder_width, 1e-6)
    left_upper_arm = abs(left_shoulder.y - left_elbow.y) / max(shoulder_width, 1e-6)
    right_upper_arm = abs(right_shoulder.y - right_elbow.y) / max(shoulder_width, 1e-6)
    wrists_above_shoulders = left_wrist.y < left_shoulder.y and right_wrist.y < right_shoulder.y
    wrists_at_shoulder_band = (
        abs(left_wrist.y - left_shoulder.y) / max(shoulder_width, 1e-6) < 0.2
        and abs(right_wrist.y - right_shoulder.y) / max(shoulder_width, 1e-6) < 0.2
    )
    one_wrist_above_head = min(left_wrist.y, right_wrist.y) < nose.y * 0.97
    torso_upright = abs(((left_hip.y + right_hip.y) / 2.0) - shoulder_mid_y) > 0.1

    return {
        "shoulder_width": shoulder_width,
        "shoulder_tilt_signed_norm": shoulder_tilt_signed,
        "shoulder_tilt_norm": shoulder_tilt,
        "head_offset_norm": head_offset_norm,
        "head_forward_norm": head_forward_norm,
        "elbows_bent": left_upper_arm < 0.23 and right_upper_arm < 0.23,
        "wrists_above_shoulders": wrists_above_shoulders,
        "wrists_at_shoulder_band": wrists_at_shoulder_band,
        "wrist_spread_wide": abs(left_wrist.x - right_wrist.x) > shoulder_width * 0.95,
        "one_wrist_above_head": one_wrist_above_head,
        "torso_upright": torso_upright,
    }


def _tracking_confidence(landmarks) -> float:
    values = [
        float(getattr(landmarks[NOSE], "visibility", 0.0)),
        float(getattr(landmarks[LEFT_SHOULDER], "visibility", 0.0)),
        float(getattr(landmarks[RIGHT_SHOULDER], "visibility", 0.0)),
    ]
    return sum(values) / max(len(values), 1)


def _exercise_feedback(exercise_id: str | None, landmarks, posture_score: float) -> str | None:
    if not exercise_id or landmarks is None:
        return None

    features = _exercise_features(landmarks)

    if posture_score < 0.45:
        return "Lift your chest and stack head over shoulders."

    if exercise_id == "chin-tuck":
        if features["head_forward_norm"] < 0.26:
            return "Gently draw the chin back."
        if features["shoulder_tilt_norm"] > 0.14:
            return "Level your shoulders before next rep."
    if exercise_id == "scap-squeeze":
        if features["shoulder_tilt_norm"] > 0.12:
            return "Keep both shoulders level."
        if features["head_forward_norm"] < 0.24:
            return "Stay tall and avoid neck drift."
    if exercise_id == "thoracic-extension":
        if features["head_forward_norm"] < 0.3:
            return "Lift through your sternum slightly more."
    if exercise_id == "wall-angels":
        if not features["wrists_above_shoulders"]:
            return "Raise wrists a bit higher."
        if not features["elbows_bent"]:
            return "Keep elbows bent and wrists aligned."
    if exercise_id == "doorway-pec-stretch":
        if not features["wrists_at_shoulder_band"]:
            return "Keep forearms around shoulder height."
        if not features["wrist_spread_wide"]:
            return "Open your chest by widening your arms."
    if exercise_id == "seated-side-bend":
        if not features["one_wrist_above_head"]:
            return "Reach one arm overhead."
        if features["shoulder_tilt_norm"] < 0.1:
            return "Lean slightly more to find a side stretch."
        if features["shoulder_tilt_norm"] > 0.18:
            return "Ease the bend slightly and stay long."

    if exercise_id in {"wall-angels", "doorway-pec-stretch"} and features["shoulder_tilt_norm"] > 0.18:
        return "Level your shoulders before next rep."
    if exercise_id in {"chin-tuck", "scap-squeeze", "thoracic-extension"} and features["head_forward_norm"] < 0.22:
        return "Lengthen through the neck and upper spine."

    return "Good form. Keep breathing steadily."


def _exercise_target_active(exercise_id: str, landmarks) -> bool:
    features = _exercise_features(landmarks)

    if exercise_id == "chin-tuck":
        return bool(features["head_forward_norm"] > 0.28 and features["shoulder_tilt_norm"] < 0.16)
    if exercise_id == "scap-squeeze":
        return bool(features["shoulder_tilt_norm"] < 0.1 and features["head_forward_norm"] > 0.24)
    if exercise_id == "thoracic-extension":
        return bool(features["head_forward_norm"] > 0.31 and features["torso_upright"])
    if exercise_id == "wall-angels":
        return bool(features["wrists_above_shoulders"] and features["elbows_bent"] and features["shoulder_tilt_norm"] < 0.14)
    if exercise_id == "doorway-pec-stretch":
        return bool(features["wrists_at_shoulder_band"] and features["wrist_spread_wide"])
    if exercise_id == "seated-side-bend":
        return bool(features["one_wrist_above_head"] and features["shoulder_tilt_norm"] > 0.1)
    return False


def _exercise_target_reps(exercise_id: str) -> int:
    if exercise_id in {"wall-angels", "thoracic-extension"}:
        return 8
    if exercise_id == "doorway-pec-stretch":
        return 6
    return 10


def run_stream(camera_index: int, fps: float, jpeg_quality: int, exercise_id: str | None) -> int:
    fps = max(1.0, min(30.0, fps))
    quality = max(40, min(95, jpeg_quality))
    frame_interval = 1.0 / fps

    cap = cv2.VideoCapture(camera_index)
    if not cap.isOpened():
        print(json.dumps({"error": "Unable to open camera"}), flush=True)
        return 1

    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    options = vision.PoseLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(_ensure_pose_model())),
        running_mode=vision.RunningMode.VIDEO,
        min_pose_detection_confidence=0.5,
        min_pose_presence_confidence=0.5,
        min_tracking_confidence=0.5,
        num_poses=1,
    )
    exercise_state = {
        "rep_count": 0,
        "hold_seconds": 0.0,
        "active_frames": 0,
        "inactive_frames": 0,
        "stable_active": False,
        "quality_ema": 0.0,
        "last_tick": time.perf_counter(),
    }
    posture_window: deque[float] = deque(maxlen=60)

    try:
        with vision.PoseLandmarker.create_from_options(options) as landmarker:
            while True:
                tick = time.perf_counter()
                ok, frame = cap.read()
                if not ok:
                    break

                rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb_frame)
                timestamp_ms = int(time.time() * 1000)
                result = landmarker.detect_for_video(mp_image, timestamp_ms)

                landmarks_payload = None
                posture_score = 0.0
                tracking_confidence = 0.0
                head_offset_norm = 0.0
                shoulder_tilt_signed_norm = 0.0
                shoulder_tilt_norm = 0.0
                feedback = None
                exercise_metrics = None
                if result.pose_landmarks:
                    landmarks = result.pose_landmarks[0]
                    landmarks_payload = {
                        "nose": _point_payload(landmarks[NOSE]),
                        "left_shoulder": _point_payload(landmarks[LEFT_SHOULDER]),
                        "right_shoulder": _point_payload(landmarks[RIGHT_SHOULDER]),
                    }
                    posture_score = _posture_score_from_landmarks(landmarks)
                    tracking_confidence = float(_tracking_confidence(landmarks))
                    features = _exercise_features(landmarks)
                    head_offset_norm = float(features["head_offset_norm"])
                    shoulder_tilt_signed_norm = float(features["shoulder_tilt_signed_norm"])
                    shoulder_tilt_norm = float(features["shoulder_tilt_norm"])
                    posture_window.append(posture_score)
                    feedback = _exercise_feedback(exercise_id, landmarks, posture_score)
                    if exercise_id:
                        now_tick = time.perf_counter()
                        elapsed = max(0.0, now_tick - float(exercise_state["last_tick"]))
                        exercise_state["last_tick"] = now_tick

                        raw_active = _exercise_target_active(exercise_id, landmarks)
                        if raw_active:
                            exercise_state["active_frames"] = int(exercise_state["active_frames"]) + 1
                            exercise_state["inactive_frames"] = 0
                        else:
                            exercise_state["inactive_frames"] = int(exercise_state["inactive_frames"]) + 1
                            exercise_state["active_frames"] = 0

                        stable_active = bool(exercise_state["stable_active"])
                        if not stable_active and int(exercise_state["active_frames"]) >= 2:
                            stable_active = True
                            exercise_state["rep_count"] = int(exercise_state["rep_count"]) + 1
                        if stable_active and int(exercise_state["inactive_frames"]) >= 2:
                            stable_active = False
                        exercise_state["stable_active"] = stable_active

                        if stable_active:
                            exercise_state["hold_seconds"] = float(exercise_state["hold_seconds"]) + elapsed

                        previous_q = float(exercise_state["quality_ema"])
                        exercise_state["quality_ema"] = (
                            posture_score if previous_q <= 0 else previous_q * 0.9 + posture_score * 0.1
                        )
                        target_reps = _exercise_target_reps(exercise_id)
                        rep_count = int(exercise_state["rep_count"])
                        hold_seconds = round(float(exercise_state["hold_seconds"]), 1)
                        progress_pct = min(100, int((rep_count / max(1, target_reps)) * 100))
                        exercise_metrics = {
                            "rep_count": rep_count,
                            "target_reps": target_reps,
                            "hold_seconds": hold_seconds,
                            "quality_score": round(float(exercise_state["quality_ema"]), 3),
                            "target_active": stable_active,
                            "progress_pct": progress_pct,
                        }
                elif exercise_id:
                    exercise_state["active_frames"] = 0
                    exercise_state["inactive_frames"] = int(exercise_state["inactive_frames"]) + 1
                    if int(exercise_state["inactive_frames"]) >= 2:
                        exercise_state["stable_active"] = False

                ok, encoded = cv2.imencode(
                    ".jpg",
                    frame,
                    [int(cv2.IMWRITE_JPEG_QUALITY), quality],
                )
                if not ok:
                    continue

                if len(posture_window) >= 3:
                    mean_score = sum(posture_window) / len(posture_window)
                    variance = sum((score - mean_score) ** 2 for score in posture_window) / len(posture_window)
                    stability_std = variance ** 0.5
                    stability_label = "stable" if stability_std < 0.06 else "moderate" if stability_std < 0.12 else "variable"
                else:
                    stability_std = 0.0
                    stability_label = "learning"

                payload = {
                    "timestamp": datetime.now().isoformat(timespec="seconds"),
                    "frame_jpeg_b64": base64.b64encode(encoded).decode("ascii"),
                    "landmarks": landmarks_payload,
                    "posture_score": posture_score,
                    "tracking_confidence": round(float(tracking_confidence), 5),
                    "head_offset_norm": round(float(head_offset_norm), 5),
                    "shoulder_tilt_signed_norm": round(float(shoulder_tilt_signed_norm), 5),
                    "shoulder_tilt_norm": round(float(shoulder_tilt_norm), 5),
                    "posture_stability_std": round(float(stability_std), 5),
                    "posture_stability_label": stability_label,
                    "exercise_feedback": feedback,
                    "exercise_metrics": exercise_metrics,
                }
                print(json.dumps(payload), flush=True)

                sleep_time = frame_interval - (time.perf_counter() - tick)
                if sleep_time > 0:
                    time.sleep(sleep_time)
    except KeyboardInterrupt:
        pass
    finally:
        cap.release()

    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Continuous posture stream (JSON lines).")
    parser.add_argument("--camera-index", type=int, default=0)
    parser.add_argument("--fps", type=float, default=8.0)
    parser.add_argument("--jpeg-quality", type=int, default=72)
    parser.add_argument("--exercise-id", type=str, default=None)
    args = parser.parse_args()

    code = run_stream(
        camera_index=args.camera_index,
        fps=args.fps,
        jpeg_quality=args.jpeg_quality,
        exercise_id=args.exercise_id,
    )
    sys.exit(code)


if __name__ == "__main__":
    main()
