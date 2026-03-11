from __future__ import annotations

import argparse
import math
import json
import os
import sqlite3
import urllib.error
import urllib.request
from collections import defaultdict
from datetime import date, timedelta
from pathlib import Path

from zeno_backend.data.db_schema import ensure_sessions_schema

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"
DEFAULT_MODEL = os.environ.get("ZENO_INSIGHTS_MODEL", "").strip()
OLLAMA_URL = os.environ.get("ZENO_OLLAMA_URL", "http://127.0.0.1:11434/api/generate")
OLLAMA_GENERATE_TIMEOUT_SECONDS = float(os.environ.get("ZENO_OLLAMA_GENERATE_TIMEOUT_SECONDS", "45"))


def _period_days(period: str) -> int:
    key = (period or "week").strip().lower()
    if key == "month":
        return 30
    if key in {"quarter", "3m", "3months"}:
        return 90
    return 7


def _template_coach(features: dict, period: str) -> str:
    sessions = int(features.get("sessions", 0))
    focused_minutes = int(features.get("focused_minutes", 0))
    avg_stress = int(round(float(features.get("avg_stress", 0.0))))
    avg_duration = int(round(float(features.get("avg_duration", 0.0))))
    duration_p75 = int(round(float(features.get("duration_p75", 0.0))))
    days_studied = int(features.get("days_studied", 0))
    longest_streak = int(features.get("longest_streak_days", 0))
    stress_delta = float(features.get("stress_delta_vs_prev_period", 0.0))
    best_window = str(features.get("best_hour_window", "N/A"))
    posture_risk = int(round(float(features.get("low_posture_rate_pct", 0.0))))
    period_label = "this week" if period == "week" else "this month" if period == "month" else "this quarter"
    return "\n".join(
        [
            f"You logged {sessions} focus sessions in {period_label}.",
            f"You studied on {days_studied} distinct days with a longest streak of {longest_streak} days.",
            f"Your total focused time is {focused_minutes} minutes, averaging {avg_duration} minutes per session.",
            f"Your longer sessions reach about {duration_p75} minutes (75th percentile).",
            f"Your average stress is {avg_stress} ({stress_delta:+.1f} vs prior period).",
            f"Your calmest performance window is around {best_window}.",
            f"Low-posture risk appeared in about {posture_risk}% of focus sessions.",
        ]
    )


def _normalize_insights(text: str) -> str:
    lines: list[str] = []
    for raw in str(text or "").splitlines():
        line = raw.strip().lstrip("-").strip()
        if not line:
            continue
        lines.append(line)
    if not lines:
        return ""
    return "\n".join(lines[:8])


