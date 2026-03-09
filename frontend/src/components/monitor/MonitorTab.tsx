import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertCircle, CameraOff, CheckCircle2, User, Waves, Wind } from 'lucide-react'
import { PostureFrame } from '../common/PostureFrame'
import { buildPath, clamp, localDateKey } from '../../shared/dashboard'
import { sessionFromHistory, stressIndex } from '../../shared/metrics'
import type { PostureLandmarks, SessionHistoryItem, SessionResult } from '../../shared/types'
import './MonitorTab.css'

type MonitorMode = 'idle' | 'passive' | 'focus' | 'ended'

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

function stressTone(value: number): 'calm' | 'neutral' | 'mild' | 'high' {
  if (value <= 30) return 'calm'
  if (value <= 60) return 'neutral'
  if (value <= 80) return 'mild'
  return 'high'
}

function hrTone(value: number | null, resting: number): 'calm' | 'neutral' | 'mild' | 'high' | 'muted' {
  if (value == null) return 'muted'
  if (value <= resting - 4) return 'calm'
  if (value <= resting + 8) return 'neutral'
  if (value <= resting + 20) return 'mild'
  return 'high'
}

function rrTone(value: number, mode: MonitorMode): 'calm' | 'neutral' | 'mild' | 'muted' {
  if (mode === 'passive') return 'muted'
  if (value <= 0) return 'muted'
  if (value <= 16) return 'calm'
  if (value <= 20) return 'neutral'
  return 'mild'
}

function postureTone(value: number): 'calm' | 'neutral' | 'mild' | 'high' {
  if (value >= 80) return 'calm'
  if (value >= 60) return 'neutral'
  if (value >= 40) return 'mild'
  return 'high'
}

