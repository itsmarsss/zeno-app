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

  async function runSession() {
    try {
      setStatus('Running')
      setError(null)
      const payload = await invoke<SessionResult>('run_python_session')
      setResult(payload)
      setLastRunSource('manual')
      setStatus('Done')
      await loadHistory()
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

      unlistenResult = await listen<{ source: string; result: SessionResult }>('session-result', (event) => {
        setResult(event.payload.result)
        setLastRunSource('scheduler')
        setStatus('Done')
        setError(null)
        void loadHistory()
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

      <footer className="footer">Last run source: {lastRunSource ?? 'none yet'}</footer>
    </main>
  )
}

export default App
