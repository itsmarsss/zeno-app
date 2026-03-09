use crate::python_sidecar::{
    now_unix_secs, run_gesture_dismiss_blocking, run_update_session_notification_blocking,
};
use crate::state::NotificationState;
use serde_json::Value;
use std::sync::atomic::Ordering;
use std::thread;
use tauri::{Emitter, Manager};
use tauri_plugin_notification::NotificationExt;

#[derive(Clone)]
pub struct NotificationDispatch {
    pub kind: String,
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
    let rr = result
        .get("respiratory_rate")
        .and_then(|v| v.as_f64())
        .unwrap_or(0.0);
    let rr_conf = result
        .get("rr_confidence")
        .and_then(|v| v.as_str())
        .unwrap_or("none");
    let mode = result
        .get("mode")
        .and_then(|v| v.as_str())
        .unwrap_or("passive");

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
    let rr_points = if rr <= 0.0 {
        0.0
    } else if rr >= 25.0 {
        28.0
    } else if rr >= 21.0 {
        20.0
    } else if rr >= 17.0 {
        12.0
    } else {
        4.0
    };

    let rr_weight = match (mode, rr_conf) {
        ("focus", "full") => 0.30,
        ("focus", "partial") => 0.15,
        _ => 0.0,
    };
    let (hr_weight, emotion_weight) = if rr_weight >= 0.30 {
        (0.35, 0.35)
    } else if rr_weight > 0.0 {
        (0.40, 0.45)
    } else {
        (0.50, 0.50)
    };
    let score = (emotion_points * emotion_weight + hr_points * hr_weight + rr_points * rr_weight).round();
    Some(score.clamp(0.0, 100.0) as u8)
}

fn notification_for_result(result: &Value) -> Option<(String, String, String)> {
    let posture_score = result
        .get("posture_score")
        .and_then(|v| v.as_f64())
        .unwrap_or(1.0);
    let posture_is_poor = result
        .get("posture_is_poor")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    if posture_score < 0.45 || posture_is_poor {
        return Some((
            "Posture Check".to_string(),
            "Straighten up and roll your shoulders back.".to_string(),
            "posture".to_string(),
        ));
    }

    let stress_index = stress_index_from_result(result)?;
    if stress_index >= 61 {
        return Some((
            "Stress Check".to_string(),
            "Take a 5 minute break. Step away for a reset.".to_string(),
            "stress_high".to_string(),
        ));
    }
    if (31..=60).contains(&stress_index) {
        return Some((
            "Focus Check".to_string(),
            "You have been locked in for a while. Grab some water.".to_string(),
            "stress_mild".to_string(),
        ));
    }
    None
}

pub fn notify_for_session(
    app: &tauri::AppHandle,
    notification_state: &NotificationState,
    result: &Value,
) -> Option<NotificationDispatch> {
    let skipped = result
        .get("session_skipped")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);
    if skipped {
        return None;
    }

    let now = now_unix_secs();
    let suppress_until = notification_state.suppress_until_unix.load(Ordering::SeqCst);
    if now < suppress_until {
        return None;
    }

    if let Some((title, body, kind)) = notification_for_result(result) {
        let _ = app.notification().builder().title(title).body(body).show();
        return Some(NotificationDispatch { kind });
    }
    None
}

pub fn start_gesture_dismiss_listener(app: &tauri::AppHandle) {
    let app_handle = app.clone();
    thread::spawn(move || {
        let dismissed = run_gesture_dismiss_blocking(10).unwrap_or(false);
        if dismissed {
            let notification_state = app_handle.state::<NotificationState>();
            let session_id = notification_state
                .last_notified_session_id
                .load(Ordering::SeqCst);
            let suppress_until = now_unix_secs() + (20 * 60);
            notification_state
                .suppress_until_unix
                .store(suppress_until, Ordering::SeqCst);
            if session_id > 0 {
                let _ = run_update_session_notification_blocking(
                    session_id,
                    None,
                    Some("gesture".to_string()),
                );
            }
            let _ = app_handle.emit(
                "gesture-dismissed",
                serde_json::json!({"snooze_minutes": 20}),
            );
        }
    });
}
