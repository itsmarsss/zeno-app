import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { AnimatePresence, motion } from 'framer-motion'
import { FocusHistoryTab } from './focus/FocusHistoryTab'
import { OverviewTab } from './overview/OverviewTab'
import { PostureTab } from './posture/PostureTab'
import { ExercisesTab } from './exercises/ExercisesTab'
import { SettingsTab } from './settings/SettingsTab'
import { SidebarNav, type MainTab } from './common/SidebarNav'
import { EXERCISE_LIBRARY, FREE_EXERCISE_IDS } from '../shared/constants'
import { stressIndexFromHistory } from '../shared/metrics'
import type { CalibrationStatus, DailyReport, PostureLandmarks, PostureStreamFrame, SessionHistoryItem } from '../shared/types'
import {
  buildAreaPath,
  buildInsights,
  buildPath,
  formatHourLabel,
  formatMinutes,
  generateHeadline,
  localDateKey,
  mean,
  startDateForPeriod,
  trendTone,
  type FocusPeriod,
} from '../shared/dashboard'
import { useAppSettings } from '../context/AppSettingsContext'
import { fadeSlide } from '../shared/motion'
import './MainWindowShell.css'

const HOUR_START = 6
const HOUR_END = 21
const DEFAULT_TIMELINE_BUCKET_MINUTES = 15
const HEATMAP_START = 8
const HEATMAP_END = 19
const PATTERN_MIN_SESSIONS = 10

