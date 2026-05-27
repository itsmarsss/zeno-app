import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronRight, Download, Loader2, Trash2 } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import type { AppSettings, CalibrationStatus } from '../../shared/types'
import {
  WheelPicker,
  formatClockLabel,
  formatDurationLabel,
  formatMinutesLabel,
  rangeItems,
} from '../common/WheelPicker'
import './SettingsTab.css'
import { easeOut } from '../../shared/motion'

type SelectKey = 'frequency' | 'focus_warning' | 'nudge_gap' | 'report_time' | 'start_mode'

const SHEET_LABELS: Record<SelectKey, string> = {
  frequency: 'Check-in frequency',
  focus_warning: 'Focus session warning',
  nudge_gap: 'Minimum time between nudges',
  report_time: 'Daily report time',
  start_mode: 'Start Zeno',
}

const START_MODE_OPTIONS = [
  { label: 'At login', value: 'login', hint: 'Launches automatically when you log in' },
  { label: 'Manually', value: 'manual', hint: 'Only starts when you open it' },
]

function to12h(hour24: number): { hour12: number; period: 'AM' | 'PM' } {
  const period: 'AM' | 'PM' = hour24 >= 12 ? 'PM' : 'AM'
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12
  return { hour12, period }
}

function to24h(hour12: number, period: 'AM' | 'PM'): number {
  if (period === 'AM') return hour12 === 12 ? 0 : hour12
  return hour12 === 12 ? 12 : hour12 + 12
}

