use crate::notifications::{notify_for_session, start_gesture_dismiss_listener};
use crate::python_sidecar::{now_unix_secs, run_daily_report_blocking, run_python_session_blocking};
use crate::state::{NotificationState, ReportState, SessionState, SettingsState};
use chrono::{Datelike, Local, Timelike};
use std::sync::atomic::Ordering;
use std::thread;
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

pub fn start_scheduler(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    thread::spawn(move || {
        let mut last_run_unix = now_unix_secs();
        loop {
            thread::sleep(Duration::from_secs(20));

            let settings_state = app_handle.state::<SettingsState>();
            let settings = settings_state
                .inner
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default();

            if settings.monitoring_paused {
                continue;
            }

            let interval = (settings.session_frequency_minutes as u64).saturating_mul(60);
            let now = now_unix_secs();
            if now < last_run_unix.saturating_add(interval) {
                continue;
            }
            last_run_unix = now;

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
                    let notification_state = app_handle.state::<NotificationState>();
                    if notify_for_session(&app_handle, &notification_state, &payload) {
                        start_gesture_dismiss_listener(&app_handle);
                    }
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

pub fn start_daily_report_trigger(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    thread::spawn(move || {
        loop {
            thread::sleep(Duration::from_secs(30));

            let now = Local::now();
            let settings_state = app_handle.state::<SettingsState>();
            let settings = settings_state
                .inner
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default();

            if now.hour() != settings.daily_report_hour || now.minute() != settings.daily_report_minute {
                continue;
            }

            let ymd = (now.year() as u32) * 10_000 + now.month() * 100 + now.day();
            let report_state = app_handle.state::<ReportState>();
            let already = report_state.last_notified_ymd.load(Ordering::SeqCst);
            if already == ymd {
                continue;
            }
            report_state.last_notified_ymd.store(ymd, Ordering::SeqCst);

            match run_daily_report_blocking(None) {
                Ok(report) => {
                    let _ = app_handle
                        .notification()
                        .builder()
                        .title("Zeno Daily Report")
                        .body("Your daily report is ready.")
                        .show();
                    let _ = app_handle.emit("report-ready", report);
                }
                Err(err_msg) => {
                    let _ = app_handle.emit(
                        "report-error",
                        serde_json::json!({ "error": err_msg }),
                    );
                }
            }
        }
    });
}
