from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


def fetch_history(
    db_path: Path,
    limit: int | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
) -> list[dict]:
    if not db_path.exists():
        return []

    where_clauses: list[str] = []
    params: list[object] = []
    if start_date:
        where_clauses.append("created_at >= ?")
        params.append(f"{start_date}T00:00:00")
    if end_date:
        where_clauses.append("created_at <= ?")
        params.append(f"{end_date}T23:59:59")

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    limit_sql = ""
    if isinstance(limit, int) and limit > 0:
        limit_sql = "LIMIT ?"
        params.append(limit)

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        ensure_sessions_schema(conn)
        rows = conn.execute(
            f"""
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
                respiratory_rate,
                rr_confidence,
                emotion_backend,
                mode,
                focus_duration_seconds,
                focus_mode,
                notification_sent,
                notification_dismissed_by,
                session_duration_seconds
            FROM sessions
            {where_sql}
            ORDER BY id DESC
            {limit_sql}
            """,
            tuple(params),
        ).fetchall()

    return [dict(row) for row in rows]


def main() -> None:
    parser = argparse.ArgumentParser(description="Read recent sessions from local SQLite.")
    parser.add_argument(
        "--db-path",
        default=str(DEFAULT_DB_PATH),
        help="SQLite database path (default: backend/data/zeno_sessions.db).",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Max number of records to return (default: no limit).",
    )
    parser.add_argument("--start-date", default=None, help="Start date YYYY-MM-DD (inclusive).")
    parser.add_argument("--end-date", default=None, help="End date YYYY-MM-DD (inclusive).")
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    history = fetch_history(
        db_path=db_path,
        limit=args.limit,
        start_date=args.start_date,
        end_date=args.end_date,
    )
    print(json.dumps({"items": history}))


if __name__ == "__main__":
    main()
