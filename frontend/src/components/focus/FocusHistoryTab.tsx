import { ChevronRight, Zap } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useRef, useState } from 'react'
import './FocusHistoryTab.css'
import { friendlyPosture, stressIndexFromHistory } from '../../shared/metrics'
import type { SessionHistoryItem } from '../../shared/types'
import { staggerItem } from '../../shared/motion'
import { AnimatedTickerText } from '../common/AnimatedTickerText'
import { InteractiveLineChart } from '../common/InteractiveLineChart'
import {
  type FocusPeriod,
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
  rhythmStressMin,
  rhythmStressMax,
  rhythmBestIndex,
  focusSessionsSorted,
  expandedSessionId,
  setExpandedSessionId,
  sortNewestFirst,
  setSortNewestFirst,
  studyAnalytics,
  performanceAnalytics,
  durationAnalytics,
  personalizedZones,
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
  rhythmStressMin: number
  rhythmStressMax: number
  rhythmBestIndex: number
  focusSessionsSorted: SessionHistoryItem[]
  expandedSessionId: number | null
  setExpandedSessionId: (value: number | null | ((prev: number | null) => number | null)) => void
  sortNewestFirst: boolean
  setSortNewestFirst: (value: boolean | ((prev: boolean) => boolean)) => void
  studyAnalytics: {
    currentStreak: number
    longestStreak: number
    spacingScore: number
    sessionsThisWeek: number
    daysStudied: number
  }
  performanceAnalytics: {
    excellentPct: number
    goodPct: number
    needsWorkPct: number
    excellentCount: number
    goodCount: number
    needsWorkCount: number
    avgQuality: number
    recommendation: string
    personalBest: number
  }
  durationAnalytics: {
    dataPoints: Array<{ duration: number; stress: number; quality: number; posture: number; id: number }>
    optimalDurationMin: number
    optimalDurationMax: number
    averageDuration: number
    recommendation: string
  }
  personalizedZones: {
    optimalStressMin: number
    optimalStressMax: number
    optimalDurationMin: number
    optimalDurationMax: number
    isPersonalized: boolean
  }
}) {
  const [rhythmHoverIndex, setRhythmHoverIndex] = useState<number | null>(null)
  const [hoveredHeatmapDay, setHoveredHeatmapDay] = useState<number | null>(null)
  const [rhythmHoverDirection, setRhythmHoverDirection] = useState<1 | -1>(1)
  const previousRhythmHoverIndexRef = useRef<number | null>(null)
  const [rhythmPlotLeftPx, setRhythmPlotLeftPx] = useState(0)
  const [rhythmPlotWidthPx, setRhythmPlotWidthPx] = useState(0)
  const hoveredRhythm = rhythmHoverIndex == null ? null : (rhythmData[rhythmHoverIndex] ?? null)
  const bucketWidthPx = rhythmData.length > 0 ? rhythmPlotWidthPx / rhythmData.length : 0
  const hoverBandLeftPx =
    rhythmHoverIndex == null ? rhythmPlotLeftPx : rhythmPlotLeftPx + rhythmHoverIndex * bucketWidthPx
  const tooltipWidthPx = 170
  const tooltipPaddingPx = 8
  const tooltipLeftPx = Math.max(
    rhythmPlotLeftPx + tooltipPaddingPx,
    Math.min(
      hoverBandLeftPx + bucketWidthPx / 2 - tooltipWidthPx / 2,
      rhythmPlotLeftPx + Math.max(tooltipPaddingPx, rhythmPlotWidthPx - tooltipWidthPx - tooltipPaddingPx),
    ),
  )

  const hoveredDaySummary = useMemo(() => {
    if (hoveredHeatmapDay == null) return null
    const row = heatmapData[hoveredHeatmapDay]
    if (!row) return null

    let totalSessions = 0
    let weightedStress = 0
    let bestHourIndex = -1
    let bestStress = Number.POSITIVE_INFINITY

    row.forEach((cell, index) => {
      if (!cell.count || cell.avgStress == null) return
      totalSessions += cell.count
      weightedStress += cell.avgStress * cell.count
      if (cell.avgStress < bestStress) {
        bestStress = cell.avgStress
        bestHourIndex = index
      }
    })

    const fullDayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    const dayName = fullDayNames[hoveredHeatmapDay] ?? 'Day'
    if (totalSessions === 0) return `${dayName}: no focus sessions yet.`

    const avgStress = Math.round(weightedStress / totalSessions)
    const bestHour = bestHourIndex >= 0 ? formatHourLabel(8 + bestHourIndex) : '--'
    return `${dayName}: ${totalSessions} sessions · avg stress ${avgStress} · best hour ${bestHour}`
  }, [heatmapData, hoveredHeatmapDay])

  function rhythmStressY(value: number): number {
    const range = Math.max(1, rhythmStressMax - rhythmStressMin)
    const normalized = Math.max(0, Math.min(1, (value - rhythmStressMin) / range))
    return 18 + (1 - normalized) * 64
  }

  return (
    <>
      <motion.section
        className="focus-header overview-section"
        variants={staggerItem(0)}
        initial="hidden"
        animate="visible"
      >
        <div>
          <h1>{periodTitle(focusPeriod)}</h1>
          <p className="focus-period-range">{periodRangeLabel}</p>
        </div>
        <div className="period-toggle" role="tablist" aria-label="Select period">
          {(['week', 'month', 'quarter'] as FocusPeriod[]).map((period) => (
            <button
              key={period}
              className={focusPeriod === period ? 'is-active' : ''}
              onClick={() => setFocusPeriod(period)}
            >
              {period === 'week' ? 'Week' : period === 'month' ? 'Month' : '3 Months'}
            </button>
          ))}
        </div>
      </motion.section>

      <motion.section
        className="overview-section period-summary"
        variants={staggerItem(0.04)}
        initial="hidden"
        animate="visible"
      >
        <article>
          <p>Total focused time</p>
          <strong>{formatMinutes(periodFocusedMinutes)}</strong>
          <span>Total this period</span>
          <em className={focusHeroDeltaTime >= 0 ? 'delta-positive' : 'delta-negative'}>
            {focusHeroDeltaTime >= 0 ? '↑' : '↓'} {Math.abs(focusHeroDeltaTime)}% from previous period
          </em>
        </article>
        <article>
          <p>Avg session stress</p>
          <strong>{periodAvgStress || 0}</strong>
          <span>Lower is better</span>
          <em className={focusHeroDeltaStress <= 0 ? 'delta-positive' : 'delta-negative'}>
            {focusHeroDeltaStress <= 0 ? '↓' : '↑'} {Math.abs(focusHeroDeltaStress)}% from previous period
          </em>
        </article>
        <article>
          <p>Sessions completed</p>
          <strong>{periodSessionCount}</strong>
          <span>Focus sessions</span>
          <em className={focusHeroDeltaSessions >= 0 ? 'delta-positive' : 'delta-negative'}>
            {focusHeroDeltaSessions >= 0 ? '↑' : '↓'} {Math.abs(focusHeroDeltaSessions)}% from previous period
          </em>
        </article>
      </motion.section>

      <motion.section
        className="overview-section study-analytics"
        variants={staggerItem(0.08)}
        initial="hidden"
        animate="visible"
      >
        <h3>Study Patterns & Effectiveness</h3>
        <div className="analytics-grid">
          {/* Consistency Tracker */}
          <article className="analytics-card">
            <div className="analytics-card-header">
              <span className="analytics-label">Study Streak</span>
              <Zap size={14} className="analytics-icon" />
            </div>
            <div className="analytics-value-row">
              <strong className="analytics-value-large">{studyAnalytics.currentStreak}</strong>
              <span className="analytics-unit">days</span>
            </div>
            <p className="analytics-detail">
              Longest streak: {studyAnalytics.longestStreak} days · {studyAnalytics.daysStudied} days studied
            </p>
            <div className="analytics-bar">
              <div
                style={{
                  width: `${Math.min(100, (studyAnalytics.currentStreak / 30) * 100)}%`,
                  background: 'var(--accent)',
                }}
              />
            </div>
          </article>

          {/* Spacing Score */}
          <article className="analytics-card">
            <div className="analytics-card-header">
              <span className="analytics-label">Spacing Quality</span>
              <span className={`analytics-badge ${studyAnalytics.spacingScore >= 70 ? 'is-good' : studyAnalytics.spacingScore >= 40 ? 'is-okay' : 'is-poor'}`}>
                {studyAnalytics.spacingScore >= 70 ? 'Excellent' : studyAnalytics.spacingScore >= 40 ? 'Good' : 'Needs Work'}
              </span>
            </div>
            <div className="analytics-value-row">
              <strong className="analytics-value-large">{studyAnalytics.spacingScore}</strong>
              <span className="analytics-unit">/100</span>
            </div>
            <p className="analytics-detail">
              Research shows 48-hour spacing is optimal for retention
            </p>
            <div className="analytics-bar">
              <div
                style={{
                  width: `${studyAnalytics.spacingScore}%`,
                  background: studyAnalytics.spacingScore >= 70 ? 'var(--state-calm)' : studyAnalytics.spacingScore >= 40 ? 'var(--state-mild)' : 'var(--state-high)',
                }}
              />
            </div>
          </article>

          {/* Session Quality Distribution */}
          <article className="analytics-card">
            <div className="analytics-card-header">
              <span className="analytics-label">Session Quality</span>
              <span className="analytics-detail-small">Personalized score</span>
            </div>
            <div className="analytics-value-row">
              <strong className="analytics-value-large">{performanceAnalytics.avgQuality}</strong>
              <span className="analytics-unit">/100</span>
            </div>
            <div className="stress-zone-bars">
              <div className="stress-zone-bar">
                <span className="stress-zone-label">Excellent ({performanceAnalytics.excellentCount})</span>
                <div className="stress-zone-track">
                  <div style={{ width: `${performanceAnalytics.excellentPct}%`, background: 'var(--state-calm)' }} />
                </div>
                <span className="stress-zone-pct">{performanceAnalytics.excellentPct}%</span>
              </div>
              <div className="stress-zone-bar">
                <span className="stress-zone-label">Good ({performanceAnalytics.goodCount})</span>
                <div className="stress-zone-track">
                  <div style={{ width: `${performanceAnalytics.goodPct}%`, background: 'var(--state-mild)' }} />
                </div>
                <span className="stress-zone-pct">{performanceAnalytics.goodPct}%</span>
              </div>
              <div className="stress-zone-bar">
                <span className="stress-zone-label">Needs Work ({performanceAnalytics.needsWorkCount})</span>
                <div className="stress-zone-track">
                  <div style={{ width: `${performanceAnalytics.needsWorkPct}%`, background: '#94a3b8' }} />
                </div>
                <span className="stress-zone-pct">{performanceAnalytics.needsWorkPct}%</span>
              </div>
            </div>
            <p className="analytics-detail">
              Personal best: {performanceAnalytics.personalBest}/100
            </p>
          </article>

          {/* Personalized Optimal Zones */}
          <article className="analytics-card">
            <div className="analytics-card-header">
              <span className="analytics-label">Your Optimal Conditions</span>
              <span className={`analytics-badge ${personalizedZones.isPersonalized ? 'is-good' : 'is-okay'}`}>
                {personalizedZones.isPersonalized ? 'Personalized' : 'Learning'}
              </span>
            </div>
            <div className="optimal-zones">
              <div className="optimal-zone-item">
                <span className="optimal-zone-label">Duration</span>
                <strong className="optimal-zone-value">
                  {durationAnalytics.optimalDurationMin}-{durationAnalytics.optimalDurationMax} min
                </strong>
              </div>
              <div className="optimal-zone-item">
                <span className="optimal-zone-label">Stress Level</span>
                <strong className="optimal-zone-value">
                  {personalizedZones.optimalStressMin}-{personalizedZones.optimalStressMax}
                </strong>
              </div>
              <div className="optimal-zone-item">
                <span className="optimal-zone-label">Avg Duration</span>
                <strong className="optimal-zone-value">
                  {durationAnalytics.averageDuration} min
                </strong>
              </div>
            </div>
            <p className="analytics-recommendation">💡 {performanceAnalytics.recommendation}</p>
          </article>
        </div>

        {/* Duration vs Quality Scatter Plot */}
        {durationAnalytics.dataPoints.length >= 3 && (
          <div className="duration-scatter">
            <h4>Session Duration vs. Effectiveness</h4>
            <div className="scatter-plot">
              <svg viewBox="0 0 400 200" preserveAspectRatio="xMidYMid meet">
                {/* Grid lines */}
                <line x1="40" y1="160" x2="380" y2="160" stroke="var(--border-subtle)" strokeWidth="1" />
                <line x1="40" y1="20" x2="40" y2="160" stroke="var(--border-subtle)" strokeWidth="1" />

                {/* Personalized optimal zone overlay */}
                <rect
                  x={40 + (durationAnalytics.optimalDurationMin / 120) * 340}
                  y="20"
                  width={((durationAnalytics.optimalDurationMax - durationAnalytics.optimalDurationMin) / 120) * 340}
                  height="140"
                  fill="var(--accent-light)"
                  opacity="0.15"
                />

                {/* Data points */}
                {durationAnalytics.dataPoints.map((point) => {
                  const x = 40 + (Math.min(point.duration, 120) / 120) * 340
                  const y = 160 - (point.quality / 100) * 140
                  return (
                    <circle
                      key={point.id}
                      cx={x}
                      cy={y}
                      r="4"
                      fill={stressColor(point.stress)}
                      opacity="0.7"
                    />
                  )
                })}

                {/* Axis labels */}
                <text x="210" y="190" fontSize="11" fill="var(--text-tertiary)" textAnchor="middle">
                  Session Duration (minutes)
                </text>
                <text x="15" y="95" fontSize="11" fill="var(--text-tertiary)" textAnchor="middle" transform="rotate(-90 15 95)">
                  Quality Score
                </text>

                {/* Tick labels */}
                <text x="40" y="175" fontSize="10" fill="var(--text-tertiary)" textAnchor="middle">0</text>
                <text x="210" y="175" fontSize="10" fill="var(--text-tertiary)" textAnchor="middle">60</text>
                <text x="380" y="175" fontSize="10" fill="var(--text-tertiary)" textAnchor="middle">120</text>
              </svg>
            </div>
            <div className="scatter-legend">
              <span><i style={{ background: 'var(--state-calm)' }} />Low stress</span>
              <span><i style={{ background: 'var(--state-mild)' }} />Medium stress</span>
              <span><i style={{ background: 'var(--state-high)' }} />High stress</span>
              <span className="scatter-note">Shaded area = your optimal duration</span>
            </div>
          </div>
        )}
      </motion.section>

      <motion.section
        className="overview-section heatmap"
        variants={staggerItem(0.12)}
        initial="hidden"
        animate="visible"
      >
        <div className="main-panel-head">
          <h3>When you focus best</h3>
          <span className="heatmap-legend">
            <i className="calm" />
            Low stress <i className="high" />
            High stress
          </span>
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
                  <div
                    key={day}
                    className="heatmap-row"
                    onMouseEnter={() => setHoveredHeatmapDay(rowIndex)}
                    onMouseLeave={() => setHoveredHeatmapDay(null)}
                  >
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
                        return (
                          <button
                            key={`${day}-${colIndex}`}
                            className={`heatmap-cell is-${toneClass}`}
                            title={label}
                            aria-label={label}
                          />
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            {hoveredDaySummary ? <p className="heatmap-day-summary">{hoveredDaySummary}</p> : null}
            {focusPatternCallout && (
              <p className="heatmap-callout">
                <Zap size={13} /> {focusPatternCallout}
              </p>
            )}
          </>
        ) : (
          <p className="main-empty focus-pattern-empty">
            Need {patternSessionsNeeded} more focus {patternSessionsNeeded === 1 ? 'session' : 'sessions'} for reliable
            heatmap patterns.
          </p>
        )}
      </motion.section>

      <motion.section
        className="overview-section rhythm-chart"
        variants={staggerItem(0.12)}
        initial="hidden"
        animate="visible"
      >
        <h3>
          {focusPeriod === 'week' ? 'Daily rhythm' : focusPeriod === 'month' ? 'Weekly rhythm' : 'Monthly rhythm'}
        </h3>
        {hasEnoughPatternData ? (
          <>
            <div className="rhythm-canvas interactive-chart-surface">
              <svg
                viewBox="0 0 100 100"
                preserveAspectRatio="none"
                aria-hidden
                onMouseLeave={() => {
                  setRhythmHoverIndex(null)
                  previousRhythmHoverIndexRef.current = null
                }}
                onPointerMove={(event) => {
                  const svgRect = event.currentTarget.getBoundingClientRect()
                  const canvasRect = event.currentTarget.parentElement?.getBoundingClientRect() ?? svgRect
                  const localLeft = Math.max(0, svgRect.left - canvasRect.left)
                  const localWidth = Math.max(1, svgRect.width)
                  const ratio = Math.max(0, Math.min(1, (event.clientX - svgRect.left) / localWidth))
                  const index = Math.round(ratio * (rhythmData.length - 1))
                  const prev = previousRhythmHoverIndexRef.current
                  if (prev != null && index !== prev) {
                    setRhythmHoverDirection(index > prev ? 1 : -1)
                  }
                  previousRhythmHoverIndexRef.current = index
                  setRhythmPlotLeftPx(localLeft)
                  setRhythmPlotWidthPx(localWidth)
                  setRhythmHoverIndex(index)
                }}
              >
                {rhythmData.map((item, index) => {
                  const barWidth = 100 / rhythmData.length
                  const x = index * barWidth + barWidth * 0.2
                  const width = barWidth * 0.6
                  const h = (item.focusedMinutes / rhythmMaxMinutes) * 75
                  const y = 90 - h
                  return (
                    <rect
                      key={`${item.label}-bar`}
                      x={x}
                      y={y}
                      width={width}
                      height={h}
                      rx="2"
                      className="rhythm-bar"
                    />
                  )
                })}
                <path d={rhythmStressPath} className="rhythm-line" transform="translate(0, 18)" />
                {rhythmData.map((item, index) => {
                  if (item.avgStress == null) return null
                  const bucketWidth = 100 / Math.max(rhythmData.length, 1)
                  const cx = index * bucketWidth + bucketWidth * 0.5
                  const cy = rhythmStressY(item.avgStress)
                  return <circle key={`${item.label}-stress`} cx={cx} cy={cy} r="1.6" className="rhythm-point" />
                })}
              </svg>
              <AnimatePresence initial={false}>
                {hoveredRhythm && (
                  <>
                    <motion.div
                      className="rhythm-hover-band"
                      initial={{ opacity: 0 }}
                      animate={{ left: `${hoverBandLeftPx}px`, width: `${Math.max(0, bucketWidthPx)}px`, opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ type: 'tween', duration: 0.08, ease: 'easeOut' }}
                    />
                    <motion.div
                      className="rhythm-tooltip"
                      initial={{ opacity: 0, y: 6 }}
                      animate={{ left: `${tooltipLeftPx}px`, opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 6 }}
                      transition={{ type: 'tween', duration: 0.12, ease: 'easeOut' }}
                    >
                      <p>
                        <AnimatedTickerText value={hoveredRhythm.label} direction={rhythmHoverDirection} />
                      </p>
                      <div>
                        <strong>
                          <AnimatedTickerText
                            value={`${hoveredRhythm.focusedMinutes}m`}
                            direction={rhythmHoverDirection}
                          />
                        </strong>
                        <span>Focus time</span>
                      </div>
                      <div>
                        <strong>
                          <AnimatedTickerText
                            value={`${hoveredRhythm.avgStress ?? '--'}`}
                            direction={rhythmHoverDirection}
                          />
                        </strong>
                        <span>Avg stress</span>
                      </div>
                    </motion.div>
                  </>
                )}
              </AnimatePresence>
              <div
                className="rhythm-labels"
                style={{ gridTemplateColumns: `repeat(${rhythmData.length}, minmax(0, 1fr))` }}
              >
                {rhythmData.map((item, index) => (
                  <span key={item.label} className={index === rhythmBestIndex ? 'is-best' : ''}>
                    {item.label}
                  </span>
                ))}
              </div>
            </div>
            <div className="rhythm-legend">
              <span>
                <i className="focus" />
                Focused time
              </span>
              <span>
                <i className="stress" />
                Avg stress
              </span>
            </div>
          </>
        ) : (
          <p className="main-empty focus-pattern-empty">
            Rhythm chart unlocks after {patternSessionsNeeded} more focus{' '}
            {patternSessionsNeeded === 1 ? 'session' : 'sessions'}.
          </p>
        )}
      </motion.section>

      <motion.section
        className="overview-section focus-log session-log"
        variants={staggerItem(0.16)}
        initial="hidden"
        animate="visible"
      >
        <div className="focus-log-head">
          <h3>Sessions</h3>
          <span>{periodSessionCount} this period</span>
          <button onClick={() => setSortNewestFirst((v) => !v)}>
            {sortNewestFirst ? 'Newest first' : 'Oldest first'}
          </button>
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
                  <button
                    className="focus-row-top"
                    onClick={() => setExpandedSessionId((prev) => (prev === item.id ? null : item.id))}
                  >
                    <span className="focus-date-block">
                      <strong>{started.getDate()}</strong>
                      <em>{started.toLocaleDateString([], { weekday: 'short' })}</em>
                    </span>
                    <span className="focus-session-info">
                      <small>
                        {formatClockRange(started, ended)} {item.focus_mode ? <b>Focus</b> : null}
                      </small>
                      <strong>{narrative.headline}</strong>
                    </span>
                    <span className="focus-duration">{formatDurationSeconds(item.session_duration_seconds)}</span>
                    <span className="focus-stress-cell">
                      <i>
                        <span style={{ width: `${stress}%`, background: stressColor(stress) }} />
                      </i>
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
                        <div className="focus-mini-chart">
                          <InteractiveLineChart
                            points={[
                              { id: '1', label: '', value: stress - 8 },
                              { id: '2', label: '', value: stress - 3 },
                              { id: '3', label: '', value: stress + 6 },
                              { id: '4', label: '', value: stress - 2 },
                              { id: '5', label: '', value: stress },
                            ]}
                            yMin={0}
                            yMax={100}
                            showAxis={false}
                            chartHeight={32}
                            tooltipWidth={0}
                            lineClassName="focus-mini-line"
                            areaClassName="focus-mini-area"
                            areaGradientId={`focusMiniGradient-${item.id}`}
                            areaGradientColor={stressColor(stress)}
                          />
                        </div>
                        <div className="focus-stats-list">
                          <p>
                            <span>Duration</span>
                            <strong>{formatDurationSeconds(item.session_duration_seconds)}</strong>
                          </p>
                          <p>
                            <span>Avg heart rate</span>
                            <strong>
                              {item.heart_rate_bpm == null ? '--' : `${Math.round(item.heart_rate_bpm)} bpm`}
                            </strong>
                          </p>
                          <p>
                            <span>Posture score</span>
                            <strong>{Math.round(item.posture_score * 100)} / 100</strong>
                          </p>
                          <p>
                            <span>Emotion</span>
                            <strong>{item.dominant_emotion}</strong>
                          </p>
                        </div>
                        <div className="focus-events">
                          <p>Events</p>
                          <span className="event-breath">
                            Breathing check · {item.heart_rate_bpm == null ? '--' : Math.round(item.heart_rate_bpm)} bpm
                          </span>
                          <span className="event-break">
                            Break marker · {Math.max(1, Math.round(item.session_duration_seconds / 300))} checks
                          </span>
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
