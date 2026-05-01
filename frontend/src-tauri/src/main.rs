#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod commands;
mod notifications;
mod python_sidecar;
mod schedulers;
mod state;

use commands::{
    hide_window, open_main_window, run_activity_stats, run_calibration_status, run_clear_data,
    run_daily_report, run_exercise_history, run_export_sessions_csv, run_get_settings,
    run_log_break_session, run_log_breathing_session, run_log_exercise_session,
    run_monitor_timeline, run_overview_aggregates, run_posture_insights, run_presence_check,
    run_python_session, run_recalibrate_baseline, run_session_days, run_session_history,
    run_update_settings, start_focus_stream, start_hr_stream, start_posture_stream,
    stop_focus_stream, stop_hr_stream, stop_posture_stream,
};
use python_sidecar::run_settings_blocking;
use schedulers::{
    start_daily_report_trigger, start_focus_mode_timer, start_scheduler,
};
use state::{
    FocusStreamState, FocusTimerState, HrStreamState, NotificationState, PostureStreamState,
    ReportState, SessionState, SettingsState,
};
use std::path::PathBuf;
use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    window::Color,
    Manager, PhysicalPosition, Position, Rect, Size, WebviewWindow, WindowEvent,
};
use tauri_plugin_autostart::{MacosLauncher, ManagerExt as AutostartExt};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_updater::UpdaterExt;

fn icons_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("icons")
}

fn load_app_icon() -> Option<Image<'static>> {
    let candidates = [
        icons_dir().join("icon.png"),
        icons_dir().join("app-icon-source.png"),
        icons_dir().join("128x128.png"),
        icons_dir().join("henry.w@example.net"),
    ];
    for path in candidates {
        if path.is_file() {
            if let Ok(image) = Image::from_path(&path) {
                return Some(image);
            }
        }
    }
    None
}

fn check_for_updates_on_launch(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    tauri::async_runtime::spawn(async move {
        // Silent failure by design: updater should never impact app startup.
        let Ok(updater) = app_handle.updater() else {
            return;
        };
        let Ok(maybe_update) = updater.check().await else {
            return;
        };
        let Some(update) = maybe_update else {
            return;
        };

        let prompt = "A new version of Zeno is available. Update now?";
        let app_for_dialog = app_handle.clone();
        app_handle
            .dialog()
            .message(prompt)
            .title("Zeno Update")
            .kind(MessageDialogKind::Info)
            .buttons(MessageDialogButtons::OkCancelCustom(
                "Update now".to_string(),
                "Later".to_string(),
            ))
            .show(move |accepted| {
                if !accepted {
                    return;
                }
                let app_for_update = app_for_dialog.clone();
                tauri::async_runtime::spawn(async move {
                    if update.download_and_install(|_, _| {}, || {}).await.is_ok() {
                        app_for_update.restart();
                    }
                });
            });
    });
}

fn rect_as_physical(rect: &Rect, scale_factor: f64) -> (f64, f64, f64, f64) {
    let x = match rect.position {
        Position::Physical(pos) => pos.x as f64,
        Position::Logical(pos) => pos.x * scale_factor,
    };
    let y = match rect.position {
        Position::Physical(pos) => pos.y as f64,
        Position::Logical(pos) => pos.y * scale_factor,
    };
    let width = match rect.size {
        Size::Physical(size) => size.width as f64,
        Size::Logical(size) => size.width * scale_factor,
    };
    let height = match rect.size {
        Size::Physical(size) => size.height as f64,
        Size::Logical(size) => size.height * scale_factor,
    };
    (x, y, width, height)
}

fn tray_anchor_point(
    rect: &Rect,
    click_position: &PhysicalPosition<f64>,
    scale_factor: f64,
) -> (f64, f64) {
    let (x, y, width, height) = rect_as_physical(rect, scale_factor);
    // Keep the popover snug under the menu bar (only a couple physical px of air).
    // Extra gap used to come from this offset stacked with CSS top margin.
    let gap = (2.0 * scale_factor).max(2.0);
    if width > 0.0 && height > 0.0 {
        (x + width / 2.0, y + height + gap)
    } else {
        (click_position.x, click_position.y + gap)
    }
}

