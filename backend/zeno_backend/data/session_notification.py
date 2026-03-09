from __future__ import annotations

import argparse
import json
import sqlite3
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"


def update_notification(
    db_path: Path,
    session_id: int,
    notification_sent: str | None,
    notification_dismissed_by: str | None,
) -> bool:
    if not db_path.exists():
        return False

    with sqlite3.connect(db_path) as conn:
        ensure_sessions_schema(conn)
        cursor = conn.execute(
            """
            UPDATE sessions
            SET
              notification_sent = COALESCE(?, notification_sent),
              notification_dismissed_by = COALESCE(?, notification_dismissed_by)
            WHERE id = ?
            """,
            (
                notification_sent,
                notification_dismissed_by,
                int(session_id),
            ),
        )
        conn.commit()
        return cursor.rowcount > 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Update notification metadata for a session row.")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--session-id", type=int, required=True)
    parser.add_argument("--notification-sent", default=None)
    parser.add_argument("--notification-dismissed-by", default=None)
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    ok = update_notification(
        db_path=db_path,
        session_id=args.session_id,
        notification_sent=args.notification_sent,
        notification_dismissed_by=args.notification_dismissed_by,
    )
    print(json.dumps({"ok": ok, "session_id": args.session_id}))


if __name__ == "__main__":
    main()
