import { CalendarDays, Moon, Pause, Play, Settings2, Square, Sun, Timer } from 'lucide-react'
import { routes, type RouteId } from '@/app/routes'
import { Button } from '@/components/ui/button'
import { formatDuration } from '@/lib/time-format'
import type { TimerAction } from '@/lib/timer-action'
import type { TimerStateDto } from '@shared/contracts/work'
import type { SettingsDto } from '@shared/contracts/settings'

export function AppHeader({
  activeRoute,
  settings,
  timerState,
  resolvedTheme,
  onOpenSettings,
  onToggleTheme,
  onNavigate,
  onTimerAction
}: {
  activeRoute: RouteId
  settings: SettingsDto
  timerState: TimerStateDto
  resolvedTheme: 'light' | 'dark'
  onOpenSettings: () => void
  onToggleTheme: () => void
  onNavigate: (route: RouteId) => void
  onTimerAction: (action: TimerAction) => Promise<void>
}) {
  const route = routes.find((item) => item.id === activeRoute)!
  const dateLocale =
    settings.preferences.calendar === 'jalali'
      ? 'fa-IR-u-ca-persian-nu-latn'
      : 'fa-IR-u-ca-gregory-nu-latn'
  const today = new Intl.DateTimeFormat(dateLocale, {
    dateStyle: 'full',
    timeZone: settings.preferences.timezoneId
  }).format(new Date())

  return (
    <header className="flex min-h-[76px] items-center justify-between gap-6 border-b border-line bg-panel px-8">
      <div className="flex min-w-0 items-center gap-3">
        <route.icon aria-hidden="true" className="shrink-0 text-muted" size={18} />
        <div className="min-w-0">
          <h1 className="truncate text-base font-semibold text-ink">{route.title}</h1>
          <p className="truncate text-xs text-muted">{route.description}</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-4">
        <div className="hidden items-center gap-2 text-sm text-muted md:flex">
          <CalendarDays aria-hidden="true" size={16} />
          <span>{today}</span>
        </div>
        {timerState.run && (
          <div className="flex items-center gap-1 rounded-lg bg-subtle px-1.5 py-1">
            <Button
              aria-label="رفتن به زمان‌سنج"
              className="gap-2 px-2 text-ink"
              onClick={() => onNavigate('timer')}
              size="sm"
              variant="ghost"
            >
              <Timer aria-hidden="true" size={15} className="text-accent-ink" />
              <span className="font-mono text-xs" dir="ltr">
                {formatDuration(timerState.run.elapsedMs)}
              </span>
              <span className="hidden max-w-24 truncate text-xs text-muted xl:inline">
                {timerState.run.taskTitle || 'عمومی'}
              </span>
            </Button>
            {timerState.run.recovery ? (
              <Button
                aria-label="بررسی زمان بازیابی"
                onClick={() => onNavigate('timer')}
                size="icon"
                variant="ghost"
              >
                <Timer aria-hidden="true" size={14} />
              </Button>
            ) : timerState.run.status === 'running' ? (
              <Button
                aria-label="مکث تایمر"
                onClick={() => void onTimerAction({ type: 'pause', runId: timerState.run!.id })}
                size="icon"
                variant="ghost"
              >
                <Pause aria-hidden="true" size={14} />
              </Button>
            ) : (
              <Button
                aria-label="ادامه تایمر"
                onClick={() => void onTimerAction({ type: 'resume', runId: timerState.run!.id })}
                size="icon"
                variant="ghost"
              >
                <Play aria-hidden="true" size={14} />
              </Button>
            )}
            {!timerState.run.recovery && (
              <Button
                aria-label="توقف تایمر"
                className="text-danger hover:bg-danger/10 hover:text-danger"
                onClick={() => void onTimerAction({ type: 'stop', runId: timerState.run!.id })}
                size="icon"
                variant="ghost"
              >
                <Square aria-hidden="true" size={12} />
              </Button>
            )}
          </div>
        )}
        <div className="h-6 w-px bg-line" />
        <Button
          aria-label={resolvedTheme === 'dark' ? 'روشن کردن پوسته' : 'تیره کردن پوسته'}
          onClick={onToggleTheme}
          size="icon"
          variant="ghost"
        >
          {resolvedTheme === 'dark' ? (
            <Sun aria-hidden="true" size={18} />
          ) : (
            <Moon aria-hidden="true" size={18} />
          )}
        </Button>
        <Button onClick={onOpenSettings} size="sm" variant="outline">
          <Settings2 aria-hidden="true" size={16} />
          تنظیمات
        </Button>
      </div>
    </header>
  )
}
