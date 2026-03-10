from __future__ import annotations

import json
import sqlite3


ISSUE_KEYS = ("chin-forward", "rounded-shoulders", "head-tilt-right")


def _recommended_ids(top_issue: str) -> list[str]:
    if top_issue == "chin-forward":
        return ["chin-tuck", "scap-squeeze"]
    if top_issue == "rounded-shoulders":
        return ["wall-angels", "doorway-pec-stretch"]
    return ["seated-side-bend", "thoracic-extension"]


def recompute_posture_daily_insight(conn: sqlite3.Connection, day_key: str) -> dict:
    rows = conn.execute(
        """
        SELECT
            posture_score,
            posture_deviation,
            posture_is_poor,
            shoulder_tilt_signed_norm,
            shoulder_tilt_norm
        FROM sessions
        WHERE substr(created_at, 1, 10) = ?
          AND presence_detected = 1
          AND analysis_skipped = 0
        ORDER BY created_at ASC
        """,
        (day_key,),
    ).fetchall()

    total = len(rows)
    chin_forward_count = 0
    rounded_count = 0
    tilt_right_count = 0

    for row in rows:
        posture_score = float(row["posture_score"] or 0.0)
        posture_deviation = float(row["posture_deviation"] or 0.0)
        posture_is_poor = int(row["posture_is_poor"] or 0) == 1
        shoulder_tilt_signed = float(row["shoulder_tilt_signed_norm"] or 0.0)
        shoulder_tilt_abs = float(row["shoulder_tilt_norm"] or abs(shoulder_tilt_signed))

        if posture_deviation >= 0.16 or (posture_is_poor and posture_score < 0.68):
            chin_forward_count += 1
        if posture_score < 0.62 and shoulder_tilt_abs < 0.08:
            rounded_count += 1
        if shoulder_tilt_signed >= 0.05:
            tilt_right_count += 1

    count_rows = {
        "chin-forward": chin_forward_count,
        "rounded-shoulders": rounded_count,
        "head-tilt-right": tilt_right_count,
    }
    top_issue = max(count_rows, key=count_rows.get) if total > 0 else "chin-forward"
    recommended_ids = _recommended_ids(top_issue)

    conn.execute(
        """
        INSERT INTO posture_daily_insights (
            date,
            sessions_count,
            chin_forward_count,
            rounded_shoulders_count,
            head_tilt_right_count,
            top_issue,
            recommended_ids_json,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(date) DO UPDATE SET
            sessions_count = excluded.sessions_count,
            chin_forward_count = excluded.chin_forward_count,
            rounded_shoulders_count = excluded.rounded_shoulders_count,
            head_tilt_right_count = excluded.head_tilt_right_count,
            top_issue = excluded.top_issue,
            recommended_ids_json = excluded.recommended_ids_json,
            updated_at = CURRENT_TIMESTAMP
        """,
        (
            day_key,
            total,
            chin_forward_count,
            rounded_count,
            tilt_right_count,
            top_issue,
            json.dumps(recommended_ids),
        ),
    )

    return {
        "date": day_key,
        "sessions_count": total,
        "chin_forward_count": chin_forward_count,
        "rounded_shoulders_count": rounded_count,
        "head_tilt_right_count": tilt_right_count,
        "top_issue": top_issue,
        "recommended_ids": recommended_ids,
    }


def fetch_posture_daily_insight(conn: sqlite3.Connection, day_key: str) -> dict | None:
    row = conn.execute(
        """
        SELECT
            date,
            sessions_count,
            chin_forward_count,
            rounded_shoulders_count,
            head_tilt_right_count,
            top_issue,
            recommended_ids_json
        FROM posture_daily_insights
        WHERE date = ?
        """,
        (day_key,),
    ).fetchone()
    if row is None:
        return None
    recommended_raw = row["recommended_ids_json"] if "recommended_ids_json" in row.keys() else "[]"
    try:
        recommended_ids = json.loads(recommended_raw or "[]")
    except json.JSONDecodeError:
        recommended_ids = []
    return {
        "date": str(row["date"]),
        "sessions_count": int(row["sessions_count"] or 0),
        "chin_forward_count": int(row["chin_forward_count"] or 0),
        "rounded_shoulders_count": int(row["rounded_shoulders_count"] or 0),
        "head_tilt_right_count": int(row["head_tilt_right_count"] or 0),
        "top_issue": str(row["top_issue"] or "chin-forward"),
        "recommended_ids": [str(item) for item in recommended_ids if isinstance(item, str)],
    }


def refresh_all_posture_daily_insights(conn: sqlite3.Connection) -> int:
    days = [
        str(row[0])
        for row in conn.execute(
            "SELECT DISTINCT substr(created_at, 1, 10) AS day FROM sessions ORDER BY day ASC"
        ).fetchall()
    ]
    for day_key in days:
        recompute_posture_daily_insight(conn, day_key)
    return len(days)
