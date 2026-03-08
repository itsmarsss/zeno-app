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

function App() {
  const [backend, setBackend] = useState<'hsemotion' | 'fer'>('hsemotion')
  const [status, setStatus] = useState<'Idle' | 'Running' | 'Done' | 'Error'>('Idle')
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<SessionResult | null>(null)
  const [lastRunSource, setLastRunSource] = useState<'manual' | 'scheduler' | null>(null)
  const [schedulerState, setSchedulerState] = useState('Active (every 10 min)')

  const canRun = status !== 'Running'
  const statusTone = useMemo(() => {
    if (status === 'Running') return 'status status--running'
    if (status === 'Error') return 'status status--error'
    if (status === 'Done') return 'status status--done'
    return 'status'
  }, [status])

  async function runSession() {
    try {
      setStatus('Running')
      setError(null)
      const payload = await invoke<SessionResult>('run_python_session', {
        emotionBackend: backend,
      })
      setResult(payload)
      setLastRunSource('manual')
      setStatus('Done')
    } catch (e) {
      setStatus('Error')
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  useEffect(() => {
    let unlistenResult: (() => void) | null = null
    let unlistenError: (() => void) | null = null
    let unlistenSkip: (() => void) | null = null

    const setup = async () => {
      unlistenResult = await listen<{ source: string; result: SessionResult }>(
        'session-result',
        (event) => {
          setResult(event.payload.result)
          setLastRunSource('scheduler')
          setStatus('Done')
          setError(null)
        },
      )
      unlistenError = await listen<{ source: string; error: string }>('session-error', (event) => {
        setStatus('Error')
        setError(event.payload.error)
      })
      unlistenSkip = await listen<{ reason: string }>('scheduler-skip', () => {
        setSchedulerState('Skipped (run already in progress)')
        setTimeout(() => setSchedulerState('Active (every 10 min)'), 2500)
      })
    }

    void setup()
    return () => {
      unlistenResult?.()
      unlistenError?.()
      unlistenSkip?.()
    }
  }, [])

  return (
    <main className="panel">
      <header className="panel__header">
        <h1>Zeno</h1>
        <span className={statusTone}>{status}</span>
      </header>
      <section className="panel__section">
        <p>Menubar app is running.</p>
        <p className="muted">Camera checks run locally on this device.</p>
        <p className="muted">Scheduler: {schedulerState}</p>
      </section>
      <section className="panel__section">
        <h2>Session</h2>
        <div className="controls">
          <select
            value={backend}
            onChange={(e) => setBackend(e.target.value as 'hsemotion' | 'fer')}
            disabled={!canRun}
          >
            <option value="hsemotion">hsemotion</option>
            <option value="fer">fer</option>
          </select>
          <button onClick={runSession} disabled={!canRun}>
            {status === 'Running' ? 'Running...' : 'Run Now'}
          </button>
        </div>
      </section>
      {error && (
        <section className="panel__section panel__section--error">
          <h2>Error</h2>
          <pre>{error}</pre>
        </section>
      )}
      {result && (
        <section className="panel__section">
          <h2>Latest Result</h2>
          <ul>
            <li>Presence: {result.presence_detected ? 'true' : 'false'}</li>
            <li>Posture: {result.posture_score.toFixed(3)}</li>
            <li>
              Emotion: {result.dominant_emotion} ({result.emotion_score.toFixed(3)})
            </li>
            <li>
              Heart Rate: {result.heart_rate_bpm === null ? 'unknown' : `${result.heart_rate_bpm} bpm`}
            </li>
            <li>Duration: {result.session_duration_seconds.toFixed(1)}s</li>
            <li>Source: {lastRunSource ?? 'manual'}</li>
          </ul>
        </section>
      )}
      <section className="panel__section">
        <h2>JSON</h2>
        <pre>{result ? JSON.stringify(result, null, 2) : '{ }'}</pre>
      </section>
      <footer className="panel__footer">
        <small>v0.1.0</small>
      </footer>
    </main>
  )
}

export default App
