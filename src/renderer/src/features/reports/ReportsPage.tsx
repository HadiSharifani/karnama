import { useState } from 'react'
import { Download, FileText } from 'lucide-react'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import type { AnalyticsPeriodDto } from '@shared/contracts/analytics'
import type { SettingsDto } from '@shared/contracts/settings'
import { unwrapResult } from '@/lib/api'
import { formatDate } from '@/features/analytics/AnalyticsCharts'
import { formatDuration, formatInstant } from '@/lib/time-format'
import { PeriodSelector } from '@/features/analytics/PeriodSelector'
import { useAnalyticsPeriod } from '@/features/analytics/useAnalyticsPeriod'
import {
  MonthlyTrendChart,
  WeekdayDistribution,
  HourlyDistributionChart
} from '@/features/analytics/AnalyticsCharts'

type ReportType = 'company' | 'personal'

export function ReportsPage({ settings }: { settings: SettingsDto }) {
  const { period, setPeriod, reload, data, loading, error } = useAnalyticsPeriod(settings)
  const [reportType, setReportType] = useState<ReportType>('company')
  const [exporting, setExporting] = useState<'pdf' | 'html' | null>(null)
  const [exportMessage, setExportMessage] = useState('')
  const [exportError, setExportError] = useState('')

  async function exportReport(format: 'pdf' | 'html') {
    if (!data) return
    setExporting(format)
    setExportMessage('')
    setExportError('')
    try {
      const result = unwrapResult(
        await window.karnama.reports.export({
          snapshotId: data.snapshotId,
          reportType,
          format
        })
      )
      if (result.saved) setExportMessage(`گزارش در فایل ${result.fileName} ذخیره شد.`)
      else setExportMessage('ذخیره گزارش لغو شد.')
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : 'ساخت گزارش انجام نشد.')
    } finally {
      setExporting(null)
    }
  }

  async function openTaskLink(id: string) {
    setExportError('')
    try {
      unwrapResult(await window.karnama.resources.links.open(id))
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : 'بازکردن پیوند انجام نشد.')
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-6">
      <PageHeading
        title="گزارش‌ها"
        description="گزارش ماهانه را از داده‌های واقعی جلسات و تعهدات ذخیره‌شده آماده و به PDF یا HTML صادر کنید."
        action={<PeriodSelector onChange={setPeriod} period={period} />}
      />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div
          className="inline-flex rounded-lg border border-line bg-panel p-1"
          role="group"
          aria-label="نوع گزارش"
        >
          <Button
            aria-pressed={reportType === 'company'}
            onClick={() => setReportType('company')}
            size="sm"
            variant={reportType === 'company' ? 'secondary' : 'ghost'}
          >
            گزارش شرکت
          </Button>
          <Button
            aria-pressed={reportType === 'personal'}
            onClick={() => setReportType('personal')}
            size="sm"
            variant={reportType === 'personal' ? 'secondary' : 'ghost'}
          >
            گزارش شخصی
          </Button>
        </div>
        <div className="flex gap-2">
          <Button
            disabled={!data || loading || exporting !== null}
            onClick={() => void exportReport('html')}
            variant="outline"
          >
            <FileText aria-hidden="true" size={16} />
            {exporting === 'html' ? 'در حال ساخت…' : 'خروجی HTML'}
          </Button>
          <Button
            disabled={!data || loading || exporting !== null}
            onClick={() => void exportReport('pdf')}
          >
            <Download aria-hidden="true" size={16} />
            {exporting === 'pdf' ? 'در حال ساخت…' : 'خروجی PDF'}
          </Button>
        </div>
      </div>

      {loading && (
        <p className="text-sm text-muted" role="status">
          در حال آماده‌سازی گزارش ماهانه…
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
      {exportMessage && (
        <p className="rounded-lg bg-subtle px-4 py-3 text-sm text-ink" role="status">
          {exportMessage}
        </p>
      )}
      {exportError && (
        <p className="rounded-lg bg-danger-soft px-4 py-3 text-sm text-danger" role="alert">
          {exportError}
        </p>
      )}
      {data && <ReportContent data={data} onOpenLink={openTaskLink} reportType={reportType} />}
    </div>
  )
}

function ReportContent({
  data,
  reportType,
  onOpenLink
}: {
  data: AnalyticsPeriodDto
  reportType: ReportType
  onOpenLink: (id: string) => void
}) {
  return (
    <div className="space-y-5">
      {reportType === 'company' ? (
        <Card className="flex flex-wrap items-start justify-between gap-5">
          <div>
            <h2 className="text-lg font-semibold text-ink">
              {data.profile.displayName || 'نام ثبت نشده'}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {data.profile.jobTitle || 'عنوان شغلی ثبت نشده'}
            </p>
          </div>
          <div className="text-sm text-muted">
            <p>
              دوره: {formatDate(data.period.startDate, data.period.calendar)} تا{' '}
              {formatDate(data.period.endDate, data.period.calendar)}
            </p>
            <p className="mt-1">
              تهیه: {formatTimestamp(data.generatedAtUtcMs, data.timeZoneId, data.period.calendar)}
            </p>
          </div>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>مرور الگوهای ماه</CardTitle>
            <CardDescription>
              مقادیر، مدت زمان ثبت‌شده را توصیف می‌کنند و امتیاز بهره‌وری نیستند.
            </CardDescription>
          </CardHeader>
          <div className="grid gap-4 md:grid-cols-3">
            <ReportMetric
              label="میانگین هر روز کاری سپری‌شده"
              value={
                data.summary.averageDailyMinutes === null
                  ? '—'
                  : formatDuration(data.summary.averageDailyMinutes)
              }
            />
            <ReportMetric
              label="پرتکرارترین ساعت"
              value={
                data.insights.mostActiveHour === null
                  ? '—'
                  : `${formatNumber(data.insights.mostActiveHour)}:00`
              }
            />
            <ReportMetric
              label="پرتکرارترین روز هفته"
              value={
                data.insights.mostActiveWeekdayIso === null
                  ? '—'
                  : weekdayName(data.insights.mostActiveWeekdayIso)
              }
            />
          </div>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>خلاصه تعهد و زمان واقعی</CardTitle>
          <CardDescription>
            {data.activeTimerIncluded
              ? 'بخش زنده تایمر فعال نیز در زمان ثبت‌شده منظور شده است.'
              : 'زمان واقعی بر اساس Work Date تخصیص‌های ذخیره‌شده جمع شده است.'}
          </CardDescription>
        </CardHeader>
        <div className="grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-3 xl:grid-cols-4">
          <ReportMetric label="زمان ثبت‌شده" value={formatDuration(data.summary.actualMinutes)} />
          <ReportMetric label="تعهد ماهانه" value={formatDuration(data.summary.targetMinutes)} />
          <ReportMetric
            label="مانده یا مازاد"
            value={formatSignedDuration(data.summary.remainingMinutes)}
          />
          <ReportMetric
            label="تراز تجمعی"
            value={formatSignedDuration(data.summary.cumulativeBalanceMinutes)}
          />
          <ReportMetric label="روزهای کاری" value={formatNumber(data.summary.workingDays)} />
          <ReportMetric label="روزهای مرخصی" value={formatNumber(data.summary.leaveDays)} />
          <ReportMetric
            label="روزهای کاری باقی‌مانده"
            value={formatNumber(data.summary.remainingWorkDays)}
          />
        </div>
        {data.summary.requiredAverageMinutes !== null && (
          <p className="mt-5 text-sm text-muted">
            میانگین لازم در روز کاری باقی‌مانده:{' '}
            <bdi dir="ltr" className="font-semibold text-ink">
              {formatDuration(data.summary.requiredAverageMinutes)}
            </bdi>
          </p>
        )}
      </Card>

      {reportType === 'personal' && (
        <div className="grid gap-4 xl:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>توزیع زمان روزانه</CardTitle>
            </CardHeader>
            <HourlyDistributionChart data={data} />
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>الگوی روزهای هفته</CardTitle>
            </CardHeader>
            <WeekdayDistribution data={data} />
          </Card>
          <Card className="xl:col-span-2">
            <CardHeader>
              <CardTitle>مقایسه شش‌ماهه</CardTitle>
              <CardDescription>
                تغییر زمان ثبت‌شده نسبت به ماه قبل:{' '}
                {formatSignedDuration(data.previousMonth.actualChangeMinutes)}
                {data.previousMonth.actualChangePercent === null
                  ? ''
                  : ` (${formatPercent(data.previousMonth.actualChangePercent)})`}
                .
              </CardDescription>
            </CardHeader>
            <MonthlyTrendChart data={data} />
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>ریز روزانه بر اساس Work Date</CardTitle>
          <CardDescription>
            زمان هر روز از تخصیص‌های ثابت Work Date آمده است؛ تنظیمات مرز امروز، سابقه روزهای قبل را
            بازنویسی نمی‌کند.
          </CardDescription>
        </CardHeader>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[850px] border-collapse text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="border-b border-line px-3 py-2 text-start font-medium">تاریخ</th>
                <th className="border-b border-line px-3 py-2 text-start font-medium">ثبت‌شده</th>
                <th className="border-b border-line px-3 py-2 text-start font-medium">تعهد روز</th>
                <th className="border-b border-line px-3 py-2 text-start font-medium">تراز روز</th>
                <th className="border-b border-line px-3 py-2 text-start font-medium">
                  فاصله هدف تا ثبت
                </th>
                <th className="border-b border-line px-3 py-2 text-start font-medium">مرخصی</th>
                <th className="border-b border-line px-3 py-2 text-start font-medium">تعطیلی</th>
              </tr>
            </thead>
            <tbody>
              {data.days.map((day) => (
                <tr
                  className={`border-b border-line last:border-0 ${day.isCurrentWorkDate ? 'bg-subtle' : ''}`}
                  key={day.workDate}
                >
                  <td className="px-3 py-2.5">{formatDate(day.workDate, data.period.calendar)}</td>
                  <td className="px-3 py-2.5 tabular-nums" dir="ltr">
                    {formatDuration(day.actualMinutes)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums" dir="ltr">
                    {formatDuration(day.targetMinutes)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums" dir="ltr">
                    {formatSignedDuration(day.balanceMinutes)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums" dir="ltr">
                    {formatDuration(day.untrackedTargetGapMinutes)}
                  </td>
                  <td className="px-3 py-2.5 tabular-nums" dir="ltr">
                    {day.leaveMinutes ? formatDuration(day.leaveMinutes) : '—'}
                  </td>
                  <td className="px-3 py-2.5">{day.holidayName || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            {reportType === 'company' ? 'تسک‌های تکمیل‌شده و در حال انجام' : 'آمار زمان تسک‌ها'}
          </CardTitle>
          <CardDescription>
            زمان دوره برای همین ماه است؛ تخمین در برابر زمان واقعی کلِ ثبت‌شده در تمام دوره‌ها آمده
            است. وضعیت تسک وضعیت فعلی آن است.
          </CardDescription>
        </CardHeader>
        {data.tasks.length ? (
          <div className="space-y-4">
            {data.tasks.map((task) => (
              <article
                className="border-b border-line pb-4 last:border-0 last:pb-0"
                key={task.id ?? 'unassigned'}
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h3 className="font-semibold text-ink">{task.title}</h3>
                    <p className="mt-1 text-xs text-muted">
                      {statusName(task.status)}
                      {task.isArchived ? ' · بایگانی‌شده' : ''}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-x-5 gap-y-1 text-xs">
                    <span className="text-muted">این ماه</span>
                    <bdi className="text-ink" dir="ltr">
                      {formatDuration(task.actualMinutes)}
                    </bdi>
                    <span className="text-muted">کل زمان</span>
                    <bdi className="text-ink" dir="ltr">
                      {formatDuration(task.lifetimeActualMinutes)}
                    </bdi>
                    <span className="text-muted">تخمین</span>
                    <bdi className="text-ink" dir="ltr">
                      {task.estimatedMinutes === null ? '—' : formatDuration(task.estimatedMinutes)}
                    </bdi>
                    <span className="text-muted">جلسه‌های این ماه</span>
                    <span className="text-ink">{formatNumber(task.sessionCount)}</span>
                  </div>
                </div>
                {reportType === 'company' &&
                  (task.links.length > 0 || task.attachments.length > 0) && (
                    <div className="mt-3 flex flex-wrap items-start gap-4">
                      {task.links.map((link) => (
                        <button
                          className="text-start text-xs font-medium text-accent underline decoration-line underline-offset-4 hover:text-accent-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                          key={link.id}
                          onClick={() => onOpenLink(link.id)}
                          type="button"
                        >
                          {link.title || (link.type === 'figma' ? 'پیوند Figma' : 'پیوند خارجی')}
                        </button>
                      ))}
                      {task.attachments.map((attachment) => (
                        <figure className="w-28" key={attachment.id}>
                          <img
                            alt={attachment.description || attachment.displayName}
                            className="h-20 w-full rounded-lg border border-line bg-subtle object-contain"
                            loading="lazy"
                            onError={(event) => {
                              event.currentTarget.hidden = true
                            }}
                            src={`app://karnama/attachments/${attachment.id}`}
                          />
                          <figcaption
                            className="mt-1 truncate text-[11px] text-muted"
                            title={attachment.displayName}
                          >
                            {attachment.description || attachment.displayName}
                          </figcaption>
                        </figure>
                      ))}
                    </div>
                  )}
              </article>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">برای این دوره تسکی با زمان ثبت‌شده پیدا نشد.</p>
        )}
      </Card>

      <p className="rounded-lg bg-subtle px-4 py-3 text-sm leading-6 text-muted">
        بازه‌های دقیقِ بدون ثبت در ساعت کاری در دسترس نیستند؛ برنامه فعلی مدت هدف روزانه را ذخیره
        می‌کند، اما ساعت آغاز و پایان روز کاری را نگه نمی‌دارد. فاصله هدف تا زمان ثبت‌شده به‌تنهایی
        نشان‌دهنده بازه زمانی مشخص یا بهره‌وری نیست.
      </p>
    </div>
  )
}

function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-1 font-semibold tabular-nums text-ink" dir="auto">
        {value}
      </p>
    </div>
  )
}

function weekdayName(weekdayIso: number) {
  return ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه'][
    (weekdayIso + 1) % 7
  ]
}

function statusName(status: AnalyticsPeriodDto['tasks'][number]['status']) {
  if (!status) return 'فعالیت عمومی بدون تسک'
  return {
    todo: 'در صف',
    in_progress: 'در حال انجام',
    waiting_feedback: 'در انتظار بازخورد',
    on_hold: 'متوقف',
    done: 'تکمیل‌شده'
  }[status]
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

function formatTimestamp(timestamp: number, timeZoneId: string, calendar: 'jalali' | 'gregorian') {
  return formatInstant(timestamp, timeZoneId, calendar)
}