fn position_popover_window(
    window: &WebviewWindow,
    click_position: &PhysicalPosition<f64>,
    tray_rect: &Rect,
) {
    let Ok(size) = window.outer_size() else {
        println!("[tray] could not read window outer_size");
        return;
    };

    let width = size.width as i32;
    let height = size.height as i32;
    if width <= 0 || height <= 0 {
        println!("[tray] invalid window size: {}x{}", width, height);
        return;
    }

    let scale_factor = window
        .monitor_from_point(click_position.x, click_position.y)
        .ok()
        .flatten()
        .map(|m| m.scale_factor())
        .unwrap_or(1.0);
    let (anchor_x, anchor_y) = tray_anchor_point(tray_rect, click_position, scale_factor);
    let target_x = (anchor_x.round() as i32) - width / 2;
    let target_y = anchor_y.round() as i32;

    println!(
        "[tray] click=({:.1}, {:.1}) scale={} tray_rect=({:?}, {:?}) anchor=({:.1}, {:.1}) target=({}, {}) size={}x{}",
        click_position.x,
        click_position.y,
        scale_factor,
        tray_rect.position,
        tray_rect.size,
        anchor_x,
        anchor_y,
        target_x,
        target_y,
        width,
        height
    );

    let set_position_result = window.set_position(Position::Physical(PhysicalPosition::new(
        target_x, target_y,
    )));
    if let Err(err) = set_position_result {
        println!("[tray] set_position failed: {}", err);
    }
}

fn main() {
    let app_builder = tauri::Builder::default()
        .manage(SessionState::default())
        .manage(NotificationState::default())
        .manage(ReportState::default())
        .manage(SettingsState::default())
        .manage(FocusTimerState::default())
        .manage(FocusStreamState::default())
        .manage(PostureStreamState::default())
        .manage(HrStreamState::default())
        .invoke_handler(tauri::generate_handler![
            run_python_session,
            run_session_history,
            run_session_days,
            run_daily_report,
            run_overview_aggregates,
            run_posture_insights,
            run_get_settings,
            run_update_settings,
            run_clear_data,
            run_calibration_status,
            run_recalibrate_baseline,
            run_log_breathing_session,
            run_presence_check,
            run_log_break_session,
            run_log_exercise_session,
            run_exercise_history,
            run_activity_stats,
            run_export_sessions_csv,
            run_monitor_timeline,
            hide_window,
            open_main_window,
            start_posture_stream,
            stop_posture_stream,
            start_hr_stream,
            stop_hr_stream,
            start_focus_stream,
            stop_focus_stream
        ])
        .plugin(tauri_plugin_autostart::init(
            MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .on_window_event(|window, event| {
            match window.label() {
                "main-window" => {
                    if let WindowEvent::CloseRequested { api, .. } = event {
                        api.prevent_close();
                        let _ = window.hide();
                        #[cfg(target_os = "macos")]
                        let _ = window
                            .app_handle()
                            .set_activation_policy(tauri::ActivationPolicy::Accessory);
                    }
                }
                "main" => {
                    // Close menubar popover when user focuses elsewhere — but keep it
                    // open during an active check-in so progress/state stay visible.
                    if let WindowEvent::Focused(false) = event {
                        let session_busy = window
                            .app_handle()
                            .try_state::<SessionState>()
                            .map(|s| s.running.load(std::sync::atomic::Ordering::SeqCst))
                            .unwrap_or(false);
                        if !session_busy {
                            let _ = window.hide();
                        }
                    }
                }
                _ => {}
            }
        })
        .setup(|app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            // Force a fully transparent webview/window fill for rounded CSS chrome.
            if let Some(popover) = app.get_webview_window("main") {
                let _ = popover.set_background_color(Some(Color(0, 0, 0, 0)));
            }

            if let Ok(settings) = run_settings_blocking(None) {
                let settings_state = app.state::<SettingsState>();
                let lock_result = settings_state.inner.lock();
                if let Ok(mut guard) = lock_result {
                    *guard = settings;
                }
            }

            // Enable launch at login; silently ignore unsupported/error cases.
            let _ = app.autolaunch().enable();

            let open_item = MenuItemBuilder::with_id("open", "Open Zeno").build(app)?;
            let quit_item = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
            let tray_menu = MenuBuilder::new(app)
                .item(&open_item)
                .item(&quit_item)
                .build()?;

            let tray_icon = load_app_icon().unwrap_or_else(|| {
                app.default_window_icon()
                    .expect("default window icon")
                    .clone()
            });

            // Icon only by default — tray title is reserved for live focus timer text.
            let _tray = TrayIconBuilder::with_id("zeno-tray")
                .menu(&tray_menu)
                .show_menu_on_left_click(false)
                .icon(tray_icon)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        rect,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                println!("[tray] main window visible -> hide");
                                let _ = window.hide();
                            } else {
                                position_popover_window(&window, &position, &rect);
                                println!("[tray] show main window");
                                // Transparent window + CSS shadow (no native rectangular shadow).
                                let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        } else {
                            println!("[tray] main window not found");
                        }
                    }
                })
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "quit" => app.exit(0),
                    "open" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.set_background_color(Some(Color(0, 0, 0, 0)));
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    _ => {}
                })
                .build(app)?;

            start_scheduler(&app.app_handle());
            start_daily_report_trigger(&app.app_handle());
            start_focus_mode_timer(&app.app_handle());
            check_for_updates_on_launch(&app.app_handle());

            Ok(())
        });

    app_builder
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
