from __future__ import annotations

import json
import sqlite3

from zeno_backend.data.db_utils import safe_float, safe_int


ISSUE_KEYS = ("chin-forward", "rounded-shoulders", "head-tilt-right")

# Maps classifier issues (sqlite_logger) onto posture-tab issue keys.
_CLASSIFIER_TO_ISSUE = {
    "head_forward": "chin-forward",
    "chin_forward": "chin-forward",
    "chin-forward": "chin-forward",
    "shoulder_tilt": "head-tilt-right",
    "head_tilt_right": "head-tilt-right",
    "head-tilt-right": "head-tilt-right",
    "trunk_lean": "rounded-shoulders",
    "rounded_shoulders": "rounded-shoulders",
    "rounded-shoulders": "rounded-shoulders",
}


def _recommended_ids(top_issue: str) -> list[str]:
    if top_issue == "chin-forward":
        return ["chin-tuck", "scap-squeeze"]
    if top_issue == "rounded-shoulders":
        return ["wall-angels", "doorway-pec-stretch"]
    return ["seated-side-bend", "thoracic-extension"]


def _issue_from_classifier(dominant_issue: str | None, shoulder_tilt_signed: float) -> str | None:
    key = str(dominant_issue or "").strip().lower().replace(" ", "_")
    if not key or key == "unknown":
        return None
    mapped = _CLASSIFIER_TO_ISSUE.get(key)
    if mapped == "head-tilt-right" and shoulder_tilt_signed < -0.05:
        # Classifier says tilt but signed lean is left; still count as tilt-right bucket
        # only when right-leaning to avoid inventing a left-tilt category.
        return None
    return mapped


def _issue_from_heuristic(
    *,
    posture_score: float,
    posture_deviation: float,
    posture_is_poor: bool,
    shoulder_tilt_signed: float,
    shoulder_tilt_abs: float,
    posture_state: str,
) -> list[str]:
    issues: list[str] = []
    state = str(posture_state or "").strip().lower()
    if (
        posture_deviation >= 0.16
        or (posture_is_poor and posture_score < 0.68)
        or state in {"poor_posture", "mild_drift"}
    ):
        issues.append("chin-forward")
    if posture_score < 0.62 and shoulder_tilt_abs < 0.08:
        issues.append("rounded-shoulders")
    if shoulder_tilt_signed >= 0.05:
        issues.append("head-tilt-right")
    return issues


def recompute_posture_daily_insight(conn: sqlite3.Connection, day_key: str) -> dict:
    day_key = str(day_key or "").strip()[:10]
    rows = conn.execute(
        """
        SELECT
            posture_score,
            posture_deviation,
            posture_is_poor,
            posture_state,
            posture_dominant_issue,
            posture_signal_quality,
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
        quality = str(row["posture_signal_quality"] or "unknown").strip().lower()
        if quality == "low":
            # Skip unreliable posture samples for issue attribution.
            continue

        posture_score = safe_float(row["posture_score"], 0.0) or 0.0
        posture_deviation = safe_float(row["posture_deviation"], 0.0) or 0.0
        posture_is_poor = safe_int(row["posture_is_poor"], 0) == 1
        posture_state = str(row["posture_state"] or "unknown")
        shoulder_tilt_signed = safe_float(row["shoulder_tilt_signed_norm"], 0.0) or 0.0
        shoulder_tilt_abs = safe_float(
            row["shoulder_tilt_norm"], abs(shoulder_tilt_signed)
        ) or abs(shoulder_tilt_signed)

        classified = _issue_from_classifier(
            str(row["posture_dominant_issue"] or ""),
            shoulder_tilt_signed=shoulder_tilt_signed,
        )
        if classified == "chin-forward":
            chin_forward_count += 1
        elif classified == "rounded-shoulders":
            rounded_count += 1
        elif classified == "head-tilt-right":
            tilt_right_count += 1
        else:
            for issue in _issue_from_heuristic(
                posture_score=posture_score,
                posture_deviation=posture_deviation,
                posture_is_poor=posture_is_poor,
                shoulder_tilt_signed=shoulder_tilt_signed,
                shoulder_tilt_abs=shoulder_tilt_abs,
                posture_state=posture_state,
            ):
                if issue == "chin-forward":
                    chin_forward_count += 1
                elif issue == "rounded-shoulders":
                    rounded_count += 1
                elif issue == "head-tilt-right":
                    tilt_right_count += 1

    count_rows = {
        "chin-forward": chin_forward_count,
        "rounded-shoulders": rounded_count,
        "head-tilt-right": tilt_right_count,
    }
    top_issue = max(count_rows, key=count_rows.get) if total > 0 else "chin-forward"
    if total > 0 and all(value == 0 for value in count_rows.values()):
        top_issue = "chin-forward"
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
        (str(day_key or "").strip()[:10],),
    ).fetchone()
    if row is None:
        return None
    recommended_raw = row["recommended_ids_json"] if "recommended_ids_json" in row.keys() else "[]"
    try:
        recommended_ids = json.loads(recommended_raw or "[]")
    except (json.JSONDecodeError, TypeError, ValueError):
        recommended_ids = []
    if not isinstance(recommended_ids, list):
        recommended_ids = []
    return {
        "date": str(row["date"]),
        "sessions_count": safe_int(row["sessions_count"], 0) or 0,
        "chin_forward_count": safe_int(row["chin_forward_count"], 0) or 0,
        "rounded_shoulders_count": safe_int(row["rounded_shoulders_count"], 0) or 0,
        "head_tilt_right_count": safe_int(row["head_tilt_right_count"], 0) or 0,
        "top_issue": str(row["top_issue"] or "chin-forward"),
        "recommended_ids": [str(item) for item in recommended_ids if isinstance(item, (str, int))],
    }


def refresh_all_posture_daily_insights(conn: sqlite3.Connection) -> int:
    days = [
        str(row[0])
        for row in conn.execute(
            "SELECT DISTINCT substr(created_at, 1, 10) AS day FROM sessions ORDER BY day ASC"
        ).fetchall()
        if row[0]
    ]
    for day_key in days:
        recompute_posture_daily_insight(conn, day_key)
    return len(days)
