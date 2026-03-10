from __future__ import annotations

import argparse
import json
import os
import sqlite3
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

from zeno_backend.data.daily_aggregates import fetch_daily_aggregate, recompute_daily_aggregate
from zeno_backend.data.db_schema import ensure_sessions_schema

DEFAULT_DB_PATH = Path(__file__).resolve().parents[2] / "data" / "zeno_sessions.db"
DEFAULT_MODEL = os.environ.get("ZENO_INSIGHTS_MODEL", "").strip()
OLLAMA_URL = os.environ.get("ZENO_OLLAMA_URL", "http://127.0.0.1:11434/api/generate")
OLLAMA_GENERATE_TIMEOUT_SECONDS = float(os.environ.get("ZENO_OLLAMA_GENERATE_TIMEOUT_SECONDS", "45"))


def _ensure_day(conn: sqlite3.Connection, day_key: str) -> dict:
    cached = fetch_daily_aggregate(conn, day_key)
    if cached is not None:
        return cached
    return recompute_daily_aggregate(conn, day_key)


def _default_cards() -> list[dict]:
    return [
        {
            "key": "need-data",
            "tag": "Pattern",
            "text": "More data needed",
            "stat": "Run a few more sessions to unlock insights.",
            "icon": "trending",
        },
        {
            "key": "need-data-2",
            "tag": "Win",
            "text": "Early baseline forming",
            "stat": "Daily trends get better after 7 sessions.",
            "icon": "activity",
        },
        {
            "key": "need-data-3",
            "tag": "Posture",
            "text": "Posture trend pending",
            "stat": "Keep check-ins consistent through the week.",
            "icon": "user",
        },
    ]


def _format_hour(hour: int) -> str:
    suffix = "pm" if hour >= 12 else "am"
    twelve = 12 if hour % 12 == 0 else hour % 12
    return f"{twelve}{suffix}"


def _compute_features(conn: sqlite3.Connection, day_key: str) -> dict:
    target_day = date.fromisoformat(day_key)
    today = _ensure_day(conn, day_key)
    previous = _ensure_day(conn, (target_day - timedelta(days=1)).isoformat())

    recent_rows = conn.execute(
        """
        SELECT created_at, stress_index, posture_score, heart_rate_bpm
        FROM sessions
        WHERE presence_detected = 1
          AND analysis_skipped = 0
        ORDER BY created_at DESC
        LIMIT 56
        """
    ).fetchall()
    if not recent_rows:
        return {
            "sessions_count": 0,
            "avg_stress_today": 0,
            "stress_delta": 0,
            "focused_minutes": 0,
            "break_count": 0,
            "peak_hour": "midday",
            "poor_posture_count": 0,
            "hr_delta": 0,
        }

    by_hour: dict[int, list[float]] = {}
    poor_posture = 0
    for row in recent_rows:
        created_at = str(row[0])
        hour = int(created_at[11:13]) if len(created_at) >= 13 and created_at[11:13].isdigit() else 12
        stress = float(row[1]) if row[1] is not None else 0.0
        by_hour.setdefault(hour, []).append(stress)
        posture = float(row[2]) if row[2] is not None else 0.0
        if posture < 0.5:
            poor_posture += 1

    peak_hour = "midday"
    if by_hour:
        ranked = sorted(by_hour.items(), key=lambda kv: (sum(kv[1]) / max(len(kv[1]), 1)), reverse=True)
        peak_hour = _format_hour(ranked[0][0])

    today_hrs = [
        float(row[0])
        for row in conn.execute(
            """
            SELECT heart_rate_bpm
            FROM sessions
            WHERE substr(created_at, 1, 10) = ?
              AND heart_rate_bpm IS NOT NULL
              AND heart_rate_bpm > 0
            """,
            (day_key,),
        ).fetchall()
    ]
    previous_hrs = [
        float(row[0])
        for row in conn.execute(
            """
            SELECT heart_rate_bpm
            FROM sessions
            WHERE substr(created_at, 1, 10) <> ?
              AND heart_rate_bpm IS NOT NULL
              AND heart_rate_bpm > 0
            ORDER BY created_at DESC
            LIMIT 120
            """,
            (day_key,),
        ).fetchall()
    ]
    hr_delta = 0
    if today_hrs and previous_hrs:
        hr_delta = int(round((sum(today_hrs) / len(today_hrs)) - (sum(previous_hrs) / len(previous_hrs))))

    return {
        "sessions_count": int(today.get("sessions_count") or 0),
        "avg_stress_today": int(round(float(today.get("average_stress_index") or 0.0))),
        "stress_delta": int(
            round(float(today.get("average_stress_index") or 0.0))
            - round(float(previous.get("average_stress_index") or 0.0))
        ),
        "focused_minutes": int(today.get("focused_minutes") or 0),
        "break_count": int(today.get("break_count") or 0),
        "peak_hour": peak_hour,
        "poor_posture_count": poor_posture,
        "hr_delta": hr_delta,
        "sample_size": len(recent_rows),
    }


