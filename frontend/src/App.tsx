import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUpRight, ChartNoAxesCombined, Ellipsis, House } from 'lucide-react'
import { OverlayScrollbarsComponent } from 'overlayscrollbars-react'
import { MainWindowShell } from './components/MainWindowShell'
import { QuickActionsPopover } from './components/QuickActionsPopover'
import { AppSettingsProvider } from './context/AppSettingsContext'
import { BREATHING_PATTERNS } from './shared/constants'
import {
  friendlyPosture,
  pointY,
  prettyTime,
  sessionFromHistory,
  sparklinePath,
  stressIndex,
  stressIndexFromHistory,
  stressState,
  trendStats,
} from './shared/metrics'
import type {
  AppSettings,
  BreathingPatternId,
  CalibrationStatus,
  DailyReport,
  HrStreamUpdate,
  SessionHistoryItem,
  SessionResult,
} from './shared/types'
import { fadeSlide } from './shared/motion'
import './App.css'

type BreathingSummary = {
  hrText: string
  hrTone: 'calm' | 'neutral'
  rrText: string
  rrTone: 'calm' | 'neutral'
}

function ScrollArea({
  useOverlayScrollbars,
  overlayScrollbarOptions,
  children,
}: {
  useOverlayScrollbars: boolean
  overlayScrollbarOptions: {
    overflow: { x: 'hidden'; y: 'scroll' }
    scrollbars: {
      autoHide: 'leave'
      autoHideDelay: number
      theme: string
      clickScroll: boolean
      dragScroll: boolean
    }
  }
  children: ReactNode
}) {
  if (useOverlayScrollbars) {
    return (
      <OverlayScrollbarsComponent className="content-scroll" options={overlayScrollbarOptions}>
        {children}
      </OverlayScrollbarsComponent>
    )
  }
  return <div className="content-scroll">{children}</div>
}

const CHECKIN_STORAGE_KEY = 'zeno.checkin.v1'

type PersistedCheckIn = {
  status: 'Idle' | 'Running' | 'Done' | 'Error'
  message: string | null
  result: SessionResult | null
  lastNudge: string
  lastRunSource: 'manual' | 'scheduler' | 'focus-mode' | null
  updatedAt: number
}

