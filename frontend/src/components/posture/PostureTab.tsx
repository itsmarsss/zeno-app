import { useEffect, useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CameraOff, Check, CheckCircle, ChevronRight, Loader2, X } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import { EXERCISE_LIBRARY } from '../../shared/constants'
import type { PostureInsights, PostureLandmarks, SessionHistoryItem } from '../../shared/types'
import { PostureFrame } from '../common/PostureFrame'
import { InteractiveLineChart } from '../common/InteractiveLineChart'
import './PostureTab.css'
import { staggerItem } from '../../shared/motion'

type IssueKey = 'chin-forward' | 'rounded-shoulders' | 'head-tilt-right'

type PeriodKey = 'today' | 'week' | 'month'
type TimelinePoint = {
  created_at: string
  posture_score?: number | null
  point_type?: 'passive' | 'focus' | 'filled' | 'unknown'
}
type MonitorTimelineResponse = {
  points?: TimelinePoint[]
}

type RecalibrateResponse = {
  ok?: boolean
  error?: string
  samples?: number
  accepted_samples?: number
  baseline_posture_score?: number
  baseline_confidence?: number
}

function daysForPeriod(period: PeriodKey): number {
  if (period === 'today') return 1
  if (period === 'week') return 7
  return 30
}

function dayStart(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  return d
}

