import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { useAuth } from '../../context/AuthContext'
import './AuthScreen.css'

export function AuthScreen() {
  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [referralCode, setReferralCode] = useState('')
  const [showReferralInput, setShowReferralInput] = useState(false)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [expiresIn, setExpiresIn] = useState(0)
  const { requestOTP, verifyOTP, continueAsGuest } = useAuth()

  const handleRequestOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      const response = await requestOTP(email)
      setExpiresIn(10 * 60) // 10 minutes
      setStep('code')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to send code')
    } finally {
      setLoading(false)
    }
  }

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      await verifyOTP(email, code, referralCode || undefined)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid code')
    } finally {
      setLoading(false)
    }
  }

  const handleResendCode = async () => {
    setError('')
    setLoading(true)
    try {
      await requestOTP(email)
      setExpiresIn(10 * 60)
      setCode('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to resend code')
    } finally {
      setLoading(false)
    }
  }

  const handleHeaderMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    if (target.closest('button, a, input, select, textarea')) return
    void getCurrentWindow().startDragging()
  }

  return (
    <div className="auth-screen">
      <motion.div
        className="auth-screen-header"
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
        onMouseDown={handleHeaderMouseDown}
      >
        <motion.div
          className="auth-status-dot"
          animate={{
            scale: [1, 1.1, 1],
            opacity: [0.8, 1, 0.8]
          }}
          transition={{
            duration: 2,
            repeat: Infinity,
            ease: "easeInOut"
          }}
        />
        <span>zeno</span>
      </motion.div>

      <motion.div
        className="auth-container"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1], delay: 0.1 }}
      >
        <header className="auth-brand">
          <h1>zeno</h1>
          <p>Study session tracking and insights</p>
        </header>

        <AnimatePresence mode="wait">
          {step === 'email' ? (
            <motion.div
              key="email-step"
              initial={{ opacity: 0, x: -20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: 20 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="auth-step-indicator">
                <span className="auth-step-label">Step 1 of 2</span>
              </div>

              <form className="auth-form" onSubmit={handleRequestOTP}>
                <div className="form-field">
                  <label htmlFor="email">Email address</label>
                  <input
                    id="email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="your@email.com"
                    required
                    autoComplete="email"
                    disabled={loading}
                    autoFocus
                  />
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      className="auth-error"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <span>{error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                <button type="submit" className="auth-submit" disabled={loading}>
                  {loading ? 'Sending code...' : 'Send verification code'}
                </button>

                <button
                  type="button"
                  className="auth-guest"
                  onClick={continueAsGuest}
                  disabled={loading}
                >
                  Continue as guest
                </button>
              </form>
            </motion.div>
          ) : (
            <motion.div
              key="code-step"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="auth-step-indicator">
                <button
                  type="button"
                  className="auth-back-btn"
                  onClick={() => {
                    setStep('email')
                    setCode('')
                    setError('')
                  }}
                  disabled={loading}
                >
                  ← Back
                </button>
                <span className="auth-step-label">Step 2 of 2</span>
              </div>

              <div className="auth-code-sent">
                <p>Code sent to</p>
                <strong>{email}</strong>
              </div>

              <form className="auth-form" onSubmit={handleVerifyOTP}>
                <div className="form-field">
                  <label htmlFor="code">Verification code</label>
                  <input
                    id="code"
                    type="text"
                    inputMode="numeric"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                    placeholder="000000"
                    required
                    disabled={loading}
                    autoFocus
                    className="auth-code-input"
                  />
                  <span className="auth-code-hint">6-digit code from your email</span>
                </div>

                <AnimatePresence>
                  {error && (
                    <motion.div
                      className="auth-error"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <span>{error}</span>
                    </motion.div>
                  )}
                </AnimatePresence>

                {!showReferralInput && (
                  <button
                    type="button"
                    className="auth-referral-toggle"
                    onClick={() => setShowReferralInput(true)}
                  >
                    Have a referral code?
                  </button>
                )}

                <AnimatePresence>
                  {showReferralInput && (
                    <motion.div
                      className="form-field"
                      initial={{ opacity: 0, height: 0 }}
                      animate={{ opacity: 1, height: 'auto' }}
                      exit={{ opacity: 0, height: 0 }}
                      transition={{ duration: 0.2 }}
                    >
                      <label htmlFor="referral">Referral code (optional)</label>
                      <input
                        id="referral"
                        type="text"
                        value={referralCode}
                        onChange={(e) => setReferralCode(e.target.value.toUpperCase())}
                        placeholder="ZENO-XXXX"
                        disabled={loading}
                        className="auth-referral-input"
                      />
                    </motion.div>
                  )}
                </AnimatePresence>

                <button type="submit" className="auth-submit" disabled={loading || code.length !== 6}>
                  {loading ? 'Verifying...' : 'Verify and continue'}
                </button>

                <button
                  type="button"
                  className="auth-resend"
                  onClick={handleResendCode}
                  disabled={loading}
                >
                  Didn't receive the code? Resend
                </button>
              </form>
            </motion.div>
          )}
        </AnimatePresence>

        <motion.footer
          className="auth-footer"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.3 }}
        >
          {step === 'email' && <p className="auth-guest-note">Guest mode: no AI insights or cloud sync</p>}
          <p>Your health data stays local. Only anonymized session summaries are sent for AI analysis.</p>
        </motion.footer>
      </motion.div>
    </div>
  )
}
