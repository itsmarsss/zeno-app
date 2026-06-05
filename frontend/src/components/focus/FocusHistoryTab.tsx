import { ChevronRight, Zap } from 'lucide-react'
import { AnimatePresence, motion } from 'framer-motion'
import { useMemo, useRef, useState, type CSSProperties } from 'react'
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

  const [hoveredScatterId, setHoveredScatterId] = useState<number | null>(null)

  const heatmapMaxCount = useMemo(() => {
    let max = 1
    heatmapData.forEach((row) => {
      row.forEach((cell) => {
        if (cell.count > max) max = cell.count
      })
    })
    return max
  }, [heatmapData])

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

  // Rhythm chart: fixed pixel viewBox so circles stay round (not stretched).
  const RHYTHM_W = 420
  const RHYTHM_H = 168
  const RHYTHM_PAD_L = 8
  const RHYTHM_PAD_R = 8
  const RHYTHM_TOP = 18
  const RHYTHM_BOTTOM = 142
  const RHYTHM_PLOT_H = RHYTHM_BOTTOM - RHYTHM_TOP
  const RHYTHM_INNER_W = RHYTHM_W - RHYTHM_PAD_L - RHYTHM_PAD_R

  function rhythmBarGeometry(focusedMinutes: number, index: number) {
    const n = Math.max(1, rhythmData.length)
    const bucket = RHYTHM_INNER_W / n
    const width = Math.max(10, bucket * 0.48)
    const x = RHYTHM_PAD_L + index * bucket + (bucket - width) / 2
    const maxH = RHYTHM_PLOT_H * 0.94
    const h =
      rhythmMaxMinutes <= 0
        ? 0
        : focusedMinutes <= 0
          ? 3
          : Math.max(8, (focusedMinutes / rhythmMaxMinutes) * maxH)
    return { x, width, h, y: RHYTHM_BOTTOM - h }
  }

  function rhythmStressY(value: number): number {
    const range = Math.max(1, rhythmStressMax - rhythmStressMin)
    const normalized = Math.max(0, Math.min(1, (value - rhythmStressMin) / range))
    return RHYTHM_TOP + (1 - normalized) * RHYTHM_PLOT_H
  }

  function rhythmCenterX(index: number): number {
    const n = Math.max(1, rhythmData.length)
    const bucket = RHYTHM_INNER_W / n
    return RHYTHM_PAD_L + index * bucket + bucket / 2
  }

  const rhythmStressPathLocal = useMemo(() => {
    const points: Array<{ x: number; y: number }> = []
    rhythmData.forEach((item, index) => {
      if (item.avgStress == null || Number.isNaN(item.avgStress)) return
      points.push({ x: rhythmCenterX(index), y: rhythmStressY(item.avgStress) })
    })
    if (points.length === 0) return ''
    if (points.length === 1) {
      const p = points[0]
      return `M ${p.x.toFixed(2)} ${p.y.toFixed(2)}`
    }
    let d = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`
    for (let i = 0; i < points.length - 1; i += 1) {
      const p0 = points[i - 1] ?? points[i]
      const p1 = points[i]
      const p2 = points[i + 1]
      const p3 = points[i + 2] ?? p2
      const cp1x = p1.x + (p2.x - p0.x) / 6
      let cp1y = p1.y + (p2.y - p0.y) / 6
      const cp2x = p2.x - (p3.x - p1.x) / 6
      let cp2y = p2.y - (p3.y - p1.y) / 6
      const segMinY = Math.min(p1.y, p2.y)
      const segMaxY = Math.max(p1.y, p2.y)
      cp1y = Math.max(segMinY, Math.min(segMaxY, cp1y))
      cp2y = Math.max(segMinY, Math.min(segMaxY, cp2y))
      d += ` C ${cp1x.toFixed(2)} ${cp1y.toFixed(2)}, ${cp2x.toFixed(2)} ${cp2y.toFixed(2)}, ${p2.x.toFixed(2)} ${p2.y.toFixed(2)}`
    }
    return d
  }, [rhythmData, rhythmStressMin, rhythmStressMax, rhythmMaxMinutes])

  // Scatter: data-driven X domain so short sessions don't leave a huge empty right side.
  const scatterLayout = useMemo(() => {
    const PAD_L = 44
    const PAD_R = 16
    const PAD_T = 16
    const PAD_B = 36
    const W = 400
    const H = 220
    const plotW = W - PAD_L - PAD_R
    const plotH = H - PAD_T - PAD_B
    const points = durationAnalytics.dataPoints
    if (points.length === 0) {
      return {
        W,
        H,
        PAD_L,
        PAD_R,
        PAD_T,
        PAD_B,
        plotW,
        plotH,
        xMin: 0,
        xMax: 60,
        xTicks: [0, 30, 60],
        yTicks: [0, 50, 100],
        optX: PAD_L,
        optW: 0,
        mapped: [] as Array<{
          id: number
          cx: number
          cy: number
          duration: number
          quality: number
          stress: number
          fill: string
        }>,
      }
    }

    const durations = points.map((p) => p.duration)
    const dataMin = Math.min(...durations)
    const dataMax = Math.max(...durations)
    const span = Math.max(10, dataMax - dataMin)
    const pad = Math.max(4, span * 0.18)

    let xMin = Math.max(0, dataMin - pad)
    let xMax = dataMax + pad

    // Keep optimal band visible when personalized, but don't let defaults blow the scale.
    if (personalizedZones.isPersonalized) {
      xMin = Math.min(xMin, durationAnalytics.optimalDurationMin)
      xMax = Math.max(xMax, durationAnalytics.optimalDurationMax)
    }

    // Nice rounded bounds (5-min steps for short ranges, 10 for longer).
    const step = xMax - xMin <= 40 ? 5 : xMax - xMin <= 90 ? 10 : 15
    xMin = Math.floor(xMin / step) * step
    xMax = Math.ceil(xMax / step) * step
    if (xMax <= xMin) xMax = xMin + step * 4
    // Minimum readable span
    if (xMax - xMin < step * 3) {
      const mid = (xMin + xMax) / 2
      xMin = Math.max(0, Math.floor((mid - step * 1.5) / step) * step)
      xMax = xMin + step * 3
    }

    const tickCount = Math.min(5, Math.round((xMax - xMin) / step) + 1)
    const xTicks: number[] = []
    for (let i = 0; i < tickCount; i += 1) {
      xTicks.push(Math.round(xMin + ((xMax - xMin) * i) / Math.max(1, tickCount - 1)))
    }
    // Dedupe
    const uniqueTicks = [...new Set(xTicks)]

    const xScale = (d: number) => PAD_L + ((d - xMin) / Math.max(1, xMax - xMin)) * plotW
    const yScale = (q: number) => PAD_T + (1 - Math.max(0, Math.min(100, q)) / 100) * plotH

    let optX = PAD_L
    let optW = 0
    if (personalizedZones.isPersonalized) {
      const optLeft = Math.max(xMin, durationAnalytics.optimalDurationMin)
      const optRight = Math.min(xMax, durationAnalytics.optimalDurationMax)
      if (optRight > optLeft) {
        optX = xScale(optLeft)
        optW = Math.max(0, xScale(optRight) - optX)
      }
    }

    // Slight deterministic jitter when points share nearly the same duration/quality.
    const mapped = points.map((point, index) => {
      const neighbors = points.filter(
        (other) =>
          other.id !== point.id &&
          Math.abs(other.duration - point.duration) < 1.5 &&
          Math.abs(other.quality - point.quality) < 3,
      )
      const jitter = neighbors.length
        ? ((index % 5) - 2) * 2.2 + ((index * 7) % 3) - 1
        : 0
      return {
        id: point.id,
        cx: xScale(point.duration) + jitter * 0.35,
        cy: yScale(point.quality) + jitter * 0.25,
        duration: point.duration,
        quality: point.quality,
        stress: point.stress,
        fill: stressColor(point.stress),
      }
    })

    return {
      W,
      H,
      PAD_L,
      PAD_R,
      PAD_T,
      PAD_B,
      plotW,
      plotH,
      xMin,
      xMax,
      xTicks: uniqueTicks,
      yTicks: [0, 50, 100],
      optX,
      optW,
      mapped,
    }
  }, [durationAnalytics, personalizedZones.isPersonalized])

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
            <div className="duration-scatter-head">
              <h4>Session Duration vs. Effectiveness</h4>
              <p>
                {personalizedZones.isPersonalized
                  ? `Sweet spot ≈ ${durationAnalytics.optimalDurationMin}–${durationAnalytics.optimalDurationMax} min`
                  : durationAnalytics.recommendation}
              </p>
            </div>
            <div className="scatter-plot">
              <svg
                viewBox={`0 0 ${scatterLayout.W} ${scatterLayout.H}`}
                preserveAspectRatio="xMidYMid meet"
                role="img"
                aria-label="Scatter plot of session duration versus quality score"
              >
                {/* Horizontal grid */}
                {scatterLayout.yTicks.map((tick) => {
                  const y =
                    scatterLayout.PAD_T +
                    (1 - tick / 100) * scatterLayout.plotH
                  return (
                    <g key={`y-${tick}`}>
                      <line
                        x1={scatterLayout.PAD_L}
                        y1={y}
                        x2={scatterLayout.PAD_L + scatterLayout.plotW}
                        y2={y}
                        className="scatter-grid"
                      />
                      <text
                        x={scatterLayout.PAD_L - 8}
                        y={y + 3.5}
                        className="scatter-tick"
                        textAnchor="end"
                      >
                        {tick}
                      </text>
                    </g>
                  )
                })}

                {/* Optimal duration band */}
                {scatterLayout.optW > 2 && (
                  <rect
                    x={scatterLayout.optX}
                    y={scatterLayout.PAD_T}
                    width={scatterLayout.optW}
                    height={scatterLayout.plotH}
                    className="scatter-optimal-band"
                    rx="6"
                  />
                )}

                {/* Axes */}
                <line
                  x1={scatterLayout.PAD_L}
                  y1={scatterLayout.PAD_T + scatterLayout.plotH}
                  x2={scatterLayout.PAD_L + scatterLayout.plotW}
                  y2={scatterLayout.PAD_T + scatterLayout.plotH}
                  className="scatter-axis"
                />
                <line
                  x1={scatterLayout.PAD_L}
                  y1={scatterLayout.PAD_T}
                  x2={scatterLayout.PAD_L}
                  y2={scatterLayout.PAD_T + scatterLayout.plotH}
                  className="scatter-axis"
                />

                {/* X ticks */}
                {scatterLayout.xTicks.map((tick) => {
                  const x =
                    scatterLayout.PAD_L +
                    ((tick - scatterLayout.xMin) /
                      Math.max(1, scatterLayout.xMax - scatterLayout.xMin)) *
                      scatterLayout.plotW
                  return (
                    <text
                      key={`x-${tick}`}
                      x={x}
                      y={scatterLayout.PAD_T + scatterLayout.plotH + 16}
                      className="scatter-tick"
                      textAnchor="middle"
                    >
                      {tick}m
                    </text>
                  )
                })}

                {/* Points */}
                {scatterLayout.mapped.map((point) => {
                  const active = hoveredScatterId === point.id
                  return (
                    <circle
                      key={point.id}
                      cx={point.cx}
                      cy={point.cy}
                      r={active ? 6.5 : 5}
                      fill={point.fill}
                      className={`scatter-point ${active ? 'is-active' : ''}`}
                      onMouseEnter={() => setHoveredScatterId(point.id)}
                      onMouseLeave={() => setHoveredScatterId(null)}
                    >
                      <title>
                        {point.duration} min · quality {Math.round(point.quality)} · stress{' '}
                        {Math.round(point.stress)}
                      </title>
                    </circle>
                  )
                })}

                <text
                  x={scatterLayout.PAD_L + scatterLayout.plotW / 2}
                  y={scatterLayout.H - 4}
                  className="scatter-axis-label"
                  textAnchor="middle"
                >
                  Session duration
                </text>
                <text
                  x={12}
                  y={scatterLayout.PAD_T + scatterLayout.plotH / 2}
                  className="scatter-axis-label"
                  textAnchor="middle"
                  transform={`rotate(-90 12 ${scatterLayout.PAD_T + scatterLayout.plotH / 2})`}
                >
                  Quality
                </text>
              </svg>
            </div>
            <div className="scatter-legend">
              <span>
                <i style={{ background: 'var(--state-calm)' }} />
                Low stress
              </span>
              <span>
                <i style={{ background: 'var(--state-mild)' }} />
                Medium
              </span>
              <span>
                <i style={{ background: 'var(--state-high)' }} />
                High stress
              </span>
              {scatterLayout.optW > 2 ? (
                <span className="scatter-note">
                  <i className="scatter-note-band" />
                  Optimal duration
                </span>
              ) : null}
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
          <div>
            <h3>When you focus best</h3>
            <p className="heatmap-sub">Weekday × hour · darker means more sessions</p>
          </div>
          <span className="heatmap-legend" aria-label="Stress legend">
            <i className="calm" />
            Calm
            <i className="mild" />
            Mild
            <i className="high" />
            High
          </span>
        </div>
        {hasEnoughPatternData ? (
          <>
            <div className="heatmap-grid-wrap">
              <div className="heatmap-hours">
                {Array.from({ length: 12 }).map((_, index) => {
                  const hour = 8 + index
                  return (
                    <span key={hour} className={index % 2 === 0 ? 'is-labeled' : ''}>
                      {index % 2 === 0 ? formatHourLabel(hour) : ''}
                    </span>
                  )
                })}
              </div>
              <div className="heatmap-body">
                {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((day, rowIndex) => (
                  <div
                    key={day}
                    className={`heatmap-row ${hoveredHeatmapDay === rowIndex ? 'is-hovered' : ''}`}
                    onMouseEnter={() => setHoveredHeatmapDay(rowIndex)}
                    onMouseLeave={() => setHoveredHeatmapDay(null)}
                  >
                    <span>{day}</span>
                    <div className="heatmap-cells">
                      {heatmapData[rowIndex].map((cell, colIndex) => {
                        let toneClass = 'no-data'
                        if (cell.avgStress != null && cell.count > 0) {
                          if (cell.avgStress <= 30) toneClass = 'calm'
                          else if (cell.avgStress <= 60) toneClass = 'mild'
                          else toneClass = 'high'
                        }
                        const intensity =
                          cell.count <= 0
                            ? 0
                            : Math.max(0.42, Math.min(1, 0.4 + (cell.count / heatmapMaxCount) * 0.6))
                        const label = `${day} ${formatHourLabel(8 + colIndex)} · Avg stress ${
                          cell.avgStress == null ? '—' : Math.round(cell.avgStress)
                        } · ${cell.count} ${cell.count === 1 ? 'session' : 'sessions'}`
                        return (
                          <button
                            key={`${day}-${colIndex}`}
                            type="button"
                            className={`heatmap-cell is-${toneClass}`}
                            style={
                              toneClass === 'no-data'
                                ? undefined
                                : ({ '--cell-intensity': String(intensity) } as CSSProperties)
                            }
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
            <p className={`heatmap-day-summary ${hoveredDaySummary ? '' : 'is-placeholder'}`}>
              {hoveredDaySummary ?? 'Hover a day row for session details'}
            </p>
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
        <div className="main-panel-head">
          <div>
            <h3>
              {focusPeriod === 'week'
                ? 'Daily rhythm'
                : focusPeriod === 'month'
                  ? 'Weekly rhythm'
                  : 'Monthly rhythm'}
            </h3>
            <p className="heatmap-sub">Bars = focused time · Line = average stress</p>
          </div>
        </div>
        {hasEnoughPatternData ? (
          <>
            <div className="rhythm-canvas interactive-chart-surface">
              <svg
                viewBox={`0 0 ${RHYTHM_W} ${RHYTHM_H}`}
                preserveAspectRatio="xMidYMid meet"
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
                  const ratio = Math.max(0, Math.min(0.999, (event.clientX - svgRect.left) / localWidth))
                  const index = Math.min(rhythmData.length - 1, Math.floor(ratio * rhythmData.length))
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
                {/* Soft guide lines */}
                {[0.25, 0.5, 0.75].map((frac) => {
                  const y = RHYTHM_TOP + RHYTHM_PLOT_H * (1 - frac)
                  return (
                    <line
                      key={frac}
                      x1={RHYTHM_PAD_L}
                      y1={y}
                      x2={RHYTHM_W - RHYTHM_PAD_R}
                      y2={y}
                      className="rhythm-guide"
                    />
                  )
                })}
                <line
                  x1={RHYTHM_PAD_L}
                  y1={RHYTHM_BOTTOM}
                  x2={RHYTHM_W - RHYTHM_PAD_R}
                  y2={RHYTHM_BOTTOM}
                  className="rhythm-baseline"
                />
                {rhythmData.map((item, index) => {
                  const { x, width, h, y } = rhythmBarGeometry(item.focusedMinutes, index)
                  return (
                    <rect
                      key={`${item.label}-bar`}
                      x={x}
                      y={y}
                      width={width}
                      height={Math.max(0, h)}
                      rx={Math.min(8, width / 2)}
                      className={`rhythm-bar ${index === rhythmBestIndex ? 'is-best' : ''} ${
                        item.focusedMinutes <= 0 ? 'is-empty' : ''
                      } ${rhythmHoverIndex === index ? 'is-hover' : ''}`}
                    />
                  )
                })}
                {rhythmStressPathLocal ? <path d={rhythmStressPathLocal} className="rhythm-line" /> : null}
                {rhythmData.map((item, index) => {
                  if (item.avgStress == null) return null
                  const cx = rhythmCenterX(index)
                  const cy = rhythmStressY(item.avgStress)
                  const active = rhythmHoverIndex === index
                  return (
                    <circle
                      key={`${item.label}-stress`}
                      cx={cx}
                      cy={cy}
                      r={active ? 5.5 : 4.5}
                      className={`rhythm-point ${active ? 'is-active' : ''}`}
                    />
                  )
                })}
              </svg>
              <AnimatePresence initial={false}>
                {hoveredRhythm && (
                  <>
                    <motion.div
                      className="rhythm-hover-band"
                      initial={{ opacity: 0 }}
                      animate={{
                        left: `${hoverBandLeftPx}px`,
                        width: `${Math.max(0, bucketWidthPx)}px`,
                        opacity: 1,
                      }}
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
                            value={hoveredRhythm.avgStress == null ? '—' : String(hoveredRhythm.avgStress)}
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
                style={{ gridTemplateColumns: `repeat(${Math.max(1, rhythmData.length)}, minmax(0, 1fr))` }}
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
              {rhythmBestIndex >= 0 && rhythmData[rhythmBestIndex]?.focusedMinutes > 0 ? (
                <span className="rhythm-legend-best">
                  Best: {rhythmData[rhythmBestIndex].label} ({rhythmData[rhythmBestIndex].focusedMinutes}m)
                </span>
              ) : null}
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
