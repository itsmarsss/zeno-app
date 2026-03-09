from __future__ import annotations

import sqlite3


def ensure_sessions_schema(conn: sqlite3.Connection) -> None:
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            presence_detected INTEGER NOT NULL,
            analysis_skipped INTEGER NOT NULL DEFAULT 0,
            posture_score REAL NOT NULL,
            baseline_posture_score REAL,
            posture_deviation REAL,
            posture_is_poor INTEGER NOT NULL DEFAULT 0,
            dominant_emotion TEXT NOT NULL,
            emotion_score REAL NOT NULL,
            heart_rate_bpm REAL,
            respiratory_rate REAL NOT NULL DEFAULT 0.0,
            rr_confidence TEXT NOT NULL DEFAULT 'none',
            emotion_backend TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'passive',
            focus_duration_seconds INTEGER NOT NULL DEFAULT 0,
            focus_mode INTEGER NOT NULL DEFAULT 0,
            notification_sent TEXT,
            notification_dismissed_by TEXT,
            session_duration_seconds REAL NOT NULL,
            raw_json TEXT NOT NULL
        )
        """
    )
    columns = {row[1] for row in conn.execute("PRAGMA table_info(sessions)").fetchall()}

    if "focus_mode" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN focus_mode INTEGER NOT NULL DEFAULT 0")
    if "analysis_skipped" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN analysis_skipped INTEGER NOT NULL DEFAULT 0")
    if "baseline_posture_score" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN baseline_posture_score REAL")
    if "posture_deviation" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN posture_deviation REAL")
    if "posture_is_poor" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN posture_is_poor INTEGER NOT NULL DEFAULT 0")
    if "notification_sent" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN notification_sent TEXT")
    if "notification_dismissed_by" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN notification_dismissed_by TEXT")
    if "respiratory_rate" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN respiratory_rate REAL NOT NULL DEFAULT 0.0")
    if "rr_confidence" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN rr_confidence TEXT NOT NULL DEFAULT 'none'")
    if "mode" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN mode TEXT NOT NULL DEFAULT 'passive'")
    if "focus_duration_seconds" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN focus_duration_seconds INTEGER NOT NULL DEFAULT 0")

    # Backfill legacy rows so downstream code can treat these fields as present.
    conn.execute(
        """
        UPDATE sessions
        SET
          analysis_skipped = COALESCE(analysis_skipped, 0),
          baseline_posture_score = COALESCE(baseline_posture_score, 0.0),
          posture_deviation = COALESCE(posture_deviation, 0.0),
          posture_is_poor = COALESCE(posture_is_poor, 0),
          respiratory_rate = COALESCE(respiratory_rate, 0.0),
          rr_confidence = COALESCE(NULLIF(rr_confidence, ''), 'none'),
          mode = COALESCE(NULLIF(mode, ''), 'passive'),
          focus_duration_seconds = COALESCE(focus_duration_seconds, 0),
          notification_sent = COALESCE(NULLIF(notification_sent, ''), 'none'),
          notification_dismissed_by = COALESCE(NULLIF(notification_dismissed_by, ''), 'none')
        """
    )
