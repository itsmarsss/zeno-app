import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowLeft, Clock3, MapPin, Play, RotateCcw, Search, Square } from 'lucide-react'
import { PostureFrame } from '../common/PostureFrame'
import type { Exercise, PostureLandmarks, PostureStreamFrame } from '../../shared/types'
import './ExercisesTab.css'
import { easeOut, springToggle } from '../../shared/motion'

type ExerciseCategory = 'all' | 'neck' | 'shoulders' | 'upper-back'

const CATEGORIES: Array<{ key: ExerciseCategory; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'neck', label: 'Neck' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'upper-back', label: 'Upper back' },
]

function categoryForExercise(exercise: Exercise): ExerciseCategory {
  const text = `${exercise.name} ${exercise.target}`.toLowerCase()
  if (text.includes('neck') || text.includes('chin')) return 'neck'
  if (text.includes('shoulder') || text.includes('scap') || text.includes('chest') || text.includes('pec')) {
    return 'shoulders'
  }
  if (text.includes('upper back') || text.includes('thoracic') || text.includes('spine') || text.includes('side')) {
    return 'upper-back'
  }
  return 'all'
}

function difficultyLevel(exercise: Exercise): 1 | 2 | 3 {
  return exercise.difficulty === 'easy' ? 1 : 2
}

function exerciseLineArt(exerciseId: string): string {
  if (exerciseId === 'chin-tuck') return 'M 15 60 C 30 40, 55 40, 68 52 M 68 52 C 78 60, 82 68, 86 78 M 25 76 L 52 76'
  if (exerciseId === 'wall-angels') return 'M 20 82 L 20 20 M 80 82 L 80 20 M 30 50 L 50 30 L 70 50'
  if (exerciseId === 'scap-squeeze') return 'M 18 70 C 35 50, 45 50, 50 64 C 55 50, 65 50, 82 70'
  if (exerciseId === 'thoracic-extension') return 'M 20 72 C 40 70, 45 30, 68 34 C 76 36, 82 42, 86 52'
  if (exerciseId === 'doorway-pec-stretch') return 'M 18 85 L 18 16 M 82 85 L 82 16 M 18 32 L 36 32 M 64 32 L 82 32'
  return 'M 16 78 C 34 56, 66 56, 84 78 M 44 45 L 56 45 M 50 45 L 50 30'
}

export type ExerciseSessionSummary = {
  exerciseId: string
  exerciseName: string
  completed: boolean
  repCount: number
  targetReps: number
  formScore: number | null
  durationSeconds: number
  holdSeconds: number
}

