import { PostureFrame } from '../common/PostureFrame'
import type { Exercise, PostureLandmarks, PostureStreamFrame } from '../../shared/types'
import './ExercisesTab.css'

export function ExercisesTab({
  spaceFilter,
  setSpaceFilter,
  durationFilter,
  setDurationFilter,
  difficultyFilter,
  setDifficultyFilter,
  targetFilter,
  setTargetFilter,
  targetOptions,
  filteredExercises,
  selectedExercise,
  setSelectedExerciseId,
  setExerciseFeedback,
  setExerciseMetrics,
  setPaywallMessage,
  exerciseGuidedActive,
  toggleGuided,
  postureStreamState,
  exerciseMetrics,
  postureFrame,
  postureLandmarks,
  exerciseFeedback,
  paywallMessage,
}: {
  spaceFilter: 'all' | 'desk' | 'open'
  setSpaceFilter: (value: 'all' | 'desk' | 'open') => void
  durationFilter: 'all' | 'short' | 'long'
  setDurationFilter: (value: 'all' | 'short' | 'long') => void
  difficultyFilter: 'all' | 'easy' | 'moderate'
  setDifficultyFilter: (value: 'all' | 'easy' | 'moderate') => void
  targetFilter: 'all' | string
  setTargetFilter: (value: string) => void
  targetOptions: string[]
  filteredExercises: Exercise[]
  selectedExercise: Exercise | null
  setSelectedExerciseId: (value: string) => void
  setExerciseFeedback: (value: string | null) => void
  setExerciseMetrics: (value: PostureStreamFrame['exercise_metrics']) => void
  setPaywallMessage: (value: string | null) => void
  exerciseGuidedActive: boolean
  toggleGuided: () => void
  postureStreamState: 'stopped' | 'connecting' | 'running' | 'no-pose' | 'error'
  exerciseMetrics: PostureStreamFrame['exercise_metrics']
  postureFrame: string | null
  postureLandmarks: PostureLandmarks
  exerciseFeedback: string | null
  paywallMessage: string | null
}) {
  return (
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
                <button className="btn-solid" type="button" onClick={toggleGuided}>
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
                <PostureFrame frame={postureFrame} landmarks={postureLandmarks} alt="Guided exercise stream" className="exercise-live-preview" />
              )}
              <p className="exercise-note">{paywallMessage ?? exerciseFeedback ?? 'Live form feedback will appear here while guided mode runs.'}</p>
            </>
          ) : (
            <p className="main-empty">Adjust filters to pick an exercise.</p>
          )}
        </section>
      </div>
    </>
  )
}
