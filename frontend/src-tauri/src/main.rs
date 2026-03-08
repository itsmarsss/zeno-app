#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Emitter, Manager,
};
use tauri_plugin_notification::NotificationExt;

#[derive(Default)]
struct SessionState {
    running: AtomicBool,
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

fn parse_json_line(stdout: &str) -> Result<Value, String> {
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
        return Ok(session.clone());
    }
    if payload.get("timestamp").is_some() {
        return Ok(payload);
    }
    Err(format!(
        "Unexpected sidecar payload shape. Expected {{session: ...}} or session object. Got: {}",
        payload
    ))
}

fn run_python_session_blocking(emotion_backend: Option<String>) -> Result<Value, String> {
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

fn run_session_history_blocking(limit: Option<u32>) -> Result<Value, String> {
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

fn stress_index_from_result(result: &Value) -> Option<u8> {
    let emotion = result
        .get("dominant_emotion")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_lowercase();
    let emotion_score = result
        .get("emotion_score")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let heart_rate = result.get("heart_rate_bpm").and_then(|v| v.as_f64());

    let emotion_points = match emotion.as_str() {
        "fear" => 28.0,
        "angry" | "anger" => 25.0,
        "disgust" | "contempt" => 22.0,
        "sad" | "sadness" => 16.0,
        "neutral" => 8.0,
        "surprise" => 12.0,
        "happy" | "happiness" => 4.0,
        _ => 10.0,
    } * emotion_score.max(0.25);

    let hr_points = match heart_rate {
        Some(bpm) if bpm >= 105.0 => 52.0,
        Some(bpm) if bpm >= 95.0 => 40.0,
        Some(bpm) if bpm >= 85.0 => 28.0,
        Some(bpm) if bpm >= 75.0 => 14.0,
        Some(_) => 6.0,
        None => 8.0,
    };

    let score = (emotion_points + hr_points).round();
    Some(score.clamp(0.0, 100.0) as u8)
}

fn notification_for_result(result: &Value) -> Option<(String, String)> {
    let posture_score = result
        .get("posture_score")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0);

    if posture_score < 0.45 {
        return Some((
            "Posture Check".to_string(),
            "Straighten up and roll your shoulders back.".to_string(),
        ));
    }

    let stress_index = stress_index_from_result(result)?;
    if stress_index >= 61 {
        return Some((
            "Stress Check".to_string(),
            "Take a 5 minute break. Step away for a reset.".to_string(),
        ));
    }
    if (31..=60).contains(&stress_index) {
        return Some((
            "Focus Check".to_string(),
            "You have been locked in for a while. Grab some water.".to_string(),
        ));
    }
    None
}

fn notify_for_session(app: &tauri::AppHandle, result: &Value) {
    if let Some((title, body)) = notification_for_result(result) {
        let _ = app.notification().builder().title(title).body(body).show();
    }
}

#[tauri::command]
async fn run_python_session(
    emotion_backend: Option<String>,
    app: tauri::AppHandle,
    state: tauri::State<'_, SessionState>,
) -> Result<Value, String> {
    if state.running.swap(true, Ordering::SeqCst) {
        return Err("A session is already running.".to_string());
    }

    let result = tauri::async_runtime::spawn_blocking(move || {
        run_python_session_blocking(emotion_backend)
    })
    .await
    .map_err(|e| format!("Session task join error: {e}"))?;

    state.running.store(false, Ordering::SeqCst);
    if let Ok(ref payload) = result {
        notify_for_session(&app, payload);
    }
    result
}

#[tauri::command]
async fn run_session_history(limit: Option<u32>) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || run_session_history_blocking(limit))
        .await
        .map_err(|e| format!("History task join error: {e}"))?
}

fn start_scheduler(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(600));

            let state = app_handle.state::<SessionState>();
            if state.running.swap(true, Ordering::SeqCst) {
                let _ = app_handle.emit(
                    "scheduler-skip",
                    serde_json::json!({"reason": "session already running"}),
                );
                continue;
            }

            let session_result = run_python_session_blocking(None);
            state.running.store(false, Ordering::SeqCst);

            match session_result {
                Ok(payload) => {
                    notify_for_session(&app_handle, &payload);
                    let _ = app_handle.emit(
                        "session-result",
                        serde_json::json!({
                            "source": "scheduler",
                            "result": payload
                        }),
                    );
                }
                Err(err_msg) => {
                    let _ = app_handle.emit(
                        "session-error",
                        serde_json::json!({
                            "source": "scheduler",
                            "error": err_msg
                        }),
                    );
                }
            }
        }
    });
}

fn main() {
    let app_builder = tauri::Builder::default()
        .manage(SessionState::default())
        .invoke_handler(tauri::generate_handler![run_python_session, run_session_history])
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let open_item = MenuItemBuilder::with_id("open", "Open Zeno").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&open_item)
                .item(&quit_item)
                .build()?;

            let _tray = TrayIconBuilder::new()
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .icon(app.default_window_icon().unwrap().clone())
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            start_scheduler(&app.app_handle());

            Ok(())
        });

    app_builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
