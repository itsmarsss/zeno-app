from __future__ import annotations

import sqlite3
from datetime import date


def recommendation_for_day(avg_stress: float, avg_posture: float) -> str:
    if avg_stress >= 65:
        return "Schedule two short breaks tomorrow and reduce session intensity in the afternoon."
    if avg_posture < 0.5:
        return "Do a 2-minute posture reset every hour and raise your screen slightly."
    if avg_stress <= 35 and avg_posture >= 0.65:
        return "Great balance today. Keep the same cadence and hydration routine tomorrow."
    return "Keep a steady pace tomorrow and add one short standing break before lunch."


def recompute_daily_aggregate(conn: sqlite3.Connection, day_key: str) -> dict:
    rows = conn.execute(
        """
        SELECT
            created_at,
            posture_score,
            stress_index,
            heart_rate_bpm,
            respiratory_rate,
            rr_confidence,
            mode,
            focus_mode,
            session_duration_seconds
        FROM sessions
        WHERE substr(created_at, 1, 10) = ?
          AND presence_detected = 1
          AND analysis_skipped = 0
        ORDER BY created_at ASC
        """,
        (day_key,),
    ).fetchall()

    if not rows:
        payload = {
            "date": day_key,
            "sessions_count": 0,
            "average_stress_index": 0.0,
            "average_posture_score": 0.0,
            "average_heart_rate": None,
            "average_respiratory_rate": None,
            "focused_minutes": 0,
            "break_count": 0,
            "break_minutes": 0,
            "avg_focus_session_minutes": 0,
            "peak_stress_index": None,
            "peak_stress_time": None,
            "recommendation": "No data yet. Run a few check-ins to generate insights.",
        }
    else:
        sessions_count = len(rows)
        stress_values = [int(row["stress_index"] or 0) for row in rows]
        posture_values = [float(row["posture_score"] or 0.0) for row in rows]

        hr_values = [
            float(row["heart_rate_bpm"])
            for row in rows
            if row["heart_rate_bpm"] is not None and float(row["heart_rate_bpm"]) > 0
        ]
        rr_values = [
            float(row["respiratory_rate"])
            for row in rows
            if float(row["respiratory_rate"] or 0.0) > 0
            and str(row["rr_confidence"] or "none") in {"partial", "full"}
            and (int(row["focus_mode"] or 0) == 1 or str(row["mode"] or "passive") == "focus")
        ]

        focus_rows = [row for row in rows if int(row["focus_mode"] or 0) == 1]
        passive_rows = [row for row in rows if int(row["focus_mode"] or 0) == 0]
        focused_minutes = round(sum(float(row["session_duration_seconds"] or 0.0) for row in focus_rows) / 60.0)
        break_minutes = round(sum(float(row["session_duration_seconds"] or 0.0) for row in passive_rows) / 60.0)
        avg_focus_session_minutes = (
            round(
                sum(float(row["session_duration_seconds"] or 0.0) for row in focus_rows)
                / max(1, len(focus_rows))
                / 60.0
            )
            if focus_rows
            else 0
        )

        peak_row = max(rows, key=lambda row: int(row["stress_index"] or 0))
        avg_stress = sum(stress_values) / max(1, len(stress_values))
        avg_posture = sum(posture_values) / max(1, len(posture_values))
        payload = {
            "date": day_key,
            "sessions_count": sessions_count,
            "average_stress_index": round(avg_stress, 1),
            "average_posture_score": round(avg_posture, 3),
            "average_heart_rate": round(sum(hr_values) / len(hr_values), 1) if hr_values else None,
            "average_respiratory_rate": round(sum(rr_values) / len(rr_values), 1) if rr_values else None,
            "focused_minutes": focused_minutes,
            "break_count": len(passive_rows),
            "break_minutes": break_minutes,
            "avg_focus_session_minutes": avg_focus_session_minutes,
            "peak_stress_index": int(peak_row["stress_index"] or 0),
            "peak_stress_time": str(peak_row["created_at"]),
            "recommendation": recommendation_for_day(avg_stress=avg_stress, avg_posture=avg_posture),
        }

    conn.execute(
        """
        INSERT INTO daily_aggregates (
            date,
            sessions_count,
            average_stress_index,
            average_posture_score,
            average_heart_rate,
            average_respiratory_rate,
            focused_minutes,
            break_count,
            break_minutes,
            avg_focus_session_minutes,
            peak_stress_index,
            peak_stress_time,
            recommendation,
            updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(date) DO UPDATE SET
            sessions_count = excluded.sessions_count,
            average_stress_index = excluded.average_stress_index,
            average_posture_score = excluded.average_posture_score,
            average_heart_rate = excluded.average_heart_rate,
            average_respiratory_rate = excluded.average_respiratory_rate,
            focused_minutes = excluded.focused_minutes,
            break_count = excluded.break_count,
            break_minutes = excluded.break_minutes,
            avg_focus_session_minutes = excluded.avg_focus_session_minutes,
            peak_stress_index = excluded.peak_stress_index,
            peak_stress_time = excluded.peak_stress_time,
            recommendation = excluded.recommendation,
            updated_at = CURRENT_TIMESTAMP
        """,
        (
            payload["date"],
            payload["sessions_count"],
            payload["average_stress_index"],
            payload["average_posture_score"],
            payload["average_heart_rate"],
            payload["average_respiratory_rate"],
            payload["focused_minutes"],
            payload["break_count"],
            payload["break_minutes"],
            payload["avg_focus_session_minutes"],
            payload["peak_stress_index"],
            payload["peak_stress_time"],
            payload["recommendation"],
        ),
    )
    return payload


def fetch_daily_aggregate(conn: sqlite3.Connection, day_key: str) -> dict | None:
    row = conn.execute(
        """
        SELECT
            date,
            sessions_count,
            average_stress_index,
            average_posture_score,
            average_heart_rate,
            average_respiratory_rate,
            focused_minutes,
            break_count,
            break_minutes,
            avg_focus_session_minutes,
            peak_stress_index,
            peak_stress_time,
            recommendation
        FROM daily_aggregates
        WHERE date = ?
        """,
        (day_key,),
    ).fetchone()
    return dict(row) if row is not None else None


def refresh_all_daily_aggregates(conn: sqlite3.Connection) -> int:
    days = [
        str(row[0])
        for row in conn.execute(
            "SELECT DISTINCT substr(created_at, 1, 10) AS day FROM sessions ORDER BY day ASC"
        ).fetchall()
    ]
    for day_key in days:
        recompute_daily_aggregate(conn, day_key)
    return len(days)


def iso_day(value: str | date) -> str:
    if isinstance(value, date):
        return value.isoformat()
    return value[:10]
