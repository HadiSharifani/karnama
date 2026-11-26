import { describe, expect, it } from 'vitest'
import { formatInstant, isValidTime24 } from '../../src/renderer/src/lib/time-format'

describe('time formatting', () => {
  it('formats instants with an explicit 24-hour clock', () => {
    const value = formatInstant(Date.UTC(2026, 10, 24, 14, 45), 'Asia/Tehran')
    expect(value).toContain('18:15')
    expect(value).not.toMatch(/AM|PM|ق\.ظ|ب\.ظ/i)
  })

  it('accepts only valid HH:mm input', () => {
    expect(isValidTime24('09:30')).toBe(true)
    expect(isValidTime24('23:59')).toBe(true)
    expect(isValidTime24('24:00')).toBe(false)
    expect(isValidTime24('12:60')).toBe(false)
    expect(isValidTime24('9:30')).toBe(false)
  })
})
