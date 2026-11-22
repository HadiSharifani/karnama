import { describe, expect, it } from 'vitest'
import {
  allocateSessionByCalendarDate,
  allocateSessionByBoundary,
  allocateSessionManually,
  localDateTimeCandidates,
  localDateTimeToUtc,
  workDateAtInstant
} from '../../src/shared/domain/work-time'

describe('Work Date time rules', () => {
  it('uses the configured zone and assigns instants before 06:00 to the prior Work Date', () => {
    const beforeBoundary = Date.UTC(2026, 10, 21, 1, 0)
    const atBoundary = Date.UTC(2026, 10, 21, 2, 30)

    expect(workDateAtInstant(beforeBoundary, 'Asia/Tehran', 360)).toBe('2026-11-20')
    expect(workDateAtInstant(atBoundary, 'Asia/Tehran', 360)).toBe('2026-11-21')
  })

  it('splits boundary allocations without changing or losing elapsed milliseconds', () => {
    const start = Date.UTC(2026, 10, 21, 0, 0)
    const end = Date.UTC(2026, 10, 21, 4, 0)
    const allocations = allocateSessionByBoundary(start, end, 'Asia/Tehran', 360)

    expect(allocations).toEqual([
      {
        segmentIndex: 0,
        startUtcMs: start,
        endUtcMs: Date.UTC(2026, 10, 21, 2, 30),
        workDate: '2026-11-20',
        source: 'boundary'
      },
      {
        segmentIndex: 1,
        startUtcMs: Date.UTC(2026, 10, 21, 2, 30),
        endUtcMs: end,
        workDate: '2026-11-21',
        source: 'boundary'
      }
    ])
    expect(
      allocations.reduce(
        (total, allocation) => total + allocation.endUtcMs - allocation.startUtcMs,
        0
      )
    ).toBe(end - start)
  })

  it('uses date-specific Work Date boundaries for future allocations', () => {
    const allocations = allocateSessionByBoundary(
      Date.UTC(2026, 10, 21, 7),
      Date.UTC(2026, 10, 21, 9),
      'UTC',
      360,
      (date) => (date === '2026-11-21' ? 480 : 360)
    )
    expect(allocations).toEqual([
      {
        segmentIndex: 0,
        startUtcMs: Date.UTC(2026, 10, 21, 7),
        endUtcMs: Date.UTC(2026, 10, 21, 8),
        workDate: '2026-11-20',
        source: 'boundary'
      },
      {
        segmentIndex: 1,
        startUtcMs: Date.UTC(2026, 10, 21, 8),
        endUtcMs: Date.UTC(2026, 10, 21, 9),
        workDate: '2026-11-21',
        source: 'boundary'
      }
    ])
  })

  it('splits the calendar timeline at local midnight, including short DST days', () => {
    const utcTimeline = allocateSessionByCalendarDate(
      Date.UTC(2026, 10, 21, 23, 30),
      Date.UTC(2026, 10, 22, 1),
      'UTC'
    )
    expect(
      utcTimeline.map(({ calendarDate, endUtcMs, startUtcMs }) => [
        calendarDate,
        (endUtcMs - startUtcMs) / 60_000
      ])
    ).toEqual([
      ['2026-11-21', 30],
      ['2026-11-22', 60]
    ])

    const dstStart = localDateTimeToUtc('2026-03-08', '00:00', 'America/New_York', null)
    const nextDay = localDateTimeToUtc('2026-03-09', '00:00', 'America/New_York', null)
    const shortDay = allocateSessionByCalendarDate(dstStart, nextDay, 'America/New_York')
    expect(shortDay).toHaveLength(1)
    expect(shortDay[0].calendarDate).toBe('2026-03-08')
    expect(shortDay[0].endUtcMs - shortDay[0].startUtcMs).toBe(23 * 60 * 60 * 1000)
  })

  it('requires an explicit choice for ambiguous local time and rejects nonexistent time', () => {
    const repeatedTime = localDateTimeCandidates('2026-11-01', '01:30', 'America/New_York')
    expect(repeatedTime).toHaveLength(2)
    expect(repeatedTime[1] - repeatedTime[0]).toBe(60 * 60 * 1000)
    expect(localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York', 'earlier')).toBe(
      repeatedTime[0]
    )
    expect(localDateTimeToUtc('2026-11-01', '01:30', 'America/New_York', 'later')).toBe(
      repeatedTime[1]
    )
    expect(localDateTimeCandidates('2026-03-08', '02:30', 'America/New_York')).toEqual([])
  })

  it('keeps millisecond precision when resolving an ambiguous local time', () => {
    const earlier = localDateTimeToUtc('2026-11-01', '01:30:12.345', 'America/New_York', 'earlier')
    const later = localDateTimeToUtc('2026-11-01', '01:30:12.345', 'America/New_York', 'later')
    expect(later - earlier).toBe(60 * 60 * 1000)
    expect(earlier % 1000).toBe(345)
    expect(later % 1000).toBe(345)
  })

  it('does not move back to the previous Work Date when an ambiguous boundary repeats', () => {
    const boundary = Date.UTC(2026, 10, 1, 5, 30)
    expect(workDateAtInstant(boundary - 1, 'America/New_York', 90)).toBe('2026-10-31')
    expect(workDateAtInstant(boundary, 'America/New_York', 90)).toBe('2026-11-01')
    expect(workDateAtInstant(Date.UTC(2026, 10, 1, 6, 15), 'America/New_York', 90)).toBe(
      '2026-11-01'
    )
  })

  it('supports a whole-session manual Work Date attribution', () => {
    const start = Date.UTC(2026, 0, 1, 23)
    const end = start + 3 * 60 * 60 * 1000
    expect(allocateSessionManually(start, end, '2026-01-10')).toEqual([
      {
        segmentIndex: 0,
        startUtcMs: start,
        endUtcMs: end,
        workDate: '2026-01-10',
        source: 'manual'
      }
    ])
  })
})
