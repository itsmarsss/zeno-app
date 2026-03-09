import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
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

function App() {
  const isMainWindow = getCurrentWindow().label === 'main-window'
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
  const [status, setStatus] = useState<'Idle' | 'Running' | 'Done' | 'Error'>('Idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SessionResult | null>(null)
  const [history, setHistory] = useState<SessionHistoryItem[]>([])
  const [dailyReport, setDailyReport] = useState<DailyReport | null>(null)
  const [calibration, setCalibration] = useState<CalibrationStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [activePage, setActivePage] = useState<'home' | 'report'>('home')
  const [lastNudge, setLastNudge] = useState('No nudges yet.')
  const [lastRunSource, setLastRunSource] = useState<'manual' | 'scheduler' | 'focus-mode' | null>(null)
  const [displayedStress, setDisplayedStress] = useState(0)
  const [breathingActive, setBreathingActive] = useState(false)
  const [breathingPattern, setBreathingPattern] = useState<BreathingPatternId>('box')
  const [breathingPhaseIndex, setBreathingPhaseIndex] = useState(0)
  const [breathingRemainingMs, setBreathingRemainingMs] = useState(BREATHING_PATTERNS.box.phases[0].seconds * 1000)
  const [breathingCycle, setBreathingCycle] = useState(1)
  const [breathingStartHr, setBreathingStartHr] = useState<number | null>(null)
  const [breathingTriggeredBy, setBreathingTriggeredBy] = useState<'manual' | 'auto'>('manual')
  const [breathingSummary, setBreathingSummary] = useState<string | null>(null)
  const [breakActive, setBreakActive] = useState(false)
  const [breakRemainingSec, setBreakRemainingSec] = useState(5 * 60)
  const [breakSummary, setBreakSummary] = useState<string | null>(null)
  const [breakTargetSec, setBreakTargetSec] = useState(5 * 60)
  const [breakAwaySeconds, setBreakAwaySeconds] = useState(0)
  const [showQuickActions, setShowQuickActions] = useState(false)
  const [quickActionStep, setQuickActionStep] = useState<'menu' | 'breathe' | 'break'>('menu')
  const [breathingUseHrSensing, setBreathingUseHrSensing] = useState(true)
  const [breathingLiveHr, setBreathingLiveHr] = useState<number | null>(null)
  const [breakUseGenuinityChecks, setBreakUseGenuinityChecks] = useState(true)
  const [breakPlannedMinutes, setBreakPlannedMinutes] = useState(5)
  const breakActiveRef = useRef(false)
  const breakReminderTwoSentRef = useRef(false)
  const breakReminderFourSentRef = useRef(false)
  const finishBreakRef = useRef<(reason: 'complete' | 'early') => Promise<void>>(async () => {})

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
  const postureTrend = useMemo(() => postureTrendPoints.map((item) => item.value), [postureTrendPoints])
  const stressTrend = useMemo(() => stressTrendPoints.map((item) => item.value), [stressTrendPoints])
  const postureStats = useMemo(() => trendStats(postureTrend), [postureTrend])
  const stressStats = useMemo(() => trendStats(stressTrend), [stressTrend])
  const activePattern = BREATHING_PATTERNS[breathingPattern]
  const breathingPhase = activePattern.phases[breathingPhaseIndex] ?? activePattern.phases[0]
  const breathingRemainingSeconds = Math.max(0, Math.ceil(breathingRemainingMs / 1000))
  const breakMinutes = Math.floor(breakRemainingSec / 60)
  const breakSeconds = breakRemainingSec % 60

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
    const cyclesCompleted = Math.max(0, breathingCycle - 1)

    try {
      await invoke('run_log_breathing_session', {
        exerciseType: breathingPattern,
        cyclesCompleted,
        hrStart,
        hrEnd,
        hrDelta,
        triggeredBy: breathingTriggeredBy,
      })
    } catch {
      // Keep UX resilient; logging should never block the flow.
    }

    if (hrDelta != null) {
      const summary =
        hrDelta < 0
          ? `Heart rate down ${Math.abs(Math.round(hrDelta))} bpm`
          : hrDelta > 0
            ? `Heart rate up ${Math.round(hrDelta)} bpm`
            : 'Heart rate unchanged'
      setBreathingSummary(summary)
    } else {
      setBreathingSummary('Session complete')
    }
    setBreathingActive(false)
    setBreathingLiveHr(null)
  }, [
    breathingCycle,
    breathingLiveHr,
    breathingPattern,
    breathingStartHr,
    breathingTriggeredBy,
    breathingUseHrSensing,
    result?.heart_rate_bpm,
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

  const loadHistory = useCallback(async () => {
    try {
      const payload = await invoke<{ items: SessionHistoryItem[] }>('run_session_history', { limit: 20 })
      const items = payload.items ?? []
      setHistory(items)
      if (items.length > 0) {
        const latest = sessionFromHistory(items[0])
        setResult(latest)
        updateNudgeFromResult(latest)
      } else {
        setResult(null)
      }
    } catch {
      setHistory([])
      setResult(null)
    }
  }, [updateNudgeFromResult])

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
      setBreathingStartHr(breathingUseHrSensing ? null : (result?.heart_rate_bpm ?? null))
      setBreathingLiveHr(null)
      setBreathingSummary(null)
    },
    [activePattern.phases, breathingUseHrSensing, result?.heart_rate_bpm],
  )

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

  async function closeWindow(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    const win = getCurrentWindow()
    try {
      await win.hide()
      return
    } catch {
      // fall through to minimize/close fallback
    }
    try {
      await win.minimize()
      return
    } catch {
      // final fallback below
    }
    try {
      await win.close()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function runSession() {
    try {
      if (settings?.monitoring_paused) {
        setError('Monitoring is paused. Resume it in preferences.')
        return
      }
      setStatus('Running')
      setError(null)
      const payload = await invoke<SessionResult>('run_python_session')
      if (payload.session_skipped || !payload.presence_detected) {
        setLastNudge('No face detected, skipped this check-in.')
        setStatus('Done')
        await loadSettings()
        return
      }
      setResult(payload)
      updateNudgeFromResult(payload)
      setLastRunSource('manual')
      setStatus('Done')
      await loadHistory()
      await loadDailyReport()
      await loadCalibrationStatus()
      await loadSettings()
    } catch (e) {
      setStatus('Error')
      setError(e instanceof Error ? e.message : String(e))
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

      unlistenResult = await listen<{ source: string; result: SessionResult }>('session-result', (event) => {
        if (event.payload.result.session_skipped || !event.payload.result.presence_detected) {
          setLastNudge('No face detected, skipped this check-in.')
          setStatus('Done')
          setError(null)
          return
        }
        setResult(event.payload.result)
        updateNudgeFromResult(event.payload.result)
        if (event.payload.source === 'focus-mode') {
          setLastRunSource('focus-mode')
          if (!breathingActive && !breakActive && stressIndex(event.payload.result) > 60) {
            setLastNudge('Elevated stress detected during focus mode. Starting breathing exercise.')
            startBreathing('auto')
          }
        } else {
          setLastRunSource('scheduler')
        }
        setStatus('Done')
        setError(null)
        void loadHistory()
        void loadDailyReport()
        void loadCalibrationStatus()
      })

      unlistenError = await listen<{ error: string }>('session-error', (event) => {
        setStatus('Error')
        setError(event.payload.error)
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
    breakActive,
    breathingActive,
    loadCalibrationStatus,
    loadDailyReport,
    loadHistory,
    loadSettings,
    startBreathing,
    startBreak,
    updateNudgeFromResult,
  ])

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
              <button className="icon-btn icon-btn-close" aria-label="Close window" title="Close" onClick={closeWindow}>
                ×
              </button>
            </div>
          </header>
          <OverlayScrollbarsComponent className="content-scroll" options={overlayScrollbarOptions}>
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
                  <p>{breathingSummary}</p>
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
                      <span className="stat-label">heart rate bpm</span>
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
          </OverlayScrollbarsComponent>

          <AnimatePresence>
            {showQuickActions && activePage === 'home' && !breathingActive && !breakActive && (
              <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 8 }}>
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
                className="icon-action-btn"
                onClick={() =>
                  setShowQuickActions((v) => {
                    const next = !v
                    if (next) setQuickActionStep('menu')
                    return next
                  })
                }
                aria-label="Open quick actions"
                title="Actions"
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

          {activePage === 'home' && !breathingActive && !breakActive && (
            <button
              className="checkin-fab"
              onClick={runSession}
              disabled={!canRun || settings?.monitoring_paused || breakActive}
            >
              {status === 'Running' ? 'Checking' : 'Check in'}
            </button>
          )}
        </main>
      )}
    </AppSettingsProvider>
  )
}

export default App