export function ExercisesTab({
  exercises,
  selectedExerciseId,
  setSelectedExerciseId,
  exerciseGuidedActive,
  toggleGuided,
  startGuided,
  stopGuided,
  postureStreamState,
  exerciseMetrics,
  postureFrame,
  postureLandmarks,
  exerciseFeedback,
  recommendedIds,
  sessionSummary,
  onDismissSummary,
  onDoAgain,
  recentHistory = [],
  softSuggestionId = null,
}: {
  exercises: Exercise[]
  selectedExerciseId: string
  setSelectedExerciseId: (value: string) => void
  exerciseGuidedActive: boolean
  toggleGuided: (exerciseId?: string) => void
  startGuided: (exerciseId: string) => void
  stopGuided: () => void
  postureStreamState: 'stopped' | 'connecting' | 'running' | 'no-pose' | 'error'
  exerciseMetrics: PostureStreamFrame['exercise_metrics']
  postureFrame: string | null
  postureLandmarks: PostureLandmarks
  exerciseFeedback: string | null
  recommendedIds: string[]
  sessionSummary: ExerciseSessionSummary | null
  onDismissSummary: () => void
  onDoAgain: () => void
  recentHistory?: Array<{
    id: number
    timestamp: string
    exercise_id: string
    completed: boolean
    form_score: number | null
    duration_seconds: number
  }>
  softSuggestionId?: string | null
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ExerciseCategory>('all')
  /** When set, show exercise detail/instructions before starting. */
  const [detailExerciseId, setDetailExerciseId] = useState<string | null>(null)

  const selectedExercise = useMemo(
    () => exercises.find((exercise) => exercise.id === selectedExerciseId) ?? exercises[0] ?? null,
    [exercises, selectedExerciseId],
  )

  const detailExercise = useMemo(
    () => (detailExerciseId ? exercises.find((ex) => ex.id === detailExerciseId) ?? null : null),
    [exercises, detailExerciseId],
  )

  function openExerciseDetail(exerciseId: string) {
    setSelectedExerciseId(exerciseId)
    setDetailExerciseId(exerciseId)
  }

  function beginExercise(exerciseId: string) {
    setSelectedExerciseId(exerciseId)
    setDetailExerciseId(null)
    startGuided(exerciseId)
  }

  const suggestedIds = useMemo(() => {
    const fromInsights = recommendedIds.filter((id) => exercises.some((ex) => ex.id === id))
    if (fromInsights.length > 0) return new Set(fromInsights.slice(0, 3))
    return new Set(['chin-tuck', 'wall-angels', 'scap-squeeze'])
  }, [recommendedIds, exercises])

  const filteredExercises = useMemo(
    () =>
      exercises.filter((exercise) => {
        const normalized = `${exercise.name} ${exercise.target} ${exercise.steps.join(' ')}`.toLowerCase()
        const queryMatch = query.trim().length === 0 || normalized.includes(query.trim().toLowerCase())
        if (!queryMatch) return false
        if (category === 'all') return true
        return categoryForExercise(exercise) === category
      }),
    [exercises, query, category],
  )

  const nextSuggestion = useMemo(() => {
    if (!selectedExercise) return exercises[0] ?? null
    const suggested = exercises.find((ex) => suggestedIds.has(ex.id) && ex.id !== selectedExercise.id)
    if (suggested) return suggested
    return exercises.find((ex) => ex.id !== selectedExercise.id) ?? null
  }, [exercises, selectedExercise, suggestedIds])

  const activeInstruction =
    exerciseFeedback ?? selectedExercise?.steps[0] ?? 'Hold still and breathe naturally.'
  const repCount = exerciseMetrics?.rep_count ?? 0
  const repTarget = exerciseMetrics?.target_reps ?? 10
  const holdTarget = exerciseMetrics?.hold_target_seconds ?? null
  const repHold = exerciseMetrics?.rep_hold_seconds ?? 0
  const progressPct = Math.max(0, Math.min(100, Math.round(exerciseMetrics?.progress_pct ?? 0)))
  const phaseSeconds =
    holdTarget != null
      ? Math.max(0, Math.ceil(holdTarget - repHold))
      : Math.max(0, 10 - Math.min(10, exerciseMetrics?.hold_seconds ?? 0))

  const formPct =
    sessionSummary?.formScore == null
      ? null
      : Math.round(Math.max(0, Math.min(1, sessionSummary.formScore)) * 100)

  const pageTransition = {
    initial: { opacity: 0, y: 10, scale: 0.985 },
    animate: { opacity: 1, y: 0, scale: 1 },
    exit: { opacity: 0, y: -8, scale: 0.985 },
    transition: easeOut,
  }

  return (
    <AnimatePresence mode="wait" initial={false}>
      {sessionSummary ? (
        <motion.section
          key="exercise-summary"
          className="exercise-complete"
          initial={pageTransition.initial}
          animate={pageTransition.animate}
          exit={pageTransition.exit}
          transition={pageTransition.transition}
        >
          <div className="exercise-complete-card">
            <div className={`exercise-complete-mark ${sessionSummary.completed ? 'is-done' : 'is-partial'}`}>
              <svg viewBox="0 0 52 52" className="exercise-check-svg" aria-hidden>
                <circle cx="26" cy="26" r="24" className="exercise-check-ring" />
                {sessionSummary.completed ? (
                  <path className="exercise-check-path" d="M14 27 L22 35 L38 17" />
                ) : (
                  <path className="exercise-check-path" d="M18 26 L34 26" />
                )}
              </svg>
            </div>
            <h2>{sessionSummary.completed ? 'Nice work' : 'Session saved'}</h2>
            <p className="exercise-complete-sub">{sessionSummary.exerciseName}</p>

            <div className="exercise-complete-stats">
              <div>
                <strong>
                  {sessionSummary.repCount}/{sessionSummary.targetReps}
                </strong>
                <span>Reps</span>
              </div>
              <div>
                <strong>{formPct == null ? '—' : `${formPct}%`}</strong>
                <span>Form</span>
              </div>
              <div>
                <strong>{Math.max(1, Math.round(sessionSummary.durationSeconds / 60))}m</strong>
                <span>Time</span>
              </div>
            </div>

            <div className="exercise-complete-actions">
              <button type="button" className="exercise-complete-primary" onClick={onDoAgain}>
                <RotateCcw size={14} /> Do it again
              </button>
              {nextSuggestion && (
                <button
                  type="button"
                  className="exercise-complete-secondary"
                  onClick={() => {
                    onDismissSummary()
                    openExerciseDetail(nextSuggestion.id)
                  }}
                >
                  <Play size={14} /> Try {nextSuggestion.name}
                </button>
              )}
              <button type="button" className="exercise-complete-ghost" onClick={onDismissSummary}>
                Back to exercises
              </button>
            </div>
          </div>
        </motion.section>
      ) : exerciseGuidedActive && selectedExercise ? (
        <motion.section
          key="exercise-active"
          className="exercise-active"
          initial={pageTransition.initial}
          animate={pageTransition.animate}
          exit={pageTransition.exit}
          transition={pageTransition.transition}
        >
          <div className="exercise-active-feed">
            <PostureFrame
              frame={postureFrame}
              landmarks={postureLandmarks}
              alt="Active exercise stream"
              className="exercise-active-video"
            />

            <div className="exercise-phase-badge">
              {exerciseMetrics?.target_active
                ? holdTarget != null
                  ? 'Hold'
                  : 'Good form'
                : 'Find position'}
            </div>
            <div className="exercise-rep-badge">
              Rep {Math.min(repCount, repTarget)} of {repTarget}
            </div>

            <div className="exercise-overlay-bottom">
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={activeInstruction}
                  className="exercise-overlay-msg"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {activeInstruction}
                </motion.p>
              </AnimatePresence>
              <div className="exercise-overlay-progress">
                <motion.i style={{ width: `${progressPct}%` }} transition={springToggle} />
              </div>
            </div>
          </div>

          <aside className="exercise-coach-panel">
            <button type="button" className="exercise-back-link" onClick={stopGuided}>
              <ArrowLeft size={14} /> Back to exercises
            </button>
            <h2>{selectedExercise.name}</h2>
            <p className="exercise-tag">{selectedExercise.target}</p>
            <hr />

            <div className="exercise-phase-hero">
              <p className="exercise-phase-label">
                {holdTarget != null ? 'Hold remaining' : 'Coaching'}
              </p>
              <AnimatePresence mode="wait" initial={false}>
                <motion.p
                  key={`phase-${activeInstruction}`}
                  className="exercise-phase-text"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.3 }}
                >
                  {activeInstruction}
                </motion.p>
              </AnimatePresence>

              <div className="exercise-timer-row">
                <p className="exercise-timer">{phaseSeconds}</p>
                <span>{holdTarget != null ? 'sec hold' : 'seconds'}</span>
                <svg viewBox="0 0 40 40" className="exercise-ring">
                  <circle cx="20" cy="20" r="16" className="ring-base" />
                  <circle
                    cx="20"
                    cy="20"
                    r="16"
                    className="ring-progress"
                    style={{ strokeDashoffset: `${100 - progressPct}` }}
                  />
                </svg>
              </div>
            </div>

            <hr />
            <div className="exercise-overall-progress">
              <p>Exercise progress · {progressPct}%</p>
              <div className="exercise-phase-dots">
                {Array.from({ length: Math.min(repTarget, 10) }).map((_, index) => (
                  <motion.i
                    key={index}
                    className={index < repCount ? 'is-done' : ''}
                    layout
                    transition={springToggle}
                  />
                ))}
              </div>
            </div>

            <p className="exercise-active-note">
              {postureStreamState === 'running'
                ? 'Live coaching active'
                : postureStreamState === 'connecting'
                  ? 'Connecting to camera...'
                  : postureStreamState === 'no-pose'
                    ? 'Step into frame so we can see your shoulders'
                    : 'Waiting for camera feed...'}
            </p>

            <button type="button" className="exercise-stop-btn" onClick={stopGuided}>
              <Square size={12} /> Stop exercise
            </button>
          </aside>
        </motion.section>
      ) : detailExercise ? (
        <motion.section
          key={`exercise-detail-${detailExercise.id}`}
          className="exercise-detail"
          initial={pageTransition.initial}
          animate={pageTransition.animate}
          exit={pageTransition.exit}
          transition={pageTransition.transition}
        >
          <button type="button" className="exercise-back-link" onClick={() => setDetailExerciseId(null)}>
            <ArrowLeft size={14} /> Back to exercises
          </button>

          <div className="exercise-detail-layout">
            <aside className="exercise-detail-sidebar">
              <div className="exercise-detail-illustration" aria-hidden>
                <svg viewBox="0 0 100 100">
                  <path d={exerciseLineArt(detailExercise.id)} />
                </svg>
              </div>
              <p className="exercise-v2-tag">{detailExercise.target}</p>
              <h2>{detailExercise.name}</h2>
              <p className="exercise-detail-blurb">
                {detailExercise.description ?? detailExercise.steps[0]}
              </p>
              <div className="exercise-detail-meta">
                <span>
                  <Clock3 size={13} /> {detailExercise.duration_minutes} min
                </span>
                <span>
                  <MapPin size={13} /> {detailExercise.space === 'desk' ? 'At your desk' : 'Needs space'}
                </span>
                <span className="exercise-dots" aria-label={`Difficulty ${difficultyLevel(detailExercise)} of 3`}>
                  <i className={difficultyLevel(detailExercise) >= 1 ? 'is-on' : ''} />
                  <i className={difficultyLevel(detailExercise) >= 2 ? 'is-on' : ''} />
                  <i className={difficultyLevel(detailExercise) >= 3 ? 'is-on' : ''} />
                  <em>{detailExercise.difficulty === 'easy' ? 'Easy' : 'Moderate'}</em>
                </span>
              </div>

              <div className="exercise-detail-actions">
                <button
                  type="button"
                  className="exercise-detail-begin"
                  onClick={() => beginExercise(detailExercise.id)}
                >
                  <Play size={15} /> Begin exercise
                </button>
                <button type="button" className="exercise-detail-cancel" onClick={() => setDetailExerciseId(null)}>
                  Not now
                </button>
              </div>
            </aside>

            <div className="exercise-detail-body">
              <h3>How to do it</h3>
              <ol className="exercise-detail-steps">
                {detailExercise.steps.map((step, index) => (
                  <li key={`${detailExercise.id}-step-${index}`}>
                    <span className="exercise-detail-step-num">{index + 1}</span>
                    <p>{step}</p>
                  </li>
                ))}
              </ol>

              <div className="exercise-detail-tips">
                <p>
                  Zeno uses your camera for live form coaching once you begin. Sit or stand where your upper body is
                  visible, and move slowly.
                </p>
              </div>
            </div>
          </div>
        </motion.section>
      ) : (
        <motion.div
          key="exercise-grid"
          initial={pageTransition.initial}
          animate={pageTransition.animate}
          exit={pageTransition.exit}
          transition={pageTransition.transition}
        >
          <header className="exercise-header">
            <h1>Exercises</h1>
            <p>Simple movements for desk workers</p>

            <label className="exercise-search">
              <Search size={14} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search exercises..."
              />
            </label>
          </header>

          {softSuggestionId && (
            <button
              type="button"
              className="exercise-soft-suggest"
              onClick={() => openExerciseDetail(softSuggestionId)}
            >
              <span>Posture drift earlier</span>
              <strong>
                Try {exercises.find((ex) => ex.id === softSuggestionId)?.name ?? 'a reset'} →
              </strong>
            </button>
          )}

          <div className="exercise-pill-row">
            {CATEGORIES.map((pill) => (
              <button
                key={pill.key}
                type="button"
                className={category === pill.key ? 'is-active' : ''}
                onClick={() => setCategory(pill.key)}
              >
                {pill.label}
              </button>
            ))}
          </div>

          <section className="exercise-grid-v2">
            {filteredExercises.map((exercise) => {
              const isSuggested = suggestedIds.has(exercise.id)
              const isSelected = selectedExercise?.id === exercise.id
              return (
                <article
                  key={exercise.id}
                  className={`exercise-v2-card is-clickable ${isSelected ? 'is-selected' : ''}`}
                  role="button"
                  tabIndex={0}
                  onClick={() => openExerciseDetail(exercise.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault()
                      openExerciseDetail(exercise.id)
                    }
                  }}
                >
                  <div className="exercise-v2-illustration">
                    <svg viewBox="0 0 100 100">
                      <path d={exerciseLineArt(exercise.id)} />
                    </svg>
                    {isSuggested && <span className="exercise-v2-suggested">For you</span>}
                  </div>

                  <div className="exercise-v2-body">
                    <p className="exercise-v2-tag">{exercise.target}</p>
                    <h3>{exercise.name}</h3>

                    <div className="exercise-v2-meta">
                      <span>
                        <Clock3 size={12} /> {exercise.duration_minutes}m
                      </span>
                      <span className="exercise-dots" aria-label={`Difficulty ${difficultyLevel(exercise)} of 3`}>
                        <i className={difficultyLevel(exercise) >= 1 ? 'is-on' : ''} />
                        <i className={difficultyLevel(exercise) >= 2 ? 'is-on' : ''} />
                        <i className={difficultyLevel(exercise) >= 3 ? 'is-on' : ''} />
                      </span>
                    </div>

                    <p className="exercise-v2-description">
                      {exercise.description ?? exercise.steps[0]}
                    </p>

                    <button
                      type="button"
                      className="exercise-v2-start"
                      onClick={(event) => {
                        event.stopPropagation()
                        beginExercise(exercise.id)
                      }}
                    >
                      <Play size={12} /> Begin exercise
                    </button>
                  </div>
                </article>
              )
            })}
          </section>

          {filteredExercises.length === 0 && (
            <p className="exercise-empty">No exercises match that filter.</p>
          )}

          {recentHistory.length > 0 && (
            <section className="exercise-history">
              <div className="exercise-history-head">
                <h3>Recent sessions</h3>
                <span>{recentHistory.length} logged</span>
              </div>
              <ul className="exercise-history-list">
                {recentHistory.slice(0, 8).map((item) => {
                  const name =
                    exercises.find((ex) => ex.id === item.exercise_id)?.name ?? item.exercise_id
                  const formPct =
                    item.form_score == null
                      ? null
                      : Math.round(Math.max(0, Math.min(1, item.form_score)) * 100)
                  const when = item.timestamp
                    ? new Date(item.timestamp).toLocaleString([], {
                        month: 'short',
                        day: 'numeric',
                        hour: 'numeric',
                        minute: '2-digit',
                      })
                    : '—'
                  return (
                    <li key={item.id}>
                      <div>
                        <strong>{name}</strong>
                        <span>{when}</span>
                      </div>
                      <div className="exercise-history-meta">
                        <span className={item.completed ? 'is-done' : ''}>
                          {item.completed ? 'Done' : 'Partial'}
                        </span>
                        <span>{formPct == null ? '—' : `${formPct}% form`}</span>
                        <span>{Math.max(1, Math.round(item.duration_seconds / 60))}m</span>
                      </div>
                    </li>
                  )
                })}
              </ul>
            </section>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}
