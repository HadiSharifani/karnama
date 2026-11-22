export type WorkDateAllocation = {
  segmentIndex: number
  startUtcMs: number
  endUtcMs: number
  workDate: string
  source: 'boundary' | 'manual'
}

type LocalParts = {
  year: number
  month: number
  day: number
  hour: number
  minute: number
  second: number
  millisecond: number
}

const hourMs = 60 * 60 * 1000

function utcFromParts(parts: LocalParts) {
  const date = new Date(0)
  date.setUTCFullYear(parts.year, parts.month - 1, parts.day)
  date.setUTCHours(parts.hour, parts.minute, parts.second, parts.millisecond)
  return date.getTime()
}

function localPartsAt(instantUtcMs: number, timeZoneId: string): LocalParts {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    calendar: 'gregory',
    timeZone: timeZoneId,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
    fractionalSecondDigits: 3
  }).formatToParts(instantUtcMs)
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]))
  return {
    year: Number(values.year),
    month: Number(values.month),
    day: Number(values.day),
    hour: Number(values.hour),
    minute: Number(values.minute),
    second: Number(values.second),
    millisecond: Number(values.fractionalSecond)
  }
}

function isSameLocalDateTime(actual: LocalParts, wanted: LocalParts) {
  return (
    actual.year === wanted.year &&
    actual.month === wanted.month &&
    actual.day === wanted.day &&
    actual.hour === wanted.hour &&
    actual.minute === wanted.minute &&
    actual.second === wanted.second &&
    actual.millisecond === wanted.millisecond
  )
}

function parseLocalDateTime(date: string, time: string): LocalParts {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date)
  const timeMatch = /^([01]\d|2[0-3]):([0-5]\d)(?::([0-5]\d)(?:\.(\d{1,3}))?)?$/.exec(time)
  if (!dateMatch || !timeMatch) throw new Error('تاریخ یا ساعت واردشده معتبر نیست.')

  const parts: LocalParts = {
    year: Number(dateMatch[1]),
    month: Number(dateMatch[2]),
    day: Number(dateMatch[3]),
    hour: Number(timeMatch[1]),
    minute: Number(timeMatch[2]),
    second: Number(timeMatch[3] ?? 0),
    millisecond: Number((timeMatch[4] ?? '').padEnd(3, '0'))
  }
  const dateCheck = new Date(utcFromParts({ ...parts, hour: 0, minute: 0 }))
  if (
    parts.year < 1800 ||
    parts.year > 2256 ||
    dateCheck.getUTCFullYear() !== parts.year ||
    dateCheck.getUTCMonth() + 1 !== parts.month ||
    dateCheck.getUTCDate() !== parts.day
  ) {
    throw new Error('تاریخ میلادی واردشده معتبر نیست.')
  }
  return parts
}

export function localDateTimeCandidates(date: string, time: string, timeZoneId: string): number[] {
  const local = parseLocalDateTime(date, time)
  const wallUtcMs = utcFromParts(local)
  const offsets = new Set<number>()

  for (let delta = -48 * hourMs; delta <= 48 * hourMs; delta += 3 * hourMs) {
    const sampledInstant = wallUtcMs + delta
    const sampledLocal = localPartsAt(sampledInstant, timeZoneId)
    offsets.add(utcFromParts(sampledLocal) - sampledInstant)
  }

  return [...offsets]
    .map((offset) => wallUtcMs - offset)
    .filter((candidate) => isSameLocalDateTime(localPartsAt(candidate, timeZoneId), local))
    .sort((left, right) => left - right)
}

export function localDateTimeToUtc(
  date: string,
  time: string,
  timeZoneId: string,
  occurrence: 'earlier' | 'later' | null
) {
  const candidates = localDateTimeCandidates(date, time, timeZoneId)
  if (candidates.length === 0) throw new Error('این ساعت به‌دلیل تغییر منطقه زمانی وجود ندارد.')
  if (candidates.length > 1 && !occurrence) {
    throw new Error('این ساعت دو بار رخ می‌دهد؛ بار اول یا دوم را انتخاب کنید.')
  }
  return occurrence === 'later' ? candidates.at(-1)! : candidates[0]
}

export function localDayStartUtc(date: string, timeZoneId: string) {
  for (let minuteOffset = 0; minuteOffset <= 180; minuteOffset += 1) {
    const dateOffset = Math.floor(minuteOffset / 1440)
    const minuteOfDay = minuteOffset % 1440
    const candidateDate = addIsoDays(date, dateOffset)
    const time = `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`
    const candidates = localDateTimeCandidates(candidateDate, time, timeZoneId)
    if (candidates.length > 0) return candidates[0]
  }
  throw new Error('آغاز روز تقویمی در این منطقه زمانی پیدا نشد.')
}