function formatDelta(value: number | null, decimals = 0): string | null {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.05) return null
  const rounded = Number(value.toFixed(decimals))
  if (rounded === 0) return null
  return `${rounded > 0 ? '+' : ''}${rounded}`
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
  const [now, setNow] = useState(() => Date.now())
  const [passiveStartedAt, setPassiveStartedAt] = useState<number | null>(null)
  const [focusStartedAt, setFocusStartedAt] = useState<number | null>(null)
  const [focusPoints, setFocusPoints] = useState<FocusPoint[]>([])
  const [recentFocusSummary, setRecentFocusSummary] = useState<{ endedAt: number; durationSeconds: number } | null>(
    null,
  )
  const [hoveredPassiveMark, setHoveredPassiveMark] = useState<{ xPct: number; label: string } | null>(null)
  const wasFocusActiveRef = useRef(focusModeActive)

  const monitorMode: MonitorMode = recentFocusSummary
    ? 'ended'
    : focusModeActive
      ? 'focus'
      : isCheckInRunning
        ? 'passive'
        : 'idle'

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
      setRecentFocusSummary(null)
    } else {
      const wasFocusActive = wasFocusActiveRef.current
      if (wasFocusActive && focusStartedAt) {
        const durationSeconds = Math.max(0, Math.floor((Date.now() - focusStartedAt) / 1000))
        setRecentFocusSummary({
          endedAt: Date.now(),
          durationSeconds,
        })
      }
      setFocusStartedAt(null)
    }
    wasFocusActiveRef.current = focusModeActive
  }, [focusModeActive, focusStartedAt])

  useEffect(() => {
    if (!recentFocusSummary) return
    const timeout = window.setTimeout(() => setRecentFocusSummary(null), 2000)
    return () => window.clearTimeout(timeout)
  }, [recentFocusSummary])

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

  const focusHistoryPoints = useMemo<FocusPoint[]>(() => {
    const todayKey = localDateKey(new Date())
    return history
      .filter((item) => item.mode === 'focus' && localDateKey(new Date(item.created_at)) === todayKey)
      .sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
      .map((item) => ({
        at: new Date(item.created_at).getTime(),
        stress: stressIndex(sessionFromHistory(item)),
        hrNorm: hrToNorm(item.heart_rate_bpm),
        rrNorm: item.rr_confidence === 'none' || item.respiratory_rate <= 0 ? null : rrToNorm(item.respiratory_rate),
      }))
  }, [history])

  const timelinePoints = focusPoints.length > 0 ? focusPoints : focusHistoryPoints

  const passiveElapsedSec = passiveStartedAt ? Math.floor((now - passiveStartedAt) / 1000) : 0
  const passiveRemaining = Math.max(0, 30 - passiveElapsedSec)
  const passiveProgress = clamp((passiveElapsedSec / 30) * 100, 0, 100)
  const focusElapsed = focusStartedAt ? Math.floor((now - focusStartedAt) / 1000) : 0

  const stressValue = displayResult ? stressIndex(displayResult) : 0
  const hrValue = displayResult?.heart_rate_bpm ?? null
  const rrValue = displayResult?.respiratory_rate ?? 0
  const rrConfidence = focusModeActive ? displayResult?.rr_confidence ?? 'none' : 'none'
  const postureValue = Math.round((postureScoreLive ?? displayResult?.posture_score ?? 0) * 100)
  const rrConfidenceProgress = focusStartedAt ? clamp(((now - focusStartedAt) / 90_000) * 100, 0, 100) : 0
  const rrConfidenceSeconds = Math.max(0, 90 - Math.floor((now - (focusStartedAt ?? now)) / 1000))
  const restingHr = displayResult?.resting_hr ?? 75
  const restingRr = displayResult?.resting_rr ?? 14
  const baselinePosturePct = Math.round((displayResult?.baseline_posture_score ?? 0) * 100)
  const stressDelta = displayResult ? stressValue - 35 : null
  const hrDelta = hrValue == null ? null : hrValue - restingHr
  const rrDelta = rrValue > 0 ? rrValue - restingRr : null
  const postureDelta = displayResult && baselinePosturePct > 0 ? postureValue - baselinePosturePct : null

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

  const timelineStart = timelinePoints[0]?.at ?? Date.now() - 60 * 60_000
  const timelineEnd = timelinePoints[timelinePoints.length - 1]?.at ?? Date.now()
  const timelineRange = Math.max(1, timelineEnd - timelineStart)
  const passiveMarkOffsets = passiveMarks.map((ts) => ({
    ts,
    xPct: clamp(((ts - timelineStart) / timelineRange) * 100, 0, 100),
  }))

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
          {monitorMode === 'ended' && recentFocusSummary && (
            <>
              <span className="monitor-banner-label is-strong">Session complete</span>
              <span className="monitor-banner-time monitor-banner-time--accent">
                {formatFocusTimer(recentFocusSummary.durationSeconds)}
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
        <div className={`monitor-camera-shell monitor-camera-shell--${monitorMode}`}>
          {monitorMode === 'idle' || monitorMode === 'ended' ? (
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

        <div className={`monitor-signals monitor-signals--${monitorMode}`}>
          <article className="monitor-card monitor-card--stress">
            <header>
              <div className="monitor-card-title">
                <Wind size={14} />
                <span>STRESS INDEX</span>
              </div>
              <span className={`monitor-mode-pill monitor-mode-pill--${monitorMode}`}>
                {monitorMode === 'focus'
                  ? 'Live'
                  : monitorMode === 'passive'
                    ? 'Snapshot'
                    : monitorMode === 'ended'
                      ? 'Session'
                      : 'Last reading'}
              </span>
            </header>
            <div className="monitor-card-value">
              <strong className={`signal-value signal-value--${stressTone(stressValue)}`}>{displayResult ? stressValue : '—'}</strong>
            </div>
            <div className="monitor-card-sub">
              <span>{displayResult ? stressLabel(stressValue) : 'No data'}</span>
              {monitorMode === 'focus' && (
                <span className="monitor-delta">
                  {formatDelta(stressDelta) ? `${formatDelta(stressDelta)} from baseline` : 'at baseline'}
                </span>
              )}
            </div>
            {monitorMode === 'focus' && (
              <svg viewBox="0 0 100 32" preserveAspectRatio="none">
                <path className="signal-stress" d={stressPath} />
              </svg>
            )}
          </article>

          <article className="monitor-card monitor-card--hr">
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
                    : monitorMode === 'ended'
                      ? 'Session'
                      : 'Last reading'}
              </span>
            </header>
            <div className="monitor-card-value">
              <strong className={`signal-value signal-value--${hrTone(hrValue, restingHr)}`}>
                {hrValue == null ? '—' : Math.round(hrValue)}
              </strong>
              <em>bpm</em>
            </div>
            <div className="monitor-card-sub">
              <span>
                {hrValue == null
                  ? 'No data'
                  : hrValue < restingHr - 3
                    ? 'Resting'
                    : hrValue <= restingHr + 8
                      ? 'Normal'
                      : hrValue <= restingHr + 20
                        ? 'Elevated'
                        : 'High'}
              </span>
              {monitorMode === 'focus' && (
                <span className="monitor-delta">
                  {formatDelta(hrDelta, 1) ? `${formatDelta(hrDelta, 1)} from baseline` : 'at baseline'}
                </span>
              )}
            </div>
            {monitorMode === 'focus' && (
              <svg viewBox="0 0 100 32" preserveAspectRatio="none">
                <path className="signal-hr" d={hrPath} />
              </svg>
            )}
          </article>

          <article className="monitor-card monitor-card--rr">
            <header>
              <div className="monitor-card-title">
                <Waves size={14} />
                <span>RESPIRATORY RATE</span>
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
                    : monitorMode === 'ended'
                      ? 'Session'
                      : 'Last reading'}
              </span>
            </header>
            <div className="monitor-card-value">
              <strong className={`signal-value signal-value--${rrTone(rrValue, monitorMode)}`}>
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
              {monitorMode === 'focus' && (
                <span className="monitor-delta">
                  {formatDelta(rrDelta, 1) ? `${formatDelta(rrDelta, 1)} from baseline` : 'at baseline'}
                </span>
              )}
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

          <article className="monitor-card monitor-card--posture">
            <header>
              <div className="monitor-card-title">
                <User size={14} />
                <span>POSTURE</span>
              </div>
              <span className={`monitor-mode-pill monitor-mode-pill--${monitorMode}`}>
                {monitorMode === 'focus'
                  ? 'Live'
                  : monitorMode === 'passive'
                    ? 'Snapshot'
                    : monitorMode === 'ended'
                      ? 'Session'
                      : 'Last reading'}
              </span>
            </header>
            <div className="monitor-card-value">
              <strong className={`signal-value signal-value--${postureTone(postureValue)}`}>{displayResult ? postureValue : '—'}</strong>
              <em>/ 100</em>
            </div>
            <div className="monitor-card-sub">
              <span>{postureLabel(displayResult)}</span>
              {monitorMode === 'focus' && (
                <span className="monitor-delta">
                  {formatDelta(postureDelta) ? `${formatDelta(postureDelta)} from baseline` : 'at baseline'}
                </span>
              )}
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
        {timelinePoints.length === 0 ? (
          <div className="monitor-timeline-empty">
            <p>No Focus session today</p>
            <span>Start Focus Mode to begin tracking</span>
          </div>
        ) : (
          <div className="monitor-timeline-chart">
            <svg viewBox="0 0 100 36" preserveAspectRatio="none">
              {passiveMarkOffsets.map((mark, index) => (
                <line
                  key={`${mark.ts}-${index}`}
                  x1={mark.xPct}
                  y1={0}
                  x2={mark.xPct}
                  y2={36}
                  className="monitor-passive-mark"
                  onMouseEnter={() =>
                    setHoveredPassiveMark({
                      xPct: mark.xPct,
                      label: `Passive check-in · ${formatTime(new Date(mark.ts).toISOString())}`,
                    })
                  }
                  onMouseLeave={() => setHoveredPassiveMark(null)}
                />
              ))}
              <path className="signal-stress" d={buildPath(timelinePoints.map((p) => p.stress), 0, 100, 100, 36)} />
              <path className="signal-hr" d={buildPath(timelinePoints.map((p) => p.hrNorm), 0, 100, 100, 36)} />
              <path className="signal-rr" d={buildPath(timelinePoints.map((p) => p.rrNorm), 0, 100, 100, 36)} />
            </svg>
            {hoveredPassiveMark && (
              <div className="monitor-passive-tooltip" style={{ left: `${hoveredPassiveMark.xPct}%` }}>
                {hoveredPassiveMark.label}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
