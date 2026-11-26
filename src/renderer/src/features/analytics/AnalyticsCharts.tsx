import { useId, useState, type KeyboardEvent } from 'react'
import type { AnalyticsPeriodDto } from '@shared/contracts/analytics'
import { calendarDateParts } from '@shared/domain/calendar-date'
import { formatIsoDateShort, formatCalendarMonth } from '@/lib/time-format'

const weekDays = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']
const weekDayNames = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه']

export function DailyWorkHoursChart({ data }: { data: AnalyticsPeriodDto }) {
  const tooltip = useChartTooltip()
  const days = data.days
  const maxMinutes = Math.max(60, ...days.flatMap((day) => [day.actualMinutes, day.targetMinutes]))
  const width = 760
  const height = 200
  const chartTop = 12
  const chartHeight = 142
  const chartWidth = width - 28
  const groupWidth = chartWidth / Math.max(1, days.length)

  if (!days.some((day) => day.actualMinutes > 0)) {
    return <ChartEmpty>در این ماه زمانی ثبت نشده است.</ChartEmpty>
  }

  return (
    <div className="min-w-0" onPointerLeave={tooltip.leave}>
      <ChartTooltip id={tooltip.id} value={tooltip.value} />
      <div className="mb-3 flex gap-5 text-xs text-muted" aria-hidden="true">
        <span className="flex items-center gap-2">
          <i className="size-2.5 rounded-sm bg-accent" /> زمان ثبت‌شده
        </span>
        <span className="flex items-center gap-2">
          <i className="size-2.5 rounded-sm bg-line" /> تعهد روز
        </span>
      </div>
      <svg
        aria-label="مقایسه ساعت ثبت‌شده و تعهد روزانه در ماه"
        className="h-auto w-full overflow-visible"
        role="group"
        viewBox={`0 0 ${width} ${height}`}
      >
        {[0, 0.5, 1].map((fraction) => {
          const y = chartTop + chartHeight * (1 - fraction)
          return (
            <line
              key={fraction}
              x1="12"
              x2={width - 12}
              y1={y}
              y2={y}
              stroke="var(--line)"
              strokeDasharray={fraction === 0 ? undefined : '3 5'}
            />
          )
        })}
        {days.map((day, index) => {
          const x = 14 + index * groupWidth
          const targetHeight = (day.targetMinutes / maxMinutes) * chartHeight
          const actualHeight = (day.actualMinutes / maxMinutes) * chartHeight
          const barWidth = Math.max(2, Math.min(10, groupWidth * 0.34))
          const dayNumber = calendarDateParts(day.workDate, data.period.calendar).jd
          return (
            <g
              aria-describedby={tooltip.id}
              aria-label={`${formatDate(day.workDate, data.period.calendar)}: زمان ثبت‌شده ${formatDurationValue(day.actualMinutes)}، تعهد روز ${formatDurationValue(day.targetMinutes)}`}
              key={day.workDate}
              onBlur={tooltip.leave}
              onClick={() =>
                tooltip.toggle(
                  day.workDate,
                  `${formatDate(day.workDate, data.period.calendar)}: ثبت‌شده ${formatDurationValue(day.actualMinutes)}، تعهد ${formatDurationValue(day.targetMinutes)}`
                )
              }
              onFocus={() =>
                tooltip.show(
                  day.workDate,
                  `${formatDate(day.workDate, data.period.calendar)}: ثبت‌شده ${formatDurationValue(day.actualMinutes)}، تعهد ${formatDurationValue(day.targetMinutes)}`
                )
              }
              onKeyDown={(event: KeyboardEvent<SVGGElement>) =>
                activateSvgPoint(
                  event,
                  () =>
                    tooltip.toggle(
                      day.workDate,
                      `${formatDate(day.workDate, data.period.calendar)}: ثبت‌شده ${formatDuration(day.actualMinutes)}، تعهد ${formatDuration(day.targetMinutes)}`
                    ),
                  tooltip.dismiss
                )
              }
              onPointerEnter={() =>
                tooltip.show(
                  day.workDate,
                  `${formatDate(day.workDate, data.period.calendar)}: ثبت‌شده ${formatDurationValue(day.actualMinutes)}، تعهد ${formatDurationValue(day.targetMinutes)}`
                )
              }
              onPointerLeave={tooltip.leave}
              role="button"
              tabIndex={0}
            >
              <title>
                {formatDate(day.workDate, data.period.calendar)}: ثبت‌شده{' '}
                {formatDurationValue(day.actualMinutes)}، تعهد{' '}
                {formatDurationValue(day.targetMinutes)}
              </title>
              <rect
                x={x + groupWidth * 0.12}
                y={chartTop + chartHeight - targetHeight}
                width={barWidth}
                height={targetHeight}
                rx="2"
                fill="var(--line)"
              />
              <rect
                x={x + groupWidth * 0.53}
                y={chartTop + chartHeight - actualHeight}
                width={barWidth}
                height={actualHeight}
                rx="2"
                fill="var(--accent)"
              />
              {(dayNumber === 1 || dayNumber % 5 === 0) && (
                <text
                  x={x + groupWidth / 2}
                  y={chartTop + chartHeight + 20}
                  textAnchor="middle"
                  fill="var(--ink-soft)"
                  fontSize="11"
                >
                  {toPersianDigits(dayNumber)}
                </text>
              )}
              <rect
                x={x}
                y={chartTop}
                width={groupWidth}
                height={chartHeight}
                fill="transparent"
                pointerEvents="all"
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function MonthlyActivityHeatmap({ data }: { data: AnalyticsPeriodDto }) {
  const tooltip = useChartTooltip()
  const first = data.days[0]
  const offset = first ? (first.weekdayIso + 1) % 7 : 0
  const maxMinutes = Math.max(1, ...data.days.map((day) => day.actualMinutes))
  const cells = [...Array(offset).fill(null), ...data.days]

  return (
    <div onPointerLeave={tooltip.leave}>
      <ChartTooltip id={tooltip.id} value={tooltip.value} />
      <div className="grid grid-cols-7 gap-1.5 text-center text-[11px] text-muted">
        {weekDays.map((label, index) => (
          <span key={label} aria-label={weekDayNames[index]}>
            {label}
          </span>
        ))}
      </div>
      <div className="mt-2 grid grid-cols-7 gap-1.5">
        {cells.map((day, index) => {
          if (!day)
            return <span aria-hidden="true" className="aspect-square" key={`blank-${index}`} />
          const intensity =
            day.actualMinutes > 0
              ? Math.max(
                  14,
                  Math.round((day.actualMinutes / Math.max(day.targetMinutes, maxMinutes)) * 82)
                )
              : 0
          const dayNumber = calendarDateParts(day.workDate, data.period.calendar).jd
          return (
            <button
              aria-label={`${formatDate(day.workDate, data.period.calendar)}، زمان ثبت‌شده ${formatDurationValue(day.actualMinutes)}، تعهد ${formatDurationValue(day.targetMinutes)}`}
              aria-describedby={tooltip.id}
              className={`grid aspect-square w-full place-items-center rounded-lg text-xs tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${day.isCurrentWorkDate ? 'ring-2 ring-focus ring-offset-2 ring-offset-panel' : ''}`}
              key={day.workDate}
              onBlur={tooltip.leave}
              onClick={() =>
                tooltip.toggle(
                  day.workDate,
                  `${formatDate(day.workDate, data.period.calendar)} · ثبت‌شده ${formatDurationValue(day.actualMinutes)} · تعهد ${formatDurationValue(day.targetMinutes)}`
                )
              }
              onFocus={() =>
                tooltip.show(
                  day.workDate,
                  `${formatDate(day.workDate, data.period.calendar)} · ثبت‌شده ${formatDurationValue(day.actualMinutes)} · تعهد ${formatDurationValue(day.targetMinutes)}`
                )
              }
              onPointerEnter={() =>
                tooltip.show(
                  day.workDate,
                  `${formatDate(day.workDate, data.period.calendar)} · ثبت‌شده ${formatDurationValue(day.actualMinutes)} · تعهد ${formatDurationValue(day.targetMinutes)}`
                )
              }
              onPointerLeave={tooltip.leave}
              style={{
                backgroundColor:
                  intensity > 0
                    ? `color-mix(in srgb, var(--accent) ${intensity}%, var(--surface-subtle))`
                    : 'var(--surface-subtle)',
                color: intensity > 54 ? 'var(--accent-foreground)' : 'var(--ink-main)'
              }}
              title={`${formatDate(day.workDate, data.period.calendar)} · ${formatDurationValue(day.actualMinutes)} ثبت‌شده`}
              type="button"
            >
              {toPersianDigits(dayNumber)}
            </button>
          )
        })}
      </div>
      <div className="mt-3 flex items-center justify-between text-[11px] text-muted">
        <span>کمتر</span>
        <div className="flex gap-1" aria-hidden="true">
          {[0, 22, 42, 62, 82].map((intensity) => (
            <i
              className="size-3 rounded-sm"
              key={intensity}
              style={{
                backgroundColor:
                  intensity > 0
                    ? `color-mix(in srgb, var(--accent) ${intensity}%, var(--surface-subtle))`
                    : 'var(--surface-subtle)'
              }}
            />
          ))}
        </div>
        <span>بیشتر</span>
      </div>
    </div>
  )
}

export function HourlyDistributionChart({ data }: { data: AnalyticsPeriodDto }) {
  const tooltip = useChartTooltip()
  const max = Math.max(1, ...data.hourlyDistribution.map((item) => item.minutes))
  if (!data.hourlyDistribution.some((item) => item.minutes > 0)) {
    return <ChartEmpty>در این ماه توزیع ساعتی برای نمایش وجود ندارد.</ChartEmpty>
  }
  const width = 760
  const height = 168
  const chartTop = 8
  const chartHeight = 112
  const slot = (width - 22) / data.hourlyDistribution.length

  return (
    <div onPointerLeave={tooltip.leave}>
      <ChartTooltip id={tooltip.id} value={tooltip.value} />
      <svg
        aria-label="توزیع زمان ثبت‌شده بر اساس ساعت محلی جلسه‌ها"
        className="h-auto w-full overflow-visible"
        role="group"
        viewBox={`0 0 ${width} ${height}`}
      >
        <line
          x1="10"
          x2={width - 10}
          y1={chartTop + chartHeight}
          y2={chartTop + chartHeight}
          stroke="var(--line)"
        />
        {data.hourlyDistribution.map((item, index) => {
          const barHeight = (item.minutes / max) * chartHeight
          return (
            <g
              aria-describedby={tooltip.id}
              aria-label={`ساعت ${String(item.hour).padStart(2, '0')}:۰۰ تا ${String(item.hour + 1).padStart(2, '0')}:۰۰، ${formatDurationValue(item.minutes)}`}
              key={item.hour}
              onBlur={tooltip.leave}
              onClick={() =>
                tooltip.toggle(
                  String(item.hour),
                  `ساعت ${toPersianDigits(item.hour)} تا ${toPersianDigits(item.hour + 1)}: ${formatDurationValue(item.minutes)}`
                )
              }
              onFocus={() =>
                tooltip.show(
                  String(item.hour),
                  `ساعت ${toPersianDigits(item.hour)} تا ${toPersianDigits(item.hour + 1)}: ${formatDuration(item.minutes)}`
                )
              }
              onKeyDown={(event: KeyboardEvent<SVGGElement>) =>
                activateSvgPoint(
                  event,
                  () =>
                    tooltip.toggle(
                      String(item.hour),
                      `ساعت ${toPersianDigits(item.hour)} تا ${toPersianDigits(item.hour + 1)}: ${formatDurationValue(item.minutes)}`
                    ),
                  tooltip.dismiss
                )
              }
              onPointerEnter={() =>
                tooltip.show(
                  String(item.hour),
                  `ساعت ${toPersianDigits(item.hour)} تا ${toPersianDigits(item.hour + 1)}: ${formatDurationValue(item.minutes)}`
                )
              }
              onPointerLeave={tooltip.leave}
              role="button"
              tabIndex={0}
            >
              <title>
                ساعت {toPersianDigits(item.hour)} تا {toPersianDigits(item.hour + 1)}:{' '}
                {formatDurationValue(item.minutes)}
              </title>
              <rect
                x={12 + index * slot + slot * 0.2}
                y={chartTop + chartHeight - barHeight}
                width={slot * 0.6}
                height={barHeight}
                rx="3"
                fill="var(--accent)"
              />
              {item.hour % 3 === 0 && (
                <text
                  x={12 + index * slot + slot / 2}
                  y={chartTop + chartHeight + 24}
                  textAnchor="middle"
                  fill="var(--ink-soft)"
                  fontSize="10"
                  direction="ltr"
                >
                  {String(item.hour).padStart(2, '0')}
                </text>
              )}
              <rect
                x={12 + index * slot}
                y={chartTop}
                width={slot}
                height={chartHeight}
                fill="transparent"
                pointerEvents="all"
              />
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function WeekdayDistribution({ data }: { data: AnalyticsPeriodDto }) {
  const tooltip = useChartTooltip()
  const max = Math.max(1, ...data.weekdayDistribution.map((item) => item.minutes))
  return (
    <div className="space-y-3" onPointerLeave={tooltip.leave}>
      <ChartTooltip id={tooltip.id} value={tooltip.value} />
      {data.weekdayDistribution.map((item) => (
        <button
          aria-describedby={tooltip.id}
          aria-label={`${weekDayNames[item.weekdayIso - 1]}، زمان ثبت‌شده ${formatDurationValue(item.minutes)}`}
          className="grid w-full grid-cols-[74px_minmax(0,1fr)_52px] items-center gap-3 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          key={item.weekdayIso}
          onBlur={tooltip.leave}
          onClick={() =>
            tooltip.toggle(
              String(item.weekdayIso),
              `${weekDayNames[item.weekdayIso - 1]}: ${formatDurationValue(item.minutes)} زمان ثبت‌شده`
            )
          }
          onFocus={() =>
            tooltip.show(
              String(item.weekdayIso),
              `${weekDayNames[item.weekdayIso - 1]}: ${formatDurationValue(item.minutes)} زمان ثبت‌شده`
            )
          }
          onPointerEnter={() =>
            tooltip.show(
              String(item.weekdayIso),
              `${weekDayNames[item.weekdayIso - 1]}: ${formatDurationValue(item.minutes)} زمان ثبت‌شده`
            )
          }
          onPointerLeave={tooltip.leave}
          type="button"
        >
          <span className="text-xs text-muted">{weekDayNames[item.weekdayIso - 1]}</span>
          <div className="h-2 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.round((item.minutes / max) * 100)}%` }}
            />
          </div>
          <span className="text-end text-xs tabular-nums text-ink" dir="ltr">
            {formatDuration(item.minutes)}
          </span>
        </button>
      ))}
      {!data.weekdayDistribution.some((item) => item.minutes > 0) && (
        <ChartEmpty>در این ماه زمانی برای روزهای هفته ثبت نشده است.</ChartEmpty>
      )}
    </div>
  )
}

export function MonthlyTrendChart({ data }: { data: AnalyticsPeriodDto }) {
  const tooltip = useChartTooltip()
  const values = data.monthlyTrend.flatMap((item) => [item.actualMinutes, item.targetMinutes])
  const max = Math.max(60, ...values)
  const width = 760
  const height = 205
  const left = 20
  const right = width - 20
  const top = 12
  const bottom = height - 34
  const xStep = (right - left) / Math.max(1, data.monthlyTrend.length - 1)
  const y = (minutes: number) => bottom - (minutes / max) * (bottom - top)
  const actualPoints = data.monthlyTrend
    .map((item, index) => `${left + index * xStep},${y(item.actualMinutes)}`)
    .join(' ')
  const targetPoints = data.monthlyTrend
    .map((item, index) => `${left + index * xStep},${y(item.targetMinutes)}`)
    .join(' ')

  return (
    <div onPointerLeave={tooltip.leave}>
      <ChartTooltip id={tooltip.id} value={tooltip.value} />
      <div className="mb-3 flex gap-5 text-xs text-muted" aria-hidden="true">
        <span className="flex items-center gap-2">
          <i className="size-2.5 rounded-full bg-accent" /> ثبت‌شده
        </span>
        <span className="flex items-center gap-2">
          <i className="size-2.5 rounded-full bg-warning" /> تعهد
        </span>
      </div>
      <svg
        aria-label="روند زمان ثبت‌شده و تعهد در شش ماه"
        className="h-auto w-full overflow-visible"
        role="group"
        viewBox={`0 0 ${width} ${height}`}
      >
        {[0, 0.5, 1].map((fraction) => {
          const lineY = bottom - fraction * (bottom - top)
          return (
            <line
              key={fraction}
              x1={left}
              x2={right}
              y1={lineY}
              y2={lineY}
              stroke="var(--line)"
              strokeDasharray="3 5"
            />
          )
        })}
        <polyline
          points={targetPoints}
          fill="none"
          stroke="var(--warning)"
          strokeWidth="3"
          strokeDasharray="7 6"
        />
        <polyline points={actualPoints} fill="none" stroke="var(--accent)" strokeWidth="3" />
        {data.monthlyTrend.map((item, index) => {
          const x = left + index * xStep
          const label = formatMonth(item.year, item.month, item.calendar)
          return (
            <g
              aria-describedby={tooltip.id}
              aria-label={`${label}: ثبت‌شده ${formatDurationValue(item.actualMinutes)}، تعهد ${formatDurationValue(item.targetMinutes)}`}
              key={item.periodKey}
              onBlur={tooltip.leave}
              onClick={() =>
                tooltip.toggle(
                  item.periodKey,
                  `${label}: ثبت‌شده ${formatDurationValue(item.actualMinutes)}، تعهد ${formatDurationValue(item.targetMinutes)}`
                )
              }
              onFocus={() =>
                tooltip.show(
                  item.periodKey,
                  `${label}: ثبت‌شده ${formatDurationValue(item.actualMinutes)}، تعهد ${formatDurationValue(item.targetMinutes)}`
                )
              }
              onKeyDown={(event: KeyboardEvent<SVGGElement>) =>
                activateSvgPoint(
                  event,
                  () =>
                    tooltip.toggle(
                      item.periodKey,
                      `${label}: ثبت‌شده ${formatDurationValue(item.actualMinutes)}، تعهد ${formatDurationValue(item.targetMinutes)}`
                    ),
                  tooltip.dismiss
                )
              }
              onPointerEnter={() =>
                tooltip.show(
                  item.periodKey,
                  `${label}: ثبت‌شده ${formatDurationValue(item.actualMinutes)}، تعهد ${formatDurationValue(item.targetMinutes)}`
                )
              }
              onPointerLeave={tooltip.leave}
              role="button"
              tabIndex={0}
            >
              <title>
                {label}: ثبت‌شده {formatDurationValue(item.actualMinutes)}، تعهد{' '}
                {formatDurationValue(item.targetMinutes)}
              </title>
              <circle cx={x} cy={y(item.actualMinutes)} r="4" fill="var(--accent)" />
              <circle cx={x} cy={y(item.targetMinutes)} r="3" fill="var(--warning)" />
              <text x={x} y={height - 8} textAnchor="middle" fill="var(--ink-soft)" fontSize="10">
                {label}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

export function TaskDurationChart({ data }: { data: AnalyticsPeriodDto }) {
  const tooltip = useChartTooltip()
  const tasks = data.tasks.filter((task) => task.actualMinutes > 0).slice(0, 7)
  if (!tasks.length) return <ChartEmpty>برای تسک‌ها در این ماه زمانی ثبت نشده است.</ChartEmpty>
  const max = Math.max(1, ...tasks.map((task) => task.actualMinutes))
  return (
    <div className="space-y-3" onPointerLeave={tooltip.leave}>
      <ChartTooltip id={tooltip.id} value={tooltip.value} />
      {tasks.map((task) => (
        <button
          aria-describedby={tooltip.id}
          aria-label={`${task.title}، زمان ثبت‌شده ${formatDurationValue(task.actualMinutes)}`}
          className="grid w-full grid-cols-[minmax(0,1fr)_64px] items-center gap-x-3 gap-y-1 rounded-md text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          key={task.id ?? 'unassigned'}
          onBlur={tooltip.leave}
          onClick={() =>
            tooltip.toggle(
              task.id ?? 'unassigned',
              `${task.title}: ${formatDurationValue(task.actualMinutes)} زمان ثبت‌شده`
            )
          }
          onFocus={() =>
            tooltip.show(
              task.id ?? 'unassigned',
              `${task.title}: ${formatDurationValue(task.actualMinutes)} زمان ثبت‌شده`
            )
          }
          onPointerEnter={() =>
            tooltip.show(
              task.id ?? 'unassigned',
              `${task.title}: ${formatDurationValue(task.actualMinutes)} زمان ثبت‌شده`
            )
          }
          onPointerLeave={tooltip.leave}
          type="button"
        >
          <span className="truncate text-xs font-medium text-ink" title={task.title}>
            {task.title}
          </span>
          <span className="text-end text-xs tabular-nums text-muted" dir="ltr">
            {formatDuration(task.actualMinutes)}
          </span>
          <div className="col-span-2 h-2 overflow-hidden rounded-full bg-subtle">
            <div
              className="h-full rounded-full bg-accent"
              style={{ width: `${Math.round((task.actualMinutes / max) * 100)}%` }}
            />
          </div>
        </button>
      ))}
    </div>
  )
}

export function formatDuration(minutes: number) {
  const formatter = new Intl.NumberFormat('fa-IR', { useGrouping: false })
  const absolute = Math.abs(minutes)
  return `${formatter.format(Math.floor(absolute / 60)).padStart(2, '۰')}:${formatter.format(absolute % 60).padStart(2, '۰')}`
}

function formatDurationValue(minutes: number) {
  const formatter = new Intl.NumberFormat('en', { useGrouping: false })
  const absolute = Math.abs(minutes)
  const hours = Math.floor(absolute / 60)
  const remainder = absolute % 60
  const value =
    hours && remainder
      ? `${formatter.format(hours)} ساعت و ${formatter.format(remainder)} دقیقه`
      : hours
        ? `${formatter.format(hours)} ساعت`
        : `${formatter.format(remainder)} دقیقه`
  return minutes < 0 ? `−${value}` : value
}

export function formatDate(date: string, calendar: 'jalali' | 'gregorian') {
  return formatIsoDateShort(date, calendar)
}

function formatMonth(year: number, month: number, calendar: 'jalali' | 'gregorian') {
  return formatCalendarMonth(year, month, calendar)
}

function toPersianDigits(value: number) {
  return new Intl.NumberFormat('fa-IR', { useGrouping: false }).format(value)
}

function useChartTooltip() {
  const id = useId()
  const [active, setActive] = useState<{ key: string; value: string } | null>(null)
  const [pinned, setPinned] = useState(false)
  return {
    id,
    value: active?.value ?? null,
    show(key: string, value: string) {
      setActive({ key, value })
      setPinned(false)
    },
    toggle(key: string, value: string) {
      if (pinned && active?.key === key) {
        setActive(null)
        setPinned(false)
      } else {
        setActive({ key, value })
        setPinned(true)
      }
    },
    leave() {
      if (!pinned) setActive(null)
    },
    dismiss() {
      setActive(null)
      setPinned(false)
    }
  }
}

function ChartTooltip({ id, value }: { id: string; value: string | null }) {
  return (
    <div
      aria-atomic="true"
      aria-live="polite"
      className={`mb-2 min-h-8 rounded-md bg-subtle px-3 py-2 text-xs leading-5 text-ink ${value ? '' : 'sr-only'}`}
      dir="rtl"
      id={id}
      role="tooltip"
    >
      {value ?? 'برای دیدن مقدار دقیق، روی داده تمرکز کنید یا آن را انتخاب کنید.'}
    </div>
  )
}

function activateSvgPoint(
  event: KeyboardEvent<SVGGElement>,
  activate: () => void,
  dismiss: () => void
) {
  if (event.key === 'Escape') {
    dismiss()
    return
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault()
    activate()
  }
}

function ChartEmpty({ children }: { children: string }) {
  return (
    <p className="grid min-h-36 place-items-center text-center text-sm text-muted">{children}</p>
  )
}
