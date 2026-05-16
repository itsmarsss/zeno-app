import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, ChevronRight, Download, Loader2, Trash2 } from 'lucide-react'
import { invoke } from '@tauri-apps/api/core'
import type { AppSettings, CalibrationStatus } from '../../shared/types'
import './SettingsTab.css'
import { easeOut } from '../../shared/motion'

type SelectKey = 'frequency' | 'focus_warning' | 'nudge_gap' | 'report_time' | 'start_mode'

type Option = { label: string; value: string }

const SELECT_OPTIONS: Record<SelectKey, Option[]> = {
  frequency: [
    { label: 'Every 5 minutes', value: '5' },
    { label: 'Every 10 minutes', value: '10' },
    { label: 'Every 15 minutes', value: '15' },
    { label: 'Every 30 minutes', value: '30' },
  ],
  focus_warning: [
    { label: 'After 60 minutes', value: '60' },
    { label: 'After 90 minutes', value: '90' },
    { label: 'After 2 hours', value: '120' },
    { label: 'Never', value: 'never' },
  ],
  nudge_gap: [
    { label: '10 minutes', value: '10' },
    { label: '20 minutes', value: '20' },
    { label: '30 minutes', value: '30' },
    { label: '1 hour', value: '60' },
  ],
  report_time: [
    { label: '7:00 pm', value: '19:00' },
    { label: '8:00 pm', value: '20:00' },
    { label: '9:00 pm', value: '21:00' },
    { label: '10:00 pm', value: '22:00' },
    { label: 'Off', value: 'off' },
  ],
  start_mode: [
    { label: 'At login', value: 'login' },
    { label: 'Manually', value: 'manual' },
  ],
}

const SHEET_LABELS: Record<SelectKey, string> = {
  frequency: 'Check-in frequency',
  focus_warning: 'Focus session warning',
  nudge_gap: 'Minimum time between nudges',
  report_time: 'Daily report time',
  start_mode: 'Start Zeno',
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
  const [focusWarning, setFocusWarning] = useState('90')
  const [nudgeGap, setNudgeGap] = useState('20')
  const [clearExpanded, setClearExpanded] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState<'idle' | 'loading' | 'updated'>('idle')
  const [activeSheet, setActiveSheet] = useState<SelectKey | null>(null)
  const [startModeBusy, setStartModeBusy] = useState(false)
  const [startModeError, setStartModeError] = useState<string | null>(null)
  const [onboardingFlash, setOnboardingFlash] = useState(false)

  const passiveMonitoring = !(settings?.monitoring_paused ?? false)
  const frequencyValue = String(settings?.session_frequency_minutes ?? 10)
  const startMode = settings?.launch_at_login === false ? 'manual' : 'login'
  const reportValue = useMemo(() => {
    const hour = settings?.daily_report_hour ?? 21
    if (hour < 0) return 'off'
    const minute = settings?.daily_report_minute ?? 0
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`
  }, [settings?.daily_report_hour, settings?.daily_report_minute])

  const selectValues: Record<SelectKey, string> = {
    frequency: frequencyValue,
    focus_warning: focusWarning,
    nudge_gap: nudgeGap,
    report_time: reportValue,
    start_mode: startMode,
  }

  function selectLabel(key: SelectKey): string {
    const options = SELECT_OPTIONS[key]
    return options.find((option) => option.value === selectValues[key])?.label ?? options[0]?.label ?? ''
  }

  async function applySelect(key: SelectKey, value: string) {
    if (key === 'frequency') {
      await updateSettings({ session_frequency_minutes: Number(value) })
    }

    if (key === 'report_time') {
      if (value === 'off') {
        await updateSettings({ daily_report_hour: -1, daily_report_minute: 0 })
      } else {
        const [hour, minute] = value.split(':').map(Number)
        await updateSettings({ daily_report_hour: hour, daily_report_minute: minute })
      }
    }

    if (key === 'focus_warning') setFocusWarning(value)
    if (key === 'nudge_gap') setNudgeGap(value)

    if (key === 'start_mode') {
      setStartModeBusy(true)
      setStartModeError(null)
      const enabled = value === 'login'
      try {
        await invoke<boolean>('set_launch_at_login', { enabled })
        await updateSettings({ launch_at_login: enabled })
      } catch (e) {
        setStartModeError(e instanceof Error ? e.message : String(e))
      } finally {
        setStartModeBusy(false)
      }
    }

    setActiveSheet(null)
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
                <p className="settings-sheet-title">{SHEET_LABELS[activeSheet]}</p>
                <div className="settings-sheet-list">
                  {SELECT_OPTIONS[activeSheet].map((option) => {
                    const selected = option.value === selectValues[activeSheet]
                    return (
                      <button key={option.value} type="button" onClick={() => void applySelect(activeSheet, option.value)}>
                        <span className={selected ? 'is-selected' : ''}>{option.label}</span>
                        {selected ? <Check size={14} /> : null}
                      </button>
                    )
                  })}
                </div>
                <button type="button" className="settings-sheet-cancel" onClick={() => setActiveSheet(null)}>
                  Cancel
                </button>
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
            onClick={() => setActiveSheet('frequency')}
          >
            <div>
              <strong>Check-in frequency</strong>
              <p>How often passive check-ins run</p>
            </div>
            <span>
              {selectLabel('frequency')} <ChevronRight size={14} />
            </span>
          </button>

          <button type="button" className="settings-row settings-row--select" onClick={() => setActiveSheet('focus_warning')}>
            <div>
              <strong>Focus session warning</strong>
              <p>Alert me when a session runs long</p>
            </div>
            <span>
              {selectLabel('focus_warning')} <ChevronRight size={14} />
            </span>
          </button>

          <button
            type="button"
            className="settings-row settings-row--select"
            onClick={() => setActiveSheet('start_mode')}
            disabled={startModeBusy}
          >
            <div>
              <strong>Start Zeno</strong>
              <p>{startMode === 'login' ? 'Launches automatically when you log in' : 'Only starts when you open it'}</p>
            </div>
            <span>
              {startModeBusy ? <Loader2 size={14} className="spin" /> : null}
              {selectLabel('start_mode')} <ChevronRight size={14} />
            </span>
          </button>
          {startModeError ? <p className="settings-inline-error">{startModeError}</p> : null}
        </div>
      </section>

      <section className="settings-section">
        <p className="settings-section-title">When Zeno speaks up</p>
        <div className="settings-card">
          <button type="button" className="settings-row settings-row--select" onClick={() => setActiveSheet('nudge_gap')}>
            <div>
              <strong>Minimum time between nudges</strong>
              <p>Avoid being interrupted too often</p>
            </div>
            <span>
              {selectLabel('nudge_gap')} <ChevronRight size={14} />
            </span>
          </button>

          <button type="button" className="settings-row settings-row--select" onClick={() => setActiveSheet('report_time')}>
            <div>
              <strong>Daily report time</strong>
              <p>{reportValue === 'off' ? 'Daily report notifications are off' : 'When to surface your daily summary'}</p>
            </div>
            <span>
              {selectLabel('report_time')} <ChevronRight size={14} />
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
            <span>
              {onboardingFlash ? <Check size={14} className="ok" /> : <ChevronRight size={14} />}
            </span>
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
