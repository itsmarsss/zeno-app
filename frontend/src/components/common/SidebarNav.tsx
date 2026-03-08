export type MainTab = 'overview' | 'focus' | 'posture' | 'exercises' | 'settings'

const NAV_ITEMS: Array<{ id: MainTab; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'focus', label: 'Focus History' },
  { id: 'posture', label: 'Posture' },
  { id: 'exercises', label: 'Exercises' },
  { id: 'settings', label: 'Settings' },
]

export function SidebarNav({ tab, setTab }: { tab: MainTab; setTab: (tab: MainTab) => void }) {
  return (
    <aside className="main-sidebar">
      <h2>Zeno</h2>
      {NAV_ITEMS.map((item) => (
        <button key={item.id} className={tab === item.id ? 'main-nav is-active' : 'main-nav'} onClick={() => setTab(item.id)}>
          {item.label}
        </button>
      ))}
    </aside>
  )
}
