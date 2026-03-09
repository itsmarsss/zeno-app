use crate::state::AppSettings;
use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn now_unix_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

fn project_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .unwrap_or_else(|| Path::new(env!("CARGO_MANIFEST_DIR")))
        .to_path_buf()
}

fn resolve_python_bin(root: &Path) -> String {
    let venv_python = root.join(".venv").join("bin").join("python");
    if venv_python.is_file() {
        venv_python.to_string_lossy().to_string()
    } else {
        "python3".to_string()
    }
}

pub fn parse_json_line(stdout: &str) -> Result<Value, String> {
    for line in stdout.lines().rev() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Ok(value) = serde_json::from_str::<Value>(line) {
            return Ok(value);
        }
    }
    Err(format!(
        "Python sidecar did not return JSON. Raw stdout:\n{}",
        stdout
    ))
}

fn extract_session_from_logger_payload(payload: Value) -> Result<Value, String> {
    if let Some(session) = payload.get("session") {
        let mut enriched = session.clone();
        if let Some(map) = enriched.as_object_mut() {
            map.insert(
                "session_id".to_string(),
                payload.get("inserted_id").cloned().unwrap_or(Value::Null),
            );
            map.insert(
                "session_skipped".to_string(),
                payload.get("skipped").cloned().unwrap_or(Value::Bool(false)),
            );
        }
        return Ok(enriched);
    }
    if payload.get("timestamp").is_some() {
        let mut enriched = payload;
        if let Some(map) = enriched.as_object_mut() {
            map.insert("session_id".to_string(), Value::Null);
            map.insert("session_skipped".to_string(), Value::Bool(false));
        }
        return Ok(enriched);
    }
    Err(format!(
        "Unexpected sidecar payload shape. Expected {{session: ...}} or session object. Got: {}",
        payload
    ))
}

