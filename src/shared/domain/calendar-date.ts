import { jalaaliMonthLength, toGregorian, toJalaali } from 'jalaali-js'
import { addIsoDays } from './work-time'

export type CalendarMode = 'jalali' | 'gregorian'

export type CalendarDate = {
  isoDate: string
  day: number
  inMonth: boolean
}

export type CalendarMonth = {
  calendar: CalendarMode
  year: number
  month: number
  periodKey: string
  startDate: string
  endDate: string
  days: CalendarDate[]
}

export function isoDateInTimezone(timeZoneId: string, instantUtcMs = Date.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timeZoneId,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instantUtcMs)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return `${values.year}-${values.month}-${values.day}`
}

const gregorianMonthLengths = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

function isoDate(year: number, month: number, day: number) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function weekdayIndexSaturdayFirst(date: string) {
  const weekday = new Date(`${date}T00:00:00Z`).getUTCDay()
  return (weekday + 1) % 7
}

export function calendarDateParts(date: string, calendar: CalendarMode) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  if (!match) throw new Error('تاریخ میلادی معتبر نیست.')
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  const check = new Date(`${date}T00:00:00Z`)
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() + 1 !== month ||
    check.getUTCDate() !== day
  ) {
    throw new Error('تاریخ میلادی معتبر نیست.')
  }
  return calendar === 'jalali' ? toJalaali(year, month, day) : { jy: year, jm: month, jd: day }
}

export function calendarMonthRange(year: number, month: number, calendar: CalendarMode) {
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('ماه تقویم معتبر نیست.')
  }
  const lastDay =
    calendar === 'jalali'
      ? jalaaliMonthLength(year, month)
      : month === 2 && year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0)
        ? 29
        : gregorianMonthLengths[month - 1]
  const start = calendar === 'jalali' ? toGregorian(year, month, 1) : { gy: year, gm: month, gd: 1 }
  const end =
    calendar === 'jalali' ? toGregorian(year, month, lastDay) : { gy: year, gm: month, gd: lastDay }
  return {
    calendar,
    year,
    month,
    periodKey: `${calendar}:${year}-${String(month).padStart(2, '0')}`,
    startDate: isoDate(start.gy, start.gm, start.gd),
    endDate: isoDate(end.gy, end.gm, end.gd)
  }
}

export function calendarMonthGrid(
  year: number,
  month: number,
  calendar: CalendarMode
): CalendarMonth {
  const range = calendarMonthRange(year, month, calendar)
  const leadingDays = weekdayIndexSaturdayFirst(range.startDate)
  const cellCount =
    Math.ceil(
      (leadingDays +
        (Date.parse(`${range.endDate}T00:00:00Z`) - Date.parse(`${range.startDate}T00:00:00Z`)) /
          86_400_000 +
        1) /
        7
    ) * 7
  const firstDate = addIsoDays(range.startDate, -leadingDays)
  const days: CalendarDate[] = Array.from({ length: cellCount }, (_, index) => {
    const date = addIsoDays(firstDate, index)
    return {
      isoDate: date,
      day: calendarDateParts(date, calendar).jd,
      inMonth: date >= range.startDate && date <= range.endDate
    }
  })
  return { ...range, days }
}

export function shiftCalendarMonth(year: number, month: number, delta: number) {
  const absolute = year * 12 + month - 1 + delta
  return { year: Math.floor(absolute / 12), month: (((absolute % 12) + 12) % 12) + 1 }
}
