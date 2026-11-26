import { describe, expect, it } from 'vitest'
import type { WorkSessionDto } from '../../src/shared/contracts/work'
import { localDateTimeToUtc } from '../../src/shared/domain/work-time'
import {
  manualSessionDurationMs,
  manualSessionFormFromSession,
  manualSessionInput,
  manualSessionStartChoices,
  newManualSessionForm
} from '../../src/renderer/src/lib/manual-session'

describe('manual session entry', () => {
  it('converts hours and minutes without seconds and supports zero-hour and over-24-hour entries', () => {
    expect(
      manualSessionDurationMs({
        ...newManualSessionForm('2026-11-21', '09:00'),
        durationHours: '0',
        durationMinutes: '45'
      })
    ).toBe(45 * 60_000)
    expect(
      manualSessionDurationMs({
        ...newManualSessionForm('2026-11-21', '09:00'),
        durationHours: '27',
        durationMinutes: '10'
      })
    ).toBe((27 * 60 + 10) * 60_000)
  })

  it('rejects invalid or negative duration fields', () => {
    const form = newManualSessionForm('2026-11-21', '09:00')
    expect(manualSessionDurationMs({ ...form, durationHours: '-1' })).toBeNull()
    expect(manualSessionDurationMs({ ...form, durationMinutes: '60' })).toBeNull()
    expect(
      manualSessionDurationMs({ ...form, durationHours: '', durationMinutes: '10' })
    ).toBeNull()
    expect(
      manualSessionDurationMs({ ...form, durationHours: '0', durationMinutes: '0' })
    ).toBeNull()
  })

  it('retains existing sub-minute timer precision unless the duration is edited', () => {
    const timeZoneId = 'Asia/Tehran'
    const startUtcMs = localDateTimeToUtc('2026-11-21', '09:00:12.345', timeZoneId, null)
    const durationMs = 37 * 60_000 + 52_345
    const session: WorkSessionDto = {
      id: '91f66715-a838-4ff0-84fe-819bb9e2b521',
      taskId: null,
      taskTitle: null,
      timerRunId: null,
      source: 'timer',
      startUtcMs,
      endUtcMs: startUtcMs + durationMs,
      durationMs,
      timeZoneId,
      allocationMode: 'boundary',
      allocations: []
    }
    const form = manualSessionFormFromSession(session)
    const input = manualSessionInput(form, timeZoneId)
    expect(form.durationHours).toBe('0')
    expect(form.durationMinutes).toBe('37')
    expect(input.startTime).toBe('09:00:12.345')
    expect(input.endTime).toBe('09:38:04.690')

    const edited = manualSessionInput(
      { ...form, durationMinutes: '38', durationRemainderMs: 0 },
      timeZoneId
    )
    expect(
      Date.parse(`1970-01-01T${edited.endTime}Z`) - Date.parse(`1970-01-01T${edited.startTime}Z`)
    ).toBe(38 * 60_000)
  })

  it('requires an explicit choice for a repeated daylight-saving hour and rejects missing local times', () => {
    const repeated = {
      ...newManualSessionForm('2026-11-01', '01:30'),
      durationHours: '0',
      durationMinutes: '30'
    }
    expect(manualSessionStartChoices(repeated, 'America/New_York')).toHaveLength(2)
    expect(() => manualSessionInput(repeated, 'America/New_York')).toThrow(/بار اول یا دوم/)
    expect(
      manualSessionInput({ ...repeated, startOccurrence: 'earlier' }, 'America/New_York')
    ).toMatchObject({
      startOccurrence: 'earlier',
      endOccurrence: 'later'
    })

    const missing = { ...repeated, startDate: '2026-03-08', startTime: '02:30' }
    expect(manualSessionStartChoices(missing, 'America/New_York')).toHaveLength(0)
    expect(() => manualSessionInput(missing, 'America/New_York')).toThrow()
  })
})
