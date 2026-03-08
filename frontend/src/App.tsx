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
  session_frequency_minutes: number
  daily_report_hour: number
  daily_report_minute: number
  onboarding_completed: boolean
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
  const [lastRunSource, setLastRunSource] = useState<'manual' | 'scheduler' | null>(null)

  const canRun = status !== 'Running'
  const stress = useMemo(() => stressIndex(result), [result])
  const stressLabel = stressState(stress)
  const stressFill = `${stress}%`

  const sessionCountToday = useMemo(() => {
    const today = new Date().toDateString()
    return history.filter((h) => new Date(h.created_at).toDateString() === today).length
  }, [history])

  const postureTrend = useMemo(
    () => (dailyReport?.posture_trend ?? []).slice(-12).map((item) => Math.round(item.score * 100)),
    [dailyReport],
  )
  const stressTrend = useMemo(
    () => (dailyReport?.stress_trend ?? []).slice(-12).map((item) => item.score),
    [dailyReport],
  )

  async function loadHistory() {
    try {
      const payload = await invoke<{ items: SessionHistoryItem[] }>('run_session_history', { limit: 20 })
      setHistory(payload.items ?? [])
    } catch {
      setHistory([])
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

  async function completeOnboarding() {
    await updateSettings({ onboarding_completed: true })
    setShowOnboarding(false)
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
        setLastRunSource('scheduler')
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

      <header className="headerbar" data-tauri-drag-region onMouseDown={handleHeaderMouseDown}>
        <div className="brand" data-tauri-drag-region>
          <span className={`dot dot--${settings?.monitoring_paused ? 'paused' : status === 'Running' ? 'capturing' : 'active'}`} />
          <h1>zeno</h1>
        </div>
        {activePage === 'home' ? (
          <button className="icon-btn" onClick={() => setActivePage('settings')}>Settings</button>
        ) : (
          <button className="icon-btn" onClick={() => setActivePage('home')}>Back</button>
        )}
      </header>
      <div className="content-scroll">
        {activePage === 'home' && (
          <>
            <section className="stress-card">
              <p className="label">stress index</p>
              <div className={`stress-value stress-value--${stressLabel}`}>{stress}</div>
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
                  <svg viewBox="0 0 260 74" preserveAspectRatio="none">
                    <path className="line-posture" d={sparklinePath(postureTrend, 260, 74)} />
                  </svg>
                </div>
                <div className="chart-wrap">
                  <p>Stress trend</p>
                  <svg viewBox="0 0 260 74" preserveAspectRatio="none">
                    <path className="line-stress" d={sparklinePath(stressTrend, 260, 74)} />
                  </svg>
                </div>
                <p className="recommendation">{dailyReport.recommendation}</p>
              </>
            ) : (
              <p className="recommendation">No report yet. Run a check in first.</p>
            )}
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

      {activePage === 'home' && (
        <button className="checkin-fab" onClick={runSession} disabled={!canRun || settings?.monitoring_paused}>
          {status === 'Running' ? 'Checking' : 'Check in'}
        </button>
      )}
    </main>
  )
}

export default App
