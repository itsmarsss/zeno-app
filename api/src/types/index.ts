export interface User {
  id: string
  email: string
  subscriptionTier: 'free' | 'paid'
  createdAt: number
  updatedAt: number
}

export interface OTPCode {
  email: string
  code: string
  attempts: number
  expiresAt: number
  createdAt: number
}

export interface RateLimitRecord {
  userId: string
  windowStart: number
  count: number
  ttl: number
}

export interface AnalysisRequest {
  id: string
  userId: string
  sessionCount: number
  tokensUsed: number
  cached: boolean
  insights: string
  createdAt: number
}

export interface SessionData {
  startTime: string
  endTime: string
  durationMinutes: number
  avgStress: number
  avgHeartRate: number | null
  avgRespiratoryRate: number | null
  avgPostureScore: number
  quality: number
}
