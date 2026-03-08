import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { EXERCISE_LIBRARY, FREE_EXERCISE_IDS } from '../shared/constants'
import { dayKey, friendlyPosture, stressIndexFromHistory } from '../shared/metrics'
import type { CalibrationStatus, DailyReport, PostureLandmarks, PostureStreamFrame, SessionHistoryItem } from '../shared/types'
import { useAppSettings } from '../context/AppSettingsContext'

export function MainWindowShell({
  history,
  dailyReport,
  calibration,
  lastRunSource,
  error,
  replayOnboarding,
  clearAllData,
}: {
  history: SessionHistoryItem[]
  dailyReport: DailyReport | null
  calibration: CalibrationStatus | null
  lastRunSource: string | null
  error: string | null
  replayOnboarding: () => void
  clearAllData: () => Promise<void>
}) {
  const { settings, updateSettings } = useAppSettings()
  const [tab, setTab] = useState<'overview' | 'focus' | 'posture' | 'exercises' | 'settings'>('overview')
  const [selectedExerciseId, setSelectedExerciseId] = useState(EXERCISE_LIBRARY[0]?.id ?? 'chin-tuck')
  const [spaceFilter, setSpaceFilter] = useState<'all' | 'desk' | 'open'>('all')
  const [difficultyFilter, setDifficultyFilter] = useState<'all' | 'easy' | 'moderate'>('all')
  const [durationFilter, setDurationFilter] = useState<'all' | 'short' | 'long'>('all')
  const [targetFilter, setTargetFilter] = useState<'all' | string>('all')
  const [exerciseGuidedActive, setExerciseGuidedActive] = useState(false)
  const [exerciseFeedback, setExerciseFeedback] = useState<string | null>(null)
  const [exerciseMetrics, setExerciseMetrics] = useState<PostureStreamFrame['exercise_metrics']>(null)
  const [licenseInput, setLicenseInput] = useState('')
  const [paywallMessage, setPaywallMessage] = useState<string | null>(null)
  const [postureFrame, setPostureFrame] = useState<string | null>(null)
  const [postureLandmarks, setPostureLandmarks] = useState<PostureLandmarks>(null)
  const [postureScoreLive, setPostureScoreLive] = useState<number | null>(null)
  const [postureStreamState, setPostureStreamState] = useState<'stopped' | 'connecting' | 'running' | 'no-pose' | 'error'>(
    'stopped',
  )
  const [postureStreamError, setPostureStreamError] = useState<string | null>(null)

  const todayKey = new Date().toISOString().slice(0, 10)
  const todaySessions = useMemo(
    () =>
      history
        .filter((item) => dayKey(item.created_at) === todayKey)
        .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [history, todayKey],
  )
  const latest = history[0] ?? null
  const focusSessions = useMemo(() => history.filter((item) => Boolean(item.focus_mode)), [history])
  const weeklyFocusTotals = useMemo(() => {
    const totals = new Map<string, number>()
    for (let offset = 6; offset >= 0; offset -= 1) {
      const d = new Date()
      d.setDate(d.getDate() - offset)
      totals.set(d.toISOString().slice(0, 10), 0)
    }
    for (const item of focusSessions) {
      const key = dayKey(item.created_at)
      if (totals.has(key)) totals.set(key, (totals.get(key) ?? 0) + item.session_duration_seconds)
    }
    return Array.from(totals.entries()).map(([date, seconds]) => ({
      date,
      minutes: Math.round(seconds / 60),
    }))
  }, [focusSessions])
  const weeklyValues = useMemo(() => weeklyFocusTotals.map((item) => item.minutes), [weeklyFocusTotals])
  const weeklyMax = Math.max(...weeklyValues, 1)
  const targetOptions = useMemo(() => Array.from(new Set(EXERCISE_LIBRARY.map((exercise) => exercise.target))), [])
  const filteredExercises = useMemo(
    () =>
      EXERCISE_LIBRARY.filter((exercise) => {
        if (spaceFilter !== 'all' && exercise.space !== spaceFilter) return false
        if (difficultyFilter !== 'all' && exercise.difficulty !== difficultyFilter) return false
        if (durationFilter === 'short' && exercise.duration_minutes > 2) return false
        if (durationFilter === 'long' && exercise.duration_minutes < 3) return false
        if (targetFilter !== 'all' && exercise.target !== targetFilter) return false
        return true
      }),
    [spaceFilter, difficultyFilter, durationFilter, targetFilter],
  )
  const selectedExercise = filteredExercises.find((exercise) => exercise.id === selectedExerciseId) ?? filteredExercises[0] ?? null
  const isPro = settings?.plan_tier === 'pro'
  const selectedExerciseProOnly = Boolean(selectedExercise && !FREE_EXERCISE_IDS.has(selectedExercise.id))

  useEffect(() => {
    const shouldStream = tab === 'posture' || (tab === 'exercises' && exerciseGuidedActive)
    if (!shouldStream) {
      return
    }

    let unlistenFrame: (() => void) | undefined
    let unlistenEnded: (() => void) | undefined

    async function startBackendPostureStream() {
      setPostureStreamState('connecting')
      setPostureStreamError(null)
      try {
        const exerciseIdArg = tab === 'exercises' ? selectedExercise?.id ?? null : null
        await invoke('start_posture_stream', { fps: 8, exerciseId: exerciseIdArg })
        unlistenFrame = await listen<PostureStreamFrame>('posture-stream-frame', (event) => {
          const payload = event.payload
          setPostureFrame(`data:image/jpeg;base64,${payload.frame_jpeg_b64}`)
          setPostureLandmarks(payload.landmarks ?? null)
          setPostureScoreLive(payload.posture_score)
          setExerciseFeedback(payload.exercise_feedback ?? null)
          setExerciseMetrics(payload.exercise_metrics ?? null)
          setPostureStreamState(payload.landmarks ? 'running' : 'no-pose')
        })
        unlistenEnded = await listen('posture-stream-ended', () => {
          setPostureStreamState('stopped')
        })
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
  }, [tab, exerciseGuidedActive, selectedExercise?.id])

  return (
    <main className="main-shell">
      <aside className="main-sidebar">
        <h2>Zeno</h2>
        <button className={tab === 'overview' ? 'main-nav is-active' : 'main-nav'} onClick={() => setTab('overview')}>Overview</button>
        <button className={tab === 'focus' ? 'main-nav is-active' : 'main-nav'} onClick={() => setTab('focus')}>Focus History</button>
        <button className={tab === 'posture' ? 'main-nav is-active' : 'main-nav'} onClick={() => setTab('posture')}>Posture</button>
        <button className={tab === 'exercises' ? 'main-nav is-active' : 'main-nav'} onClick={() => setTab('exercises')}>Exercises</button>
        <button className={tab === 'settings' ? 'main-nav is-active' : 'main-nav'} onClick={() => setTab('settings')}>Settings</button>
      </aside>
      <section className="main-content">
        {tab === 'overview' && (
          <>
            <h1>Overview</h1>
            <div className="main-stats-grid">
              <article className="main-stat-card"><p>Sessions today</p><strong>{todaySessions.length}</strong></article>
              <article className="main-stat-card"><p>Avg stress</p><strong>{dailyReport?.average_stress_index ?? 0}</strong></article>
              <article className="main-stat-card"><p>Focused minutes</p><strong>{dailyReport?.focused_minutes ?? 0}</strong></article>
              <article className="main-stat-card"><p>Latest heart rate</p><strong>{latest?.heart_rate_bpm == null ? '--' : `${Math.round(latest.heart_rate_bpm)} bpm`}</strong></article>
            </div>
            <div className="main-panel">
              <div className="main-panel-head"><h3>Today timeline</h3><span>{todaySessions.length} sessions</span></div>
              {todaySessions.length === 0 ? (
                <p className="main-empty">No sessions yet today.</p>
              ) : (
                <div className="timeline-list">
                  {todaySessions.slice(-16).map((item) => (
                    <div className="timeline-item" key={item.id}>
                      <span className="timeline-time">{new Date(item.created_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                      <span className="timeline-chip">Stress {stressIndexFromHistory(item)}</span>
                      <span className="timeline-chip">Posture {friendlyPosture(item.posture_score)}</span>
                      <span className="timeline-chip">{item.heart_rate_bpm == null ? 'HR --' : `HR ${Math.round(item.heart_rate_bpm)}`}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'focus' && (
          <>
            <h1>Focus History</h1>
            <div className="main-panel">
              <div className="main-panel-head"><h3>Weekly focus</h3><span>Last 7 days</span></div>
              <div className="week-bars">
                {weeklyFocusTotals.map((item) => (
                  <div key={item.date} className="week-bar-col">
                    <div className="week-bar-track">
                      <div className="week-bar-fill" style={{ height: `${Math.max(8, (item.minutes / weeklyMax) * 100)}%` }} title={`${new Date(item.date).toLocaleDateString([], { weekday: 'long' })}: ${item.minutes} min`} />
                    </div>
                    <span>{new Date(item.date).toLocaleDateString([], { weekday: 'short' })}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="main-panel">
              <div className="main-panel-head"><h3>Session log</h3><span>{focusSessions.length} focus sessions</span></div>
              {focusSessions.length === 0 ? (
                <p className="main-empty">No focus sessions logged yet.</p>
              ) : (
                <div className="timeline-list">
                  {focusSessions.slice(0, 24).map((item) => (
                    <div className="timeline-item" key={item.id}>
                      <span className="timeline-time">{new Date(item.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                      <span className="timeline-chip">{Math.round(item.session_duration_seconds / 60)}m</span>
                      <span className="timeline-chip">Stress {stressIndexFromHistory(item)}</span>
                      <span className="timeline-chip">Posture {friendlyPosture(item.posture_score)}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {tab === 'posture' && (
          <>
            <h1>Posture</h1>
            <div className="main-panel">
              <div className="main-panel-head">
                <h3>Live posture stream</h3>
                <span>
                  {postureStreamState === 'connecting' && 'Connecting...'}
                  {postureStreamState === 'running' && `Tracking • score ${Math.round((postureScoreLive ?? 0) * 100)}`}
                  {postureStreamState === 'no-pose' && 'No pose'}
                  {postureStreamState === 'stopped' && 'Stopped'}
                  {postureStreamState === 'error' && 'Error'}
                </span>
              </div>
              <div className="posture-preview">
                {postureFrame ? <img src={postureFrame} className="posture-video" alt="Posture stream" /> : null}
                {postureLandmarks?.nose && postureLandmarks.left_shoulder && postureLandmarks.right_shoulder ? (
                  <svg className="posture-landmark-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                    <line x1={postureLandmarks.left_shoulder.x * 100} y1={postureLandmarks.left_shoulder.y * 100} x2={postureLandmarks.right_shoulder.x * 100} y2={postureLandmarks.right_shoulder.y * 100} />
                    <line x1={postureLandmarks.nose.x * 100} y1={postureLandmarks.nose.y * 100} x2={(postureLandmarks.left_shoulder.x * 100 + postureLandmarks.right_shoulder.x * 100) / 2} y2={(postureLandmarks.left_shoulder.y * 100 + postureLandmarks.right_shoulder.y * 100) / 2} />
                    <circle cx={postureLandmarks.nose.x * 100} cy={postureLandmarks.nose.y * 100} r="1.4" />
                    <circle cx={postureLandmarks.left_shoulder.x * 100} cy={postureLandmarks.left_shoulder.y * 100} r="1.4" />
                    <circle cx={postureLandmarks.right_shoulder.x * 100} cy={postureLandmarks.right_shoulder.y * 100} r="1.4" />
                  </svg>
                ) : null}
                <div className="posture-overlay-guide" />
              </div>
              {postureStreamError ? <p className="main-empty">{postureStreamError}</p> : <p className="main-empty">Backend Python stream with MediaPipe landmarks (on-device).</p>}
            </div>
          </>
        )}

        {tab === 'exercises' && (
          <>
            <h1>Exercises</h1>
            <div className="exercise-grid">
              <section className="exercise-list">
                <div className="exercise-filters">
                  <select value={spaceFilter} onChange={(e) => setSpaceFilter(e.target.value as 'all' | 'desk' | 'open')}>
                    <option value="all">Any space</option>
                    <option value="desk">On the spot</option>
                    <option value="open">Needs room</option>
                  </select>
                  <select value={durationFilter} onChange={(e) => setDurationFilter(e.target.value as 'all' | 'short' | 'long')}>
                    <option value="all">Any duration</option>
                    <option value="short">Up to 2 min</option>
                    <option value="long">3+ min</option>
                  </select>
                  <select value={difficultyFilter} onChange={(e) => setDifficultyFilter(e.target.value as 'all' | 'easy' | 'moderate')}>
                    <option value="all">Any difficulty</option>
                    <option value="easy">Easy</option>
                    <option value="moderate">Moderate</option>
                  </select>
                  <select value={targetFilter} onChange={(e) => setTargetFilter(e.target.value)}>
                    <option value="all">Any target</option>
                    {targetOptions.map((target) => (
                      <option key={target} value={target}>{target}</option>
                    ))}
                  </select>
                </div>

                {filteredExercises.length === 0 ? (
                  <p className="main-empty">No exercises match these filters.</p>
                ) : (
                  filteredExercises.map((exercise) => (
                    <button
                      key={exercise.id}
                      className={`exercise-card ${exercise.id === selectedExercise?.id ? 'is-active' : ''}`}
                      onClick={() => {
                        setSelectedExerciseId(exercise.id)
                        setExerciseFeedback(null)
                        setExerciseMetrics(null)
                        setPaywallMessage(null)
                      }}
                    >
                      <p className="exercise-name">{exercise.name}</p>
                      <p className="exercise-meta">{exercise.target}</p>
                      <div className="exercise-tags">
                        <span>{exercise.duration_minutes} min</span>
                        <span>{exercise.difficulty}</span>
                        <span>{exercise.space === 'desk' ? 'on spot' : 'needs room'}</span>
                        {!FREE_EXERCISE_IDS.has(exercise.id) && <span>pro</span>}
                      </div>
                    </button>
                  ))
                )}
              </section>
              <section className="exercise-detail">
                {selectedExercise ? (
                  <>
                    <div className="main-panel-head"><h3>{selectedExercise.name}</h3><span>{selectedExercise.duration_minutes} min</span></div>
                    <p className="main-empty">Target: {selectedExercise.target}</p>
                    <ol className="exercise-steps">{selectedExercise.steps.map((step) => <li key={step}>{step}</li>)}</ol>
                    <div className="exercise-actions">
                      <button
                        className="btn-solid"
                        type="button"
                        onClick={() => {
                          if (!isPro) {
                            setPaywallMessage('Guided sets are a Pro feature. Add your license key in Settings.')
                            return
                          }
                          if (selectedExerciseProOnly) {
                            setPaywallMessage('This exercise requires Pro.')
                            return
                          }
                          setExerciseGuidedActive((v) => {
                            const next = !v
                            if (!next) {
                              setExerciseFeedback(null)
                              setExerciseMetrics(null)
                            }
                            return next
                          })
                        }}
                      >
                        {exerciseGuidedActive ? 'Stop guided set' : 'Start guided set'}
                      </button>
                      {exerciseGuidedActive && <span className="exercise-live-pill">{postureStreamState === 'running' ? 'Live' : postureStreamState === 'no-pose' ? 'No pose' : 'Connecting'}</span>}
                    </div>
                    {exerciseGuidedActive && exerciseMetrics && (
                      <>
                        <div className="exercise-metrics">
                          <span>Reps {exerciseMetrics.rep_count}/{exerciseMetrics.target_reps}</span>
                          <span>Hold {exerciseMetrics.hold_seconds}s</span>
                          <span>Form {Math.round(exerciseMetrics.quality_score * 100)}</span>
                          <span>{exerciseMetrics.target_active ? 'Position on' : 'Position off'}</span>
                        </div>
                        <div className="exercise-progress"><div className="exercise-progress-fill" style={{ width: `${exerciseMetrics.progress_pct}%` }} /></div>
                      </>
                    )}
                    {exerciseGuidedActive && postureFrame && (
                      <div className="exercise-live-preview">
                        <img src={postureFrame} className="posture-video" alt="Guided exercise stream" />
                        {postureLandmarks?.nose && postureLandmarks.left_shoulder && postureLandmarks.right_shoulder ? (
                          <svg className="posture-landmark-svg" viewBox="0 0 100 100" preserveAspectRatio="none">
                            <line x1={postureLandmarks.left_shoulder.x * 100} y1={postureLandmarks.left_shoulder.y * 100} x2={postureLandmarks.right_shoulder.x * 100} y2={postureLandmarks.right_shoulder.y * 100} />
                            <line x1={postureLandmarks.nose.x * 100} y1={postureLandmarks.nose.y * 100} x2={(postureLandmarks.left_shoulder.x * 100 + postureLandmarks.right_shoulder.x * 100) / 2} y2={(postureLandmarks.left_shoulder.y * 100 + postureLandmarks.right_shoulder.y * 100) / 2} />
                            <circle cx={postureLandmarks.nose.x * 100} cy={postureLandmarks.nose.y * 100} r="1.4" />
                            <circle cx={postureLandmarks.left_shoulder.x * 100} cy={postureLandmarks.left_shoulder.y * 100} r="1.4" />
                            <circle cx={postureLandmarks.right_shoulder.x * 100} cy={postureLandmarks.right_shoulder.y * 100} r="1.4" />
                          </svg>
                        ) : null}
                      </div>
                    )}
                    <p className="exercise-note">{paywallMessage ?? exerciseFeedback ?? 'Live form feedback will appear here while guided mode runs.'}</p>
                  </>
                ) : (
                  <p className="main-empty">Adjust filters to pick an exercise.</p>
                )}
              </section>
            </div>
          </>
        )}

        {tab === 'settings' && (
          <>
            <h1>Settings</h1>
            <section className="prefs-panel main-settings">
              <div className="prefs-row"><label>Plan</label><strong>{isPro ? 'Pro' : 'Free'}</strong></div>
              <div className="prefs-row">
                <label>License key</label>
                <input type="text" value={licenseInput} placeholder={settings?.license_key ? `Current: ${settings.license_key.slice(0, 8)}...` : 'Enter Lemon Squeezy key'} onChange={(e) => setLicenseInput(e.target.value)} />
              </div>
              <div className="prefs-actions">
                <button className="btn-solid" onClick={() => void updateSettings({ license_key: licenseInput.trim(), plan_tier: licenseInput.trim().length > 10 ? 'pro' : 'free' })}>Activate</button>
                <button className="btn-ghost" onClick={() => void updateSettings({ license_key: '', plan_tier: 'free' })}>Remove key</button>
              </div>
              {!calibration?.calibrated && <p className="prefs-note">Baseline in progress: {calibration?.sessions_remaining ?? 0} check-ins remaining.</p>}
              <div className="prefs-row">
                <label>Session frequency</label>
                <select value={settings?.session_frequency_minutes ?? 10} onChange={(e) => void updateSettings({ session_frequency_minutes: Number(e.target.value) })}>
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
                  value={`${String(settings?.daily_report_hour ?? 21).padStart(2, '0')}:${String(settings?.daily_report_minute ?? 0).padStart(2, '0')}`}
                  onChange={(e) => {
                    const [hour, minute] = e.target.value.split(':').map(Number)
                    void updateSettings({ daily_report_hour: hour, daily_report_minute: minute })
                  }}
                />
              </div>
              <div className="prefs-row">
                <label>Pause monitoring</label>
                <button className={`toggle ${settings?.monitoring_paused ? 'is-paused' : 'is-active'}`} onClick={() => void updateSettings({ monitoring_paused: !settings?.monitoring_paused })} aria-label="Toggle monitoring">
                  <span className="knob" />
                </button>
              </div>
              <div className="prefs-actions">
                <button className="btn-ghost" onClick={replayOnboarding}>Replay onboarding</button>
                <button className="btn-danger" onClick={() => void clearAllData()}>Clear data</button>
              </div>
              <p className="prefs-meta">Last run: {lastRunSource ?? 'none'}</p>
              {error && <p className="prefs-error">{error}</p>}
            </section>
          </>
        )}
      </section>
    </main>
  )
}
