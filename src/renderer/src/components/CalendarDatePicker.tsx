import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { CalendarDays, ChevronLeft, ChevronRight } from 'lucide-react'
import {
  calendarDateParts,
  calendarMonthGrid,
  isoDateInTimezone,
  shiftCalendarMonth,
  type CalendarMode
} from '@shared/domain/calendar-date'
import { addIsoDays } from '@shared/domain/work-time'
import { Button } from '@/components/ui/button'
import { formatCalendarMonth, formatIsoDateLong } from '@/lib/time-format'

const weekdays = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه']

export function CalendarDatePicker({
  value,
  calendar,
  timeZoneId,
  label,
  onChange
}: {
  value: string
  calendar: CalendarMode
  timeZoneId: string
  label: string
  onChange: (isoDate: string) => void
}) {
  const today = isoDateInTimezone(timeZoneId)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const dayRefs = useRef(new Map<string, HTMLButtonElement>())
  const [open, setOpen] = useState(false)
  const [focusedDate, setFocusedDate] = useState(value || today)
  const [visibleMonth, setVisibleMonth] = useState(() => {
    const parts = calendarDateParts(value || today, calendar)
    return { year: parts.jy, month: parts.jm }
  })
  const grid = useMemo(
    () => calendarMonthGrid(visibleMonth.year, visibleMonth.month, calendar),
    [calendar, visibleMonth.month, visibleMonth.year]
  )

  useEffect(() => {
    if (open) dayRefs.current.get(focusedDate)?.focus()
  }, [focusedDate, open])

  function revealDate(date: string) {
    const parts = calendarDateParts(date, calendar)
    setVisibleMonth({ year: parts.jy, month: parts.jm })
    setFocusedDate(date)
  }

  function openPicker() {
    const date = value || today
    const parts = calendarDateParts(date, calendar)
    setVisibleMonth({ year: parts.jy, month: parts.jm })
    setFocusedDate(date)
    setOpen(true)
  }

  function handleDayKeyDown(event: KeyboardEvent<HTMLButtonElement>, date: string) {
    let nextDate: string | null = null
    if (event.key === 'ArrowLeft') nextDate = addIsoDays(date, 1)
    if (event.key === 'ArrowRight') nextDate = addIsoDays(date, -1)
    if (event.key === 'ArrowUp') nextDate = addIsoDays(date, -7)
    if (event.key === 'ArrowDown') nextDate = addIsoDays(date, 7)
    if (event.key === 'Home' || event.key === 'End') {
      const weekdayOffset = (new Date(`${date}T00:00:00Z`).getUTCDay() + 1) % 7
      nextDate = addIsoDays(date, event.key === 'Home' ? -weekdayOffset : 6 - weekdayOffset)
    }
    if (event.key === 'PageUp' || event.key === 'PageDown') {
      const parts = calendarDateParts(date, calendar)
      const monthDelta = (event.key === 'PageUp' ? -1 : 1) * (event.shiftKey ? 12 : 1)
      const targetMonth = shiftCalendarMonth(parts.jy, parts.jm, monthDelta)
      const targetGrid = calendarMonthGrid(targetMonth.year, targetMonth.month, calendar)
      nextDate = targetGrid.days.find((day) => day.inMonth && day.day === parts.jd)?.isoDate ?? null
    }
    if (event.key === 'Escape') {
      setOpen(false)
      triggerRef.current?.focus()
      event.preventDefault()
      return
    }
    if (nextDate) {
      event.preventDefault()
      revealDate(nextDate)
    }
  }

  function moveMonth(delta: number) {
    const parts = calendarDateParts(focusedDate, calendar)
    const next = shiftCalendarMonth(parts.jy, parts.jm, delta)
    const nextGrid = calendarMonthGrid(next.year, next.month, calendar)
    const nextDate =
      nextGrid.days.find((day) => day.inMonth && day.day === parts.jd)?.isoDate ??
      nextGrid.startDate
    setVisibleMonth(next)
    setFocusedDate(nextDate)
  }

  const chunks = Array.from({ length: grid.days.length / 7 }, (_, row) =>
    grid.days.slice(row * 7, row * 7 + 7)
  )

  return (
    <div className="relative">
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-label={`${label}: ${value ? formatIsoDateLong(value, calendar) : 'انتخاب نشده'}`}
        className="flex h-11 w-full items-center justify-between gap-3 rounded-lg border border-line bg-panel px-3.5 text-sm text-ink outline-none transition-colors hover:bg-subtle focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/20"
        onClick={() => (open ? setOpen(false) : openPicker())}
        ref={triggerRef}
        type="button"
      >
        <span className={value ? '' : 'text-muted'}>
          {value ? formatIsoDateLong(value, calendar) : 'انتخاب تاریخ'}
        </span>
        <CalendarDays aria-hidden="true" className="shrink-0 text-muted" size={16} />
      </button>
      {open && (
        <div
          aria-label="انتخاب تاریخ"
          className="absolute z-30 mt-2 w-[min(21rem,calc(100vw-2rem))] rounded-xl border border-line bg-panel p-3 shadow-lg"
          dir="rtl"
          role="dialog"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <Button aria-label="ماه قبل" onClick={() => moveMonth(-1)} size="icon" variant="ghost">
              <ChevronRight aria-hidden="true" size={16} />
            </Button>
            <p aria-live="polite" className="text-sm font-semibold text-ink">
              {formatCalendarMonth(visibleMonth.year, visibleMonth.month, calendar)}
            </p>
            <Button aria-label="ماه بعد" onClick={() => moveMonth(1)} size="icon" variant="ghost">
              <ChevronLeft aria-hidden="true" size={16} />
            </Button>
          </div>
          <div
            aria-label="روزهای هفته"
            className="grid grid-cols-7 text-center text-[11px] text-muted"
            role="row"
          >
            {weekdays.map((day) => (
              <span className="py-1" key={day} role="columnheader">
                {day.slice(0, 1)}
              </span>
            ))}
          </div>
          <div
            aria-label={formatCalendarMonth(visibleMonth.year, visibleMonth.month, calendar)}
            className="grid grid-cols-7 gap-1"
            role="grid"
          >
            {chunks.map((week, row) => (
              <div className="contents" key={row} role="row">
                {week.map((day) => {
                  const selected = day.isoDate === value
                  const isToday = day.isoDate === today
                  return (
                    <div aria-selected={selected} key={day.isoDate} role="gridcell">
                      <button
                        aria-current={isToday ? 'date' : undefined}
                        aria-label={formatIsoDateLong(day.isoDate, calendar)}
                        aria-pressed={selected}
                        className={`grid size-9 place-items-center rounded-lg text-sm tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${selected ? 'bg-accent text-accent-foreground' : isToday ? 'ring-1 ring-accent text-accent-ink' : 'text-ink hover:bg-subtle'} ${day.inMonth ? '' : 'text-muted/60'}`}
                        onClick={() => {
                          onChange(day.isoDate)
                          setOpen(false)
                          triggerRef.current?.focus()
                        }}
                        onKeyDown={(event) => handleDayKeyDown(event, day.isoDate)}
                        ref={(element) => {
                          if (element) dayRefs.current.set(day.isoDate, element)
                          else dayRefs.current.delete(day.isoDate)
                        }}
                        tabIndex={focusedDate === day.isoDate ? 0 : -1}
                        type="button"
                      >
                        {new Intl.NumberFormat('fa-IR').format(day.day)}
                      </button>
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
          <div className="mt-3 flex justify-between border-t border-line pt-2">
            <Button
              onClick={() => {
                revealDate(today)
                onChange(today)
                setOpen(false)
                triggerRef.current?.focus()
              }}
              size="sm"
              variant="ghost"
            >
              امروز
            </Button>
            <Button onClick={() => setOpen(false)} size="sm" variant="ghost">
              بستن
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
