import { useState } from 'react'
import { Activity, TrendingUp, User } from 'lucide-react'
import { motion } from 'framer-motion'
import { friendlyPosture, stressIndexFromHistory } from '../../shared/metrics'
import type { DailyReport, SessionHistoryItem } from '../../shared/types'
import './OverviewTab.css'
import { staggerItem } from '../../shared/motion'
import {
  type DeltaTone,
  type InsightCard,
  classifySession,
  clamp,
  formatClockRange,
  formatDelta,
  formatDurationSeconds,
  formatHourLabel,
  formatMinutes,
  mean,
  stressColor,
  stressTone,
} from '../../shared/dashboard'

type TimelinePoint = {
  slotStartIso: string
  slotEndIso: string
  label: string
  stress: number | null
  heartRate: number | null
  focusActive: boolean
  breathing: boolean
}

type SecondaryMetricSeries = {
  peakStress: number[]
  avgFocusSession: number[]
  postureAvg: number[]
  breakMinutes: number[]
}

export function OverviewTab({
  now,
  heroHeadline,
  heroSubline,
  avgStressToday,
  stressDeltaVsYesterday,
  heroTrendTone,
  todayFocusedMinutes,
  avgHrToday,
  hrDeltaBaseline,
  todayBreakCount,
  todaySessions,
  timelineData,
  chartHoverIndex,
  setChartHoverIndex,
  timelineBucketMinutes,
  setTimelineBucketMinutes,
  timelineAreaPath,
  timelineStressPath,
  timelineHeartPath,
  insights,
  secondaryMetricSeries,
  dailyReport,
  onViewFocusHistory,
}: {
  now: Date
  heroHeadline: string
  heroSubline: string
  avgStressToday: number
  stressDeltaVsYesterday: number
  heroTrendTone: DeltaTone
  todayFocusedMinutes: number
  avgHrToday: number
  hrDeltaBaseline: number
  todayBreakCount: number
  todaySessions: SessionHistoryItem[]
  timelineData: TimelinePoint[]
  chartHoverIndex: number | null
  setChartHoverIndex: (value: number | null) => void
  timelineBucketMinutes: number
  setTimelineBucketMinutes: (value: number) => void
  timelineAreaPath: string
  timelineStressPath: string
  timelineHeartPath: string
  insights: InsightCard[]
  secondaryMetricSeries: SecondaryMetricSeries
  dailyReport: DailyReport | null
  onViewFocusHistory: () => void
}) {
  const heroStressClass = `overview-stress-value is-${stressTone(avgStressToday)}`
  const [hoverPercent, setHoverPercent] = useState<number | null>(null)
  const [hoverXPx, setHoverXPx] = useState<number | null>(null)
  const [chartWidthPx, setChartWidthPx] = useState<number>(0)
  const hoveredPoint = chartHoverIndex != null ? timelineData[chartHoverIndex] : null
  const fallbackRatio = chartHoverIndex == null ? 0 : chartHoverIndex / Math.max(timelineData.length - 1, 1)
  const hoverXPercent = hoverPercent ?? (fallbackRatio * 100)
  const chartStartMs = timelineData[0] ? new Date(timelineData[0].slotStartIso).getTime() : 0
  const chartEndMs = timelineData[timelineData.length - 1] ? new Date(timelineData[timelineData.length - 1].slotEndIso).getTime() : 0
  const chartSpanMs = Math.max(chartEndMs - chartStartMs, 1)
  const fallbackXPx = chartWidthPx > 0 ? (hoverXPercent / 100) * chartWidthPx : 0
  const cursorXPx = hoverXPx ?? fallbackXPx
  const tooltipWidthPx = 196
  const tooltipPaddingPx = 8
  const tooltipLeftPx = clamp(
    cursorXPx - tooltipWidthPx / 2,
    tooltipPaddingPx,
    Math.max(tooltipPaddingPx, chartWidthPx - tooltipWidthPx - tooltipPaddingPx),
  )

  return (
    <>
      <motion.section className="overview-section hero-band" variants={staggerItem(0)} initial="hidden" animate="visible">
        <div className="hero-left">
          <p className="hero-date">{now.toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' }).replace(',', ' ·')}</p>
          <h1>{heroHeadline}</h1>
          <p className="hero-subline">{heroSubline}</p>
        </div>
        <div className="hero-divider" />
        <div className="hero-right">
          <p className={heroStressClass}>{avgStressToday || 0}</p>
          <p className="hero-stress-label">stress index</p>
          <p className={`hero-stress-trend is-${heroTrendTone}`}>{formatDelta(stressDeltaVsYesterday)}</p>
        </div>
      </motion.section>

      <motion.section className="overview-section narrative-strip" variants={staggerItem(0.04)} initial="hidden" animate="visible">
        <article className="narrative-tile">
          <p className="narrative-value">{formatMinutes(todayFocusedMinutes)}</p>
          <p className="narrative-label">Focused Time</p>
          <p className="narrative-context is-positive">{todayFocusedMinutes >= 90 ? 'Personal best this week' : 'Building consistency'}</p>
        </article>
        <article className="narrative-tile">
          <p className="narrative-value">{avgHrToday || '--'} <span>bpm</span></p>
          <p className="narrative-label">Avg Heart Rate</p>
          <p className={`narrative-context ${hrDeltaBaseline <= 0 ? 'is-positive' : 'is-negative'}`}>
            {Number.isFinite(hrDeltaBaseline)
              ? `${Math.abs(hrDeltaBaseline)} ${hrDeltaBaseline <= 0 ? 'below' : 'above'} your baseline`
              : 'Baseline pending'}
          </p>
        </article>
        <article className="narrative-tile">
          <p className="narrative-value">{todayBreakCount}</p>
          <p className="narrative-label">Breaks Taken</p>
          <p className={`narrative-context ${todayBreakCount >= 2 ? 'is-positive' : 'is-neutral'}`}>
            {todayBreakCount >= 2 ? 'All genuine' : 'Could use one more break'}
          </p>
        </article>
      </motion.section>

      <motion.section className="overview-section primary-chart" variants={staggerItem(0.08)} initial="hidden" animate="visible">
        <div className="main-panel-head">
          <h3>Today</h3>
          <div className="overview-chart-controls">
            <button className="overview-view-more overview-view-more--secondary" onClick={onViewFocusHistory}>
              View More
            </button>
            <span>{`${formatHourLabel(6)} - now`}</span>
            <label className="timeline-interval-label">
              <span>Interval</span>
              <select
                className="timeline-interval-select"
                value={timelineBucketMinutes}
                onChange={(event) => setTimelineBucketMinutes(Number(event.target.value))}
              >
                <option value={5}>5m</option>
                <option value={15}>15m</option>
                <option value={30}>30m</option>
                <option value={60}>60m</option>
              </select>
            </label>
          </div>
        </div>
        {todaySessions.length === 0 ? (
          <p className="main-empty">No sessions yet today.</p>
        ) : (
          <div
            className="overview-chart-canvas"
            onMouseLeave={() => {
              setChartHoverIndex(null)
              setHoverPercent(null)
              setHoverXPx(null)
            }}
            onPointerMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              const xPx = clamp(event.clientX - rect.left, 0, Math.max(rect.width, 1))
              const ratio = clamp(xPx / Math.max(rect.width, 1), 0, 1)
              const nextIndex = Math.round(ratio * (timelineData.length - 1))
              setChartWidthPx(rect.width)
              setHoverXPx(xPx)
              setHoverPercent(ratio * 100)
              setChartHoverIndex(nextIndex)
            }}
          >
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
              <defs>
                <linearGradient id="stressGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={stressColor(avgStressToday || 20)} stopOpacity="0.18" />
                  <stop offset="100%" stopColor={stressColor(avgStressToday || 20)} stopOpacity="0" />
                </linearGradient>
              </defs>
              {timelineData.map((point) => {
                if (!point.focusActive) return null
                const startMs = new Date(point.slotStartIso).getTime()
                const endMs = new Date(point.slotEndIso).getTime()
                const xStart = clamp(((startMs - chartStartMs) / chartSpanMs) * 100, 0, 100)
                const xEnd = clamp(((endMs - chartStartMs) / chartSpanMs) * 100, 0, 100)
                const width = Math.max(0.2, xEnd - xStart)
                return <rect key={`${point.slotStartIso}-focus`} x={xStart} y={0} width={width} height={100} className="focus-band" />
              })}
              <path d={timelineAreaPath} className="timeline-area" />
              <path d={timelineStressPath} className="timeline-stress" />
              <path d={timelineHeartPath} className="timeline-heart" />
              {timelineData.map((point, index) => {
                if (!point.breathing) return null
                const x = timelineData.length === 1 ? 50 : (index / (timelineData.length - 1)) * 100
                return <line key={`${point.slotStartIso}-breath`} x1={x} x2={x} y1={0} y2={100} className="timeline-breath" />
              })}
            </svg>
            {hoveredPoint && (
              <>
                <motion.div
                  className="timeline-cursor"
                  initial={false}
                  animate={{ left: `${cursorXPx}px`, opacity: 1 }}
                  transition={{ type: 'tween', duration: 0.06, ease: 'linear' }}
                />
                <motion.div
                  className="timeline-tooltip"
                  initial={false}
                  animate={{ left: `${tooltipLeftPx}px`, opacity: 1, y: 0 }}
                  transition={{ type: 'tween', duration: 0.1, ease: 'easeOut' }}
                >
                  <p>{hoveredPoint.label}</p>
                  <div className="timeline-tooltip-row">
                    <strong>{hoveredPoint.stress ?? '--'}</strong>
                    <span>Stress index</span>
                  </div>
                  <div className="timeline-tooltip-row">
                    <strong>{hoveredPoint.heartRate ?? '--'} bpm</strong>
                    <span>Heart rate</span>
                  </div>
                  {hoveredPoint.focusActive && <em>Focus Mode active</em>}
                </motion.div>
              </>
            )}
            <div className="timeline-hover-hint">
              <span>Move cursor to inspect</span>
            </div>
            <div className="timeline-axis" style={{ gridTemplateColumns: `repeat(${timelineData.length}, minmax(0, 1fr))` }}>
              {/*
                Keep axis readable as granularity increases.
              */}
              {(() => {
                const labelStep = Math.max(1, Math.ceil(timelineData.length / 8))
                return timelineData.map((point, index) => (
                  index % labelStep === 0 || index === timelineData.length - 1 ? <span key={point.slotStartIso}>{point.label}</span> : <span key={point.slotStartIso} />
                ))
              })()}
            </div>
          </div>
        )}
      </motion.section>
      <motion.section className="overview-section insight-cards" variants={staggerItem(0.12)} initial="hidden" animate="visible">
        {insights.map((card) => {
          const Icon = card.icon === 'trending' ? TrendingUp : card.icon === 'activity' ? Activity : User
          return (
            <article key={card.key} className="insight-card">
              <Icon size={14} />
              <p className="insight-tag">{card.tag}</p>
              <p className="insight-text">{card.text}</p>
              <p className="insight-stat">{card.stat}</p>
            </article>
          )
        })}
      </motion.section>

      <motion.section className="overview-section secondary-metrics" variants={staggerItem(0.16)} initial="hidden" animate="visible">
        <article className="secondary-cell">
          <svg viewBox="0 0 100 30" preserveAspectRatio="none"><path d={`M ${secondaryMetricSeries.peakStress.map((v, i) => `${(i / Math.max(secondaryMetricSeries.peakStress.length - 1, 1)) * 100} ${30 - (v / 100) * 30}`).join(' L ')}`} /></svg>
          <strong>{dailyReport?.peak_stress?.stress_index ?? (avgStressToday || 0)}</strong>
          <span>Today's peak stress</span>
        </article>
        <article className="secondary-cell">
          <svg viewBox="0 0 100 30" preserveAspectRatio="none"><path d={`M ${secondaryMetricSeries.avgFocusSession.map((v, i) => `${(i / Math.max(secondaryMetricSeries.avgFocusSession.length - 1, 1)) * 100} ${30 - (Math.min(v, 120) / 120) * 30}`).join(' L ')}`} /></svg>
          <strong>{formatMinutes(Math.round(mean(secondaryMetricSeries.avgFocusSession)))}</strong>
          <span>Avg focus session len</span>
        </article>
        <article className="secondary-cell">
          <svg viewBox="0 0 100 30" preserveAspectRatio="none"><path d={`M ${secondaryMetricSeries.postureAvg.map((v, i) => `${(i / Math.max(secondaryMetricSeries.postureAvg.length - 1, 1)) * 100} ${30 - (v / 100) * 30}`).join(' L ')}`} /></svg>
          <strong>{Math.round(mean(secondaryMetricSeries.postureAvg)) || 0}</strong>
          <span>Posture score today</span>
        </article>
        <article className="secondary-cell">
          <svg viewBox="0 0 100 30" preserveAspectRatio="none"><path d={`M ${secondaryMetricSeries.breakMinutes.map((v, i) => `${(i / Math.max(secondaryMetricSeries.breakMinutes.length - 1, 1)) * 100} ${30 - (Math.min(v, 60) / 60) * 30}`).join(' L ')}`} /></svg>
          <strong>{todayBreakCount}</strong>
          <span>Total break time</span>
        </article>
      </motion.section>

      <motion.section className="overview-section session-log" variants={staggerItem(0.2)} initial="hidden" animate="visible">
        <h3>Today's sessions</h3>
        {todaySessions.length === 0 ? (
          <p className="main-empty">No sessions yet today.</p>
        ) : (
          <div className="editorial-timeline">
            <div className="editorial-line" />
            {todaySessions.slice(-12).map((item) => {
              const started = new Date(item.created_at)
              const ended = new Date(started.getTime() + item.session_duration_seconds * 1000)
              const stress = stressIndexFromHistory(item)
              const narrative = classifySession(item)
              return (
                <article key={item.id} className="editorial-entry">
                  <div className={`entry-dot ${item.focus_mode ? 'is-focus' : 'is-passive'}`} />
                  <div className="entry-content">
                    <p className="entry-time">
                      {formatClockRange(started, ended)}
                      <span>{formatDurationSeconds(item.session_duration_seconds)}</span>
                    </p>
                    <h4>{narrative.headline}</h4>
                    <p className="entry-stats">
                      Avg stress {stress} · Heart rate {item.heart_rate_bpm == null ? '--' : Math.round(item.heart_rate_bpm)} bpm · Posture {friendlyPosture(item.posture_score)}
                    </p>
                    <div className="entry-stress-bar"><div style={{ width: `${stress}%`, background: stressColor(stress) }} /></div>
                  </div>
                </article>
              )
            })}
          </div>
        )}
      </motion.section>
    </>
  )
}
