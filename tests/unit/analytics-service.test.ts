import { randomUUID } from 'node:crypto'
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { afterEach, describe, expect, it } from 'vitest'
import { eq } from 'drizzle-orm'
import { createAnalyticsService } from '../../src/main/db/analytics-service'
import { createCommitmentService } from '../../src/main/db/commitment-service'
import { openKarnamaDatabase } from '../../src/main/db/client'
import {
  appSettings,
  attachments,
  reportSnapshots,
  taskLinks,
  timerRuns,
  workScheduleVersions,
  workSessions
} from '../../src/main/db/schema'
import { createWorkService } from '../../src/main/db/work-service'
import { buildReportHtml } from '../../src/main/reports/report-html'

const migrationsFolder = resolve(process.cwd(), 'drizzle')
const temporaryDirectories: string[] = []
const november = { calendar: 'gregorian' as const, year: 2026, month: 11 }
const october = { calendar: 'gregorian' as const, year: 2026, month: 10 }

function copyPhaseFourMigrations(destination: string) {
  const source = resolve(process.cwd(), 'drizzle')
  const targetMeta = join(destination, 'meta')
  mkdirSync(targetMeta, { recursive: true })
  for (const file of readdirSync(source).filter((entry) => /^000[0-4]_.*\.sql$/.test(entry))) {
    copyFileSync(join(source, file), join(destination, file))
  }
  const journal = JSON.parse(readFileSync(join(source, 'meta', '_journal.json'), 'utf8')) as {
    version: string
    dialect: string
    entries: unknown[]
  }
  writeFileSync(
    join(targetMeta, '_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, 5) })
  )
}

function createContext(initialTime = Date.UTC(2026, 10, 25, 12)) {
  const directory = mkdtempSync(join(tmpdir(), 'karnama-analytics-'))
  temporaryDirectories.push(directory)
  let currentTime = initialTime
  const opened = openKarnamaDatabase({
    databasePath: join(directory, 'karnama.sqlite'),
    migrationsFolder,
    timezoneId: 'Asia/Tehran'
  })
  const commitments = createCommitmentService(opened.database, { now: () => currentTime })
  const work = createWorkService(opened.database, { now: () => currentTime })
  const analytics = createAnalyticsService(opened.database, commitments, { now: () => currentTime })
  return {
    ...opened,
    analytics,
    commitments,
    work,
    database: opened.database,
    advance: (milliseconds: number) => (currentTime += milliseconds)
  }
}

function taskInput(title: string, estimatedDurationMinutes: number | null = null) {
  return {
    title,
    description: '',
    notes: '',
    status: 'todo' as const,
    priority: 'medium' as const,
    estimatedDurationMinutes
  }
}

function sessionInput(
  taskId: string | null,
  date: string,
  startTime: string,
  endDate = date,
  endTime = '10:00'
) {
  return {
    taskId,
    startDate: date,
    startTime,
    startOccurrence: null,
    endDate,
    endTime,
    endOccurrence: null,
    allocationMode: 'boundary' as const,
    workDate: null
  }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('period analytics', () => {
  it('upgrades a Phase 4 database without changing its saved sessions', () => {
    const directory = mkdtempSync(join(tmpdir(), 'karnama-phase5-upgrade-'))
    temporaryDirectories.push(directory)
    const legacyMigrationsFolder = join(directory, 'phase4-migrations')
    mkdirSync(legacyMigrationsFolder, { recursive: true })
    copyPhaseFourMigrations(legacyMigrationsFolder)

    const firstOpen = openKarnamaDatabase({
      databasePath: join(directory, 'karnama.sqlite'),
      migrationsFolder: legacyMigrationsFolder,
      timezoneId: 'Asia/Tehran'
    })
    const databasePath = join(directory, 'karnama.sqlite')
    const taskId = randomUUID()
    const sessionId = randomUUID()
    const startUtcMs = Date.UTC(2026, 10, 21, 9)
    const endUtcMs = startUtcMs + 60 * 60_000
    const sqlite = new Database(databasePath)
    sqlite.transaction(() => {
      sqlite
        .prepare(
          'INSERT INTO tasks (id, title, description, notes, status, priority, created_at_utc_ms, updated_at_utc_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(taskId, 'داده پیش از Phase 5', '', '', 'todo', 'medium', startUtcMs, startUtcMs)
      sqlite
        .prepare(
          'INSERT INTO work_sessions (id, task_id, source, start_utc_ms, end_utc_ms, time_zone_id, work_date_boundary_minutes, allocation_mode, created_at_utc_ms, updated_at_utc_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(
          sessionId,
          taskId,
          'manual',
          startUtcMs,
          endUtcMs,
          'Asia/Tehran',
          360,
          'boundary',
          startUtcMs,
          startUtcMs
        )
      sqlite
        .prepare(
          'INSERT INTO work_date_allocations (session_id, segment_index, start_utc_ms, end_utc_ms, work_date, source) VALUES (?, ?, ?, ?, ?, ?)'
        )
        .run(sessionId, 0, startUtcMs, endUtcMs, '2026-11-21', 'boundary')
    })()
    sqlite.close()
    firstOpen.close()

    const upgraded = openKarnamaDatabase({
      databasePath: join(directory, 'karnama.sqlite'),
      migrationsFolder,
      timezoneId: 'Asia/Tehran'
    })
    try {
      expect(upgraded.database.select().from(workScheduleVersions).all()).not.toHaveLength(0)
      expect(upgraded.database.select().from(reportSnapshots).all()).toEqual([])
      expect(upgraded.database.select().from(attachments).all()).toEqual([])
      expect(upgraded.database.select().from(timerRuns).all()).toEqual([])
      expect(upgraded.database.select().from(workSessions).all()).toHaveLength(1)
      expect(upgraded.database.select().from(workSessions).get()).toMatchObject({
        id: sessionId,
        startUtcMs,
        endUtcMs
      })
    } finally {
      upgraded.close()
    }
  })

  it('returns empty-period values without inventing activity', () => {
    const { analytics, close } = createContext()
    try {
      const report = analytics.getPeriod(november)
      expect(report.summary.actualMinutes).toBe(0)
      expect(report.summary.activeDays).toBe(0)
      expect(report.hourlyDistribution).toHaveLength(24)
      expect(report.hourlyDistribution.every((item) => item.minutes === 0)).toBe(true)
      expect(report.weekdayDistribution).toHaveLength(7)
      expect(report.tasks).toEqual([])
      expect(report.insights).toEqual({ mostActiveHour: null, mostActiveWeekdayIso: null })
      expect(report.untrackedIntervals.available).toBe(false)
    } finally {
      close()
    }
  })

  it('excludes archived task time from reports and restores unchanged history on unarchive', () => {
    const { analytics, commitments, work, database, close } = createContext()
    try {
      const task = work.createTask(taskInput('طراحی صفحه اصلی', 100))
      work.createManualSession(sessionInput(task.id, '2026-10-31', '09:00', '2026-10-31', '10:00'))
      work.createManualSession(sessionInput(task.id, '2026-11-21', '09:00', '2026-11-21', '10:00'))
      work.createManualSession(sessionInput(task.id, '2026-11-22', '10:30', '2026-11-22', '11:00'))
      const originalSessions = database
        .select()
        .from(workSessions)
        .all()
        .map(({ id, startUtcMs, endUtcMs, createdAtUtcMs }) => ({
          id,
          startUtcMs,
          endUtcMs,
          createdAtUtcMs
        }))
      work.archiveTask({ id: task.id })

      const report = analytics.getPeriod(november)
      expect(report.summary.actualMinutes).toBe(0)
      expect(report.days.every((day) => day.actualMinutes === 0)).toBe(true)
      expect(report.weekdayDistribution.every((day) => day.minutes === 0)).toBe(true)
      expect(report.hourlyDistribution.every((hour) => hour.minutes === 0)).toBe(true)
      expect(report.monthlyTrend.every((month) => month.actualMinutes === 0)).toBe(true)
      expect(report.tasks.some((item) => item.id === task.id)).toBe(false)
      expect(report.previousMonth.actualMinutes).toBe(0)

      const calendar = commitments.calendarMonth({
        calendar: 'gregorian',
        year: 2026,
        month: 11,
        focusDate: '2026-11-25'
      })
      expect(calendar.actualMinutes).toBe(0)
      expect(calendar.days.every((day) => day.actualMinutes === 0)).toBe(true)
      expect(calendar.days.every((day) => day.calendarActualMinutes === 0)).toBe(true)
      expect(calendar.days.every((day) => day.sessions.length === 0)).toBe(true)
      expect(calendar.days.every((day) => day.calendarSessions.length === 0)).toBe(true)
      expect(work.listSessions()).toHaveLength(3)

      work.restoreTask({ id: task.id })
      const restored = analytics.getPeriod(november)
      expect(restored.summary.actualMinutes).toBe(90)
      expect(restored.days.find((day) => day.workDate === '2026-11-21')?.actualMinutes).toBe(60)
      expect(restored.days.find((day) => day.workDate === '2026-11-22')?.actualMinutes).toBe(30)
      expect(restored.weekdayDistribution.reduce((sum, day) => sum + day.minutes, 0)).toBe(90)
      expect(
        restored.days
          .filter((day) => day.workDate >= '2026-11-16' && day.workDate <= '2026-11-22')
          .reduce((sum, day) => sum + day.actualMinutes, 0)
      ).toBe(90)
      expect(restored.previousMonth.actualMinutes).toBe(60)
      expect(restored.tasks.find((item) => item.id === task.id)).toMatchObject({
        isArchived: false,
        actualMinutes: 90,
        lifetimeActualMinutes: 150,
        estimateVarianceMinutes: 50,
        sessionCount: 2
      })
      expect(
        database
          .select()
          .from(workSessions)
          .all()
          .map(({ id, startUtcMs, endUtcMs, createdAtUtcMs }) => ({
            id,
            startUtcMs,
            endUtcMs,
            createdAtUtcMs
          }))
      ).toEqual(originalSessions)
    } finally {
      close()
    }
  })

  it('stops live task time at the archive timestamp in reports and never counts later time', () => {
    const { analytics, work, advance, close } = createContext()
    try {
      const task = work.createTask(taskInput('تایمر بایگانی‌شده'))
      const run = work.startTimer({ taskId: task.id }).run!
      advance(30 * 60_000)

      const archived = work.archiveTask({ id: task.id })
      const saved = work.listSessions()[0]
      expect(archived.archivedAtUtcMs).toBe(saved.endUtcMs)
      expect(saved.startUtcMs).toBe(run.startedAtUtcMs)
      expect(saved.durationMs).toBe(30 * 60_000)

      advance(2 * 60 * 60_000)
      expect(analytics.getPeriod(november).summary.actualMinutes).toBe(0)
      expect(analytics.getPeriod(november).tasks.some((item) => item.id === task.id)).toBe(false)
      expect(work.listSessions()).toHaveLength(1)

      work.restoreTask({ id: task.id })
      expect(analytics.getPeriod(november).summary.actualMinutes).toBe(30)
    } finally {
      close()
    }
  })

  it('uses saved Work Date allocations across midnight and after boundary changes', () => {
    const { analytics, work, database, close } = createContext()
    try {
      const task = work.createTask(taskInput('جلسه عبوری'))
      const [session] = work.createManualSession(
        sessionInput(task.id, '2026-11-22', '04:00', '2026-11-22', '07:00')
      )
      expect(session.allocations.map((allocation) => allocation.workDate)).toEqual([
        '2026-11-21',
        '2026-11-22'
      ])

      database
        .update(appSettings)
        .set({ workDateBoundaryMinutes: 180 })
        .where(eq(appSettings.id, 1))
        .run()
      database.update(workScheduleVersions).set({ workDateBoundaryMinutes: 180 }).run()
      const report = analytics.getPeriod(november)
      expect(report.summary.actualMinutes).toBe(180)
      expect(report.days.find((day) => day.workDate === '2026-11-21')?.actualMinutes).toBe(120)
      expect(report.days.find((day) => day.workDate === '2026-11-22')?.actualMinutes).toBe(60)
      expect(report.tasks.find((item) => item.id === task.id)?.sessionCount).toBe(1)
      expect(report.hourlyDistribution.find((item) => item.hour === 4)?.minutes).toBe(60)
      expect(report.hourlyDistribution.find((item) => item.hour === 5)?.minutes).toBe(60)
      expect(report.hourlyDistribution.find((item) => item.hour === 6)?.minutes).toBe(60)
      expect(report.weekdayDistribution.find((item) => item.weekdayIso === 6)?.minutes).toBe(120)
      expect(report.weekdayDistribution.find((item) => item.weekdayIso === 7)?.minutes).toBe(60)
    } finally {
      close()
    }
  })

  it('counts a live timer once, then keeps its total after the segment is persisted', () => {
    const { analytics, work, advance, close } = createContext()
    try {
      const task = work.createTask(taskInput('تایمر فعال'))
      const runId = work.startTimer({ taskId: task.id }).run!.id
      advance(30 * 60_000)

      const live = analytics.getPeriod(november)
      expect(live.summary.actualMinutes).toBe(30)
      expect(live.activeTimerIncluded).toBe(true)
      expect(live.tasks.find((item) => item.id === task.id)?.actualMinutes).toBe(30)

      work.pauseTimer({ runId })
      advance(60 * 60_000)
      const paused = analytics.getPeriod(november)
      expect(paused.summary.actualMinutes).toBe(30)
      expect(paused.activeTimerIncluded).toBe(false)
      expect(paused.tasks.find((item) => item.id === task.id)).toMatchObject({
        actualMinutes: 30,
        sessionCount: 1
      })
    } finally {
      close()
    }
  })

  it('does not count an unreviewed recovery interval or a paused incomplete segment', () => {
    const { analytics, database, close } = createContext()
    try {
      const timestamp = Date.UTC(2026, 10, 25, 8)
      database
        .insert(timerRuns)
        .values({
          id: randomUUID(),
          taskId: null,
          status: 'paused',
          startedAtUtcMs: timestamp - 60 * 60_000,
          currentSegmentStartedAtUtcMs: null,
          checkpointAtUtcMs: timestamp - 30 * 60_000,
          timeZoneId: 'Asia/Tehran',
          workDateBoundaryMinutes: 360,
          recoveryStartUtcMs: timestamp - 30 * 60_000,
          recoveryEndUtcMs: timestamp,
          recoveryReviewedAtUtcMs: null,
          createdAtUtcMs: timestamp - 60 * 60_000,
          updatedAtUtcMs: timestamp
        })
        .run()

      const report = analytics.getPeriod(november)
      expect(report.summary.actualMinutes).toBe(0)
      expect(report.activeTimerIncluded).toBe(false)
      expect(report.tasks).toEqual([])
    } finally {
      close()
    }
  })

  it('compares the selected month with the previous month from stored allocations', () => {
    const { analytics, work, close } = createContext()
    try {
      work.createManualSession(sessionInput(null, '2026-10-31', '09:00', '2026-10-31', '10:00'))
      const report = analytics.getPeriod(november)
      expect(report.previousMonth.periodKey).toBe('gregorian:2026-10')
      expect(report.previousMonth.actualMinutes).toBe(60)
      expect(report.previousMonth.actualChangeMinutes).toBe(-60)
      expect(
        report.monthlyTrend.find((item) => item.periodKey === 'gregorian:2026-10')?.actualMinutes
      ).toBe(60)
      expect(report.tasks.find((item) => item.id === null)).toBeUndefined()

      const octoberReport = analytics.getPeriod(october)
      expect(octoberReport.summary.actualMinutes).toBe(60)
      expect(octoberReport.tasks.find((item) => item.id === null)?.actualMinutes).toBe(60)
    } finally {
      close()
    }
  })

  it('keeps HTML figures tied to the same report snapshot and embeds each task resource', () => {
    const { analytics, work, database, close } = createContext()
    try {
      const task = work.createTask(taskInput('طراحی <صفحه>', 120))
      work.createManualSession(sessionInput(task.id, '2026-11-21', '09:00', '2026-11-21', '10:00'))
      const timestamp = Date.UTC(2026, 10, 21, 12)
      const linkId = randomUUID()
      const attachmentId = randomUUID()
      const storageRef = `${attachmentId}.png`
      database
        .insert(taskLinks)
        .values({
          id: linkId,
          taskId: task.id,
          url: 'https://www.figma.com/file/example',
          title: 'نمونه Figma',
          type: 'figma',
          createdAtUtcMs: timestamp
        })
        .run()
      database
        .insert(attachments)
        .values({
          id: attachmentId,
          taskId: task.id,
          displayName: 'screenshot.png',
          mimeType: 'image/png',
          fileSizeBytes: 8,
          description: 'تصویر صفحه',
          createdAtUtcMs: timestamp,
          storageRef
        })
        .run()

      const snapshot = analytics.getPeriod(november)
      expect(analytics.getSnapshot(snapshot.snapshotId)?.summary).toEqual(snapshot.summary)
      expect(analytics.persistExportSnapshot(snapshot.snapshotId, 'company', 'html')).toBe(true)
      const savedSnapshot = database.select().from(reportSnapshots).get()
      expect(savedSnapshot).toMatchObject({
        reportType: 'company',
        format: 'html',
        calendar: 'gregorian',
        periodKey: 'gregorian:2026-11'
      })
      expect(savedSnapshot?.payloadJson).not.toContain(snapshot.snapshotId)
      expect(savedSnapshot?.payloadJson).not.toContain(storageRef)
      const html = buildReportHtml(
        snapshot,
        'company',
        new Map([[attachmentId, { mimeType: 'image/png', base64: 'aW1hZ2U=' }]]),
        { arabic: 'Zm9udA==', latin: 'Zm9udA==' }
      )
      expect(html).toContain('<html lang="fa" dir="rtl">')
      expect(html).toContain('طراحی &lt;صفحه&gt;')
      const taskSection = html.slice(html.indexOf('<article class="resource-task">'))
      expect(taskSection).toContain('href="https://www.figma.com/file/example"')
      expect(taskSection).toContain('data:image/png;base64,aW1hZ2U=')
      expect(html).not.toContain(task.id)
      expect(html).not.toContain(linkId)
      expect(html).not.toContain(attachmentId)
      expect(html).not.toContain(storageRef)
      expect(html).toContain('زمان ثبت‌شده')
      expect(html.match(/تراز تجمعی/g)).toHaveLength(1)
      expect(html).toContain('روزهای کاری باقی‌مانده')
      expect(html).toContain('break-after:avoid;page-break-after:avoid')
      expect(html).toContain('break-inside:avoid')
      expect(html).toContain('section.trend-section{break-inside:avoid}')
      expect(html.indexOf('داده‌هایی که در این گزارش قابل محاسبه‌اند')).toBeLessThan(
        html.indexOf('تسک‌های گزارش')
      )
    } finally {
      close()
    }
  })
})
