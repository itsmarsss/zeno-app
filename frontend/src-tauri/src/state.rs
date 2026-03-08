use serde::{Deserialize, Serialize};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64};
use std::sync::Mutex;

#[derive(Default)]
pub struct SessionState {
    pub running: AtomicBool,
}

#[derive(Default)]
pub struct NotificationState {
    pub suppress_until_unix: AtomicU64,
}

#[derive(Default)]
pub struct ReportState {
    pub last_notified_ymd: AtomicU32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub monitoring_paused: bool,
    pub focus_mode_active: bool,
    pub session_frequency_minutes: u32,
    pub daily_report_hour: u32,
    pub daily_report_minute: u32,
    pub onboarding_completed: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            monitoring_paused: false,
            focus_mode_active: false,
            session_frequency_minutes: 10,
            daily_report_hour: 21,
            daily_report_minute: 0,
            onboarding_completed: false,
        }
    }
}

#[derive(Default)]
pub struct SettingsState {
    pub inner: Mutex<AppSettings>,
}