export function MainWindowShell({
  history,
  dailyReport,
  calibration,
  lastRunSource,
  error,
  replayOnboarding,
  clearAllData,
}: {
  history: SessionHistoryItem[]
  dailyReport: DailyReport | null
  calibration: CalibrationStatus | null
  lastRunSource: string | null
  error: string | null
  replayOnboarding: () => void
  clearAllData: () => Promise<void>
}) {
  const { settings, updateSettings } = useAppSettings()
  const [tab, setTab] = useState<MainTab>('overview')
  const [selectedExerciseId, setSelectedExerciseId] = useState(EXERCISE_LIBRARY[0]?.id ?? 'chin-tuck')
  const [exerciseGuidedActive, setExerciseGuidedActive] = useState(false)
  const [exerciseFeedback, setExerciseFeedback] = useState<string | null>(null)
  const [exerciseMetrics, setExerciseMetrics] = useState<PostureStreamFrame['exercise_metrics']>(null)
  const [licenseInput, setLicenseInput] = useState('')
  const [paywallMessage, setPaywallMessage] = useState<string | null>(null)
  const [postureFrame, setPostureFrame] = useState<string | null>(null)
  const [postureLandmarks, setPostureLandmarks] = useState<PostureLandmarks>(null)
  const [postureScoreLive, setPostureScoreLive] = useState<number | null>(null)
  const [postureStreamState, setPostureStreamState] = useState<'stopped' | 'connecting' | 'running' | 'no-pose' | 'error'>('stopped')
  const [postureStreamError, setPostureStreamError] = useState<string | null>(null)
  const [focusPeriod, setFocusPeriod] = useState<FocusPeriod>('week')
  const [expandedSessionId, setExpandedSessionId] = useState<number | null>(null)
  const [sortNewestFirst, setSortNewestFirst] = useState(true)
  const [chartHoverIndex, setChartHoverIndex] = useState<number | null>(null)
  const [timelineBucketMinutes, setTimelineBucketMinutes] = useState<number>(DEFAULT_TIMELINE_BUCKET_MINUTES)

  const now = new Date()
  const todayKey = localDateKey(now)
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  const yesterdayKey = localDateKey(yesterday)

  const sessionsSortedAsc = [...history].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
  const todaySessions = sessionsSortedAsc.filter((item) => localDateKey(new Date(item.created_at)) === todayKey)
  const yesterdaySessions = sessionsSortedAsc.filter((item) => localDateKey(new Date(item.created_at)) === yesterdayKey)

  const focusSessions = history.filter((item) => Boolean(item.focus_mode))
  const todayStressValues = todaySessions.map((item) => stressIndexFromHistory(item))
  const yesterdayStressValues = yesterdaySessions.map((item) => stressIndexFromHistory(item))
  const avgStressToday = Math.round(mean(todayStressValues))
  const avgStressYesterday = Math.round(mean(yesterdayStressValues))
  const stressDeltaVsYesterday = avgStressToday - avgStressYesterday

  const todayFocusedSeconds = todaySessions.filter((item) => Boolean(item.focus_mode)).reduce((sum, item) => sum + item.session_duration_seconds, 0)
  const todayFocusedMinutes = Math.round(todayFocusedSeconds / 60)
  const todayBreakCount = todaySessions.filter((item) => !item.focus_mode).length
  const todayHeartRates = todaySessions.map((item) => item.heart_rate_bpm).filter((value): value is number => value != null)
  const avgHrToday = Math.round(mean(todayHeartRates))

  const baselineHrPool = history
    .filter((item) => localDateKey(new Date(item.created_at)) !== todayKey)
    .map((item) => item.heart_rate_bpm)
    .filter((value): value is number => value != null)
  const hrDeltaBaseline = avgHrToday - Math.round(mean(baselineHrPool))

  const heroHeadline = generateHeadline(avgStressToday, todayFocusedMinutes, stressDeltaVsYesterday)
  const heroSubline = `Average stress ${avgStressToday || 0} · ${formatMinutes(todayFocusedMinutes)} focused · ${todayBreakCount} breaks taken`
  const heroTrendTone = trendTone(stressDeltaVsYesterday)

  const timelineData: Array<{ slotStartIso: string; slotEndIso: string; label: string; stress: number | null; heartRate: number | null; focusActive: boolean; breathing: boolean }> = []
  const timelineStart = new Date(now)
  timelineStart.setHours(HOUR_START, 0, 0, 0)
  const timelineEnd = new Date(now)
  timelineEnd.setHours(HOUR_END, 59, 59, 999)
  const clampedEnd = now < timelineEnd ? now : timelineEnd
  for (let slot = new Date(timelineStart); slot <= clampedEnd; slot = new Date(slot.getTime() + timelineBucketMinutes * 60_000)) {
    const slotEnd = new Date(slot.getTime() + timelineBucketMinutes * 60_000)
    const slice = todaySessions.filter((item) => {
      const at = new Date(item.created_at)
      return at >= slot && at < slotEnd
    })
    const overlapSlice = todaySessions.filter((item) => {
      const start = new Date(item.created_at)
      const end = new Date(start.getTime() + item.session_duration_seconds * 1000)
      return start < slotEnd && end > slot
    })
    const stressAvg = slice.length ? mean(slice.map((item) => stressIndexFromHistory(item))) : null
    const hrAvg = mean(slice.map((item) => item.heart_rate_bpm).filter((value): value is number => value != null))
    timelineData.push({
      slotStartIso: slot.toISOString(),
      slotEndIso: slotEnd.toISOString(),
      label: slot.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }),
      stress: stressAvg == null ? null : Math.round(stressAvg),
      heartRate: Number.isFinite(hrAvg) && hrAvg > 0 ? Math.round(hrAvg) : null,
      focusActive: overlapSlice.some((item) => Boolean(item.focus_mode)),
      breathing: overlapSlice.some((item) => item.emotion_backend.toLowerCase().includes('breath')),
    })
  }

  const timelineStress = timelineData.map((point) => point.stress ?? 0)
  const timelineHeart = timelineData.map((point) => (point.focusActive ? point.heartRate : null))
  const timelineAreaPath = buildAreaPath(timelineStress, 0, 100, 100, 100)
  const timelineStressPath = buildPath(timelineStress, 0, 100, 100, 100)
  const timelineHeartPath = buildPath(timelineHeart, 50, 110, 100, 100)

  const insights = buildInsights(history, todaySessions)

  function handleTimelineBucketMinutesChange(value: number) {
    setTimelineBucketMinutes(value)
    setChartHoverIndex(null)
  }

  const sevenDayDays: string[] = []
  for (let offset = 6; offset >= 0; offset -= 1) {
    const d = new Date()
    d.setDate(d.getDate() - offset)
    sevenDayDays.push(localDateKey(d))
  }

  const dayBuckets = new Map<string, SessionHistoryItem[]>()
  sevenDayDays.forEach((key) => dayBuckets.set(key, []))
  history.forEach((item) => {
    const key = localDateKey(new Date(item.created_at))
    dayBuckets.get(key)?.push(item)
  })

  const secondaryMetricSeries = {
    peakStress: sevenDayDays.map((key) => {
      const items = dayBuckets.get(key) ?? []
      return items.length ? Math.max(...items.map((item) => stressIndexFromHistory(item))) : 0
    }),
    avgFocusSession: sevenDayDays.map((key) => {
      const focus = (dayBuckets.get(key) ?? []).filter((item) => Boolean(item.focus_mode))
      if (!focus.length) return 0
      return Math.round(mean(focus.map((item) => item.session_duration_seconds / 60)))
    }),
    postureAvg: sevenDayDays.map((key) => {
      const items = dayBuckets.get(key) ?? []
      if (!items.length) return 0
      return Math.round(mean(items.map((item) => item.posture_score * 100)))
    }),
    breakMinutes: sevenDayDays.map((key) => {
      const passive = (dayBuckets.get(key) ?? []).filter((item) => !item.focus_mode)
      return Math.round(passive.reduce((sum, item) => sum + item.session_duration_seconds, 0) / 60)
    }),
  }

  const periodStart = useMemo(() => startDateForPeriod(focusPeriod), [focusPeriod])
  const periodEnd = useMemo(() => {
    const end = new Date()
    end.setHours(23, 59, 59, 999)
    return end
  }, [])
  const periodRangeLabel = useMemo(
    () =>
      `${periodStart.toLocaleDateString([], { month: 'short', day: 'numeric' })} - ${periodEnd.toLocaleDateString([], { month: 'short', day: 'numeric' })}`,
    [periodEnd, periodStart],
  )
  const currentPeriodFocus = useMemo(() => focusSessions.filter((item) => new Date(item.created_at) >= periodStart), [focusSessions, periodStart])

  const previousPeriodFocus = useMemo(() => {
    const end = new Date(periodStart)
    end.setSeconds(end.getSeconds() - 1)
    const days = focusPeriod === 'week' ? 7 : focusPeriod === 'month' ? 30 : 90
    const start = new Date(end)
    start.setDate(end.getDate() - (days - 1))
    return focusSessions.filter((item) => {
      const at = new Date(item.created_at)
      return at >= start && at <= end
    })
  }, [focusPeriod, focusSessions, periodStart])

  const periodFocusedMinutes = Math.round(currentPeriodFocus.reduce((sum, item) => sum + item.session_duration_seconds, 0) / 60)
  const periodAvgStress = Math.round(mean(currentPeriodFocus.map((item) => stressIndexFromHistory(item))))
  const periodSessionCount = currentPeriodFocus.length
  const hasEnoughPatternData = periodSessionCount >= PATTERN_MIN_SESSIONS
  const patternSessionsNeeded = Math.max(0, PATTERN_MIN_SESSIONS - periodSessionCount)
  const previousFocusedMinutes = Math.round(previousPeriodFocus.reduce((sum, item) => sum + item.session_duration_seconds, 0) / 60)
  const previousAvgStress = Math.round(mean(previousPeriodFocus.map((item) => stressIndexFromHistory(item))))
  const previousSessionCount = previousPeriodFocus.length

  const focusHeroDeltaTime = previousFocusedMinutes === 0 ? 0 : Math.round(((periodFocusedMinutes - previousFocusedMinutes) / previousFocusedMinutes) * 100)
  const focusHeroDeltaStress = previousAvgStress === 0 ? 0 : Math.round(((periodAvgStress - previousAvgStress) / previousAvgStress) * 100)
  const focusHeroDeltaSessions = previousSessionCount === 0 ? 0 : Math.round(((periodSessionCount - previousSessionCount) / previousSessionCount) * 100)

  const heatmapData = useMemo(() => {
    const rows = 7
    const cols = HEATMAP_END - HEATMAP_START + 1
    const matrix = Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ avgStress: null as number | null, count: 0 })))
    currentPeriodFocus.forEach((item) => {
      const date = new Date(item.created_at)
      const weekday = (date.getDay() + 6) % 7
      const hour = date.getHours()
      if (hour < HEATMAP_START || hour > HEATMAP_END) return
      const slot = matrix[weekday][hour - HEATMAP_START]
      const stress = stressIndexFromHistory(item)
      const nextCount = slot.count + 1
      slot.avgStress = slot.avgStress == null ? stress : (slot.avgStress * slot.count + stress) / nextCount
      slot.count = nextCount
    })
    return matrix
  }, [currentPeriodFocus])

  const focusPatternCallout = useMemo(() => {
    const dayNames = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']
    let bestScore = -1
    let bestDay = -1
    let bestHour = -1

    heatmapData.forEach((row, day) => {
      row.forEach((cell, hourIndex) => {
        if (!cell.count || cell.avgStress == null) return
        const score = cell.count * (100 - cell.avgStress)
        if (score > bestScore) {
          bestScore = score
          bestDay = day
          bestHour = HEATMAP_START + hourIndex
        }
      })
    })

    if (bestDay < 0 || bestHour < 0) return null
    return `You focus best on ${dayNames[bestDay]} around ${formatHourLabel(bestHour)}`
  }, [heatmapData])

  const rhythmData = useMemo(() => {
    if (focusPeriod === 'week') {
      const points: Array<{ label: string; focusedMinutes: number; avgStress: number | null }> = []
      for (let i = 0; i < 7; i += 1) {
        const dayStart = new Date(periodStart)
        dayStart.setDate(periodStart.getDate() + i)
        dayStart.setHours(0, 0, 0, 0)
        const dayEnd = new Date(dayStart)
        dayEnd.setHours(23, 59, 59, 999)
        const items = currentPeriodFocus.filter((item) => {
          const at = new Date(item.created_at)
          return at >= dayStart && at <= dayEnd
        })
        const focusedMinutes = Math.round(items.reduce((sum, item) => sum + item.session_duration_seconds, 0) / 60)
        const avgStress = Math.round(mean(items.map((item) => stressIndexFromHistory(item))))
        points.push({
          label: dayStart.toLocaleDateString([], { weekday: 'short' }),
          focusedMinutes,
          avgStress: Number.isFinite(avgStress) && avgStress > 0 ? avgStress : null,
        })
      }
      return points
    }

    if (focusPeriod === 'month') {
      const points: Array<{ label: string; focusedMinutes: number; avgStress: number | null }> = []
      for (let i = 0; i < 6; i += 1) {
        const bucketStart = new Date(periodStart)
        bucketStart.setDate(periodStart.getDate() + i * 5)
        bucketStart.setHours(0, 0, 0, 0)
        const bucketEnd = new Date(bucketStart)
        bucketEnd.setDate(bucketStart.getDate() + 4)
        bucketEnd.setHours(23, 59, 59, 999)
        const items = currentPeriodFocus.filter((item) => {
          const at = new Date(item.created_at)
          return at >= bucketStart && at <= bucketEnd
        })
        const focusedMinutes = Math.round(items.reduce((sum, item) => sum + item.session_duration_seconds, 0) / 60)
        const avgStress = Math.round(mean(items.map((item) => stressIndexFromHistory(item))))
        points.push({
          label: `W${i + 1}`,
          focusedMinutes,
          avgStress: Number.isFinite(avgStress) && avgStress > 0 ? avgStress : null,
        })
      }
      return points
    }

    const monthPoints: Array<{ label: string; focusedMinutes: number; avgStress: number | null }> = []
    for (let i = 2; i >= 0; i -= 1) {
      const monthStart = new Date()
      monthStart.setMonth(monthStart.getMonth() - i, 1)
      monthStart.setHours(0, 0, 0, 0)
      const monthEnd = new Date(monthStart)
      monthEnd.setMonth(monthStart.getMonth() + 1, 0)
      monthEnd.setHours(23, 59, 59, 999)
      const items = currentPeriodFocus.filter((item) => {
        const at = new Date(item.created_at)
        return at >= monthStart && at <= monthEnd
      })
      const focusedMinutes = Math.round(items.reduce((sum, item) => sum + item.session_duration_seconds, 0) / 60)
      const avgStress = Math.round(mean(items.map((item) => stressIndexFromHistory(item))))
      monthPoints.push({
        label: monthStart.toLocaleDateString([], { month: 'short' }),
        focusedMinutes,
        avgStress: Number.isFinite(avgStress) && avgStress > 0 ? avgStress : null,
      })
    }
    return monthPoints
  }, [currentPeriodFocus, focusPeriod, periodStart])

  const rhythmMaxMinutes = Math.max(60, ...rhythmData.map((item) => item.focusedMinutes))
  const rhythmStressPath = buildPath(rhythmData.map((item) => item.avgStress), 0, 100, 100, 100)
  const rhythmBestIndex = rhythmData.reduce((best, item, index, arr) => (item.focusedMinutes > arr[best].focusedMinutes ? index : best), 0)

  const focusSessionsSorted = useMemo(() => {
    const ordered = [...currentPeriodFocus].sort((a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime())
    return sortNewestFirst ? ordered.reverse() : ordered
  }, [currentPeriodFocus, sortNewestFirst])

  const selectedExercise = EXERCISE_LIBRARY.find((exercise) => exercise.id === selectedExerciseId) ?? EXERCISE_LIBRARY[0] ?? null
  const isPro = settings?.plan_tier === 'pro'

  function toggleGuidedExercise(exerciseId?: string) {
    const targetExercise = (exerciseId
      ? EXERCISE_LIBRARY.find((exercise) => exercise.id === exerciseId)
      : selectedExercise) ?? selectedExercise

    if (!isPro) {
      setPaywallMessage('Guided sets are a Pro feature. Add your license key in Settings.')
      return
    }
    if (targetExercise && !FREE_EXERCISE_IDS.has(targetExercise.id)) {
      setPaywallMessage('This exercise requires Pro.')
      return
    }

    if (targetExercise) {
      setSelectedExerciseId(targetExercise.id)
    }
    setPaywallMessage(null)

    setExerciseGuidedActive((v) => {
      const next = !v
      if (!next) {
        setExerciseFeedback(null)
        setExerciseMetrics(null)
      }
      return next
    })
  }

  function openExercisesTab() {
    setTab('exercises')
  }

  function startExerciseFromPosture(exerciseId: string) {
    setSelectedExerciseId(exerciseId)
    setPaywallMessage(null)
    setExerciseFeedback(null)
    setExerciseMetrics(null)
    setExerciseGuidedActive(false)
    setTab('exercises')
  }

  useEffect(() => {
    const shouldStream = tab === 'posture' || (tab === 'exercises' && exerciseGuidedActive)
    if (!shouldStream) return

    let unlistenFrame: (() => void) | undefined
    let unlistenEnded: (() => void) | undefined

    async function startBackendPostureStream() {
      setPostureStreamState('connecting')
      setPostureStreamError(null)
      try {
        const exerciseIdArg = tab === 'exercises' ? selectedExercise?.id ?? null : null
        await invoke('start_posture_stream', { fps: 8, exerciseId: exerciseIdArg })
        unlistenFrame = await listen<PostureStreamFrame>('posture-stream-frame', (event) => {
          const payload = event.payload
          setPostureFrame(`data:image/jpeg;base64,${payload.frame_jpeg_b64}`)
          setPostureLandmarks(payload.landmarks ?? null)
          setPostureScoreLive(payload.posture_score)
          setExerciseFeedback(payload.exercise_feedback ?? null)
          setExerciseMetrics(payload.exercise_metrics ?? null)
          setPostureStreamState(payload.landmarks ? 'running' : 'no-pose')
        })
        unlistenEnded = await listen('posture-stream-ended', () => setPostureStreamState('stopped'))
      } catch (err) {
        setPostureStreamState('error')
        setPostureStreamError(err instanceof Error ? err.message : 'Unable to start posture stream.')
      }
    }

    void startBackendPostureStream()
    return () => {
      if (unlistenFrame) unlistenFrame()
      if (unlistenEnded) unlistenEnded()
      void invoke('stop_posture_stream').catch(() => null)
    }
  }, [tab, exerciseGuidedActive, selectedExercise?.id, selectedExercise])

  return (
    <main className="main-shell">
      <SidebarNav tab={tab} setTab={setTab} />

      <section className="main-content">
        <AnimatePresence mode="wait" initial={false}>
          {tab === 'overview' && (
            <motion.div key="tab-overview" variants={fadeSlide} initial="hidden" animate="visible" exit="exit">
              <OverviewTab
                now={now}
                heroHeadline={heroHeadline}
                heroSubline={heroSubline}
                avgStressToday={avgStressToday}
                stressDeltaVsYesterday={stressDeltaVsYesterday}
                heroTrendTone={heroTrendTone}
                todayFocusedMinutes={todayFocusedMinutes}
                avgHrToday={avgHrToday}
                hrDeltaBaseline={hrDeltaBaseline}
                todayBreakCount={todayBreakCount}
                todaySessions={todaySessions}
                timelineData={timelineData}
                chartHoverIndex={chartHoverIndex}
                setChartHoverIndex={setChartHoverIndex}
                timelineBucketMinutes={timelineBucketMinutes}
                setTimelineBucketMinutes={handleTimelineBucketMinutesChange}
                timelineAreaPath={timelineAreaPath}
                timelineStressPath={timelineStressPath}
                timelineHeartPath={timelineHeartPath}
                insights={insights}
                secondaryMetricSeries={secondaryMetricSeries}
                dailyReport={dailyReport}
                onViewFocusHistory={() => setTab('focus')}
              />
            </motion.div>
          )}

          {tab === 'focus' && (
            <motion.div key="tab-focus" variants={fadeSlide} initial="hidden" animate="visible" exit="exit">
              <FocusHistoryTab
                focusPeriod={focusPeriod}
                setFocusPeriod={setFocusPeriod}
                periodSessionCount={periodSessionCount}
                periodFocusedMinutes={periodFocusedMinutes}
                periodAvgStress={periodAvgStress}
                focusHeroDeltaTime={focusHeroDeltaTime}
                focusHeroDeltaStress={focusHeroDeltaStress}
                focusHeroDeltaSessions={focusHeroDeltaSessions}
                periodRangeLabel={periodRangeLabel}
                hasEnoughPatternData={hasEnoughPatternData}
                patternSessionsNeeded={patternSessionsNeeded}
                heatmapData={heatmapData}
                focusPatternCallout={focusPatternCallout}
                rhythmData={rhythmData}
                rhythmMaxMinutes={rhythmMaxMinutes}
                rhythmStressPath={rhythmStressPath}
                rhythmBestIndex={rhythmBestIndex}
                focusSessionsSorted={focusSessionsSorted}
                expandedSessionId={expandedSessionId}
                setExpandedSessionId={setExpandedSessionId}
                sortNewestFirst={sortNewestFirst}
                setSortNewestFirst={setSortNewestFirst}
              />
            </motion.div>
          )}

          {tab === 'posture' && (
            <motion.div key="tab-posture" variants={fadeSlide} initial="hidden" animate="visible" exit="exit">
              <PostureTab
                postureStreamState={postureStreamState}
                postureScoreLive={postureScoreLive}
                postureFrame={postureFrame}
                postureLandmarks={postureLandmarks}
                postureStreamError={postureStreamError}
                history={history}
                onSeeAllExercises={openExercisesTab}
                onStartExercise={startExerciseFromPosture}
              />
            </motion.div>
          )}

          {tab === 'exercises' && (
            <motion.div key="tab-exercises" variants={fadeSlide} initial="hidden" animate="visible" exit="exit">
              <ExercisesTab
                exercises={EXERCISE_LIBRARY}
                selectedExerciseId={selectedExerciseId}
                setSelectedExerciseId={setSelectedExerciseId}
                exerciseGuidedActive={exerciseGuidedActive}
                toggleGuided={toggleGuidedExercise}
                postureStreamState={postureStreamState}
                exerciseMetrics={exerciseMetrics}
                postureFrame={postureFrame}
                postureLandmarks={postureLandmarks}
                exerciseFeedback={exerciseFeedback}
                paywallMessage={paywallMessage}
              />
            </motion.div>
          )}

          {tab === 'settings' && (
            <motion.div key="tab-settings" variants={fadeSlide} initial="hidden" animate="visible" exit="exit">
              <SettingsTab
                settings={settings}
                updateSettings={updateSettings}
                isPro={isPro}
                licenseInput={licenseInput}
                setLicenseInput={setLicenseInput}
                calibration={calibration}
                replayOnboarding={replayOnboarding}
                clearAllData={clearAllData}
                lastRunSource={lastRunSource}
                error={error}
              />
            </motion.div>
          )}
        </AnimatePresence>
      </section>
    </main>
  )
}