export function SettingsTab({
  settings,
  updateSettings,
  calibration,
  replayOnboarding,
  clearAllData,
  lastRunSource,
  error,
  onExportData,
  exportMessage,
}: {
  settings: AppSettings | null
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
  calibration: CalibrationStatus | null
  replayOnboarding: () => void
  clearAllData: () => Promise<void>
  lastRunSource: string | null
  error: string | null
  onExportData: () => Promise<void>
  exportMessage: string | null
}) {
  const [focusWarningMin, setFocusWarningMin] = useState(90)
  const [nudgeGapMin, setNudgeGapMin] = useState(20)
  const [clearExpanded, setClearExpanded] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState<'idle' | 'loading' | 'updated'>('idle')
  const [activeSheet, setActiveSheet] = useState<SelectKey | null>(null)
  const [startModeBusy, setStartModeBusy] = useState(false)
  const [startModeError, setStartModeError] = useState<string | null>(null)
  const [onboardingFlash, setOnboardingFlash] = useState(false)
  const [saving, setSaving] = useState(false)

  // Draft values while a wheel sheet is open
  const [draftMinutes, setDraftMinutes] = useState(10)
  const [draftHoursPart, setDraftHoursPart] = useState(0)
  const [draftMinsPart, setDraftMinsPart] = useState(30)
  const [draftHour12, setDraftHour12] = useState(9)
  const [draftMinute, setDraftMinute] = useState(0)
  const [draftPeriod, setDraftPeriod] = useState<'AM' | 'PM'>('PM')
  const [draftReportOff, setDraftReportOff] = useState(false)
  const [draftFocusNever, setDraftFocusNever] = useState(false)

  const passiveMonitoring = !(settings?.monitoring_paused ?? false)
  const frequencyMinutes = settings?.session_frequency_minutes ?? 10
  const startMode = settings?.launch_at_login === false ? 'manual' : 'login'

  const reportHour = settings?.daily_report_hour ?? 21
  const reportMinute = settings?.daily_report_minute ?? 0
  const reportOff = reportHour < 0

  const frequencyItems = useMemo(() => rangeItems(5, 120, 1), [])
  const hourPartItems = useMemo(() => rangeItems(0, 4, 1), [])
  const minPartItems = useMemo(() => rangeItems(0, 55, 5), [])
  const hour12Items = useMemo(() => rangeItems(1, 12, 1), [])
  const minuteItems = useMemo(() => rangeItems(0, 55, 5, 2), [])
  const periodItems = useMemo(
    () => [
      { value: 'AM', label: 'AM' },
      { value: 'PM', label: 'PM' },
    ],
    [],
  )

  function openSheet(key: SelectKey) {
    if (key === 'frequency') {
      setDraftMinutes(Math.min(120, Math.max(5, frequencyMinutes)))
    }
    if (key === 'focus_warning') {
      if (focusWarningMin <= 0) {
        setDraftFocusNever(true)
        setDraftHoursPart(1)
        setDraftMinsPart(30)
      } else {
        setDraftFocusNever(false)
        setDraftHoursPart(Math.min(4, Math.floor(focusWarningMin / 60)))
        setDraftMinsPart(focusWarningMin % 60 - ((focusWarningMin % 60) % 5))
      }
    }
    if (key === 'nudge_gap') {
      const total = Math.min(240, Math.max(5, nudgeGapMin))
      const h = Math.min(4, Math.floor(total / 60))
      let m = total % 60
      m = m - (m % 5)
      if (h === 0 && m < 5) m = 5
      setDraftHoursPart(h)
      setDraftMinsPart(m)
    }
    if (key === 'report_time') {
      if (reportOff) {
        setDraftReportOff(true)
        setDraftHour12(9)
        setDraftMinute(0)
        setDraftPeriod('PM')
      } else {
        setDraftReportOff(false)
        const { hour12, period } = to12h(reportHour)
        setDraftHour12(hour12)
        setDraftMinute(reportMinute - (reportMinute % 5))
        setDraftPeriod(period)
      }
    }
    setActiveSheet(key)
  }

  function rowLabel(key: SelectKey): string {
    if (key === 'frequency') return formatMinutesLabel(frequencyMinutes).replace(/^Every /, '')
    if (key === 'focus_warning') return formatDurationLabel(focusWarningMin)
    if (key === 'nudge_gap') {
      if (nudgeGapMin < 60) return `${nudgeGapMin} minutes`
      const h = Math.floor(nudgeGapMin / 60)
      const m = nudgeGapMin % 60
      return m === 0 ? (h === 1 ? '1 hour' : `${h} hours`) : `${h}h ${m}m`
    }
    if (key === 'report_time') {
      if (reportOff) return 'Off'
      return formatClockLabel(reportHour, reportMinute)
    }
    if (key === 'start_mode') return startMode === 'login' ? 'At login' : 'Manually'
    return ''
  }

  async function confirmSheet() {
    if (!activeSheet) return
    setSaving(true)
    try {
      if (activeSheet === 'frequency') {
        await updateSettings({ session_frequency_minutes: draftMinutes })
      }
      if (activeSheet === 'focus_warning') {
        const total = draftFocusNever ? 0 : draftHoursPart * 60 + draftMinsPart
        setFocusWarningMin(total)
      }
      if (activeSheet === 'nudge_gap') {
        const total = Math.max(5, draftHoursPart * 60 + draftMinsPart)
        setNudgeGapMin(total)
      }
      if (activeSheet === 'report_time') {
        if (draftReportOff) {
          await updateSettings({ daily_report_hour: -1, daily_report_minute: 0 })
        } else {
          await updateSettings({
            daily_report_hour: to24h(draftHour12, draftPeriod),
            daily_report_minute: draftMinute,
          })
        }
      }
      if (activeSheet === 'start_mode') {
        // handled by list selection
      }
      setActiveSheet(null)
    } finally {
      setSaving(false)
    }
  }

  async function applyStartMode(value: 'login' | 'manual') {
    setStartModeBusy(true)
    setStartModeError(null)
    const enabled = value === 'login'
    try {
      await invoke<boolean>('set_launch_at_login', { enabled })
      await updateSettings({ launch_at_login: enabled })
      setActiveSheet(null)
    } catch (e) {
      setStartModeError(e instanceof Error ? e.message : String(e))
    } finally {
      setStartModeBusy(false)
    }
  }

  async function checkUpdates() {
    setCheckingUpdates('loading')
    window.setTimeout(() => setCheckingUpdates('updated'), 1200)
  }

  function handleReplayOnboarding() {
    setOnboardingFlash(true)
    replayOnboarding()
    window.setTimeout(() => setOnboardingFlash(false), 1600)
  }

  const durationTotal = draftHoursPart * 60 + draftMinsPart

  const sheetBody = (() => {
    if (!activeSheet) return null

    if (activeSheet === 'start_mode') {
      return (
        <div className="settings-sheet-list">
          {START_MODE_OPTIONS.map((option) => {
            const selected = option.value === startMode
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => void applyStartMode(option.value as 'login' | 'manual')}
                disabled={startModeBusy}
              >
                <span className={selected ? 'is-selected' : ''}>
                  <strong style={{ display: 'block' }}>{option.label}</strong>
                  <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 400 }}>{option.hint}</span>
                </span>
                {selected ? <Check size={14} /> : null}
              </button>
            )
          })}
        </div>
      )
    }

    if (activeSheet === 'frequency') {
      return (
        <div className="settings-wheel-body">
          <p className="settings-wheel-preview">{formatMinutesLabel(draftMinutes)}</p>
          <WheelPicker
            columns={[
              {
                items: frequencyItems,
                value: draftMinutes,
                onChange: (v) => setDraftMinutes(Number(v)),
                ariaLabel: 'Minutes',
                width: 88,
                unit: 'min',
              },
            ]}
          />
          <p className="settings-wheel-hint">Scroll to choose any interval from 5 to 120 minutes.</p>
        </div>
      )
    }

    if (activeSheet === 'focus_warning') {
      return (
        <div className="settings-wheel-body">
          <div className="settings-wheel-toggle-row">
            <button
              type="button"
              className={`settings-chip ${!draftFocusNever ? 'is-active' : ''}`}
              onClick={() => setDraftFocusNever(false)}
            >
              After duration
            </button>
            <button
              type="button"
              className={`settings-chip ${draftFocusNever ? 'is-active' : ''}`}
              onClick={() => setDraftFocusNever(true)}
            >
              Never
            </button>
          </div>
          <p className="settings-wheel-preview">
            {draftFocusNever ? 'Never' : formatDurationLabel(Math.max(5, durationTotal || 5))}
          </p>
          {!draftFocusNever && (
            <WheelPicker
              columns={[
                {
                  items: hourPartItems,
                  value: draftHoursPart,
                  onChange: (v) => setDraftHoursPart(Number(v)),
                  ariaLabel: 'Hours',
                  width: 64,
                  unit: 'hr',
                },
                {
                  items: minPartItems,
                  value: draftMinsPart,
                  onChange: (v) => setDraftMinsPart(Number(v)),
                  ariaLabel: 'Minutes',
                  width: 72,
                  unit: 'min',
                },
              ]}
            />
          )}
          <p className="settings-wheel-hint">Warn when a focus session runs longer than this.</p>
        </div>
      )
    }

    if (activeSheet === 'nudge_gap') {
      return (
        <div className="settings-wheel-body">
          <p className="settings-wheel-preview">
            {durationTotal < 60
              ? `${Math.max(5, durationTotal || 5)} minutes`
              : formatDurationLabel(Math.max(5, durationTotal)).replace(/^After /, '')}
          </p>
          <WheelPicker
            columns={[
              {
                items: hourPartItems,
                value: draftHoursPart,
                onChange: (v) => setDraftHoursPart(Number(v)),
                ariaLabel: 'Hours',
                width: 64,
                unit: 'hr',
              },
              {
                items: minPartItems.filter((i) => draftHoursPart > 0 || Number(i.value) >= 5),
                value: draftMinsPart,
                onChange: (v) => setDraftMinsPart(Number(v)),
                ariaLabel: 'Minutes',
                width: 72,
                unit: 'min',
              },
            ]}
          />
          <p className="settings-wheel-hint">Minimum quiet time between posture / stress nudges.</p>
        </div>
      )
    }

    // report_time
    return (
      <div className="settings-wheel-body">
        <div className="settings-wheel-toggle-row">
          <button
            type="button"
            className={`settings-chip ${!draftReportOff ? 'is-active' : ''}`}
            onClick={() => setDraftReportOff(false)}
          >
            Time of day
          </button>
          <button
            type="button"
            className={`settings-chip ${draftReportOff ? 'is-active' : ''}`}
            onClick={() => setDraftReportOff(true)}
          >
            Off
          </button>
        </div>
        <p className="settings-wheel-preview">
          {draftReportOff
            ? 'Off'
            : formatClockLabel(to24h(draftHour12, draftPeriod), draftMinute)}
        </p>
        {!draftReportOff && (
          <WheelPicker
            columns={[
              {
                items: hour12Items,
                value: draftHour12,
                onChange: (v) => setDraftHour12(Number(v)),
                ariaLabel: 'Hour',
                width: 56,
              },
              {
                items: minuteItems,
                value: draftMinute,
                onChange: (v) => setDraftMinute(Number(v)),
                ariaLabel: 'Minute',
                width: 64,
              },
              {
                items: periodItems,
                value: draftPeriod,
                onChange: (v) => setDraftPeriod(v as 'AM' | 'PM'),
                ariaLabel: 'AM or PM',
                width: 56,
              },
            ]}
          />
        )}
        <p className="settings-wheel-hint">When Zeno surfaces your daily summary notification.</p>
      </div>
    )
  })()

  const sheet =
    activeSheet == null
      ? null
      : createPortal(
          <AnimatePresence>
            <motion.div
              key="settings-sheet"
              className="settings-sheet-wrap"
              onClick={() => setActiveSheet(null)}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
            >
              <motion.div
                className="settings-sheet"
                onClick={(event) => event.stopPropagation()}
                initial={{ y: '100%' }}
                animate={{ y: 0 }}
                exit={{ y: '100%' }}
                transition={easeOut}
              >
                <div className="settings-sheet-handle" />
                <div className="settings-sheet-toolbar">
                  <button type="button" className="settings-sheet-tool" onClick={() => setActiveSheet(null)}>
                    Cancel
                  </button>
                  <p className="settings-sheet-title">{SHEET_LABELS[activeSheet]}</p>
                  {activeSheet === 'start_mode' ? (
                    <span className="settings-sheet-tool settings-sheet-tool--spacer" />
                  ) : (
                    <button
                      type="button"
                      className="settings-sheet-tool settings-sheet-tool--done"
                      disabled={saving}
                      onClick={() => void confirmSheet()}
                    >
                      {saving ? '…' : 'Done'}
                    </button>
                  )}
                </div>
                {sheetBody}
              </motion.div>
            </motion.div>
          </AnimatePresence>,
          document.body,
        )

  return (
    <section className="settings-page">
      <header className="settings-header">
        <h1>Settings</h1>
        <p>How Zeno works for you — everything stays on this device</p>
      </header>

      <section className="settings-section">
        <p className="settings-section-title">How Zeno watches you</p>
        <div className="settings-card">
          <div className="settings-row settings-row--toggle">
            <div>
              <strong>Passive monitoring</strong>
              <p>Check in every few minutes while you work</p>
            </div>
            <button
              type="button"
              className={`toggle ${passiveMonitoring ? 'is-active' : 'is-paused'}`}
              onClick={() => void updateSettings({ monitoring_paused: passiveMonitoring })}
              aria-label="Toggle passive monitoring"
            >
              <span className="knob" />
            </button>
          </div>

          <button
            type="button"
            className={`settings-row settings-row--select ${!passiveMonitoring ? 'is-disabled' : ''}`}
            disabled={!passiveMonitoring}
            onClick={() => openSheet('frequency')}
          >
            <div>
              <strong>Check-in frequency</strong>
              <p>How often passive check-ins run</p>
            </div>
            <span>
              {rowLabel('frequency')} <ChevronRight size={14} />
            </span>
          </button>

          <button type="button" className="settings-row settings-row--select" onClick={() => openSheet('focus_warning')}>
            <div>
              <strong>Focus session warning</strong>
              <p>Alert me when a session runs long</p>
            </div>
            <span>
              {rowLabel('focus_warning')} <ChevronRight size={14} />
            </span>
          </button>

          <button
            type="button"
            className="settings-row settings-row--select"
            onClick={() => openSheet('start_mode')}
            disabled={startModeBusy}
          >
            <div>
              <strong>Start Zeno</strong>
              <p>{startMode === 'login' ? 'Launches automatically when you log in' : 'Only starts when you open it'}</p>
            </div>
            <span>
              {startModeBusy ? <Loader2 size={14} className="spin" /> : null}
              {rowLabel('start_mode')} <ChevronRight size={14} />
            </span>
          </button>
          {startModeError ? <p className="settings-inline-error">{startModeError}</p> : null}
        </div>
      </section>

      <section className="settings-section">
        <p className="settings-section-title">When Zeno speaks up</p>
        <div className="settings-card">
          <button type="button" className="settings-row settings-row--select" onClick={() => openSheet('nudge_gap')}>
            <div>
              <strong>Minimum time between nudges</strong>
              <p>Avoid being interrupted too often</p>
            </div>
            <span>
              {rowLabel('nudge_gap')} <ChevronRight size={14} />
            </span>
          </button>

          <button type="button" className="settings-row settings-row--select" onClick={() => openSheet('report_time')}>
            <div>
              <strong>Daily report time</strong>
              <p>{reportOff ? 'Daily report notifications are off' : 'When to surface your daily summary'}</p>
            </div>
            <span>
              {rowLabel('report_time')} <ChevronRight size={14} />
            </span>
          </button>
        </div>
      </section>

      <section className="settings-section">
        <p className="settings-section-title">Your data</p>
        <div className="settings-card">
          <button type="button" className="settings-row settings-row--action" onClick={() => void onExportData()}>
            <div>
              <strong>Export my data</strong>
              <p>Download local history as CSV</p>
            </div>
            <span className="settings-action-cta">
              <Download size={14} /> Export
            </span>
          </button>
          {exportMessage ? <p className="settings-inline-note">{exportMessage}</p> : null}

          <div className="settings-row settings-row--info">
            <div>
              <strong>Local only</strong>
              <p>Sessions, posture, and settings never leave this machine</p>
            </div>
          </div>

          <button type="button" className="settings-row settings-row--danger" onClick={() => setClearExpanded((value) => !value)}>
            <div>
              <strong>Clear all data</strong>
              <p>Permanently delete your history and baseline</p>
            </div>
            <span>
              <Trash2 size={14} />
            </span>
          </button>

          <AnimatePresence initial={false}>
            {clearExpanded && (
              <motion.div
                className="settings-inline-block settings-inline-block--danger"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={easeOut}
              >
                <p>
                  This will delete all session history, posture data, and your personal baseline. This cannot be undone.
                </p>
                <div className="settings-inline-actions">
                  <button type="button" className="btn-ghost" onClick={() => setClearExpanded(false)}>
                    Cancel
                  </button>
                  <button type="button" className="btn-danger" onClick={() => void clearAllData()}>
                    Delete everything
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </section>

      <section className="settings-section">
        <p className="settings-section-title">About</p>
        <div className="settings-card">
          <div className="settings-row settings-row--info">
            <strong>Version</strong>
            <span>0.2.0</span>
          </div>

          <button type="button" className="settings-row settings-row--select" onClick={() => void checkUpdates()}>
            <div>
              <strong>Check for updates</strong>
            </div>
            <span>
              {checkingUpdates === 'loading' && (
                <>
                  <Loader2 size={14} className="spin" /> Checking...
                </>
              )}
              {checkingUpdates === 'updated' && (
                <>
                  <Check size={14} className="ok" /> Up to date
                </>
              )}
              {checkingUpdates === 'idle' && <ChevronRight size={14} />}
            </span>
          </button>

          <button type="button" className="settings-row settings-row--select" onClick={handleReplayOnboarding}>
            <div>
              <strong>Replay onboarding</strong>
              <p>Show the welcome tips again</p>
            </div>
            <span>{onboardingFlash ? <Check size={14} className="ok" /> : <ChevronRight size={14} />}</span>
          </button>

          <div className="settings-row settings-row--info">
            <strong>Built with</strong>
            <span className="settings-built-with">Tauri · Python · MediaPipe</span>
          </div>
        </div>
      </section>

      {!calibration?.calibrated && (
        <p className="settings-footer-note">
          Baseline in progress: {calibration?.sessions_remaining ?? 0} check-ins remaining.
        </p>
      )}
      <p className="settings-footer-note">Last run: {lastRunSource ?? 'none'}</p>
      {error && <p className="settings-footer-error">{error}</p>}

      {sheet}
    </section>
  )
}
