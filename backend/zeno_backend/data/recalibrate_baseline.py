from __future__ import annotations

import argparse
import json
import sqlite3
import time
from pathlib import Path

from zeno_backend.analyzers.posture_analyzer import PostureAnalyzer
from zeno_backend.core.camera_manager import CameraManager
from zeno_backend.data.db_schema import ensure_sessions_schema

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


def _mean(values: list[float]) -> float:
    if not values:
        return 0.0
    return sum(values) / len(values)


def recalibrate_baseline(db_path: Path, seconds: float) -> dict:
    target_seconds = max(10.0, min(60.0, float(seconds)))
    manager = CameraManager()
    posture = PostureAnalyzer()
    samples: list[dict] = []
    accepted: list[dict] = []

    try:
        posture.start_live(manager)
    except RuntimeError as exc:
        return {"ok": False, "error": f"Unable to start camera: {exc}"}

    started = time.perf_counter()
    warmup_deadline = started + 1.2
    deadline = started + target_seconds
    try:
        while time.perf_counter() < deadline:
            time.sleep(0.2)
            metrics = posture.latest_metrics()
            score = float(metrics.get("posture_score", 0.0))
            confidence = float(metrics.get("tracking_confidence", 0.0))
            ear = float(metrics.get("ear_shoulder_offset", 0.0))
            neck = float(metrics.get("neck_spine_angle", 0.0))
            if score <= 0.0 or time.perf_counter() < warmup_deadline:
                continue
            row = {
                "score": score,
                "confidence": confidence,
                "ear": ear,
                "neck": neck,
            }
            samples.append(row)
            if confidence >= 0.65 and score >= 0.22 and 95.0 <= neck <= 180.0:
                accepted.append(row)
    finally:
        posture.stop_live(manager)
        manager.stop()

    min_accepted = max(10, int(target_seconds * 2.0))
    if len(accepted) < min_accepted:
        return {
            "ok": False,
            "error": "Not enough stable posture samples. Keep shoulders and head centered, then retry.",
            "seconds": round(target_seconds, 1),
            "samples": len(samples),
            "accepted_samples": len(accepted),
            "required_samples": min_accepted,
        }

    baseline_score = round(_mean([row["score"] for row in accepted]), 4)
    baseline_ear = round(_mean([row["ear"] for row in accepted]), 5)
    baseline_neck = round(_mean([row["neck"] for row in accepted]), 3)
    avg_confidence = _mean([row["confidence"] for row in accepted])

    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        ensure_sessions_schema(conn)
        row = conn.execute(
            "SELECT posture_baseline_samples, baseline_confidence FROM baseline WHERE id = 1"
        ).fetchone()
        baseline_samples = int(row[0]) if row and row[0] is not None else 0
        previous_confidence = float(row[1]) if row and row[1] is not None else 0.0
        new_samples = baseline_samples + len(accepted)
        new_confidence = max(previous_confidence, min(1.0, avg_confidence * 0.95 + 0.1))
        conn.execute(
            """
            UPDATE baseline
            SET
              updated_at = CURRENT_TIMESTAMP,
              ear_shoulder_offset = ?,
              neck_spine_angle = ?,
              posture_baseline_score = ?,
              calibration_sessions_completed = 3,
              is_calibrated = 1,
              posture_baseline_samples = ?,
              baseline_confidence = ?
            WHERE id = 1
            """,
            (
                baseline_ear,
                baseline_neck,
                baseline_score,
                int(new_samples),
                float(round(new_confidence, 4)),
            ),
        )
        conn.commit()

    return {
        "ok": True,
        "seconds": round(target_seconds, 1),
        "samples": len(samples),
        "accepted_samples": len(accepted),
        "baseline_posture_score": baseline_score,
        "baseline_ear_shoulder_offset": baseline_ear,
        "baseline_neck_spine_angle": baseline_neck,
        "baseline_confidence": round(float(new_confidence), 4),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Recalculate posture baseline from live camera samples.")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--seconds", type=float, default=10.0)
    args = parser.parse_args()

    payload = recalibrate_baseline(
        db_path=Path(args.db_path).expanduser().resolve(),
        seconds=args.seconds,
    )
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
