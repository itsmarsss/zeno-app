import { useEffect, useMemo, useState } from 'react'
import { Activity, AlertCircle, CameraOff, CheckCircle2, User, Waves, Wind } from 'lucide-react'
import { PostureFrame } from '../common/PostureFrame'
import { buildPath, clamp, localDateKey } from '../../shared/dashboard'
import { sessionFromHistory, stressIndex } from '../../shared/metrics'
import type { PostureLandmarks, SessionHistoryItem, SessionResult } from '../../shared/types'
import './MonitorTab.css'

type MonitorMode = 'idle' | 'passive' | 'focus'

type FocusPoint = {
  at: number
  stress: number
  hrNorm: number | null
  rrNorm: number | null
}

function hrToNorm(hr: number | null | undefined): number | null {
  if (hr == null || !Number.isFinite(hr)) return null
  return clamp(((hr - 50) / 60) * 100, 0, 100)
}

function rrToNorm(rr: number | null | undefined): number | null {
  if (rr == null || !Number.isFinite(rr) || rr <= 0) return null
  return clamp(((rr - 6) / 24) * 100, 0, 100)
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return timestamp
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
}

function formatFocusTimer(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds))
  const hours = Math.floor(safe / 3600)
  const mins = Math.floor((safe % 3600) / 60)
  const secs = safe % 60
  if (hours > 0) return `${hours}h ${String(mins).padStart(2, '0')}m`
  return `${mins}m ${String(secs).padStart(2, '0')}s`
}

function stressLabel(value: number): string {
  if (value <= 30) return 'Calm'
  if (value <= 60) return 'Mild stress'
  if (value <= 80) return 'Elevated'
  return 'High stress'
}

function postureLabel(result: SessionResult | null): string {
  if (!result) return 'No posture data'
  if (result.posture_score >= 0.8) return 'Good alignment'
  if (result.posture_is_poor || result.posture_score < 0.45) return 'Chin forward'
  if (result.posture_score < 0.6) return 'Rounded shoulders'
  return 'Balanced posture'
}

