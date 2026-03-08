#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod notifications;
mod python_sidecar;
mod schedulers;
mod state;

use commands::{
    run_calibration_status, run_clear_data, run_daily_report, run_get_settings, run_python_session,
    run_session_history, run_update_settings,
};
use python_sidecar::run_settings_blocking;
use schedulers::{start_daily_report_trigger, start_scheduler};
use state::{NotificationState, ReportState, SessionState, SettingsState};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager,
};

fn main() {
    let app_builder = tauri::Builder::default()
        .manage(SessionState::default())
        .manage(NotificationState::default())
        .manage(ReportState::default())
        .manage(SettingsState::default())
        .invoke_handler(tauri::generate_handler![
            run_python_session,
            run_session_history,
            run_daily_report,
            run_get_settings,
            run_update_settings,
            run_clear_data,
            run_calibration_status
        ])
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            if let Ok(settings) = run_settings_blocking(None) {
                let settings_state = app.state::<SettingsState>();
                let lock_result = settings_state.inner.lock();
                if let Ok(mut guard) = lock_result {
                    *guard = settings;
                }
            }

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
            start_daily_report_trigger(&app.app_handle());

            Ok(())
        });

    app_builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
