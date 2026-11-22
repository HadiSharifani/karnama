import { AppHeader } from '@/components/AppHeader'
import { AppSidebar } from '@/components/AppSidebar'
import type { RouteId } from '@/app/routes'
import type { SettingsDto } from '@shared/contracts/settings'
import type { TimerStateDto } from '@shared/contracts/work'
import type { TimerAction } from '@/lib/timer-action'
import type { ReactNode } from 'react'

export function AppShell({
  activeRoute,
  settings,
  resolvedTheme,
  onNavigate,
  onToggleTheme,
  timerState,
  onTimerAction,
  children
}: {
  activeRoute: RouteId
  settings: SettingsDto
  resolvedTheme: 'light' | 'dark'
  onNavigate: (route: RouteId) => void
  onToggleTheme: () => void
  timerState: TimerStateDto
  onTimerAction: (action: TimerAction) => Promise<void>
  children: ReactNode
}) {
  return (
    <div className="grid h-screen min-h-[680px] min-w-[1024px] grid-cols-[260px_minmax(0,1fr)] overflow-hidden bg-background text-ink">
      <AppSidebar activeRoute={activeRoute} onNavigate={onNavigate} settings={settings} />
      <section className="flex min-h-0 min-w-0 flex-col">
        <AppHeader
          activeRoute={activeRoute}
          onOpenSettings={() => onNavigate('settings')}
          onNavigate={onNavigate}
          onToggleTheme={onToggleTheme}
          onTimerAction={onTimerAction}
          resolvedTheme={resolvedTheme}
          settings={settings}
          timerState={timerState}
        />
        <main className="min-h-0 flex-1 overflow-y-auto bg-background px-8 py-8">{children}</main>
      </section>
    </div>
  )
}
