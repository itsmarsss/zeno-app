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
  hour: number
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
  timelineAreaPath,
  timelineStressPath,
  timelineHeartPath,
  insights,
  secondaryMetricSeries,
  dailyReport,
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
  timelineAreaPath: string
  timelineStressPath: string
  timelineHeartPath: string
  insights: InsightCard[]
  secondaryMetricSeries: SecondaryMetricSeries
  dailyReport: DailyReport | null
}) {
  const heroStressClass = `overview-stress-value is-${stressTone(avgStressToday)}`

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
          <span>{`${formatHourLabel(6)} - now`}</span>
        </div>
        {todaySessions.length === 0 ? (
          <p className="main-empty">No sessions yet today.</p>
        ) : (
          <div
            className="overview-chart-canvas"
            onMouseLeave={() => setChartHoverIndex(null)}
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect()
              const ratio = clamp((event.clientX - rect.left) / Math.max(rect.width, 1), 0, 1)
              const nextIndex = Math.round(ratio * (timelineData.length - 1))
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
              {timelineData.map((point, index) => {
                if (!point.focusActive) return null
                const xStart = (index / timelineData.length) * 100
                return <rect key={`${point.hour}-focus`} x={xStart} y={0} width={(1 / timelineData.length) * 100} height={100} className="focus-band" />
              })}
              <path d={timelineAreaPath} className="timeline-area" />
              <path d={timelineStressPath} className="timeline-stress" />
              <path d={timelineHeartPath} className="timeline-heart" />
              {timelineData.map((point, index) => {
                if (!point.breathing) return null
                const x = timelineData.length === 1 ? 50 : (index / (timelineData.length - 1)) * 100
                return <line key={`${point.hour}-breath`} x1={x} x2={x} y1={0} y2={100} className="timeline-breath" />
              })}
            </svg>
            {chartHoverIndex != null && timelineData[chartHoverIndex] && (
              <div className="timeline-tooltip" style={{ left: `${(chartHoverIndex / Math.max(timelineData.length - 1, 1)) * 100}%` }}>
                <p>{timelineData[chartHoverIndex].label}</p>
                <strong>Stress: {timelineData[chartHoverIndex].stress ?? '--'}</strong>
                <span>Heart rate: {timelineData[chartHoverIndex].heartRate ?? '--'} bpm</span>
                {timelineData[chartHoverIndex].focusActive && <em>Focus Mode active</em>}
              </div>
            )}
            <div className="timeline-axis">
              {timelineData.map((point, index) => (index % 3 === 0 || index === timelineData.length - 1 ? <span key={point.hour}>{point.label}</span> : <span key={point.hour} />))}
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
