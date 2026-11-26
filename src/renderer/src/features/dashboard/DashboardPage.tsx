import { useEffect, useState } from 'react'
import { ArrowLeft, CalendarClock, ListTodo, Timer, UserRound } from 'lucide-react'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { SettingsDto } from '@shared/contracts/settings'
import type { AnalyticsPeriodDto } from '@shared/contracts/analytics'
import type { TimerStateDto } from '@shared/contracts/work'
import { calendarDateParts, isoDateInTimezone } from '@shared/domain/calendar-date'
import { navigateTo } from '@/app/routes'
import { unwrapResult } from '@/lib/api'
import {
  DailyWorkHoursChart,
  HourlyDistributionChart,
  MonthlyActivityHeatmap,
  MonthlyTrendChart,
  TaskDurationChart,
  formatDuration
} from '@/features/analytics/AnalyticsCharts'

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
  const [data, setData] = useState<AnalyticsPeriodDto | null>(null)
  const [loadError, setLoadError] = useState('')
  const [loading, setLoading] = useState(false)
  const [refreshTick, setRefreshTick] = useState(0)

  useEffect(() => {
    if (timerState.run?.status !== 'running') return
    const interval = window.setInterval(() => setRefreshTick((tick) => tick + 1), 15_000)
    return () => window.clearInterval(interval)
  }, [timerState.run?.id, timerState.run?.status])

  useEffect(() => {
    if (!settings.onboardingCompleted) return
    let cancelled = false
    setLoading(true)
    setLoadError('')
    const isoToday = isoDateInTimezone(settings.preferences.timezoneId)
    const date = calendarDateParts(isoToday, settings.preferences.calendar)
    window.karnama.analytics
      .getPeriod({
        calendar: settings.preferences.calendar,
        year: date.jy,
        month: date.jm
      })
      .then((result) => {
        if (!cancelled) setData(unwrapResult(result))
      })
      .catch((error: unknown) => {
        if (!cancelled)
          setLoadError(error instanceof Error ? error.message : 'خواندن داشبورد انجام نشد.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [
    settings.onboardingCompleted,
    settings.preferences.calendar,
    settings.preferences.timezoneId,
    timerState.run?.id,
    timerState.run?.status,
    refreshTick
  ])

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

  const today = data?.currentDay
  const greeting = settings.profile.displayName ? `سلام ${settings.profile.displayName}` : 'داشبورد'
  const running = timerState.run?.status === 'running'

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <PageHeading
        title={greeting}
        description="نمای روز و ماه از زمان‌های ثبت‌شده شما؛ داده‌ها بر پایه Work Dateهای ذخیره‌شده‌اند."
        action={
          <Button onClick={() => navigateTo('timer')}>
            <Timer aria-hidden="true" size={16} /> ثبت زمان
          </Button>
        }
      />
      {loadError && (
        <div
          className="flex items-center justify-between gap-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          <span>{loadError}</span>
          <Button onClick={() => setRefreshTick((tick) => tick + 1)} size="sm" variant="outline">
            تلاش دوباره
          </Button>
        </div>
      )}
      {loading && !data && (
        <p className="text-sm text-muted" role="status">
          در حال آماده‌سازی خلاصه‌ها…
        </p>
      )}

      {data && (
        <>
          {data.summary.actualMinutes === 0 && !running && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-panel px-5 py-4">
              <div>
                <h2 className="font-semibold text-ink">هنوز زمانی ثبت نشده است</h2>
                <p className="mt-1 text-sm text-muted">
                  نمودارها پس از ثبت جلسه، از اطلاعات واقعی شما ساخته می‌شوند.
                </p>
              </div>
              <Button onClick={() => navigateTo('timer')} variant="outline">
                شروع ثبت زمان
              </Button>
            </div>
          )}

          <section
            aria-label="خلاصه امروز"
            className="grid grid-cols-2 gap-x-5 gap-y-4 rounded-xl border border-line bg-panel px-5 py-4 sm:grid-cols-4"
          >
            <DashboardMetric
              label="زمان ثبت‌شده امروز"
              value={formatDuration(today?.actualMinutes ?? 0)}
            />
            <DashboardMetric label="تعهد امروز" value={formatDuration(today?.targetMinutes ?? 0)} />
            <DashboardMetric
              label={
                today?.workDate === data.days.find((day) => day.isCurrentWorkDate)?.workDate
                  ? 'تراز امروز · زنده'
                  : 'تراز امروز'
              }
              value={formatSignedDuration(today?.balanceMinutes ?? 0)}
            />
            <DashboardMetric
              label={
                running
                  ? 'تایمر در حال اجرا'
                  : timerState.run?.status === 'paused'
                    ? 'تایمر مکث‌شده'
                    : 'تایمر فعال'
              }
              value={
                timerState.run ? formatDuration(Math.floor(timerState.run.elapsedMs / 60_000)) : '—'
              }
              detail={
                timerState.run?.taskTitle || (timerState.run ? 'فعالیت عمومی' : 'تایمری فعال نیست')
              }
            />
          </section>

          {today && (
            <section className="grid gap-4 md:grid-cols-2">
              <Card>
                <CardHeader className="mb-3">
                  <CardTitle>تسک‌های تکمیل‌شده امروز</CardTitle>
                  <CardDescription>
                    تسک‌هایی که تاریخ تکمیل ذخیره‌شده‌شان با Work Date امروز برابر است.
                  </CardDescription>
                </CardHeader>
                <TaskNames names={today.completedTaskTitles} empty="امروز تسکی تکمیل نشده است." />
              </Card>
              <Card>
                <CardHeader className="mb-3">
                  <CardTitle>تسک‌های در حال انجام</CardTitle>
                  <CardDescription>تسک‌های فعال فعلی، بدون افزودن آمار نمونه.</CardDescription>
                </CardHeader>
                <TaskNames
                  names={today.currentTaskTitles}
                  empty="تسکی در وضعیت در حال انجام نیست."
                />
              </Card>
            </section>
          )}

          <Card>
            <CardHeader>
              <CardTitle>خلاصه ماهانه</CardTitle>
              <CardDescription>
                {formatDuration(data.summary.actualMinutes)} ثبت‌شده از{' '}
                {formatDuration(data.summary.targetMinutes)} تعهد.
                {data.summary.requiredAverageMinutes === null
                  ? ' میانگین لازم روزانه‌ای برای ادامه ماه وجود ندارد.'
                  : ` برای روزهای کاری باقی‌مانده، روزانه ${formatDuration(data.summary.requiredAverageMinutes)} لازم است.`}
              </CardDescription>
            </CardHeader>
            <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-6">
              <MonthMetric
                label="مانده تعهد"
                value={formatSignedDuration(data.summary.remainingMinutes)}
              />
              <MonthMetric
                label="تراز تجمعی"
                value={formatSignedDuration(data.summary.cumulativeBalanceMinutes)}
              />
              <MonthMetric label="روزهای کاری" value={formatNumber(data.summary.workingDays)} />
              <MonthMetric label="روزهای مرخصی" value={formatNumber(data.summary.leaveDays)} />
              <MonthMetric
                label="روز کاری باقی‌مانده"
                value={formatNumber(data.summary.remainingWorkDays)}
              />
              <MonthMetric
                label="میانگین روز سپری‌شده"
                value={
                  data.summary.averageDailyMinutes === null
                    ? '—'
                    : formatDuration(data.summary.averageDailyMinutes)
                }
              />
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>ساعت کار روزانه</CardTitle>
                <CardDescription>زمان واقعی در کنار تعهد هر Work Date از ماه جاری.</CardDescription>
              </CardHeader>
              <DailyWorkHoursChart data={data} />
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>نقشه فعالیت ماه</CardTitle>
                <CardDescription>شدت هر روز نسبت به زمان ثبت‌شده همان روز.</CardDescription>
              </CardHeader>
              <MonthlyActivityHeatmap data={data} />
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>زمان در ساعت‌های روز</CardTitle>
                <CardDescription>بر پایه منطقه زمانی ذخیره‌شده برای جلسه‌ها.</CardDescription>
              </CardHeader>
              <HourlyDistributionChart data={data} />
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>مدت تسک‌ها</CardTitle>
                <CardDescription>
                  تسک‌های دارای زمان ثبت‌شده در ماه، از بیشترین به کمترین.
                </CardDescription>
              </CardHeader>
              <TaskDurationChart data={data} />
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>روند شش‌ماهه</CardTitle>
                <CardDescription>مجموع زمان ثبت‌شده و تعهد ماهانه.</CardDescription>
              </CardHeader>
              <MonthlyTrendChart data={data} />
            </Card>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button onClick={() => navigateTo('analytics')} variant="outline">
              تحلیل جزئی‌تر
            </Button>
            <Button onClick={() => navigateTo('reports')} variant="outline">
              ساخت گزارش ماهانه
            </Button>
          </div>
        </>
      )}
    </div>
  )
}

function DashboardMetric({
  label,
  value,
  detail
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold tabular-nums text-ink" dir="auto">
        {value}
      </p>
      {detail && (
        <p className="mt-0.5 truncate text-[11px] text-muted" title={detail}>
          {detail}
        </p>
      )}
    </div>
  )
}

function MonthMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-semibold tabular-nums text-ink" dir="auto">
        {value}
      </p>
    </div>
  )
}

function TaskNames({ names, empty }: { names: string[]; empty: string }) {
  return names.length ? (
    <ul className="space-y-2">
      {names.map((name, index) => (
        <li
          className="truncate rounded-lg bg-subtle px-3 py-2 text-sm text-ink"
          key={`${index}-${name}`}
          title={name}
        >
          {name}
        </li>
      ))}
    </ul>
  ) : (
    <p className="text-sm text-muted">{empty}</p>
  )
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value)
}

function formatSignedDuration(minutes: number) {
  return `${minutes < 0 ? '−' : minutes > 0 ? '+' : ''}${formatDuration(minutes)}`
}
