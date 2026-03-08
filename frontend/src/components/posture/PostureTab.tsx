import { useMemo, useState } from 'react'
import { CameraOff, Check, CheckCircle, ChevronRight } from 'lucide-react'
import { EXERCISE_LIBRARY } from '../../shared/constants'
import type { PostureLandmarks, SessionHistoryItem } from '../../shared/types'
import { PostureFrame } from '../common/PostureFrame'
import './PostureTab.css'

type IssueKey = 'chin-forward' | 'rounded-shoulders' | 'head-tilt-right'

type PeriodKey = 'today' | 'week' | 'month'

function percent(numerator: number, denominator: number): number {
  if (denominator <= 0) return 0
  return Math.round((numerator / denominator) * 100)
}

function makePath(values: number[]): string {
  if (!values.length) return ''
  return values
    .map((value, index) => {
      const x = values.length === 1 ? 0 : (index / (values.length - 1)) * 100
      const y = 100 - Math.max(0, Math.min(100, value))
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

function daysForPeriod(period: PeriodKey): number {
  if (period === 'today') return 1
  if (period === 'week') return 7
  return 30
}

export function PostureTab({
  postureStreamState,
  postureScoreLive,
  postureFrame,
  postureLandmarks,
  postureStreamError,
  history,
  onSeeAllExercises,
  onStartExercise,
}: {
  postureStreamState: 'stopped' | 'connecting' | 'running' | 'no-pose' | 'error'
  postureScoreLive: number | null
  postureFrame: string | null
  postureLandmarks: PostureLandmarks
  postureStreamError: string | null
  history: SessionHistoryItem[]
  onSeeAllExercises: () => void
  onStartExercise: (exerciseId: string) => void
}) {
  const [period, setPeriod] = useState<PeriodKey>('today')

  const cutoff = useMemo(() => {
    const date = new Date()
    date.setDate(date.getDate() - (daysForPeriod(period) - 1))
    if (period === 'today') {
      date.setHours(0, 0, 0, 0)
    }
    return date
  }, [period])

  const postureHistory = useMemo(
    () => history.filter((item) => new Date(item.created_at) >= cutoff),
    [history, cutoff],
  )

  const postureSeries = useMemo(
    () => postureHistory.slice(0, 24).reverse().map((item) => Math.round(item.posture_score * 100)),
    [postureHistory],
  )

  const latestHistoryScore = postureHistory[0] ? Math.round(postureHistory[0].posture_score * 100) : 0
  const liveScore = postureScoreLive == null ? latestHistoryScore : Math.round(postureScoreLive * 100)

  const status =
    liveScore >= 75
      ? { title: 'Good alignment', detail: 'Your shoulders are level and spine neutral.', tone: 'good' as const }
      : liveScore >= 58
        ? { title: 'Chin forward', detail: 'Bring your chin back toward your neck.', tone: 'warn' as const }
        : { title: 'Slouching', detail: 'Roll shoulders back and lift through your chest.', tone: 'bad' as const }

  const shoulderDelta = postureLandmarks?.left_shoulder && postureLandmarks?.right_shoulder
    ? Math.round((postureLandmarks.left_shoulder.y - postureLandmarks.right_shoulder.y) * 40)
    : 0
  const spineAngle = Math.max(6, Math.round((100 - liveScore) * 0.22 + 8))

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

  return (
    <>
      <h1>Posture</h1>

      <section className="posture-live-grid">
        <div className="posture-feed-wrap">
          <PostureFrame frame={postureFrame} landmarks={postureLandmarks} alt="Posture stream" className="posture-preview posture-preview--live" />
          {!postureFrame && (
            <div className="posture-camera-off">
              <CameraOff size={24} />
              <p>Camera inactive</p>
            </div>
          )}
          <div className="posture-live-badge">
            <span />
            {postureStreamState === 'running' ? 'Live' : postureStreamState === 'connecting' ? 'Starting' : 'Ready'}
          </div>
          <div className="posture-feed-gradient">
            <div className="posture-score-badge">
              <strong>{liveScore}</strong>
              <span>posture score</span>
            </div>
          </div>
        </div>

        <div className="posture-coaching">
          <div>
            <p className="posture-eyebrow">right now</p>
            <h2 className={`posture-status is-${status.tone}`}>{status.title}</h2>
            <p className="posture-status-sub">{status.detail}</p>

            <hr />

            <div className="posture-metric-row">
              <span>Head position</span>
              <div className="posture-bar"><i style={{ width: `${Math.max(12, liveScore)}%` }} /></div>
              <em>{liveScore >= 75 ? 'Good' : 'Adjust'}</em>
            </div>
            <div className="posture-metric-row">
              <span>Shoulder level</span>
              <div className="posture-bar"><i style={{ width: `${Math.max(8, 100 - Math.min(40, Math.abs(shoulderDelta) * 2))}%` }} /></div>
              <em>{shoulderDelta >= 0 ? '+' : ''}{shoulderDelta}°</em>
            </div>
            <div className="posture-metric-row">
              <span>Spine angle</span>
              <div className="posture-bar"><i style={{ width: `${Math.max(8, 100 - spineAngle)}%` }} /></div>
              <em>{spineAngle}°</em>
            </div>
          </div>

          {liveScore < 75 ? (
            <button className="btn-solid posture-cta" onClick={() => onStartExercise(recommended[0]?.id ?? 'chin-tuck')}>
              {topIssue?.key === 'chin-forward' ? 'Fix chin position' : topIssue?.key === 'rounded-shoulders' ? 'Open your chest' : 'Relax shoulders'}
            </button>
          ) : (
            <p className="posture-all-good"><Check size={16} /> Looking good</p>
          )}
        </div>
      </section>

      <section className="posture-card">
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
        <div className="posture-history-chart">
          <svg viewBox="0 0 100 100" preserveAspectRatio="none">
            <defs>
              <linearGradient id="postureGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--state-calm)" stopOpacity="0.2" />
                <stop offset="100%" stopColor="var(--state-calm)" stopOpacity="0" />
              </linearGradient>
            </defs>
            <line x1="0" x2="100" y1="30" y2="30" className="posture-threshold" />
            <path d={`${makePath(postureSeries)} L 100 100 L 0 100 Z`} className="posture-area" />
            <path d={makePath(postureSeries)} className="posture-line" />
          </svg>
          <span className="posture-threshold-label">Good threshold</span>
        </div>
      </section>

      <section className="posture-card">
        <h3>Common issues</h3>
        {issueCounts.total === 0 ? (
          <p className="posture-empty"><CheckCircle size={16} /> No recurring issues detected</p>
        ) : (
          <div className="posture-issues">
            {issueRows.map((issue) => (
              <div key={issue.key} className="posture-issue-row">
                <span className={`posture-issue-dot ${issue.pct > 50 ? 'is-high' : issue.pct >= 20 ? 'is-mid' : 'is-low'}`} />
                <strong>{issue.label}</strong>
                <div className="posture-issue-bar"><i style={{ width: `${issue.pct}%` }} /></div>
                <em>{issue.pct}%</em>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="posture-card posture-reco-card">
        <div className="main-panel-head">
          <h3>Recommended for you</h3>
          <button className="posture-see-all" onClick={onSeeAllExercises}>See all <ChevronRight size={12} /></button>
        </div>
        <div className="posture-reco-strip">
          {recommended.map((exercise) => (
            <article key={exercise.id} className="posture-reco-item">
              <p>{topIssue?.key === 'chin-forward' ? 'For chin forward' : topIssue?.key === 'rounded-shoulders' ? 'For rounded shoulders' : 'For posture balance'}</p>
              <h4>{exercise.name}</h4>
              <span>{exercise.target}</span>
              <button onClick={() => onStartExercise(exercise.id)}>Begin</button>
            </article>
          ))}
        </div>
      </section>

      {postureStreamError ? <p className="main-empty">{postureStreamError}</p> : null}
    </>
  )
}
