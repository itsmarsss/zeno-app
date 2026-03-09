import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Check, CheckCircle2, ChevronRight, Download, ExternalLink, Loader2, LogOut, Trash2, User } from 'lucide-react'
import type { AppSettings, CalibrationStatus } from '../../shared/types'
import { useAuth } from '../../context/AuthContext'
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
  isPro,
  licenseInput,
  setLicenseInput,
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
  isPro: boolean
  licenseInput: string
  setLicenseInput: (value: string) => void
  calibration: CalibrationStatus | null
  replayOnboarding: () => void
  clearAllData: () => Promise<void>
  lastRunSource: string | null
  error: string | null
  onExportData: () => Promise<void>
  exportMessage: string | null
}) {
  const [cameraIndicator, setCameraIndicator] = useState(true)
  const [postureNudges, setPostureNudges] = useState(true)
  const [stressNudges, setStressNudges] = useState(true)
  const [breakReminders, setBreakReminders] = useState(true)
  const [focusWarning, setFocusWarning] = useState('90')
  const [nudgeGap, setNudgeGap] = useState('20')
  const [startMode, setStartMode] = useState('login')
  const [licenseExpanded, setLicenseExpanded] = useState(false)
  const [clearExpanded, setClearExpanded] = useState(false)
  const [checkingUpdates, setCheckingUpdates] = useState<'idle' | 'loading' | 'updated'>('idle')
  const [activeSheet, setActiveSheet] = useState<SelectKey | null>(null)
  const [licenseError, setLicenseError] = useState<string | null>(null)
  const [deleteAccountExpanded, setDeleteAccountExpanded] = useState(false)
  const { user, isGuest, logout } = useAuth()

  const passiveMonitoring = !(settings?.monitoring_paused ?? false)
  const frequencyValue = String(settings?.session_frequency_minutes ?? 10)
  const reportValue = useMemo(() => {
    const hour = settings?.daily_report_hour ?? 21
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
    if (key === 'start_mode') setStartMode(value)

    setActiveSheet(null)
  }

  async function activateLicense() {
    const trimmed = licenseInput.trim()
    if (trimmed.length < 8) {
      setLicenseError('Key not recognized. Check your email.')
      return
    }
    setLicenseError(null)
    await updateSettings({ license_key: trimmed, plan_tier: trimmed.length > 10 ? 'pro' : 'free' })
    window.setTimeout(() => setLicenseExpanded(false), 2000)
  }

  async function checkUpdates() {
    setCheckingUpdates('loading')
    window.setTimeout(() => setCheckingUpdates('updated'), 1200)
  }

  return (
    <section className="settings-page">
      <header className="settings-header">
        <h1>Settings</h1>
        <p>How Zeno works for you</p>
      </header>

      {!isGuest && (
        <section className="settings-section">
          <p className="settings-section-title">Account</p>
          <div className="settings-card">
            <div className="settings-row settings-row--info">
              <div className="settings-account-info">
                <User size={16} className="settings-account-icon" />
                <div>
                  <strong>{user?.email || 'Not signed in'}</strong>
                  <p>
                    {user?.subscriptionTier === 'paid' ? 'Paid subscription' : 'Free tier'}
                  </p>
                </div>
              </div>
            </div>

            {user?.subscriptionTier === 'free' && (
              <button className="settings-row settings-row--select">
                <div>
                  <strong>Upgrade to paid</strong>
                  <p>Unlock higher rate limits and priority support</p>
                </div>
                <span>
                  <ExternalLink size={12} /> <ChevronRight size={14} />
                </span>
              </button>
            )}

            <button className="settings-row settings-row--action" onClick={logout}>
              <div>
                <strong>Sign out</strong>
                <p>You'll lose access to AI insights</p>
              </div>
              <span className="settings-action-cta">
                <LogOut size={14} /> Sign out
              </span>
            </button>

            <button
              className="settings-row settings-row--danger"
              onClick={() => setDeleteAccountExpanded((value) => !value)}
            >
              <div>
                <strong>Delete account</strong>
                <p>Permanently delete your account and all data</p>
              </div>
              <span>
                <Trash2 size={14} />
              </span>
            </button>

            <AnimatePresence initial={false}>
              {deleteAccountExpanded && (
                <motion.div
                  className="settings-inline-block settings-inline-block--danger"
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={easeOut}
                >
                  <p>
                    This will permanently delete your account, all analysis history, and cached insights. Your local session
                    data will remain on this device. This cannot be undone.
                  </p>
                  <div className="settings-inline-actions">
                    <button className="btn-ghost" onClick={() => setDeleteAccountExpanded(false)}>
                      Cancel
                    </button>
                    <button
                      className="btn-danger"
                      onClick={() => {
                        // TODO: Implement account deletion API call
                        setDeleteAccountExpanded(false)
                        logout()
                      }}
                    >
                      Delete account
                    </button>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </section>
      )}

      {isGuest && (
        <section className="settings-section">
          <p className="settings-section-title">Account</p>
          <div className="settings-card">
            <div className="settings-row settings-row--info">
              <div>
                <strong>Guest mode</strong>
                <p>Create an account to unlock AI insights</p>
              </div>
            </div>

            <button className="settings-row settings-row--action" onClick={logout}>
              <div>
                <strong>Create account</strong>
                <p>Get personalized study coaching</p>
              </div>
              <span className="settings-action-cta">
                <User size={14} /> Sign up
              </span>
            </button>
          </div>
        </section>
      )}

      <section className="settings-section">
        <p className="settings-section-title">How Zeno watches you</p>
        <div className="settings-card">
          <div className="settings-row settings-row--toggle">
            <div>
              <strong>Passive monitoring</strong>
              <p>Check in every few minutes while you work</p>
            </div>
            <button
              className={`toggle ${passiveMonitoring ? 'is-active' : 'is-paused'}`}
              onClick={() => void updateSettings({ monitoring_paused: passiveMonitoring })}
              aria-label="Toggle passive monitoring"
            >
              <span className="knob" />
            </button>
          </div>

          <button
            className={`settings-row settings-row--select ${!passiveMonitoring ? 'is-disabled' : ''}`}
            disabled={!passiveMonitoring}
            onClick={() => setActiveSheet('frequency')}
          >
            <div>
              <strong>Check-in frequency</strong>
            </div>
            <span>
              {selectLabel('frequency')} <ChevronRight size={14} />
            </span>
          </button>

          <button className="settings-row settings-row--select" onClick={() => setActiveSheet('focus_warning')}>
            <div>
              <strong>Focus session warning</strong>
              <p>Alert me when a session runs long</p>
            </div>
            <span>
              {selectLabel('focus_warning')} <ChevronRight size={14} />
            </span>
          </button>

          <div className="settings-row settings-row--toggle">
            <div>
              <strong>Show camera indicator</strong>
              <p>Green dot in menubar when camera is active</p>
            </div>
            <button
              className={`toggle ${cameraIndicator ? 'is-active' : 'is-paused'}`}
              onClick={() => setCameraIndicator((value) => !value)}
              aria-label="Toggle camera indicator"
            >
              <span className="knob" />
            </button>
          </div>

          <button className="settings-row settings-row--select" onClick={() => setActiveSheet('start_mode')}>
            <div>
              <strong>Start Zeno</strong>
            </div>
            <span>
              {selectLabel('start_mode')} <ChevronRight size={14} />
            </span>
          </button>
        </div>
      </section>

      <section className="settings-section">
        <p className="settings-section-title">When Zeno speaks up</p>
        <div className="settings-card">
          <div className="settings-row settings-row--toggle">
            <div>
              <strong>Posture nudges</strong>
              <p>Tell me when I'm slouching</p>
            </div>
            <button
              className={`toggle ${postureNudges ? 'is-active' : 'is-paused'}`}
              onClick={() => setPostureNudges((value) => !value)}
              aria-label="Toggle posture nudges"
            >
              <span className="knob" />
            </button>
          </div>

          <div className="settings-row settings-row--toggle">
            <div>
              <strong>Stress nudges</strong>
              <p>Suggest breaks when stress is elevated</p>
            </div>
            <button
              className={`toggle ${stressNudges ? 'is-active' : 'is-paused'}`}
              onClick={() => setStressNudges((value) => !value)}
              aria-label="Toggle stress nudges"
            >
              <span className="knob" />
            </button>
          </div>

          <div className="settings-row settings-row--toggle">
            <div>
              <strong>Break reminders</strong>
              <p>Remind me to step away after long sessions</p>
            </div>
            <button
              className={`toggle ${breakReminders ? 'is-active' : 'is-paused'}`}
              onClick={() => setBreakReminders((value) => !value)}
              aria-label="Toggle break reminders"
            >
              <span className="knob" />
            </button>
          </div>

          <button className="settings-row settings-row--select" onClick={() => setActiveSheet('nudge_gap')}>
            <div>
              <strong>Minimum time between nudges</strong>
              <p>Avoid being interrupted too often</p>
            </div>
            <span>
              {selectLabel('nudge_gap')} <ChevronRight size={14} />
            </span>
          </button>

          <button className="settings-row settings-row--select" onClick={() => setActiveSheet('report_time')}>
            <div>
              <strong>Daily report time</strong>
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
          <button className="settings-row settings-row--action" onClick={() => void onExportData()}>
            <div>
              <strong>Export my data</strong>
              <p>Download everything as CSV</p>
            </div>
            <span className="settings-action-cta">
              <Download size={14} /> Export
            </span>
          </button>
          {exportMessage ? <p className="settings-inline-note">{exportMessage}</p> : null}

          <button className="settings-row settings-row--select" onClick={() => setLicenseExpanded((value) => !value)}>
            <div>
              <strong>License key</strong>
              <p>Enter your Zeno Pro key</p>
            </div>
            <span className={isPro ? 'settings-license-ok' : ''}>
              {isPro ? 'Pro · Active' : 'Not activated'}{' '}
              {isPro ? <CheckCircle2 size={14} /> : <ChevronRight size={14} />}
            </span>
          </button>

          <AnimatePresence initial={false}>
            {licenseExpanded && (
              <motion.div
                className="settings-inline-block"
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={easeOut}
              >
                <label>Enter your license key</label>
                {!isPro ? (
                  <>
                    <input
                      value={licenseInput}
                      onChange={(event) => setLicenseInput(event.target.value)}
                      placeholder="ZENO-XXXX-XXXX-XXXX"
                    />
                    {licenseError ? <p className="settings-inline-error">{licenseError}</p> : null}
                    <button
                      className="btn-solid"
                      disabled={licenseInput.trim().length === 0}
                      onClick={() => void activateLicense()}
                    >
                      Activate
                    </button>
                  </>
                ) : (
                  <p className="settings-license-success">
                    <CheckCircle2 size={16} /> Zeno Pro activated
                  </p>
                )}
              </motion.div>
            )}
          </AnimatePresence>

          <button className="settings-row settings-row--danger" onClick={() => setClearExpanded((value) => !value)}>
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
                  <button className="btn-ghost" onClick={() => setClearExpanded(false)}>
                    Cancel
                  </button>
                  <button className="btn-danger" onClick={() => void clearAllData()}>
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

          <button className="settings-row settings-row--select" onClick={() => void checkUpdates()}>
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
              {checkingUpdates === 'idle' && (
                <>
                  <ChevronRight size={14} />
                </>
              )}
            </span>
          </button>

          <button className="settings-row settings-row--select">
            <div>
              <strong>Privacy policy</strong>
            </div>
            <span>
              <ExternalLink size={12} /> <ChevronRight size={14} />
            </span>
          </button>

          <button className="settings-row settings-row--select" onClick={replayOnboarding}>
            <div>
              <strong>Replay onboarding</strong>
            </div>
            <span>
              <ChevronRight size={14} />
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

      <AnimatePresence>
        {activeSheet && (
          <motion.div
            className="settings-sheet-wrap"
            onClick={() => setActiveSheet(null)}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
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
                    <button key={option.value} onClick={() => void applySelect(activeSheet, option.value)}>
                      <span className={selected ? 'is-selected' : ''}>{option.label}</span>
                      {selected ? <Check size={14} /> : null}
                    </button>
                  )
                })}
              </div>
              <button className="settings-sheet-cancel" onClick={() => setActiveSheet(null)}>
                Cancel
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  )
}
