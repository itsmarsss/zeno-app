from __future__ import annotations


def compute_stress_index(
    *,
    dominant_emotion: str,
    emotion_score: float,
    heart_rate_bpm: float | None,
    respiratory_rate: float | None,
    rr_confidence: str,
    mode: str,
    resting_hr: float,
    resting_rr: float,
) -> int:
    emotion = (dominant_emotion or "unknown").lower()
    emotion_points = {
        "happy": 20.0,
        "happiness": 20.0,
        "neutral": 35.0,
        "surprise": 45.0,
        "sad": 55.0,
        "sadness": 55.0,
        "disgust": 70.0,
        "contempt": 70.0,
        "angry": 85.0,
        "anger": 85.0,
        "fear": 85.0,
    }.get(emotion, 50.0)
    emotion_points *= max(float(emotion_score), 0.25)

    if heart_rate_bpm is None:
        hr_points = 0.0
    else:
        hr_points = max(0.0, min(100.0, (float(heart_rate_bpm) - float(resting_hr)) * 3.2))

    rr = float(respiratory_rate or 0.0)
    if rr <= 0:
        rr_points = 0.0
    else:
        rr_points = max(0.0, min(100.0, (rr - float(resting_rr)) * 6.0))

    mode_text = str(mode or "passive")
    rr_conf = str(rr_confidence or "none")
    if mode_text == "focus" and rr_conf == "full":
        hr_weight, rr_weight, emotion_weight = 0.35, 0.30, 0.35
    elif mode_text == "focus" and rr_conf == "partial":
        hr_weight, rr_weight, emotion_weight = 0.40, 0.15, 0.45
    else:
        hr_weight, rr_weight, emotion_weight = 0.50, 0.00, 0.50

    weighted = hr_points * hr_weight + rr_points * rr_weight + emotion_points * emotion_weight
    return int(max(0, min(100, round(weighted))))
