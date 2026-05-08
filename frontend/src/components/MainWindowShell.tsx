import { useEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { AnimatePresence, motion } from 'framer-motion'
import { Pause, Play, Target, Zap } from 'lucide-react'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import { FocusHistoryTab } from './focus/FocusHistoryTab'
import { MonitorTab } from './monitor/MonitorTab'
import { OverviewTab } from './overview/OverviewTab'
import { PostureTab } from './posture/PostureTab'
import { ExercisesTab, type ExerciseSessionSummary } from './exercises/ExercisesTab'
import { SettingsTab } from './settings/SettingsTab'
import { SidebarNav, type MainTab } from './common/SidebarNav'
import { EXERCISE_LIBRARY } from '../shared/constants'
import { stressIndexFromHistory } from '../shared/metrics'
import type {
  CalibrationStatus,
  DailyReport,
  OverviewAggregates,
  PostureInsights,
  PostureLandmarks,
  PostureStreamFrame,
  SessionHistoryItem,
  SessionResult,
} from '../shared/types'
import {
  buildPath,
  clamp,
  formatHourLabel,
  formatMinutes,
  generateHeadline,
  localDateKey,
  mean,
  startDateForPeriod,
  trendTone,
  type FocusPeriod,
} from '../shared/dashboard'
import { useAppSettings } from '../context/AppSettingsContext'
import { fadeSlide } from '../shared/motion'
import './MainWindowShell.css'

const HOUR_START = 0
const HOUR_END = 23
const DEFAULT_TIMELINE_BUCKET_MINUTES = 15
const HEATMAP_START = 8
const HEATMAP_END = 19
const PATTERN_MIN_SESSIONS = 10

type MonitorTimelinePoint = {
  created_at: string
  focus_session_id?: string | null
  posture_score: number | null
  heart_rate_bpm: number | null
  respiratory_rate: number | null
  rr_confidence: 'none' | 'partial' | 'full'
  point_type?: 'passive' | 'focus' | 'filled' | 'unknown'
  mode?: string | null
  emotion_backend?: string | null
  dominant_emotion?: string | null
  emotion_score?: number | null
  stress_index?: number | null
  presence_detected?: number | null
  focus_active?: boolean | null
  passive_marker_active?: boolean | null
}

type SessionDayIndexResponse = {
  days?: Array<{ date: string; sessions: number }>
  min_date?: string | null
  max_date?: string | null
  total_days?: number
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

export function MainWindowShell({
  history,
  dailyReport,
  calibration,
  lastRunSource,
  error,
  replayOnboarding,
  clearAllData,
  onRunCheckIn,
  isCheckInRunning,
  currentResult,
}: {
  history: SessionHistoryItem[]
  dailyReport: DailyReport | null
  calibration: CalibrationStatus | null
  lastRunSource: string | null
  error: string | null
  replayOnboarding: () => void
  clearAllData: () => Promise<void>
  onRunCheckIn: () => Promise<void>
  isCheckInRunning: boolean
  currentResult: SessionResult | null
}) {
  const { settings, updateSettings } = useAppSettings()
  const [tab, setTab] = useState<MainTab>('overview')
  const [selectedExerciseId, setSelectedExerciseId] = useState(EXERCISE_LIBRARY[0]?.id ?? 'chin-tuck')
  const [exerciseGuidedActive, setExerciseGuidedActive] = useState(false)
  const [exerciseFeedback, setExerciseFeedback] = useState<string | null>(null)
  const [exerciseMetrics, setExerciseMetrics] = useState<PostureStreamFrame['exercise_metrics']>(null)
  const [exerciseSessionSummary, setExerciseSessionSummary] = useState<ExerciseSessionSummary | null>(null)
  const [postureRecommendedIds, setPostureRecommendedIds] = useState<string[]>([])
  const [exerciseHistory, setExerciseHistory] = useState<
    Array<{
      id: number
      timestamp: string
      exercise_id: string
      completed: boolean
      form_score: number | null
      duration_seconds: number
    }>
  >([])
  const [softSuggestionId, setSoftSuggestionId] = useState<string | null>(null)
  const exerciseCompletionLoggedRef = useRef(false)
  const [exportMessage, setExportMessage] = useState<string | null>(null)
  const [postureFrame, setPostureFrame] = useState<string | null>(null)
  const [postureLandmarks, setPostureLandmarks] = useState<PostureLandmarks>(null)
  const [postureScoreLive, setPostureScoreLive] = useState<number | null>(null)
  const [postureTrackingConfidence, setPostureTrackingConfidence] = useState<number | null>(null)
  const [postureHeadOffsetNorm, setPostureHeadOffsetNorm] = useState<number | null>(null)
  const [postureShoulderTiltSignedNorm, setPostureShoulderTiltSignedNorm] = useState<number | null>(null)
  const [postureShoulderTiltNorm, setPostureShoulderTiltNorm] = useState<number | null>(null)
  const [postureStabilityStd, setPostureStabilityStd] = useState<number | null>(null)
  const [postureStabilityLabel, setPostureStabilityLabel] = useState<string | null>(null)
  const [postureStreamState, setPostureStreamState] = useState<
    'stopped' | 'connecting' | 'running' | 'no-pose' | 'error'
  >('stopped')
  const [postureStreamError, setPostureStreamError] = useState<string | null>(null)
  const [postureStreamSuspended, setPostureStreamSuspended] = useState(false)
  const [focusPeriod, setFocusPeriod] = useState<FocusPeriod>('week')
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(null)
  const [sortNewestFirst, setSortNewestFirst] = useState(true)
  const [timelineBucketMinutes, setTimelineBucketMinutes] = useState<number>(DEFAULT_TIMELINE_BUCKET_MINUTES)
  const [overviewTimelinePoints, setOverviewTimelinePoints] = useState<MonitorTimelinePoint[]>([])
  const [overviewAggregates, setOverviewAggregates] = useState<OverviewAggregates | null>(null)
  const [overviewDaySessions, setOverviewDaySessions] = useState<SessionHistoryItem[]>([])
  const [sessionDayIndex, setSessionDayIndex] = useState<SessionDayIndexResponse | null>(null)
  const [overviewDate, setOverviewDate] = useState<Date>(() => {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
  })
  const guidedStartedAtRef = useRef<number | null>(null)
  const guidedExerciseIdRef = useRef<string | null>(null)
  const guidedTriggeredByRef = useRef<string>('manual')
  const overlayScrollbarOptions = useMemo(
    () => ({
      overflow: { x: 'hidden' as const, y: 'scroll' as const },
      scrollbars: {
        autoHide: 'leave' as const,
        autoHideDelay: 550,
        theme: 'os-theme-zeno',
        clickScroll: true,
        dragScroll: true,
      },
    }),
    [],
  )

  const now = new Date()
  const todayDate = new Date(now)
  todayDate.setHours(0, 0, 0, 0)
  const todayKey = localDateKey(now)
  const overviewKey = localDateKey(overviewDate)
  const historyRevision = `${history.length}:${history[0]?.id ?? 0}:${history[history.length - 1]?.id ?? 0}`

  const sessionsSortedAsc = [...history].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )
  const todaySessions = sessionsSortedAsc.filter((item) => localDateKey(new Date(item.created_at)) === todayKey)
  const overviewSessions = [...overviewDaySessions].sort(
    (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
  )

  const focusSessions = history.filter((item) => Boolean(item.focus_mode))
  const avgStressToday = overviewAggregates ? overviewAggregates.average_stress_index : null
  const stressDeltaVsYesterday = overviewAggregates ? overviewAggregates.stress_delta_vs_yesterday : null
  const todayFocusedMinutes = overviewAggregates?.focused_minutes ?? 0
  const todayBreakCount = overviewAggregates?.break_count ?? 0
  const avgHrToday = overviewAggregates ? overviewAggregates.average_heart_rate : null
  const avgRrToday = overviewAggregates?.average_respiratory_rate ?? null
  const hrDeltaBaseline = overviewAggregates?.hr_delta_baseline ?? null

  const heroHeadline = generateHeadline(avgStressToday ?? 0, todayFocusedMinutes, stressDeltaVsYesterday ?? 0)
  const heroStress = avgStressToday == null ? '--' : String(Math.round(avgStressToday))
  const heroSubline = `Average stress ${heroStress} · ${formatMinutes(todayFocusedMinutes)} focused · ${todayBreakCount} breaks taken`
  const heroTrendTone = trendTone(stressDeltaVsYesterday ?? 0)

  const timelineStart = new Date(overviewDate)
  timelineStart.setHours(HOUR_START, 0, 0, 0)
  const timelineEnd = new Date(overviewDate)
  timelineEnd.setHours(HOUR_END, 59, 59, 999)
  const timelineSourcePoints = overviewTimelinePoints

  const timelineData: Array<{
    slotStartIso: string
    slotEndIso: string
    label: string
    stress: number | null
    heartRate: number | null
    respiratoryRate: number | null
    rrConfidence: 'none' | 'partial' | 'full'
    postureScore: number | null
    focusActive: boolean
    passiveMarkerActive: boolean
    breathing: boolean
    pointType: 'passive' | 'focus' | 'filled' | 'unknown'
  }> = timelineSourcePoints.map((point) => {
    const slot = new Date(point.created_at)
    const slotEnd = new Date(slot.getTime() + timelineBucketMinutes * 60_000)
    const stressValue = typeof point.stress_index === 'number' ? point.stress_index : null
    const heartRateValue =
      typeof point.heart_rate_bpm === 'number' && point.heart_rate_bpm > 0 ? point.heart_rate_bpm : null
    const respiratoryValue =
      typeof point.respiratory_rate === 'number' && point.respiratory_rate > 0 ? point.respiratory_rate : null
    const postureValue =
      typeof point.posture_score === 'number' && point.posture_score > 0 ? point.posture_score : null
    const pointType: 'passive' | 'focus' | 'filled' | 'unknown' =
      point.point_type === 'focus'
        ? 'focus'
        : point.point_type === 'passive'
          ? 'passive'
          : point.point_type === 'filled'
            ? 'filled'
            : 'unknown'
    return {
      slotStartIso: slot.toISOString(),
      slotEndIso: slotEnd.toISOString(),
      label: slot.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      stress: stressValue == null ? null : Math.round(stressValue),
      heartRate: heartRateValue == null ? null : Math.round(heartRateValue),
      respiratoryRate: respiratoryValue == null ? null : Math.round(respiratoryValue),
      rrConfidence: (point.rr_confidence ?? 'none') as 'none' | 'partial' | 'full',
      postureScore: postureValue != null ? Math.round(postureValue * 100) : null,
      focusActive: Boolean(point.focus_active ?? (pointType === 'focus' || (point.mode ?? '') === 'focus')),
      passiveMarkerActive: Boolean(point.passive_marker_active ?? pointType === 'passive'),
      breathing: (point.emotion_backend ?? '').toLowerCase().includes('breath'),
      pointType,
    }
  })

  const timelineStartLabel = formatHourLabel(timelineStart.getHours())


  const minOverviewDate = useMemo(() => {
    if (sessionDayIndex?.min_date) {
      const fromIndex = new Date(`${sessionDayIndex.min_date}T00:00:00`)
      if (!Number.isNaN(fromIndex.getTime())) {
        fromIndex.setHours(0, 0, 0, 0)
        return fromIndex
      }
    }
    if (!sessionsSortedAsc.length) {
      const fallback = new Date(todayDate)
      fallback.setDate(fallback.getDate() - 30)
      return fallback
    }
    const earliest = new Date(sessionsSortedAsc[0].created_at)
    earliest.setHours(0, 0, 0, 0)
    return earliest
  }, [sessionDayIndex?.min_date, sessionsSortedAsc, todayDate])

  function shiftOverviewDay(delta: number) {
    setOverviewDate((prev) => {
      const next = new Date(prev)
      next.setDate(next.getDate() + delta)
      if (next < minOverviewDate) return new Date(minOverviewDate)
      if (next > todayDate) return new Date(todayDate)
      return next
    })
  }

  function setOverviewDayFromIso(isoDate: string) {
    if (!isoDate) return
    const parsed = new Date(`${isoDate}T00:00:00`)
    if (Number.isNaN(parsed.getTime())) return
    parsed.setHours(0, 0, 0, 0)
    if (parsed < minOverviewDate) {
      setOverviewDate(new Date(minOverviewDate))
      return
    }
    if (parsed > todayDate) {
      setOverviewDate(new Date(todayDate))
      return
    }
    setOverviewDate(parsed)
  }

  const canShiftOverviewPrev = overviewDate > minOverviewDate
  const canShiftOverviewNext = overviewDate < todayDate

  function handleTimelineBucketMinutesChange(value: number) {
    const allowed = new Set([15, 30, 60, 180])
    setTimelineBucketMinutes(allowed.has(value) ? value : DEFAULT_TIMELINE_BUCKET_MINUTES)
  }

  useEffect(() => {
    let cancelled = false

    async function fetchOverviewTimeline() {
      if (!isTauriRuntime()) {
        setOverviewTimelinePoints([])
        return
      }
      try {
        const start = new Date(overviewDate)
        start.setHours(0, 0, 0, 0)
        const end = new Date(overviewDate)
        end.setHours(23, 59, 59, 999)
        const response = await invoke<{ points?: MonitorTimelinePoint[] }>('run_monitor_timeline', {
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          resolution: timelineBucketMinutes <= 15 ? 'medium' : 'coarse',
          fillFromPrevious: false,
          bucketSeconds: timelineBucketMinutes * 60,
          aggregateMode: 'latest',
        })
        if (cancelled) return
        const points = Array.isArray(response?.points) ? response.points : []
        setOverviewTimelinePoints(points)
      } catch (err) {
        if (cancelled) return
        console.error('Failed to fetch overview timeline:', err)
        setOverviewTimelinePoints([])
      }
    }

    void fetchOverviewTimeline()
    return () => {
      cancelled = true
    }
  }, [overviewDate, timelineBucketMinutes, historyRevision])

  useEffect(() => {
    let cancelled = false

    async function fetchOverviewAggregates() {
      if (!isTauriRuntime()) {
        setOverviewAggregates(null)
        return
      }
      try {
        const response = await invoke<OverviewAggregates>('run_overview_aggregates', {
          dateIso: overviewKey,
        })
        if (cancelled) return
        setOverviewAggregates(response ?? null)
      } catch (err) {
        if (cancelled) return
        console.error('Failed to fetch overview aggregates:', err)
        setOverviewAggregates(null)
      }
    }

    void fetchOverviewAggregates()
    return () => {
      cancelled = true
    }
  }, [historyRevision, overviewKey])

  useEffect(() => {
    let cancelled = false

    async function fetchSessionDayIndex() {
      if (!isTauriRuntime()) {
        setSessionDayIndex(null)
        return
      }
      try {
        const response = await invoke<SessionDayIndexResponse>('run_session_days')
        if (cancelled) return
        setSessionDayIndex(response ?? null)
      } catch (err) {
        if (cancelled) return
        console.error('Failed to fetch session day index:', err)
        setSessionDayIndex(null)
      }
    }

    void fetchSessionDayIndex()
    return () => {
      cancelled = true
    }
  }, [historyRevision])

  useEffect(() => {
    let cancelled = false

    async function fetchOverviewDaySessions() {
      if (!isTauriRuntime()) {
        setOverviewDaySessions([])
        return
      }
      try {
        const response = await invoke<{ items?: SessionHistoryItem[] }>('run_session_history', {
          startDate: overviewKey,
          endDate: overviewKey,
        })
        if (cancelled) return
        setOverviewDaySessions(Array.isArray(response?.items) ? response.items : [])
      } catch (err) {
        if (cancelled) return
        console.error('Failed to fetch overview day sessions:', err)
        setOverviewDaySessions([])
      }
    }

    void fetchOverviewDaySessions()
    return () => {
      cancelled = true
    }
  }, [overviewKey, historyRevision])

  const secondaryMetricSeries = {
    peakStress: overviewAggregates?.secondary_metric_series?.peak_stress ?? [0, 0, 0, 0, 0, 0, 0],
    avgFocusSession: overviewAggregates?.secondary_metric_series?.avg_focus_session ?? [0, 0, 0, 0, 0, 0, 0],
    postureAvg: overviewAggregates?.secondary_metric_series?.posture_avg ?? [0, 0, 0, 0, 0, 0, 0],
    breakMinutes: overviewAggregates?.secondary_metric_series?.break_minutes ?? [0, 0, 0, 0, 0, 0, 0],
  }

  const periodStart = useMemo(() => startDateForPeriod(focusPeriod), [focusPeriod])
  const periodEnd = useMemo(() => {
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    return end
  }, [])
  const periodRangeLabel = useMemo(
    () =>
      `${periodStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} - ${periodEnd.toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
    [periodEnd, periodStart],
  )
  const currentPeriodFocus = useMemo(
    () => focusSessions.filter((item) => new Date(item.created_at) >= periodStart),
    [focusSessions, periodStart],
  )

  const previousPeriodFocus = useMemo(() => {
    const end = new Date(periodStart)
    end.setSeconds(end.getSeconds() - 1)
    const days = focusPeriod === 'week' ? 7 : focusPeriod === 'month' ? 30 : 90
    const start = new Date(end)
    start.setDate(end.getDate() - (days - 1))
    return focusSessions.filter((item) => {
      const at = new Date(item.created_at)
      return at >= start && at <= end
    })
  }, [focusPeriod, focusSessions, periodStart])

  const periodFocusedMinutes = Math.round(
    currentPeriodFocus.reduce((sum, item) => sum + item.session_duration_seconds, 0) / 60,
  )
  const periodAvgStress = Math.round(mean(currentPeriodFocus.map((item) => stressIndexFromHistory(item))))
  const periodSessionCount = currentPeriodFocus.length
  const hasEnoughPatternData = periodSessionCount >= PATTERN_MIN_SESSIONS
  const patternSessionsNeeded = Math.max(0, PATTERN_MIN_SESSIONS - periodSessionCount)
  const previousFocusedMinutes = Math.round(
    previousPeriodFocus.reduce((sum, item) => sum + item.session_duration_seconds, 0) / 60,
  )
  const previousAvgStress = Math.round(mean(previousPeriodFocus.map((item) => stressIndexFromHistory(item))))
  const previousSessionCount = previousPeriodFocus.length

  const focusHeroDeltaTime =
    previousFocusedMinutes === 0
      ? 0
      : Math.round(((periodFocusedMinutes - previousFocusedMinutes) / previousFocusedMinutes) * 100)
  const focusHeroDeltaStress =
    previousAvgStress === 0 ? 0 : Math.round(((periodAvgStress - previousAvgStress) / previousAvgStress) * 100)
  const focusHeroDeltaSessions =
    previousSessionCount === 0
      ? 0
      : Math.round(((periodSessionCount - previousSessionCount) / previousSessionCount) * 100)

  const heatmapData = useMemo(() => {
    const rows = 7
    const cols = HEATMAP_END - HEATMAP_START + 1
    const matrix = Array.from({ length: rows }, () =>
      Array.from({ length: cols }, () => ({ avgStress: null as number | null, count: 0 })),
    )
    currentPeriodFocus.forEach((item) => {
      const date = new Date(item.created_at)
      const weekday = (date.getDay() + 6) % 7
      const hour = date.getHours()
      if (hour < HEATMAP_START || hour > HEATMAP_END) return
      const slot = matrix[weekday][hour - HEATMAP_START]
      const stress = stressIndexFromHistory(item)
      const nextCount = slot.count + 1
      slot.avgStress = slot.avgStress == null ? stress : (slot.avgStress * slot.count + stress) / nextCount
      slot.count = nextCount
    })
    return matrix
  }, [currentPeriodFocus])

  const focusPatternCallout = useMemo(() => {
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    let bestScore = -1
    let bestDay = -1
    let bestHour = -1

    heatmapData.forEach((row, day) => {
      row.forEach((cell, hourIndex) => {
        if (!cell.count || cell.avgStress == null) return
        const score = cell.count * (100 - cell.avgStress)
        if (score > bestScore) {
          bestScore = score
          bestDay = day
          bestHour = HEATMAP_START + hourIndex
        }
      })
    })

    if (bestDay < 0 || bestHour < 0) return null
    return `You focus best on ${dayNames[bestDay]} around ${formatHourLabel(bestHour)}`
  }, [heatmapData])

  const rhythmData = useMemo(() => {
    if (focusPeriod === 'week') {
      const points: Array<{ label: string; focusedMinutes: number; avgStress: number | null }> = []
      for (let i = 0; i < 7; i += 1) {
        const dayStart = new Date(periodStart)
        dayStart.setDate(periodStart.getDate() + i)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(dayStart)
        dayEnd.setHours(23, 59, 59, 999)
        const items = currentPeriodFocus.filter((item) => {
          const at = new Date(item.created_at)
          return at >= dayStart && at <= dayEnd
        })
        const focusedMinutes = Math.round(items.reduce((sum, item) => sum + item.session_duration_seconds, 0) / 60)
        const avgStress = Math.round(mean(items.map((item) => stressIndexFromHistory(item))))
        points.push({
          label: dayStart.toLocaleDateString([], { weekday: 'short' }),
          focusedMinutes,
          avgStress: Number.isFinite(avgStress) && avgStress > 0 ? avgStress : null,
        })
      }
      return points
    }

    if (focusPeriod === 'month') {
      const points: Array<{ label: string; focusedMinutes: number; avgStress: number | null }> = []
      for (let i = 0; i < 6; i += 1) {
        const bucketStart = new Date(periodStart)
        bucketStart.setDate(periodStart.getDate() + i * 5)
        bucketStart.setHours(0, 0, 0, 0)
        const bucketEnd = new Date(bucketStart)
        bucketEnd.setDate(bucketStart.getDate() + 4)
        bucketEnd.setHours(23, 59, 59, 999)
        const items = currentPeriodFocus.filter((item) => {
          const at = new Date(item.created_at)
          return at >= bucketStart && at <= bucketEnd
        })
        const focusedMinutes = Math.round(items.reduce((sum, item) => sum + item.session_duration_seconds, 0) / 60)
        const avgStress = Math.round(mean(items.map((item) => stressIndexFromHistory(item))))
        points.push({
          label: `W${i + 1}`,
          focusedMinutes,
          avgStress: Number.isFinite(avgStress) && avgStress > 0 ? avgStress : null,
        })
      }
      return points
    }

    const monthPoints: Array<{ label: string; focusedMinutes: number; avgStress: number | null }> = []
    for (let i = 2; i >= 0; i -= 1) {
      const monthStart = new Date()
      monthStart.setMonth(monthStart.getMonth() - i, 1)
      monthStart.setHours(0, 0, 0, 0)
      const monthEnd = new Date(monthStart)
      monthEnd.setMonth(monthStart.getMonth() + 1, 0)
      monthEnd.setHours(23, 59, 59, 999)
      const items = currentPeriodFocus.filter((item) => {
        const at = new Date(item.created_at)
        return at >= monthStart && at <= monthEnd
      })
      const focusedMinutes = Math.round(items.reduce((sum, item) => sum + item.session_duration_seconds, 0) / 60)
      const avgStress = Math.round(mean(items.map((item) => stressIndexFromHistory(item))))
      monthPoints.push({
        label: monthStart.toLocaleDateString([], { month: 'short' }),
        focusedMinutes,
        avgStress: Number.isFinite(avgStress) && avgStress > 0 ? avgStress : null,
      })
    }
    return monthPoints
  }, [currentPeriodFocus, focusPeriod, periodStart])

  const rhythmMaxMinutes = Math.max(60, ...rhythmData.map((item) => item.focusedMinutes))
  const rhythmStressValues = rhythmData.map((item) => item.avgStress).filter((value): value is number => value != null)
  let rhythmStressMin = 0
  let rhythmStressMax = 100
  if (rhythmStressValues.length > 0) {
    const observedMin = Math.min(...rhythmStressValues)
    const observedMax = Math.max(...rhythmStressValues)
    const center = (observedMin + observedMax) / 2
    const halfRange = Math.max(10, (observedMax - observedMin) / 2 + 8)
    rhythmStressMin = clamp(Math.round(center - halfRange), 0, 100)
    rhythmStressMax = clamp(Math.round(center + halfRange), 0, 100)
    if (rhythmStressMax - rhythmStressMin < 20) {
      rhythmStressMin = clamp(Math.round(center - 10), 0, 100)
      rhythmStressMax = clamp(Math.round(center + 10), 0, 100)
    }
  }
  const rhythmStressPath = buildPath(
    rhythmData.map((item) => item.avgStress),
    rhythmStressMin,
    rhythmStressMax,
    100,
    64,
  )
  const rhythmBestIndex = rhythmData.reduce(
    (best, item, index, arr) => (item.focusedMinutes > arr[best].focusedMinutes ? index : best),
    0,
  )

  const focusSessionsSorted = useMemo(() => {
    const ordered = [...currentPeriodFocus].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )
    return sortNewestFirst ? ordered.reverse() : ordered
  }, [currentPeriodFocus, sortNewestFirst])

  // Analytics: Study Streak & Consistency
  const studyAnalytics = useMemo(() => {
    const allFocus = [...focusSessions].sort(
      (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime(),
    )

    // Calculate current streak
    let currentStreak = 0
    let longestStreak = 0
    let tempStreak = 0
    const uniqueDays = new Set<string>()
    const today = new Date()
    today.setHours(0, 0, 0, 0)

    allFocus.forEach((session) => {
      const sessionDate = new Date(session.created_at)
      sessionDate.setHours(0, 0, 0, 0)
      const dayKey = sessionDate.toISOString().split('T')[0]
      uniqueDays.add(dayKey)
    })

    const sortedDays = Array.from(uniqueDays).sort()
    for (let i = sortedDays.length - 1; i >= 0; i--) {
      const dayDate = new Date(sortedDays[i])
      const expectedDate = new Date(today)
      expectedDate.setDate(today.getDate() - (sortedDays.length - 1 - i))

      if (dayDate.toISOString().split('T')[0] === expectedDate.toISOString().split('T')[0]) {
        tempStreak++
      } else {
        break
      }
    }
    currentStreak = tempStreak

    // Calculate longest streak
    let streak = 1
    for (let i = 1; i < sortedDays.length; i++) {
      const prev = new Date(sortedDays[i - 1])
      const curr = new Date(sortedDays[i])
      const diffDays = Math.round((curr.getTime() - prev.getTime()) / (1000 * 60 * 60 * 24))
      if (diffDays === 1) {
        streak++
        longestStreak = Math.max(longestStreak, streak)
      } else {
        streak = 1
      }
    }

    // Calculate spacing score (0-100)
    let spacingScore = 0
    if (currentPeriodFocus.length > 1) {
      const sessionDates = currentPeriodFocus.map((s) => new Date(s.created_at).getTime())
      const intervals: number[] = []
      for (let i = 1; i < sessionDates.length; i++) {
        intervals.push((sessionDates[i] - sessionDates[i - 1]) / (1000 * 60 * 60)) // hours
      }
      const avgInterval = mean(intervals)
      const optimalInterval = 48 // hours (from research)
      const deviation = Math.abs(avgInterval - optimalInterval) / optimalInterval
      spacingScore = Math.round(Math.max(0, Math.min(100, 100 - deviation * 50)))
    }

    return {
      currentStreak,
      longestStreak,
      spacingScore,
      sessionsThisWeek: currentPeriodFocus.length,
      daysStudied: uniqueDays.size,
    }
  }, [focusSessions, currentPeriodFocus])

  // Analytics: Calculate personalized quality score for each session
  const sessionQualityAnalytics = useMemo(() => {
    // Calculate quality score (0-100) based on multiple factors
    const sessionsWithQuality = currentPeriodFocus.map((session) => {
      const stress = stressIndexFromHistory(session)
      const duration = session.session_duration_seconds / 60
      const posture = session.posture_score * 100
      const hrAvailable = session.heart_rate_bpm != null
      const rrConfidence = session.rr_confidence

      // Quality components (weighted)
      const postureScore = posture // 0-100
      const stressScore = Math.max(0, 100 - stress) // Lower stress = higher score
      const durationScore = Math.min(100, (duration / 60) * 100) // Longer sessions score higher (up to 60 min)
      const rrConfidenceScore = rrConfidence === 'full' ? 100 : rrConfidence === 'partial' ? 50 : 0
      const hrScore = hrAvailable ? 100 : 50

      // Weighted quality score
      const quality = Math.round(
        postureScore * 0.35 + // 35% posture
          stressScore * 0.25 + // 25% stress management
          durationScore * 0.2 + // 20% duration/engagement
          rrConfidenceScore * 0.1 + // 10% RR data quality
          hrScore * 0.1, // 10% HR data availability
      )

      return {
        ...session,
        stress,
        duration,
        posture,
        quality,
      }
    })

    return sessionsWithQuality.sort((a, b) => b.quality - a.quality)
  }, [currentPeriodFocus])

  // Analytics: Personalized Optimal Zones (based on top-performing sessions)
  const personalizedZones = useMemo(() => {
    if (sessionQualityAnalytics.length < 5) {
      return {
        optimalStressMin: 40,
        optimalStressMax: 65,
        optimalDurationMin: 30,
        optimalDurationMax: 60,
        isPersonalized: false,
      }
    }

    // Get top 25% of sessions by quality
    const topQuartile = sessionQualityAnalytics.slice(0, Math.max(3, Math.ceil(sessionQualityAnalytics.length * 0.25)))

    // Find stress range of top sessions
    const topStress = topQuartile.map((s) => s.stress)
    const optimalStressMin = Math.max(0, Math.min(...topStress) - 5)
    const optimalStressMax = Math.min(100, Math.max(...topStress) + 5)

    // Find duration range of top sessions
    const topDurations = topQuartile.map((s) => s.duration)
    const optimalDurationMin = Math.max(15, Math.min(...topDurations) - 5)
    const optimalDurationMax = Math.min(120, Math.max(...topDurations) + 5)

    return {
      optimalStressMin: Math.round(optimalStressMin),
      optimalStressMax: Math.round(optimalStressMax),
      optimalDurationMin: Math.round(optimalDurationMin),
      optimalDurationMax: Math.round(optimalDurationMax),
      isPersonalized: true,
    }
  }, [sessionQualityAnalytics])

  // Analytics: Session Performance Distribution
  const performanceAnalytics = useMemo(() => {
    const avgQuality = sessionQualityAnalytics.length > 0 ? mean(sessionQualityAnalytics.map((s) => s.quality)) : 0

    // Categorize sessions based on their quality relative to personal average
    const excellent = sessionQualityAnalytics.filter((s) => s.quality >= avgQuality + 15).length
    const good = sessionQualityAnalytics.filter(
      (s) => s.quality >= avgQuality - 10 && s.quality < avgQuality + 15,
    ).length
    const needsWork = sessionQualityAnalytics.filter((s) => s.quality < avgQuality - 10).length
    const total = sessionQualityAnalytics.length || 1

    // Analyze what makes top sessions work
    const topSessions = sessionQualityAnalytics.slice(0, Math.max(3, Math.ceil(sessionQualityAnalytics.length * 0.25)))
    const avgTopStress = topSessions.length > 0 ? mean(topSessions.map((s) => s.stress)) : 50
    const avgTopDuration = topSessions.length > 0 ? mean(topSessions.map((s) => s.duration)) : 45
    const avgTopPosture = topSessions.length > 0 ? mean(topSessions.map((s) => s.posture)) : 70

    // Generate personalized recommendation
    let recommendation = ''
    if (sessionQualityAnalytics.length < 5) {
      recommendation = 'Complete more sessions to unlock personalized insights'
    } else {
      const avgCurrentPosture = mean(sessionQualityAnalytics.map((s) => s.posture))
      const avgCurrentStress = mean(sessionQualityAnalytics.map((s) => s.stress))

      if (avgCurrentPosture < avgTopPosture - 10) {
        recommendation = `Your best sessions have ${Math.round(avgTopPosture)}% posture. Focus on sitting upright.`
      } else if (avgCurrentStress > avgTopStress + 10) {
        recommendation = `Your best sessions average ${Math.round(avgTopStress)} stress. Try more breaks or shorter sessions.`
      } else if (good / total > 0.6) {
        recommendation = `You're consistent! ${Math.round((good / total) * 100)}% of sessions are performing well.`
      } else {
        recommendation = `Your top sessions are ${Math.round(avgTopDuration)} min at ${Math.round(avgTopStress)} stress. Aim for similar conditions.`
      }
    }

    return {
      excellentPct: Math.round((excellent / total) * 100),
      goodPct: Math.round((good / total) * 100),
      needsWorkPct: Math.round((needsWork / total) * 100),
      excellentCount: excellent,
      goodCount: good,
      needsWorkCount: needsWork,
      avgQuality: Math.round(avgQuality),
      recommendation,
      personalBest: sessionQualityAnalytics[0]?.quality ?? 0,
    }
  }, [sessionQualityAnalytics])

  // Analytics: Duration Effectiveness (based on quality, not just stress)
  const durationAnalytics = useMemo(() => {
    const dataPoints = sessionQualityAnalytics.map((session) => ({
      duration: session.duration,
      stress: session.stress,
      quality: session.quality,
      posture: session.posture,
      id: session.id,
    }))

    // Find optimal duration range
    const avgDuration = dataPoints.length ? mean(dataPoints.map((d) => d.duration)) : 0

    return {
      dataPoints,
      optimalDurationMin: personalizedZones.optimalDurationMin,
      optimalDurationMax: personalizedZones.optimalDurationMax,
      averageDuration: Math.round(avgDuration),
      recommendation:
        dataPoints.length < 5
          ? 'Complete more sessions for personalized duration recommendations'
          : personalizedZones.isPersonalized
            ? `Your best sessions are ${personalizedZones.optimalDurationMin}-${personalizedZones.optimalDurationMax} minutes`
            : `Build more data to find your optimal session length`,
    }
  }, [sessionQualityAnalytics, personalizedZones])

  const selectedExercise =
    EXERCISE_LIBRARY.find((exercise) => exercise.id === selectedExerciseId) ?? EXERCISE_LIBRARY[0] ?? null
  const tabTitle =
    tab === 'overview'
      ? 'Overview'
      : tab === 'monitor'
        ? 'Monitor'
        : tab === 'focus'
          ? 'Focus History'
          : tab === 'posture'
            ? 'Posture'
            : tab === 'exercises'
              ? 'Exercises'
              : 'Settings'
  const tabSubline =
    tab === 'monitor'
      ? 'Live signal stack and camera state'
      : `Today ${todaySessions.length} sessions · ${formatMinutes(todayFocusedMinutes)} focused`

  async function logExerciseSessionOnExit(options?: {
    forceCompleted?: boolean
    triggeredBy?: string
  }): Promise<ExerciseSessionSummary | null> {
    const exerciseId = guidedExerciseIdRef.current ?? selectedExercise?.id
    const startedAt = guidedStartedAtRef.current
    if (!exerciseId || startedAt == null) return null
    if (exerciseCompletionLoggedRef.current) return null
    exerciseCompletionLoggedRef.current = true

    const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000))
    const completionByReps =
      exerciseMetrics?.target_reps && exerciseMetrics.target_reps > 0
        ? exerciseMetrics.rep_count >= exerciseMetrics.target_reps
        : false
    const completionByProgress = (exerciseMetrics?.progress_pct ?? 0) >= 100 || Boolean(exerciseMetrics?.completed)
    const completed = options?.forceCompleted ?? (completionByReps || completionByProgress)
    const formScore = exerciseMetrics?.quality_score ?? null
    const exerciseName =
      EXERCISE_LIBRARY.find((item) => item.id === exerciseId)?.name ?? exerciseId

    try {
      await invoke('run_log_exercise_session', {
        exerciseId,
        completed,
        formScore,
        durationSeconds,
        triggeredBy: options?.triggeredBy ?? guidedTriggeredByRef.current ?? 'manual',
      })
    } catch {
      // Exercise logging should not block UX.
    }

    return {
      exerciseId,
      exerciseName,
      completed,
      repCount: exerciseMetrics?.rep_count ?? 0,
      targetReps: exerciseMetrics?.target_reps ?? 0,
      formScore,
      durationSeconds,
      holdSeconds: exerciseMetrics?.hold_seconds ?? 0,
    }
  }

  function startGuidedExercise(exerciseId: string, triggeredBy: string = 'manual') {
    setSelectedExerciseId(exerciseId)
    setExerciseFeedback(null)
    setExerciseMetrics(null)
    setExerciseSessionSummary(null)
    exerciseCompletionLoggedRef.current = false
    guidedStartedAtRef.current = Date.now()
    guidedExerciseIdRef.current = exerciseId
    guidedTriggeredByRef.current = triggeredBy
    setExerciseGuidedActive(true)
    setTab('exercises')
  }

  async function refreshExerciseHistory() {
    try {
      const historyPayload = await invoke<{
        items?: Array<{
          id: number
          timestamp: string
          exercise_id: string
          completed: boolean
          form_score: number | null
          duration_seconds: number
        }>
      }>('run_exercise_history', { limit: 12 })
      setExerciseHistory(Array.isArray(historyPayload?.items) ? historyPayload.items : [])
    } catch {
      // non-blocking
    }
  }

  async function stopGuidedExercise(showSummary = true) {
    if (!exerciseGuidedActive && !guidedExerciseIdRef.current) return
    const summary = await logExerciseSessionOnExit()
    setExerciseGuidedActive(false)
    setExerciseFeedback(null)
    setExerciseMetrics(null)
    guidedStartedAtRef.current = null
    guidedExerciseIdRef.current = null
    void refreshExerciseHistory()
    if (showSummary && summary) {
      setExerciseSessionSummary(summary)
    }
  }

  function toggleGuidedExercise(exerciseId?: string) {
    if (exerciseGuidedActive) {
      void stopGuidedExercise(true)
      return
    }
    const targetId = exerciseId ?? selectedExercise?.id
    if (!targetId) return
    startGuidedExercise(targetId)
  }

  function openExercisesTab() {
    setTab('exercises')
  }

  function startExerciseFromPosture(exerciseId: string) {
    startGuidedExercise(exerciseId, 'posture_alert')
  }

  async function exportDataAsCsv() {
    try {
      const result = await invoke<{ ok?: boolean; path?: string; error?: string }>('run_export_sessions_csv')
      if (result?.ok && result.path) {
        setExportMessage(`Exported to ${result.path}`)
      } else {
        setExportMessage(result?.error ?? 'Export failed')
      }
    } catch (err) {
      setExportMessage(err instanceof Error ? err.message : 'Export failed')
    }
  }

  async function runPostureBaselineRecalibration(seconds: number) {
    setPostureStreamSuspended(true)
    setPostureStreamError(null)
    try {
      await invoke('stop_posture_stream').catch(() => null)
      const payload = await invoke<{
        ok?: boolean
        error?: string
        samples?: number
        accepted_samples?: number
        baseline_posture_score?: number
        baseline_confidence?: number
      }>('run_recalibrate_baseline', { seconds })
      return payload
    } finally {
      setPostureStreamSuspended(false)
    }
  }

  // Prefetch posture recs, exercise history, and soft-trigger suggestion.
  useEffect(() => {
    let cancelled = false
    async function loadExerciseContext() {
      try {
        const [insights, historyPayload] = await Promise.all([
          invoke<PostureInsights>('run_posture_insights', { days: 7 }),
          invoke<{
            items?: Array<{
              id: number
              timestamp: string
              exercise_id: string
              completed: boolean
              form_score: number | null
              duration_seconds: number
            }>
          }>('run_exercise_history', { limit: 12 }),
        ])
        if (cancelled) return
        const recs = Array.isArray(insights?.recommended_ids) ? insights.recommended_ids : []
        setPostureRecommendedIds(recs)
        setExerciseHistory(Array.isArray(historyPayload?.items) ? historyPayload.items : [])

        // Soft trigger: recent poor posture sessions suggest a reset exercise.
        const recentPoor = history
          .slice(0, 12)
          .filter((item) => Boolean(item.posture_is_poor) || item.posture_score < 0.52).length
        if (recentPoor >= 3) {
          const pick = recs.find((id) => EXERCISE_LIBRARY.some((ex) => ex.id === id)) ?? 'chin-tuck'
          setSoftSuggestionId(pick)
        } else {
          setSoftSuggestionId(null)
        }
      } catch {
        if (!cancelled) {
          setPostureRecommendedIds([])
          setExerciseHistory([])
          setSoftSuggestionId(null)
        }
      }
    }
    void loadExerciseContext()
    return () => {
      cancelled = true
    }
  }, [historyRevision, history])

  // Auto-finish guided exercise when backend reports completion.
  useEffect(() => {
    if (!exerciseGuidedActive) return
    const done =
      Boolean(exerciseMetrics?.completed) ||
      ((exerciseMetrics?.target_reps ?? 0) > 0 &&
        (exerciseMetrics?.rep_count ?? 0) >= (exerciseMetrics?.target_reps ?? 0))
    if (!done) return
    void (async () => {
      const summary = await logExerciseSessionOnExit({ forceCompleted: true })
      setExerciseGuidedActive(false)
      setExerciseFeedback(null)
      guidedStartedAtRef.current = null
      guidedExerciseIdRef.current = null
      void refreshExerciseHistory()
      if (summary) setExerciseSessionSummary(summary)
      setExerciseMetrics(null)
    })()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exerciseGuidedActive, exerciseMetrics?.completed, exerciseMetrics?.rep_count, exerciseMetrics?.target_reps])

  useEffect(() => {
    const shouldStream =
      !postureStreamSuspended &&
      (tab === 'posture' ||
        (tab === 'exercises' && exerciseGuidedActive) ||
        (tab === 'monitor' && (Boolean(settings?.focus_mode_active) || isCheckInRunning)))
    if (!shouldStream) return

    let unlistenFrame: (() => void) | undefined
    let unlistenEnded: (() => void) | undefined

    async function startBackendPostureStream() {
      setPostureStreamState('connecting')
      setPostureStreamError(null)
      try {
        const exerciseIdArg =
          tab === 'exercises' && exerciseGuidedActive
            ? (guidedExerciseIdRef.current ?? selectedExercise?.id ?? null)
            : null
        await invoke('start_posture_stream', { fps: 8, exerciseId: exerciseIdArg })
        unlistenFrame = await listen<PostureStreamFrame>('posture-stream-frame', (event) => {
          const payload = event.payload
          setPostureFrame(`data:image/jpeg;base64,${payload.frame_jpeg_b64}`)
          setPostureLandmarks(payload.landmarks ?? null)
          setPostureScoreLive(payload.posture_score)
          setPostureTrackingConfidence(
            typeof payload.tracking_confidence === 'number' ? payload.tracking_confidence : null,
          )
          setPostureHeadOffsetNorm(typeof payload.head_offset_norm === 'number' ? payload.head_offset_norm : null)
          setPostureShoulderTiltSignedNorm(
            typeof payload.shoulder_tilt_signed_norm === 'number' ? payload.shoulder_tilt_signed_norm : null,
          )
          setPostureShoulderTiltNorm(
            typeof payload.shoulder_tilt_norm === 'number' ? payload.shoulder_tilt_norm : null,
          )
          setPostureStabilityStd(
            typeof payload.posture_stability_std === 'number' ? payload.posture_stability_std : null,
          )
          setPostureStabilityLabel(
            typeof payload.posture_stability_label === 'string' ? payload.posture_stability_label : null,
          )
          setExerciseFeedback(payload.exercise_feedback ?? null)
          setExerciseMetrics(payload.exercise_metrics ?? null)
          setPostureStreamState(payload.landmarks ? 'running' : 'no-pose')
        })
        unlistenEnded = await listen('posture-stream-ended', () => setPostureStreamState('stopped'))
      } catch (err) {
        setPostureStreamState('error')
        setPostureStreamError(err instanceof Error ? err.message : 'Unable to start posture stream.')
      }
    }

    void startBackendPostureStream()
    return () => {
      if (unlistenFrame) unlistenFrame()
      if (unlistenEnded) unlistenEnded()
      void invoke('stop_posture_stream').catch(() => null)
    }
  }, [tab, exerciseGuidedActive, selectedExercise?.id, selectedExercise, settings?.focus_mode_active, isCheckInRunning, postureStreamSuspended])

  return (
    <div className="main-window-shell">
      <header className="desktop-chrome">
        <div className="desktop-chrome-drag" data-tauri-drag-region>
          <div className="desktop-topbar-title">
            <h1>{tabTitle}</h1>
            <p>{tabSubline}</p>
          </div>
          <div className="desktop-topbar-status">
            <button
              className={`desktop-pill desktop-pill--toggle ${settings?.focus_mode_active ? 'is-on' : 'is-off'}`}
              onClick={() => void updateSettings({ focus_mode_active: !settings?.focus_mode_active })}
            >
              <Target size={12} />
              Focus {settings?.focus_mode_active ? 'On' : 'Off'}
            </button>
            <button
              className={`desktop-pill desktop-pill--toggle ${settings?.monitoring_paused ? 'is-off' : 'is-on'}`}
              onClick={() => void updateSettings({ monitoring_paused: !settings?.monitoring_paused })}
            >
              {settings?.monitoring_paused ? <Pause size={12} /> : <Play size={12} />}
              {settings?.monitoring_paused ? 'Paused' : 'Monitoring'}
            </button>
          </div>
        </div>
        <div className="desktop-topbar-actions">
          <button
            className="desktop-action-btn desktop-action-btn--primary"
            onClick={() => void onRunCheckIn()}
            disabled={isCheckInRunning}
          >
            <Zap size={14} />
            {isCheckInRunning ? 'Checking…' : 'Check in'}
          </button>
        </div>
      </header>
      <main className="main-shell">
        <SidebarNav tab={tab} setTab={setTab} />

        <OverlayScrollbarsComponent className="main-content" options={overlayScrollbarOptions}>
          <AnimatePresence mode="wait" initial={false}>
            {tab === 'monitor' && (
              <motion.div key="tab-monitor" variants={fadeSlide} initial="hidden" animate="visible" exit="exit">
                <MonitorTab
                  history={history}
                  currentResult={currentResult}
                  focusModeActive={Boolean(settings?.focus_mode_active)}
                  isCheckInRunning={isCheckInRunning}
                  postureFrame={postureFrame}
                  postureLandmarks={postureLandmarks}
                  postureScoreLive={postureScoreLive}
                  onStartFocusMode={() => void updateSettings({ focus_mode_active: true })}
                  onEndFocusMode={() => void updateSettings({ focus_mode_active: false })}
                />
              </motion.div>
            )}

            {tab === 'overview' && (
              <motion.div key="tab-overview" variants={fadeSlide} initial="hidden" animate="visible" exit="exit">
                <OverviewTab
                  now={overviewDate}
                  heroHeadline={heroHeadline}
                  heroSubline={heroSubline}
                  avgStressToday={avgStressToday}
                  stressDeltaVsYesterday={stressDeltaVsYesterday}
                  heroTrendTone={heroTrendTone}
                  todayFocusedMinutes={todayFocusedMinutes}
                  avgHrToday={avgHrToday}
                  avgRrToday={avgRrToday}
                  hrDeltaBaseline={hrDeltaBaseline}
                  todayBreakCount={todayBreakCount}
                  todaySessions={overviewSessions}
                  timelineData={timelineData}
                  timelineBucketMinutes={timelineBucketMinutes}
                  setTimelineBucketMinutes={handleTimelineBucketMinutesChange}
                  timelineStartLabel={timelineStartLabel}
                  onShiftOverviewDay={shiftOverviewDay}
                  onSetOverviewDay={setOverviewDayFromIso}
                  selectedDayIso={overviewKey}
                  minDayIso={localDateKey(minOverviewDate)}
                  maxDayIso={todayKey}
                  canShiftOverviewPrev={canShiftOverviewPrev}
                  canShiftOverviewNext={canShiftOverviewNext}
                  secondaryMetricSeries={secondaryMetricSeries}
                  dailyReport={dailyReport}
                  onViewFocusHistory={() => setTab('focus')}
                />
              </motion.div>
            )}

            {tab === 'focus' && (
              <motion.div key="tab-focus" variants={fadeSlide} initial="hidden" animate="visible" exit="exit">
                <FocusHistoryTab
                  focusPeriod={focusPeriod}
                  setFocusPeriod={setFocusPeriod}
                  periodSessionCount={periodSessionCount}
                  periodFocusedMinutes={periodFocusedMinutes}
                  periodAvgStress={periodAvgStress}
                  focusHeroDeltaTime={focusHeroDeltaTime}
                  focusHeroDeltaStress={focusHeroDeltaStress}
                  focusHeroDeltaSessions={focusHeroDeltaSessions}
                  periodRangeLabel={periodRangeLabel}
                  hasEnoughPatternData={hasEnoughPatternData}
                  patternSessionsNeeded={patternSessionsNeeded}
                  heatmapData={heatmapData}
                  focusPatternCallout={focusPatternCallout}
                  rhythmData={rhythmData}
                  rhythmMaxMinutes={rhythmMaxMinutes}
                  rhythmStressPath={rhythmStressPath}
                  rhythmStressMin={rhythmStressMin}
                  rhythmStressMax={rhythmStressMax}
                  rhythmBestIndex={rhythmBestIndex}
                  focusSessionsSorted={focusSessionsSorted}
                  expandedSessionId={expandedSessionId}
                  setExpandedSessionId={setExpandedSessionId}
                  sortNewestFirst={sortNewestFirst}
                  setSortNewestFirst={setSortNewestFirst}
                  studyAnalytics={studyAnalytics}
                  performanceAnalytics={performanceAnalytics}
                  durationAnalytics={durationAnalytics}
                  personalizedZones={personalizedZones}
                />
              </motion.div>
            )}

            {tab === 'posture' && (
              <motion.div key="tab-posture" variants={fadeSlide} initial="hidden" animate="visible" exit="exit">
                <PostureTab
                  postureStreamState={postureStreamState}
                  postureScoreLive={postureScoreLive}
                  postureTrackingConfidence={postureTrackingConfidence}
                  postureHeadOffsetNorm={postureHeadOffsetNorm}
                  postureShoulderTiltSignedNorm={postureShoulderTiltSignedNorm}
                  postureShoulderTiltNorm={postureShoulderTiltNorm}
                  postureStabilityStd={postureStabilityStd}
                  postureStabilityLabel={postureStabilityLabel}
                  postureFrame={postureFrame}
                  postureLandmarks={postureLandmarks}
                  postureStreamError={postureStreamError}
                  history={history}
                  onSeeAllExercises={openExercisesTab}
                  onStartExercise={startExerciseFromPosture}
                  onRecalibrateBaseline={runPostureBaselineRecalibration}
                />
              </motion.div>
            )}

            {tab === 'exercises' && (
              <motion.div key="tab-exercises" variants={fadeSlide} initial="hidden" animate="visible" exit="exit">
                <ExercisesTab
                  exercises={EXERCISE_LIBRARY}
                  selectedExerciseId={selectedExerciseId}
                  setSelectedExerciseId={setSelectedExerciseId}
                  exerciseGuidedActive={exerciseGuidedActive}
                  toggleGuided={toggleGuidedExercise}
                  startGuided={(id) => startGuidedExercise(id)}
                  stopGuided={() => void stopGuidedExercise(true)}
                  postureStreamState={postureStreamState}
                  exerciseMetrics={exerciseMetrics}
                  postureFrame={postureFrame}
                  postureLandmarks={postureLandmarks}
                  exerciseFeedback={exerciseFeedback}
                  recommendedIds={postureRecommendedIds}
                  sessionSummary={exerciseSessionSummary}
                  onDismissSummary={() => setExerciseSessionSummary(null)}
                  onDoAgain={() => {
                    const id = exerciseSessionSummary?.exerciseId ?? selectedExerciseId
                    setExerciseSessionSummary(null)
                    startGuidedExercise(id)
                  }}
                  recentHistory={exerciseHistory}
                  softSuggestionId={softSuggestionId}
                />
              </motion.div>
            )}

            {tab === 'settings' && (
              <motion.div key="tab-settings" variants={fadeSlide} initial="hidden" animate="visible" exit="exit">
                <SettingsTab
                  settings={settings}
                  updateSettings={updateSettings}
                  calibration={calibration}
                  replayOnboarding={replayOnboarding}
                  clearAllData={clearAllData}
                  lastRunSource={lastRunSource}
                  error={error}
                  onExportData={exportDataAsCsv}
                  exportMessage={exportMessage}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </OverlayScrollbarsComponent>
      </main>
    </div>
  )
}
