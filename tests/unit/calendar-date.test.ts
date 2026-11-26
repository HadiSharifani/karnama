import { describe, expect, it } from 'vitest'
import {
  calendarDateParts,
  calendarMonthGrid,
  calendarMonthRange,
  isoDateInTimezone
} from '../../src/shared/domain/calendar-date'

describe('calendar date conversion', () => {
  it('converts Nowruz dates and leap-year month lengths accurately', () => {
    expect(calendarDateParts('2024-03-20', 'jalali')).toEqual({ jy: 1403, jm: 1, jd: 1 })
    expect(calendarMonthRange(1403, 1, 'jalali')).toMatchObject({
      startDate: '2024-03-20',
      endDate: '2024-04-19'
    })
    expect(calendarMonthRange(1403, 12, 'jalali')).toMatchObject({
      startDate: '2025-02-19',
      endDate: '2025-03-20'
    })
  })

  it('starts month grids on Saturday and includes complete weeks', () => {
    const grid = calendarMonthGrid(1403, 1, 'jalali')
    expect(grid.days[0].isoDate).toBe('2024-03-16')
    expect(grid.days).toHaveLength(35)
    expect(grid.days.filter((day) => day.inMonth)).toHaveLength(31)
  })

  it('keeps Gregorian months on the same Saturday-first grid', () => {
    const grid = calendarMonthGrid(2024, 2, 'gregorian')
    expect(grid.days.filter((day) => day.inMonth)).toHaveLength(29)
    expect(new Date(`${grid.days[0].isoDate}T00:00:00Z`).getUTCDay()).toBe(6)
  })

  it('derives canonical ISO dates from the configured timezone', () => {
    expect(isoDateInTimezone('Asia/Tehran', Date.UTC(2024, 2, 19, 23, 30))).toBe('2024-03-20')
    expect(isoDateInTimezone('America/Los_Angeles', Date.UTC(2024, 2, 20, 1, 0))).toBe('2024-03-19')
  })
})
