export type SessionResult = {
  timestamp: string
  presence_detected: boolean
  analysis_skipped: boolean
  posture_score: number
  baseline_posture_score: number
  posture_deviation: number
  posture_is_poor: boolean
  dominant_emotion: string
  emotion_score: number
  heart_rate_bpm: number | null
  emotion_backend: string
  session_id: number | null
  session_skipped: boolean
  session_duration_seconds: number
}

export type SessionHistoryItem = {
  id: number
  created_at: string
  presence_detected: number
  analysis_skipped: number
  posture_score: number
  baseline_posture_score: number
  posture_deviation: number
  posture_is_poor: number
  dominant_emotion: string
  emotion_score: number
  heart_rate_bpm: number | null
  emotion_backend: string
  focus_mode: number
  notification_sent: string
  notification_dismissed_by: string
  session_duration_seconds: number
}

export type DailyReport = {
  date: string
  sessions: number
  average_stress_index: number
  focused_minutes: number
  peak_stress: { stress_index: number; time: string } | null
  posture_trend: { time: string; score: number }[]
  stress_trend: { time: string; score: number }[]
  recommendation: string
}

export type CalibrationStatus = {
  calibrated: boolean
  baseline_sessions_required: number
  sessions_collected: number
  sessions_remaining: number
}

export type AppSettings = {
  monitoring_paused: boolean
  focus_mode_active: boolean
  session_frequency_minutes: number
  daily_report_hour: number
  daily_report_minute: number
  onboarding_completed: boolean
  plan_tier: 'free' | 'pro'
  license_key: string
}

export type BreathingPatternId = 'box' | 'four-seven-eight'

export type PosturePoint = { x: number; y: number; visibility?: number }

export type PostureLandmarks = {
  nose?: PosturePoint
  left_shoulder?: PosturePoint
  right_shoulder?: PosturePoint
} | null

export type PostureStreamFrame = {
  timestamp: string
  frame_jpeg_b64: string
  landmarks: PostureLandmarks
  posture_score: number
  exercise_feedback?: string | null
  exercise_metrics?: {
    rep_count: number
    target_reps: number
    hold_seconds: number
    quality_score: number
    target_active: boolean
    progress_pct: number
  } | null
}

export type HrStreamUpdate = {
  timestamp: string
  elapsed_seconds: number
  heart_rate_bpm: number | null
}

export type Exercise = {
  id: string
  name: string
  target: string
  duration_minutes: number
  difficulty: 'easy' | 'moderate'
  space: 'desk' | 'open'
  steps: string[]
}
