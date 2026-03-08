import { stressIndexFromHistory } from './metrics'
import type { SessionHistoryItem } from './types'

export type FocusPeriod = 'week' | 'month' | 'quarter'
export type DeltaTone = 'positive' | 'neutral' | 'negative'

export type InsightCard = {
  key: string
  tag: string
  text: string
  stat: string
  icon: 'trending' | 'activity' | 'user'
}

export type SessionNarrative = {
  headline: string
  tone: DeltaTone
}

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

export function mean(values: number[]): number {
  if (!values.length) return 0
  return values.reduce((sum, value) => sum + value, 0) / values.length
}

export function formatMinutes(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}m`
}

export function formatDurationSeconds(seconds: number): string {
  return formatMinutes(Math.round(seconds / 60))
}

export function stressTone(score: number): 'calm' | 'mild' | 'elevated' | 'high' {
  if (score <= 30) return 'calm'
  if (score <= 60) return 'mild'
  if (score <= 80) return 'elevated'
  return 'high'
}

export function stressColor(score: number): string {
  const tone = stressTone(score)
  if (tone === 'calm') return 'var(--state-calm)'
  if (tone === 'mild') return 'var(--state-mild)'
  if (tone === 'elevated') return 'var(--state-elevated)'
  return 'var(--state-high)'
}

export function trendTone(delta: number): DeltaTone {
  if (delta <= -1) return 'positive'
  if (delta >= 1) return 'negative'
  return 'neutral'
}

export function formatDelta(delta: number): string {
  if (Math.abs(delta) < 1) return '\u2014'
  return `${delta > 0 ? '+' : ''}${Math.round(delta)} pts`
}

export function buildPath(values: Array<number | null>, min: number, max: number, width = 100, height = 100): string {
  let path = ''
  let hasStarted = false
  values.forEach((raw, index) => {
    if (raw == null || Number.isNaN(raw)) {
      hasStarted = false
      return
    }
    const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width
    const norm = clamp((raw - min) / Math.max(max - min, 1), 0, 1)
    const y = height - norm * height
    if (!hasStarted) {
      path += `M ${x.toFixed(2)} ${y.toFixed(2)} `
      hasStarted = true
    } else {
      path += `L ${x.toFixed(2)} ${y.toFixed(2)} `
    }
  })
  return path.trim()
}

export function buildAreaPath(values: number[], min: number, max: number, width = 100, height = 100): string {
  if (!values.length) return ''
  const line = buildPath(values, min, max, width, height)
  return `${line} L ${width} ${height} L 0 ${height} Z`
}

export function localDateKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function formatHourLabel(hour: number): string {
  const period = hour >= 12 ? 'pm' : 'am'
  const twelve = hour % 12 === 0 ? 12 : hour % 12
  return `${twelve}${period}`
}

export function formatClockRange(start: Date, end: Date): string {
  return `${start.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} - ${end.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
}

export function generateHeadline(avgStress: number, focusedMinutes: number, deltaVsYesterday: number): string {
  if (focusedMinutes >= 210 && avgStress <= 45) return 'A focused day.'
  if (avgStress >= 68) return 'Stress ran high today.'
  if (deltaVsYesterday <= -8) return 'Your calmest day this week.'
  if (focusedMinutes >= 140 && avgStress >= 55) return 'You pushed through.'
  if (focusedMinutes > 0) return 'Strong morning, tough afternoon.'
  return 'A quiet start.'
}

export function classifySession(item: SessionHistoryItem): SessionNarrative {
  const stress = stressIndexFromHistory(item)
  const minutes = Math.round(item.session_duration_seconds / 60)
  if (minutes >= 45 && stress <= 45) return { headline: 'Deep focus session', tone: 'positive' }
  if (minutes <= 12) return { headline: 'Short check-in', tone: 'neutral' }
  if (stress >= 65) return { headline: 'Interrupted work', tone: 'negative' }
  return { headline: 'Steady work block', tone: 'neutral' }
}

export function startDateForPeriod(period: FocusPeriod): Date {
  const now = new Date()
  const result = new Date(now)
  if (period === 'week') {
    result.setDate(now.getDate() - 6)
    result.setHours(0, 0, 0, 0)
    return result
  }
  if (period === 'month') {
    result.setDate(now.getDate() - 29)
    result.setHours(0, 0, 0, 0)
    return result
  }
  result.setDate(now.getDate() - 89)
  result.setHours(0, 0, 0, 0)
  return result
}

export function periodTitle(period: FocusPeriod): string {
  if (period === 'week') return 'This Week'
  if (period === 'month') return 'Last 30 Days'
  return 'Last 3 Months'
}

export function buildInsights(history: SessionHistoryItem[], todaySessions: SessionHistoryItem[]): InsightCard[] {
  if (history.length < 4) {
    return [
      { key: 'need-data', tag: 'Pattern', text: 'More data needed', stat: 'Run a few more sessions to unlock insights.', icon: 'trending' },
      { key: 'need-data-2', tag: 'Win', text: 'Early baseline forming', stat: 'Daily trends get better after 7 sessions.', icon: 'activity' },
      { key: 'need-data-3', tag: 'Posture', text: 'Posture trend pending', stat: 'Keep check-ins consistent through the week.', icon: 'user' },
    ]
  }

  const recent = history.slice(0, 56)
  const byHour = new Map<number, number[]>()
  recent.forEach((item) => {
    const hour = new Date(item.created_at).getHours()
    if (!byHour.has(hour)) byHour.set(hour, [])
    byHour.get(hour)?.push(stressIndexFromHistory(item))
  })

  const peakHour = Array.from(byHour.entries()).sort((a, b) => mean(b[1]) - mean(a[1]))[0]
  const poorPostureCount = recent.filter((item) => item.posture_score < 0.5).length
  const todayHr = todaySessions.map((item) => item.heart_rate_bpm).filter((value): value is number => value != null)
  const earlierHr = history.slice(todaySessions.length).map((item) => item.heart_rate_bpm).filter((value): value is number => value != null)

  const hrDelta = earlierHr.length && todayHr.length ? Math.round(mean(todayHr) - mean(earlierHr)) : 0
  const hourLabel = peakHour ? formatHourLabel(peakHour[0]) : 'midday'

  return [
    {
      key: 'pattern',
      tag: 'Pattern',
      text: `Stress peaks around ${hourLabel}`,
      stat: `Based on ${Math.min(recent.length, 56)} recent sessions`,
      icon: 'trending',
    },
    {
      key: 'win',
      tag: 'Win',
      text: hrDelta <= 0 ? 'Breathing habits are helping' : 'Heart rate rose during work blocks',
      stat: hrDelta <= 0 ? `Avg ${Math.abs(hrDelta)} bpm below baseline` : `Avg ${Math.abs(hrDelta)} bpm above baseline`,
      icon: 'activity',
    },
    {
      key: 'posture',
      tag: 'Posture',
      text: poorPostureCount >= 4 ? 'Shoulders dip after long sessions' : 'Posture consistency is improving',
      stat: poorPostureCount >= 4 ? `${poorPostureCount} low-posture check-ins this week` : 'Fewer posture alerts than last week',
      icon: 'user',
    },
  ]
}
