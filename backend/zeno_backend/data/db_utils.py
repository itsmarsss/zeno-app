from __future__ import annotations

import math
import sqlite3
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable, Mapping, Sequence


# Physiological plausibility bounds used when aggregating signals.
HR_MIN_BPM = 35.0
HR_MAX_BPM = 200.0
RR_MIN_BPM = 6.0
RR_MAX_BPM = 40.0
POSTURE_MIN = 0.0
POSTURE_MAX = 1.0
STRESS_MIN = 0
STRESS_MAX = 100


def connect_db(db_path: Path | str, *, wal: bool = True, timeout: float = 30.0) -> sqlite3.Connection:
    """Open a SQLite connection with safe defaults for concurrent readers/writers."""
    path = Path(db_path)
    path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=float(timeout))
    conn.row_factory = sqlite3.Row
    try:
        conn.execute("PRAGMA foreign_keys = ON")
        if wal:
            conn.execute("PRAGMA journal_mode = WAL")
        conn.execute(f"PRAGMA busy_timeout = {int(max(1000, timeout * 1000))}")
    except sqlite3.Error:
        pass
    return conn


def safe_float(value: Any, default: float | None = None) -> float | None:
    if value is None:
        return default
    if isinstance(value, bool):
        return float(int(value))
    try:
        number = float(value)
    except (TypeError, ValueError):
        return default
    if not math.isfinite(number):
        return default
    return number


def safe_int(value: Any, default: int | None = None) -> int | None:
    number = safe_float(value, default=None)
    if number is None:
        return default
    try:
        return int(round(number))
    except (TypeError, ValueError, OverflowError):
        return default


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, float(value)))


def clamp_int(value: int, low: int, high: int) -> int:
    return max(low, min(high, int(value)))


def day_key_from_timestamp(value: Any) -> str:
    text = str(value or "").strip()
    if len(text) >= 10:
        return text[:10]
    return text


def is_focus_session(mode: Any = None, focus_mode: Any = None) -> bool:
    if safe_int(focus_mode, 0) == 1:
        return True
    return str(mode or "").strip().lower() == "focus"


def valid_heart_rate(value: Any) -> float | None:
    hr = safe_float(value, None)
    if hr is None:
        return None
    if hr < HR_MIN_BPM or hr > HR_MAX_BPM:
        return None
    return hr


def valid_respiratory_rate(value: Any, confidence: Any = None) -> float | None:
    rr = safe_float(value, None)
    if rr is None or rr <= 0:
        return None
    conf = str(confidence or "none").strip().lower()
    if conf not in {"partial", "full"}:
        return None
    if rr < RR_MIN_BPM or rr > RR_MAX_BPM:
        return None
    return rr


def valid_posture_score(value: Any) -> float | None:
    score = safe_float(value, None)
    if score is None:
        return None
    if score < POSTURE_MIN or score > POSTURE_MAX:
        return None
    return score


def valid_stress_index(value: Any) -> int | None:
    stress = safe_int(value, None)
    if stress is None:
        return None
    if stress < STRESS_MIN or stress > STRESS_MAX:
        return None
    return stress


def mean_or_none(values: Iterable[float | int]) -> float | None:
    cleaned = [float(v) for v in values if v is not None and math.isfinite(float(v))]
    if not cleaned:
        return None
    return sum(cleaned) / len(cleaned)


def _row_get(row: Mapping[str, Any] | sqlite3.Row | Sequence[Any], key: str, index: int | None = None) -> Any:
    if isinstance(row, Mapping):
        return row.get(key)
    if isinstance(row, sqlite3.Row):
        try:
            return row[key]
        except (IndexError, KeyError):
            return None
    if index is not None and isinstance(row, Sequence):
        try:
            return row[index]
        except IndexError:
            return None
    return None


