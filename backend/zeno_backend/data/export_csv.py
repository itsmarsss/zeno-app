from __future__ import annotations

import argparse
import csv
import json
import sqlite3
from datetime import datetime
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"
DEFAULT_EXPORT_DIR = Path(__file__).resolve().parents[2] / "data" / "exports"


def export_sessions_csv(db_path: Path, output_dir: Path) -> Path:
    output_dir.mkdir(parents=True, exist_ok=True)
    output_path = output_dir / f"sessions-{datetime.now().strftime('%Y%m%d-%H%M%S')}.csv"

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        ensure_sessions_schema(conn)
        rows = conn.execute(
            """
            SELECT
              id,
              created_at,
              presence_detected,
              analysis_skipped,
              posture_score,
              tracking_confidence,
              head_offset_norm,
              shoulder_tilt_signed_norm,
              shoulder_tilt_norm,
              posture_stability_std,
              posture_stability_label,
              baseline_posture_score,
              posture_deviation,
              posture_is_poor,
              dominant_emotion,
              emotion_score,
              stress_index,
              heart_rate_bpm,
              emotion_backend,
              focus_mode,
              notification_sent,
              notification_dismissed_by,
              session_duration_seconds
            FROM sessions
            ORDER BY id DESC
            """
        ).fetchall()

    with output_path.open("w", newline="", encoding="utf-8") as handle:
        writer = csv.writer(handle)
        writer.writerow(
            [
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
                "baseline_posture_score",
                "posture_deviation",
                "posture_is_poor",
                "dominant_emotion",
                "emotion_score",
                "stress_index",
                "heart_rate_bpm",
                "emotion_backend",
                "focus_mode",
                "notification_sent",
                "notification_dismissed_by",
                "session_duration_seconds",
            ]
        )
        for row in rows:
            writer.writerow([row[k] for k in row.keys()])

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
