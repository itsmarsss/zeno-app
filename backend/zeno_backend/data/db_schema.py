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
            tracking_confidence REAL,
            head_offset_norm REAL,
            shoulder_tilt_signed_norm REAL,
            shoulder_tilt_norm REAL,
            posture_stability_std REAL,
            posture_stability_label TEXT,
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
    if "tracking_confidence" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN tracking_confidence REAL")
    if "head_offset_norm" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN head_offset_norm REAL")
    if "shoulder_tilt_signed_norm" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN shoulder_tilt_signed_norm REAL")
    if "shoulder_tilt_norm" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN shoulder_tilt_norm REAL")
    if "posture_stability_std" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN posture_stability_std REAL")
    if "posture_stability_label" not in columns:
        conn.execute("ALTER TABLE sessions ADD COLUMN posture_stability_label TEXT")
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
          tracking_confidence = COALESCE(tracking_confidence, 0.0),
          head_offset_norm = COALESCE(head_offset_norm, 0.0),
          shoulder_tilt_signed_norm = COALESCE(shoulder_tilt_signed_norm, 0.0),
          shoulder_tilt_norm = COALESCE(shoulder_tilt_norm, 0.0),
          posture_stability_std = COALESCE(posture_stability_std, 0.0),
          posture_stability_label = COALESCE(NULLIF(posture_stability_label, ''), 'learning'),
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

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS baseline (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
            resting_hr REAL,
            resting_rr REAL,
            ear_shoulder_offset REAL,
            neck_spine_angle REAL,
            posture_baseline_score REAL,
            calibration_sessions_completed INTEGER NOT NULL DEFAULT 0,
            is_calibrated INTEGER NOT NULL DEFAULT 0
        )
        """
    )
    baseline_columns = {row[1] for row in conn.execute("PRAGMA table_info(baseline)").fetchall()}
    if "posture_baseline_score" not in baseline_columns:
        conn.execute("ALTER TABLE baseline ADD COLUMN posture_baseline_score REAL")
    if "calibration_sessions_completed" not in baseline_columns:
        conn.execute(
            "ALTER TABLE baseline ADD COLUMN calibration_sessions_completed INTEGER NOT NULL DEFAULT 0"
        )
    if "is_calibrated" not in baseline_columns:
        conn.execute("ALTER TABLE baseline ADD COLUMN is_calibrated INTEGER NOT NULL DEFAULT 0")

    conn.execute(
        """
        INSERT INTO baseline (id, updated_at, calibration_sessions_completed, is_calibrated)
        VALUES (1, CURRENT_TIMESTAMP, 0, 0)
        ON CONFLICT(id) DO NOTHING
        """
    )
