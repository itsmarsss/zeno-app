import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import { motion } from 'framer-motion'
import { stressIndexFromHistory } from '../../shared/metrics'
import type { DailyReport, SessionHistoryItem } from '../../shared/types'
import './OverviewTab.css'
import { staggerItem } from '../../shared/motion'
import {
  type DeltaTone,
  classifySession,
  formatClockRange,
  formatDelta,
  formatDurationSeconds,
  formatMinutes,
  mean,
  stressColor,
  stressTone,
} from '../../shared/dashboard'
import { AnimatedTickerText } from '../common/AnimatedTickerText'
import { InteractiveLineChart } from '../common/InteractiveLineChart'

type TimelinePoint = {
  slotStartIso: string
  slotEndIso: string
  label: string
  stress: number | null
  heartRate: number | null
  respiratoryRate: number | null
  rrConfidence: 'none' | 'partial' | 'full'
  postureScore: number | null
  focusActive: boolean
  passiveMarkerActive: boolean
  breathing: boolean
  pointType: 'passive' | 'focus' | 'filled' | 'unknown'
}

type SecondaryMetricSeries = {
  peakStress: number[]
  avgFocusSession: number[]
  postureAvg: number[]
  breakMinutes: number[]
}

type CalendarCell = {
  iso: string
  day: number
  inMonth: boolean
  disabled: boolean
}

const WEEKDAY_SHORT = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']

function parseIsoDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map((part) => Number(part))
  return new Date(y, (m || 1) - 1, d || 1)
}

function isoFromDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1)
}

function addMonths(date: Date, delta: number): Date {
  return new Date(date.getFullYear(), date.getMonth() + delta, 1)
}

function buildCalendarCells(monthDate: Date, minDate: Date, maxDate: Date, selectedIso: string): CalendarCell[] {
  const monthStart = startOfMonth(monthDate)
  const gridStart = new Date(monthStart)
  gridStart.setDate(1 - monthStart.getDay())

  const minIso = isoFromDate(minDate)
  const maxIso = isoFromDate(maxDate)
  const cells: CalendarCell[] = []
  for (let i = 0; i < 42; i += 1) {
    const dayDate = new Date(gridStart)
    dayDate.setDate(gridStart.getDate() + i)
    const iso = isoFromDate(dayDate)
    const inMonth = dayDate.getMonth() === monthDate.getMonth()
    const disabled = iso < minIso || iso > maxIso
    cells.push({
      iso,
      day: dayDate.getDate(),
      inMonth,
      disabled,
    })
  }
  const selectedIdx = cells.findIndex((cell) => cell.iso === selectedIso)
  if (selectedIdx >= 0 && cells[selectedIdx].disabled) {
    cells[selectedIdx] = { ...cells[selectedIdx], disabled: false }
  }
  return cells
}