def _compute_features(conn: sqlite3.Connection, period: str, target_day: date) -> dict:
    days = _period_days(period)
    start_day = (target_day - timedelta(days=days - 1)).isoformat()
    end_day = target_day.isoformat()
    prev_end = (target_day - timedelta(days=days)).isoformat()
    prev_start = (target_day - timedelta(days=(2 * days - 1))).isoformat()
    rows = conn.execute(
        """
        SELECT
          created_at,
          focus_duration_seconds,
          stress_index,
          posture_score,
          heart_rate_bpm,
          respiratory_rate
        FROM sessions
        WHERE focus_mode = 1
          AND analysis_skipped = 0
          AND substr(created_at, 1, 10) BETWEEN ? AND ?
        ORDER BY created_at DESC
        LIMIT 400
        """,
        (start_day, end_day),
    ).fetchall()
    prev_rows = conn.execute(
        """
        SELECT
          focus_duration_seconds,
          stress_index
        FROM sessions
        WHERE focus_mode = 1
          AND analysis_skipped = 0
          AND substr(created_at, 1, 10) BETWEEN ? AND ?
        ORDER BY created_at DESC
        LIMIT 400
        """,
        (prev_start, prev_end),
    ).fetchall()

    if not rows:
        return {
            "period": period,
            "sessions": 0,
            "focused_minutes": 0,
            "avg_duration": 0.0,
            "avg_stress": 0.0,
            "avg_posture": 0.0,
            "avg_heart_rate": None,
            "avg_respiratory_rate": None,
            "sessions_prev_period": len(prev_rows),
            "stress_delta_vs_prev_period": 0.0,
            "duration_delta_vs_prev_period": 0.0,
            "days_studied": 0,
            "longest_streak_days": 0,
            "best_hour_window": "N/A",
            "worst_hour_window": "N/A",
            "duration_p25": 0.0,
            "duration_p50": 0.0,
            "duration_p75": 0.0,
            "duration_stddev": 0.0,
            "stress_stddev": 0.0,
            "low_posture_rate_pct": 0.0,
        }

    sessions = len(rows)
    durations = [max(0, int(row[1] or 0)) for row in rows]
    focused_minutes = int(round(sum(durations) / 60))
    avg_duration = (sum(durations) / 60.0) / max(1, sessions)

    stress_values = [float(row[2]) for row in rows if row[2] is not None]
    posture_values = [float(row[3]) * 100.0 for row in rows if row[3] is not None]
    hr_values = [float(row[4]) for row in rows if row[4] is not None and float(row[4]) > 0]
    rr_values = [float(row[5]) for row in rows if row[5] is not None and float(row[5]) > 0]
    prev_stress_values = [float(row[1]) for row in prev_rows if row[1] is not None]
    prev_duration_values = [max(0, int(row[0] or 0)) / 60.0 for row in prev_rows if row[0] is not None]

    day_counts: dict[str, int] = defaultdict(int)
    hour_stress: dict[int, list[float]] = defaultdict(list)
    low_posture_count = 0
    duration_minutes = [value / 60.0 for value in durations]
    for row in rows:
        created_at = str(row[0] or "")
        day_key = created_at[:10]
        if day_key:
            day_counts[day_key] += 1
        hour_str = created_at[11:13]
        if hour_str.isdigit() and row[2] is not None:
            hour_stress[int(hour_str)].append(float(row[2]))
        posture_raw = float(row[3]) if row[3] is not None else 0.0
        if posture_raw < 0.6:
            low_posture_count += 1

    sorted_days = sorted(day_counts.keys())
    longest_streak = 0
    current_streak = 0
    last_dt: date | None = None
    for day_key in sorted_days:
        dt = date.fromisoformat(day_key)
        if last_dt is not None and (dt - last_dt).days == 1:
            current_streak += 1
        else:
            current_streak = 1
        longest_streak = max(longest_streak, current_streak)
        last_dt = dt

    def percentile(values: list[float], q: float) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        if len(ordered) == 1:
            return ordered[0]
        pos = (len(ordered) - 1) * q
        low = int(math.floor(pos))
        high = int(math.ceil(pos))
        if low == high:
            return ordered[low]
        weight = pos - low
        return ordered[low] * (1.0 - weight) + ordered[high] * weight

    best_hour = None
    worst_hour = None
    if hour_stress:
        ranked = sorted(((hour, sum(vals) / len(vals)) for hour, vals in hour_stress.items()), key=lambda x: x[1])
        best_hour = ranked[0][0]
        worst_hour = ranked[-1][0]

    current_avg_stress = round(sum(stress_values) / max(1, len(stress_values)), 1) if stress_values else 0.0
    previous_avg_stress = round(sum(prev_stress_values) / len(prev_stress_values), 1) if prev_stress_values else 0.0
    current_avg_duration = round(sum(duration_minutes) / max(1, len(duration_minutes)), 1) if duration_minutes else 0.0
    previous_avg_duration = round(sum(prev_duration_values) / len(prev_duration_values), 1) if prev_duration_values else 0.0

    return {
        "period": period,
        "sessions": sessions,
        "focused_minutes": focused_minutes,
        "avg_duration": current_avg_duration,
        "avg_stress": current_avg_stress,
        "avg_posture": round(sum(posture_values) / max(1, len(posture_values)), 1) if posture_values else 0.0,
        "avg_heart_rate": round(sum(hr_values) / len(hr_values), 1) if hr_values else None,
        "avg_respiratory_rate": round(sum(rr_values) / len(rr_values), 1) if rr_values else None,
        "sessions_prev_period": len(prev_rows),
        "stress_delta_vs_prev_period": round(current_avg_stress - previous_avg_stress, 1),
        "duration_delta_vs_prev_period": round(current_avg_duration - previous_avg_duration, 1),
        "days_studied": len(day_counts),
        "longest_streak_days": longest_streak,
        "best_hour_window": f"{best_hour}:00-{best_hour + 1}:00" if best_hour is not None else "N/A",
        "worst_hour_window": f"{worst_hour}:00-{worst_hour + 1}:00" if worst_hour is not None else "N/A",
        "duration_p25": round(percentile(duration_minutes, 0.25), 1),
        "duration_p50": round(percentile(duration_minutes, 0.5), 1),
        "duration_p75": round(percentile(duration_minutes, 0.75), 1),
        "duration_stddev": round(
            math.sqrt(sum((value - current_avg_duration) ** 2 for value in duration_minutes) / max(1, len(duration_minutes))),
            2,
        ),
        "stress_stddev": round(
            math.sqrt(sum((value - current_avg_stress) ** 2 for value in stress_values) / max(1, len(stress_values))),
            2,
        )
        if stress_values
        else 0.0,
        "low_posture_rate_pct": round((low_posture_count / max(1, sessions)) * 100.0, 1),
    }


