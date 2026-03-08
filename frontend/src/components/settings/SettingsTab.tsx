import type { AppSettings, CalibrationStatus } from '../../shared/types'
import './SettingsTab.css'

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
}) {
  return (
    <>
      <h1>Settings</h1>
      <section className="prefs-panel main-settings">
        <div className="prefs-row"><label>Plan</label><strong>{isPro ? 'Pro' : 'Free'}</strong></div>
        <div className="prefs-row">
          <label>License key</label>
          <input
            type="text"
            value={licenseInput}
            placeholder={settings?.license_key ? `Current: ${settings.license_key.slice(0, 8)}...` : 'Enter Lemon Squeezy key'}
            onChange={(e) => setLicenseInput(e.target.value)}
          />
        </div>
        <div className="prefs-actions">
          <button className="btn-solid" onClick={() => void updateSettings({ license_key: licenseInput.trim(), plan_tier: licenseInput.trim().length > 10 ? 'pro' : 'free' })}>Activate</button>
          <button className="btn-ghost" onClick={() => void updateSettings({ license_key: '', plan_tier: 'free' })}>Remove key</button>
        </div>
        {!calibration?.calibrated && <p className="prefs-note">Baseline in progress: {calibration?.sessions_remaining ?? 0} check-ins remaining.</p>}
        <div className="prefs-row">
          <label>Session frequency</label>
          <select value={settings?.session_frequency_minutes ?? 10} onChange={(e) => void updateSettings({ session_frequency_minutes: Number(e.target.value) })}>
            <option value={5}>5 min</option>
            <option value={10}>10 min</option>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
          </select>
        </div>
        <div className="prefs-row">
          <label>Report time</label>
          <input
            type="time"
            value={`${String(settings?.daily_report_hour ?? 21).padStart(2, '0')}:${String(settings?.daily_report_minute ?? 0).padStart(2, '0')}`}
            onChange={(e) => {
              const [hour, minute] = e.target.value.split(':').map(Number)
              void updateSettings({ daily_report_hour: hour, daily_report_minute: minute })
            }}
          />
        </div>
        <div className="prefs-row">
          <label>Pause monitoring</label>
          <button className={`toggle ${settings?.monitoring_paused ? 'is-paused' : 'is-active'}`} onClick={() => void updateSettings({ monitoring_paused: !settings?.monitoring_paused })} aria-label="Toggle monitoring">
            <span className="knob" />
          </button>
        </div>
        <div className="prefs-actions">
          <button className="btn-ghost" onClick={replayOnboarding}>Replay onboarding</button>
          <button className="btn-danger" onClick={() => void clearAllData()}>Clear data</button>
        </div>
        <p className="prefs-meta">Last run: {lastRunSource ?? 'none'}</p>
        {error && <p className="prefs-error">{error}</p>}
      </section>
    </>
  )
}
