export function formatDuration(durationMs: number, withSeconds = false) {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  return withSeconds
    ? `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
    : `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function formatInstant(
  instantUtcMs: number,
  timeZoneId: string,
  calendar: 'jalali' | 'gregorian' = 'jalali'
) {
  const locale = calendar === 'jalali' ? 'fa-IR-u-ca-persian-nu-latn' : 'fa-IR-u-ca-gregory-nu-latn'
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    hourCycle: 'h23',
    timeZone: timeZoneId
  }).format(instantUtcMs)
}

export function isValidTime24(value: string) {
  return /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value)
}

export function formatIsoDate(isoDate: string, calendar: CalendarMode) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  const locale = calendar === 'jalali' ? 'fa-IR-u-ca-persian-nu-latn' : 'fa-IR-u-ca-gregory-nu-latn'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}
import { calendarMonthRange, type CalendarMode } from '@shared/domain/calendar-date'

export function formatIsoDateLong(isoDate: string, calendar: CalendarMode) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(12, 0, 0, 0)
  const locale = calendar === 'jalali' ? 'fa-IR-u-ca-persian' : 'fa-IR-u-ca-gregory'
  return new Intl.DateTimeFormat(locale, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date)
}

export function formatIsoDateShort(isoDate: string, calendar: CalendarMode) {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(12, 0, 0, 0)
  const locale = calendar === 'jalali' ? 'fa-IR-u-ca-persian' : 'fa-IR-u-ca-gregory'
  return new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC'
  }).format(date)
}

export function formatCalendarMonth(year: number, month: number, calendar: CalendarMode) {
  const range = calendarMonthRange(year, month, calendar)
  const date = new Date(`${range.startDate}T12:00:00Z`)
  const locale = calendar === 'jalali' ? 'fa-IR-u-ca-persian' : 'fa-IR-u-ca-gregory'
  return new Intl.DateTimeFormat(locale, {
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(date)
}