def _template_cards(features: dict) -> list[dict]:
    if int(features.get("sample_size", 0)) < 4:
        return _default_cards()

    peak_hour = str(features.get("peak_hour", "midday"))
    poor_posture_count = int(features.get("poor_posture_count", 0))
    hr_delta = int(features.get("hr_delta", 0))
    sample_size = int(features.get("sample_size", 0))

    return [
        {
            "key": "pattern",
            "tag": "Pattern",
            "text": f"Stress peaks around {peak_hour}",
            "stat": f"Based on {min(sample_size, 56)} recent sessions",
            "icon": "trending",
        },
        {
            "key": "win",
            "tag": "Win",
            "text": "Breathing habits are helping" if hr_delta <= 0 else "Heart rate rose during work blocks",
            "stat": f"Avg {abs(hr_delta)} bpm {'below' if hr_delta <= 0 else 'above'} baseline",
            "icon": "activity",
        },
        {
            "key": "posture",
            "tag": "Posture",
            "text": "Shoulders dip after long sessions" if poor_posture_count >= 4 else "Posture consistency is improving",
            "stat": (
                f"{poor_posture_count} low-posture check-ins this week"
                if poor_posture_count >= 4
                else "Fewer posture alerts than last week"
            ),
            "icon": "user",
        },
    ]


def _normalize_cards(raw_cards: list[dict]) -> list[dict]:
    normalized: list[dict] = []
    allowed_icons = {
        "activity",
        "trending",
        "trending-up",
        "bar-chart-3",
        "brain",
        "heart-pulse",
        "clock-3",
        "timer",
        "target",
        "zap",
        "shield-check",
        "coffee",
        "moon",
        "sun",
        "user",
    }
    for idx, card in enumerate(raw_cards[:6]):
        icon = str(card.get("icon", "activity")).lower()
        normalized.append(
            {
                "key": str(card.get("key") or f"card-{idx+1}"),
                "tag": str(card.get("tag") or "Insight")[:18],
                "text": str(card.get("text") or "No insight available.")[:140],
                "stat": str(card.get("stat") or "")[:40],
                "icon": icon if icon in allowed_icons else "activity",
            }
        )
    if len(normalized) < 3:
        return _default_cards()
    return normalized


