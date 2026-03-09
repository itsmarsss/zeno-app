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


def _baseline_posture_score(conn: sqlite3.Connection) -> float | None:
    rows = conn.execute(
        """
        SELECT posture_score
        FROM sessions
        WHERE presence_detected = 1 AND analysis_skipped = 0
        ORDER BY id ASC
        LIMIT 3
        """
    ).fetchall()
    if len(rows) < 3:
        return None
    return float(sum(float(row[0]) for row in rows) / 3.0)


def log_session(result: dict, db_path: Path) -> int:
    init_db(db_path)
    with sqlite3.connect(db_path) as conn:
        baseline_score = _baseline_posture_score(conn)
        posture_score = float(result["posture_score"])
        posture_deviation = 0.0
        posture_is_poor = 0
        if baseline_score and baseline_score > 0:
            posture_deviation = max(0.0, (baseline_score - posture_score) / baseline_score)
            posture_is_poor = 1 if posture_deviation > 0.15 else 0
        else:
            baseline_score = 0.0

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
                emotion_backend,
                focus_mode,
                notification_sent,
                notification_dismissed_by,
                session_duration_seconds,
                raw_json
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
                str(result["emotion_backend"]),
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
