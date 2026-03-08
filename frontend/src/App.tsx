import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
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
  recommendation: string
}

type CalibrationStatus = {
  calibrated: boolean
  baseline_sessions_required: number
  sessions_collected: number
  sessions_remaining: number
  baseline_posture_score: number | null
  deviation_threshold: number
}

type AppSettings = {
  monitoring_paused: boolean
  session_frequency_minutes: number
  daily_report_hour: number
  daily_report_minute: number
}

function prettyTime(timestamp: string): string {
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return timestamp
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function friendlyEmotion(label: string): string {
  const normalized = label.toLowerCase()
  if (normalized === 'fear' || normalized === 'angry' || normalized === 'anger') return 'Stressed'
  if (normalized === 'sad' || normalized === 'sadness') return 'Low energy'
  if (normalized === 'happy' || normalized === 'happiness') return 'Positive'
  if (normalized === 'neutral') return 'Neutral'
  return label
}

function App() {
  const [status, setStatus] = useState<'Idle' | 'Running' | 'Done' | 'Error'>('Idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SessionResult | null>(null)
  const [history, setHistory] = useState<SessionHistoryItem[]>([])
  const [dailyReport, setDailyReport] = useState<DailyReport | null>(null)
  const [calibration, setCalibration] = useState<CalibrationStatus | null>(null)
  const [settings, setSettings] = useState<AppSettings | null>(null)
  const [schedulerState, setSchedulerState] = useState('Automatic check every 10 minutes')
  const [lastRunSource, setLastRunSource] = useState<'manual' | 'scheduler' | null>(null)

  const canRun = status !== 'Running'

  const wellnessScore = useMemo(() => {
    const base = result?.posture_score ?? 0
    const posturePoints = Math.round(base * 55)
    const hrPoints = result?.heart_rate_bpm == null ? 15 : result.heart_rate_bpm < 92 ? 25 : 10
    const presencePoints = result?.presence_detected ? 20 : 8
    return Math.max(0, Math.min(100, posturePoints + hrPoints + presencePoints))
  }, [result])

  const summaryLine = useMemo(() => {
    if (!result) return 'Run your first check-in to get started.'
    const heart = result.heart_rate_bpm == null ? 'Heart rate unavailable' : `${result.heart_rate_bpm} bpm`
    return `${friendlyEmotion(result.dominant_emotion)} · ${heart}`
  }, [result])

  async function loadHistory() {
    try {
      const payload = await invoke<{ items: SessionHistoryItem[] }>('run_session_history', {
        limit: 12,
      })
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

  async function clearAllData() {
    try {
      await invoke('run_clear_data')
      await loadHistory()
      await loadDailyReport()
      await loadCalibrationStatus()
      setResult(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  async function runSession() {
    try {
      if (settings?.monitoring_paused) {
        setError('Monitoring is paused in Settings.')
        return
      }
      setStatus('Running')
      setError(null)
      const payload = await invoke<SessionResult>('run_python_session')
      setResult(payload)
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
    let unlistenReportReady: (() => void) | null = null
    let unlistenReportError: (() => void) | null = null

    const setup = async () => {
      await loadHistory()
      await loadDailyReport()
      await loadCalibrationStatus()
      await loadSettings()

      unlistenResult = await listen<{ source: string; result: SessionResult }>('session-result', (event) => {
        setResult(event.payload.result)
        setLastRunSource('scheduler')
        setStatus('Done')
        setError(null)
        void loadHistory()
        void loadDailyReport()
        void loadCalibrationStatus()
      })

      unlistenError = await listen<{ source: string; error: string }>('session-error', (event) => {
        setStatus('Error')
        setError(event.payload.error)
      })

      unlistenSkip = await listen<{ reason: string }>('scheduler-skip', () => {
        setSchedulerState('Skipped because another check is already running')
        setTimeout(() => setSchedulerState('Automatic check every 10 minutes'), 3000)
      })

      unlistenGesture = await listen<{ snooze_minutes: number }>('gesture-dismissed', (event) => {
        setSchedulerState(`Dismissed by gesture · snoozed ${event.payload.snooze_minutes} min`)
        setTimeout(() => setSchedulerState('Automatic check every 10 minutes'), 5000)
      })

      unlistenReportReady = await listen<DailyReport>('report-ready', (event) => {
        setDailyReport(event.payload)
      })

      unlistenReportError = await listen<{ error: string }>('report-error', (event) => {
        setError(event.payload.error)
      })
    }

    void setup()
    return () => {
      unlistenResult?.()
      unlistenError?.()
      unlistenSkip?.()
      unlistenGesture?.()
      unlistenReportReady?.()
      unlistenReportError?.()
    }
  }, [])

  return (
    <main className="panel">
      <header className="header">
        <div>
          <h1>Zeno</h1>
          <p>Your quiet wellness companion</p>
        </div>
        <button className="primary" onClick={runSession} disabled={!canRun}>
          {status === 'Running' ? 'Checking…' : 'Check In'}
        </button>
      </header>

      <section className="card hero">
        <div>
          <p className="label">Wellness Snapshot</p>
          <h2>{wellnessScore}/100</h2>
          <p>{summaryLine}</p>
        </div>
        <div className="pill">{status === 'Running' ? 'Running now' : schedulerState}</div>
      </section>

      {calibration && !calibration.calibrated && (
        <section className="card calibration">
          <h3>Personal Baseline Setup</h3>
          <p>
            Zeno is learning your natural posture. Complete {calibration.sessions_remaining} more
            check-in{calibration.sessions_remaining === 1 ? '' : 's'} to finish calibration.
          </p>
          <div className="calibration__meter">
            <div
              className="calibration__fill"
              style={{
                width: `${Math.min(
                  100,
                  Math.round(
                    (calibration.sessions_collected / calibration.baseline_sessions_required) * 100,
                  ),
                )}%`,
              }}
            />
          </div>
        </section>
      )}

      <section className="card metrics">
        <article>
          <span>Posture</span>
          <strong>{result ? `${Math.round(result.posture_score * 100)}%` : '--'}</strong>
        </article>
        <article>
          <span>Emotion</span>
          <strong>{result ? friendlyEmotion(result.dominant_emotion) : '--'}</strong>
        </article>
        <article>
          <span>Heart Rate</span>
          <strong>{result?.heart_rate_bpm == null ? '--' : `${result.heart_rate_bpm} bpm`}</strong>
        </article>
      </section>

      {error && (
        <section className="card error">
          <h3>Couldn’t complete the check</h3>
          <p>{error}</p>
        </section>
      )}

      <section className="card history">
        <div className="history__head">
          <h3>Recent Check-ins</h3>
          <span>{history.length} saved</span>
        </div>
        {history.length === 0 ? (
          <p className="empty">No history yet.</p>
        ) : (
          <ul>
            {history.map((item) => (
              <li key={item.id}>
                <div>
                  <strong>{prettyTime(item.created_at)}</strong>
                  <span>{friendlyEmotion(item.dominant_emotion)}</span>
                </div>
                <div>
                  <span>{Math.round(item.posture_score * 100)}%</span>
                  <span>{item.heart_rate_bpm == null ? '--' : `${item.heart_rate_bpm} bpm`}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="card report">
        <div className="history__head">
          <h3>Daily Report</h3>
          <button className="ghost" onClick={loadDailyReport}>
            Refresh
          </button>
        </div>
        {!dailyReport ? (
          <p className="empty">No report available yet.</p>
        ) : (
          <>
            <div className="report__metrics">
              <span>Stress Avg: {dailyReport.average_stress_index}</span>
              <span>Focused: {dailyReport.focused_minutes} min</span>
              <span>Sessions: {dailyReport.sessions}</span>
            </div>
            {dailyReport.peak_stress && (
              <p className="report__peak">
                Peak stress {dailyReport.peak_stress.stress_index} at {prettyTime(dailyReport.peak_stress.time)}
              </p>
            )}
            <div className="trend">
              {dailyReport.posture_trend.slice(-10).map((point) => (
                <div key={point.time} className="trend__bar-wrap" title={`${prettyTime(point.time)} · ${Math.round(point.score * 100)}%`}>
                  <div className="trend__bar" style={{ height: `${Math.max(6, Math.round(point.score * 52))}px` }} />
                </div>
              ))}
            </div>
            <p className="report__recommendation">{dailyReport.recommendation}</p>
          </>
        )}
      </section>

      <section className="card settings">
        <div className="history__head">
          <h3>Settings</h3>
        </div>
        <div className="settings__row">
          <label>Monitoring</label>
          <button
            className="ghost"
            onClick={() => updateSettings({ monitoring_paused: !settings?.monitoring_paused })}
          >
            {settings?.monitoring_paused ? 'Resume' : 'Pause'}
          </button>
        </div>
        <div className="settings__row">
          <label>Session Frequency</label>
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
        <div className="settings__row">
          <label>Daily Report Time</label>
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
        <div className="settings__row">
          <label>Local Data</label>
          <button className="ghost danger" onClick={clearAllData}>
            Clear All
          </button>
        </div>
      </section>

      <footer className="footer">Last run source: {lastRunSource ?? 'none yet'}</footer>
    </main>
  )
}

export default App
