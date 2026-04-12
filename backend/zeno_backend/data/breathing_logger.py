from __future__ import annotations

import argparse
import json
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema
from zeno_backend.data.db_utils import connect_db, ensure_breathing_sessions_table

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


def init_db(db_path: Path) -> None:
    db_path.parent.mkdir(parents=True, exist_ok=True)
    with connect_db(db_path) as conn:
        ensure_sessions_schema(conn)
        ensure_breathing_sessions_table(conn)
        conn.commit()


def log_breathing_session(
    db_path: Path,
    exercise_type: str,
    cycles_completed: int,
    hr_start: float | None,
    hr_end: float | None,
    hr_delta: float | None,
    rr_start: float | None,
    rr_end: float | None,
    rr_delta: float | None,
    triggered_by: str,
) -> int:
    init_db(db_path)
    with connect_db(db_path) as conn:
        ensure_breathing_sessions_table(conn)
        cursor = conn.execute(
            """
            INSERT INTO breathing_sessions (
              exercise_type,
              cycles_completed,
              hr_start,
              hr_end,
              hr_delta,
              rr_start,
              rr_end,
              rr_delta,
              triggered_by
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                exercise_type,
                max(0, int(cycles_completed)),
                None if hr_start is None else float(hr_start),
                None if hr_end is None else float(hr_end),
                None if hr_delta is None else float(hr_delta),
                None if rr_start is None else float(rr_start),
                None if rr_end is None else float(rr_end),
                None if rr_delta is None else float(rr_delta),
                triggered_by,
            ),
        )
        conn.commit()
        return int(cursor.lastrowid)


def main() -> None:
    parser = argparse.ArgumentParser(description="Log breathing exercise session into SQLite.")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--exercise-type", required=True)
    parser.add_argument("--cycles-completed", type=int, default=0)
    parser.add_argument("--hr-start", type=float, default=None)
    parser.add_argument("--hr-end", type=float, default=None)
    parser.add_argument("--hr-delta", type=float, default=None)
    parser.add_argument("--rr-start", type=float, default=None)
    parser.add_argument("--rr-end", type=float, default=None)
    parser.add_argument("--rr-delta", type=float, default=None)
    parser.add_argument("--triggered-by", default="manual")
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    row_id = log_breathing_session(
        db_path=db_path,
        exercise_type=args.exercise_type,
        cycles_completed=args.cycles_completed,
        hr_start=args.hr_start,
        hr_end=args.hr_end,
        hr_delta=args.hr_delta,
        rr_start=args.rr_start,
        rr_end=args.rr_end,
        rr_delta=args.rr_delta,
        triggered_by=args.triggered_by,
    )
    print(
        json.dumps(
            {
                "ok": True,
                "inserted_id": row_id,
                "db_path": str(db_path),
            }
        )
    )


if __name__ == "__main__":
    main()