def _try_ai_cards(features: dict, model: str) -> list[dict] | None:
    required_numeric_tokens = [
        str(int(features.get("sessions_count", 0))),
        str(int(features.get("focused_minutes", 0))),
        str(int(features.get("avg_stress_today", 0))),
    ]
    tone_rules = (
        "Use concrete, measured language. No hype, no motivational fluff.\n"
        "Never claim causality unless directly evident.\n"
        "Each stat must include at least one number from the provided features.\n"
        "Prefer concise phrasing similar to product dashboard copy.\n"
        "Avoid repetitive sentence patterns across cards.\n"
    )
    prompt = (
        "You write 5 concise productivity insight cards from quantified features.\n"
        "Output language: English only.\n"
        "Return STRICT JSON object with field cards (array of exactly 5 items).\n"
        "Each item schema: {key, tag, text, stat, icon}.\n"
        "Field intent is strict:\n"
        "- stat: ultra-concise KPI snippet (2-6 words), include number + unit, no full sentence.\n"
        "- text: explanatory sentence (10-22 words) that interprets the stat for the user.\n"
        "icon must be one of: activity, trending, trending-up, bar-chart-3, brain, heart-pulse, clock-3, timer, target, zap, shield-check, coffee, moon, sun, user.\n"
        "Choose distinct angles based on the provided data.\n"
        "Tag should be short (1-2 words) and data-specific, not generic.\n"
        "Do not default to the fixed trio Pattern/Win/Posture unless the data strongly warrants it.\n"
        "Address the user in second person where natural (use 'you'/'your').\n"
        "Write stat as natural UI text, not machine fields.\n"
        "Never output key=value format (e.g., avg_focus=120) and never output snake_case keys in stat.\n"
        "No markdown, no explanation.\n"
        f"{tone_rules}"
        "Avoid generic words like 'overall', 'significant improvement', 'better efficiency'.\n"
        f"Required numeric anchors (must appear across stats): {', '.join(required_numeric_tokens)}\n\n"
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

    cards = parsed.get("cards")
    if not isinstance(cards, list) or not cards:
        return None
    normalized = _normalize_cards([card for card in cards if isinstance(card, dict)])
    if not _passes_quality_gate(normalized, features):
        return None
    return normalized


def _passes_quality_gate(cards: list[dict], features: dict) -> bool:
    if len(cards) < 3:
        return False

    texts = [str(card.get("text", "")).strip() for card in cards]
    stats = [str(card.get("stat", "")).strip() for card in cards]
    if any(not text for text in texts):
        return False
    if any(not stat for stat in stats):
        return False
    if len({text.lower() for text in texts}) < 2:
        return False

    return True

def recompute_daily_insight_cards(
    conn: sqlite3.Connection,
    day_key: str,
    model: str = DEFAULT_MODEL,
    allow_ai: bool = True,
) -> dict:
    features = _compute_features(conn, day_key)
    selected_model = (model or "").strip()
    cards = _try_ai_cards(features, model=selected_model) if allow_ai and selected_model else None
    source = "ai" if cards is not None else "template"
    if cards is None:
        cards = _template_cards(features)
    cards = _normalize_cards(cards)

    conn.execute(
        """
        INSERT INTO daily_insight_cards (date, cards_json, source, model, updated_at)
        VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(date) DO UPDATE SET
            cards_json=excluded.cards_json,
            source=excluded.source,
            model=excluded.model,
            updated_at=CURRENT_TIMESTAMP
        """,
        (day_key, json.dumps(cards), source, selected_model if source == "ai" else None),
    )
    return {"date": day_key, "cards": cards, "source": source, "model": selected_model if source == "ai" else None}


def fetch_daily_insight_cards(conn: sqlite3.Connection, day_key: str) -> dict | None:
    row = conn.execute(
        """
        SELECT date, cards_json, source, model
        FROM daily_insight_cards
        WHERE date = ?
        """,
        (day_key,),
    ).fetchone()
    if row is None:
        return None
    cards = json.loads(str(row[1] or "[]"))
    return {
        "date": str(row[0]),
        "cards": _normalize_cards(cards if isinstance(cards, list) else []),
        "source": str(row[2] or "template"),
        "model": row[3],
    }


def compute_insight_cards(
    db_path: Path,
    target_day: date,
    force: bool = False,
    allow_ai: bool = True,
    model: str = DEFAULT_MODEL,
) -> dict:
    day_key = target_day.isoformat()
    if not db_path.exists():
        return {"date": day_key, "cards": _default_cards(), "source": "template", "model": None}

    with sqlite3.connect(db_path) as conn:
        conn.row_factory = sqlite3.Row
        ensure_sessions_schema(conn)
        if not force:
            cached = fetch_daily_insight_cards(conn, day_key)
            if cached is not None:
                # App entry should render the most recent cached cards immediately.
                return cached
        payload = recompute_daily_insight_cards(conn, day_key, allow_ai=allow_ai, model=model)
        conn.commit()
        return payload


def refresh_all_daily_insight_cards(conn: sqlite3.Connection) -> int:
    rows = conn.execute("SELECT DISTINCT substr(created_at, 1, 10) AS day_key FROM sessions ORDER BY day_key").fetchall()
    updated = 0
    for row in rows:
        day_key = str(row[0] or "").strip()
        if not day_key:
            continue
        recompute_daily_insight_cards(conn, day_key)
        updated += 1
    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description="Compute/cached daily insight cards.")
    parser.add_argument("--db-path", default=str(DEFAULT_DB_PATH))
    parser.add_argument("--date", default=date.today().isoformat())
    parser.add_argument("--force", action="store_true", help="Force recompute even when cached.")
    parser.add_argument("--no-ai", action="store_true", help="Disable local LLM generation and use template cards.")
    parser.add_argument("--model", default=DEFAULT_MODEL)
    args = parser.parse_args()

    db_path = Path(args.db_path).expanduser().resolve()
    target_day = date.fromisoformat(args.date)
    payload = compute_insight_cards(
        db_path=db_path,
        target_day=target_day,
        force=bool(args.force),
        allow_ai=not bool(args.no_ai),
        model=str(args.model or DEFAULT_MODEL),
    )
    print(json.dumps(payload))


if __name__ == "__main__":
    main()
