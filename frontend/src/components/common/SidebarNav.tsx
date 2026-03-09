import { Activity, BarChart3, Dumbbell, Settings, SlidersHorizontal } from 'lucide-react'

export type MainTab = 'overview' | 'monitor' | 'focus' | 'posture' | 'exercises' | 'settings'

const NAV_ITEMS: Array<{ id: MainTab; label: string; icon: typeof BarChart3 }> = [
  { id: 'overview', label: 'Overview', icon: BarChart3 },
  { id: 'monitor', label: 'Monitor', icon: Activity },
  { id: 'focus', label: 'Focus History', icon: Activity },
  { id: 'posture', label: 'Posture', icon: SlidersHorizontal },
  { id: 'exercises', label: 'Exercises', icon: Dumbbell },
  { id: 'settings', label: 'Settings', icon: Settings },
]

export function SidebarNav({ tab, setTab }: { tab: MainTab; setTab: (tab: MainTab) => void }) {
  return (
    <aside className="main-sidebar">
      <h2>
        <span className="main-brand-dot" aria-hidden />
        <span className="main-brand-name">zeno</span>
      </h2>
      {NAV_ITEMS.map((item) => (
        <button
          key={item.id}
          className={tab === item.id ? 'main-nav is-active' : 'main-nav'}
          onClick={() => setTab(item.id)}
          title={item.label}
          aria-label={item.label}
        >
          <item.icon size={15} className="main-nav-icon" />
          <span className="main-nav-label">{item.label}</span>
        </button>
      ))}
    </aside>
  )
}
