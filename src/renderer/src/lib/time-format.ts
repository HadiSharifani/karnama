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
    timeZone: timeZoneId
  }).format(instantUtcMs)
}

export function formatIsoDate(isoDate: string, calendar: 'jalali' | 'gregorian') {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(0)
  date.setUTCFullYear(year, month - 1, day)
  date.setUTCHours(0, 0, 0, 0)
  const locale = calendar === 'jalali' ? 'fa-IR-u-ca-persian-nu-latn' : 'fa-IR-u-ca-gregory-nu-latn'
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(date)
}
