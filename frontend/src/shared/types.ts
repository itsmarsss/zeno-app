export type SessionResult = {
  timestamp: string
  focus_session_id?: string | null
  presence_detected: boolean
  analysis_skipped: boolean
  posture_score: number
  baseline_posture_score: number
  posture_deviation: number
  posture_is_poor: boolean
  dominant_emotion: string
  emotion_score: number
  stress_index?: number
  heart_rate_bpm: number | null
  respiratory_rate: number
  rr_confidence: 'none' | 'partial' | 'full'
  resting_hr?: number | null
  resting_rr?: number | null
  emotion_backend: string
  mode: 'passive' | 'focus'
  focus_duration_seconds: number
  session_id: number | null
  session_skipped: boolean
  session_duration_seconds: number
}

export type SessionHistoryItem = {
  id: number
  created_at: string
  focus_session_id?: string | null
  presence_detected: number
  analysis_skipped: number
  posture_score: number
  tracking_confidence?: number
  head_offset_norm?: number
  shoulder_tilt_signed_norm?: number
  shoulder_tilt_norm?: number
  posture_stability_std?: number
  posture_stability_label?: string
  baseline_posture_score: number
  posture_deviation: number
  posture_is_poor: number
  dominant_emotion: string
  emotion_score: number
  stress_index?: number
  heart_rate_bpm: number | null
  respiratory_rate: number
  rr_confidence: 'none' | 'partial' | 'full'
  emotion_backend: string
  mode: 'passive' | 'focus'
  focus_duration_seconds: number
  focus_mode: number
  notification_sent: string
  notification_dismissed_by: string
  session_duration_seconds: number
}

export type DailyReport = {
  date: string
  sessions: number
  average_stress_index: number
  average_respiratory_rate?: number | null
  focused_minutes: number
  peak_stress: { stress_index: number; time: string } | null
  posture_trend: { time: string; score: number }[]
  stress_trend: { time: string; score: number }[]
  rr_trend?: { time: string; score: number; confidence: 'none' | 'partial' | 'full'; mode: 'passive' | 'focus' }[]
  recommendation: string
}

export type OverviewAggregates = {
  date: string
  sessions: number
  average_stress_index: number
  previous_average_stress_index: number
  stress_delta_vs_yesterday: number
  focused_minutes: number
  break_count: number
  average_heart_rate: number
  average_respiratory_rate: number | null
  hr_delta_baseline: number | null
  secondary_metric_series: {
    peak_stress: number[]
    avg_focus_session: number[]
    posture_avg: number[]
    break_minutes: number[]
  }
}

export type PostureInsights = {
  days: number
  total_sessions: number
  filled_days?: number
  issue_rows: Array<{
    key: 'chin-forward' | 'rounded-shoulders' | 'head-tilt-right'
    label: string
    pct: number
  }>
  top_issue: 'chin-forward' | 'rounded-shoulders' | 'head-tilt-right'
  recommended_ids: string[]
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
  tracking_confidence?: number
  head_offset_norm?: number
  shoulder_tilt_signed_norm?: number
  shoulder_tilt_norm?: number
  posture_stability_std?: number
  posture_stability_label?: 'learning' | 'stable' | 'moderate' | 'variable' | string
  exercise_feedback?: string | null
  exercise_metrics?: {
    rep_count: number
    target_reps: number
    hold_seconds: number
    rep_hold_seconds?: number
    hold_target_seconds?: number | null
    quality_score: number
    target_active: boolean
    progress_pct: number
    completed?: boolean
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
