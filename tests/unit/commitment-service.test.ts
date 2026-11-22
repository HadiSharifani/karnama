import { randomUUID } from 'node:crypto'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createCommitmentService,
  CommitmentDomainError
} from '../../src/main/db/commitment-service'
import { openKarnamaDatabase } from '../../src/main/db/client'
import { createSettingsService } from '../../src/main/db/settings-service'
import {
  monthlyCommitments,
  timerRuns,
  workDateAllocations,
  workSessions
} from '../../src/main/db/schema'

const migrationsFolder = resolve(process.cwd(), 'drizzle')
const temporaryDirectories: string[] = []
const currentWorkTime = Date.UTC(2026, 10, 21, 12)

function createDatabase(now = currentWorkTime) {
  const directory = mkdtempSync(join(tmpdir(), 'karnama-commitment-'))
  temporaryDirectories.push(directory)
  const opened = openKarnamaDatabase({
    databasePath: join(directory, 'karnama.sqlite'),
    migrationsFolder,
    timezoneId: 'Asia/Tehran'
  })
  const service = createCommitmentService(opened.database, { now: () => now })
  return { ...opened, service }
}

function currentMonth() {
  return { calendar: 'gregorian' as const, year: 2026, month: 11 }
}

function insertSession(
  database: ReturnType<typeof openKarnamaDatabase>['database'],
  workDate: string,
  startUtcMs: number,
  durationMinutes: number,
  timeZoneId = 'Asia/Tehran'
) {
  const id = randomUUID()
  database
    .insert(workSessions)
    .values({
      id,
      taskId: null,
      timerRunId: null,
      source: 'manual',
      startUtcMs,
      endUtcMs: startUtcMs + durationMinutes * 60_000,
      timeZoneId,
      workDateBoundaryMinutes: 360,
      allocationMode: 'manual',
      createdAtUtcMs: currentWorkTime,
      updatedAtUtcMs: currentWorkTime
    })
    .run()
  database
    .insert(workDateAllocations)
    .values({
      sessionId: id,
      segmentIndex: 0,
      startUtcMs,
      endUtcMs: startUtcMs + durationMinutes * 60_000,
      workDate,
      source: 'manual'
    })
    .run()
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('monthly commitment and work date summaries', () => {
  it('lets surplus and deficit offset at month level while keeping daily balances separate', () => {
    const { database, close, service } = createDatabase()
    try {
      const month = currentMonth()
      service.calendarMonth({ ...month, focusDate: '2026-11-22' })
      insertSession(database, '2026-11-21', Date.UTC(2026, 10, 21, 5), 540)
      insertSession(database, '2026-11-22', Date.UTC(2026, 10, 22, 5), 420)
      service.setMonthlyOverride({ ...month, targetMinutes: 960, allowHistorical: true })

      const summary = service.calendarMonth({ ...month, focusDate: '2026-11-22' })
      expect(summary).toMatchObject({
        targetMinutes: 960,
        actualMinutes: 960,
        remainingMinutes: 0,
        requiredAverageMinutes: null
      })
      expect(summary.cumulativeBalanceMinutes).toBeLessThan(0)
      expect(summary.days.find((day) => day.workDate === '2026-11-21')?.dailyBalanceMinutes).toBe(
        60
      )
      expect(summary.days.find((day) => day.workDate === '2026-11-22')?.dailyBalanceMinutes).toBe(
        -60
      )
    } finally {
      close()
    }
  })

  it('deducts approved half-day leave, ignores pending leave, and expands approved ranges', () => {
    const { close, service } = createDatabase()
    try {
      const month = currentMonth()
      service.calendarMonth({ ...month, focusDate: '2026-11-23' })
      service.setLeave({
        startWorkDate: '2026-11-23',
        endWorkDate: '2026-11-24',
        leave: { kind: 'half', customMinutes: null, status: 'pending' }
      })
      let summary = service.calendarMonth({ ...month, focusDate: '2026-11-24' })
      expect(summary.days.find((day) => day.workDate === '2026-11-23')).toMatchObject({
        targetMinutes: 480,
        approvedLeaveMinutes: 0
      })

      service.setLeave({
        startWorkDate: '2026-11-23',
        endWorkDate: '2026-11-24',
        leave: { kind: 'half', customMinutes: null, status: 'approved' }
      })
      summary = service.calendarMonth({ ...month, focusDate: '2026-11-24' })
      expect(summary.days.find((day) => day.workDate === '2026-11-23')).toMatchObject({
        targetMinutes: 240,
        approvedLeaveMinutes: 240
      })
      expect(summary.days.find((day) => day.workDate === '2026-11-24')).toMatchObject({
        targetMinutes: 240,
        approvedLeaveMinutes: 240
      })
    } finally {
      close()
    }
  })

  it('makes a holiday non-working without discarding actual work', () => {
    const { database, close, service } = createDatabase()
    try {
      const month = currentMonth()
      service.calendarMonth({ ...month, focusDate: '2026-11-22' })
      service.setHoliday({
        workDate: '2026-11-22',
        holiday: { name: 'تعطیلی آزمایشی', kind: 'custom' }
      })
      insertSession(database, '2026-11-22', Date.UTC(2026, 10, 22, 5), 30)
      const summary = service.calendarMonth({ ...month, focusDate: '2026-11-22' })
      expect(summary.days.find((day) => day.workDate === '2026-11-22')).toMatchObject({
        targetMinutes: 0,
        actualMinutes: 30,
        dailyBalanceMinutes: 30,
        holiday: { name: 'تعطیلی آزمایشی', kind: 'custom' }
      })
    } finally {
      close()
    }
  })

  it('keeps Calendar Date activity separate from its stored Work Date allocation', () => {
    const { database, close, service } = createDatabase()
    try {
      const month = currentMonth()
      insertSession(database, '2026-11-21', Date.UTC(2026, 10, 22, 1), 60, 'UTC')
      const summary = service.calendarMonth({ ...month, focusDate: '2026-11-22' })
      expect(summary.days.find((day) => day.workDate === '2026-11-21')).toMatchObject({
        actualMinutes: 60,
        calendarActualMinutes: 0
      })
      expect(summary.days.find((day) => day.workDate === '2026-11-22')).toMatchObject({
        actualMinutes: 0,
        calendarActualMinutes: 60,
        calendarSessions: [{ timeZoneId: 'UTC', durationMinutes: 60 }]
      })
    } finally {
      close()
    }
  })

  it('counts a live timer only in the selected Work Date month while retaining its Calendar Date activity', () => {
    const now = Date.UTC(2026, 10, 1, 0, 30)
    const { database, close, service } = createDatabase(now)
    try {
      database
        .insert(timerRuns)
        .values({
          id: randomUUID(),
          taskId: null,
          status: 'running',
          startedAtUtcMs: Date.UTC(2026, 9, 31, 23, 30),
          currentSegmentStartedAtUtcMs: Date.UTC(2026, 9, 31, 23, 30),
          checkpointAtUtcMs: now,
          timeZoneId: 'UTC',
          workDateBoundaryMinutes: 360,
          recoveryStartUtcMs: null,
          recoveryEndUtcMs: null,
          recoveryReviewedAtUtcMs: null,
          createdAtUtcMs: now,
          updatedAtUtcMs: now
        })
        .run()

      const summary = service.calendarMonth({
        calendar: 'gregorian',
        year: 2026,
        month: 11,
        focusDate: '2026-11-01'
      })
      expect(summary.actualMinutes).toBe(0)
      expect(summary.days.find((day) => day.workDate === '2026-11-01')?.calendarActualMinutes).toBe(
        30
      )
    } finally {
      close()
    }
  })

  it('preserves past commitment days when weekly defaults change for the next Work Date', () => {
    const { database, close, service } = createDatabase()
    try {
      const month = currentMonth()
      service.calendarMonth({ ...month, focusDate: '2026-11-21' })
      const settingsService = createSettingsService(database, () => currentWorkTime)
      const current = settingsService.get()
      settingsService.save({
        profile: current.profile,
        workingHours: { ...current.workingHours, dailyCommitmentMinutes: 420 },
        preferences: current.preferences
      })

      const summary = service.calendarMonth({ ...month, focusDate: '2026-11-22' })
      expect(summary.days.find((day) => day.workDate === '2026-11-21')?.targetMinutes).toBe(480)
      expect(summary.days.find((day) => day.workDate === '2026-11-22')?.targetMinutes).toBe(420)
      expect(
        database
          .select()
          .from(monthlyCommitments)
          .all()
          .filter((entry) => !entry.isCurrent).length
      ).toBeGreaterThan(0)
    } finally {
      close()
    }
  })

  it('respects the configured weekly holiday even when it is in the working-day list', () => {
    const { database, close, service } = createDatabase()
    try {
      const month = currentMonth()
      service.calendarMonth({ ...month, focusDate: '2026-11-21' })
      const settingsService = createSettingsService(database, () => currentWorkTime)
      const current = settingsService.get()
      settingsService.save({
        profile: current.profile,
        workingHours: { ...current.workingHours, weeklyHolidayIsoDay: 6 },
        preferences: current.preferences
      })

      const summary = service.calendarMonth({ ...month, focusDate: '2026-11-28' })
      expect(summary.days.find((day) => day.workDate === '2026-11-21')?.targetMinutes).toBe(480)
      expect(summary.days.find((day) => day.workDate === '2026-11-28')?.targetMinutes).toBe(0)
    } finally {
      close()
    }
  })

  it('requires explicit confirmation to change a past Work Date', () => {
    const { close, service } = createDatabase()
    try {
      expect(() => service.setDayOverride({ workDate: '2026-11-20', targetMinutes: 0 })).toThrow(
        CommitmentDomainError
      )
      service.setDayOverride({ workDate: '2026-11-20', targetMinutes: 0, allowHistorical: true })
    } finally {
      close()
    }
  })

  it('does not calculate a forecast after a month has ended', () => {
    const directory = mkdtempSync(join(tmpdir(), 'karnama-commitment-past-'))
    temporaryDirectories.push(directory)
    const opened = openKarnamaDatabase({
      databasePath: join(directory, 'karnama.sqlite'),
      migrationsFolder,
      timezoneId: 'Asia/Tehran'
    })
    const service = createCommitmentService(opened.database, {
      now: () => Date.UTC(2027, 0, 1, 12)
    })
    try {
      const month = currentMonth()
      const summary = service.calendarMonth({ ...month, focusDate: '2026-11-21' })
      expect(summary.remainingWorkDays).toBe(0)
      expect(summary.requiredAverageMinutes).toBeNull()
    } finally {
      opened.close()
    }
  })
})
