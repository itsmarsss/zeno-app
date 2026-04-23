from __future__ import annotations

import math


def _safe_float(value: float | int | None, default: float) -> float:
    if value is None:
        return default
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    return number


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
    emotion = (dominant_emotion or "unknown").lower().strip()
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
    score = max(0.0, min(1.0, _safe_float(emotion_score, 0.0)))
    emotion_points *= max(score, 0.25)

    resting_hr_value = max(40.0, min(120.0, _safe_float(resting_hr, 75.0)))
    resting_rr_value = max(8.0, min(30.0, _safe_float(resting_rr, 14.0)))

    if heart_rate_bpm is None:
        hr_points = 0.0
    else:
        hr = _safe_float(heart_rate_bpm, 0.0)
        if hr < 35.0 or hr > 200.0:
            hr_points = 0.0
        else:
            hr_points = max(0.0, min(100.0, (hr - resting_hr_value) * 3.2))

    rr = _safe_float(respiratory_rate, 0.0)
    if rr <= 0 or rr < 6.0 or rr > 40.0:
        rr_points = 0.0
    else:
        rr_points = max(0.0, min(100.0, (rr - resting_rr_value) * 6.0))

    mode_text = str(mode or "passive").strip().lower()
    rr_conf = str(rr_confidence or "none").strip().lower()
    if mode_text == "focus" and rr_conf == "full":
        hr_weight, rr_weight, emotion_weight = 0.35, 0.30, 0.35
    elif mode_text == "focus" and rr_conf == "partial":
        hr_weight, rr_weight, emotion_weight = 0.40, 0.15, 0.45
    else:
        hr_weight, rr_weight, emotion_weight = 0.50, 0.00, 0.50
        # Ignore RR contribution outside Focus Mode or without confidence.
        rr_points = 0.0

    weighted = hr_points * hr_weight + rr_points * rr_weight + emotion_points * emotion_weight
    return int(max(0, min(100, round(weighted))))
