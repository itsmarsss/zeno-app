from __future__ import annotations

import argparse
import json
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema
from zeno_backend.data.db_utils import connect_db

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


def fetch_history(
    db_path: Path,
    limit: int | None = None,
    start_date: str | None = None,
    end_date: str | None = None,
    max_days: int | None = None,
) -> list[dict]:
    if not db_path.exists():
        return []

    where_clauses: list[str] = []
    params: list[object] = []
    if start_date:
        where_clauses.append("created_at >= ?")
        params.append(f"{str(start_date)[:10]}T00:00:00")
    if end_date:
        where_clauses.append("created_at <= ?")
        params.append(f"{str(end_date)[:10]}T23:59:59")
    if isinstance(max_days, int) and max_days > 0 and not start_date:
        # Free-tier style lookback: only sessions within the last N local days.
        where_clauses.append("date(substr(created_at, 1, 10)) >= date('now', 'localtime', ?)")
        params.append(f"-{int(max_days) - 1} days")

    where_sql = f"WHERE {' AND '.join(where_clauses)}" if where_clauses else ""
    limit_sql = ""
    if isinstance(limit, int) and limit > 0:
        limit_sql = "LIMIT ?"
        params.append(min(limit, 10_000))
    with connect_db(db_path) as conn:
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
                posture_state,
                posture_dominant_issue,
                posture_signal_quality,
                posture_nudge_eligible,
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
                focus_session_id,
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
    parser.add_argument(
        "--max-days",
        type=int,
        default=None,
        help="Optional lookback window in days (e.g. 7 for free tier).",
    )
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    history = fetch_history(
        db_path=db_path,
        limit=args.limit,
        start_date=args.start_date,
        end_date=args.end_date,
        max_days=args.max_days,
    )
    print(json.dumps({"items": history}))


if __name__ == "__main__":
    main()
