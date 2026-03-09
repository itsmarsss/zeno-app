import { randomInt } from 'crypto'

const OTP_LENGTH = 6
const OTP_EXPIRY_MS = 10 * 60 * 1000 // 10 minutes
const MAX_ATTEMPTS = 5

export function generateOTP(): string {
  const min = Math.pow(10, OTP_LENGTH - 1)
  const max = Math.pow(10, OTP_LENGTH) - 1
  return randomInt(min, max).toString()
}

export function getOTPExpiry(): number {
  return Date.now() + OTP_EXPIRY_MS
}

export function isOTPExpired(expiresAt: number): boolean {
  return Date.now() > expiresAt
}

export function hasExceededAttempts(attempts: number): boolean {
  return attempts >= MAX_ATTEMPTS
}
