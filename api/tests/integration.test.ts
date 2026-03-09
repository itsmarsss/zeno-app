import { describe, it, expect, beforeAll } from '@jest/globals'

const API_BASE_URL = process.env.API_URL || 'http://localhost:3000'

interface AuthResponse {
  token: string
  user: {
    id: string
    email: string
    subscriptionTier: string
  }
}

describe('Authentication API', () => {
  let authToken: string
  let userId: string
  const testEmail = `test-${Date.now()}@example.com`
  const testPassword = 'testpass123'

  describe('POST /auth/register', () => {
    it('should create a new user account', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
        }),
      })

      expect(response.status).toBe(201)
      const data: AuthResponse = await response.json()
      expect(data.token).toBeDefined()
      expect(data.user.email).toBe(testEmail)
      expect(data.user.subscriptionTier).toBe('free')

      authToken = data.token
      userId = data.user.id
    })

    it('should reject duplicate email', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
        }),
      })

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Email already registered')
    })

    it('should validate email format', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'invalid-email',
          password: testPassword,
        }),
      })

      expect(response.status).toBe(400)
    })

    it('should validate password length', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: `test-${Date.now()}@example.com`,
          password: 'short',
        }),
      })

      expect(response.status).toBe(400)
    })
  })

  describe('POST /auth/login', () => {
    it('should login with valid credentials', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword,
        }),
      })

      expect(response.status).toBe(200)
      const data: AuthResponse = await response.json()
      expect(data.token).toBeDefined()
      expect(data.user.email).toBe(testEmail)
    })

    it('should reject invalid credentials', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: testEmail,
          password: 'wrongpassword',
        }),
      })

      expect(response.status).toBe(401)
    })

    it('should reject non-existent user', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: 'nonexistent@example.com',
          password: testPassword,
        }),
      })

      expect(response.status).toBe(401)
    })
  })

  describe('GET /auth/me', () => {
    it('should return current user with valid token', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.user.id).toBe(userId)
      expect(data.user.email).toBe(testEmail)
    })

    it('should reject request without token', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/me`)

      expect(response.status).toBe(401)
    })

    it('should reject invalid token', async () => {
      const response = await fetch(`${API_BASE_URL}/auth/me`, {
        headers: {
          Authorization: 'Bearer invalid-token',
        },
      })

      expect(response.status).toBe(403)
    })
  })
})

describe('Analysis API', () => {
  let authToken: string
  const testEmail = `test-analysis-${Date.now()}@example.com`
  const testPassword = 'testpass123'

  beforeAll(async () => {
    // Create test user
    const response = await fetch(`${API_BASE_URL}/auth/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    })
    const data: AuthResponse = await response.json()
    authToken = data.token
  })

  describe('POST /analysis/analyze', () => {
    it('should analyze sessions and return insights', async () => {
      const sessions = [
        {
          startTime: '2024-03-09T10:00:00Z',
          endTime: '2024-03-09T11:30:00Z',
          durationMinutes: 90,
          avgStress: 45,
          avgHeartRate: 72,
          avgRespiratoryRate: 16,
          avgPostureScore: 85,
          quality: 78,
        },
        {
          startTime: '2024-03-09T14:00:00Z',
          endTime: '2024-03-09T15:00:00Z',
          durationMinutes: 60,
          avgStress: 52,
          avgHeartRate: 75,
          avgRespiratoryRate: 18,
          avgPostureScore: 75,
          quality: 65,
        },
      ]

      const response = await fetch(`${API_BASE_URL}/analysis/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({ sessions }),
      })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.insights).toBeDefined()
      expect(typeof data.insights).toBe('string')
      expect(data.insights.length).toBeGreaterThan(50)
      expect(data.cached).toBeDefined()
    }, 30000) // 30s timeout for LLM call

    it('should require authentication', async () => {
      const response = await fetch(`${API_BASE_URL}/analysis/analyze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sessions: [
            {
              startTime: '2024-03-09T10:00:00Z',
              endTime: '2024-03-09T11:00:00Z',
              durationMinutes: 60,
              avgStress: 45,
              avgHeartRate: 72,
              avgRespiratoryRate: 16,
              avgPostureScore: 85,
              quality: 78,
            },
          ],
        }),
      })

      expect(response.status).toBe(401)
    })

    it('should validate session data', async () => {
      const response = await fetch(`${API_BASE_URL}/analysis/analyze`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          sessions: [{ invalid: 'data' }],
        }),
      })

      expect(response.status).toBe(400)
    })

    it('should enforce rate limits', async () => {
      // Make requests until rate limited
      let rateLimited = false
      for (let i = 0; i < 15; i++) {
        const response = await fetch(`${API_BASE_URL}/analysis/analyze`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${authToken}`,
          },
          body: JSON.stringify({
            sessions: [
              {
                startTime: '2024-03-09T10:00:00Z',
                endTime: '2024-03-09T11:00:00Z',
                durationMinutes: 60,
                avgStress: 45,
                avgHeartRate: 72,
                avgRespiratoryRate: 16,
                avgPostureScore: 85,
                quality: 78,
              },
            ],
          }),
        })

        if (response.status === 429) {
          rateLimited = true
          const data = await response.json()
          expect(data.error).toBe('Rate limit exceeded')
          expect(data.details.resetIn).toBeDefined()
          break
        }

        await new Promise((resolve) => setTimeout(resolve, 100))
      }

      expect(rateLimited).toBe(true)
    }, 60000) // 60s timeout
  })
})
