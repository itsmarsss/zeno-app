const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000'

interface ApiError {
  error: string
  details?: any
}

class ApiClient {
  private token: string | null = null

  constructor() {
    this.token = localStorage.getItem('auth_token')
  }

  setToken(token: string | null) {
    this.token = token
    if (token) {
      localStorage.setItem('auth_token', token)
    } else {
      localStorage.removeItem('auth_token')
    }
  }

  getToken(): string | null {
    return this.token
  }

  private async request<T>(
    endpoint: string,
    options: RequestInit = {}
  ): Promise<T> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...options.headers,
    }

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, {
      ...options,
      headers,
    })

    if (!response.ok) {
      const error: ApiError = await response.json()
      throw new Error(error.error || 'Request failed')
    }

    return response.json()
  }

  async register(email: string, password: string) {
    return this.request<{
      token: string
      user: { id: string; email: string; subscriptionTier: string }
    }>('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  }

  async login(email: string, password: string) {
    return this.request<{
      token: string
      user: { id: string; email: string; subscriptionTier: string }
    }>('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  }

  async getMe() {
    return this.request<{
      user: {
        id: string
        email: string
        subscriptionTier: string
        createdAt: number
      }
    }>('/auth/me')
  }

  async analyzeSessions(data: {
    sessions: Array<{
      startTime: string
      endTime: string
      durationMinutes: number
      avgStress: number
      avgHeartRate: number | null
      avgRespiratoryRate: number | null
      avgPostureScore: number
      quality: number
    }>
    personalizedZones?: {
      optimalStress: { min: number; max: number }
      optimalHeartRate: { min: number; max: number }
      optimalDuration: { min: number; max: number }
    }
  }) {
    return this.request<{
      insights: string
      cached: boolean
      tokensUsed?: number
    }>('/analysis/analyze', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }
}

export const apiClient = new ApiClient()
