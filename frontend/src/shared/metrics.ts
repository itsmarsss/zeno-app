import type { SessionHistoryItem, SessionResult } from './types'

export function prettyTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

export function stressIndex(result: SessionResult | null): number {
  if (!result) return 0
  const emotion = result.dominant_emotion.toLowerCase()
  const emotionPoints =
    ({ fear: 28, angry: 25, anger: 25, disgust: 22, contempt: 22, sad: 16, sadness: 16, neutral: 8, surprise: 12, happy: 4, happiness: 4 }[
      emotion as keyof Record<string, number>
    ] ?? 10) * Math.max(result.emotion_score, 0.25)

  const hr = result.heart_rate_bpm
  const hrPoints = hr == null ? 8 : hr >= 105 ? 52 : hr >= 95 ? 40 : hr >= 85 ? 28 : hr >= 75 ? 14 : 6
  return Math.max(0, Math.min(100, Math.round(emotionPoints + hrPoints)))
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
    posture_score: item.posture_score,
    dominant_emotion: item.dominant_emotion,
    emotion_score: item.emotion_score,
    heart_rate_bpm: item.heart_rate_bpm,
    emotion_backend: item.emotion_backend,
    session_duration_seconds: item.session_duration_seconds,
  })
}

export function sessionFromHistory(item: SessionHistoryItem): SessionResult {
  return {
    timestamp: item.created_at,
    presence_detected: Boolean(item.presence_detected),
    posture_score: item.posture_score,
    dominant_emotion: item.dominant_emotion,
    emotion_score: item.emotion_score,
    heart_rate_bpm: item.heart_rate_bpm,
    emotion_backend: item.emotion_backend,
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
  if (points.length === 2) return `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)} L ${points[1].x.toFixed(2)} ${points[1].y.toFixed(2)}`

  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
  for (let i = 1; i < points.length - 1; i += 1) {
    const c = points[i]
    const n = points[i + 1]
    const midX = (c.x + n.x) / 2
    const midY = (c.y + n.y) / 2
    path += ` Q ${c.x.toFixed(2)} ${c.y.toFixed(2)} ${midX.toFixed(2)} ${midY.toFixed(2)}`
  }
  const penultimate = points[points.length - 2]
  const last = points[points.length - 1]
  path += ` Q ${penultimate.x.toFixed(2)} ${penultimate.y.toFixed(2)} ${last.x.toFixed(2)} ${last.y.toFixed(2)}`
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
