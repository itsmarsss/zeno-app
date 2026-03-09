import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { apiClient } from '../api/client'

interface User {
  id: string
  email: string
  subscriptionTier: string
}

interface AuthContextType {
  user: User | null
  loading: boolean
  isGuest: boolean
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  continueAsGuest: () => void
  logout: () => void
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null)
  const [isGuest, setIsGuest] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Check if user is already logged in or in guest mode
    const guestMode = localStorage.getItem('guest_mode') === 'true'
    if (guestMode) {
      setIsGuest(true)
      setLoading(false)
      return
    }

    const token = apiClient.getToken()
    if (token) {
      apiClient
        .getMe()
        .then((response) => {
          setUser(response.user)
          setLoading(false)
        })
        .catch(() => {
          // Token expired or invalid
          apiClient.setToken(null)
          setLoading(false)
        })
    } else {
      setLoading(false)
    }
  }, [])

  const login = async (email: string, password: string) => {
    const response = await apiClient.login(email, password)
    apiClient.setToken(response.token)
    setUser(response.user)
  }

  const register = async (email: string, password: string) => {
    const response = await apiClient.register(email, password)
    apiClient.setToken(response.token)
    setUser(response.user)
  }

  const continueAsGuest = () => {
    localStorage.setItem('guest_mode', 'true')
    setIsGuest(true)
  }

  const logout = () => {
    apiClient.setToken(null)
    localStorage.removeItem('guest_mode')
    setUser(null)
    setIsGuest(false)
  }

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        isGuest,
        login,
        register,
        continueAsGuest,
        logout,
        isAuthenticated: !!user || isGuest,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
