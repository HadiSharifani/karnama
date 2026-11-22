import { useEffect, useState } from 'react'
import { ArrowLeft, CalendarClock, ListTodo, Timer, UserRound } from 'lucide-react'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { SettingsDto } from '@shared/contracts/settings'
import type { CalendarMonthDto } from '@shared/contracts/calendar'
import type { TimerStateDto } from '@shared/contracts/work'
import { calendarDateParts } from '@shared/domain/calendar-date'
import { navigateTo } from '@/app/routes'
import { unwrapResult } from '@/lib/api'

const setupSteps = [
  { text: 'تکمیل مشخصات فردی', icon: UserRound },
  { text: 'بررسی تنظیمات ساعات کاری', icon: CalendarClock },
  { text: 'ایجاد اولین تسک', icon: ListTodo },
  { text: 'شروع ثبت زمان', icon: Timer }
]

export function DashboardPage({
  settings,
  timerState,
  onOpenSettings
}: {
  settings: SettingsDto
  timerState: TimerStateDto
  onOpenSettings: () => void
}) {
  const [monthData, setMonthData] = useState<CalendarMonthDto | null>(null)
  const [hasAnyActivity, setHasAnyActivity] = useState(false)
  const [loadError, setLoadError] = useState('')

  useEffect(() => {
    if (!settings.onboardingCompleted) return
    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: settings.preferences.timezoneId,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    }).formatToParts(Date.now())
    const values = Object.fromEntries(today.map(({ type, value }) => [type, value]))
    const isoToday = `${values.year}-${values.month}-${values.day}`
    const date = calendarDateParts(isoToday, settings.preferences.calendar)
    Promise.all([
      window.karnama.calendar.month({
        calendar: settings.preferences.calendar,
        year: date.jy,
        month: date.jm,
        focusDate: isoToday
      }),
      window.karnama.sessions.list()
    ])
      .then(([calendarResult, sessionResult]) => {
        const calendar = unwrapResult(calendarResult)
        const sessions = unwrapResult(sessionResult)
        setMonthData(calendar)
        setHasAnyActivity(
          sessions.length > 0 || calendar.days.some((day) => day.calendarSessions.length > 0)
        )
      })
      .catch((error: unknown) =>
        setLoadError(error instanceof Error ? error.message : 'خواندن داشبورد انجام نشد.')
      )
  }, [settings, timerState.run?.id, timerState.run?.status])

  if (!settings.onboardingCompleted) {
    return (
      <div className="mx-auto max-w-5xl">
        <PageHeading title="به کارنما خوش آمدید" />
        <Card className="max-w-4xl p-8 md:p-10">
          <div className="grid gap-10 md:grid-cols-[minmax(0,1fr)_280px] md:items-center">
            <div className="space-y-5">
              <p className="max-w-[64ch] text-base leading-8 text-muted">
                کارنما فضایی ساده برای سامان‌دادن تسک‌ها، ثبت زمان کار و مرور گزارش‌های شماست. برای
                شروع، تنظیمات اولیه را کامل کنید.
              </p>
              <Button onClick={onOpenSettings}>
                تکمیل تنظیمات
                <ArrowLeft aria-hidden="true" size={17} />
              </Button>
            </div>
            <ol className="space-y-4 border-t border-line pt-6 md:border-r md:border-t-0 md:pr-7 md:pt-0">
              {setupSteps.map((step) => {
                const Icon = step.icon
                return (
                  <li className="flex items-center gap-3" key={step.text}>
                    <span className="grid size-8 shrink-0 place-items-center rounded-full bg-subtle text-muted">
                      <Icon aria-hidden="true" size={15} />
                    </span>
                    <span className="text-sm font-medium text-ink">{step.text}</span>
                  </li>
                )
              })}
            </ol>
          </div>
        </Card>
      </div>
    )
  }

  const hasActivity = hasAnyActivity || timerState.run?.status === 'running'
  const todayData = monthData?.days.find((day) => day.workDate === monthData.currentWorkDate)

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title={settings.profile.displayName ? `سلام ${settings.profile.displayName}` : 'داشبورد'}
        description="نمای کلی کارهای ثبت‌شده شما در یک نگاه."
      />
      {loadError && (
        <p className="mb-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
          {loadError}
        </p>
      )}
      {hasActivity && monthData ? (
        <>
          <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <DashboardMetric
              label="زمان ثبت‌شده امروز"
              value={formatMinutes(todayData?.actualMinutes ?? 0)}
            />
            <DashboardMetric
              label="تعهد امروز"
              value={formatMinutes(todayData?.targetMinutes ?? 0)}
            />
            <DashboardMetric
              label="تراز امروز"
              value={formatMinutes(todayData?.dailyBalanceMinutes ?? 0)}
            />
            <DashboardMetric
              label="مانده تعهد ماه"
              value={formatMinutes(monthData.remainingMinutes)}
            />
          </div>
          <Card>
            <CardHeader>
              <CardTitle>این ماه</CardTitle>
              <CardDescription>
                {formatMinutes(monthData.actualMinutes)} از {formatMinutes(monthData.targetMinutes)}{' '}
                ثبت شده است.
                {monthData.requiredAverageMinutes !== null
                  ? ` میانگین لازم در روزهای کاری باقی‌مانده: ${formatMinutes(monthData.requiredAverageMinutes)}.`
                  : ' پیش‌بینی روزانه‌ای برای این ماه وجود ندارد.'}
              </CardDescription>
            </CardHeader>
            <div className="flex flex-wrap gap-3">
              <Button onClick={() => navigateTo('calendar')} variant="outline">
                مشاهده تقویم کاری
              </Button>
              <Button onClick={() => navigateTo('timer')}>ثبت زمان کار</Button>
            </div>
          </Card>
        </>
      ) : (
        <Card className="flex min-h-64 flex-col items-center justify-center border-dashed text-center">
          <div className="mb-4 grid size-12 place-items-center rounded-full bg-accent-soft text-accent-ink">
            <ListTodo aria-hidden="true" size={21} />
          </div>
          <CardHeader className="mb-0 max-w-lg">
            <CardTitle>هنوز زمان کاری ثبت نشده است</CardTitle>
            <CardDescription>
              پس از ثبت اولین جلسه، خلاصه روز و تعهد ماه بر پایه اطلاعات واقعی شما نمایش داده
              می‌شود.
            </CardDescription>
          </CardHeader>
          <Button className="mt-2" onClick={() => navigateTo('timer')}>
            شروع ثبت زمان
          </Button>
        </Card>
      )}
    </div>
  )
}

function formatMinutes(minutes: number) {
  const absolute = Math.abs(minutes)
  const number = new Intl.NumberFormat('fa-IR', { useGrouping: false })
  const hours = number.format(Math.floor(absolute / 60)).padStart(2, '۰')
  const remainder = number.format(absolute % 60).padStart(2, '۰')
  return `${minutes < 0 ? '−' : ''}${hours}:${remainder}`
}

function DashboardMetric({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-2 text-xl font-bold tabular-nums text-ink" dir="ltr">
        {value}
      </p>
    </Card>
  )
}
