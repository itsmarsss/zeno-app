import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { CameraOff, Check, CheckCircle, ChevronRight } from 'lucide-react'
import { EXERCISE_LIBRARY } from '../../shared/constants'
import type { PostureLandmarks, SessionHistoryItem } from '../../shared/types'
import { PostureFrame } from '../common/PostureFrame'
import { InteractiveLineChart } from '../common/InteractiveLineChart'
import './PostureTab.css'
import { staggerItem } from '../../shared/motion'

type IssueKey = 'chin-forward' | 'rounded-shoulders' | 'head-tilt-right'

type PeriodKey = 'today' | 'week' | 'month'

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 100)
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

function mean(values: number[]): number | null {
  if (!values.length) return null
  return values.reduce((sum, value) => sum + value, 0) / values.length
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
}) {
  const [period, setPeriod] = useState<PeriodKey>('today')
  const sortedHistory = useMemo(
    () => [...history].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()),
    [history],
  )

  const cutoff = useMemo(() => {
    const date = new Date()
    date.setDate(date.getDate() - (daysForPeriod(period) - 1))
    if (period === 'today') {
      date.setHours(0, 0, 0, 0)
    }
    return date
  }, [period])

  const postureHistory = useMemo(
    () => sortedHistory.filter((item) => new Date(item.created_at) >= cutoff),
    [sortedHistory, cutoff],
  )

  const postureChartPoints = useMemo(
    () => {
      const now = new Date()
      if (period === 'today') {
        const start = dayStart(now)
        const intervalMinutes = 30
        const points = []
        for (let i = 0; i < 48; i += 1) {
          const slotStart = new Date(start.getTime() + i * intervalMinutes * 60_000)
          const slotEnd = new Date(slotStart.getTime() + intervalMinutes * 60_000)
          const values = postureHistory
            .filter((item) => {
              const t = new Date(item.created_at)
              return t >= slotStart && t < slotEnd
            })
            .map((item) => item.posture_score * 100)
          const avg = mean(values)
          points.push({
            id: `today-${i}`,
            label: slotStart.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
            value: avg == null ? null : Math.round(avg),
          })
        }
        return points
      }

      const dayCount = period === 'week' ? 7 : 30
      const end = dayStart(now)
      const start = new Date(end)
      start.setDate(start.getDate() - (dayCount - 1))
      const points = []
      for (let i = 0; i < dayCount; i += 1) {
        const slotStart = new Date(start)
        slotStart.setDate(start.getDate() + i)
        const slotEnd = new Date(slotStart)
        slotEnd.setDate(slotStart.getDate() + 1)
        const values = postureHistory
          .filter((item) => {
            const t = new Date(item.created_at)
            return t >= slotStart && t < slotEnd
          })
          .map((item) => item.posture_score * 100)
        const avg = mean(values)
        points.push({
          id: `${period}-${i}`,
          label:
            period === 'week'
              ? slotStart.toLocaleDateString([], { weekday: 'short' })
              : slotStart.toLocaleDateString([], { month: 'short', day: 'numeric' }),
          value: avg == null ? null : Math.round(avg),
        })
      }
      return points
    },
    [period, postureHistory],
  )

  const latestHistoryScore = postureHistory.length
    ? Math.round(postureHistory[postureHistory.length - 1].posture_score * 100)
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
  const issueCounts = useMemo(() => {
    const total = postureHistory.length
    const chinForward = postureHistory.filter((item) => item.posture_score < 0.7).length
    const rounded = postureHistory.filter((item) => item.posture_score < 0.6).length
    const tilt = postureHistory.filter((item) => item.posture_score < 0.5).length
    return {
      total,
      'chin-forward': percent(chinForward, total),
      'rounded-shoulders': percent(rounded, total),
      'head-tilt-right': percent(tilt, total),
    }
  }, [postureHistory])

  const issueRows: Array<{ key: IssueKey; label: string; pct: number }> = [
    { key: 'chin-forward', label: 'Chin forward', pct: issueCounts['chin-forward'] },
    { key: 'rounded-shoulders', label: 'Rounded shoulders', pct: issueCounts['rounded-shoulders'] },
    { key: 'head-tilt-right', label: 'Head tilt right', pct: issueCounts['head-tilt-right'] },
  ]

  const topIssue = [...issueRows].sort((a, b) => b.pct - a.pct)[0]

  const recommendedIds =
    topIssue?.key === 'chin-forward'
      ? ['chin-tuck', 'scap-squeeze']
      : topIssue?.key === 'rounded-shoulders'
        ? ['wall-angels', 'doorway-pec-stretch']
        : ['seated-side-bend', 'thoracic-extension']

  const recommended = EXERCISE_LIBRARY.filter((item) => recommendedIds.includes(item.id)).slice(0, 3)
  const coachingState = isStarting ? 'starting' : (liveScore ?? 0) < 75 ? 'action' : 'good'

  return (
    <>
      <h1>Posture</h1>

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
          <div className="period-toggle posture-period-toggle">
            {(['today', 'week', 'month'] as PeriodKey[]).map((p) => (
              <button key={p} className={period === p ? 'is-active' : ''} onClick={() => setPeriod(p)}>
                {p === 'today' ? 'Today' : p === 'week' ? 'Week' : 'Month'}
              </button>
            ))}
          </div>
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
          />
        )}
      </motion.section>

      <motion.section className="posture-card" variants={staggerItem(0.08)} initial="hidden" animate="visible">
        <h3>Common issues</h3>
        {issueCounts.total === 0 ? (
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
          <button className="posture-see-all" onClick={onSeeAllExercises}>
            See all <ChevronRight size={12} />
          </button>
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
    </>
  )
}
