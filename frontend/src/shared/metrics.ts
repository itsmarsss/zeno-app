import type { SessionHistoryItem, SessionResult } from './types'

export function prettyTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function stressIndex(result: SessionResult | null): number {
  if (!result) return 0
  if (result.session_skipped || !result.presence_detected) return 0
  const emotion = result.dominant_emotion.toLowerCase()
  const emotionLevel =
    ({
      happy: 20,
      happiness: 20,
      neutral: 35,
      surprise: 45,
      sad: 55,
      sadness: 55,
      disgust: 70,
      contempt: 70,
      angry: 85,
      anger: 85,
      fear: 85,
    }[emotion as keyof Record<string, number>] ?? 50) * Math.max(result.emotion_score, 0.25)

  const restingHr = result.resting_hr ?? 75
  const restingRr = result.resting_rr ?? 14
  const hr = result.heart_rate_bpm
  const hrDeviation = hr == null ? 0 : Math.max(0, hr - restingHr)
  const hrPoints = Math.max(0, Math.min(100, hrDeviation * 3.2))
  const rr = result.respiratory_rate ?? 0
  const rrDeviation = rr <= 0 ? 0 : Math.max(0, rr - restingRr)
  const rrPoints = Math.max(0, Math.min(100, rrDeviation * 6.0))
  const rrConfidence = result.mode === 'focus' ? result.rr_confidence : 'none'

  let hrWeight = 0.5
  let rrWeight = 0
  let emotionWeight = 0.5
  if (rrConfidence === 'full') {
    hrWeight = 0.35
    rrWeight = 0.3
    emotionWeight = 0.35
  } else if (rrConfidence === 'partial') {
    hrWeight = 0.4
    rrWeight = 0.15
    emotionWeight = 0.45
  }

  const weighted = hrPoints * hrWeight + rrPoints * rrWeight + emotionLevel * emotionWeight
  return Math.max(0, Math.min(100, Math.round(weighted)))
}

export function stressState(score: number): 'calm' | 'mild' | 'elevated' | 'high' {
  if (score <= 30) return 'calm'
  if (score <= 60) return 'mild'
  if (score <= 80) return 'elevated'
  return 'high'
}

export function friendlyPosture(score: number): string {
  if (score >= 0.65) return 'good'
  if (score >= 0.5) return 'fair'
  return 'poor'
}

export function stressIndexFromHistory(item: SessionHistoryItem): number {
  return stressIndex({
    timestamp: item.created_at,
    presence_detected: Boolean(item.presence_detected),
    analysis_skipped: Boolean(item.analysis_skipped),
    posture_score: item.posture_score,
    baseline_posture_score: item.baseline_posture_score,
    posture_deviation: item.posture_deviation,
    posture_is_poor: Boolean(item.posture_is_poor),
    dominant_emotion: item.dominant_emotion,
    emotion_score: item.emotion_score,
    heart_rate_bpm: item.heart_rate_bpm,
    respiratory_rate: item.respiratory_rate,
    rr_confidence: item.rr_confidence,
    emotion_backend: item.emotion_backend,
    mode: item.mode,
    focus_duration_seconds: item.focus_duration_seconds,
    session_id: item.id,
    session_skipped: Boolean(item.analysis_skipped),
    session_duration_seconds: item.session_duration_seconds,
  })
}

export function sessionFromHistory(item: SessionHistoryItem): SessionResult {
  return {
    timestamp: item.created_at,
    presence_detected: Boolean(item.presence_detected),
    analysis_skipped: Boolean(item.analysis_skipped),
    posture_score: item.posture_score,
    baseline_posture_score: item.baseline_posture_score,
    posture_deviation: item.posture_deviation,
    posture_is_poor: Boolean(item.posture_is_poor),
    dominant_emotion: item.dominant_emotion,
    emotion_score: item.emotion_score,
    heart_rate_bpm: item.heart_rate_bpm,
    respiratory_rate: item.respiratory_rate,
    rr_confidence: item.rr_confidence,
    emotion_backend: item.emotion_backend,
    mode: item.mode,
    focus_duration_seconds: item.focus_duration_seconds,
    session_id: item.id,
    session_skipped: Boolean(item.analysis_skipped),
    session_duration_seconds: item.session_duration_seconds,
  }
}

export function sparklinePath(values: number[], width = 260, height = 74): string {
  if (!values.length) return ''
  const min = 0
  const max = 100
  const stepX = values.length === 1 ? width : width / (values.length - 1)
  const points = values.map((value, i) => {
    const x = i * stepX
    const y = height - ((Math.max(min, Math.min(max, value)) - min) / (max - min || 1)) * height
    return { x, y }
  })
  if (points.length === 1) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  if (points.length === 2)
    return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`

  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  for (let i = 0; i < points.length - 1; i += 1) {
    const p0 = points[i - 1] ?? points[i]
    const p1 = points[i]
    const p2 = points[i + 1]
    const p3 = points[i + 2] ?? p2
    const cp1x = p1.x + (p2.x - p0.x) / 6
    let cp1y = p1.y + (p2.y - p0.y) / 6
    const cp2x = p2.x - (p3.x - p1.x) / 6
    let cp2y = p2.y - (p3.y - p1.y) / 6
    const segMinY = Math.min(p1.y, p2.y)
    const segMaxY = Math.max(p1.y, p2.y)
    cp1y = Math.max(segMinY, Math.min(segMaxY, cp1y))
    cp2y = Math.max(segMinY, Math.min(segMaxY, cp2y))
    path += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)} ${cp2x.toFixed(2)} ${cp2y.toFixed(2)} ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
  }
  return path
}

export function pointY(value: number, height = 74): number {
  const clamped = Math.max(0, Math.min(100, value))
  return height - (clamped / 100) * height
}

export function trendStats(values: number[]): { latest: number; low: number; high: number } {
  if (!values.length) return { latest: 0, low: 0, high: 0 }
  return {
    latest: values[values.length - 1] ?? 0,
    low: Math.min(...values),
    high: Math.max(...values),
  }
}

export function dayKey(timestamp: string): string {
  return new Date(timestamp).toISOString().slice(0, 10)
}
