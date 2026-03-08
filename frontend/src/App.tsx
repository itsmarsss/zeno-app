import { useEffect, useMemo, useState, type MouseEvent } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './App.css'

type SessionResult = {
  timestamp: string
  presence_detected: boolean
  posture_score: number
  dominant_emotion: string
  emotion_score: number
  heart_rate_bpm: number | null
  emotion_backend: string
  session_duration_seconds: number
}

type SessionHistoryItem = {
  id: number
  created_at: string
  presence_detected: number
  posture_score: number
  dominant_emotion: string
  emotion_score: number
  heart_rate_bpm: number | null
  emotion_backend: string
  focus_mode?: number
  session_duration_seconds: number
}

type DailyReport = {
  date: string
  sessions: number
  average_stress_index: number
  focused_minutes: number
  peak_stress: { stress_index: number; time: string } | null
  posture_trend: { time: string; score: number }[]
  stress_trend: { time: string; score: number }[]
  recommendation: string
}

type CalibrationStatus = {
  calibrated: boolean
  baseline_sessions_required: number
  sessions_collected: number
  sessions_remaining: number
}

type AppSettings = {
  monitoring_paused: boolean
  focus_mode_active: boolean
  session_frequency_minutes: number
  daily_report_hour: number
  daily_report_minute: number
  onboarding_completed: boolean
}

type BreathingPatternId = 'box' | 'four-seven-eight'

const BREATHING_PATTERNS: Record<
  BreathingPatternId,
  { name: string; phases: { label: 'Inhale' | 'Hold' | 'Exhale'; seconds: number }[]; cycles: number }
> = {
  box: {
    name: 'Box breathing',
    phases: [
      { label: 'Inhale', seconds: 4 },
      { label: 'Hold', seconds: 4 },
      { label: 'Exhale', seconds: 4 },
      { label: 'Hold', seconds: 4 },
    ],
    cycles: 4,
  },
  'four-seven-eight': {
    name: '4-7-8 breathing',
    phases: [
      { label: 'Inhale', seconds: 4 },
      { label: 'Hold', seconds: 7 },
      { label: 'Exhale', seconds: 8 },
    ],
    cycles: 4,
  },
}

function prettyTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function stressIndex(result: SessionResult | null): number {
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

function stressState(score: number): 'calm' | 'mild' | 'elevated' | 'high' {
  if (score <= 30) return 'calm'
  if (score <= 60) return 'mild'
  if (score <= 80) return 'elevated'
  return 'high'
}

function friendlyPosture(score: number): string {
  if (score >= 0.65) return 'good'
  if (score >= 0.5) return 'fair'
  return 'poor'
}

function stressIndexFromHistory(item: SessionHistoryItem): number {
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

function sessionFromHistory(item: SessionHistoryItem): SessionResult {
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

function sparklinePath(values: number[], width = 260, height = 74): string {
  if (!values.length) return ''
  const min = 0
  const max = 100
  const stepX = values.length === 1 ? width : width / (values.length - 1)
  const points = values.map((value, i) => {
    const x = i * stepX
    const y = height - ((Math.max(min, Math.min(max, value)) - min) / (max - min || 1)) * height
    return `${x.toFixed(2)} ${y.toFixed(2)}`
  })
  return `M ${points.join(' L ')}`
}

function pointY(value: number, height = 74): number {
  const clamped = Math.max(0, Math.min(100, value))
  return height - (clamped / 100) * height
}

function trendStats(values: number[]): { latest: number; low: number; high: number } {
  if (!values.length) return { latest: 0, low: 0, high: 0 }
  return {
    latest: values[values.length - 1] ?? 0,
    low: Math.min(...values),
    high: Math.max(...values),
  }
}

function App() {
  const [status, setStatus] = useState<'Idle' | 'Running' | 'Done' | 'Error'>('Idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SessionResult | null>(null)
  const [history, setHistory] = useState<SessionHistoryItem[]>([])
  const [dailyReport, setDailyReport] = useState<DailyReport | null>(null)
  const [calibration, setCalibration] = useState<CalibrationStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [activePage, setActivePage] = useState<'home' | 'report' | 'settings'>('home')
  const [lastNudge, setLastNudge] = useState('No nudges yet.')
  const [lastRunSource, setLastRunSource] = useState<'manual' | 'scheduler' | 'focus-mode' | null>(null)
  const [displayedStress, setDisplayedStress] = useState(0)
  const [breathingActive, setBreathingActive] = useState(false)
  const [breathingPattern, setBreathingPattern] = useState<BreathingPatternId>('box')
  const [breathingPhaseIndex, setBreathingPhaseIndex] = useState(0)
  const [breathingRemainingMs, setBreathingRemainingMs] = useState(BREATHING_PATTERNS.box.phases[0].seconds * 1000)
  const [breathingCycle, setBreathingCycle] = useState(1)
  const [breathingStartHr, setBreathingStartHr] = useState<number | null>(null)
  const [breathingSummary, setBreathingSummary] = useState<string | null>(null)
  const [breakActive, setBreakActive] = useState(false)
  const [breakRemainingSec, setBreakRemainingSec] = useState(5 * 60)
  const [breakSummary, setBreakSummary] = useState<string | null>(null)

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

  async function stopBreathing() {
    const hrEnd = result?.heart_rate_bpm ?? null
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
        triggeredBy: 'manual',
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
  }

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
    if (!breakActive) return
    const timer = window.setInterval(() => {
      setBreakRemainingSec((prev) => {
        if (prev <= 1) {
          window.clearInterval(timer)
          setBreakActive(false)
          setBreakSummary('Break complete. Back to focus.')
          return 0
        }
        return prev - 1
      })
    }, 1000)
    return () => window.clearInterval(timer)
  }, [breakActive])

  useEffect(() => {
    if (!breakSummary) return
    const timeout = window.setTimeout(() => setBreakSummary(null), 3000)
    return () => window.clearTimeout(timeout)
  }, [breakSummary])

  async function loadHistory() {
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
  }

  async function loadDailyReport() {
    try {
      const payload = await invoke<DailyReport>('run_daily_report')
      setDailyReport(payload)
    } catch {
      setDailyReport(null)
    }
  }

  async function loadCalibrationStatus() {
    try {
      const payload = await invoke<CalibrationStatus>('run_calibration_status')
      setCalibration(payload)
    } catch {
      setCalibration(null)
    }
  }

  async function loadSettings() {
    try {
      const payload = await invoke<AppSettings>('run_get_settings')
      setSettings(payload)
      if (!payload.onboarding_completed) setShowOnboarding(true)
    } catch {
      setSettings(null)
    }
  }

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

  function startBreathing() {
    setBreathingActive(true)
    setBreathingPhaseIndex(0)
    setBreathingRemainingMs(activePattern.phases[0].seconds * 1000)
    setBreathingCycle(1)
    setBreathingStartHr(result?.heart_rate_bpm ?? null)
    setBreathingSummary(null)
  }

  async function completeOnboarding() {
    await updateSettings({ onboarding_completed: true })
    setShowOnboarding(false)
  }

  function startBreak(durationSec = 5 * 60) {
    setBreakActive(true)
    setBreakRemainingSec(Math.max(60, durationSec))
    setBreakSummary(null)
  }

  function stopBreak() {
    setBreakActive(false)
    setBreakSummary('Break ended early.')
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

  function closeWindow(event: MouseEvent<HTMLButtonElement>) {
    event.preventDefault()
    event.stopPropagation()
    void getCurrentWindow().hide()
  }

  function updateNudgeFromResult(session: SessionResult) {
    if (session.posture_score < 0.45) {
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

    const setup = async () => {
      await loadHistory()
      await loadDailyReport()
      await loadCalibrationStatus()
      await loadSettings()

      unlistenResult = await listen<{ source: string; result: SessionResult }>('session-result', (event) => {
        setResult(event.payload.result)
        updateNudgeFromResult(event.payload.result)
        if (event.payload.source === 'focus-mode') {
          setLastRunSource('focus-mode')
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
    }

    void setup()
    return () => {
      unlistenResult?.()
      unlistenError?.()
      unlistenSkip?.()
      unlistenGesture?.()
    }
  }, [])

  return (
    <main className="popover">
      {showOnboarding && (
        <div className="overlay">
          <section className="onboarding">
            <h2>Welcome to Zeno</h2>
            <p>Zeno runs quietly in your menubar and checks your posture and stress privately on-device.</p>
            <ol>
              <li>Use <strong>Check In</strong> for an immediate snapshot.</li>
              <li>First 3 sessions establish your personal baseline.</li>
              <li>Open <strong>View report</strong> to see daily trends.</li>
            </ol>
            <div className="row-end">
              <button className="btn-ghost" onClick={() => setShowOnboarding(false)}>Later</button>
              <button className="btn-solid" onClick={completeOnboarding}>Got it</button>
            </div>
          </section>
        </div>
      )}

      <header className="headerbar" onMouseDown={handleHeaderMouseDown}>
        <div className="brand">
          <span className={`dot dot--${settings?.monitoring_paused ? 'paused' : status === 'Running' ? 'capturing' : 'active'}`} />
          <h1>zeno</h1>
        </div>
        <div className="header-actions">
          {activePage === 'home' ? (
            <button className="icon-btn" onClick={() => setActivePage('settings')}>Settings</button>
          ) : (
            <button className="icon-btn" onClick={() => setActivePage('home')}>Back</button>
          )}
          <button className="icon-btn icon-btn-close" aria-label="Close window" title="Close" onClick={closeWindow}>×</button>
        </div>
      </header>
      <div className="content-scroll">
        {breakSummary && activePage === 'home' && (
          <section className="breathing-summary">
            <p className="label">Break</p>
            <p>{breakSummary}</p>
          </section>
        )}

        {breakActive && activePage === 'home' && (
          <section className="breathing-panel">
            <div className="breathing-head">
              <p className="label">Break timer</p>
              <button className="icon-btn" onClick={stopBreak}>Stop</button>
            </div>
            <p className="breathing-hr">
              {String(breakMinutes).padStart(2, '0')}:{String(breakSeconds).padStart(2, '0')}
            </p>
            <p className="breathing-cycle">Step away from the screen for a few minutes.</p>
          </section>
        )}

        {breathingSummary && activePage === 'home' && (
          <section className="breathing-summary">
            <p className="label">Done</p>
            <p>{breathingSummary}</p>
          </section>
        )}

        {breathingActive && activePage === 'home' && !breakActive && (
          <section className="breathing-panel">
            <div className="breathing-head">
              <p className="label">{activePattern.name}</p>
              <button className="icon-btn" onClick={() => void stopBreathing()}>Stop</button>
            </div>
            <p className="breathing-hr">
              {result?.heart_rate_bpm == null ? '--' : Math.round(result.heart_rate_bpm)} <span>bpm</span>
            </p>
            <div className={`breathing-circle ${breathingPhase.label.toLowerCase()}`}>
              <span>{breathingPhase.label}</span>
            </div>
            <p className="breathing-countdown">{breathingRemainingSeconds}s</p>
            <p className="breathing-cycle">Cycle {breathingCycle} of {activePattern.cycles}</p>
          </section>
        )}

        {activePage === 'home' && !breathingActive && !breakActive && (
          <>
            <section className="stress-card">
              <p className="label">stress index</p>
              <div className={`stress-value stress-value--${stressLabel}`}>{Math.round(displayedStress)}</div>
              <p className="stress-sub">{stressLabel}</p>
              <div className="stress-bar"><div className={`stress-fill stress-fill--${stressLabel}`} style={{ width: stressFill }} /></div>
            </section>

            <div className="divider" />

            <section className="stats-row">
              <article className="stat-cell">
                <span className="stat-value">{result?.heart_rate_bpm == null ? '--' : `${result.heart_rate_bpm}`}</span>
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
          </>
        )}

        {activePage === 'report' && (
          <section className="report-panel report-page">
            {dailyReport ? (
              <>
                <h3>{new Date(dailyReport.date).toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</h3>
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
                        cx={postureTrendPoints.length === 1 ? 130 : (index * 260) / (postureTrendPoints.length - 1)}
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
                      <span className="history-time">{new Date(item.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                      <span className="history-pill">S {stressIndexFromHistory(item)}</span>
                      <span className="history-pill">P {friendlyPosture(item.posture_score)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>
        )}

        {activePage === 'settings' && (
          <section className="prefs-panel prefs-page">
            {!calibration?.calibrated && (
              <p className="prefs-note">
                Baseline in progress: {calibration?.sessions_remaining ?? 0} check-ins remaining.
              </p>
            )}
            <div className="prefs-row">
              <label>Session frequency</label>
              <select
                value={settings?.session_frequency_minutes ?? 10}
                onChange={(e) => updateSettings({ session_frequency_minutes: Number(e.target.value) })}
              >
                <option value={5}>5 min</option>
                <option value={10}>10 min</option>
                <option value={15}>15 min</option>
                <option value={30}>30 min</option>
              </select>
            </div>
            <div className="prefs-row">
              <label>Report time</label>
              <input
                type="time"
                value={`${String(settings?.daily_report_hour ?? 21).padStart(2, '0')}:${String(
                  settings?.daily_report_minute ?? 0,
                ).padStart(2, '0')}`}
                onChange={(e) => {
                  const [hour, minute] = e.target.value.split(':').map(Number)
                  updateSettings({ daily_report_hour: hour, daily_report_minute: minute })
                }}
              />
            </div>
            <div className="prefs-actions">
              <button className="btn-ghost" onClick={() => setShowOnboarding(true)}>Replay onboarding</button>
              <button className="btn-danger" onClick={clearAllData}>Clear data</button>
            </div>
            <p className="prefs-meta">Last run: {lastRunSource ?? 'none'}</p>
            {error && <p className="prefs-error">{error}</p>}
          </section>
        )}
      </div>

      <footer className="footerbar">
        {activePage === 'home' ? (
          <button className="report-link" onClick={() => setActivePage('report')}>Report</button>
        ) : (
          <button className="report-link" onClick={() => setActivePage('home')}>Home</button>
        )}
        <div className="toggle-wrap">
          {activePage === 'home' && settings?.focus_mode_active && !breathingActive && (
            <>
              <div className="pattern-picker">
                <button
                  className={`pattern-chip ${breathingPattern === 'box' ? 'is-active' : ''}`}
                  onClick={() => setBreathingPattern('box')}
                >
                  Box
                </button>
                <button
                  className={`pattern-chip ${breathingPattern === 'four-seven-eight' ? 'is-active' : ''}`}
                  onClick={() => setBreathingPattern('four-seven-eight')}
                >
                  4-7-8
                </button>
              </div>
              <button className="report-link" onClick={startBreathing}>Breathe</button>
            </>
          )}
          {activePage === 'home' && settings?.focus_mode_active && !breakActive && (
            <button className="report-link" onClick={() => startBreak(5 * 60)}>Break</button>
          )}
          {activePage === 'home' && breathingActive && (
            <button className="report-link" onClick={() => void stopBreathing()}>Stop</button>
          )}
          {activePage === 'home' && breakActive && (
            <button className="report-link" onClick={stopBreak}>End break</button>
          )}
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
        <button className="checkin-fab" onClick={runSession} disabled={!canRun || settings?.monitoring_paused || breakActive}>
          {status === 'Running' ? 'Checking' : 'Check in'}
        </button>
      )}
    </main>
  )
}

export default App