function SessionCard({ item }: { item: SessionHistoryItem }) {
  const started = new Date(item.created_at)
  const ended = new Date(started.getTime() + item.session_duration_seconds * 1000)
  const stress = stressIndexFromHistory(item)
  const narrative = classifySession(item)
  const isFocus = Boolean(item.focus_mode)

  // Base values
  const baseStress = stress
  const baseHr = item.heart_rate_bpm == null ? null : Math.round(item.heart_rate_bpm)
  const baseRr = item.respiratory_rate > 0 ? item.respiratory_rate : null
  const baseRrConfidence = item.rr_confidence
  const basePosture = Math.round(item.posture_score * 100)
  const baseEmotion = item.dominant_emotion.charAt(0).toUpperCase() + item.dominant_emotion.slice(1)

  // State for hover interaction
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [hoverDirection, setHoverDirection] = useState<1 | -1>(1)

  // Generate chart data for focus sessions (simulated progression)
  const stressPoints = useMemo(
    () =>
      isFocus
        ? [
            { id: '1', label: 'Start', value: Math.max(0, stress - 12) },
            { id: '2', label: '', value: Math.max(0, stress - 8) },
            { id: '3', label: '', value: Math.max(0, stress + 2) },
            { id: '4', label: '', value: Math.max(0, stress - 3) },
            { id: '5', label: 'End', value: stress },
          ]
        : [],
    [isFocus, stress],
  )

  const hrPoints = useMemo(
    () =>
      isFocus && baseHr
        ? [
            Math.max(50, baseHr - 8),
            Math.max(50, baseHr - 4),
            Math.max(50, baseHr + 2),
            Math.max(50, baseHr - 2),
            baseHr,
          ]
        : [],
    [isFocus, baseHr],
  )

  const rrPoints = useMemo(
    () =>
      isFocus && baseRr
        ? [Math.max(8, baseRr - 3), Math.max(8, baseRr - 2), Math.max(8, baseRr + 1), Math.max(8, baseRr - 1), baseRr]
        : [],
    [isFocus, baseRr],
  )

  const posturePoints = useMemo(
    () =>
      isFocus
        ? [
            Math.max(0, basePosture - 15),
            Math.max(0, basePosture - 8),
            Math.max(0, basePosture + 5),
            Math.max(0, basePosture - 3),
            basePosture,
          ]
        : [],
    [isFocus, basePosture],
  )

  // Current display values (hover or base)
  const displayStress = hoveredIndex != null && isFocus ? (stressPoints[hoveredIndex]?.value ?? baseStress) : baseStress
  const displayHr = hoveredIndex != null && isFocus && hrPoints[hoveredIndex] ? hrPoints[hoveredIndex] : baseHr
  const displayRr = hoveredIndex != null && isFocus && rrPoints[hoveredIndex] ? rrPoints[hoveredIndex] : baseRr
  const displayPosture = hoveredIndex != null && isFocus ? (posturePoints[hoveredIndex] ?? basePosture) : basePosture

  const rrPrefix = baseRrConfidence === 'partial' ? '~' : ''
  const rrValue = displayRr ? `${rrPrefix}${Math.round(displayRr)}` : '--'
  const hrValue = displayHr ? Math.round(displayHr) : '--'
  const hoverTimeLabel = useMemo(() => {
    if (!isFocus || hoveredIndex == null || stressPoints.length < 2) return null
    const ratio = hoveredIndex / Math.max(stressPoints.length - 1, 1)
    const at = new Date(started.getTime() + ratio * item.session_duration_seconds * 1000)
    return at.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
  }, [hoveredIndex, isFocus, item.session_duration_seconds, started, stressPoints.length])

  return (
    <article className={`session-card ${isFocus ? 'session-card--focus' : 'session-card--passive'}`}>
      <div className="session-card-header">
        <div className="session-card-info">
          <div className={`session-dot ${isFocus ? 'is-focus' : 'is-passive'}`} />
          <p className="session-time">
            {isFocus
              ? formatClockRange(started, ended)
              : started.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </p>
          {isFocus ? (
            <>
              <span className="session-badge session-badge--focus">Focus</span>
              <span className="session-duration">{formatDurationSeconds(item.session_duration_seconds)}</span>
            </>
          ) : (
            <span className="session-badge session-badge--passive">Check-in</span>
          )}
        </div>
        <p className="session-narrative">{narrative.headline}</p>
      </div>

      {isFocus && (
        <div className="session-chart">
          {hoverTimeLabel ? (
            <p className="session-chart-time">
              <AnimatedTickerText value={hoverTimeLabel} direction={hoverDirection} />
            </p>
          ) : null}
          <InteractiveLineChart
            points={stressPoints}
            yMin={0}
            yMax={100}
            showAxis={false}
            chartHeight={56}
            showTooltip={false}
            className="session-chart-canvas"
            lineClassName="session-chart-stress"
            areaClassName="session-chart-area"
            areaGradientId={`sessionGradient-${item.id}`}
            areaGradientColor={stressColor(baseStress)}
            extraLines={[
              { values: hrPoints, yMin: 50, yMax: 110, className: 'session-chart-hr', smooth: true },
              { values: rrPoints, yMin: 8, yMax: 25, className: 'session-chart-rr', smooth: true },
              { values: posturePoints, yMin: 0, yMax: 100, className: 'session-chart-posture', smooth: true },
            ]}
            onHoverChange={(index, direction) => {
              setHoveredIndex(index)
              setHoverDirection(direction)
            }}
          />
        </div>
      )}

      <div className="session-metrics">
        <div className="session-metric">
          <span className="session-metric-label">Stress</span>
          <strong className="session-metric-value" style={{ color: stressColor(displayStress) }}>
            <AnimatedTickerText value={`${Math.round(displayStress)}`} direction={hoverDirection} />
          </strong>
        </div>
        <div className="session-metric">
          <span className="session-metric-label">HR</span>
          <strong className="session-metric-value">
            <AnimatedTickerText value={`${hrValue}`} staticSuffix=" bpm" direction={hoverDirection} />
          </strong>
        </div>
        <div className="session-metric">
          <span className="session-metric-label">RR</span>
          <strong className="session-metric-value">
            <AnimatedTickerText value={rrValue} staticSuffix=" bpm" direction={hoverDirection} />
          </strong>
        </div>
        <div className="session-metric">
          <span className="session-metric-label">Posture</span>
          <strong className="session-metric-value">
            <AnimatedTickerText value={`${Math.round(displayPosture)}`} staticSuffix="%" direction={hoverDirection} />
          </strong>
        </div>
        <div className="session-metric">
          <span className="session-metric-label">Emotion</span>
          <strong className="session-metric-value">{baseEmotion}</strong>
        </div>
      </div>
    </article>
  )
}

function SecondaryMetric({
  data,
  yMax,
  value,
  label,
}: {
  data: number[]
  yMax: number
  value: string | number
  label: string
}) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [hoverDirection, setHoverDirection] = useState<1 | -1>(1)
  const gradientId = `secondaryMetricGradient-${useId().replace(/:/g, '')}`
  const dayDateLabels = useMemo(() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    return data.map((_, i) => {
      const d = new Date(today)
      d.setDate(today.getDate() - (data.length - 1 - i))
      return `${d.toLocaleDateString([], { weekday: 'short' })} · ${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}`
    })
  }, [data])

  const points = useMemo(
    () =>
      data.map((v, i) => ({
        id: `${i}`,
        label: dayDateLabels[i] ?? `Day ${i + 1}`,
        value: v,
      })),
    [data, dayDateLabels],
  )

  const displayValue = hoveredIndex != null ? (points[hoveredIndex]?.value ?? value) : value
  const displayDayDate = hoveredIndex != null ? (points[hoveredIndex]?.label ?? '') : (points[points.length - 1]?.label ?? '')

  return (
    <article className="secondary-cell">
      <div className="secondary-sparkline">
        <InteractiveLineChart
          points={points}
          yMin={0}
          yMax={yMax}
          showAxis={false}
          chartHeight={32}
          showTooltip={false}
          className=""
          lineClassName="secondary-sparkline-line"
          areaClassName="secondary-sparkline-area"
          areaGradientId={gradientId}
          areaGradientColor="var(--accent)"
          snapCursorToIndex
          onHoverChange={(index, direction) => {
            setHoveredIndex(index)
            setHoverDirection(direction)
          }}
        />
      </div>
      <div className="secondary-value-row">
        <strong className="secondary-value">
          <AnimatedTickerText value={`${displayValue}`} direction={hoverDirection} />
        </strong>
        <span className="secondary-value-meta">
          <AnimatedTickerText value={displayDayDate} direction={hoverDirection} />
        </span>
      </div>
      <span className="secondary-label">{label}</span>
    </article>
  )
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
  avgRrToday,
  hrDeltaBaseline,
  todayBreakCount,
  todaySessions,
  timelineData,
  timelineBucketMinutes,
  setTimelineBucketMinutes,
  onShiftOverviewDay,
  onSetOverviewDay,
  selectedDayIso,
  minDayIso,
  maxDayIso,
  canShiftOverviewPrev,
  canShiftOverviewNext,
  secondaryMetricSeries,
  dailyReport,
  onViewFocusHistory,
}: {
  now: Date
  heroHeadline: string
  heroSubline: string
  avgStressToday: number | null
  stressDeltaVsYesterday: number | null
  heroTrendTone: DeltaTone
  todayFocusedMinutes: number
  avgHrToday: number | null
  avgRrToday: number | null
  hrDeltaBaseline: number | null
  todayBreakCount: number
  todaySessions: SessionHistoryItem[]
  timelineData: TimelinePoint[]
  timelineBucketMinutes: number
  setTimelineBucketMinutes: (value: number) => void
  onShiftOverviewDay: (delta: number) => void
  onSetOverviewDay: (isoDate: string) => void
  selectedDayIso: string
  minDayIso: string
  maxDayIso: string
  canShiftOverviewPrev: boolean
  canShiftOverviewNext: boolean
  secondaryMetricSeries: SecondaryMetricSeries
  dailyReport: DailyReport | null
  onViewFocusHistory: () => void
}) {
  const [heroTextDirection, setHeroTextDirection] = useState<1 | -1>(1)
  const previousSelectedDayRef = useRef<string | null>(null)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [calendarMonth, setCalendarMonth] = useState(() => startOfMonth(parseIsoDate(selectedDayIso)))
  const calendarRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const prev = previousSelectedDayRef.current
    if (prev != null && prev !== selectedDayIso) {
      const prevMs = new Date(`${prev}T00:00:00`).getTime()
      const nextMs = new Date(`${selectedDayIso}T00:00:00`).getTime()
      if (Number.isFinite(prevMs) && Number.isFinite(nextMs) && prevMs !== nextMs) {
        setHeroTextDirection(nextMs > prevMs ? 1 : -1)
      }
    }
    previousSelectedDayRef.current = selectedDayIso
  }, [selectedDayIso])

  useEffect(() => {
    setCalendarMonth(startOfMonth(parseIsoDate(selectedDayIso)))
  }, [selectedDayIso])

  useEffect(() => {
    if (!calendarOpen) return
    const onPointerDown = (event: PointerEvent) => {
      const root = calendarRef.current
      if (!root) return
      if (!root.contains(event.target as Node)) {
        setCalendarOpen(false)
      }
    }
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setCalendarOpen(false)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onEscape)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onEscape)
    }
  }, [calendarOpen])

  const heroStressClass = `overview-stress-value is-${stressTone(avgStressToday ?? 0)}`
  const hasHrBaseline = typeof hrDeltaBaseline === 'number' && Number.isFinite(hrDeltaBaseline)
  const minDate = useMemo(() => parseIsoDate(minDayIso), [minDayIso])
  const maxDate = useMemo(() => parseIsoDate(maxDayIso), [maxDayIso])
  const calendarMonthLabel = useMemo(
    () => calendarMonth.toLocaleDateString([], { month: 'short', year: 'numeric' }),
    [calendarMonth],
  )
  const calendarCells = useMemo(
    () => buildCalendarCells(calendarMonth, minDate, maxDate, selectedDayIso),
    [calendarMonth, minDate, maxDate, selectedDayIso],
  )
  const prevMonth = useMemo(() => addMonths(calendarMonth, -1), [calendarMonth])
  const nextMonth = useMemo(() => addMonths(calendarMonth, 1), [calendarMonth])
  const canPrevMonth = isoFromDate(new Date(prevMonth.getFullYear(), prevMonth.getMonth() + 1, 0)) >= minDayIso
  const canNextMonth = isoFromDate(nextMonth) <= maxDayIso

  const timelinePoints = useMemo(
    () =>
      timelineData.map((point) => ({
        id: point.slotStartIso,
        label: point.label,
        value: point.stress,
        pointType: point.pointType,
      })),
    [timelineData],
  )

  const timelineHeartValues = useMemo(() => timelineData.map((point) => point.heartRate), [timelineData])
  const timelineFocusBandMask = useMemo(() => timelineData.map((point) => point.focusActive), [timelineData])
  const timelinePassiveMarkerMask = useMemo(
    () => timelineData.map((point) => point.passiveMarkerActive),
    [timelineData],
  )

  return (
    <>
      <motion.section
        className="overview-section hero-band"
        variants={staggerItem(0)}
        initial="hidden"
        animate="visible"
      >
        <div className="hero-left">
          <div className="hero-date-row">
            <p className="hero-date">
              <AnimatedTickerText
                value={now.toLocaleDateString([], { weekday: 'short', month: 'short', day: '2-digit' }).replace(',', ' ·')}
                direction={heroTextDirection}
              />
            </p>
            <div className="hero-day-nav">
              <div className="hero-date-picker-wrap" ref={calendarRef}>
                <button
                  className="hero-date-picker"
                  aria-label="Pick day"
                  aria-haspopup="dialog"
                  aria-expanded={calendarOpen}
                  onClick={() => setCalendarOpen((prev) => !prev)}
                >
                  <CalendarDays size={13} />
                  <span>{selectedDayIso}</span>
                </button>
                {calendarOpen ? (
                  <div className="hero-calendar-popover" role="dialog" aria-label="Select date">
                    <div className="hero-calendar-head">
                      <button
                        className="hero-calendar-nav"
                        type="button"
                        disabled={!canPrevMonth}
                        onClick={() => setCalendarMonth((prev) => addMonths(prev, -1))}
                        aria-label="Previous month"
                      >
                        <ChevronLeft size={13} />
                      </button>
                      <strong>{calendarMonthLabel}</strong>
                      <button
                        className="hero-calendar-nav"
                        type="button"
                        disabled={!canNextMonth}
                        onClick={() => setCalendarMonth((prev) => addMonths(prev, 1))}
                        aria-label="Next month"
                      >
                        <ChevronRight size={13} />
                      </button>
                    </div>
                    <div className="hero-calendar-weekdays">
                      {WEEKDAY_SHORT.map((day) => (
                        <span key={day}>{day}</span>
                      ))}
                    </div>
                    <div className="hero-calendar-grid">
                      {calendarCells.map((cell) => {
                        const isSelected = cell.iso === selectedDayIso
                        return (
                          <button
                            key={cell.iso}
                            type="button"
                            className={`hero-calendar-day${cell.inMonth ? '' : ' is-outside'}${isSelected ? ' is-selected' : ''}`}
                            disabled={cell.disabled}
                            onClick={() => {
                              onSetOverviewDay(cell.iso)
                              setCalendarOpen(false)
                            }}
                          >
                            {String(cell.day).padStart(2, '0')}
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ) : null}
              </div>
              <button
                className="hero-nav-btn"
                onClick={() => onShiftOverviewDay(-1)}
                disabled={!canShiftOverviewPrev}
                aria-label="Previous day"
              >
                <ChevronLeft size={14} />
              </button>
              <button
                className="hero-nav-btn"
                onClick={() => onShiftOverviewDay(1)}
                disabled={!canShiftOverviewNext}
                aria-label="Next day"
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
          <h1 className="hero-headline-ticker">
            <AnimatedTickerText value={heroHeadline} direction={heroTextDirection} />
          </h1>
          <p className="hero-subline">
            <AnimatedTickerText value={heroSubline} direction={heroTextDirection} />
          </p>
        </div>
        <div className="hero-divider" />
        <div className="hero-right">
          <p className={heroStressClass}>
            <AnimatedTickerText value={`${avgStressToday == null ? '--' : avgStressToday}`} direction={heroTextDirection} />
          </p>
          <p className="hero-stress-label">stress index</p>
          <p className={`hero-stress-trend is-${heroTrendTone}`}>
            <AnimatedTickerText
              value={stressDeltaVsYesterday == null ? '--' : formatDelta(stressDeltaVsYesterday)}
              direction={heroTextDirection}
            />
          </p>
        </div>
      </motion.section>

      <motion.section
        className="overview-section narrative-strip"
        variants={staggerItem(0.04)}
        initial="hidden"
        animate="visible"
      >
        <article className="narrative-tile">
          <p className="narrative-value">
            <AnimatedTickerText
              value={formatMinutes(todayFocusedMinutes)}
              direction={heroTextDirection}
              className="narrative-value-ticker"
            />
          </p>
          <p className="narrative-label">Focused Time</p>
          <p className="narrative-context is-positive">
            <AnimatedTickerText
              value={`${todayFocusedMinutes >= 90 ? 'Personal best this week' : 'Building consistency'} · ${formatMinutes(todayFocusedMinutes)} focused`}
              direction={heroTextDirection}
            />
          </p>
        </article>
        <article className="narrative-tile">
          <p className="narrative-value">
            <AnimatedTickerText
              value={avgHrToday == null ? '--' : `${avgHrToday}`}
              staticSuffix={avgHrToday == null ? '' : ' bpm'}
              direction={heroTextDirection}
              className="narrative-value-ticker"
            />
          </p>
          <p className="narrative-label">Avg Heart / Respiratory</p>
          <p className={`narrative-context ${!hasHrBaseline || hrDeltaBaseline <= 0 ? 'is-positive' : 'is-negative'}`}>
            <AnimatedTickerText
              value={
                hasHrBaseline
                  ? `${Math.abs(hrDeltaBaseline)} ${hrDeltaBaseline <= 0 ? 'below' : 'above'} baseline · RR ${avgRrToday == null ? '--' : `${avgRrToday} bpm`}`
                  : `Baseline pending · RR ${avgRrToday == null ? '--' : `${avgRrToday} bpm`}`
              }
              direction={heroTextDirection}
            />
          </p>
        </article>
        <article className="narrative-tile">
          <p className="narrative-value">
            <AnimatedTickerText
              value={`${todayBreakCount}`}
              direction={heroTextDirection}
              className="narrative-value-ticker"
            />
          </p>
          <p className="narrative-label">Breaks Taken</p>
          <p className={`narrative-context ${todayBreakCount >= 2 ? 'is-positive' : 'is-neutral'}`}>
            <AnimatedTickerText
              value={`${todayBreakCount >= 2 ? 'All genuine' : 'Could use one more break'} · ${todayBreakCount} breaks`}
              direction={heroTextDirection}
            />
          </p>
        </article>
      </motion.section>

      <motion.section
        className="overview-section primary-chart"
        variants={staggerItem(0.08)}
        initial="hidden"
        animate="visible"
      >
        <div className="main-panel-head">
          <h3>Timeline · 12am - 12am</h3>
          <div className="overview-chart-controls">
            <button className="overview-view-more overview-view-more--secondary" onClick={onViewFocusHistory}>
              View More
            </button>
            <label className="timeline-interval-label">
              <span>Interval</span>
              <select
                className="timeline-interval-select"
                value={timelineBucketMinutes}
                onChange={(event) => setTimelineBucketMinutes(Number(event.target.value))}
              >
                <option value={15}>15m</option>
                <option value={30}>30m</option>
                <option value={60}>1h</option>
                <option value={180}>3h</option>
              </select>
            </label>
          </div>
        </div>
        {todaySessions.length === 0 ? (
          <p className="main-empty">No sessions yet today.</p>
        ) : (
          <div className="overview-chart-canvas">
            <InteractiveLineChart
              points={timelinePoints}
              yMin={0}
              yMax={100}
              valueLabel="Stress"
              lineClassName="timeline-stress"
              areaClassName="timeline-area"
              areaGradientId="overviewStressGradient"
              areaGradientColor={stressColor(avgStressToday ?? 20)}
              showAxis={true}
              chartHeight={160}
              tooltipWidth={196}
              markerPointTypes={['passive']}
              markerClassName="timeline-passive-marker"
              markerMask={timelinePassiveMarkerMask}
              bandMask={timelineFocusBandMask}
              bandPointTypes={[]}
              bandClassName="timeline-focus-band"
              snapToPointTypes={['passive']}
              snapRadiusPx={12}
              extraLines={[
                { values: timelineHeartValues, yMin: 50, yMax: 110, className: 'timeline-heart', smooth: true },
              ]}
              renderTooltip={({ point, index, direction }) => {
                const dataPoint = timelineData[index]
                if (!dataPoint) return null
                const rrPrefix = dataPoint.rrConfidence === 'partial' ? '~' : ''
                const rrValue = dataPoint.respiratoryRate != null ? `${rrPrefix}${dataPoint.respiratoryRate}` : '--'
                return (
                  <>
                    <p>
                      <AnimatedTickerText value={point.label} direction={direction} />
                    </p>
                    <div className="interactive-chart-tooltip-row">
                      <strong>
                        <AnimatedTickerText value={`${dataPoint.stress ?? '--'}`} direction={direction} />
                      </strong>
                      <span>Stress index</span>
                    </div>
                    <div className="interactive-chart-tooltip-row">
                      <strong>
                        <AnimatedTickerText
                          value={`${dataPoint.heartRate ?? '--'}`}
                          staticSuffix=" bpm"
                          direction={direction}
                        />
                      </strong>
                      <span>Heart rate</span>
                    </div>
                    <div className="interactive-chart-tooltip-row">
                      <strong>
                        <AnimatedTickerText value={rrValue} staticSuffix=" bpm" direction={direction} />
                      </strong>
                      <span>Respiratory rate</span>
                    </div>
                    <div className="interactive-chart-tooltip-row">
                      <strong>
                        <AnimatedTickerText value={`${dataPoint.postureScore ?? '--'}`} direction={direction} />
                      </strong>
                      <span>Posture score</span>
                    </div>
                    <div className="interactive-chart-tooltip-row">
                      <strong
                        className={
                          dataPoint.pointType === 'filled'
                            ? 'interactive-chart-source interactive-chart-source--filled'
                            : 'interactive-chart-source'
                        }
                      >
                        <AnimatedTickerText
                          value={
                            dataPoint.pointType === 'focus'
                              ? 'Focus'
                              : dataPoint.pointType === 'passive'
                                ? 'Passive'
                                : dataPoint.pointType === 'filled'
                                  ? 'Filled'
                                  : 'Unknown'
                          }
                          direction={direction}
                        />
                      </strong>
                      <span>Source</span>
                    </div>
                  </>
                )
              }}
            />
          </div>
        )}
      </motion.section>
      <motion.section
        className="overview-section secondary-metrics"
        variants={staggerItem(0.12)}
        initial="hidden"
        animate="visible"
      >
        <div className="secondary-metrics-head">Last 7 days</div>
        <SecondaryMetric
          data={secondaryMetricSeries.peakStress}
          yMax={100}
          value={dailyReport?.peak_stress?.stress_index ?? (avgStressToday == null ? '--' : avgStressToday)}
          label="Peak stress"
        />
        <SecondaryMetric
          data={secondaryMetricSeries.avgFocusSession}
          yMax={120}
          value={formatMinutes(Math.round(mean(secondaryMetricSeries.avgFocusSession)))}
          label="Avg focus session"
        />
        <SecondaryMetric
          data={secondaryMetricSeries.postureAvg}
          yMax={100}
          value={Math.round(mean(secondaryMetricSeries.postureAvg)) || 0}
          label="Avg posture score"
        />
        <SecondaryMetric
          data={secondaryMetricSeries.breakMinutes}
          yMax={60}
          value={todayBreakCount}
          label="Break minutes"
        />
      </motion.section>

      <motion.section
        className="overview-section session-log"
        variants={staggerItem(0.2)}
        initial="hidden"
        animate="visible"
      >
        <h3>Today's sessions</h3>
        {todaySessions.length === 0 ? (
          <p className="main-empty">No sessions yet today.</p>
        ) : (
          <div className="editorial-timeline">
            <div className="editorial-line" />
            {todaySessions.slice(-12).map((item) => (
              <SessionCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </motion.section>
    </>
  )
}
