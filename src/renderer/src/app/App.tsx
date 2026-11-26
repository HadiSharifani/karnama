import { useCallback, useEffect, useState } from 'react'
import { navigateTo, routeFromHash, type RouteId } from '@/app/routes'
import { AppShell } from '@/components/AppShell'
import { Button } from '@/components/ui/button'
import { DashboardPage } from '@/features/dashboard/DashboardPage'
import { EmptyPage } from '@/features/empty/EmptyPage'
import { SettingsPage } from '@/features/settings/SettingsPage'
import { TasksPage } from '@/features/tasks/TasksPage'
import { TimerPage } from '@/features/timer/TimerPage'
import { CalendarPage } from '@/features/calendar/CalendarPage'
import { AnalyticsPage } from '@/features/analytics/AnalyticsPage'
import { ReportsPage } from '@/features/reports/ReportsPage'
import { unwrapResult } from '@/lib/api'
import type { SettingsDto } from '@shared/contracts/settings'
import type { TimerStateDto } from '@shared/contracts/work'
import type { TimerAction } from '@/lib/timer-action'

export function App() {
  const [activeRoute, setActiveRoute] = useState<RouteId>(() => routeFromHash(window.location.hash))
  const [settings, setSettings] = useState<SettingsDto | null>(null)
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>('light')
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState('')
  const [themeError, setThemeError] = useState('')
  const [timerState, setTimerState] = useState<TimerStateDto>({ run: null })
  const [timerError, setTimerError] = useState('')

  const loadSettings = useCallback(async () => {
    setLoading(true)
    setLoadError('')
    try {
      setSettings(unwrapResult(await window.karnama.settings.get()))
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : 'خواندن تنظیمات انجام نشد.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const refreshTimer = useCallback(async () => {
    try {
      setTimerState(unwrapResult(await window.karnama.timer.get()))
    } catch (error) {
      setTimerError(error instanceof Error ? error.message : 'خواندن وضعیت تایمر انجام نشد.')
    }
  }, [])

  useEffect(() => {
    void refreshTimer()
    const interval = window.setInterval(() => void refreshTimer(), 1000)
    return () => window.clearInterval(interval)
  }, [refreshTimer])

  const handleTimerAction = useCallback(
    async (action: TimerAction) => {
      setTimerError('')
      try {
        const result =
          action.type === 'start'
            ? await window.karnama.timer.start(action.taskId)
            : action.type === 'pause'
              ? await window.karnama.timer.pause(action.runId)
              : action.type === 'resume'
                ? await window.karnama.timer.resume(action.runId)
                : action.type === 'stop'
                  ? await window.karnama.timer.stop(action.runId)
                  : await window.karnama.timer.reviewRecovery(action.runId, action.decision)
        setTimerState(unwrapResult(result))
      } catch (error) {
        setTimerError(error instanceof Error ? error.message : 'عملیات تایمر انجام نشد.')
        void refreshTimer()
      }
    },
    [refreshTimer]
  )

  useEffect(() => {
    const onHashChange = () => setActiveRoute(routeFromHash(window.location.hash))
    window.addEventListener('hashchange', onHashChange)
    if (!window.location.hash) navigateTo('dashboard')
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  useEffect(() => {
    if (!settings) return
    const systemTheme = window.matchMedia('(prefers-color-scheme: dark)')
    const applyTheme = () => {
      const nextTheme =
        settings.preferences.theme === 'system'
          ? systemTheme.matches
            ? 'dark'
            : 'light'
          : settings.preferences.theme
      setResolvedTheme(nextTheme)
      document.documentElement.dataset.theme = nextTheme
    }

    applyTheme()
    systemTheme.addEventListener('change', applyTheme)
    return () => systemTheme.removeEventListener('change', applyTheme)
  }, [settings?.preferences.theme, settings])

  const handleSettingsSaved = useCallback((nextSettings: SettingsDto) => {
    setSettings(nextSettings)
  }, [])

  const handleSetupCompleted = useCallback((nextSettings: SettingsDto) => {
    setSettings(nextSettings)
    navigateTo('dashboard')
  }, [])

  const handleToggleTheme = useCallback(async () => {
    if (!settings) return
    setThemeError('')
    const nextInput = {
      profile: settings.profile,
      workingHours: settings.workingHours,
      preferences: {
        ...settings.preferences,
        theme: resolvedTheme === 'dark' ? ('light' as const) : ('dark' as const)
      }
    }
    const previousSettings = settings
    const optimisticSettings = { ...settings, preferences: nextInput.preferences }
    setSettings(optimisticSettings)

    try {
      setSettings(unwrapResult(await window.karnama.settings.save(nextInput)))
    } catch (error) {
      setSettings(previousSettings)
      setThemeError(error instanceof Error ? error.message : 'تغییر پوسته ذخیره نشد.')
    }
  }, [resolvedTheme, settings])

  if (loading) {
    return (
      <div
        className="grid h-screen place-items-center bg-background text-sm text-muted"
        role="status"
      >
        در حال بارگذاری کارنما…
      </div>
    )
  }

  if (loadError || !settings) {
    return (
      <div className="grid h-screen place-items-center bg-background px-8 text-center">
        <div className="max-w-md space-y-4">
          <h1 className="text-xl font-bold text-ink">کارنما آماده نشد</h1>
          <p className="text-sm leading-6 text-muted" role="alert">
            {loadError || 'تنظیمات برنامه در دسترس نیست.'}
          </p>
          <Button onClick={() => void loadSettings()} variant="outline">
            تلاش دوباره
          </Button>
        </div>
      </div>
    )
  }

  return (
    <AppShell
      activeRoute={activeRoute}
      onNavigate={navigateTo}
      onToggleTheme={() => void handleToggleTheme()}
      resolvedTheme={resolvedTheme}
      settings={settings}
      timerState={timerState}
      onTimerAction={handleTimerAction}
    >
      {themeError && (
        <p className="sr-only" role="alert">
          {themeError}
        </p>
      )}
      {activeRoute === 'dashboard' ? (
        <DashboardPage
          onOpenSettings={() => navigateTo('settings')}
          settings={settings}
          timerState={timerState}
        />
      ) : activeRoute === 'settings' ? (
        <SettingsPage
          key={settings.onboardingCompleted ? 'completed' : 'setup'}
          onCompleted={handleSetupCompleted}
          onSaved={handleSettingsSaved}
          settings={settings}
        />
      ) : activeRoute === 'tasks' ? (
        <TasksPage settings={settings} />
      ) : activeRoute === 'timer' ? (
        <TimerPage
          onTimerAction={handleTimerAction}
          settings={settings}
          timerError={timerError}
          timerState={timerState}
        />
      ) : activeRoute === 'calendar' ? (
        <CalendarPage settings={settings} />
      ) : activeRoute === 'analytics' ? (
        <AnalyticsPage settings={settings} />
      ) : activeRoute === 'reports' ? (
        <ReportsPage settings={settings} />
      ) : (
        <EmptyPage
          page={
            activeRoute as Exclude<
              RouteId,
              'dashboard' | 'settings' | 'calendar' | 'analytics' | 'reports'
            >
          }
        />
      )}
    </AppShell>
  )
}
