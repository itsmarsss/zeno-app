use crate::notifications::{notify_for_session, start_gesture_dismiss_listener};
use crate::python_sidecar::{
    now_unix_secs, run_daily_report_blocking, run_python_session_blocking,
    run_update_session_notification_blocking,
};
use crate::state::{FocusTimerState, NotificationState, ReportState, SessionState, SettingsState};
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

            if settings.monitoring_paused || settings.focus_mode_active {
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

            let session_result = run_python_session_blocking(None, false);
            state.running.store(false, Ordering::SeqCst);

            match session_result {
                Ok(payload) => {
                    let notification_state = app_handle.state::<NotificationState>();
                    if let Some(dispatch) = notify_for_session(&app_handle, &notification_state, &payload) {
                        let session_id = payload.get("session_id").and_then(|v| v.as_u64()).unwrap_or(0);
                        if session_id > 0 {
                            notification_state
                                .last_notified_session_id
                                .store(session_id, Ordering::SeqCst);
                            let _ = run_update_session_notification_blocking(
                                session_id,
                                Some(dispatch.kind),
                                None,
                            );
                        }
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

pub fn start_focus_mode_timer(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    thread::spawn(move || {
        let mut last_title = String::new();
        let mut was_active = false;
        loop {
            thread::sleep(Duration::from_secs(5));

            let settings_state = app_handle.state::<SettingsState>();
            let settings = settings_state
                .inner
                .lock()
                .map(|g| g.clone())
                .unwrap_or_default();

            let timer_state = app_handle.state::<FocusTimerState>();
            // Menubar shows icon only unless focus mode is on — then just the timer.
            let title: Option<String> = if settings.focus_mode_active {
                let now = now_unix_secs();
                let current = timer_state.started_at_unix.load(Ordering::SeqCst);
                let started_at = if current == 0 {
                    timer_state.started_at_unix.store(now, Ordering::SeqCst);
                    timer_state
                        .break_triggered_for_session
                        .store(false, Ordering::SeqCst);
                    timer_state.stress_sum.store(0, Ordering::SeqCst);
                    timer_state.stress_samples.store(0, Ordering::SeqCst);
                    now
                } else {
                    current
                };
                let elapsed_minutes = now.saturating_sub(started_at) / 60;
                if elapsed_minutes >= 90
                    && timer_state
                        .break_triggered_for_session
                        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                        .is_ok()
                {
                    let _ = app_handle.emit(
                        "break-auto-trigger",
                        serde_json::json!({
                            "reason": "focus-threshold",
                            "break_seconds": 300u32,
                            "elapsed_minutes": elapsed_minutes
                        }),
                    );
                }
                Some(if elapsed_minutes >= 60 {
                    format!("{}h {:02}m", elapsed_minutes / 60, elapsed_minutes % 60)
                } else {
                    format!("{}m", elapsed_minutes)
                })
            } else {
                if was_active {
                    let started_at = timer_state.started_at_unix.load(Ordering::SeqCst);
                    if started_at > 0 {
                        let elapsed_minutes = now_unix_secs().saturating_sub(started_at) / 60;
                        let samples = timer_state.stress_samples.load(Ordering::SeqCst);
                        let avg_stress = if samples > 0 {
                            timer_state.stress_sum.load(Ordering::SeqCst) / samples as u64
                        } else {
                            0
                        };
                        let body = format!(
                            "Focus session: {}m. Average stress: {}.",
                            elapsed_minutes,
                            avg_stress
                        );
                        let _ = app_handle
                            .notification()
                            .builder()
                            .title("Zeno Focus Summary")
                            .body(body)
                            .show();
                    }
                }
                timer_state.started_at_unix.store(0, Ordering::SeqCst);
                timer_state
                    .break_triggered_for_session
                    .store(false, Ordering::SeqCst);
                timer_state.stress_sum.store(0, Ordering::SeqCst);
                timer_state.stress_samples.store(0, Ordering::SeqCst);
                None
            };
            was_active = settings.focus_mode_active;

            // Empty string = no menubar text (icon only).
            let title_key = title.clone().unwrap_or_default();
            if title_key == last_title {
                continue;
            }

            if let Some(tray) = app_handle.tray_by_id("zeno-tray") {
                // None clears the title so idle tray is icon-only.
                let _ = tray.set_title(title);
                last_title = title_key;
            }
        }
    });
}
