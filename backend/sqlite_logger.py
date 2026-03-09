from __future__ import annotations

import argparse
import json
import sqlite3
from datetime import datetime
from pathlib import Path

from db_schema import ensure_sessions_schema
from session_runner import run_session

DEFAULT_DB_PATH = Path(__file__).resolve().parent / "data" / "zeno_sessions.db"


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with sqlite3.connect(db_path) as conn:
        ensure_sessions_schema(conn)
        conn.commit()


def _sync_baseline_for_posture(conn: sqlite3.Connection, posture_score: float) -> tuple[float, float, bool]:
    baseline_row = conn.execute(
        """
        SELECT posture_baseline_score, calibration_sessions_completed, is_calibrated
        FROM baseline
        WHERE id = 1
        """
    ).fetchone()
    baseline_score = float(baseline_row[0]) if baseline_row and baseline_row[0] is not None else None
    sessions_completed = int(baseline_row[1]) if baseline_row else 0
    is_calibrated = bool(baseline_row[2]) if baseline_row else False

    if not is_calibrated:
        new_completed = min(3, sessions_completed + 1)
        if baseline_score is None:
            new_baseline = float(posture_score)
        else:
            new_baseline = ((baseline_score * sessions_completed) + float(posture_score)) / max(
                1, new_completed
            )
        new_calibrated = new_completed >= 3
        conn.execute(
            """
            UPDATE baseline
            SET
              updated_at = CURRENT_TIMESTAMP,
              posture_baseline_score = ?,
              calibration_sessions_completed = ?,
              is_calibrated = ?
            WHERE id = 1
            """,
            (float(new_baseline), int(new_completed), 1 if new_calibrated else 0),
        )
        return float(new_baseline), 0.0, False

    if baseline_score is None or baseline_score <= 0:
        baseline_score = float(posture_score)

    posture_deviation = max(0.0, (baseline_score - float(posture_score)) / baseline_score)
    drifted_baseline = (baseline_score * 0.98) + (float(posture_score) * 0.02)
    conn.execute(
        """
        UPDATE baseline
        SET
          updated_at = CURRENT_TIMESTAMP,
          posture_baseline_score = ?
        WHERE id = 1
        """,
        (float(drifted_baseline),),
    )
    return float(baseline_score), float(posture_deviation), True


def log_session(result: dict, db_path: Path) -> int:
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        posture_score = float(result["posture_score"])
        baseline_score, posture_deviation, is_calibrated = _sync_baseline_for_posture(
            conn, posture_score
        )
        posture_is_poor = 1 if is_calibrated and posture_deviation > 0.15 else 0

        result["baseline_posture_score"] = baseline_score
        result["posture_deviation"] = posture_deviation
        result["posture_is_poor"] = bool(posture_is_poor)

        cursor = conn.execute(
            """
            INSERT INTO sessions (
                created_at,
                presence_detected,
                analysis_skipped,
                posture_score,
                baseline_posture_score,
                posture_deviation,
                posture_is_poor,
                dominant_emotion,
                emotion_score,
                heart_rate_bpm,
                respiratory_rate,
                rr_confidence,
                emotion_backend,
                mode,
                focus_duration_seconds,
                focus_mode,
                notification_sent,
                notification_dismissed_by,
                session_duration_seconds,
                raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                result["timestamp"],
                1 if result["presence_detected"] else 0,
                1 if result.get("analysis_skipped") else 0,
                posture_score,
                baseline_score,
                posture_deviation,
                posture_is_poor,
                str(result["dominant_emotion"]),
                float(result["emotion_score"]),
                None if result["heart_rate_bpm"] is None else float(result["heart_rate_bpm"]),
                float(result.get("respiratory_rate", 0.0)),
                str(result.get("rr_confidence", "none")),
                str(result["emotion_backend"]),
                str(result.get("mode", "passive")),
                int(result.get("focus_duration_seconds", 0)),
                1 if result.get("focus_mode") else 0,
                "none",
                "none",
                float(result["session_duration_seconds"]),
                json.dumps(result),
            ),
        )
        conn.commit()
        return int(cursor.lastrowid)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Run one session and store results in local SQLite."
    )
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB_PATH),
        help="SQLite database path (default: backend/data/zeno_sessions.db).",
    )
    parser.add_argument(
        "--preview",
        action="store_true",
        help="Show capture previews while running analyzers.",
    )
    parser.add_argument(
        "--emotion-backend",
        choices=["fer", "hsemotion"],
        default="hsemotion",
        help="Emotion backend for session runner.",
    )
    parser.add_argument(
        "--hsemotion-model",
        default="enet_b0_8_best_afew",
        help="HSEmotion model name.",
    )
    parser.add_argument(
        "--hsemotion-model-path",
        default=None,
        help="Local HSEmotion .pt model path.",
    )
    parser.add_argument(
        "--focus-mode",
        action="store_true",
        help="Mark this session as captured during Focus Mode.",
    )
    args = parser.parse_args()

    result = run_session(
        emotion_backend=args.emotion_backend,
        preview=args.preview,
        focus_mode=bool(args.focus_mode),
        shared_camera=not bool(args.focus_mode),
        passive_duration_seconds=30.0,
        hsemotion_model=args.hsemotion_model,
        hsemotion_model_path=args.hsemotion_model_path,
    )
    result["focus_mode"] = bool(args.focus_mode)

    db_path = Path(args.db_path).expanduser().resolve()
    row_id = None
    if not result.get("analysis_skipped"):
        row_id = log_session(result, db_path)

    output = {
        "inserted_id": row_id,
        "db_path": str(db_path),
        "logged_at": datetime.now().isoformat(timespec="seconds"),
        "skipped": bool(result.get("analysis_skipped")),
        "session": result,
    }
    print(json.dumps(output))


if __name__ == "__main__":
    main()
