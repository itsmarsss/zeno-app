from __future__ import annotations

import argparse
import json
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema
from zeno_backend.data.db_utils import connect_db, ensure_exercise_sessions_table, safe_float, safe_int

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


def fetch_exercise_history(db_path: Path, limit: int = 30) -> dict:
    if not db_path.exists():
        return {"items": [], "today_count": 0, "today_completed": 0}

    limit = max(1, min(int(limit or 30), 200))
    with connect_db(db_path) as conn:
        ensure_sessions_schema(conn)
        ensure_exercise_sessions_table(conn)
        rows = conn.execute(
            """
            SELECT
              id,
              timestamp,
              exercise_id,
              completed,
              form_score,
              duration_seconds,
              triggered_by
            FROM exercise_sessions
            ORDER BY id DESC
            LIMIT ?
            """,
            (limit,),
        ).fetchall()
        today_row = conn.execute(
            """
            SELECT
              COUNT(*) AS total,
              SUM(CASE WHEN completed = 1 THEN 1 ELSE 0 END) AS completed
            FROM exercise_sessions
            WHERE substr(COALESCE(timestamp, ''), 1, 10) = date('now', 'localtime')
            """
        ).fetchone()

    items = []
    for row in rows:
        items.append(
            {
                "id": safe_int(row["id"], 0) or 0,
                "timestamp": str(row["timestamp"] or ""),
                "exercise_id": str(row["exercise_id"] or ""),
                "completed": bool(safe_int(row["completed"], 0)),
                "form_score": safe_float(row["form_score"], None),
                "duration_seconds": safe_float(row["duration_seconds"], 0.0) or 0.0,
                "triggered_by": str(row["triggered_by"] or "manual"),
            }
        )

    return {
        "items": items,
        "today_count": safe_int(today_row["total"] if today_row else 0, 0) or 0,
        "today_completed": safe_int(today_row["completed"] if today_row else 0, 0) or 0,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch recent exercise sessions.")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--limit", type=int, default=30)
    args = parser.parse_args()
    db_path = Path(args.db_path).expanduser().resolve()
    print(json.dumps(fetch_exercise_history(db_path=db_path, limit=args.limit)))


if __name__ == "__main__":
    main()
