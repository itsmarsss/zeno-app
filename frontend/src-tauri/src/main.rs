#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde_json::Value;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

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

#[tauri::command]
fn run_python_session(emotion_backend: Option<String>) -> Result<Value, String> {
    let root = project_root();
    let python_bin = resolve_python_bin(&root);
    let session_script = root.join("backend").join("session_runner.py");
    if !session_script.is_file() {
        return Err(format!("Missing script: {}", session_script.display()));
    }

    let backend = emotion_backend.unwrap_or_else(|| "hsemotion".to_string());
    let mut cmd = Command::new(python_bin);
    cmd.arg(session_script)
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
    parse_json_line(&stdout)
}

fn main() {
    let app_builder = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![run_python_session])
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

            Ok(())
        });

    app_builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
