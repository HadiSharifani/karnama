import { useCallback, useEffect, useState } from 'react'
import type { AnalyticsPeriodDto, AnalyticsPeriodInput } from '@shared/contracts/analytics'
import type { SettingsDto } from '@shared/contracts/settings'
import {
  calendarDateParts,
  isoDateInTimezone,
  shiftCalendarMonth
} from '@shared/domain/calendar-date'
import { unwrapResult } from '@/lib/api'

function currentPeriod(
  calendarMode: SettingsDto['preferences']['calendar'],
  timezoneId: string
): AnalyticsPeriodInput {
  const date = isoDateInTimezone(timezoneId)
  const calendarDate = calendarDateParts(date, calendarMode)
  return {
    calendar: calendarMode,
    year: calendarDate.jy,
    month: calendarDate.jm
  }
}

export function useAnalyticsPeriod(settings: SettingsDto) {
  const calendarMode = settings.preferences.calendar
  const timezoneId = settings.preferences.timezoneId
  const [period, setPeriod] = useState<AnalyticsPeriodInput>(() =>
    currentPeriod(calendarMode, timezoneId)
  )
  const [data, setData] = useState<AnalyticsPeriodDto | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshKey, setRefreshKey] = useState(0)

  useEffect(() => {
    setPeriod(currentPeriod(calendarMode, timezoneId))
  }, [calendarMode, timezoneId])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError('')
    setData(null)
    window.karnama.analytics
      .getPeriod(period)
      .then((result) => {
        if (!cancelled) setData(unwrapResult(result))
      })
      .catch((reason: unknown) => {
        if (!cancelled) {
          setError(reason instanceof Error ? reason.message : 'خواندن تحلیل انجام نشد.')
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [period.calendar, period.year, period.month, refreshKey])

  const changeMonth = useCallback((next: AnalyticsPeriodInput) => setPeriod(next), [])
  const shiftMonth = useCallback((delta: number) => {
    setPeriod((current) => ({
      ...current,
      ...shiftCalendarMonth(current.year, current.month, delta)
    }))
  }, [])
  const reload = useCallback(() => setRefreshKey((key) => key + 1), [])

  return { period, setPeriod: changeMonth, shiftMonth, reload, data, loading, error }
}