function isoDateFromParts({ year, month, day }: LocalParts) {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function addIsoDays(date: string, days: number) {
  const parts = parseLocalDateTime(date, '00:00')
  const utc = utcFromParts({ ...parts, hour: 0, minute: 0 }) + days * 24 * hourMs
  return isoDateFromParts(localPartsAt(utc, 'UTC'))
}

export function workDateAtInstant(
  instantUtcMs: number,
  timeZoneId: string,
  boundaryMinutes: number,
  boundaryForDate: (workDate: string) => number = () => boundaryMinutes
) {
  const localDate = isoDateFromParts(localPartsAt(instantUtcMs, timeZoneId))
  const boundary = boundaryInstantForDate(localDate, boundaryForDate(localDate), timeZoneId)
  return instantUtcMs < boundary ? addIsoDays(localDate, -1) : localDate
}

function boundaryInstantForDate(date: string, boundaryMinutes: number, timeZoneId: string) {
  for (let minuteOffset = 0; minuteOffset <= 180; minuteOffset += 1) {
    const boundaryTotalMinutes = boundaryMinutes + minuteOffset
    const nextDate = addIsoDays(date, Math.floor(boundaryTotalMinutes / 1440))
    const minuteOfDay = boundaryTotalMinutes % 1440
    const time = `${String(Math.floor(minuteOfDay / 60)).padStart(2, '0')}:${String(minuteOfDay % 60).padStart(2, '0')}`
    const candidates = localDateTimeCandidates(nextDate, time, timeZoneId)
    if (candidates.length > 0) return candidates[0]
  }
  throw new Error('مرز روز کاری در این تاریخ به منطقه زمانی تبدیل نشد.')
}

export function allocateSessionByBoundary(
  startUtcMs: number,
  endUtcMs: number,
  timeZoneId: string,
  boundaryMinutes: number,
  boundaryForDate: (workDate: string) => number = () => boundaryMinutes
): WorkDateAllocation[] {
  if (!Number.isInteger(startUtcMs) || !Number.isInteger(endUtcMs) || endUtcMs <= startUtcMs) {
    throw new Error('زمان پایان باید پس از زمان آغاز باشد.')
  }
  if (!Number.isInteger(boundaryMinutes) || boundaryMinutes < 0 || boundaryMinutes > 1439) {
    throw new Error('مرز روز کاری معتبر نیست.')
  }

  const firstLocalDate = isoDateFromParts(localPartsAt(startUtcMs, timeZoneId))
  const lastLocalDate = isoDateFromParts(localPartsAt(endUtcMs - 1, timeZoneId))
  const boundaries: number[] = []
  for (
    let date = addIsoDays(firstLocalDate, -1);
    date <= lastLocalDate;
    date = addIsoDays(date, 1)
  ) {
    const dateBoundary = boundaryForDate(date)
    if (!Number.isInteger(dateBoundary) || dateBoundary < 0 || dateBoundary > 1439) {
      throw new Error('مرز روز کاری معتبر نیست.')
    }
    const boundary = boundaryInstantForDate(date, dateBoundary, timeZoneId)
    if (boundary > startUtcMs && boundary < endUtcMs) boundaries.push(boundary)
  }

  const points = [startUtcMs, ...boundaries.sort((left, right) => left - right), endUtcMs]
  return points.slice(0, -1).map((start, segmentIndex) => {
    const end = points[segmentIndex + 1]
    return {
      segmentIndex,
      startUtcMs: start,
      endUtcMs: end,
      workDate: workDateAtInstant(start, timeZoneId, boundaryMinutes, boundaryForDate),
      source: 'boundary'
    }
  })
}

export function allocateSessionManually(
  startUtcMs: number,
  endUtcMs: number,
  workDate: string
): WorkDateAllocation[] {
  if (!Number.isInteger(startUtcMs) || !Number.isInteger(endUtcMs) || endUtcMs <= startUtcMs) {
    throw new Error('زمان پایان باید پس از زمان آغاز باشد.')
  }
  parseLocalDateTime(workDate, '00:00')
  return [{ segmentIndex: 0, startUtcMs, endUtcMs, workDate, source: 'manual' }]
}

export function allocateSessionByCalendarDate(
  startUtcMs: number,
  endUtcMs: number,
  timeZoneId: string
): Array<{ startUtcMs: number; endUtcMs: number; calendarDate: string }> {
  if (!Number.isInteger(startUtcMs) || !Number.isInteger(endUtcMs) || endUtcMs <= startUtcMs) {
    throw new Error('زمان پایان باید پس از زمان آغاز باشد.')
  }
  const firstDate = localDateTimeParts(startUtcMs, timeZoneId).date
  const lastDate = localDateTimeParts(endUtcMs - 1, timeZoneId).date
  const boundaries = new Set<number>()
  for (let date = firstDate; date <= lastDate; date = addIsoDays(date, 1)) {
    const boundary = localDayStartUtc(addIsoDays(date, 1), timeZoneId)
    if (boundary > startUtcMs && boundary < endUtcMs) boundaries.add(boundary)
  }
  const points = [startUtcMs, ...[...boundaries].sort((left, right) => left - right), endUtcMs]
  return points.slice(0, -1).map((start, index) => ({
    startUtcMs: start,
    endUtcMs: points[index + 1],
    calendarDate: localDateTimeParts(start, timeZoneId).date
  }))
}

export function localDateTimeParts(instantUtcMs: number, timeZoneId: string) {
  const parts = localPartsAt(instantUtcMs, timeZoneId)
  return {
    date: isoDateFromParts(parts),
    time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}`
  }
}

export function localDateTimePartsPrecise(instantUtcMs: number, timeZoneId: string) {
  const parts = localPartsAt(instantUtcMs, timeZoneId)
  return {
    date: isoDateFromParts(parts),
    time: `${String(parts.hour).padStart(2, '0')}:${String(parts.minute).padStart(2, '0')}:${String(parts.second).padStart(2, '0')}.${String(parts.millisecond).padStart(3, '0')}`
  }
}
