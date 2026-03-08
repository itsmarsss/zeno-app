use crate::notifications::{notify_for_session, start_gesture_dismiss_listener};
use crate::python_sidecar::{
    run_calibration_status_blocking, run_clear_data_blocking, run_daily_report_blocking,
    run_log_break_session_blocking, run_log_breathing_session_blocking, run_presence_check_blocking,
    run_python_session_blocking, run_session_history_blocking, run_settings_blocking,
};
use crate::state::{HrStreamState, NotificationState, PostureStreamState, SessionState, SettingsState};
use serde_json::Value;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use tauri::{Emitter, Manager, WebviewWindowBuilder};

#[tauri::command]
pub async fn run_python_session(
    emotion_backend: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, SessionState>,
    notification_state: tauri::State<'_, NotificationState>,
    settings_state: tauri::State<'_, SettingsState>,
) -> Result<Value, String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("A session is already running.".to_string());
    }

    let focus_mode = settings_state
        .inner
        .lock()
        .map(|g| g.focus_mode_active)
        .unwrap_or(false);

    let result = tauri::async_runtime::spawn_blocking(move || {
        run_python_session_blocking(emotion_backend, focus_mode)
    })
    .await
    .map_err(|e| format!("Session task join error: {e}"))?;

    state.running.store(false, Ordering::SeqCst);
    if let Ok(ref payload) = result {
        if notify_for_session(&app, &notification_state, payload) {
            start_gesture_dismiss_listener(&app);
        }
    }
    result
}

#[tauri::command]
pub async fn run_session_history(limit: Option<u32>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_session_history_blocking(limit))
        .await
        .map_err(|e| format!("History task join error: {e}"))?
}

#[tauri::command]
pub async fn run_daily_report(date_iso: Option<String>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_daily_report_blocking(date_iso))
        .await
        .map_err(|e| format!("Report task join error: {e}"))?
}

#[tauri::command]
pub async fn run_get_settings(settings_state: tauri::State<'_, SettingsState>) -> Result<Value, String> {
    let settings = tauri::async_runtime::spawn_blocking(|| run_settings_blocking(None))
        .await
        .map_err(|e| format!("Settings task join error: {e}"))??;

    if let Ok(mut guard) = settings_state.inner.lock() {
        *guard = settings.clone();
    }
    serde_json::to_value(settings).map_err(|e| format!("Failed to serialize settings: {e}"))
}

#[tauri::command]
pub async fn run_update_settings(
    patch: Value,
    settings_state: tauri::State<'_, SettingsState>,
) -> Result<Value, String> {
    let settings = tauri::async_runtime::spawn_blocking(move || run_settings_blocking(Some(patch)))
        .await
        .map_err(|e| format!("Settings update join error: {e}"))??;
    if let Ok(mut guard) = settings_state.inner.lock() {
        *guard = settings.clone();
    }
    serde_json::to_value(settings).map_err(|e| format!("Failed to serialize settings: {e}"))
}

#[tauri::command]
pub async fn run_clear_data() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(run_clear_data_blocking)
        .await
        .map_err(|e| format!("Clear data task join error: {e}"))?
}

#[tauri::command]
pub async fn run_calibration_status() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(run_calibration_status_blocking)
        .await
        .map_err(|e| format!("Calibration task join error: {e}"))?
}

#[tauri::command]
pub async fn run_log_breathing_session(
    exercise_type: String,
    cycles_completed: u32,
    hr_start: Option<f64>,
    hr_end: Option<f64>,
    hr_delta: Option<f64>,
    triggered_by: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_log_breathing_session_blocking(
            exercise_type,
            cycles_completed,
            hr_start,
            hr_end,
            hr_delta,
            triggered_by.unwrap_or_else(|| "manual".to_string()),
        )
    })
    .await
    .map_err(|e| format!("Breathing log task join error: {e}"))?
}

#[tauri::command]
pub async fn run_presence_check() -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(run_presence_check_blocking)
        .await
        .map_err(|e| format!("Presence check task join error: {e}"))?
}

#[tauri::command]
pub async fn run_log_break_session(
    break_seconds: u32,
    away_seconds: u32,
    quality_score: f64,
    genuine_break: bool,
    triggered_by: Option<String>,
) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || {
        run_log_break_session_blocking(
            break_seconds,
            away_seconds,
            quality_score,
            genuine_break,
            triggered_by.unwrap_or_else(|| "manual".to_string()),
        )
    })
    .await
    .map_err(|e| format!("Break log task join error: {e}"))?
}