def focus_session_durations_seconds(rows: Iterable[Mapping[str, Any] | sqlite3.Row]) -> list[float]:
    """
    Collapse focus samples into per-session durations (seconds).

    Focus Mode writes many short samples that share a focus_session_id. For those,
    duration is the max focus_duration_seconds (elapsed session length), falling back
    to the sum of sample windows when elapsed duration is missing.

    Rows without a focus_session_id are treated as independent sessions.
    """
    groups: dict[str, list[tuple[float, float]]] = defaultdict(list)
    anon_i = 0
    for row in rows:
        mode = _row_get(row, "mode")
        focus_mode = _row_get(row, "focus_mode")
        if not is_focus_session(mode=mode, focus_mode=focus_mode):
            continue
        raw_id = _row_get(row, "focus_session_id")
        session_id = str(raw_id).strip() if raw_id is not None else ""
        if not session_id:
            anon_i += 1
            session_id = f"__anon_{anon_i}"
        focus_dur = max(0.0, safe_float(_row_get(row, "focus_duration_seconds"), 0.0) or 0.0)
        sample_dur = max(0.0, safe_float(_row_get(row, "session_duration_seconds"), 0.0) or 0.0)
        groups[session_id].append((focus_dur, sample_dur))

    durations: list[float] = []
    for session_id, samples in groups.items():
        if session_id.startswith("__anon_"):
            focus_dur, sample_dur = samples[0]
            durations.append(max(focus_dur, sample_dur))
            continue
        max_focus = max(focus for focus, _ in samples)
        if max_focus > 0:
            durations.append(max_focus)
        else:
            durations.append(sum(sample for _, sample in samples))
    return durations


def focused_minutes_from_rows(rows: Iterable[Mapping[str, Any] | sqlite3.Row]) -> tuple[int, int, int]:
    """
    Returns (focused_minutes, focus_session_count, avg_focus_session_minutes).
    """
    durations = focus_session_durations_seconds(rows)
    if not durations:
        return 0, 0, 0
    total_seconds = sum(durations)
    focused_minutes = int(round(total_seconds / 60.0))
    session_count = len(durations)
    avg_minutes = int(round((total_seconds / session_count) / 60.0)) if session_count else 0
    return focused_minutes, session_count, avg_minutes


def ensure_break_sessions_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS break_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          break_seconds INTEGER NOT NULL,
          away_seconds INTEGER NOT NULL,
          quality_score REAL NOT NULL,
          genuine_break INTEGER NOT NULL,
          triggered_by TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_break_sessions_timestamp ON break_sessions(timestamp)"
    )


def ensure_breathing_sessions_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS breathing_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          exercise_type TEXT,
          cycles_completed INTEGER,
          hr_start REAL,
          hr_end REAL,
          hr_delta REAL,
          rr_start REAL,
          rr_end REAL,
          rr_delta REAL,
          triggered_by TEXT
        )
        """
    )
    columns = {row[1] for row in conn.execute("PRAGMA table_info(breathing_sessions)").fetchall()}
    if "rr_start" not in columns:
        conn.execute("ALTER TABLE breathing_sessions ADD COLUMN rr_start REAL")
    if "rr_end" not in columns:
        conn.execute("ALTER TABLE breathing_sessions ADD COLUMN rr_end REAL")
    if "rr_delta" not in columns:
        conn.execute("ALTER TABLE breathing_sessions ADD COLUMN rr_delta REAL")
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_breathing_sessions_timestamp ON breathing_sessions(timestamp)"
    )


def ensure_exercise_sessions_table(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS exercise_sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
          exercise_id TEXT NOT NULL,
          completed INTEGER NOT NULL,
          form_score REAL,
          duration_seconds REAL,
          triggered_by TEXT
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_exercise_sessions_timestamp ON exercise_sessions(timestamp)"
    )


def day_break_stats(conn: sqlite3.Connection, day_key: str) -> tuple[int, int] | None:
    """
    Return (break_count, break_minutes) from break_sessions for a day, or None if empty.
    Prefers genuine breaks when any are present.
    """
    try:
        ensure_break_sessions_table(conn)
        rows = conn.execute(
            """
            SELECT break_seconds, genuine_break
            FROM break_sessions
            WHERE substr(timestamp, 1, 10) = ?
            """,
            (day_key,),
        ).fetchall()
    except sqlite3.Error:
        return None
    if not rows:
        return None

    genuine = [row for row in rows if safe_int(_row_get(row, "genuine_break", 1), 0) == 1]
    selected = genuine if genuine else list(rows)
    total_seconds = sum(max(0, safe_int(_row_get(row, "break_seconds", 0), 0) or 0) for row in selected)
    return len(selected), int(round(total_seconds / 60.0))
