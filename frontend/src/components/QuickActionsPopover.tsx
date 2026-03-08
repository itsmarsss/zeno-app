import type { BreathingPatternId } from '../shared/types'

export function QuickActionsPopover({
  quickActionStep,
  setQuickActionStep,
  breathingPattern,
  setBreathingPattern,
  breathingUseHrSensing,
  setBreathingUseHrSensing,
  breakUseGenuinityChecks,
  setBreakUseGenuinityChecks,
  breakPlannedMinutes,
  setBreakPlannedMinutes,
  onStartBreathing,
  onStartBreak,
  onClose,
}: {
  quickActionStep: 'menu' | 'breathe' | 'break'
  setQuickActionStep: (value: 'menu' | 'breathe' | 'break') => void
  breathingPattern: BreathingPatternId
  setBreathingPattern: (value: BreathingPatternId) => void
  breathingUseHrSensing: boolean
  setBreathingUseHrSensing: (value: boolean) => void
  breakUseGenuinityChecks: boolean
  setBreakUseGenuinityChecks: (value: boolean) => void
  breakPlannedMinutes: number
  setBreakPlannedMinutes: (value: number) => void
  onStartBreathing: () => void
  onStartBreak: (seconds: number) => void
  onClose: () => void
}) {
  return (
    <section className="quick-actions-pop">
      <div className="quick-actions-head">
        <span>{quickActionStep === 'menu' ? 'Quick actions' : quickActionStep === 'breathe' ? 'Breathe options' : 'Break options'}</span>
        <button className="quick-actions-close" aria-label="Close quick actions" title="Close" onClick={onClose}>×</button>
      </div>

      {quickActionStep === 'menu' && (
        <div className="quick-actions-row">
          <button className="report-link" onClick={() => setQuickActionStep('breathe')}>Breathe</button>
          <button className="report-link" onClick={() => setQuickActionStep('break')}>Break</button>
        </div>
      )}

      {quickActionStep === 'breathe' && (
        <>
          <div className="pattern-picker">
            <button className={`pattern-chip ${breathingPattern === 'box' ? 'is-active' : ''}`} onClick={() => setBreathingPattern('box')}>Box</button>
            <button className={`pattern-chip ${breathingPattern === 'four-seven-eight' ? 'is-active' : ''}`} onClick={() => setBreathingPattern('four-seven-eight')}>4-7-8</button>
          </div>
          <label className="quick-option">
            <input type="checkbox" checked={breathingUseHrSensing} onChange={(e) => setBreathingUseHrSensing(e.target.checked)} />
            Enable heart rate sensing
          </label>
          <div className="quick-actions-row">
            <button className="report-link" onClick={() => setQuickActionStep('menu')}>Back</button>
            <button className="report-link" onClick={onStartBreathing}>Start</button>
          </div>
        </>
      )}

      {quickActionStep === 'break' && (
        <>
          <label className="quick-option">
            Break length (minutes)
            <input
              type="number"
              min={1}
              max={30}
              value={breakPlannedMinutes}
              onChange={(e) => setBreakPlannedMinutes(Math.max(1, Math.min(30, Number(e.target.value) || 5)))}
            />
          </label>
          <label className="quick-option">
            <input type="checkbox" checked={breakUseGenuinityChecks} onChange={(e) => setBreakUseGenuinityChecks(e.target.checked)} />
            Enable genuinity checks
          </label>
          <div className="quick-actions-row">
            <button className="report-link" onClick={() => setQuickActionStep('menu')}>Back</button>
            <button className="report-link" onClick={() => onStartBreak(breakPlannedMinutes * 60)}>Start</button>
          </div>
        </>
      )}
    </section>
  )
}