#[tauri::command]
pub fn open_main_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("main-window") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|w| w.label == "main-window")
        .ok_or_else(|| "Missing main-window config".to_string())?;

    let window = WebviewWindowBuilder::from_config(&app, config)
        .map_err(|e| format!("Failed to build main window config: {e}"))?
        .build()
        .map_err(|e| format!("Failed to create main window: {e}"))?;
    let _ = window.show();
    let _ = window.set_focus();
    Ok(())
}

fn project_root() -> std::path::PathBuf {
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

#[tauri::command]
pub async fn start_posture_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, PostureStreamState>,
    fps: Option<f64>,
    exercise_id: Option<String>,
) -> Result<(), String> {
    {
        let mut guard = state
            .child
            .lock()
            .map_err(|_| "Failed to lock posture stream state".to_string())?;
        if guard.is_some() {
            return Ok(());
        }

        let root = project_root();
        let python_bin = resolve_python_bin(&root);
        let script = root.join("backend").join("posture_stream.py");
        if !script.is_file() {
            return Err(format!("Missing script: {}", script.display()));
        }

        let mut child = Command::new(python_bin)
            .arg(script)
            .arg("--fps")
            .arg(fps.unwrap_or(8.0).clamp(2.0, 15.0).to_string())
            .args(
                exercise_id
                    .as_ref()
                    .map(|id| vec!["--exercise-id".to_string(), id.clone()])
                    .unwrap_or_default(),
            )
            .stdout(Stdio::piped())
            .stderr(Stdio::null())
            .spawn()
            .map_err(|e| format!("Failed to start posture stream sidecar: {e}"))?;

        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "Failed to capture posture stream stdout".to_string())?;
        *guard = Some(child);

        let app_handle = app.clone();
        tauri::async_runtime::spawn_blocking(move || {
            let reader = BufReader::new(stdout);
            for line_result in reader.lines() {
                let Ok(line) = line_result else {
                    break;
                };
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                if let Ok(payload) = serde_json::from_str::<Value>(trimmed) {
                    let _ = app_handle.emit("posture-stream-frame", payload);
                }
            }
            let _ = app_handle.emit("posture-stream-ended", Value::Null);
        });
    }

    Ok(())
}

#[tauri::command]
pub async fn stop_posture_stream(state: tauri::State<'_, PostureStreamState>) -> Result<(), String> {
    let mut guard = state
        .child
        .lock()
        .map_err(|_| "Failed to lock posture stream state".to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}

#[tauri::command]
pub async fn start_hr_stream(
    app: tauri::AppHandle,
    state: tauri::State<'_, HrStreamState>,
    update_every: Option<f64>,
    window_seconds: Option<f64>,
    max_seconds: Option<f64>,
) -> Result<(), String> {
    let mut guard = state
        .child
        .lock()
        .map_err(|_| "Failed to lock HR stream state".to_string())?;
    if guard.is_some() {
        return Ok(());
    }

    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let script = root.join("backend").join("rppg_estimator.py");
    if !script.is_file() {
        return Err(format!("Missing script: {}", script.display()));
    }

    let mut child = Command::new(python_bin)
        .arg(script)
        .arg("--continuous")
        .arg("--update-every")
        .arg(update_every.unwrap_or(4.0).clamp(1.0, 10.0).to_string())
        .arg("--window-seconds")
        .arg(window_seconds.unwrap_or(20.0).clamp(8.0, 45.0).to_string())
        .arg("--max-seconds")
        .arg(max_seconds.unwrap_or(0.0).max(0.0).to_string())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|e| format!("Failed to start HR stream sidecar: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Failed to capture HR stream stdout".to_string())?;
    *guard = Some(child);

    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let reader = BufReader::new(stdout);
        for line_result in reader.lines() {
            let Ok(line) = line_result else {
                break;
            };
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            if let Ok(payload) = serde_json::from_str::<Value>(trimmed) {
                let _ = app_handle.emit("hr-stream-update", payload);
            }
        }
        let _ = app_handle.emit("hr-stream-ended", Value::Null);
    });

    Ok(())
}

#[tauri::command]
pub async fn stop_hr_stream(state: tauri::State<'_, HrStreamState>) -> Result<(), String> {
    let mut guard = state
        .child
        .lock()
        .map_err(|_| "Failed to lock HR stream state".to_string())?;
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
        let _ = child.wait();
    }
    Ok(())
}