export function MonitorTab({
  history,
  currentResult,
  focusModeActive,
  isCheckInRunning,
  postureFrame,
  postureLandmarks,
  postureScoreLive,
  onStartFocusMode,
  onEndFocusMode,
}: {
  history: SessionHistoryItem[]
  currentResult: SessionResult | null
  focusModeActive: boolean
  isCheckInRunning: boolean
  postureFrame: string | null
  postureLandmarks: PostureLandmarks
  postureScoreLive: number | null
  onStartFocusMode: () => void
  onEndFocusMode: () => void
}) {
  const monitorMode: MonitorMode = focusModeActive ? 'focus' : isCheckInRunning ? 'passive' : 'idle'
  const [now, setNow] = useState(() => Date.now())
  const [passiveStartedAt, setPassiveStartedAt] = useState<number | null>(null)
  const [focusStartedAt, setFocusStartedAt] = useState<number | null>(null)
  const [focusPoints, setFocusPoints] = useState<FocusPoint[]>([])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    if (monitorMode === 'passive') {
      setPassiveStartedAt((prev) => prev ?? Date.now())
    } else {
      setPassiveStartedAt(null)
    }
  }, [monitorMode])

  useEffect(() => {
    if (focusModeActive) {
      setFocusStartedAt((prev) => prev ?? Date.now())
    } else {
      setFocusStartedAt(null)
      setFocusPoints([])
    }
  }, [focusModeActive])

  useEffect(() => {
    if (!focusModeActive || !currentResult) return
    const point: FocusPoint = {
      at: Date.now(),
      stress: stressIndex(currentResult),
      hrNorm: hrToNorm(currentResult.heart_rate_bpm),
      rrNorm:
        currentResult.rr_confidence === 'none' || currentResult.respiratory_rate <= 0
          ? null
          : rrToNorm(currentResult.respiratory_rate),
    }
    setFocusPoints((prev) => {
      const next = [...prev, point]
      const maxAge = Date.now() - 5 * 60_000
      return next.filter((item) => item.at >= maxAge).slice(-80)
    })
  }, [currentResult, focusModeActive])

  const latestHistory = history[0] ? sessionFromHistory(history[0]) : null
  const lastPassiveHistory = useMemo(
    () => history.find((item) => item.mode === 'passive' && item.analysis_skipped === 0),
    [history],
  )
  const lastPassive = lastPassiveHistory ? sessionFromHistory(lastPassiveHistory) : latestHistory
  const displayResult = currentResult ?? lastPassive ?? latestHistory

  const passiveElapsedSec = passiveStartedAt ? Math.floor((now - passiveStartedAt) / 1000) : 0
  const passiveRemaining = Math.max(0, 30 - passiveElapsedSec)
  const passiveProgress = clamp((passiveElapsedSec / 30) * 100, 0, 100)
  const focusElapsed = focusStartedAt ? Math.floor((now - focusStartedAt) / 1000) : 0

  const stressValue = displayResult ? stressIndex(displayResult) : 0
  const hrValue = displayResult?.heart_rate_bpm ?? null
  const rrValue = displayResult?.respiratory_rate ?? 0
  const rrConfidence = monitorMode === 'focus' ? displayResult?.rr_confidence ?? 'none' : 'none'
  const postureValue = Math.round(((postureScoreLive ?? displayResult?.posture_score ?? 0) * 100))
  const rrConfidenceProgress = focusStartedAt ? clamp(((Date.now() - focusStartedAt) / 90_000) * 100, 0, 100) : 0
  const rrConfidenceSeconds = Math.max(0, 90 - Math.floor((Date.now() - (focusStartedAt ?? Date.now())) / 1000))

  const stressPath = buildPath(
    focusPoints.map((item) => item.stress),
    0,
    100,
    100,
    32,
  )
  const hrPath = buildPath(
    focusPoints.map((item) => item.hrNorm),
    0,
    100,
    100,
    32,
  )
  const rrPath = buildPath(
    focusPoints.map((item) => item.rrNorm),
    0,
    100,
    100,
    32,
  )

  const todayKey = localDateKey(new Date())
  const passiveMarks = history
    .filter((item) => item.mode === 'passive' && localDateKey(new Date(item.created_at)) === todayKey)
    .map((item) => new Date(item.created_at).getTime())
    .sort((a, b) => a - b)

  const timelineStart = focusPoints[0]?.at ?? Date.now() - 60 * 60_000
  const timelineEnd = focusPoints[focusPoints.length - 1]?.at ?? Date.now()
  const timelineRange = Math.max(1, timelineEnd - timelineStart)
  const passiveMarkOffsets = passiveMarks.map((ts) => clamp(((ts - timelineStart) / timelineRange) * 100, 0, 100))

  const postureAlerts = history
    .filter((item) => item.mode === 'focus' && Boolean(item.posture_is_poor))
    .slice(0, 3)
    .map((item) => `${formatTime(item.created_at)} · Chin`)

  return (
    <section className="monitor-tab">
      <div className={`monitor-banner monitor-banner--${monitorMode}`}>
        <div className="monitor-banner-left">
          <span className={`monitor-pulse monitor-pulse--${monitorMode}`} />
          {monitorMode === 'idle' && (
            <>
              <span className="monitor-banner-label">Last check-in</span>
              <span className="monitor-banner-time">
                {lastPassive ? `Today at ${formatTime(lastPassive.timestamp)}` : 'No recent snapshot'}
              </span>
            </>
          )}
          {monitorMode === 'passive' && (
            <>
              <span className="monitor-banner-label is-strong">Checking in</span>
              <span className="monitor-banner-time monitor-banner-time--accent">{passiveRemaining}s remaining</span>
            </>
          )}
          {monitorMode === 'focus' && (
            <>
              <span className="monitor-banner-label is-strong">Focus Mode</span>
              <span className="monitor-banner-time monitor-banner-time--accent">{formatFocusTimer(focusElapsed)}</span>
            </>
          )}
        </div>
        <div className="monitor-banner-right">
          {monitorMode === 'idle' && (
            <button className="monitor-banner-action" onClick={onStartFocusMode}>
              Start Focus Mode
            </button>
          )}
          {monitorMode === 'focus' && (
            <button className="monitor-banner-action monitor-banner-action--danger" onClick={onEndFocusMode}>
              End session
            </button>
          )}
        </div>
      </div>

      <div className="monitor-body">
        <div className="monitor-camera-shell">
          {monitorMode === 'idle' ? (
            <div className="monitor-camera-idle">
              <CameraOff size={24} />
              <p>Camera inactive</p>
              <span>Camera activates during check-ins and Focus Mode</span>
            </div>
          ) : (
            <div className="monitor-camera-live">
              <PostureFrame
                frame={postureFrame}
                landmarks={postureLandmarks}
                alt="Monitor camera feed"
                className="monitor-camera-frame"
              />
              <div className="monitor-camera-badge">
                <span className="monitor-camera-dot" />
                {monitorMode === 'passive' ? 'Passive capture' : 'Live'}
              </div>
              {monitorMode === 'passive' && (
                <div className="monitor-camera-progress">
                  <div className="monitor-camera-progress-fill" style={{ width: `${passiveProgress}%` }} />
                </div>
              )}
              {monitorMode === 'focus' && (
                <div className="monitor-camera-overlay">
                  <div className="monitor-camera-status">
                    {postureValue >= 80 ? <CheckCircle2 size={14} /> : <AlertCircle size={14} />}
                    <span>{postureLabel(displayResult)}</span>
                  </div>
                  <span className="monitor-camera-score">{postureValue} / 100</span>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="monitor-signals">
          <article className="monitor-card">
            <header>
              <div className="monitor-card-title">
                <Wind size={14} />
                <span>STRESS INDEX</span>
              </div>
              <span className={`monitor-mode-pill monitor-mode-pill--${monitorMode}`}>
                {monitorMode === 'focus' ? 'Live' : monitorMode === 'passive' ? 'Snapshot' : 'Last reading'}
              </span>
            </header>
            <div className="monitor-card-value">
              <strong>{displayResult ? stressValue : '—'}</strong>
            </div>
            <div className="monitor-card-sub">
              <span>{displayResult ? stressLabel(stressValue) : 'No data'}</span>
            </div>
            {monitorMode === 'focus' && <svg viewBox="0 0 100 32" preserveAspectRatio="none"><path className="signal-stress" d={stressPath} /></svg>}
          </article>

          <article className="monitor-card">
            <header>
              <div className="monitor-card-title">
                <Activity size={14} />
                <span>HEART RATE</span>
              </div>
              <span className={`monitor-mode-pill monitor-mode-pill--${monitorMode}`}>
                {monitorMode === 'focus'
                  ? rrConfidence === 'none'
                    ? 'Measuring...'
                    : rrConfidence === 'partial'
                      ? 'Stabilizing'
                      : 'Live'
                  : monitorMode === 'passive'
                    ? 'Snapshot'
                    : 'Last reading'}
              </span>
            </header>
            <div className="monitor-card-value">
              <strong>{hrValue == null ? '—' : Math.round(hrValue)}</strong>
              <em>bpm</em>
            </div>
            <div className="monitor-card-sub">
              <span>{hrValue == null ? 'No data' : hrValue < 70 ? 'Resting' : hrValue < 88 ? 'Normal' : 'Elevated'}</span>
            </div>
            {monitorMode === 'focus' && <svg viewBox="0 0 100 32" preserveAspectRatio="none"><path className="signal-hr" d={hrPath} /></svg>}
          </article>

          <article className="monitor-card">
            <header>
              <div className="monitor-card-title">
                <Waves size={14} />
                <span>RESPIRATORY RATE</span>
              </div>
              <span className={`monitor-mode-pill monitor-mode-pill--${monitorMode}`}>
                {monitorMode === 'focus' ? 'Live' : monitorMode === 'passive' ? 'Snapshot' : 'Last reading'}
              </span>
            </header>
            <div className="monitor-card-value">
              <strong>
                {monitorMode === 'focus' && rrConfidence === 'none'
                  ? '—'
                  : rrValue > 0
                    ? monitorMode === 'passive' || rrConfidence === 'partial'
                      ? `~${Math.round(rrValue)}`
                      : `${Math.round(rrValue)}`
                    : '—'}
              </strong>
              <em>bpm</em>
            </div>
            <div className="monitor-card-sub">
              <span>
                {monitorMode === 'passive'
                  ? 'Approximate'
                  : monitorMode === 'focus' && rrConfidence !== 'full'
                    ? 'Building signal...'
                    : rrValue <= 0
                      ? 'No data'
                      : rrValue <= 16
                        ? 'Normal'
                        : rrValue <= 20
                          ? 'Slightly elevated'
                          : 'Elevated'}
              </span>
            </div>
            {monitorMode === 'focus' && rrConfidence !== 'full' ? (
              <div className="monitor-rr-progress-wrap">
                <div className="monitor-rr-progress">
                  <div className="monitor-rr-progress-fill" style={{ width: `${rrConfidenceProgress}%` }} />
                </div>
                <span>Signal ready in {rrConfidenceSeconds}s</span>
              </div>
            ) : null}
            {monitorMode === 'focus' && rrConfidence === 'full' && (
              <svg viewBox="0 0 100 32" preserveAspectRatio="none">
                <path className="signal-rr" d={rrPath} />
              </svg>
            )}
          </article>

          <article className="monitor-card">
            <header>
              <div className="monitor-card-title">
                <User size={14} />
                <span>POSTURE</span>
              </div>
              <span className={`monitor-mode-pill monitor-mode-pill--${monitorMode}`}>
                {monitorMode === 'focus' ? 'Live' : monitorMode === 'passive' ? 'Snapshot' : 'Last reading'}
              </span>
            </header>
            <div className="monitor-card-value">
              <strong>{displayResult ? postureValue : '—'}</strong>
              <em>/ 100</em>
            </div>
            <div className="monitor-card-sub">
              <span>{postureLabel(displayResult)}</span>
            </div>
            {monitorMode === 'focus' && postureAlerts.length > 0 && (
              <div className="monitor-posture-pills">
                {postureAlerts.map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            )}
          </article>
        </div>
      </div>

      <div className="monitor-timeline">
        <header>
          <span>Session timeline</span>
          <em>
            {monitorMode === 'focus' && focusStartedAt
              ? `Focus session · started ${new Date(focusStartedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
              : 'Today'}
          </em>
        </header>
        {focusPoints.length === 0 ? (
          <div className="monitor-timeline-empty">
            <p>No Focus session today</p>
            <span>Start Focus Mode to begin tracking</span>
          </div>
        ) : (
          <div className="monitor-timeline-chart">
            <svg viewBox="0 0 100 36" preserveAspectRatio="none">
              {passiveMarkOffsets.map((offset, index) => (
                <line key={`${offset}-${index}`} x1={offset} y1={0} x2={offset} y2={36} className="monitor-passive-mark" />
              ))}
              <path className="signal-stress" d={buildPath(focusPoints.map((p) => p.stress), 0, 100, 100, 36)} />
              <path className="signal-hr" d={buildPath(focusPoints.map((p) => p.hrNorm), 0, 100, 100, 36)} />
              <path className="signal-rr" d={buildPath(focusPoints.map((p) => p.rrNorm), 0, 100, 100, 36)} />
            </svg>
          </div>
        )}
      </div>
    </section>
  )
}
