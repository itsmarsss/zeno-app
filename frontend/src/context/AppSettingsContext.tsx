/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, type ReactNode } from 'react'
import type { AppSettings } from '../shared/types'

type AppSettingsContextValue = {
  settings: AppSettings | null
  updateSettings: (patch: Partial<AppSettings>) => Promise<void>
}

const AppSettingsContext = createContext<AppSettingsContextValue | null>(null)

export function AppSettingsProvider({ value, children }: { value: AppSettingsContextValue; children: ReactNode }) {
  return <AppSettingsContext.Provider value={value}>{children}</AppSettingsContext.Provider>
}

export function useAppSettings() {
  const ctx = useContext(AppSettingsContext)
  if (!ctx) {
    throw new Error('useAppSettings must be used within AppSettingsProvider')
  }
  return ctx
}
