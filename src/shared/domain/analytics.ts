export type TimedInterval = {
  startUtcMs: number
  endUtcMs: number
  timeZoneId: string
}

export function localHourMilliseconds(intervals: TimedInterval[]) {
  const totalByHour = Array<number>(24).fill(0)
  const formatters = new Map<string, Intl.DateTimeFormat>()

  for (const interval of intervals) {
    if (!Number.isFinite(interval.startUtcMs) || interval.endUtcMs <= interval.startUtcMs) continue
    let formatter = formatters.get(interval.timeZoneId)
    if (!formatter) {
      formatter = new Intl.DateTimeFormat('en-GB', {
        timeZone: interval.timeZoneId,
        hour: '2-digit',
        hourCycle: 'h23'
      })
      formatters.set(interval.timeZoneId, formatter)
    }

    let cursor = interval.startUtcMs
    while (cursor < interval.endUtcMs) {
      const nextMinute = Math.floor(cursor / 60_000) * 60_000 + 60_000
      const next = Math.min(interval.endUtcMs, nextMinute)
      const hour = Number(
        formatter.formatToParts(cursor).find((part) => part.type === 'hour')?.value
      )
      if (Number.isInteger(hour) && hour >= 0 && hour < 24) {
        totalByHour[hour] += next - cursor
      }
      cursor = next
    }
  }

  return totalByHour
}

export function averagePerScheduledDay(
  days: Array<{ actualMinutes: number; targetMinutes: number }>
) {
  const scheduledDays = days.filter((day) => day.targetMinutes > 0)
  if (!scheduledDays.length) return null
  return Math.floor(
    scheduledDays.reduce((sum, day) => sum + day.actualMinutes, 0) / scheduledDays.length
  )
}

export function compareActualMinutes(currentMinutes: number, previousMinutes: number) {
  return {
    changeMinutes: currentMinutes - previousMinutes,
    changePercent:
      previousMinutes === 0
        ? null
        : Math.round(((currentMinutes - previousMinutes) / previousMinutes) * 100)
  }
}
