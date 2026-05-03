import { createContext, useContext, ReactNode } from 'react'

/**
 * Local-only auth stub. Cloud accounts / device sync are not used —
 * all data stays on this machine.
 */
interface AuthContextType {
  user: null
  loading: boolean
  isGuest: boolean
  requestOTP: (email: string) => Promise<void>
  verifyOTP: (email: string, code: string, referredBy?: string) => Promise<void>
  continueAsGuest: () => void
  logout: () => void
  isAuthenticated: boolean
}

const AuthContext = createContext<AuthContextType | undefined>(undefined)

export function AuthProvider({ children }: { children: ReactNode }) {
  const value: AuthContextType = {
    user: null,
    loading: false,
    isGuest: true,
    requestOTP: async () => {
      throw new Error('Cloud accounts are disabled — Zeno runs fully locally.')
    },
    verifyOTP: async () => {
      throw new Error('Cloud accounts are disabled — Zeno runs fully locally.')
    },
    continueAsGuest: () => {},
    logout: () => {},
    isAuthenticated: true,
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const context = useContext(AuthContext)
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return context
}