function isTauriRuntime(): boolean {
  return typeof window !== 'undefined' && Boolean((window as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__)
}

export function PostureTab({
  postureStreamState,
  postureScoreLive,
  postureTrackingConfidence,
  postureHeadOffsetNorm,
  postureShoulderTiltSignedNorm,
  postureShoulderTiltNorm,
  postureStabilityStd,
  postureStabilityLabel,
  postureFrame,
  postureLandmarks,
  postureStreamError,
  history,
  onSeeAllExercises,
  onStartExercise,
  onRecalibrateBaseline,
}: {
  postureStreamState: 'stopped' | 'connecting' | 'running' | 'no-pose' | 'error'
  postureScoreLive: number | null
  postureTrackingConfidence: number | null
  postureHeadOffsetNorm: number | null
  postureShoulderTiltSignedNorm: number | null
  postureShoulderTiltNorm: number | null
  postureStabilityStd: number | null
  postureStabilityLabel: string | null
  postureFrame: string | null
  postureLandmarks: PostureLandmarks
  postureStreamError: string | null
  history: SessionHistoryItem[]
  onSeeAllExercises: () => void
  onStartExercise: (exerciseId: string) => void
  onRecalibrateBaseline: (seconds: number) => Promise<RecalibrateResponse>
}) {
  const RECAL_SECONDS = 10
  const [period, setPeriod] = useState<PeriodKey>('today')
  const [postureInsights, setPostureInsights] = useState<PostureInsights | null>(null)
  const [postureTimeline, setPostureTimeline] = useState<TimelinePoint[]>([])
  const [showRecalModal, setShowRecalModal] = useState(false)
  const [recalibrating, setRecalibrating] = useState(false)
  const [recalError, setRecalError] = useState<string | null>(null)
  const [recalResult, setRecalResult] = useState<RecalibrateResponse | null>(null)
  const [captureRemaining, setCaptureRemaining] = useState(RECAL_SECONDS)
  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [history],
  )
  const historyRevision = `${history.length}:${history[0]?.id ?? 0}:${history[history.length - 1]?.id ?? 0}`

  useEffect(() => {
    let cancelled = false

    async function fetchPostureTimeline() {
      if (!isTauriRuntime()) {
        setPostureTimeline([])
        return
      }
      try {
        const now = new Date()
        const start = dayStart(now)
        const end = new Date()
        end.setHours(23, 59, 59, 999)
        let bucketSeconds = 30 * 60
        if (period === 'week') {
          start.setDate(start.getDate() - 6)
          bucketSeconds = 24 * 60 * 60
        } else if (period === 'month') {
          start.setDate(start.getDate() - 29)
          bucketSeconds = 24 * 60 * 60
        }
        const payload = await invoke<MonitorTimelineResponse>('run_monitor_timeline', {
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          fillFromPrevious: true,
          bucketSeconds,
          aggregateMode: 'mean',
        })
        if (cancelled) return
        setPostureTimeline(Array.isArray(payload?.points) ? payload.points : [])
      } catch (error) {
        if (cancelled) return
        console.error('Failed to fetch posture timeline:', error)
        setPostureTimeline([])
      }
    }

    void fetchPostureTimeline()
    return () => {
      cancelled = true
    }
  }, [period, historyRevision])

  const postureChartPoints = useMemo(() => {
    return postureTimeline.map((point, index) => {
      const at = new Date(point.created_at)
      const label =
        period === 'today'
          ? at.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })
          : `${at.toLocaleDateString([], { weekday: 'short' })} · ${at.toLocaleDateString([], {
              month: 'short',
              day: 'numeric',
            })}`
      const pointType: 'passive' | 'focus' | 'filled' | 'unknown' =
        point.point_type === 'focus'
          ? 'focus'
          : point.point_type === 'passive'
            ? 'passive'
            : point.point_type === 'filled'
              ? 'filled'
              : 'unknown'
      return {
        id: `${period}-${index}`,
        label,
        value: typeof point.posture_score === 'number' ? Math.round(point.posture_score * 100) : null,
        pointType,
      }
    })
  }, [period, postureTimeline])

  const latestHistoryScore = sortedHistory.length
    ? Math.round(sortedHistory[sortedHistory.length - 1].posture_score * 100)
    : 0
  const isStarting = postureStreamState === 'connecting'
  const liveScore = isStarting
    ? null
    : postureScoreLive == null
      ? latestHistoryScore
      : Math.round(postureScoreLive * 100)

  const status =
    liveScore == null
      ? null
      : liveScore >= 75
        ? { title: 'Good alignment', detail: 'Your shoulders are level and spine neutral.', tone: 'good' as const }
        : liveScore >= 58
          ? { title: 'Chin forward', detail: 'Bring your chin back toward your neck.', tone: 'warn' as const }
          : { title: 'Slouching', detail: 'Roll shoulders back and lift through your chest.', tone: 'bad' as const }

  const shoulderDelta = useMemo(() => {
    if (postureShoulderTiltSignedNorm != null) {
      return Math.round(postureShoulderTiltSignedNorm * 22)
    }
    if (postureLandmarks?.left_shoulder && postureLandmarks?.right_shoulder) {
      return Math.round((postureLandmarks.left_shoulder.y - postureLandmarks.right_shoulder.y) * 40)
    }
    return 0
  }, [postureShoulderTiltSignedNorm, postureLandmarks])
  const spineAngle = liveScore == null ? 0 : Math.max(6, Math.round((100 - liveScore) * 0.22 + 8))
  const issueRows: Array<{ key: IssueKey; label: string; pct: number }> = postureInsights?.issue_rows ?? []
  const topIssue = issueRows[0] ?? null
  const recommendedIds = postureInsights?.recommended_ids ?? []
  const recommended = EXERCISE_LIBRARY.filter((item) => recommendedIds.includes(item.id)).slice(0, 3)
  const coachingState = isStarting ? 'starting' : (liveScore ?? 0) < 75 ? 'action' : 'good'

  async function startRecalibration() {
    setRecalibrating(true)
    setRecalError(null)
    setRecalResult(null)
    setCaptureRemaining(RECAL_SECONDS)
    try {
      const payload = await onRecalibrateBaseline(RECAL_SECONDS)
      if (!payload?.ok) {
        setRecalError(payload?.error ?? 'Recalibration failed. Please retry.')
        return
      }
      setRecalResult(payload)
    } catch (error) {
      setRecalError(error instanceof Error ? error.message : 'Recalibration failed. Please retry.')
    } finally {
      setRecalibrating(false)
    }
  }

  useEffect(() => {
    if (!recalibrating) return
    const started = Date.now()
    const timer = window.setInterval(() => {
      const elapsed = (Date.now() - started) / 1000
      const remaining = Math.max(0, RECAL_SECONDS - elapsed)
      setCaptureRemaining(remaining)
    }, 100)
    return () => window.clearInterval(timer)
  }, [recalibrating])

  useEffect(() => {
    let cancelled = false

    async function fetchPostureInsights() {
      if (!isTauriRuntime()) {
        setPostureInsights(null)
        return
      }

      const days = daysForPeriod(period)
      try {
        const payload = await invoke<PostureInsights>('run_posture_insights', { days })
        if (cancelled) return
        const sortedRows = [...(payload?.issue_rows ?? [])].sort((a, b) => b.pct - a.pct)
        setPostureInsights(
          payload
            ? {
                ...payload,
                issue_rows: sortedRows,
              }
            : null,
        )
      } catch (error) {
        if (cancelled) return
        console.error('Failed to fetch posture insights:', error)
        setPostureInsights(null)
      }
    }

    void fetchPostureInsights()
    return () => {
      cancelled = true
    }
  }, [period, historyRevision])

  return (
    <>
      <h1>Posture</h1>
      <motion.section className="posture-scope-bar" variants={staggerItem(0)} initial="hidden" animate="visible">
        <span>Scope</span>
        <div className="posture-scope-actions">
          <div className="period-toggle posture-period-toggle">
            {(['today', 'week', 'month'] as PeriodKey[]).map((p) => (
              <button key={p} className={period === p ? 'is-active' : ''} onClick={() => setPeriod(p)}>
                {p === 'today' ? 'Today' : p === 'week' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
          <button className="btn-ghost posture-recal-btn" onClick={() => setShowRecalModal(true)}>
            Recalibrate
          </button>
        </div>
      </motion.section>

      <motion.section className="posture-live-grid" variants={staggerItem(0)} initial="hidden" animate="visible">
        <div className="posture-feed-wrap">
          <PostureFrame
            frame={postureFrame}
            landmarks={postureLandmarks}
            alt="Posture stream"
            className="posture-preview posture-preview--live"
          />
          {!postureFrame && (
            <div className="posture-camera-off">
              <CameraOff size={24} />
              <p>Camera inactive</p>
            </div>
          )}
          <motion.div className="posture-live-badge" layout>
            <span />
            {postureStreamState === 'running' ? 'Live' : postureStreamState === 'connecting' ? 'Starting' : 'Ready'}
          </motion.div>
          <div className="posture-feed-gradient">
            <div className="posture-score-badge">
              <strong>{liveScore || '--'}</strong>
              <span>posture score</span>
            </div>
          </div>
        </div>

        <div className="posture-coaching">
          <div>
            <p className="posture-eyebrow">right now</p>
            <AnimatePresence mode="wait" initial={false}>
              {isStarting ? (
                <motion.div
                  key="loading-title"
                  className="posture-status-loader posture-status-loader--title"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                />
              ) : (
                <motion.h2
                  key={status?.title ?? 'ready'}
                  className={`posture-status is-${status?.tone ?? 'good'}`}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {status?.title ?? 'Ready'}
                </motion.h2>
              )}
            </AnimatePresence>
            <AnimatePresence mode="wait" initial={false}>
              {isStarting ? (
                <motion.div
                  key="loading-sub"
                  className="posture-status-loader posture-status-loader--sub"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                />
              ) : (
                <motion.p
                  key={status?.detail ?? 'ready-sub'}
                  className="posture-status-sub"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {status?.detail ?? 'Camera ready.'}
                </motion.p>
              )}
            </AnimatePresence>

            <hr />

            <div className="posture-metric-row">
              <span>Head position</span>
              <div className={`posture-bar ${isStarting ? 'is-loading' : ''}`}>
                <i style={{ width: `${Math.max(12, liveScore ?? 0)}%` }} />
              </div>
              <em>{isStarting ? '...' : (liveScore ?? 0) >= 75 ? 'Good' : 'Adjust'}</em>
            </div>
            <div className="posture-metric-row">
              <span>Shoulder level</span>
              <div className={`posture-bar ${isStarting ? 'is-loading' : ''}`}>
                <i style={{ width: `${Math.max(8, 100 - Math.min(40, Math.abs(shoulderDelta) * 2))}%` }} />
              </div>
              <em>{isStarting ? '...' : `${shoulderDelta >= 0 ? '+' : ''}${shoulderDelta}°`}</em>
            </div>
            <div className="posture-metric-row">
              <span>Spine angle</span>
              <div className={`posture-bar ${isStarting ? 'is-loading' : ''}`}>
                <i style={{ width: `${Math.max(8, 100 - spineAngle)}%` }} />
              </div>
              <em>{isStarting ? '...' : `${spineAngle}°`}</em>
            </div>

            <div className="posture-diagnostics">
              <div className="posture-diagnostic">
                <span>Head offset</span>
                <strong>
                  {isStarting
                    ? '--'
                    : postureHeadOffsetNorm != null
                      ? `${
                          Math.abs(postureHeadOffsetNorm) < 0.05
                            ? 'Centered'
                            : postureHeadOffsetNorm > 0
                              ? 'Right drift'
                              : 'Left drift'
                        } · ${postureHeadOffsetNorm > 0 ? '+' : ''}${Math.round(postureHeadOffsetNorm * 100)}%`
                      : 'No signal'}
                </strong>
              </div>
              <div className="posture-diagnostic">
                <span>Shoulder tilt</span>
                <strong>
                  {isStarting
                    ? '--'
                    : postureShoulderTiltSignedNorm != null
                      ? `${postureShoulderTiltSignedNorm > 0 ? '+' : ''}${Math.round(postureShoulderTiltSignedNorm * 22)}°`
                      : postureShoulderTiltNorm != null
                        ? `${Math.round(postureShoulderTiltNorm * 22)}°`
                      : 'No signal'}
                </strong>
              </div>
              <div className="posture-diagnostic">
                <span>Tracking confidence</span>
                <strong>
                  {isStarting
                    ? '--'
                    : postureTrackingConfidence != null
                      ? `${Math.round(postureTrackingConfidence * 100)}%`
                      : 'Unknown'}
                </strong>
              </div>
              <div className="posture-diagnostic">
                <span>Stability</span>
                <strong>
                  {postureStabilityStd != null
                    ? `${(postureStabilityLabel ?? 'learning').replace(/^./, (c) => c.toUpperCase())} · ±${Math.round(
                        postureStabilityStd * 100,
                      )}%`
                    : 'Learning'}
                </strong>
              </div>
            </div>
          </div>

          <AnimatePresence mode="wait" initial={false}>
            {coachingState === 'action' ? (
              <motion.button
                key="coaching-action"
                className="btn-solid posture-cta"
                onClick={() => onStartExercise(recommended[0]?.id ?? 'chin-tuck')}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                {topIssue?.key === 'chin-forward'
                  ? 'Fix chin position'
                  : topIssue?.key === 'rounded-shoulders'
                    ? 'Open your chest'
                    : 'Relax shoulders'}
              </motion.button>
            ) : coachingState === 'good' ? (
              <motion.p
                key="coaching-good"
                className="posture-all-good"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                <Check size={16} /> Looking good
              </motion.p>
            ) : (
              <motion.p
                key="coaching-starting"
                className="posture-all-good posture-all-good--muted"
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.2 }}
              >
                Starting camera...
              </motion.p>
            )}
          </AnimatePresence>
        </div>
      </motion.section>

      <motion.section className="posture-card" variants={staggerItem(0.04)} initial="hidden" animate="visible">
        <div className="main-panel-head">
          <h3>Posture over time</h3>
        </div>
        {postureChartPoints.every((point) => point.value == null) ? (
          <p className="posture-empty">
            <CheckCircle size={16} /> Not enough posture history yet
          </p>
        ) : (
          <InteractiveLineChart
            className="posture-history-chart"
            points={postureChartPoints}
            yMin={0}
            yMax={100}
            areaGradientId="postureGradient"
            areaGradientColor="var(--state-calm)"
            thresholdValue={70}
            thresholdLabel="Good threshold"
            valueLabel="Posture"
            valueSuffix="/100"
            lineClassName="posture-line"
            areaClassName="posture-area"
            thresholdClassName="posture-threshold"
            snapToPointTypes={['passive']}
            snapRadiusPx={12}
            markerPointTypes={['passive']}
            markerClassName="posture-passive-marker"
          />
        )}
      </motion.section>

      <motion.section className="posture-card" variants={staggerItem(0.08)} initial="hidden" animate="visible">
        <div className="main-panel-head">
          <h3>Common issues</h3>
          <span className="posture-scope-note">
            {period === 'today' ? 'Today' : period === 'week' ? 'Last 7 days' : 'Last 30 days'}
          </span>
        </div>
        {!postureInsights || postureInsights.total_sessions === 0 ? (
          <p className="posture-empty">
            <CheckCircle size={16} /> No recurring issues detected
          </p>
        ) : (
          <div className="posture-issues">
            {issueRows.map((issue) => (
              <div key={issue.key} className="posture-issue-row">
                <span
                  className={`posture-issue-dot ${issue.pct > 50 ? 'is-high' : issue.pct >= 20 ? 'is-mid' : 'is-low'}`}
                />
                <strong>{issue.label}</strong>
                <div className="posture-issue-bar">
                  <i style={{ width: `${issue.pct}%` }} />
                </div>
                <em>{issue.pct}%</em>
              </div>
            ))}
          </div>
        )}
      </motion.section>

      <motion.section
        className="posture-card posture-reco-card"
        variants={staggerItem(0.12)}
        initial="hidden"
        animate="visible"
      >
        <div className="main-panel-head">
          <h3>Recommended for you</h3>
          <div className="posture-head-actions">
            <span className="posture-scope-note">
              {period === 'today' ? 'Today' : period === 'week' ? 'Last 7 days' : 'Last 30 days'}
            </span>
            <button className="posture-see-all" onClick={onSeeAllExercises}>
              See all <ChevronRight size={12} />
            </button>
          </div>
        </div>
        <div className="posture-reco-strip">
          {recommended.map((exercise) => (
            <article key={exercise.id} className="posture-reco-item">
              <p className="posture-reco-kicker">
                {topIssue?.key === 'chin-forward'
                  ? 'For chin forward'
                  : topIssue?.key === 'rounded-shoulders'
                    ? 'For rounded shoulders'
                    : 'For posture balance'}
              </p>
              <h4>{exercise.name}</h4>
              <p className="posture-reco-target">{exercise.target}</p>
              <div className="posture-reco-meta">
                <span>{exercise.duration_minutes}m</span>
                <span>{exercise.difficulty}</span>
                <span>{exercise.space}</span>
              </div>
              <button className="posture-reco-cta" onClick={() => onStartExercise(exercise.id)}>
                Start exercise
              </button>
            </article>
          ))}
        </div>
      </motion.section>

      {postureStreamError ? <p className="main-empty">{postureStreamError}</p> : null}

      <AnimatePresence>
        {showRecalModal && (
          <motion.div
            className="posture-modal-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => {
              if (!recalibrating) {
                setShowRecalModal(false)
                setRecalError(null)
                setRecalResult(null)
              }
            }}
          >
            <motion.section
              className="posture-modal"
              initial={{ y: 16, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 16, opacity: 0 }}
              onClick={(event) => event.stopPropagation()}
            >
              <div className="posture-modal-head">
                <h3>Recalibrate posture baseline</h3>
                <button
                  className="posture-modal-close"
                  onClick={() => {
                    if (!recalibrating) {
                      setShowRecalModal(false)
                      setRecalError(null)
                      setRecalResult(null)
                    }
                  }}
                  disabled={recalibrating}
                >
                  <X size={14} />
                </button>
              </div>

              <p className="posture-modal-copy">
                Sit in your natural upright posture. Keep your shoulders visible and hold still while Zeno captures a new baseline.
              </p>
              <div className="posture-modal-preview">
                <PostureFrame
                  frame={postureFrame}
                  landmarks={postureLandmarks}
                  alt="Baseline calibration preview"
                  className="posture-preview posture-preview--modal"
                />
                <div className="posture-modal-preview-badge">
                  {postureStreamState === 'running' ? 'Live camera' : 'Camera preparing'}
                </div>
              </div>
              <ol className="posture-modal-list">
                <li>Face camera head-on with shoulders in frame.</li>
                <li>Plant feet and relax your shoulders down.</li>
                <li>Look at screen naturally for 10 seconds.</li>
              </ol>

              {recalibrating && (
                <>
                  <p className="posture-modal-progress">
                    <Loader2 size={14} className="spin" /> Capturing baseline... {Math.ceil(captureRemaining)}s
                  </p>
                  <div className="posture-modal-progressbar">
                    <i style={{ width: `${Math.min(100, Math.max(0, ((RECAL_SECONDS - captureRemaining) / RECAL_SECONDS) * 100))}%` }} />
                  </div>
                </>
              )}
              {recalError && <p className="posture-modal-error">{recalError}</p>}
              {recalResult?.ok && (
                <p className="posture-modal-success">
                  Baseline updated. Score {Math.round((recalResult.baseline_posture_score ?? 0) * 100)} · Confidence{' '}
                  {Math.round((recalResult.baseline_confidence ?? 0) * 100)}% · Samples {recalResult.accepted_samples ?? 0}.
                </p>
              )}

              <div className="posture-modal-actions">
                <button
                  className="btn-ghost"
                  onClick={() => {
                    if (!recalibrating) {
                      setShowRecalModal(false)
                      setRecalError(null)
                      setRecalResult(null)
                    }
                  }}
                  disabled={recalibrating}
                >
                  {recalResult?.ok ? 'Done' : 'Cancel'}
                </button>
                <button
                  className="btn-solid"
                  onClick={() => void startRecalibration()}
                  disabled={recalibrating || postureStreamState === 'connecting'}
                >
                  {recalibrating ? 'Recalibrating…' : 'Start 10s capture'}
                </button>
              </div>
            </motion.section>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  )
}
