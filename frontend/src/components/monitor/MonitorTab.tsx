import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertCircle, CameraOff, CheckCircle2, User, Waves, Wind } from 'lucide-react'
import { InteractiveLineChart, type InteractiveLineChartPoint } from '../common/InteractiveLineChart'
import { AnimatedTickerText } from '../common/AnimatedTickerText'
import { PostureFrame } from '../common/PostureFrame'
import { clamp, localDateKey } from '../../shared/dashboard'
import { sessionFromHistory, stressIndex } from '../../shared/metrics'
import type { PostureLandmarks, SessionHistoryItem, SessionResult } from '../../shared/types'
import './MonitorTab.css'

type MonitorMode = 'idle' | 'passive' | 'focus' | 'ended'
type TransitionPhase = 'banner' | 'camera' | 'cards' | 'settled'

type FocusPoint = {
  at: number
  stress: number
  heartRate: number | null
  respiratoryRate: number | null
  postureScore: number | null
  rrConfidence: 'none' | 'partial' | 'full'
}

type MonitorRuntimeCache = {
  passiveStartedAt: number | null
  focusStartedAt: number | null
  focusLatched: boolean
  focusPoints: FocusPoint[]
  recentFocusSummary: { endedAt: number; durationSeconds: number } | null
}

let monitorRuntimeCache: MonitorRuntimeCache = {
  passiveStartedAt: null,
  focusStartedAt: null,
  focusLatched: false,
  focusPoints: [],
  recentFocusSummary: null,
}

function formatTime(timestamp: string): string {
  const d = new Date(timestamp)
  if (Number.isNaN(d.getTime())) return timestamp
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' })
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
  if (result.posture_is_poor) {
    if (result.posture_deviation >= 0.22) return 'Chin forward'
    if (result.posture_deviation >= 0.14) return 'Rounded shoulders'
    return 'Head tilt'
  }
  if (result.posture_score < 0.58) return 'Rounded shoulders'
  if (result.posture_score < 0.68) return 'Head tilt'
  return 'Good alignment'
}