function readPersistedCheckIn(): PersistedCheckIn | null {
  try {
    const raw = sessionStorage.getItem(CHECKIN_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as PersistedCheckIn
    // Drop stale "running" markers after 2 minutes (process likely finished).
    if (parsed.status === 'Running' && Date.now() - (parsed.updatedAt || 0) > 120_000) {
      return { ...parsed, status: 'Idle', message: null }
    }
    return parsed
  } catch {
    return null
  }
}

function writePersistedCheckIn(payload: PersistedCheckIn) {
  try {
    sessionStorage.setItem(CHECKIN_STORAGE_KEY, JSON.stringify({ ...payload, updatedAt: Date.now() }))
  } catch {
    // sessionStorage may be unavailable; ignore.
  }
}

function App() {
  const isMainWindow = getCurrentWindow().label === 'main-window'
  const isPopoverWindow = !isMainWindow
  const persisted = useMemo(() => (isPopoverWindow ? readPersistedCheckIn() : null), [isPopoverWindow])
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
  const [status, setStatus] = useState<'Idle' | 'Running' | 'Done' | 'Error'>(persisted?.status ?? 'Idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SessionResult | null>(persisted?.result ?? null)
  const [history, setHistory] = useState<SessionHistoryItem[]>([])
  const [dailyReport, setDailyReport] = useState<DailyReport | null>(null)
  const [calibration, setCalibration] = useState<CalibrationStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [activePage, setActivePage] = useState<'home' | 'report'>('home')
  const [lastNudge, setLastNudge] = useState(persisted?.lastNudge ?? 'No nudges yet.')
  const [lastRunSource, setLastRunSource] = useState<'manual' | 'scheduler' | 'focus-mode' | null>(
    persisted?.lastRunSource ?? null,
  )
  const [displayedStress, setDisplayedStress] = useState(() => stressIndex(persisted?.result ?? null))
  const [breathingActive, setBreathingActive] = useState(false)
  const [breathingPattern, setBreathingPattern] = useState<BreathingPatternId>('box')
  const [breathingPhaseIndex, setBreathingPhaseIndex] = useState(0)
  const [breathingRemainingMs, setBreathingRemainingMs] = useState(BREATHING_PATTERNS.box.phases[0].seconds * 1000)
  const [breathingCycle, setBreathingCycle] = useState(1)
  const [breathingStartHr, setBreathingStartHr] = useState<number | null>(null)
  const [breathingTriggeredBy, setBreathingTriggeredBy] = useState<'manual' | 'auto'>('manual')
  const [breathingSummary, setBreathingSummary] = useState<BreathingSummary | null>(null)
  const [breakActive, setBreakActive] = useState(false)
  const [breakRemainingSec, setBreakRemainingSec] = useState(5 * 60)
  const [breakSummary, setBreakSummary] = useState<string | null>(null)
  const [breakTargetSec, setBreakTargetSec] = useState(5 * 60)
  const [breakAwaySeconds, setBreakAwaySeconds] = useState(0)
  const [showQuickActions, setShowQuickActions] = useState(false)
  const [quickActionStep, setQuickActionStep] = useState<'menu' | 'breathe' | 'break'>('menu')
  const [breathingUseHrSensing, setBreathingUseHrSensing] = useState(true)
  const [breathingLiveHr, setBreathingLiveHr] = useState<number | null>(null)
  const [breathingStartRr, setBreathingStartRr] = useState<number | null>(null)
  const [breakUseGenuinityChecks, setBreakUseGenuinityChecks] = useState(true)
  const [breakPlannedMinutes, setBreakPlannedMinutes] = useState(5)
  const [checkInMessage, setCheckInMessage] = useState<string | null>(persisted?.message ?? null)
  const breakActiveRef = useRef(false)
  const breathingActiveRef = useRef(false)
  const latestResultRef = useRef<SessionResult | null>(persisted?.result ?? null)
  const statusRef = useRef(status)
  const checkInMessageRef = useRef(checkInMessage)
  const lastNudgeRef = useRef(lastNudge)
  const lastRunSourceRef = useRef(lastRunSource)
  const breathingUseHrSensingRef = useRef(true)
  const breakReminderTwoSentRef = useRef(false)
  const breakReminderFourSentRef = useRef(false)
  const finishBreakRef = useRef<(reason: 'complete' | 'early') => Promise<void>>(async () => {})
  const checkInProgressTimerRef = useRef<number | null>(null)

  useEffect(() => {
    statusRef.current = status
    checkInMessageRef.current = checkInMessage
    lastNudgeRef.current = lastNudge
    lastRunSourceRef.current = lastRunSource
    latestResultRef.current = result
    if (!isPopoverWindow) return
    writePersistedCheckIn({
      status,
      message: checkInMessage,
      result,
      lastNudge,
      lastRunSource,
      updatedAt: Date.now(),
    })
  }, [status, checkInMessage, result, lastNudge, lastRunSource, isPopoverWindow])

  const canRun = status !== 'Running'
  const stress = useMemo(() => stressIndex(result), [result])
  const stressLabel = stressState(displayedStress)
  const stressFill = `${displayedStress}%`

  const sessionCountToday = useMemo(() => {
    const today = new Date().toDateString()
    return history.filter((h) => new Date(h.created_at).toDateString() === today).length
  }, [history])

  const postureTrendPoints = useMemo(
    () =>
      (dailyReport?.posture_trend ?? []).slice(-12).map((item) => ({
        time: item.time,
        value: Math.round(item.score * 100),
      })),
    [dailyReport],
  )
  const stressTrendPoints = useMemo(
    () =>
      (dailyReport?.stress_trend ?? []).slice(-12).map((item) => ({
        time: item.time,
        value: item.score,
      })),
    [dailyReport],
  )
  const rrTrendPoints = useMemo(
    () =>
      (dailyReport?.rr_trend ?? [])
        .slice(-12)
        .map((item) => ({
          time: item.time,
          value: Math.max(0, Math.min(100, ((item.score - 6) / 24) * 100)),
          bpm: item.score,
        })),
    [dailyReport],
  )
  const postureTrend = useMemo(() => postureTrendPoints.map((item) => item.value), [postureTrendPoints])
  const stressTrend = useMemo(() => stressTrendPoints.map((item) => item.value), [stressTrendPoints])
  const postureStats = useMemo(() => trendStats(postureTrend), [postureTrend])
  const stressStats = useMemo(() => trendStats(stressTrend), [stressTrend])
  const activePattern = BREATHING_PATTERNS[breathingPattern]
  const breathingPhase = activePattern.phases[breathingPhaseIndex] ?? activePattern.phases[0]
  const breathingRemainingSeconds = Math.max(0, Math.ceil(breathingRemainingMs / 1000))
  const breakMinutes = Math.floor(breakRemainingSec / 60)
  const breakSeconds = breakRemainingSec % 60
  const rrDisplay =
    result && result.respiratory_rate > 0
      ? result.mode === 'passive' || result.rr_confidence === 'partial'
        ? `~${Math.round(result.respiratory_rate)}`
        : `${Math.round(result.respiratory_rate)}`
      : '--'

  async function openMainWindow() {
    try {
      await invoke('open_main_window')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  const stopBreathing = useCallback(async () => {
    const hrEnd = breathingUseHrSensing ? breathingLiveHr : (result?.heart_rate_bpm ?? null)
    const hrStart = breathingStartHr
    const hrDelta = hrStart == null || hrEnd == null ? null : Math.round((hrEnd - hrStart) * 10) / 10
    const rrStart = breathingStartRr
    const rrEnd = result?.respiratory_rate && result.respiratory_rate > 0 ? result.respiratory_rate : null
    const rrDelta = rrStart == null || rrEnd == null ? null : Math.round((rrEnd - rrStart) * 10) / 10
    const cyclesCompleted = Math.max(0, breathingCycle - 1)

    try {
      await invoke('run_log_breathing_session', {
        exerciseType: breathingPattern,
        cyclesCompleted,
        hrStart,
        hrEnd,
        hrDelta,
        rrStart,
        rrEnd,
        rrDelta,
        triggeredBy: breathingTriggeredBy,
      })
    } catch {
      // Keep UX resilient; logging should never block the flow.
    }

    const hrText =
      hrDelta == null
        ? 'Heart rate unchanged'
        : hrDelta < 0
          ? `Heart rate down ${Math.abs(Math.round(hrDelta))} bpm`
          : hrDelta > 0
            ? `Heart rate up ${Math.round(hrDelta)} bpm`
            : 'Heart rate unchanged'
    const rrText =
      rrDelta == null
        ? 'Breathing rate unchanged'
        : rrDelta < 0
          ? `Breathing slowed ${Math.abs(Math.round(rrDelta))} bpm`
          : rrDelta > 0
            ? `Breathing faster ${Math.round(rrDelta)} bpm`
            : 'Breathing rate unchanged'

    setBreathingSummary({
      hrText,
      hrTone: hrDelta != null && hrDelta < 0 ? 'calm' : 'neutral',
      rrText,
      rrTone: rrDelta != null && rrDelta < 0 ? 'calm' : 'neutral',
    })
    setBreathingActive(false)
    setBreathingLiveHr(null)
  }, [
    breathingCycle,
    breathingLiveHr,
    breathingPattern,
    breathingStartHr,
    breathingStartRr,
    breathingTriggeredBy,
    breathingUseHrSensing,
    result?.heart_rate_bpm,
    result?.respiratory_rate,
  ])

  useEffect(() => {
    let rafId = 0
    const animate = () => {
      setDisplayedStress((prev) => {
        const delta = stress - prev
        if (Math.abs(delta) < 0.4) return stress
        return prev + delta * 0.18
      })
      rafId = window.requestAnimationFrame(animate)
    }
    rafId = window.requestAnimationFrame(animate)
    return () => window.cancelAnimationFrame(rafId)
  }, [stress])

  useEffect(() => {
    breakActiveRef.current = breakActive
  }, [breakActive])

  useEffect(() => {
    breathingActiveRef.current = breathingActive
  }, [breathingActive])

  useEffect(() => {
    latestResultRef.current = result
  }, [result])

  useEffect(() => {
    breathingUseHrSensingRef.current = breathingUseHrSensing
  }, [breathingUseHrSensing])

  useEffect(() => {
    if (!breathingActive) return
    const timeout = window.setTimeout(() => {
      if (breathingRemainingMs > 100) {
        setBreathingRemainingMs((v) => v - 100)
        return
      }

      const nextPhase = (breathingPhaseIndex + 1) % activePattern.phases.length
      const wrapped = nextPhase === 0
      const nextCycle = wrapped ? breathingCycle + 1 : breathingCycle
      if (nextCycle > activePattern.cycles) {
        void stopBreathing()
        return
      }
      setBreathingPhaseIndex(nextPhase)
      setBreathingRemainingMs(activePattern.phases[nextPhase].seconds * 1000)
      if (wrapped) setBreathingCycle(nextCycle)
    }, 100)
    return () => window.clearTimeout(timeout)
  }, [activePattern, breathingActive, breathingCycle, breathingPhaseIndex, breathingRemainingMs, stopBreathing])

  useEffect(() => {
    if (!breathingSummary) return
    const timeout = window.setTimeout(() => setBreathingSummary(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [breathingSummary])

  useEffect(() => {
    if (!breathingActive || !breathingUseHrSensing) return
    let unlistenUpdate: (() => void) | null = null
    let unlistenEnded: (() => void) | null = null

    const setup = async () => {
      await invoke('start_hr_stream', { updateEvery: 4, windowSeconds: 20, maxSeconds: 0 })
      unlistenUpdate = await listen<HrStreamUpdate>('hr-stream-update', (event) => {
        const bpm = event.payload?.heart_rate_bpm ?? null
        setBreathingLiveHr(bpm)
        setBreathingStartHr((prev) => prev ?? bpm)
      })
      unlistenEnded = await listen('hr-stream-ended', () => {
        // silent by design
      })
    }

    void setup()
    return () => {
      unlistenUpdate?.()
      unlistenEnded?.()
      void invoke('stop_hr_stream').catch(() => null)
    }
  }, [breathingActive, breathingUseHrSensing])

  useEffect(() => {
    if (!breakActive) return
    const timer = window.setInterval(() => {
      setBreakRemainingSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer)
          setBreakActive(false)
          void finishBreakRef.current('complete')
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [breakActive])

  useEffect(() => {
    if (!breakActive || !breakUseGenuinityChecks) return
    const poll = window.setInterval(async () => {
      try {
        const payload = await invoke<{ presence_detected: boolean }>('run_presence_check')
        if (!payload?.presence_detected) {
          setBreakAwaySeconds((v) => v + 10)
        }
      } catch {
        // Silent by design: break should continue even if camera check fails.
      }
    }, 10_000)
    return () => window.clearInterval(poll)
  }, [breakActive, breakUseGenuinityChecks])

  useEffect(() => {
    if (!breakActive || !breakUseGenuinityChecks) return
    const elapsed = Math.max(0, breakTargetSec - breakRemainingSec)
    if (elapsed >= 120 && !breakReminderTwoSentRef.current && breakAwaySeconds < Math.floor(elapsed * 0.4)) {
      breakReminderTwoSentRef.current = true
      setBreakSummary('Gentle reminder: try stepping away from your desk.')
    }
    if (elapsed >= 240 && !breakReminderFourSentRef.current && breakAwaySeconds < Math.floor(elapsed * 0.5)) {
      breakReminderFourSentRef.current = true
      setBreakSummary('Stronger reminder: this break only works if you leave the screen.')
    }
  }, [breakActive, breakAwaySeconds, breakRemainingSec, breakTargetSec, breakUseGenuinityChecks])

  useEffect(() => {
    if (!breakSummary) return
    const timeout = window.setTimeout(() => setBreakSummary(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [breakSummary])

  const updateNudgeFromResult = useCallback((session: SessionResult) => {
    if (session.posture_score < 0.45 || session.posture_is_poor) {
      setLastNudge('Straighten up and roll your shoulders back.')
      return
    }
    const stressScore = stressIndex(session)
    if (stressScore >= 61) {
      setLastNudge('Take a 5 minute break. Step away for a reset.')
      return
    }
    if (stressScore >= 31) {
      setLastNudge('You have been focused for a while. Grab some water.')
      return
    }
    setLastNudge('No nudge needed. You are in a good range.')
  }, [])

  const normalizeFocusStreamResult = useCallback((payload: Record<string, unknown>): SessionResult => {
    const presenceDetected = Boolean(payload.presence_detected)
    const analysisSkipped = Boolean(payload.analysis_skipped) || !presenceDetected
    const postureScore = Number(payload.posture_score ?? 0)
    const baselinePostureScore = Number(payload.baseline_posture_score ?? 0) || 0
    const postureDeviation = Number(payload.posture_deviation ?? 0) || 0
    const elapsedSeconds = Number(payload.elapsed_seconds ?? 0)
    const stressIndexValue =
      typeof payload.stress_index_smoothed === 'number'
        ? payload.stress_index_smoothed
        : typeof payload.stress_index === 'number'
          ? payload.stress_index
          : undefined
    return {
      timestamp: String(payload.timestamp ?? new Date().toISOString()),
      focus_session_id:
        payload.focus_session_id == null ? null : String(payload.focus_session_id),
      presence_detected: presenceDetected,
      analysis_skipped: analysisSkipped,
      posture_score: Number.isFinite(postureScore) ? postureScore : 0,
      baseline_posture_score: baselinePostureScore,
      posture_deviation: postureDeviation,
      posture_is_poor:
        typeof payload.posture_is_poor === 'boolean'
          ? payload.posture_is_poor
          : Number.isFinite(postureScore)
            ? postureScore < 0.45
            : false,
      dominant_emotion: String(payload.dominant_emotion ?? 'unknown'),
      emotion_score: Number(payload.emotion_score ?? 0) || 0,
      stress_index: stressIndexValue,
      heart_rate_bpm: payload.heart_rate_bpm == null ? null : Number(payload.heart_rate_bpm),
      respiratory_rate: Number(payload.respiratory_rate ?? 0) || 0,
      rr_confidence:
        payload.rr_confidence === 'full' || payload.rr_confidence === 'partial' ? payload.rr_confidence : 'none',
      resting_hr: payload.resting_hr == null ? null : Number(payload.resting_hr),
      resting_rr: payload.resting_rr == null ? null : Number(payload.resting_rr),
      emotion_backend: 'fer',
      mode: 'focus',
      focus_duration_seconds: Math.max(0, Math.round(Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0)),
      session_id: null,
      session_skipped: analysisSkipped,
      session_duration_seconds: Math.max(0, Number.isFinite(elapsedSeconds) ? elapsedSeconds : 0),
    }
  }, [])

  const mergeStreamResult = useCallback((next: SessionResult): SessionResult => {
    const previous = latestResultRef.current
    if (!previous || previous.mode !== 'focus') {
      return next
    }

    const heartRate =
      next.heart_rate_bpm == null && previous.heart_rate_bpm != null ? previous.heart_rate_bpm : next.heart_rate_bpm
    const rrScore =
      next.respiratory_rate <= 0 && previous.respiratory_rate > 0 ? previous.respiratory_rate : next.respiratory_rate
    const rrConfidence =
      next.rr_confidence === 'none' && rrScore > 0 && previous.rr_confidence !== 'none'
        ? previous.rr_confidence
        : next.rr_confidence

    return {
      ...next,
      heart_rate_bpm: heartRate,
      respiratory_rate: rrScore,
      rr_confidence: rrConfidence,
    }
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const payload = await invoke<{ items: SessionHistoryItem[] }>('run_session_history')
      const items = payload.items ?? []
      setHistory(items)
      if (items.length > 0) {
        const latest = sessionFromHistory(items[0])
        if (!(settings?.focus_mode_active ?? false)) {
          setResult(latest)
          updateNudgeFromResult(latest)
        }
      } else {
        if (!(settings?.focus_mode_active ?? false)) {
          setResult(null)
        }
      }
    } catch {
      setHistory([])
      if (!(settings?.focus_mode_active ?? false)) {
        setResult(null)
      }
    }
  }, [settings?.focus_mode_active, updateNudgeFromResult])

  const loadDailyReport = useCallback(async () => {
    try {
      const payload = await invoke<DailyReport>('run_daily_report')
      setDailyReport(payload)
    } catch {
      setDailyReport(null)
    }
  }, [])

  const loadCalibrationStatus = useCallback(async () => {
    try {
      const payload = await invoke<CalibrationStatus>('run_calibration_status')
      setCalibration(payload)
    } catch {
      setCalibration(null)
    }
  }, [])

  const loadSettings = useCallback(async () => {
    try {
      const payload = await invoke<AppSettings>('run_get_settings')
      setSettings(payload)
      if (!payload.onboarding_completed) setShowOnboarding(true)
    } catch {
      setSettings(null)
    }
  }, [])

  async function updateSettings(patch: Partial<AppSettings>) {
    try {
      const payload = await invoke<AppSettings>('run_update_settings', { patch })
      setSettings(payload)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function toggleFocusMode() {
    await updateSettings({ focus_mode_active: !settings?.focus_mode_active })
  }

  const startBreathing = useCallback(
    (triggeredBy: 'manual' | 'auto' = 'manual') => {
      setBreathingActive(true)
      setBreathingTriggeredBy(triggeredBy)
      setBreathingPhaseIndex(0)
      setBreathingRemainingMs(activePattern.phases[0].seconds * 1000)
      setBreathingCycle(1)
      const snapshot = latestResultRef.current
      setBreathingStartHr(breathingUseHrSensingRef.current ? null : (snapshot?.heart_rate_bpm ?? null))
      setBreathingStartRr(snapshot?.respiratory_rate && snapshot.respiratory_rate > 0 ? snapshot.respiratory_rate : null)
      setBreathingLiveHr(null)
      setBreathingSummary(null)
      setShowQuickActions(false)
    },
    [activePattern.phases],
  )

  useEffect(() => {
    if (!settings?.focus_mode_active) {
      void invoke('stop_focus_stream').catch(() => null)
      return
    }

    let unlistenUpdate: (() => void) | null = null
    let unlistenEnded: (() => void) | null = null
    let cancelled = false

    const setup = async () => {
      await invoke('start_focus_stream', { updateEvery: 60, maxSeconds: 0 })
      if (cancelled) return
      unlistenUpdate = await listen<Record<string, unknown>>('focus-stream-update', (event) => {
        const session = mergeStreamResult(normalizeFocusStreamResult(event.payload))
        const smoothedStress =
          typeof event.payload?.stress_index_smoothed === 'number'
            ? event.payload.stress_index_smoothed
            : stressIndex(session)
        if (session.session_skipped || !session.presence_detected) {
          setLastNudge('No face detected, focus stream waiting.')
          setStatus('Done')
          return
        }
        setResult(session)
        updateNudgeFromResult(session)
        setLastRunSource('focus-mode')
        setStatus('Done')
        setError(null)

        if (!breathingActiveRef.current && !breakActiveRef.current && smoothedStress > 60) {
          setLastNudge('Elevated stress detected during focus mode. Starting breathing exercise.')
          startBreathing('auto')
        }
      })
      unlistenEnded = await listen('focus-stream-ended', () => {
        // Silent by design.
      })
    }

    void setup()
    return () => {
      cancelled = true
      unlistenUpdate?.()
      unlistenEnded?.()
      void invoke('stop_focus_stream').catch(() => null)
    }
  }, [mergeStreamResult, normalizeFocusStreamResult, settings?.focus_mode_active, startBreathing, updateNudgeFromResult])

  async function completeOnboarding() {
    await updateSettings({ onboarding_completed: true })
    setShowOnboarding(false)
  }

  const startBreak = useCallback((durationSec = 5 * 60) => {
    const target = Math.max(60, durationSec)
    setBreakActive(true)
    breakReminderTwoSentRef.current = false
    breakReminderFourSentRef.current = false
    setBreakTargetSec(target)
    setBreakRemainingSec(target)
    setBreakAwaySeconds(0)
    setBreakSummary(null)
  }, [])

  const finishBreak = useCallback(
    async (reason: 'complete' | 'early') => {
      const elapsedRatio = breakTargetSec <= 0 ? 0 : (breakTargetSec - breakRemainingSec) / breakTargetSec
      const presenceBased =
        breakTargetSec <= 0 ? 0 : Math.max(0, Math.min(100, Math.round((breakAwaySeconds / breakTargetSec) * 100)))
      const durationBased = Math.max(0, Math.min(100, Math.round(elapsedRatio * 100)))
      const qualityScore = breakUseGenuinityChecks ? presenceBased : durationBased
      const genuineBreak = breakUseGenuinityChecks ? qualityScore >= 60 : reason === 'complete'
      try {
        await invoke('run_log_break_session', {
          breakSeconds: breakTargetSec,
          awaySeconds: breakAwaySeconds,
          qualityScore,
          genuineBreak,
          triggeredBy: 'manual',
        })
      } catch {
        // Silent fallback.
      }
      if (reason === 'complete') {
        setBreakSummary(`${genuineBreak ? 'Genuine break.' : 'Mostly at desk.'} Score ${qualityScore}.`)
      } else {
        setBreakSummary(`Break ended early. Score ${qualityScore}.`)
      }
    },
    [breakAwaySeconds, breakRemainingSec, breakTargetSec, breakUseGenuinityChecks],
  )

  useEffect(() => {
    finishBreakRef.current = finishBreak
  }, [finishBreak])

  function stopBreak() {
    setBreakActive(false)
    void finishBreak('early')
  }

  async function clearAllData() {
    await invoke('run_clear_data')
    await loadHistory()
    await loadDailyReport()
    await loadCalibrationStatus()
    setResult(null)
  }

  function handleHeaderMouseDown(event: MouseEvent<HTMLElement>) {
    const target = event.target as HTMLElement
    if (target.closest('button, a, input, select, textarea')) return
    void getCurrentWindow().startDragging()
  }

  async function closeWindow(event?: { preventDefault?: () => void; stopPropagation?: () => void }) {
    event?.preventDefault?.()
    event?.stopPropagation?.()
    try {
      // Prefer a dedicated Rust command — more reliable than the JS window plugin ACL alone.
      await invoke('hide_window')
      return
    } catch {
      // Fall through to the window API.
    }
    try {
      await getCurrentWindow().hide()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  function clearCheckInProgressTimer() {
    if (checkInProgressTimerRef.current != null) {
      window.clearInterval(checkInProgressTimerRef.current)
      checkInProgressTimerRef.current = null
    }
  }

  function applyCheckInResult(payload: SessionResult, source: 'manual' | 'scheduler' | 'focus-mode' = 'manual') {
    if (payload.session_skipped || !payload.presence_detected) {
      setLastNudge('No face detected, skipped this check-in.')
      setCheckInMessage('No face detected — try again when you are in frame.')
      setStatus('Done')
      window.setTimeout(() => {
        if (statusRef.current === 'Done') setCheckInMessage(null)
      }, 3200)
      return
    }
    // Ensure stress_index is populated for display even if the sidecar omitted it.
    const stressValue = stressIndex(payload)
    const enriched: SessionResult = {
      ...payload,
      stress_index: stressValue,
    }
    setResult(enriched)
    latestResultRef.current = enriched
    updateNudgeFromResult(enriched)
    setLastRunSource(source)
    setStatus('Done')
    const hrText =
      typeof enriched.heart_rate_bpm === 'number' && enriched.heart_rate_bpm > 0
        ? ` · HR ${Math.round(enriched.heart_rate_bpm)}`
        : ''
    setCheckInMessage(
      `Check-in complete · stress ${stressValue} · posture ${friendlyPosture(enriched.posture_score)}${hrText}`,
    )
    void loadHistory()
    void loadDailyReport()
    void loadCalibrationStatus()
    window.setTimeout(() => {
      if (statusRef.current === 'Done') setCheckInMessage(null)
    }, 5000)
  }

  async function runSession() {
    if (status === 'Running') return
    clearCheckInProgressTimer()
    try {
      setStatus('Running')
      setError(null)
      setCheckInMessage('Opening camera…')
      setShowQuickActions(false)
      setQuickActionStep('menu')

      // Progressive status so capture doesn't feel frozen (presence waits for frames first).
      const startedAt = Date.now()
      checkInProgressTimerRef.current = window.setInterval(() => {
        const elapsed = Math.floor((Date.now() - startedAt) / 1000)
        if (elapsed < 3) setCheckInMessage('Opening camera…')
        else if (elapsed < 8) setCheckInMessage('Looking for your face…')
        else if (elapsed < 15) setCheckInMessage(`Capturing posture & vitals… ${elapsed}s`)
        else setCheckInMessage(`Wrapping up… ${elapsed}s`)
      }, 400)

      // Best-effort: stop live streams from this window too (Rust also does this).
      await Promise.allSettled([
        invoke('stop_posture_stream'),
        invoke('stop_hr_stream'),
        invoke('stop_focus_stream'),
      ])

      const payload = await invoke<SessionResult>('run_python_session')
      clearCheckInProgressTimer()
      applyCheckInResult(payload, 'manual')
      await loadSettings()
    } catch (e) {
      clearCheckInProgressTimer()
      setStatus('Error')
      const message = e instanceof Error ? e.message : String(e)
      setError(message)
      const friendly = message.includes('already running')
        ? 'A check-in is already in progress. Wait a moment and try again.'
        : 'Check-in failed. Check camera permissions and try again.'
      setCheckInMessage(friendly)
      window.setTimeout(() => {
        if (statusRef.current === 'Error') setCheckInMessage(null)
      }, 4200)
    }
  }

  useEffect(() => {
    let unlistenResult: (() => void) | null = null
    let unlistenError: (() => void) | null = null
    let unlistenSkip: (() => void) | null = null
    let unlistenGesture: (() => void) | null = null
    let unlistenBreakAuto: (() => void) | null = null

    const setup = async () => {
      await loadHistory()
      await loadDailyReport()
      await loadCalibrationStatus()
      await loadSettings()

      // If we reopened mid-check-in (or after it finished while hidden), resync from DB.
      if (statusRef.current === 'Running' || statusRef.current === 'Done') {
        await loadHistory()
      }

      unlistenResult = await listen<{ source: string; result: SessionResult }>('session-result', (event) => {
        clearCheckInProgressTimer()
        const source =
          event.payload.source === 'focus-mode'
            ? 'focus-mode'
            : event.payload.source === 'manual'
              ? 'manual'
              : 'scheduler'
        applyCheckInResult(event.payload.result, source)
        setError(null)
        if (
          source === 'focus-mode' &&
          !breathingActiveRef.current &&
          !breakActiveRef.current &&
          stressIndex(event.payload.result) > 60
        ) {
          setLastNudge('Elevated stress detected during focus mode. Starting breathing exercise.')
          startBreathing('auto')
        }
      })

      unlistenError = await listen<{ error: string }>('session-error', (event) => {
        clearCheckInProgressTimer()
        setStatus('Error')
        setError(event.payload.error)
        setCheckInMessage('Check-in failed. Check camera permissions and try again.')
        window.setTimeout(() => {
          if (statusRef.current === 'Error') setCheckInMessage(null)
        }, 4200)
      })

      unlistenSkip = await listen('scheduler-skip', () => {
        setLastNudge('Skipped a run because another session was still in progress.')
      })

      unlistenGesture = await listen<{ snooze_minutes: number }>('gesture-dismissed', (event) => {
        setLastNudge(`Gesture dismiss detected. Nudges snoozed for ${event.payload.snooze_minutes} minutes.`)
      })

      unlistenBreakAuto = await listen<{ break_seconds: number; elapsed_minutes: number }>(
        'break-auto-trigger',
        (event) => {
          if (breakActiveRef.current) return
          startBreak(event.payload?.break_seconds ?? 300)
          setBreakSummary(`Auto break after ${event.payload?.elapsed_minutes ?? 90}m focus.`)
        },
      )
    }

    void setup()
    return () => {
      unlistenResult?.()
      unlistenError?.()
      unlistenSkip?.()
      unlistenGesture?.()
      unlistenBreakAuto?.()
    }
  }, [
    loadCalibrationStatus,
    loadDailyReport,
    loadHistory,
    loadSettings,
    startBreathing,
    startBreak,
    updateNudgeFromResult,
  ])

  // Tag document so CSS can use transparent chrome for the menubar popover only.
  useEffect(() => {
    const label = isMainWindow ? 'main-window' : 'main'
    document.documentElement.dataset.window = label
    document.body.dataset.window = label
  }, [isMainWindow])

  // When the menubar popover is shown again, resync latest sessions so check-in
  // results completed while hidden are visible immediately.
  useEffect(() => {
    if (!isPopoverWindow) return
    let unlisten: (() => void) | undefined
    void getCurrentWindow()
      .onFocusChanged(({ payload: focused }) => {
        if (!focused) return
        void loadHistory()
        void loadDailyReport()
        void loadCalibrationStatus()
      })
      .then((fn) => {
        unlisten = fn
      })
    return () => {
      unlisten?.()
    }
  }, [isPopoverWindow, loadHistory, loadDailyReport, loadCalibrationStatus])

  // Recover from a stale "Running" UI if the backend finished while we were hidden.
  useEffect(() => {
    if (status !== 'Running') return
    const timer = window.setTimeout(() => {
      void loadHistory().then(() => {
        // If still marked running after a long wait, soft-reset so the user can retry.
        if (statusRef.current === 'Running') {
          setStatus('Idle')
          setCheckInMessage('Previous check-in finished. Tap Check in to run again.')
          window.setTimeout(() => {
            if (statusRef.current === 'Idle') setCheckInMessage(null)
          }, 3500)
        }
      })
    }, 45_000)
    return () => window.clearTimeout(timer)
  }, [status, loadHistory])

  return (
    <AppSettingsProvider value={{ settings, updateSettings }}>
      {isMainWindow ? (
        <MainWindowShell
          history={history}
          dailyReport={dailyReport}
          calibration={calibration}
          lastRunSource={lastRunSource}
          error={error}
          replayOnboarding={() => setShowOnboarding(true)}
          clearAllData={clearAllData}
          onRunCheckIn={runSession}
          isCheckInRunning={status === 'Running'}
          checkInMessage={checkInMessage}
          showOnboarding={showOnboarding}
          onDismissOnboarding={() => setShowOnboarding(false)}
          onCompleteOnboarding={() => void completeOnboarding()}
          currentResult={result}
        />
      ) : (
        <main className="popover">
          <AnimatePresence>
            {showOnboarding && (
              <motion.div className="overlay" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <motion.section
                  className="onboarding"
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                >
                  <h2>Welcome to Zeno</h2>
                  <p>Zeno runs quietly in your menubar and checks your posture and stress privately on-device.</p>
                  <ol>
                    <li>
                      Use <strong>Check In</strong> for an immediate snapshot.
                    </li>
                    <li>First 3 sessions establish your personal baseline.</li>
                    <li>
                      Open <strong>View report</strong> to see daily trends.
                    </li>
                  </ol>
                  <div className="row-end">
                    <button className="btn-ghost" onClick={() => setShowOnboarding(false)}>
                      Later
                    </button>
                    <button className="btn-solid" onClick={completeOnboarding}>
                      Got it
                    </button>
                  </div>
                </motion.section>
              </motion.div>
            )}
          </AnimatePresence>

          <header className="headerbar" onMouseDown={handleHeaderMouseDown}>
            <div className="brand">
              <span
                className={`dot dot--${settings?.monitoring_paused ? 'paused' : status === 'Running' ? 'capturing' : 'active'}`}
              />
              <h1>zeno</h1>
            </div>
            <div className="header-actions">
              {activePage === 'home' ? (
                <button className="icon-btn" onClick={() => void openMainWindow()}>
                  Open app
                </button>
              ) : (
                <button className="icon-btn" onClick={() => setActivePage('home')}>
                  Back
                </button>
              )}
              <button
                type="button"
                className="icon-btn icon-btn-close"
                aria-label="Close window"
                title="Close"
                onPointerDown={(event) => {
                  // Close on pointerdown so header drag / focus loss can't steal the gesture.
                  event.preventDefault()
                  event.stopPropagation()
                  void closeWindow(event)
                }}
                onClick={(event) => {
                  // Fallback if pointerdown was cancelled by the OS.
                  event.preventDefault()
                  event.stopPropagation()
                  void closeWindow(event)
                }}
              >
                ×
              </button>
            </div>
          </header>
          <ScrollArea useOverlayScrollbars={isMainWindow} overlayScrollbarOptions={overlayScrollbarOptions}>
            <AnimatePresence initial={false}>
              {breakSummary && activePage === 'home' && (
                <motion.section
                  className="breathing-summary"
                  variants={fadeSlide}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <p className="label">Break</p>
                  <p>{breakSummary}</p>
                </motion.section>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {breakActive && activePage === 'home' && (
                <motion.section
                  className="breathing-panel"
                  variants={fadeSlide}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <div className="breathing-head">
                    <p className="label">Break timer</p>
                    <button className="icon-btn" onClick={stopBreak}>
                      Stop
                    </button>
                  </div>
                  <p className="breathing-hr">
                    {String(breakMinutes).padStart(2, '0')}:{String(breakSeconds).padStart(2, '0')}
                  </p>
                  <p className="breathing-countdown">
                    {breakUseGenuinityChecks
                      ? `away ${breakAwaySeconds}s / ${breakTargetSec}s`
                      : 'genuinity checks off'}
                  </p>
                  <p className="breathing-cycle">Step away from the screen for a few minutes.</p>
                </motion.section>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {breathingSummary && activePage === 'home' && (
                <motion.section
                  className="breathing-summary"
                  variants={fadeSlide}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <p className="label">Done</p>
                  <p className={`breathing-summary-row breathing-summary-row--${breathingSummary.hrTone}`}>
                    {breathingSummary.hrText}
                  </p>
                  <p className={`breathing-summary-row breathing-summary-row--${breathingSummary.rrTone}`}>
                    {breathingSummary.rrText}
                  </p>
                </motion.section>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false}>
              {breathingActive && activePage === 'home' && !breakActive && (
                <motion.section
                  className="breathing-panel"
                  variants={fadeSlide}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  <div className="breathing-head">
                    <p className="label">{activePattern.name}</p>
                    <button className="icon-btn" onClick={() => void stopBreathing()}>
                      Stop
                    </button>
                  </div>
                  <p className="breathing-hr">
                    {(breathingUseHrSensing ? breathingLiveHr : result?.heart_rate_bpm) == null
                      ? '--'
                      : Math.round((breathingUseHrSensing ? breathingLiveHr : result?.heart_rate_bpm) as number)}{' '}
                    <span>bpm</span>
                  </p>
                  <div className={`breathing-circle ${breathingPhase.label.toLowerCase()}`}>
                    <span>{breathingPhase.label}</span>
                  </div>
                  <p className="breathing-countdown">{breathingRemainingSeconds}s</p>
                  <p className="breathing-cycle">
                    Cycle {breathingCycle} of {activePattern.cycles}
                  </p>
                </motion.section>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait" initial={false}>
              {activePage === 'home' && !breathingActive && !breakActive && (
                <motion.div key="popover-home" variants={fadeSlide} initial="hidden" animate="visible" exit="exit">
                  <section className="stress-card">
                    <p className="label">stress index</p>
                    <div className={`stress-value stress-value--${stressLabel}`}>{Math.round(displayedStress)}</div>
                    <p className="stress-sub">{stressLabel}</p>
                    <div className="stress-bar">
                      <div className={`stress-fill stress-fill--${stressLabel}`} style={{ width: stressFill }} />
                    </div>
                  </section>

                  <div className="divider" />

                  <section className="stats-row">
                    <article className="stat-cell">
                      <span className="stat-value">
                        {result?.heart_rate_bpm == null ? '--' : `${result.heart_rate_bpm}`}
                      </span>
                      <span className="stat-label">{`hr ${result?.heart_rate_bpm == null ? '--' : 'bpm'} · rr ${rrDisplay}`}</span>
                    </article>
                    <article className="stat-cell">
                      <span className="stat-value">{sessionCountToday}</span>
                      <span className="stat-label">sessions today</span>
                    </article>
                    <article className="stat-cell">
                      <span className="stat-value">{friendlyPosture(result?.posture_score ?? 0)}</span>
                      <span className="stat-label">posture</span>
                    </article>
                  </section>

                  <div className="divider" />

                  <section className={`nudge-row nudge-row--${stressLabel}`}>
                    <p className="label">last nudge</p>
                    <p className="nudge-msg">{lastNudge}</p>
                    <p className="nudge-time">{result ? prettyTime(result.timestamp) : '--:--'}</p>
                  </section>
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence mode="wait" initial={false}>
              {activePage === 'report' && (
                <motion.section
                  key="popover-report"
                  className="report-panel report-page"
                  variants={fadeSlide}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  {dailyReport ? (
                    <>
                      <h3>
                        {new Date(dailyReport.date).toLocaleDateString([], {
                          weekday: 'long',
                          month: 'long',
                          day: 'numeric',
                        })}
                      </h3>
                      <div className="report-kpis">
                        <span>Avg stress {dailyReport.average_stress_index}</span>
                        <span>
                          Avg RR{' '}
                          {dailyReport.average_respiratory_rate == null
                            ? '--'
                            : `${dailyReport.average_respiratory_rate} bpm`}
                        </span>
                        <span>Focused {dailyReport.focused_minutes} min</span>
                        <span>{dailyReport.sessions} sessions</span>
                      </div>
                      <div className="chart-wrap">
                        <p>Posture trend</p>
                        <div className="chart-stats">
                          <span>Now {postureStats.latest}</span>
                          <span>Low {postureStats.low}</span>
                          <span>High {postureStats.high}</span>
                        </div>
                        <svg viewBox="0 0 260 74" preserveAspectRatio="none">
                          <path className="line-posture" d={sparklinePath(postureTrend, 260, 74)} />
                          {postureTrendPoints.map((point, index) => (
                            <circle
                              key={`${point.time}-posture`}
                              className="trend-dot trend-dot--posture"
                              cx={
                                postureTrendPoints.length === 1 ? 130 : (index * 260) / (postureTrendPoints.length - 1)
                              }
                              cy={pointY(point.value, 74)}
                              r="2.2"
                            >
                              <title>{`${new Date(point.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} • posture ${point.value}`}</title>
                            </circle>
                          ))}
                        </svg>
                      </div>
                      <div className="chart-wrap">
                        <p>Stress trend</p>
                        <div className="chart-stats">
                          <span>Now {stressStats.latest}</span>
                          <span>Low {stressStats.low}</span>
                          <span>High {stressStats.high}</span>
                        </div>
                        <svg viewBox="0 0 260 74" preserveAspectRatio="none">
                          <path className="line-stress" d={sparklinePath(stressTrend, 260, 74)} />
                          {rrTrendPoints.length > 1 && (
                            <path
                              className="line-rr"
                              d={sparklinePath(
                                rrTrendPoints.map((point) => point.value),
                                260,
                                74,
                              )}
                            />
                          )}
                          {stressTrendPoints.map((point, index) => (
                            <circle
                              key={`${point.time}-stress`}
                              className="trend-dot trend-dot--stress"
                              cx={stressTrendPoints.length === 1 ? 130 : (index * 260) / (stressTrendPoints.length - 1)}
                              cy={pointY(point.value, 74)}
                              r="2.2"
                            >
                              <title>{`${new Date(point.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} • stress ${point.value}`}</title>
                            </circle>
                          ))}
                          {rrTrendPoints.map((point, index) => (
                            <circle
                              key={`${point.time}-rr`}
                              className="trend-dot trend-dot--rr"
                              cx={rrTrendPoints.length === 1 ? 130 : (index * 260) / (rrTrendPoints.length - 1)}
                              cy={pointY(point.value, 74)}
                              r="2.0"
                            >
                              <title>{`${new Date(point.time).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })} • rr ${point.bpm} bpm`}</title>
                            </circle>
                          ))}
                        </svg>
                      </div>
                      <p className="recommendation">{dailyReport.recommendation}</p>
                    </>
                  ) : (
                    <p className="recommendation">No report yet. Run a check in first.</p>
                  )}

                  <div className="history-block">
                    <p className="label">recent sessions</p>
                    {history.length === 0 ? (
                      <p className="recommendation">No historical sessions found in local database.</p>
                    ) : (
                      <ul className="history-list">
                        {history.slice(0, 12).map((item) => (
                          <li className="history-item" key={item.id}>
                            <span className="history-time">
                              {new Date(item.created_at).toLocaleString([], {
                                month: 'short',
                                day: 'numeric',
                                hour: 'numeric',
                                minute: '2-digit',
                              })}
                            </span>
                            <span className="history-pill">S {stressIndexFromHistory(item)}</span>
                            <span className="history-pill">P {friendlyPosture(item.posture_score)}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </motion.section>
              )}
            </AnimatePresence>
          </ScrollArea>

          <div className={`popover-bottom-stack ${showQuickActions ? 'has-panel' : ''}`}>
            <AnimatePresence initial={false} mode="popLayout">
              {showQuickActions && activePage === 'home' && !breathingActive && !breakActive && (
                <motion.div
                  key="quick-actions"
                  className="quick-actions-slot"
                  initial={{ opacity: 0, y: 10, height: 0 }}
                  animate={{ opacity: 1, y: 0, height: 'auto' }}
                  exit={{ opacity: 0, y: 8, height: 0 }}
                  transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                >
                  <QuickActionsPopover
                    quickActionStep={quickActionStep}
                    setQuickActionStep={setQuickActionStep}
                    breathingPattern={breathingPattern}
                    setBreathingPattern={setBreathingPattern}
                    breathingUseHrSensing={breathingUseHrSensing}
                    setBreathingUseHrSensing={setBreathingUseHrSensing}
                    breakUseGenuinityChecks={breakUseGenuinityChecks}
                    setBreakUseGenuinityChecks={setBreakUseGenuinityChecks}
                    breakPlannedMinutes={breakPlannedMinutes}
                    setBreakPlannedMinutes={setBreakPlannedMinutes}
                    onStartBreathing={() => {
                      setShowQuickActions(false)
                      setQuickActionStep('menu')
                      startBreathing()
                    }}
                    onStartBreak={(seconds) => {
                      setShowQuickActions(false)
                      setQuickActionStep('menu')
                      startBreak(seconds)
                    }}
                    onClose={() => {
                      setShowQuickActions(false)
                      setQuickActionStep('menu')
                    }}
                  />
                </motion.div>
              )}
            </AnimatePresence>

            <AnimatePresence initial={false} mode="popLayout">
              {activePage === 'home' && !breathingActive && !breakActive && !showQuickActions && (
                <motion.div
                  key="checkin-slot"
                  className="checkin-slot"
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 6 }}
                  transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
                >
                  {checkInMessage && (
                    <motion.p
                      className={`checkin-toast ${status === 'Error' ? 'is-error' : status === 'Running' ? 'is-running' : 'is-done'}`}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                    >
                      {checkInMessage}
                    </motion.p>
                  )}
                  <button
                    className={`checkin-fab ${status === 'Running' ? 'is-running' : ''}`}
                    onClick={() => void runSession()}
                    disabled={!canRun || breakActive}
                    aria-busy={status === 'Running'}
                  >
                    {status === 'Running' ? (
                      <>
                        <span className="checkin-spinner" aria-hidden />
                        Checking in…
                      </>
                    ) : (
                      'Check in'
                    )}
                  </button>
                </motion.div>
              )}
            </AnimatePresence>

            <footer className="footerbar">
              {activePage === 'home' ? (
                <button
                  className="icon-action-btn"
                  onClick={() => setActivePage('report')}
                  aria-label="Open report"
                  title="Report"
                >
                  <ChartNoAxesCombined className="icon-action-svg" aria-hidden="true" strokeWidth={2.25} />
                </button>
              ) : (
                <button
                  className="icon-action-btn"
                  onClick={() => setActivePage('home')}
                  aria-label="Go to home"
                  title="Home"
                >
                  <House className="icon-action-svg" aria-hidden="true" strokeWidth={2.25} />
                </button>
              )}
              <button
                className="icon-action-btn"
                onClick={() => void openMainWindow()}
                aria-label="Open main app window"
                title="Open app"
              >
                <ArrowUpRight className="icon-action-svg" aria-hidden="true" strokeWidth={2.25} />
              </button>
              {activePage === 'home' && !breathingActive && !breakActive && (
                <button
                  className={`icon-action-btn ${showQuickActions ? 'is-active' : ''}`}
                  onClick={() =>
                    setShowQuickActions((v) => {
                      const next = !v
                      if (next) setQuickActionStep('menu')
                      return next
                    })
                  }
                  aria-label="Open quick actions"
                  title="Actions"
                  aria-pressed={showQuickActions}
                >
                  <Ellipsis className="icon-action-svg" aria-hidden="true" strokeWidth={2.25} />
                  <span className="sr-only">Actions</span>
                </button>
              )}
              {activePage === 'home' && breathingActive && (
                <button className="report-link" onClick={() => void stopBreathing()}>
                  Stop
                </button>
              )}
              {activePage === 'home' && breakActive && (
                <button className="report-link" onClick={stopBreak}>
                  End break
                </button>
              )}
              <div className="toggle-wrap">
                <button
                  className={`focus-toggle ${settings?.focus_mode_active ? 'is-on' : 'is-off'}`}
                  onClick={toggleFocusMode}
                >
                  {settings?.focus_mode_active ? 'Focus on' : 'Focus off'}
                </button>
                <span>Pause</span>
                <button
                  className={`toggle ${settings?.monitoring_paused ? 'is-paused' : 'is-active'}`}
                  onClick={() => updateSettings({ monitoring_paused: !settings?.monitoring_paused })}
                  aria-label="Toggle monitoring"
                >
                  <span className="knob" />
                </button>
              </div>
            </footer>
          </div>
        </main>
      )}
    </AppSettingsProvider>
  )
}

export default App