def _try_ai_coach(features: dict, model: str) -> str | None:
    prompt = (
        "You are an evidence-driven study coach.\n"
        "Write 6-8 short lines of personalized analysis from the data.\n"
        "Address the user in second person.\n"
        "Each line must include at least one concrete metric or trend.\n"
        "Cover: consistency, intensity, stress trend, duration quality, posture risk, and one practical next step.\n"
        "Use nuanced language and tradeoffs. Avoid generic praise.\n"
        "Return STRICT JSON: {\"insights\":\"line1\\nline2\\n...\"}\n"
        f"Features: {json.dumps(features, separators=(',', ':'))}\n"
    )
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": False,
        "format": "json",
        "options": {"temperature": 0.45, "top_p": 0.9},
    }
    req = urllib.request.Request(
        OLLAMA_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=OLLAMA_GENERATE_TIMEOUT_SECONDS) as response:
            raw = response.read().decode("utf-8")
    except (urllib.error.URLError, TimeoutError, OSError):
        return None

    try:
        obj = json.loads(raw)
        generated = str(obj.get("response", "")).strip()
        parsed = json.loads(generated)
    except (json.JSONDecodeError, TypeError, ValueError):
        return None

    normalized = _normalize_insights(str(parsed.get("insights", "")))
    if not normalized:
        return None
    if len(normalized.splitlines()) < 3:
        return None
    return normalized


def _cache_key(period: str, target_day: date) -> str:
    return f"{period}:{target_day.isoformat()}"


def fetch_study_coach_cache(conn: sqlite3.Connection, period: str, target_day: date) -> dict | None:
    row = conn.execute(
        """
        SELECT cache_key, period, insights_text, source, model
        FROM study_coach_cache
        WHERE cache_key = ?
        """,
        (_cache_key(period, target_day),),
    ).fetchone()
    if row is None:
        return None
    return {
        "cache_key": str(row[0]),
        "period": str(row[1]),
        "insights": str(row[2] or ""),
        "source": str(row[3] or "template"),
        "model": row[4],
    }


def recompute_study_coach(
    conn: sqlite3.Connection,
    period: str,
    target_day: date,
    allow_ai: bool = True,
    model: str = DEFAULT_MODEL,
) -> dict:
    features = _compute_features(conn, period, target_day)
    selected_model = (model or "").strip()
    ai_text = _try_ai_coach(features, selected_model) if allow_ai and selected_model else None
    source = "ai" if ai_text else "template"
    insights = ai_text or _template_coach(features, period)
    key = _cache_key(period, target_day)
    conn.execute(
        """
        INSERT INTO study_coach_cache (cache_key, period, insights_text, source, model, updated_at)
        VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(cache_key) DO UPDATE SET
          period=excluded.period,
          insights_text=excluded.insights_text,
          source=excluded.source,
          model=excluded.model,
          updated_at=CURRENT_TIMESTAMP
        """,
        (key, period, insights, source, selected_model if source == "ai" else None),
    )
    return {
        "cache_key": key,
        "period": period,
        "insights": insights,
        "source": source,
        "model": selected_model if source == "ai" else None,
    }


def compute_study_coach(
    db_path: Path,
    period: str,
    target_day: date,
    force: bool = False,
    allow_ai: bool = True,
    model: str = DEFAULT_MODEL,
) -> dict:
    period_key = (period or "week").strip().lower()
    if period_key not in {"week", "month", "quarter"}:
        period_key = "week"
    if not db_path.exists():
        return {
            "cache_key": _cache_key(period_key, target_day),
            "period": period_key,
            "insights": _template_coach({"sessions": 0, "focused_minutes": 0, "avg_stress": 0, "avg_duration": 0}, period_key),
            "source": "template",
            "model": None,
        }

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        ensure_sessions_schema(conn)
        if not force:
            cached = fetch_study_coach_cache(conn, period_key, target_day)
            if cached is not None:
                return cached
        payload = recompute_study_coach(
            conn=conn,
            period=period_key,
            target_day=target_day,
            allow_ai=allow_ai,
            model=model,
        )
        conn.commit()
        return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Compute/cached local study coach insights.")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--period", default="week")
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--no-ai", action="store_true")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    target_day = date.fromisoformat(args.date)
    payload = compute_study_coach(
        db_path=db_path,
        period=str(args.period),
        target_day=target_day,
        force=bool(args.force),
        allow_ai=not bool(args.no_ai),
        model=str(args.model or ""),
    )
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
