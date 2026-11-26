import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { SettingsDto } from '@shared/contracts/settings'
import {
  HourlyDistributionChart,
  MonthlyTrendChart,
  TaskDurationChart,
  WeekdayDistribution,
  formatDuration
} from './AnalyticsCharts'
import { PeriodSelector } from './PeriodSelector'
import { useAnalyticsPeriod } from './useAnalyticsPeriod'

const weekdayNames = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه']

export function AnalyticsPage({ settings }: { settings: SettingsDto }) {
  const { period, setPeriod, reload, data, loading, error } = useAnalyticsPeriod(settings)

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeading
        title="تحلیل عملکرد"
        description="مرور الگوهای زمان ثبت‌شده؛ این آمار مدت کار ثبت‌شده را نشان می‌دهد و معیاری برای بهره‌وری نیست."
        action={<PeriodSelector onChange={setPeriod} period={period} />}
      />
      {loading && (
        <p className="text-sm text-muted" role="status">
          در حال محاسبه از داده‌های ثبت‌شده…
        </p>
      )}
      {error && (
        <div
          className="flex items-center justify-between gap-4 rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          <span>{error}</span>
          <Button onClick={reload} size="sm" variant="outline">
            تلاش دوباره
          </Button>
        </div>
      )}
      {data && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <InsightMetric
              label="میانگین هر روز کاریِ سپری‌شده"
              value={
                data.summary.averageDailyMinutes === null
                  ? '—'
                  : formatDuration(data.summary.averageDailyMinutes)
              }
            />
            <InsightMetric
              label="پرتکرارترین ساعت ثبت"
              value={
                data.insights.mostActiveHour === null
                  ? '—'
                  : `${formatNumber(data.insights.mostActiveHour)}:00`
              }
            />
            <InsightMetric
              label="پرتکرارترین روز هفته"
              value={
                data.insights.mostActiveWeekdayIso === null
                  ? '—'
                  : weekdayNames[data.insights.mostActiveWeekdayIso - 1]
              }
            />
            <InsightMetric
              label="تغییر نسبت به ماه قبل"
              value={formatSignedDuration(data.previousMonth.actualChangeMinutes)}
              detail={
                data.previousMonth.actualChangePercent === null
                  ? 'در ماه قبل زمانی ثبت نشده'
                  : `${formatPercent(data.previousMonth.actualChangePercent)} نسبت به ماه قبل`
              }
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>زمان ثبت‌شده در برابر تعهد ماهانه</CardTitle>
              <CardDescription>
                {formatDuration(data.summary.actualMinutes)} ثبت‌شده از{' '}
                {formatDuration(data.summary.targetMinutes)} تعهد؛ {data.summary.workingDays} روز
                کاری و {data.summary.leaveDays} روز مرخصی.
              </CardDescription>
            </CardHeader>
            <div className="grid grid-cols-2 gap-x-6 gap-y-3 text-sm md:grid-cols-4">
              <Definition
                label="مانده تعهد"
                value={formatSignedDuration(data.summary.remainingMinutes)}
              />
              <Definition
                label="تراز تجمعی"
                value={formatSignedDuration(data.summary.cumulativeBalanceMinutes)}
              />
              <Definition
                label="روز کاری باقی‌مانده"
                value={formatNumber(data.summary.remainingWorkDays)}
              />
              <Definition
                label="میانگین لازم در روز باقی‌مانده"
                value={
                  data.summary.requiredAverageMinutes === null
                    ? '—'
                    : formatDuration(data.summary.requiredAverageMinutes)
                }
              />
            </div>
          </Card>

          <div className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>توزیع بر اساس ساعت روز</CardTitle>
                <CardDescription>
                  از ساعت محلی ثبت‌شده برای هر جلسه، با حفظ منطقه زمانی همان جلسه.
                </CardDescription>
              </CardHeader>
              <HourlyDistributionChart data={data} />
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>توزیع بر اساس روز هفته</CardTitle>
                <CardDescription>
                  تخصیص هر جلسه به روز هفته از روی Work Date ذخیره‌شده انجام می‌شود.
                </CardDescription>
              </CardHeader>
              <WeekdayDistribution data={data} />
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>روند شش‌ماهه</CardTitle>
                <CardDescription>مجموع زمان واقعی و تعهد snapshotشده هر ماه.</CardDescription>
              </CardHeader>
              <MonthlyTrendChart data={data} />
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>مدت تسک‌ها در این ماه</CardTitle>
                <CardDescription>
                  تسک‌های بایگانی‌شده نیز برای حفظ سابقه زمان نمایش داده می‌شوند.
                </CardDescription>
              </CardHeader>
              <TaskDurationChart data={data} />
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>تخمین در برابر زمان واقعی تسک</CardTitle>
              <CardDescription>
                زمان واقعی از همه Work Dateهای ذخیره‌شده برای تسک می‌آید؛ تخمین، مقدار فعلی تسک است.
              </CardDescription>
            </CardHeader>
            {data.tasks.some((task) => task.estimatedMinutes !== null) ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[850px] border-collapse text-sm">
                  <thead className="text-start text-xs text-muted">
                    <tr>
                      <th className="border-b border-line px-3 py-2 text-start font-medium">تسک</th>
                      <th className="border-b border-line px-3 py-2 text-start font-medium">
                        تخمین
                      </th>
                      <th className="border-b border-line px-3 py-2 text-start font-medium">
                        زمان واقعی کل
                      </th>
                      <th className="border-b border-line px-3 py-2 text-start font-medium">
                        اختلاف
                      </th>
                      <th className="border-b border-line px-3 py-2 text-start font-medium">
                        میانگین جلسه
                      </th>
                      <th className="border-b border-line px-3 py-2 text-start font-medium">
                        طولانی‌ترین جلسه
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.tasks
                      .filter((task) => task.estimatedMinutes !== null)
                      .map((task) => (
                        <tr key={task.id} className="border-b border-line last:border-0">
                          <td className="max-w-72 truncate px-3 py-3 font-medium text-ink">
                            {task.title}
                          </td>
                          <td className="px-3 py-3 tabular-nums" dir="ltr">
                            {formatDuration(task.estimatedMinutes!)}
                          </td>
                          <td className="px-3 py-3 tabular-nums" dir="ltr">
                            {formatDuration(task.lifetimeActualMinutes)}
                          </td>
                          <td className="px-3 py-3 tabular-nums" dir="ltr">
                            {task.estimateVarianceMinutes === null
                              ? '—'
                              : formatSignedDuration(task.estimateVarianceMinutes)}
                          </td>
                          <td className="px-3 py-3 tabular-nums" dir="ltr">
                            {task.averageSessionMinutes === null
                              ? '—'
                              : formatDuration(task.averageSessionMinutes)}
                          </td>
                          <td className="px-3 py-3 tabular-nums" dir="ltr">
                            {task.longestSessionMinutes === null
                              ? '—'
                              : formatDuration(task.longestSessionMinutes)}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-sm text-muted">برای تسک‌های گزارش‌شده تخمینی ثبت نشده است.</p>
            )}
          </Card>

          <p className="rounded-lg bg-subtle px-4 py-3 text-sm leading-6 text-muted">
            بازه‌های دقیقِ بدون ثبت در ساعت کاری قابل محاسبه نیستند، چون تنظیمات فعلی فقط مدت هدف
            روزانه را ذخیره می‌کند و ساعت آغاز/پایان برنامه را نگه نمی‌دارد. فاصله تعهد تا زمان
            ثبت‌شده در گزارش ماهانه جداگانه نمایش داده می‌شود.
          </p>
        </>
      )}
    </div>
  )
}

function InsightMetric({
  label,
  value,
  detail
}: {
  label: string
  value: string
  detail?: string
}) {
  return (
    <section className="rounded-xl border border-line bg-panel px-4 py-3">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 text-lg font-semibold tabular-nums text-ink" dir="auto">
        {value}
      </p>
      {detail && <p className="mt-1 text-[11px] text-muted">{detail}</p>}
    </section>
  )
}

function Definition({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-semibold tabular-nums text-ink" dir="auto">
        {value}
      </p>
    </div>
  )
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value)
}

function formatSignedDuration(minutes: number) {
  return `${minutes < 0 ? '−' : minutes > 0 ? '+' : ''}${formatDuration(minutes)}`
}

function formatPercent(value: number) {
  const formatted = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(
    Math.abs(value)
  )
  return `${value > 0 ? '+' : value < 0 ? '−' : ''}${formatted}٪`
}
