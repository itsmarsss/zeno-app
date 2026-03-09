from __future__ import annotations

import argparse
import json
from pathlib import Path
from urllib.request import urlretrieve

import cv2
import mediapipe as mp

HAND_MODEL_URL = (
    "https://storage.googleapis.com/mediapipe-models/hand_landmarker/"
    "hand_landmarker/float16/latest/hand_landmarker.task"
)
HAND_MODEL_PATH = Path(__file__).resolve().parents[2] / "models" / "hand_landmarker.task"


FINGER_TIPS = {
    "thumb": 4,
    "index": 8,
    "middle": 12,
    "ring": 16,
    "pinky": 20,
}
FINGER_PIPS = {
    "thumb": 3,
    "index": 6,
    "middle": 10,
    "ring": 14,
    "pinky": 18,
}


def _ensure_model() -> Path:
    if HAND_MODEL_PATH.exists():
        return HAND_MODEL_PATH
    HAND_MODEL_PATH.parent.mkdir(parents=True, exist_ok=True)
    urlretrieve(HAND_MODEL_URL, HAND_MODEL_PATH)
    return HAND_MODEL_PATH


def _is_open_palm(landmarks) -> bool:
    wrist = landmarks[0]

    # For most camera setups, extended fingers have lower y than wrist.
    extended = 0
    for finger in ("index", "middle", "ring", "pinky"):
        tip = landmarks[FINGER_TIPS[finger]]
        pip = landmarks[FINGER_PIPS[finger]]
        if tip.y < pip.y and tip.y < wrist.y:
            extended += 1

    # Thumb extension uses x-axis difference from thumb IP joint.
    thumb_tip = landmarks[FINGER_TIPS["thumb"]]
    thumb_ip = landmarks[FINGER_PIPS["thumb"]]
    thumb_extended = abs(thumb_tip.x - thumb_ip.x) > 0.03

    return extended >= 4 and thumb_extended


def detect_open_palm_hold(
    hold_seconds: float = 1.0,
    max_seconds: float = 10.0,
    preview: bool = False,
    min_hand_presence_confidence: float = 0.5,
) -> bool:
    cap = cv2.VideoCapture(0)
    if not cap.isOpened():
        return False

    from mediapipe.tasks import python as mp_python
    from mediapipe.tasks.python import vision

    options = vision.HandLandmarkerOptions(
        base_options=mp_python.BaseOptions(model_asset_path=str(_ensure_model())),
        num_hands=1,
        running_mode=vision.RunningMode.IMAGE,
        min_hand_detection_confidence=min_hand_presence_confidence,
        min_tracking_confidence=min_hand_presence_confidence,
        min_hand_presence_confidence=min_hand_presence_confidence,
    )

    hold_started_at: float | None = None
    start_ticks = cv2.getTickCount()
    tick_freq = cv2.getTickFrequency()

    try:
        with vision.HandLandmarker.create_from_options(options) as landmarker:
            while True:
                elapsed = (cv2.getTickCount() - start_ticks) / tick_freq
                if elapsed > max_seconds:
                    return False

                ok, frame = cap.read()
                if not ok:
                    continue

                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=rgb)
                result = landmarker.detect(mp_image)

                open_palm = False
                if result.hand_landmarks:
                    open_palm = _is_open_palm(result.hand_landmarks[0])

                if open_palm:
                    if hold_started_at is None:
                        hold_started_at = elapsed
                    elif (elapsed - hold_started_at) >= hold_seconds:
                        return True
                else:
                    hold_started_at = None

                if preview:
                    status_text = "Hold open palm..."
                    if hold_started_at is not None:
                        held_for = elapsed - hold_started_at
                        status_text = f"Holding: {held_for:0.1f}/{hold_seconds:0.1f}s"
                    cv2.putText(
                        frame,
                        status_text,
                        (12, 28),
                        cv2.FONT_HERSHEY_SIMPLEX,
                        0.8,
                        (0, 220, 0),
                        2,
                        cv2.LINE_AA,
                    )
                    cv2.imshow("Zeno Gesture Dismiss", frame)
                    if cv2.waitKey(1) & 0xFF == ord("q"):
                        return False
    finally:
        if preview:
            cv2.destroyAllWindows()
        cap.release()


def main() -> None:
    parser = argparse.ArgumentParser(description="Open-palm dismissal detector.")
    parser.add_argument("--preview", action="store_true", help="Show camera preview window.")
    parser.add_argument(
        "--hold-seconds",
        type=float,
        default=1.0,
        help="Required continuous open-palm hold duration.",
    )
    parser.add_argument(
        "--max-seconds",
        type=float,
        default=10.0,
        help="Maximum wait time for gesture detection.",
    )
    args = parser.parse_args()

    dismissed = detect_open_palm_hold(
        hold_seconds=args.hold_seconds,
        max_seconds=args.max_seconds,
        preview=args.preview,
    )
    print(json.dumps({"dismissed": dismissed}))


if __name__ == "__main__":
    main()