pub fn run_python_session_blocking(
    emotion_backend: Option<String>,
    focus_mode: bool,
) -> Result<Value, String> {
    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let logger_script = root.join("backend").join("sqlite_logger.py");
    if !logger_script.is_file() {
        return Err(format!("Missing script: {}", logger_script.display()));
    }

    let backend = emotion_backend.unwrap_or_else(|| "hsemotion".to_string());
    let mut cmd = Command::new(python_bin);
    cmd.arg(logger_script)
        .arg("--emotion-backend")
        .arg(backend);
    if focus_mode {
        cmd.arg("--focus-mode");
    }

    let hsemotion_model = root
        .join("backend")
        .join("models")
        .join("enet_b0_8_best_afew.pt");
    if hsemotion_model.is_file() {
        cmd.arg("--hsemotion-model-path").arg(hsemotion_model);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to start Python sidecar: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "Python sidecar failed (code: {:?})\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            stdout,
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let payload = parse_json_line(&stdout)?;
    extract_session_from_logger_payload(payload)
}

pub fn run_gesture_dismiss_blocking(max_seconds: u32) -> Result<bool, String> {
    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let gesture_script = root.join("backend").join("gesture_dismissal.py");
    if !gesture_script.is_file() {
        return Err(format!("Missing script: {}", gesture_script.display()));
    }

    let output = Command::new(python_bin)
        .arg(gesture_script)
        .arg("--max-seconds")
        .arg(max_seconds.clamp(3, 20).to_string())
        .output()
        .map_err(|e| format!("Failed to run gesture sidecar: {e}"))?;

    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "Gesture sidecar failed (code: {:?})\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            stdout,
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let payload = parse_json_line(&stdout)?;
    Ok(payload
        .get("dismissed")
        .and_then(|v| v.as_bool())
        .unwrap_or(false))
}

pub fn run_session_history_blocking(limit: Option<u32>) -> Result<Value, String> {
    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let history_script = root.join("backend").join("session_history.py");
    if !history_script.is_file() {
        return Err(format!("Missing script: {}", history_script.display()));
    }

    let mut cmd = Command::new(python_bin);
    cmd.arg(history_script)
        .arg("--limit")
        .arg(limit.unwrap_or(20).clamp(1, 100).to_string());

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to read session history: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "Session history failed (code: {:?})\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            stdout,
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    parse_json_line(&stdout)
}

pub fn run_daily_report_blocking(date_iso: Option<String>) -> Result<Value, String> {
    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let report_script = root.join("backend").join("report_aggregator.py");
    if !report_script.is_file() {
        return Err(format!("Missing script: {}", report_script.display()));
    }

    let mut cmd = Command::new(python_bin);
    cmd.arg(report_script);
    if let Some(date) = date_iso {
        cmd.arg("--date").arg(date);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to run daily report: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "Daily report failed (code: {:?})\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            stdout,
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    parse_json_line(&stdout)
}

pub fn run_settings_blocking(patch: Option<Value>) -> Result<AppSettings, String> {
    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let script = root.join("backend").join("settings_store.py");
    if !script.is_file() {
        return Err(format!("Missing script: {}", script.display()));
    }

    let mut cmd = Command::new(python_bin);
    cmd.arg(script);
    if let Some(patch_value) = patch {
        cmd.arg("--set-json").arg(patch_value.to_string());
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to read/update settings: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "Settings script failed (code: {:?})\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            stdout,
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    serde_json::from_value(parse_json_line(&stdout)?)
        .map_err(|e| format!("Invalid settings payload: {e}"))
}

pub fn run_clear_data_blocking() -> Result<Value, String> {
    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let script = root.join("backend").join("clear_data.py");
    if !script.is_file() {
        return Err(format!("Missing script: {}", script.display()));
    }

    let output = Command::new(python_bin)
        .arg(script)
        .output()
        .map_err(|e| format!("Failed to clear local data: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "Clear data failed (code: {:?})\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            stdout,
            stderr
        ));
    }
    parse_json_line(&String::from_utf8_lossy(&output.stdout))
}

pub fn run_calibration_status_blocking() -> Result<Value, String> {
    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let script = root.join("backend").join("calibration_status.py");
    if !script.is_file() {
        return Err(format!("Missing script: {}", script.display()));
    }

    let output = Command::new(python_bin)
        .arg(script)
        .output()
        .map_err(|e| format!("Failed to read calibration status: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "Calibration status failed (code: {:?})\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            stdout,
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    parse_json_line(&stdout)
}

pub fn run_log_breathing_session_blocking(
    exercise_type: String,
    cycles_completed: u32,
    hr_start: Option<f64>,
    hr_end: Option<f64>,
    hr_delta: Option<f64>,
    rr_start: Option<f64>,
    rr_end: Option<f64>,
    rr_delta: Option<f64>,
    triggered_by: String,
) -> Result<Value, String> {
    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let script = root.join("backend").join("breathing_logger.py");
    if !script.is_file() {
        return Err(format!("Missing script: {}", script.display()));
    }

    let mut cmd = Command::new(python_bin);
    cmd.arg(script)
        .arg("--exercise-type")
        .arg(exercise_type)
        .arg("--cycles-completed")
        .arg(cycles_completed.to_string())
        .arg("--triggered-by")
        .arg(triggered_by);

    if let Some(v) = hr_start {
        cmd.arg("--hr-start").arg(v.to_string());
    }
    if let Some(v) = hr_end {
        cmd.arg("--hr-end").arg(v.to_string());
    }
    if let Some(v) = hr_delta {
        cmd.arg("--hr-delta").arg(v.to_string());
    }
    if let Some(v) = rr_start {
        cmd.arg("--rr-start").arg(v.to_string());
    }
    if let Some(v) = rr_end {
        cmd.arg("--rr-end").arg(v.to_string());
    }
    if let Some(v) = rr_delta {
        cmd.arg("--rr-delta").arg(v.to_string());
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to log breathing session: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "Breathing logger failed (code: {:?})\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            stdout,
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    parse_json_line(&stdout)
}

pub fn run_presence_check_blocking() -> Result<Value, String> {
    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let script = root.join("backend").join("presence_check.py");
    if !script.is_file() {
        return Err(format!("Missing script: {}", script.display()));
    }

    let output = Command::new(python_bin)
        .arg(script)
        .output()
        .map_err(|e| format!("Failed to run presence check: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "Presence check failed (code: {:?})\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            stdout,
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    parse_json_line(&stdout)
}

pub fn run_log_break_session_blocking(
    break_seconds: u32,
    away_seconds: u32,
    quality_score: f64,
    genuine_break: bool,
    triggered_by: String,
) -> Result<Value, String> {
    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let script = root.join("backend").join("break_logger.py");
    if !script.is_file() {
        return Err(format!("Missing script: {}", script.display()));
    }

    let mut cmd = Command::new(python_bin);
    cmd.arg(script)
        .arg("--break-seconds")
        .arg(break_seconds.to_string())
        .arg("--away-seconds")
        .arg(away_seconds.to_string())
        .arg("--quality-score")
        .arg(quality_score.to_string())
        .arg("--triggered-by")
        .arg(triggered_by);
    if genuine_break {
        cmd.arg("--genuine-break");
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to log break session: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "Break logger failed (code: {:?})\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            stdout,
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    parse_json_line(&stdout)
}

pub fn run_update_session_notification_blocking(
    session_id: u64,
    notification_sent: Option<String>,
    notification_dismissed_by: Option<String>,
) -> Result<Value, String> {
    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let script = root.join("backend").join("session_notification.py");
    if !script.is_file() {
        return Err(format!("Missing script: {}", script.display()));
    }

    let mut cmd = Command::new(python_bin);
    cmd.arg(script)
        .arg("--session-id")
        .arg(session_id.to_string());
    if let Some(value) = notification_sent {
        cmd.arg("--notification-sent").arg(value);
    }
    if let Some(value) = notification_dismissed_by {
        cmd.arg("--notification-dismissed-by").arg(value);
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to update session notification: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "Session notification update failed (code: {:?})\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            stdout,
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    parse_json_line(&stdout)
}

pub fn run_log_exercise_session_blocking(
    exercise_id: String,
    completed: bool,
    form_score: Option<f64>,
    duration_seconds: Option<f64>,
    triggered_by: String,
) -> Result<Value, String> {
    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let script = root.join("backend").join("exercise_logger.py");
    if !script.is_file() {
        return Err(format!("Missing script: {}", script.display()));
    }

    let mut cmd = Command::new(python_bin);
    cmd.arg(script)
        .arg("--exercise-id")
        .arg(exercise_id)
        .arg("--triggered-by")
        .arg(triggered_by);
    if completed {
        cmd.arg("--completed");
    }
    if let Some(value) = form_score {
        cmd.arg("--form-score").arg(value.to_string());
    }
    if let Some(value) = duration_seconds {
        cmd.arg("--duration-seconds").arg(value.to_string());
    }

    let output = cmd
        .output()
        .map_err(|e| format!("Failed to log exercise session: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "Exercise logger failed (code: {:?})\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            stdout,
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    parse_json_line(&stdout)
}

pub fn run_export_sessions_csv_blocking() -> Result<Value, String> {
    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let script = root.join("backend").join("export_csv.py");
    if !script.is_file() {
        return Err(format!("Missing script: {}", script.display()));
    }

    let output = Command::new(python_bin)
        .arg(script)
        .output()
        .map_err(|e| format!("Failed to export CSV: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        return Err(format!(
            "CSV export failed (code: {:?})\nstdout:\n{}\nstderr:\n{}",
            output.status.code(),
            stdout,
            stderr
        ));
    }

    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    parse_json_line(&stdout)
}
