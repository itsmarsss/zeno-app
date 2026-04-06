from __future__ import annotations

import argparse
import csv
import json
from datetime import datetime
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema
from zeno_backend.data.db_utils import connect_db

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"
DEFAULT_EXPORT_DIR = Path(__file__).resolve().parents[2] / "data" / "exports"

EXPORT_COLUMNS = [
    "id",
    "created_at",
    "presence_detected",
    "analysis_skipped",
    "posture_score",
    "tracking_confidence",
    "head_offset_norm",
    "shoulder_tilt_signed_norm",
    "shoulder_tilt_norm",
    "posture_stability_std",
    "posture_stability_label",
    "posture_state",
    "posture_dominant_issue",
    "posture_signal_quality",
    "posture_nudge_eligible",
    "baseline_posture_score",
    "posture_deviation",
    "posture_is_poor",
    "dominant_emotion",
    "emotion_score",
    "stress_index",
    "heart_rate_bpm",
    "respiratory_rate",
    "rr_confidence",
    "emotion_backend",
    "mode",
    "focus_session_id",
    "focus_duration_seconds",
    "focus_mode",
    "notification_sent",
    "notification_dismissed_by",
    "session_duration_seconds",
]


def export_sessions_csv(db_path: Path, output_dir: Path) -> Path:
    from zeno_backend.data.db_utils import ensure_exercise_sessions_table

    output_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    output_path = output_dir / f"sessions-{stamp}.csv"
    exercise_path = output_dir / f"exercises-{stamp}.csv"

    with connect_db(db_path) as conn:
        ensure_sessions_schema(conn)
        ensure_exercise_sessions_table(conn)
        rows = conn.execute(
            f"""
            SELECT
              {", ".join(EXPORT_COLUMNS)}
            FROM sessions
            ORDER BY id DESC
            """
        ).fetchall()
        exercise_rows = conn.execute(
            """
            SELECT id, timestamp, exercise_id, completed, form_score, duration_seconds, triggered_by
            FROM exercise_sessions
            ORDER BY id DESC
            """
        ).fetchall()

    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(EXPORT_COLUMNS)
        for row in rows:
            writer.writerow([row[column] for column in EXPORT_COLUMNS])

    exercise_columns = [
        "id",
        "timestamp",
        "exercise_id",
        "completed",
        "form_score",
        "duration_seconds",
        "triggered_by",
    ]
    with exercise_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(exercise_columns)
        for row in exercise_rows:
            writer.writerow([row[column] for column in exercise_columns])

    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="Export Zeno session data as CSV.")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--output-dir", default=str(DEFAULT_EXPORT_DIR))
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    if not db_path.exists():
        print(json.dumps({"ok": False, "error": "Database not found", "path": str(db_path)}))
        return

    output_path = export_sessions_csv(
        db_path=db_path,
        output_dir=Path(args.output_dir).expanduser().resolve(),
    )
    print(json.dumps({"ok": True, "path": str(output_path)}))


if __name__ == "__main__":
    main()
