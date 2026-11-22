import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  CircleAlert,
  Clock3,
  RotateCcw
} from 'lucide-react'
import type { CalendarMonthDto } from '@shared/contracts/calendar'
import {
  calendarDateParts,
  calendarMonthGrid,
  shiftCalendarMonth
} from '@shared/domain/calendar-date'
import type { SettingsDto } from '@shared/contracts/settings'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { unwrapResult } from '@/lib/api'

const weekDays = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه']

function localDateInTimezone(timezoneId: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezoneId,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(Date.now())
  const value = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${value.year}-${value.month}-${value.day}`
}

function formatMinutes(minutes: number) {
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const remainder = absolute % 60
  const number = new Intl.NumberFormat('fa-IR', { useGrouping: false })
  return `${minutes < 0 ? '−' : ''}${number.format(hours).padStart(2, '۰')}:${number.format(remainder).padStart(2, '۰')}`
}

function dateLabel(date: string, calendar: 'jalali' | 'gregorian') {
  return new Intl.DateTimeFormat('fa-IR', {
    calendar: calendar === 'jalali' ? 'persian' : 'gregory',
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${date}T12:00:00Z`))
}

function monthLabel(date: string, calendar: 'jalali' | 'gregorian') {
  return new Intl.DateTimeFormat('fa-IR', {
    calendar: calendar === 'jalali' ? 'persian' : 'gregory',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${date}T12:00:00Z`))
}

function minutesFromTime(value: string) {
  if (!value) return null
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

function timeFromMinutes(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function activityTone(minutes: number) {
  if (minutes >= 480) return 'bg-accent/20'
  if (minutes >= 240) return 'bg-accent/15'
  if (minutes >= 60) return 'bg-accent/10'
  if (minutes > 0) return 'bg-accent/5'
  return 'bg-panel'
}

function formatClock(instantUtcMs: number, timezoneId: string) {
  return new Intl.DateTimeFormat('fa-IR', {
    timeZone: timezoneId,
    hour: '2-digit',
    minute: '2-digit'
  }).format(instantUtcMs)
}

export function CalendarPage({ settings }: { settings: SettingsDto }) {
  const calendar = settings.preferences.calendar
  const today = localDateInTimezone(settings.preferences.timezoneId)
  const todayParts = calendarDateParts(today, calendar)
  const [year, setYear] = useState(todayParts.jy)
  const [month, setMonth] = useState(todayParts.jm)
  const [selectedDate, setSelectedDate] = useState(today)
  const [data, setData] = useState<CalendarMonthDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [monthlyOverride, setMonthlyOverride] = useState('')
  const [dayOverride, setDayOverride] = useState('')
  const [isHoliday, setIsHoliday] = useState(false)
  const [holidayName, setHolidayName] = useState('')
  const [holidayKind, setHolidayKind] = useState<'public' | 'custom'>('custom')
  const [leaveKind, setLeaveKind] = useState<'none' | 'full' | 'half' | 'custom'>('none')
  const [leaveMinutes, setLeaveMinutes] = useState('')
  const [leaveStatus, setLeaveStatus] = useState<'pending' | 'approved' | 'rejected'>('approved')
  const [leaveRangeMode, setLeaveRangeMode] = useState(false)
  const [leaveStartDate, setLeaveStartDate] = useState<string | null>(null)
  const [leaveEndDate, setLeaveEndDate] = useState<string | null>(null)
  const [boundary, setBoundary] = useState('')
  const [hasBoundaryOverride, setHasBoundaryOverride] = useState(false)

  const grid = useMemo(() => calendarMonthGrid(year, month, calendar), [year, month, calendar])
  const selected = data?.days.find((day) => day.workDate === selectedDate) ?? null
  const isHistoricalDay = data ? selectedDate < data.currentWorkDate : false
  const monthHasPastDays = data ? data.periodStart < data.currentWorkDate : false

  const loadMonth = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const response = await window.karnama.calendar.month({
        calendar,
        year,
        month,
        focusDate: selectedDate
      })
      setData(unwrapResult(response))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'خواندن تقویم انجام نشد.')
    } finally {
      setLoading(false)
    }
  }, [calendar, month, selectedDate, year])

  useEffect(() => {
    void loadMonth()
  }, [loadMonth])

  useEffect(() => {
    if (!selected) return
    setDayOverride(
      selected.dayOverrideMinutes === null ? '' : String(selected.dayOverrideMinutes / 60)
    )
    setIsHoliday(Boolean(selected.holiday))
    setHolidayName(selected.holiday?.name ?? '')
    setHolidayKind(selected.holiday?.kind ?? 'custom')
    setLeaveKind(selected.leave?.kind ?? 'none')
    setLeaveMinutes(
      selected.leave?.kind === 'custom' && selected.leave.customMinutes !== null
        ? String(selected.leave.customMinutes / 60)
        : ''
    )
    setLeaveStatus(selected.leave?.status ?? 'approved')
    setBoundary(timeFromMinutes(selected.boundaryMinutes))
    setHasBoundaryOverride(selected.hasBoundaryOverride)
  }, [selected])

  useEffect(() => {
    setMonthlyOverride(
      data?.overrideMinutes === null || !data ? '' : String(data.overrideMinutes / 60)
    )
  }, [data?.overrideMinutes, data])

  async function saveAction(
    action: () => Promise<{ ok: boolean; error?: { message: string } }>,
    historical = false
  ) {
    if (
      historical &&
      !window.confirm('این تغییر اطلاعات یک روز یا ماه گذشته را اصلاح می‌کند. ادامه می‌دهید؟')
    ) {
      return
    }
    setSaving(true)
    setError('')
    try {
      const result = await action()
      if (!result.ok) throw new Error(result.error?.message ?? 'ذخیره تغییرات انجام نشد.')
      await loadMonth()
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'ذخیره تغییرات انجام نشد.')
    } finally {
      setSaving(false)
    }
  }

  function goToMonth(delta: number) {
    const next = shiftCalendarMonth(year, month, delta)
    setYear(next.year)
    setMonth(next.month)
    const nextRange = calendarMonthGrid(next.year, next.month, calendar)
    setSelectedDate(nextRange.startDate)
  }

  function goToToday() {
    const parts = calendarDateParts(today, calendar)
    setYear(parts.jy)
    setMonth(parts.jm)
    setSelectedDate(today)
  }

  function openDate(date: string) {
    if (leaveRangeMode) {
      if (!leaveStartDate || leaveEndDate) {
        setLeaveStartDate(date)
        setLeaveEndDate(null)
      } else if (date < leaveStartDate) {
        setLeaveEndDate(leaveStartDate)
        setLeaveStartDate(date)
      } else {
        setLeaveEndDate(date)
      }
    }
    const parts = calendarDateParts(date, calendar)
    setYear(parts.jy)
    setMonth(parts.jm)
    setSelectedDate(date)
  }

  async function saveMonthlyTarget() {
    const targetMinutes = monthlyOverride.trim() ? Math.round(Number(monthlyOverride) * 60) : null
    if (targetMinutes !== null && (!Number.isFinite(targetMinutes) || targetMinutes > 100_000)) {
      setError('تعهد ماهانه معتبر نیست.')
      return
    }
    await saveAction(
      () =>
        window.karnama.calendar.setMonthlyOverride({
          calendar,
          year,
          month,
          targetMinutes,
          allowHistorical: monthHasPastDays
        }),
      monthHasPastDays
    )
  }

  async function saveDayTarget() {
    const targetMinutes = dayOverride.trim() ? Math.round(Number(dayOverride) * 60) : null
    if (
      targetMinutes !== null &&
      (!Number.isFinite(targetMinutes) || targetMinutes < 0 || targetMinutes > 1440)
    ) {
      setError('تعهد روزانه باید بین صفر تا ۲۴ ساعت باشد.')
      return
    }
    await saveAction(
      () =>
        window.karnama.calendar.setDayOverride({
          workDate: selectedDate,
          targetMinutes,
          allowHistorical: isHistoricalDay
        }),
      isHistoricalDay
    )
  }

  async function saveHoliday() {
    if (isHoliday && !holidayName.trim()) {
      setError('نام تعطیلی را وارد کنید.')
      return
    }
    await saveAction(
      () =>
        window.karnama.calendar.setHoliday({
          workDate: selectedDate,
          holiday: isHoliday ? { name: holidayName.trim(), kind: holidayKind } : null,
          allowHistorical: isHistoricalDay
        }),
      isHistoricalDay
    )
  }

  async function saveLeave() {
    const customMinutes = leaveKind === 'custom' ? Math.round(Number(leaveMinutes) * 60) : null
    if (
      leaveKind === 'custom' &&
      (!Number.isFinite(customMinutes) || customMinutes! < 1 || customMinutes! > 1440)
    ) {
      setError('مدت مرخصی باید بین یک دقیقه تا ۲۴ ساعت باشد.')
      return
    }
    if (leaveRangeMode && (!leaveStartDate || !leaveEndDate)) {
      setError('برای مرخصی بازه‌ای، روز آغاز و پایان را در تقویم انتخاب کنید.')
      return
    }
    const startWorkDate = leaveRangeMode ? leaveStartDate! : selectedDate
    const endWorkDate = leaveRangeMode ? leaveEndDate! : selectedDate
    const historicalRange = startWorkDate < (data?.currentWorkDate ?? selectedDate)
    await saveAction(
      () =>
        window.karnama.calendar.setLeave({
          startWorkDate,
          endWorkDate,
          leave:
            leaveKind === 'none' ? null : { kind: leaveKind, customMinutes, status: leaveStatus },
          allowHistorical: historicalRange
        }),
      historicalRange
    )
  }

  async function saveBoundary() {
    const boundaryMinutes = minutesFromTime(boundary)
    if (boundaryMinutes === null) {
      setError('ساعت مرز روز کاری را وارد کنید.')
      return
    }
    await saveAction(
      () =>
        window.karnama.calendar.setBoundary({
          workDate: selectedDate,
          boundaryMinutes,
          allowHistorical: isHistoricalDay
        }),
      isHistoricalDay
    )
  }

  async function resetBoundary() {
    await saveAction(
      () =>
        window.karnama.calendar.setBoundary({
          workDate: selectedDate,
          boundaryMinutes: null,
          allowHistorical: isHistoricalDay
        }),
      isHistoricalDay
    )
  }

  return (
    <div className="mx-auto max-w-7xl">
      <PageHeading
        title="تقویم کاری"
        description="تعهدها، ثبت زمان، مرخصی و استثناهای هر Work Date را مرور کنید."
        action={
          <div className="flex items-center gap-2">
            <Button onClick={goToToday} variant="outline" size="sm">
              امروز
            </Button>
            <Button
              aria-label="ماه قبل"
              className="size-9"
              onClick={() => goToMonth(-1)}
              size="icon"
              variant="outline"
            >
              <ChevronRight aria-hidden="true" size={17} />
            </Button>
            <Button
              aria-label="ماه بعد"
              className="size-9"
              onClick={() => goToMonth(1)}
              size="icon"
              variant="outline"
            >
              <ChevronLeft aria-hidden="true" size={17} />
            </Button>
          </div>
        }
      />

      {error && (
        <p
          className="mb-4 flex items-center gap-2 rounded-lg border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          <CircleAlert aria-hidden="true" size={16} />
          {error}
        </p>
      )}

      <div className="mb-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <SummaryCard label="تعهد ماه" value={data ? formatMinutes(data.targetMinutes) : '—'} />
        <SummaryCard label="زمان ثبت‌شده" value={data ? formatMinutes(data.actualMinutes) : '—'} />
        <SummaryCard label="مانده ماه" value={data ? formatMinutes(data.remainingMinutes) : '—'} />
        <SummaryCard
          label="میانگین لازم در روزهای باقی‌مانده"
          value={
            data?.requiredAverageMinutes === null || !data
              ? '—'
              : formatMinutes(data.requiredAverageMinutes)
          }
        />
      </div>

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0">
          <div className="mb-5 flex items-center justify-between gap-4">
            <div className="flex items-center gap-2">
              <CalendarDays aria-hidden="true" className="text-accent" size={18} />
              <h2 className="text-lg font-semibold text-ink">
                {monthLabel(grid.startDate, calendar)}
              </h2>
            </div>
            <p className="text-xs text-muted" aria-live="polite">
              {loading ? 'در حال بارگذاری' : `${data?.workingDays ?? 0} روز دارای تعهد`}
            </p>
          </div>

          <div className="grid grid-cols-7 border-b border-line pb-2 text-center text-xs font-medium text-muted">
            {weekDays.map((day) => (
              <div key={day}>{day}</div>
            ))}
          </div>
          <div className="mt-2 grid grid-cols-7 gap-1.5">
            {grid.days.map((cell) => {
              const summary = data?.days.find((day) => day.workDate === cell.isoDate)
              const selectedCell = selectedDate === cell.isoDate
              const inLeaveRange =
                leaveRangeMode &&
                leaveStartDate !== null &&
                cell.isoDate >= leaveStartDate &&
                cell.isoDate <= (leaveEndDate ?? leaveStartDate)
              return (
                <button
                  aria-label={`${dateLabel(cell.isoDate, calendar)}${summary ? `، تعهد Work Date ${formatMinutes(summary.targetMinutes)}، فعالیت این تاریخ ${formatMinutes(summary.calendarActualMinutes)}` : ''}`}
                  aria-pressed={selectedCell || inLeaveRange}
                  className={`flex min-h-[76px] flex-col items-start rounded-lg border p-2 text-right transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${selectedCell ? 'border-accent bg-accent-soft text-accent-ink' : inLeaveRange ? 'border-success/40 bg-success/10' : `border-transparent ${activityTone(summary?.calendarActualMinutes ?? 0)} hover:border-line hover:bg-subtle`} ${cell.inMonth ? '' : 'opacity-45'} ${summary?.isCurrentWorkDate ? 'ring-1 ring-accent/40' : ''}`}
                  key={cell.isoDate}
                  onClick={() => openDate(cell.isoDate)}
                  type="button"
                >
                  <span className="text-sm font-semibold">
                    {new Intl.NumberFormat('fa-IR').format(cell.day)}
                  </span>
                  {summary && (
                    <span className="mt-auto flex w-full items-center justify-between gap-1 pt-2 text-[10px] text-muted">
                      <span>
                        {summary.calendarActualMinutes
                          ? formatMinutes(summary.calendarActualMinutes)
                          : ''}
                      </span>
                      <span className="flex items-center gap-1">
                        {summary.holiday && (
                          <span
                            className="size-1.5 rounded-full bg-warning"
                            title={summary.holiday.name}
                          />
                        )}
                        {summary.leave?.status === 'approved' && (
                          <span
                            className="size-1.5 rounded-full bg-success"
                            title="مرخصی تأییدشده"
                          />
                        )}
                        {summary.targetMinutes > 0 && (
                          <span
                            className="size-1.5 rounded-full bg-accent"
                            title="روز دارای تعهد"
                          />
                        )}
                      </span>
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 border-t border-line pt-4 text-xs text-muted">
            <Legend color="bg-accent/5" label="فعالیت کمتر" />
            <Legend color="bg-accent/20" label="فعالیت بیشتر" />
            <Legend color="bg-accent" label="روز دارای تعهد" />
            <Legend color="bg-success" label="مرخصی تأییدشده" />
            <Legend color="bg-warning" label="تعطیلی ثبت‌شده" />
          </div>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="mb-4">
              <CardTitle>
                {selectedDate ? dateLabel(selectedDate, calendar) : 'جزئیات روز'}
              </CardTitle>
              <CardDescription>جزئیات این روز بر اساس Work Date و زمان‌های ثبت‌شده</CardDescription>
            </CardHeader>
            {selected ? (
              <>
                <div className="mb-4 grid grid-cols-2 gap-3 rounded-lg bg-subtle p-3 text-center sm:grid-cols-4">
                  <Metric label="تعهد" value={formatMinutes(selected.targetMinutes)} />
                  <Metric
                    label="ثبت‌شده در Work Date"
                    value={formatMinutes(selected.actualMinutes)}
                  />
                  <Metric
                    label="فعالیت تاریخ تقویمی"
                    value={formatMinutes(selected.calendarActualMinutes)}
                  />
                  <Metric label="تراز روز" value={formatMinutes(selected.dailyBalanceMinutes)} />
                </div>
                {selected.isCurrentWorkDate && (
                  <p className="mb-4 text-xs leading-5 text-muted">
                    تراز روز جاری زنده است و تا مرز Work Date نهایی نمی‌شود.
                  </p>
                )}
                {isHistoricalDay && (
                  <p className="mb-4 rounded-md bg-warning/10 px-3 py-2 text-xs leading-5 text-muted">
                    این روز گذشته است؛ ویرایش آن با تأیید شما ثبت می‌شود.
                  </p>
                )}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="text-xs font-medium text-ink" htmlFor="day-target">
                      تعهد روزانه، ساعت
                    </label>
                    <div className="flex gap-2">
                      <Input
                        id="day-target"
                        dir="ltr"
                        inputMode="decimal"
                        min="0"
                        max="24"
                        step="0.25"
                        type="number"
                        placeholder="پیش‌فرض برنامه"
                        value={dayOverride}
                        onChange={(event) => setDayOverride(event.target.value)}
                      />
                      <Button disabled={saving} onClick={() => void saveDayTarget()} size="sm">
                        ذخیره
                      </Button>
                    </div>
                    <p className="text-[11px] leading-5 text-muted">
                      خالی: برنامه هفتگی؛ صفر: روز بدون تعهد.
                    </p>
                  </div>

                  <div className="border-t border-line pt-4">
                    <div className="mb-2 flex items-center justify-between">
                      <label className="text-xs font-medium text-ink" htmlFor="holiday-toggle">
                        تعطیلی این روز
                      </label>
                      <input
                        id="holiday-toggle"
                        checked={isHoliday}
                        onChange={(event) => setIsHoliday(event.target.checked)}
                        type="checkbox"
                        className="size-4 accent-accent"
                      />
                    </div>
                    {isHoliday && (
                      <div className="mb-2 grid grid-cols-[1fr_120px] gap-2">
                        <Input
                          aria-label="نام تعطیلی"
                          value={holidayName}
                          onChange={(event) => setHolidayName(event.target.value)}
                          placeholder="نام تعطیلی"
                        />
                        <Select
                          aria-label="نوع تعطیلی"
                          value={holidayKind}
                          onChange={(event) =>
                            setHolidayKind(event.target.value as 'public' | 'custom')
                          }
                        >
                          <option value="public">عمومی</option>
                          <option value="custom">شخصی</option>
                        </Select>
                      </div>
                    )}
                    <Button
                      className="w-full"
                      disabled={saving}
                      onClick={() => void saveHoliday()}
                      size="sm"
                      variant="outline"
                    >
                      ذخیره تعطیلی
                    </Button>
                  </div>

                  <div className="border-t border-line pt-4">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <label className="text-xs font-medium text-ink" htmlFor="leave-range-mode">
                        مرخصی بازه‌ای
                      </label>
                      <input
                        id="leave-range-mode"
                        checked={leaveRangeMode}
                        onChange={(event) => {
                          const enabled = event.target.checked
                          setLeaveRangeMode(enabled)
                          setLeaveStartDate(enabled ? selectedDate : null)
                          setLeaveEndDate(null)
                        }}
                        type="checkbox"
                        className="size-4 accent-accent"
                      />
                    </div>
                    {leaveRangeMode && (
                      <p className="mb-2 text-[11px] leading-5 text-muted">
                        {leaveStartDate && leaveEndDate
                          ? `از ${dateLabel(leaveStartDate, calendar)} تا ${dateLabel(leaveEndDate, calendar)}`
                          : 'روز آغاز و سپس روز پایان را از تقویم انتخاب کنید.'}
                      </p>
                    )}
                    <label className="mb-2 block text-xs font-medium text-ink" htmlFor="leave-kind">
                      مرخصی
                    </label>
                    <Select
                      id="leave-kind"
                      value={leaveKind}
                      onChange={(event) => setLeaveKind(event.target.value as typeof leaveKind)}
                    >
                      <option value="none">بدون مرخصی</option>
                      <option value="full">تمام‌روز</option>
                      <option value="half">نیم‌روز</option>
                      <option value="custom">مدت دلخواه</option>
                    </Select>
                    {leaveKind !== 'none' && (
                      <div className="mt-2 space-y-2">
                        {leaveKind === 'custom' && (
                          <Input
                            aria-label="مدت مرخصی به ساعت"
                            dir="ltr"
                            inputMode="decimal"
                            min="0.25"
                            max="24"
                            step="0.25"
                            type="number"
                            value={leaveMinutes}
                            onChange={(event) => setLeaveMinutes(event.target.value)}
                            placeholder="مدت به ساعت"
                          />
                        )}
                        <Select
                          aria-label="وضعیت مرخصی"
                          value={leaveStatus}
                          onChange={(event) =>
                            setLeaveStatus(event.target.value as typeof leaveStatus)
                          }
                        >
                          <option value="approved">تأییدشده</option>
                          <option value="pending">در انتظار تأیید</option>
                          <option value="rejected">ردشده</option>
                        </Select>
                      </div>
                    )}
                    <Button
                      className="mt-2 w-full"
                      disabled={saving}
                      onClick={() => void saveLeave()}
                      size="sm"
                      variant="outline"
                    >
                      ذخیره مرخصی
                    </Button>
                  </div>

                  <div className="border-t border-line pt-4">
                    <label className="mb-2 block text-xs font-medium text-ink" htmlFor="boundary">
                      مرز Work Date
                    </label>
                    <div className="flex gap-2">
                      <Input
                        id="boundary"
                        dir="ltr"
                        type="time"
                        value={boundary}
                        onChange={(event) => setBoundary(event.target.value)}
                      />
                      <Button
                        disabled={saving}
                        onClick={() => void saveBoundary()}
                        size="sm"
                        variant="outline"
                      >
                        ذخیره
                      </Button>
                    </div>
                    {hasBoundaryOverride && (
                      <Button
                        className="mt-2 w-full"
                        disabled={saving}
                        onClick={() => void resetBoundary()}
                        size="sm"
                        variant="ghost"
                      >
                        بازگشت به مرز پیش‌فرض
                      </Button>
                    )}
                    <p className="mt-1 text-[11px] text-muted">
                      مرز پیش‌فرض {timeFromMinutes(settings.workingHours.workDateBoundaryMinutes)}
                    </p>
                  </div>
                </div>
              </>
            ) : (
              <p className="text-sm text-muted">
                {loading ? 'در حال خواندن جزئیات…' : 'برای نمایش جزئیات، روزی از ماه انتخاب کنید.'}
              </p>
            )}
          </Card>

          <Card>
            <CardHeader className="mb-3">
              <CardTitle>تعهد ماهانه</CardTitle>
              <CardDescription>
                هدف شناور ماه با اضافه‌کار و کمبود روزهای دیگر جبران می‌شود.
              </CardDescription>
            </CardHeader>
            <div className="mb-3 flex items-center gap-2 text-xs text-muted">
              <RotateCcw aria-hidden="true" size={14} />
              {data?.remainingWorkDays ?? 0} روز کاری باقیمانده
            </div>
            {data && data.cumulativeBalanceMinutes !== 0 && (
              <p className="mb-3 text-xs text-muted">
                تراز تجمعی تا روز انتخابی: {formatMinutes(data.cumulativeBalanceMinutes)}
              </p>
            )}
            <label className="mb-2 block text-xs font-medium text-ink" htmlFor="monthly-target">
              هدف ماهانه، ساعت
            </label>
            <div className="flex gap-2">
              <Input
                id="monthly-target"
                dir="ltr"
                inputMode="decimal"
                min="0"
                max="1666"
                step="0.25"
                type="number"
                placeholder="بر اساس برنامه روزها"
                value={monthlyOverride}
                onChange={(event) => setMonthlyOverride(event.target.value)}
              />
              <Button disabled={saving} onClick={() => void saveMonthlyTarget()} size="sm">
                ذخیره
              </Button>
            </div>
            <p className="mt-2 text-[11px] leading-5 text-muted">
              خالی: جمع برنامه روزهای ماه. تعهد روزانه جداگانه حفظ می‌شود.
            </p>
          </Card>
        </div>
      </div>

      {selected && (
        <Card className="mt-5">
          <CardHeader className="mb-4">
            <CardTitle>فعالیت در تاریخ تقویمی</CardTitle>
            <CardDescription>
              بازه‌های هر جلسه بر اساس تاریخ محلی ثبت‌شده نمایش داده می‌شوند؛ تعهد در بخش بالا بر
              اساس Work Date است.
            </CardDescription>
          </CardHeader>
          {selected.calendarSessions.length === 0 ? (
            <p className="text-sm text-muted">برای این تاریخ تقویمی جلسه‌ای ثبت نشده است.</p>
          ) : (
            <ul className="divide-y divide-line">
              {selected.calendarSessions.map((session) => (
                <li
                  className="flex items-center justify-between gap-4 py-3 first:pt-0 last:pb-0"
                  key={`calendar-${session.id}-${session.startUtcMs}`}
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-ink">
                      {session.taskTitle || 'بدون تسک'}
                    </p>
                    <p className="mt-1 flex items-center gap-1 text-xs text-muted">
                      <Clock3 aria-hidden="true" size={13} />
                      {formatClock(session.startUtcMs, session.timeZoneId)} –{' '}
                      {formatClock(session.endUtcMs, session.timeZoneId)}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-semibold text-ink">
                    {formatMinutes(session.durationMinutes)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          {selected.sessions.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <h3 className="mb-2 text-xs font-semibold text-muted">
                جلسه‌های منتسب به این Work Date ({selected.sessions.length})
              </h3>
              <ul className="space-y-2">
                {selected.sessions.map((session) => (
                  <li
                    className="flex items-center justify-between gap-3 text-xs text-muted"
                    key={`work-${session.id}-${session.startUtcMs}`}
                  >
                    <span className="truncate">{session.taskTitle || 'بدون تسک'}</span>
                    <span dir="ltr">{formatMinutes(session.durationMinutes)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  )
}

function SummaryCard({ label, value }: { label: string; value: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-2 text-xl font-bold tabular-nums text-ink" dir="ltr">
        {value}
      </p>
    </Card>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] text-muted">{label}</p>
      <p className="mt-1 text-sm font-semibold tabular-nums text-ink" dir="ltr">
        {value}
      </p>
    </div>
  )
}

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`size-2 rounded-full ${color}`} />
      {label}
    </span>
  )
}
