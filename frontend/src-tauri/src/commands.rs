use crate::notifications::{notify_for_session, start_gesture_dismiss_listener};
use crate::python_sidecar::{
    run_calibration_status_blocking, run_clear_data_blocking, run_daily_report_blocking,
    run_log_break_session_blocking, run_log_breathing_session_blocking, run_presence_check_blocking,
    run_python_session_blocking, run_session_history_blocking, run_settings_blocking,
};
use crate::state::{NotificationState, SessionState, SettingsState};
use serde_json::Value;
use std::sync::atomic::Ordering;
use tauri::{Manager, WebviewWindowBuilder};

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
