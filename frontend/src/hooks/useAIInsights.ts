import { useState, useEffect } from 'react'
import { apiClient } from '../api/client'
import { useAuth } from '../context/AuthContext'
import type { SessionHistoryItem } from '../shared/types'

interface SessionData {
  startTime: string
  endTime: string
  durationMinutes: number
  avgStress: number
  avgHeartRate: number | null
  avgRespiratoryRate: number | null
  avgPostureScore: number
  quality: number
}

interface PersonalizedZones {
  optimalStress: { min: number; max: number }
  optimalHeartRate: { min: number; max: number }
  optimalDuration: { min: number; max: number }
}

export function useAIInsights(
  sessions: SessionHistoryItem[],
  personalizedZones?: {
    optimalStressMin: number
    optimalStressMax: number
    optimalDurationMin: number
    optimalDurationMax: number
  }
) {
  const [insights, setInsights] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [cached, setCached] = useState(false)
  const { isAuthenticated } = useAuth()

  useEffect(() => {
    if (!isAuthenticated || sessions.length === 0) {
      setInsights(null)
      return
    }

    let cancelled = false

    async function fetchInsights() {
      setLoading(true)
      setError(null)

      try {
        // Convert session history to API format
        const sessionData: SessionData[] = sessions
          .filter((s) => s.session_type === 'focus' && s.duration_seconds > 60)
          .slice(0, 30) // Last 30 sessions
          .map((s) => ({
            startTime: s.created_at,
            endTime: new Date(
              new Date(s.created_at).getTime() + s.duration_seconds * 1000
            ).toISOString(),
            durationMinutes: Math.round(s.duration_seconds / 60),
            avgStress: s.emotion_score || 0,
            avgHeartRate: s.heart_rate_bpm,
            avgRespiratoryRate: s.respiratory_rate > 0 ? s.respiratory_rate : null,
            avgPostureScore: Math.round(s.posture_score * 100),
            quality: 0, // Will be calculated by backend if needed
          }))

        if (sessionData.length === 0) {
          setInsights(null)
          setLoading(false)
          return
        }

        const zones: PersonalizedZones | undefined = personalizedZones
          ? {
              optimalStress: {
                min: personalizedZones.optimalStressMin,
                max: personalizedZones.optimalStressMax,
              },
              optimalHeartRate: { min: 60, max: 80 }, // Default values
              optimalDuration: {
                min: personalizedZones.optimalDurationMin,
                max: personalizedZones.optimalDurationMax,
              },
            }
          : undefined

        const response = await apiClient.analyzeSessions({
          sessions: sessionData,
          personalizedZones: zones,
        })

        if (!cancelled) {
          setInsights(response.insights)
          setCached(response.cached)
          setLoading(false)
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to fetch insights')
          setLoading(false)
        }
      }
    }

    // Debounce the API call
    const timeout = setTimeout(fetchInsights, 1000)

    return () => {
      cancelled = true
      clearTimeout(timeout)
    }
  }, [sessions, personalizedZones, isAuthenticated])

  return { insights, loading, error, cached }
}