function postureLabelFromSnapshot(score: number, deviation: number, isPoor: boolean): string {
  if (score >= 0.8) return 'Good alignment'
  if (isPoor) {
    if (deviation >= 0.22) return 'Chin'
    if (deviation >= 0.14) return 'Shoulders'
    return 'Tilt'
  }
  if (score < 0.58) return 'Shoulders'
  if (score < 0.68) return 'Tilt'
  return 'Good alignment'
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

function rrTone(
  value: number,
  mode: MonitorMode,
  stage: 'measuring' | 'stabilizing' | 'live' | null,
): 'calm' | 'neutral' | 'mild' | 'muted' {
  if (mode === 'passive') return 'muted'
  if (mode === 'focus' && stage !== 'live') return 'muted'
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

function deltaTone(value: number | null): 'positive' | 'negative' | 'neutral' {
  if (value == null || !Number.isFinite(value) || Math.abs(value) < 0.05) return 'neutral'
  return value > 0 ? 'positive' : 'negative'
}

function buildChartPoints(
  points: FocusPoint[],
  getValue: (point: FocusPoint) => number | null,
): InteractiveLineChartPoint[] {
  return points
    .filter((point) => Number.isFinite(point.at))
    .map((point, index) => ({
      id: `${point.at}-${index}`,
      label: formatTime(new Date(point.at).toString()),
      value: getValue(point),
    }))
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
  const [passiveStartedAt, setPassiveStartedAt] = useState<number | null>(() =>
    monitorRuntimeCache.passiveStartedAt != null && Number.isFinite(monitorRuntimeCache.passiveStartedAt)
      ? monitorRuntimeCache.passiveStartedAt
      : null,
  )
  const [focusStartedAt, setFocusStartedAt] = useState<number | null>(() =>
    monitorRuntimeCache.focusStartedAt != null && Number.isFinite(monitorRuntimeCache.focusStartedAt)
      ? monitorRuntimeCache.focusStartedAt
      : null,
  )
  const [focusLatched, setFocusLatched] = useState<boolean>(() => monitorRuntimeCache.focusLatched)
  const [focusPoints, setFocusPoints] = useState<FocusPoint[]>(() =>
    monitorRuntimeCache.focusPoints.filter((point) => Number.isFinite(point.at)),
  )
  const [recentFocusSummary, setRecentFocusSummary] = useState<{ endedAt: number; durationSeconds: number } | null>(
    () => monitorRuntimeCache.recentFocusSummary,
  )
  const [transitionPhase, setTransitionPhase] = useState<TransitionPhase>('settled')
  const [passiveCameraClosing, setPassiveCameraClosing] = useState(false)
  const [hoveredPassiveMark, setHoveredPassiveMark] = useState<{
    xPct: number
    label: string
    align: 'left' | 'center' | 'right'
  } | null>(null)
  const [timeWindowMinutes, setTimeWindowMinutes] = useState<number>(60)

  const wasFocusActiveRef = useRef(focusModeActive)
  const endRequestedRef = useRef(false)
  const previousModeRef = useRef<MonitorMode>('idle')
  const cameraModeRef = useRef<MonitorMode>('idle')

  const hasLiveFocusResult = Boolean(currentResult && currentResult.mode === 'focus' && !currentResult.session_skipped)
  const focusSessionVisible = focusLatched || focusModeActive || hasLiveFocusResult || focusStartedAt != null
  const monitorMode: MonitorMode =
    recentFocusSummary && !focusSessionVisible
      ? 'ended'
      : focusSessionVisible
        ? 'focus'
        : isCheckInRunning
          ? 'passive'
          : 'idle'

  useEffect(() => {
    const previous = previousModeRef.current
    if (previous === monitorMode) return
    previousModeRef.current = monitorMode

    setTransitionPhase('banner')
    const cameraTimer = window.setTimeout(() => setTransitionPhase('camera'), 140)
    const cardsTimer = window.setTimeout(() => setTransitionPhase('cards'), 260)
    const settleTimer = window.setTimeout(() => setTransitionPhase('settled'), 460)

    return () => {
      window.clearTimeout(cameraTimer)
      window.clearTimeout(cardsTimer)
      window.clearTimeout(settleTimer)
    }
  }, [monitorMode])

  useEffect(() => {
    const previous = cameraModeRef.current
    cameraModeRef.current = monitorMode
    if (previous === 'passive' && monitorMode !== 'passive') {
      setPassiveCameraClosing(true)
      const timeout = window.setTimeout(() => setPassiveCameraClosing(false), 420)
      return () => window.clearTimeout(timeout)
    }
    if (monitorMode === 'passive') {
      setPassiveCameraClosing(false)
    }
  }, [monitorMode])

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    monitorRuntimeCache = {
      passiveStartedAt,
      focusStartedAt,
      focusLatched,
      focusPoints,
      recentFocusSummary,
    }
  }, [passiveStartedAt, focusStartedAt, focusLatched, focusPoints, recentFocusSummary])

  useEffect(() => {
    if (monitorMode === 'passive') {
      setPassiveStartedAt((prev) => prev ?? Date.now())
    } else {
      setPassiveStartedAt(null)
    }
  }, [monitorMode])

  useEffect(() => {
    if (focusModeActive) {
      endRequestedRef.current = false
      setFocusLatched(true)
      setFocusStartedAt((prev) => prev ?? Date.now())
      setRecentFocusSummary(null)
    } else {
      const wasFocusActive = wasFocusActiveRef.current
      if (wasFocusActive && focusStartedAt && endRequestedRef.current) {
        const durationSeconds = Math.max(0, Math.floor((Date.now() - focusStartedAt) / 1000))
        setRecentFocusSummary({ endedAt: Date.now(), durationSeconds })
        setFocusStartedAt(null)
        setFocusLatched(false)
        endRequestedRef.current = false
      }
    }
    wasFocusActiveRef.current = focusModeActive
  }, [focusModeActive, focusStartedAt])

  useEffect(() => {
    if (!hasLiveFocusResult || !currentResult) return
    setFocusLatched(true)
    setRecentFocusSummary(null)
    setFocusStartedAt((prev) => {
      if (prev != null && Number.isFinite(prev)) return prev
      const elapsedMs = Math.max(0, Math.floor(currentResult.focus_duration_seconds * 1000))
      return Date.now() - elapsedMs
    })
  }, [currentResult, hasLiveFocusResult])

  useEffect(() => {
    if (!recentFocusSummary) return
    const timeout = window.setTimeout(() => setRecentFocusSummary(null), 2000)
    return () => window.clearTimeout(timeout)
  }, [recentFocusSummary])

  useEffect(() => {
    if (!focusSessionVisible || !currentResult) return
    const point: FocusPoint = {
      at: Date.now(),
      stress: stressIndex(currentResult),
      heartRate: currentResult.heart_rate_bpm,
      respiratoryRate: currentResult.respiratory_rate > 0 ? currentResult.respiratory_rate : null,
      postureScore: Math.round(currentResult.posture_score * 100),
      rrConfidence: currentResult.rr_confidence,
    }
    setFocusPoints((prev) => {
      const next = [...prev, point]
      const maxAge = Date.now() - 5 * 60_000
      return next.filter((item) => item.at >= maxAge).slice(-80)
    })
  }, [currentResult, focusSessionVisible])

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
      .map((item) => {
        const parsedAt = new Date(item.created_at).getTime()
        const session = sessionFromHistory(item)
        return {
          at: parsedAt,
          stress: stressIndex(session),
          heartRate: item.heart_rate_bpm,
          respiratoryRate: item.respiratory_rate > 0 ? item.respiratory_rate : null,
          postureScore: Math.round(item.posture_score * 100),
          rrConfidence: item.rr_confidence,
        }
      })
      .filter((point) => Number.isFinite(point.at))
  }, [history])

  const allTimelinePoints = focusPoints.length > 0 ? focusPoints : focusHistoryPoints
  const timeWindowMs = timeWindowMinutes * 60_000
  const cutoffTime = now - timeWindowMs
  const timelinePoints = allTimelinePoints.filter((point) => point.at >= cutoffTime)
  // For mini charts: always show historical data, appending live points if in focus mode
  const cardPoints = focusPoints.length > 0
    ? [...focusHistoryPoints, ...focusPoints].filter((point) => point.at >= cutoffTime)
    : focusHistoryPoints.slice(-20)

  const passiveElapsedSec = passiveStartedAt ? Math.floor((now - passiveStartedAt) / 1000) : 0
  const passiveRemaining = Math.max(0, 30 - passiveElapsedSec)
  const passiveProgress = clamp((passiveElapsedSec / 30) * 100, 0, 100)
  const focusElapsed = hasLiveFocusResult
    ? Math.max(0, Math.floor(currentResult?.focus_duration_seconds ?? 0))
    : focusStartedAt
      ? Math.floor((now - focusStartedAt) / 1000)
      : 0
  const cameraStageActive = transitionPhase !== 'banner'
  const cardsStageActive = transitionPhase === 'cards' || transitionPhase === 'settled'
  const showLiveCamera = monitorMode === 'focus' || monitorMode === 'passive' || passiveCameraClosing
  const rrStage: 'measuring' | 'stabilizing' | 'live' | null =
    monitorMode === 'focus' ? (focusElapsed < 60 ? 'measuring' : focusElapsed < 90 ? 'stabilizing' : 'live') : null

  const stressValue = displayResult ? stressIndex(displayResult) : 0
  const hrValue = displayResult?.heart_rate_bpm ?? null
  const rrValue = displayResult?.respiratory_rate ?? 0
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

  const stressChartPoints = useMemo(() => buildChartPoints(cardPoints, (p) => p.stress), [cardPoints])
  const hrChartPoints = useMemo(() => buildChartPoints(cardPoints, (p) => p.heartRate), [cardPoints])
  const rrChartPoints = useMemo(() => buildChartPoints(cardPoints, (p) => p.respiratoryRate), [cardPoints])
  const postureChartPoints = useMemo(() => buildChartPoints(cardPoints, (p) => p.postureScore), [cardPoints])

  const timelineStressPoints = useMemo(() => buildChartPoints(timelinePoints, (p) => p.stress), [timelinePoints])
  const timelineHrValues = useMemo(() => timelinePoints.map((p) => p.heartRate), [timelinePoints])
  const timelineRrValues = useMemo(() => timelinePoints.map((p) => p.respiratoryRate), [timelinePoints])
  const timelinePostureValues = useMemo(() => timelinePoints.map((p) => p.postureScore), [timelinePoints])

  const timelineStart = Number.isFinite(timelinePoints[0]?.at)
    ? (timelinePoints[0]?.at as number)
    : Date.now() - 60 * 60_000
  const timelineEnd = Number.isFinite(timelinePoints[timelinePoints.length - 1]?.at)
    ? (timelinePoints[timelinePoints.length - 1]?.at as number)
    : Date.now()
  const timelineRange = Math.max(1, timelineEnd - timelineStart)

  const todayKey = localDateKey(new Date())
  const passiveMarks = history
    .filter((item) => item.mode === 'passive' && localDateKey(new Date(item.created_at)) === todayKey)
    .map((item) => new Date(item.created_at).getTime())
    .sort((a, b) => a - b)

  const passiveMarkOffsets = passiveMarks.map((ts) => ({
    ts,
    xPct: clamp(((ts - timelineStart) / timelineRange) * 100, 0, 100),
  }))

  const postureAlerts = history
    .filter((item) => item.mode === 'focus' && Boolean(item.posture_is_poor))
    .slice(0, 3)
    .map(
      (item) =>
        `${formatTime(item.created_at)} · ${postureLabelFromSnapshot(
          item.posture_score,
          item.posture_deviation,
          Boolean(item.posture_is_poor),
        )}`,
    )

  function showPassiveTooltip(mark: { ts: number; xPct: number }) {
    const align: 'left' | 'center' | 'right' = mark.xPct < 12 ? 'left' : mark.xPct > 88 ? 'right' : 'center'
    setHoveredPassiveMark({
      xPct: mark.xPct,
      label: `Passive check-in · ${formatTime(new Date(mark.ts).toString())}`,
      align,
    })
  }

  function handleStartFocusMode() {
    endRequestedRef.current = false
    setFocusLatched(true)
    setRecentFocusSummary(null)
    setFocusStartedAt((prev) => prev ?? Date.now())
    onStartFocusMode()
  }

  function handleEndFocusMode() {
    endRequestedRef.current = true
    if (focusStartedAt) {
      const durationSeconds = Math.max(0, Math.floor((Date.now() - focusStartedAt) / 1000))
      setRecentFocusSummary({ endedAt: Date.now(), durationSeconds })
    }
    setFocusStartedAt(null)
    setFocusLatched(false)
    onEndFocusMode()
  }

  return (
    <section className={`monitor-tab monitor-tab--phase-${transitionPhase}`}>
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
          <select
            className="monitor-timeline-window-select"
            value={timeWindowMinutes}
            onChange={(e) => setTimeWindowMinutes(Number(e.target.value))}
          >
            <option value={1}>Last 1 min</option>
            <option value={5}>Last 5 min</option>
            <option value={15}>Last 15 min</option>
            <option value={30}>Last 30 min</option>
            <option value={60}>Last 1 hour</option>
            <option value={180}>Last 3 hours</option>
          </select>
          {monitorMode === 'idle' && (
            <button className="monitor-banner-action" onClick={handleStartFocusMode}>
              Start Focus Mode
            </button>
          )}
          {monitorMode === 'focus' && (
            <button className="monitor-banner-action monitor-banner-action--danger" onClick={handleEndFocusMode}>
              End session
            </button>
          )}
        </div>
      </div>

      <div className="monitor-body">
        <div className="monitor-top">
          <div
            className={`monitor-camera-shell monitor-camera-shell--${monitorMode} ${cameraStageActive ? 'is-stage-active' : ''}`}
          >
            {!showLiveCamera ? (
              <div className="monitor-camera-idle">
                <CameraOff size={24} />
                <p>Camera inactive</p>
                <span>Camera activates during check-ins and Focus Mode</span>
              </div>
            ) : (
              <div className={`monitor-camera-live ${passiveCameraClosing ? 'is-hiding' : ''}`}>
                <PostureFrame
                  frame={postureFrame}
                  landmarks={postureLandmarks}
                  alt="Monitor camera feed"
                  className="monitor-camera-frame"
                />
                <div className="monitor-camera-badge">
                  <span className="monitor-camera-dot" />
                  {monitorMode === 'focus' ? 'Live' : 'Passive capture'}
                </div>
                {monitorMode !== 'focus' && (
                  <div className="monitor-camera-progress">
                    <div
                      className="monitor-camera-progress-fill"
                      style={{ width: `${passiveCameraClosing ? 100 : passiveProgress}%` }}
                    />
                  </div>
                )}
                {monitorMode === 'focus' && (
                  <div className="monitor-camera-overlay">
                    <div className="monitor-camera-status">
                      {postureLabel(displayResult) === 'Good alignment' ? (
                        <CheckCircle2 size={14} />
                      ) : (
                        <AlertCircle size={14} />
                      )}
                      <span>{postureLabel(displayResult)}</span>
                    </div>
                    <span className="monitor-camera-score">{postureValue} / 100</span>
                  </div>
                )}
              </div>
            )}
          </div>

          <div className={`monitor-vitals ${cardsStageActive ? 'is-stage-active' : ''}`}>
            <article className="monitor-vital">
              <span className="monitor-vital-label">Stress</span>
              <strong className={`signal-value signal-value--${stressTone(stressValue)}`}>
                {displayResult ? stressValue : '—'}
              </strong>
              <em>{displayResult ? stressLabel(stressValue) : 'No data'}</em>
            </article>
            <article className="monitor-vital">
              <span className="monitor-vital-label">Heart Rate</span>
              <strong className={`signal-value signal-value--${hrTone(hrValue, restingHr)}`}>
                {hrValue == null ? '—' : Math.round(hrValue)}
              </strong>
              <em>
                {hrValue == null
                  ? 'No data'
                  : hrValue < restingHr - 3
                    ? 'Resting'
                    : hrValue <= restingHr + 8
                      ? 'Normal'
                      : hrValue <= restingHr + 20
                        ? 'Elevated'
                        : 'High'}
              </em>
            </article>
            <article className="monitor-vital">
              <span className="monitor-vital-label">Respiratory Rate</span>
              <strong className={`signal-value signal-value--${rrTone(rrValue, monitorMode, rrStage)}`}>
                {monitorMode === 'focus' && rrStage === 'measuring'
                  ? '—'
                  : rrValue > 0
                    ? monitorMode === 'passive' || rrStage === 'stabilizing'
                      ? `~${Math.round(rrValue)}`
                      : `${Math.round(rrValue)}`
                    : '—'}
              </strong>
              <em>
                {monitorMode === 'passive'
                  ? 'Approximate'
                  : monitorMode === 'focus' && rrStage !== 'live'
                    ? 'Building signal...'
                    : rrValue <= 0
                      ? 'No data'
                      : rrValue <= 16
                        ? 'Normal'
                        : rrValue <= 20
                          ? 'Slightly elevated'
                          : 'Elevated'}
              </em>
            </article>
            <article className="monitor-vital">
              <span className="monitor-vital-label">Posture</span>
              <strong className={`signal-value signal-value--${postureTone(postureValue)}`}>
                {displayResult ? postureValue : '—'}
              </strong>
              <em>{postureLabel(displayResult)}</em>
            </article>
          </div>
        </div>

        <div className={`monitor-signals monitor-signals--${monitorMode} ${cardsStageActive ? 'is-stage-active' : ''}`}>
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
              <strong className={`signal-value signal-value--${stressTone(stressValue)}`}>
                {displayResult ? stressValue : '—'}
              </strong>
            </div>
            <div className="monitor-card-sub">
              <span>{displayResult ? stressLabel(stressValue) : 'No data'}</span>
              {monitorMode === 'focus' && (
                <span className={`monitor-delta monitor-delta--${deltaTone(stressDelta)}`}>
                  {formatDelta(stressDelta) ? `${formatDelta(stressDelta)} from baseline` : 'at baseline'}
                </span>
              )}
            </div>
            {stressChartPoints.length > 1 && (
              <InteractiveLineChart
                className="monitor-mini-chart"
                points={stressChartPoints}
                yMin={0}
                yMax={100}
                valueLabel="Stress"
                lineClassName="signal-stress"
                areaClassName="monitor-mini-area"
                areaGradientId="monitorStressCardGradient"
                areaGradientColor="var(--accent)"
                showAxis={false}
                chartHeight={58}
                tooltipWidth={138}
              />
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
                  ? rrStage === 'measuring'
                    ? 'Measuring...'
                    : rrStage === 'stabilizing'
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
                <span className={`monitor-delta monitor-delta--${deltaTone(hrDelta)}`}>
                  {formatDelta(hrDelta, 1) ? `${formatDelta(hrDelta, 1)} from baseline` : 'at baseline'}
                </span>
              )}
            </div>
            {hrChartPoints.length > 1 && (
              <InteractiveLineChart
                className="monitor-mini-chart"
                points={hrChartPoints}
                yMin={50}
                yMax={120}
                valueLabel="Heart"
                valueSuffix=" bpm"
                lineClassName="signal-hr"
                areaClassName="monitor-mini-area"
                areaGradientId="monitorHrCardGradient"
                areaGradientColor="var(--border-default)"
                showAxis={false}
                chartHeight={58}
                tooltipWidth={138}
              />
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
                  ? rrStage === 'measuring'
                    ? 'Measuring...'
                    : rrStage === 'stabilizing'
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
              <strong className={`signal-value signal-value--${rrTone(rrValue, monitorMode, rrStage)}`}>
                {monitorMode === 'focus' && rrStage === 'measuring'
                  ? '—'
                  : rrValue > 0
                    ? monitorMode === 'passive' || rrStage === 'stabilizing'
                      ? `~${Math.round(rrValue)}`
                      : `${Math.round(rrValue)}`
                    : '—'}
              </strong>
              <em>bpm</em>
            </div>
            <div className="monitor-card-sub">
              <span className={monitorMode === 'focus' && rrStage !== 'live' ? 'monitor-subtle-status' : undefined}>
                {monitorMode === 'passive'
                  ? 'Approximate'
                  : monitorMode === 'focus' && rrStage !== 'live'
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
                <span className={`monitor-delta monitor-delta--${deltaTone(rrDelta)}`}>
                  {formatDelta(rrDelta, 1) ? `${formatDelta(rrDelta, 1)} from baseline` : 'at baseline'}
                </span>
              )}
            </div>
            {monitorMode === 'focus' && rrStage !== 'live' ? (
              <div className="monitor-rr-progress-wrap">
                <div className="monitor-rr-progress">
                  <div className="monitor-rr-progress-fill" style={{ width: `${rrConfidenceProgress}%` }} />
                </div>
                <span>Signal ready in {rrConfidenceSeconds}s</span>
              </div>
            ) : null}
            {rrChartPoints.length > 1 && (
              <InteractiveLineChart
                className="monitor-mini-chart"
                points={rrChartPoints}
                yMin={6}
                yMax={30}
                valueLabel="Resp"
                valueSuffix=" bpm"
                lineClassName="signal-rr"
                areaClassName="monitor-mini-area"
                areaGradientId="monitorRrCardGradient"
                areaGradientColor="var(--state-mild)"
                showAxis={false}
                chartHeight={58}
                tooltipWidth={138}
                renderTooltip={({ point, index, direction }) => {
                  const row = cardPoints[index]
                  if (!row) return null
                  const rrValue = row.respiratoryRate
                  const displayValue =
                    rrValue == null
                      ? '--'
                      : row.rrConfidence === 'partial'
                        ? `~${Math.round(rrValue)}`
                        : `${Math.round(rrValue)}`
                  return (
                    <>
                      <p>
                        <AnimatedTickerText value={point.label} direction={direction} />
                      </p>
                      <div className="interactive-chart-tooltip-row">
                        <strong>
                          <AnimatedTickerText value={displayValue} direction={direction} />
                        </strong>
                        <span>Resp bpm</span>
                      </div>
                    </>
                  )
                }}
              />
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
              <strong className={`signal-value signal-value--${postureTone(postureValue)}`}>
                {displayResult ? postureValue : '—'}
              </strong>
              <em>/ 100</em>
            </div>
            <div className="monitor-card-sub">
              <span>{postureLabel(displayResult)}</span>
              {monitorMode === 'focus' && (
                <span className={`monitor-delta monitor-delta--${deltaTone(postureDelta)}`}>
                  {formatDelta(postureDelta) ? `${formatDelta(postureDelta)} from baseline` : 'at baseline'}
                </span>
              )}
            </div>
            {postureChartPoints.length > 1 && (
              <InteractiveLineChart
                className="monitor-mini-chart"
                points={postureChartPoints}
                yMin={0}
                yMax={100}
                valueLabel="Posture"
                lineClassName="signal-posture"
                areaClassName="monitor-mini-area"
                areaGradientId="monitorPostureCardGradient"
                areaGradientColor="var(--state-calm)"
                showAxis={false}
                chartHeight={58}
                tooltipWidth={138}
              />
            )}
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
            <InteractiveLineChart
              className="monitor-timeline-interactive"
              points={timelineStressPoints}
              yMin={0}
              yMax={100}
              valueLabel="Stress"
              lineClassName="signal-stress"
              areaClassName="monitor-timeline-area"
              areaGradientId="monitorStressGradient"
              areaGradientColor="var(--accent)"
              showAxis={false}
              chartHeight={180}
              tooltipWidth={166}
              extraLines={[
                { values: timelineHrValues, yMin: 50, yMax: 120, className: 'signal-hr', smooth: false },
                { values: timelineRrValues, yMin: 6, yMax: 30, className: 'signal-rr', smooth: false },
                { values: timelinePostureValues, yMin: 0, yMax: 100, className: 'signal-posture', smooth: false },
              ]}
              renderTooltip={({ point, index, direction }) => {
                const row = timelinePoints[index]
                if (!row) return null
                return (
                  <>
                    <p>
                      <AnimatedTickerText value={point.label} direction={direction} />
                    </p>
                    <div className="interactive-chart-tooltip-row">
                      <strong>
                        <AnimatedTickerText value={`${row.stress}`} direction={direction} />
                      </strong>
                      <span>Stress</span>
                    </div>
                    <div className="interactive-chart-tooltip-row">
                      <strong>
                        <AnimatedTickerText
                          value={row.heartRate == null ? '--' : `${Math.round(row.heartRate)}`}
                          direction={direction}
                        />
                      </strong>
                      <span>HR</span>
                    </div>
                    <div className="interactive-chart-tooltip-row">
                      <strong>
                        <AnimatedTickerText
                          value={
                            row.respiratoryRate == null
                              ? '--'
                              : row.rrConfidence === 'partial'
                                ? `~${Math.round(row.respiratoryRate)}`
                                : `${Math.round(row.respiratoryRate)}`
                          }
                          direction={direction}
                        />
                      </strong>
                      <span>RR</span>
                    </div>
                    <div className="interactive-chart-tooltip-row">
                      <strong>
                        <AnimatedTickerText
                          value={row.postureScore == null ? '--' : `${row.postureScore}`}
                          direction={direction}
                        />
                      </strong>
                      <span>Posture</span>
                    </div>
                  </>
                )
              }}
            />

            <div className="monitor-passive-overlay" aria-hidden>
              {passiveMarkOffsets.map((mark, index) => (
                <button
                  type="button"
                  key={`${mark.ts}-${index}`}
                  className="monitor-passive-mark-hit"
                  style={{ left: `${mark.xPct}%` }}
                  onMouseEnter={() => showPassiveTooltip(mark)}
                  onMouseLeave={() => setHoveredPassiveMark(null)}
                  onClick={() =>
                    setHoveredPassiveMark((prev) =>
                      prev?.xPct === mark.xPct && prev?.label.includes('Passive check-in')
                        ? null
                        : {
                            xPct: mark.xPct,
                            label: `Passive check-in · ${formatTime(new Date(mark.ts).toISOString())}`,
                            align: mark.xPct < 12 ? 'left' : mark.xPct > 88 ? 'right' : 'center',
                          },
                    )
                  }
                  onTouchStart={() => showPassiveTooltip(mark)}
                >
                  <span className="monitor-passive-mark" />
                </button>
              ))}
            </div>

            {hoveredPassiveMark && (
              <div
                className={`monitor-passive-tooltip monitor-passive-tooltip--${hoveredPassiveMark.align}`}
                style={{ left: `${hoveredPassiveMark.xPct}%` }}
              >
                {hoveredPassiveMark.label}
              </div>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
