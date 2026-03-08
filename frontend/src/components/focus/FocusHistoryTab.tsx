import { ChevronRight, Zap } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useState } from 'react'
import './FocusHistoryTab.css'
import { friendlyPosture, stressIndexFromHistory } from '../../shared/metrics'
import type { SessionHistoryItem } from '../../shared/types'
import { staggerItem } from '../../shared/motion'
import {
  type FocusPeriod,
  buildAreaPath,
  classifySession,
  formatClockRange,
  formatDurationSeconds,
  formatHourLabel,
  formatMinutes,
  stressColor,
  periodTitle,
} from '../../shared/dashboard'

type HeatmapCell = { avgStress: number | null; count: number }

export function FocusHistoryTab({
  focusPeriod,
  setFocusPeriod,
  periodSessionCount,
  periodFocusedMinutes,
  periodAvgStress,
  focusHeroDeltaTime,
  focusHeroDeltaStress,
  focusHeroDeltaSessions,
  periodRangeLabel,
  hasEnoughPatternData,
  patternSessionsNeeded,
  heatmapData,
  focusPatternCallout,
  rhythmData,
  rhythmMaxMinutes,
  rhythmStressPath,
  rhythmBestIndex,
  focusSessionsSorted,
  expandedSessionId,
  setExpandedSessionId,
  sortNewestFirst,
  setSortNewestFirst,
}: {
  focusPeriod: FocusPeriod
  setFocusPeriod: (value: FocusPeriod) => void
  periodSessionCount: number
  periodFocusedMinutes: number
  periodAvgStress: number
  focusHeroDeltaTime: number
  focusHeroDeltaStress: number
  focusHeroDeltaSessions: number
  periodRangeLabel: string
  hasEnoughPatternData: boolean
  patternSessionsNeeded: number
  heatmapData: HeatmapCell[][]
  focusPatternCallout: string | null
  rhythmData: Array<{ label: string; focusedMinutes: number; avgStress: number | null }>
  rhythmMaxMinutes: number
  rhythmStressPath: string
  rhythmBestIndex: number
  focusSessionsSorted: SessionHistoryItem[]
  expandedSessionId: number | null
  setExpandedSessionId: (value: number | null | ((prev: number | null) => number | null)) => void
  sortNewestFirst: boolean
  setSortNewestFirst: (value: boolean | ((prev: boolean) => boolean)) => void
}) {
  const [rhythmHoverIndex, setRhythmHoverIndex] = useState<number | null>(null)
  const hoveredRhythm = rhythmHoverIndex == null ? null : rhythmData[rhythmHoverIndex] ?? null
  const hoverRatio = rhythmHoverIndex == null ? 0 : rhythmHoverIndex / Math.max(rhythmData.length - 1, 1)
  const cursorLeft = `${hoverRatio * 100}%`
  const tooltipLeft = `${Math.max(8, Math.min(84, hoverRatio * 100))}%`

  return (
    <>
      <motion.section className="focus-header overview-section" variants={staggerItem(0)} initial="hidden" animate="visible">
        <div>
          <h1>{periodTitle(focusPeriod)}</h1>
          <p className="focus-period-range">{periodRangeLabel}</p>
        </div>
        <div className="period-toggle" role="tablist" aria-label="Select period">
          {(['week', 'month', 'quarter'] as FocusPeriod[]).map((period) => (
            <button key={period} className={focusPeriod === period ? 'is-active' : ''} onClick={() => setFocusPeriod(period)}>
              {period === 'week' ? 'Week' : period === 'month' ? 'Month' : '3 Months'}
            </button>
          ))}
        </div>
      </motion.section>

      <motion.section className="overview-section period-summary" variants={staggerItem(0.04)} initial="hidden" animate="visible">
        <article>
          <p>Total focused time</p>
          <strong>{formatMinutes(periodFocusedMinutes)}</strong>
          <span>Total this period</span>
          <em className={focusHeroDeltaTime >= 0 ? 'delta-positive' : 'delta-negative'}>{focusHeroDeltaTime >= 0 ? '↑' : '↓'} {Math.abs(focusHeroDeltaTime)}% from previous period</em>
        </article>
        <article>
          <p>Avg session stress</p>
          <strong>{periodAvgStress || 0}</strong>
          <span>Lower is better</span>
          <em className={focusHeroDeltaStress <= 0 ? 'delta-positive' : 'delta-negative'}>{focusHeroDeltaStress <= 0 ? '↓' : '↑'} {Math.abs(focusHeroDeltaStress)}% from previous period</em>
        </article>
        <article>
          <p>Sessions completed</p>
          <strong>{periodSessionCount}</strong>
          <span>Focus sessions</span>
          <em className={focusHeroDeltaSessions >= 0 ? 'delta-positive' : 'delta-negative'}>{focusHeroDeltaSessions >= 0 ? '↑' : '↓'} {Math.abs(focusHeroDeltaSessions)}% from previous period</em>
        </article>
      </motion.section>

      <motion.section className="overview-section heatmap" variants={staggerItem(0.08)} initial="hidden" animate="visible">
        <div className="main-panel-head">
          <h3>When you focus best</h3>
          <span className="heatmap-legend"><i className="calm" />Low stress <i className="high" />High stress</span>
        </div>
        {hasEnoughPatternData ? (
          <>
            <div className="heatmap-grid-wrap">
              <div className="heatmap-hours">
                {Array.from({ length: 12 }).map((_, index) => {
                  const hour = 8 + index
                  return <span key={hour}>{index % 2 === 0 ? formatHourLabel(hour) : ''}</span>
                })}
              </div>
              <div className="heatmap-body">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, rowIndex) => (
                  <div key={day} className="heatmap-row">
                    <span>{day}</span>
                    <div className="heatmap-cells">
                      {heatmapData[rowIndex].map((cell, colIndex) => {
                        let toneClass = 'no-data'
                        if (cell.avgStress != null) {
                          if (cell.avgStress <= 30) toneClass = 'calm'
                          else if (cell.avgStress <= 60) toneClass = 'mild'
                          else toneClass = 'high'
                        }
                        const label = `${day} ${formatHourLabel(8 + colIndex)} · Avg stress ${cell.avgStress == null ? '--' : Math.round(cell.avgStress)} · ${cell.count} sessions`
                        return <button key={`${day}-${colIndex}`} className={`heatmap-cell is-${toneClass}`} title={label} aria-label={label} />
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {focusPatternCallout && (
              <p className="heatmap-callout"><Zap size={13} /> {focusPatternCallout}</p>
            )}
          </>
        ) : (
          <p className="main-empty focus-pattern-empty">
            Need {patternSessionsNeeded} more focus {patternSessionsNeeded === 1 ? 'session' : 'sessions'} for reliable heatmap patterns.
          </p>
        )}
      </motion.section>

      <motion.section className="overview-section rhythm-chart" variants={staggerItem(0.12)} initial="hidden" animate="visible">
        <h3>{focusPeriod === 'week' ? 'Daily rhythm' : focusPeriod === 'month' ? 'Weekly rhythm' : 'Monthly rhythm'}</h3>
        {hasEnoughPatternData ? (
          <>
            <div className="rhythm-canvas">
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden
                onMouseLeave={() => setRhythmHoverIndex(null)}
                onPointerMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect()
                  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / Math.max(1, rect.width)))
                  const index = Math.round(ratio * (rhythmData.length - 1))
                  setRhythmHoverIndex(index)
                }}
              >
                {rhythmData.map((item, index) => {
                  const barWidth = 100 / rhythmData.length
                  const x = index * barWidth + barWidth * 0.2
                  const width = barWidth * 0.6
                  const h = (item.focusedMinutes / rhythmMaxMinutes) * 75
                  const y = 90 - h
                  return <rect key={`${item.label}-bar`} x={x} y={y} width={width} height={h} rx="2" className="rhythm-bar" />
                })}
                <path d={rhythmStressPath} className="rhythm-line" transform="translate(0, 5)" />
              </svg>
              {hoveredRhythm && (
                <>
                  <motion.div
                    className="rhythm-cursor"
                    initial={false}
                    animate={{ left: cursorLeft, opacity: 1 }}
                    transition={{ type: 'tween', duration: 0.06, ease: 'linear' }}
                  />
                  <motion.div
                    className="rhythm-tooltip"
                    initial={false}
                    animate={{ left: tooltipLeft, opacity: 1, y: 0 }}
                    transition={{ type: 'tween', duration: 0.1, ease: 'easeOut' }}
                  >
                    <p>{hoveredRhythm.label}</p>
                    <div>
                      <strong>{hoveredRhythm.focusedMinutes}m</strong>
                      <span>Focus time</span>
                    </div>
                    <div>
                      <strong>{hoveredRhythm.avgStress ?? '--'}</strong>
                      <span>Avg stress</span>
                    </div>
                  </motion.div>
                </>
              )}
              <div className="rhythm-labels" style={{ gridTemplateColumns: `repeat(${rhythmData.length}, minmax(0, 1fr))` }}>
                {rhythmData.map((item, index) => (
                  <span key={item.label} className={index === rhythmBestIndex ? 'is-best' : ''}>{item.label}</span>
                ))}
              </div>
            </div>
            <div className="rhythm-legend">
              <span><i className="focus" />Focused time</span>
              <span><i className="stress" />Avg stress</span>
            </div>
          </>
        ) : (
          <p className="main-empty focus-pattern-empty">
            Rhythm chart unlocks after {patternSessionsNeeded} more focus {patternSessionsNeeded === 1 ? 'session' : 'sessions'}.
          </p>
        )}
      </motion.section>

      <motion.section className="overview-section focus-log session-log" variants={staggerItem(0.16)} initial="hidden" animate="visible">
        <div className="focus-log-head">
          <h3>Sessions</h3>
          <span>{periodSessionCount} this period</span>
          <button onClick={() => setSortNewestFirst((v) => !v)}>{sortNewestFirst ? 'Newest first' : 'Oldest first'}</button>
        </div>
        {focusSessionsSorted.length === 0 ? (
          <p className="main-empty">No focus sessions logged yet.</p>
        ) : (
          <div className="focus-rows">
            {focusSessionsSorted.slice(0, 28).map((item) => {
              const started = new Date(item.created_at)
              const ended = new Date(started.getTime() + item.session_duration_seconds * 1000)
              const stress = stressIndexFromHistory(item)
              const expanded = expandedSessionId === item.id
              const narrative = classifySession(item)
              return (
                <article key={item.id} className={`focus-row ${expanded ? 'is-expanded' : ''}`}>
                  <button className="focus-row-top" onClick={() => setExpandedSessionId((prev) => (prev === item.id ? null : item.id))}>
                    <span className="focus-date-block">
                      <strong>{started.getDate()}</strong>
                      <em>{started.toLocaleDateString([], { weekday: 'short' })}</em>
                    </span>
                    <span className="focus-session-info">
                      <small>{formatClockRange(started, ended)} {item.focus_mode ? <b>Focus</b> : null}</small>
                      <strong>{narrative.headline}</strong>
                    </span>
                    <span className="focus-duration">{formatDurationSeconds(item.session_duration_seconds)}</span>
                    <span className="focus-stress-cell">
                      <i><span style={{ width: `${stress}%`, background: stressColor(stress) }} /></i>
                      <em>{stress}</em>
                    </span>
                    <ChevronRight size={14} className="focus-chevron" />
                  </button>
                  <AnimatePresence initial={false}>
                    {expanded && (
                      <motion.div
                        className="focus-row-expand"
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
                      >
                        <div className="focus-mini-chart"><svg viewBox="0 0 100 32" preserveAspectRatio="none"><path d={buildAreaPath([stress - 8, stress - 3, stress + 6, stress - 2, stress], 0, 100, 100, 32)} /></svg></div>
                        <div className="focus-stats-list">
                          <p><span>Duration</span><strong>{formatDurationSeconds(item.session_duration_seconds)}</strong></p>
                          <p><span>Avg heart rate</span><strong>{item.heart_rate_bpm == null ? '--' : `${Math.round(item.heart_rate_bpm)} bpm`}</strong></p>
                          <p><span>Posture score</span><strong>{Math.round(item.posture_score * 100)} / 100</strong></p>
                          <p><span>Emotion</span><strong>{item.dominant_emotion}</strong></p>
                        </div>
                        <div className="focus-events">
                          <p>Events</p>
                          <span className="event-breath">Breathing check · {item.heart_rate_bpm == null ? '--' : Math.round(item.heart_rate_bpm)} bpm</span>
                          <span className="event-break">Break marker · {Math.max(1, Math.round(item.session_duration_seconds / 300))} checks</span>
                          <span className="event-posture">Posture alert · {friendlyPosture(item.posture_score)}</span>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </article>
              )
            })}
          </div>
        )}
      </motion.section>
    </>
  )
}
