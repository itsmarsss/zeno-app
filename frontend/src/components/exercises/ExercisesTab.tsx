import { useMemo, useState } from 'react'
import { ArrowLeft, Clock3, Play, Search } from 'lucide-react'
import { PostureFrame } from '../common/PostureFrame'
import type { Exercise, PostureLandmarks, PostureStreamFrame } from '../../shared/types'
import './ExercisesTab.css'

type ExerciseCategory = 'all' | 'neck' | 'shoulders' | 'upper-back' | 'eyes' | 'breathing'

const CATEGORIES: Array<{ key: ExerciseCategory; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'neck', label: 'Neck' },
  { key: 'shoulders', label: 'Shoulders' },
  { key: 'upper-back', label: 'Upper back' },
  { key: 'eyes', label: 'Eyes' },
  { key: 'breathing', label: 'Breathing' },
]

const SUGGESTED_IDS = new Set(['chin-tuck', 'wall-angels', 'scap-squeeze'])

function categoryForExercise(exercise: Exercise): ExerciseCategory {
  const text = `${exercise.name} ${exercise.target}`.toLowerCase()
  if (text.includes('neck') || text.includes('chin')) return 'neck'
  if (text.includes('shoulder') || text.includes('scap')) return 'shoulders'
  if (text.includes('upper back') || text.includes('thoracic') || text.includes('spine')) return 'upper-back'
  if (text.includes('eye')) return 'eyes'
  if (text.includes('breath')) return 'breathing'
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

export function ExercisesTab({
  exercises,
  selectedExerciseId,
  setSelectedExerciseId,
  exerciseGuidedActive,
  toggleGuided,
  postureStreamState,
  exerciseMetrics,
  postureFrame,
  postureLandmarks,
  exerciseFeedback,
  paywallMessage,
}: {
  exercises: Exercise[]
  selectedExerciseId: string
  setSelectedExerciseId: (value: string) => void
  exerciseGuidedActive: boolean
  toggleGuided: () => void
  postureStreamState: 'stopped' | 'connecting' | 'running' | 'no-pose' | 'error'
  exerciseMetrics: PostureStreamFrame['exercise_metrics']
  postureFrame: string | null
  postureLandmarks: PostureLandmarks
  exerciseFeedback: string | null
  paywallMessage: string | null
}) {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<ExerciseCategory>('all')

  const selectedExercise = useMemo(
    () => exercises.find((exercise) => exercise.id === selectedExerciseId) ?? exercises[0] ?? null,
    [exercises, selectedExerciseId],
  )

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

  const activeInstruction = exerciseFeedback ?? selectedExercise?.steps[0] ?? 'Hold still and breathe naturally.'
  const repCount = exerciseMetrics?.rep_count ?? 0
  const repTarget = exerciseMetrics?.target_reps ?? 3
  const phaseSeconds = Math.max(0, 10 - Math.min(10, exerciseMetrics?.hold_seconds ?? 0))
  const progressPct = Math.max(0, Math.min(100, Math.round(exerciseMetrics?.progress_pct ?? 0)))

  if (exerciseGuidedActive && selectedExercise) {
    return (
      <section className="exercise-active">
        <div className="exercise-active-feed">
          <PostureFrame frame={postureFrame} landmarks={postureLandmarks} alt="Active exercise stream" className="exercise-active-video" />

          <div className="exercise-phase-badge">{exerciseMetrics?.target_active ? 'Hold still' : 'Adjust posture'}</div>
          <div className="exercise-rep-badge">Rep {repCount} of {repTarget}</div>

          <div className="exercise-overlay-bottom">
            <p className="exercise-overlay-msg">{activeInstruction}</p>
            <div className="exercise-overlay-progress"><i style={{ width: `${progressPct}%` }} /></div>
          </div>
        </div>

        <aside className="exercise-coach-panel">
          <button className="exercise-back-link" onClick={toggleGuided}><ArrowLeft size={14} /> Back to exercises</button>
          <h2>{selectedExercise.name}</h2>
          <p className="exercise-tag">{selectedExercise.target}</p>
          <hr />

          <div className="exercise-phase-hero">
            <p className="exercise-phase-label">Current phase</p>
            <p className="exercise-phase-text">{activeInstruction}</p>

            <div className="exercise-timer-row">
              <p className="exercise-timer">{phaseSeconds}</p>
              <span>seconds</span>
              <svg viewBox="0 0 40 40" className="exercise-ring">
                <circle cx="20" cy="20" r="16" className="ring-base" />
                <circle cx="20" cy="20" r="16" className="ring-progress" style={{ strokeDashoffset: `${100 - progressPct}` }} />
              </svg>
            </div>
          </div>

          <hr />
          <div className="exercise-overall-progress">
            <p>Exercise progress</p>
            <div className="exercise-phase-dots">
              {selectedExercise.steps.map((step, index) => (
                <i key={step} className={index <= Math.floor((progressPct / 100) * (selectedExercise.steps.length - 1)) ? 'is-done' : ''} />
              ))}
            </div>
          </div>

          <p className="exercise-active-note">
            {postureStreamState === 'running'
              ? 'Live coaching active'
              : postureStreamState === 'connecting'
                ? 'Connecting to camera...'
                : paywallMessage ?? 'Waiting for camera feed...'}
          </p>
        </aside>
      </section>
    )
  }

  return (
    <>
      <header className="exercise-header">
        <h1>Exercises</h1>
        <p>Simple movements for desk workers</p>

        <label className="exercise-search">
          <Search size={14} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search exercises..." />
        </label>
      </header>

      <div className="exercise-pill-row">
        {CATEGORIES.map((pill) => (
          <button key={pill.key} className={category === pill.key ? 'is-active' : ''} onClick={() => setCategory(pill.key)}>
            {pill.label}
          </button>
        ))}
      </div>

      <section className="exercise-grid-v2">
        {filteredExercises.map((exercise) => {
          const isSuggested = SUGGESTED_IDS.has(exercise.id)
          const isSelected = selectedExercise?.id === exercise.id
          return (
            <article key={exercise.id} className={`exercise-v2-card ${isSelected ? 'is-selected' : ''}`}>
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
                  <span><Clock3 size={12} /> {exercise.duration_minutes}m</span>
                  <span className="exercise-dots" aria-label={`Difficulty ${difficultyLevel(exercise)} of 3`}>
                    <i className={difficultyLevel(exercise) >= 1 ? 'is-on' : ''} />
                    <i className={difficultyLevel(exercise) >= 2 ? 'is-on' : ''} />
                    <i className={difficultyLevel(exercise) >= 3 ? 'is-on' : ''} />
                  </span>
                </div>

                <p className="exercise-v2-description">{exercise.steps[0]}</p>

                <button
                  className="exercise-v2-start"
                  onClick={() => {
                    setSelectedExerciseId(exercise.id)
                    toggleGuided()
                  }}
                >
                  <Play size={12} /> Begin exercise
                </button>
              </div>
            </article>
          )
        })}
      </section>
    </>
  )
}
