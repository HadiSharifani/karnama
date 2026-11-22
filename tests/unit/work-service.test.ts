import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { afterEach, describe, expect, it } from 'vitest'
import { openKarnamaDatabase } from '../../src/main/db/client'
import { createWorkService, WorkDomainError } from '../../src/main/db/work-service'

const migrationsFolder = resolve(process.cwd(), 'drizzle')
const temporaryDirectories: string[] = []

function createService(initialTime = Date.UTC(2026, 10, 21, 12)) {
  const directory = mkdtempSync(join(tmpdir(), 'karnama-work-'))
  temporaryDirectories.push(directory)
  const databasePath = join(directory, 'karnama.sqlite')
  const open = () =>
    openKarnamaDatabase({ databasePath, migrationsFolder, timezoneId: 'Asia/Tehran' })
  let currentTime = initialTime
  const opened = open()
  const createServiceFor = (database: typeof opened.database) =>
    createWorkService(database, { now: () => currentTime, id: randomUUID })
  return {
    opened,
    advance: (milliseconds: number) => (currentTime += milliseconds),
    service: createServiceFor(opened.database),
    reopen: () => {
      const reopened = open()
      return { opened: reopened, service: createServiceFor(reopened.database) }
    }
  }
}

function taskInput(title: string) {
  return {
    title,
    description: 'شرح تسک',
    notes: '',
    status: 'todo' as const,
    priority: 'medium' as const,
    estimatedDurationMinutes: null
  }
}

function sessionInput(taskId: string | null, startTime = '09:00', endTime = '10:00') {
  return {
    taskId,
    startDate: '2026-11-21',
    startTime,
    startOccurrence: null,
    endDate: '2026-11-21',
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

describe('task and work-time service', () => {
  it('archives tasks by default, retains sessions, and restores the task', () => {
    const { opened, service } = createService()
    try {
      const task = service.createTask(taskInput('طراحی صفحه اصلی'))
      const session = service.createManualSession(sessionInput(task.id))[0]

      service.archiveTask({ id: task.id })
      expect(service.listTasks()).toHaveLength(0)
      expect(service.listTasks({ includeArchived: true })[0]).toMatchObject({
        id: task.id,
        archivedAtUtcMs: expect.any(Number),
        trackedDurationMs: 60 * 60 * 1000,
        sessionCount: 1
      })
      expect(service.listSessions()[0]).toMatchObject({
        id: session.id,
        taskId: task.id,
        taskTitle: 'طراحی صفحه اصلی'
      })

      service.restoreTask({ id: task.id })
      expect(service.listTasks()[0].archivedAtUtcMs).toBeNull()
    } finally {
      opened.close()
    }
  })

  it('does not archive a task while its timer run is still open', () => {
    const { opened, service } = createService()
    try {
      const task = service.createTask(taskInput('تسک با تایمر مکث‌شده'))
      const run = service.startTimer({ taskId: task.id }).run!
      service.pauseTimer({ runId: run.id })

      expect(() => service.archiveTask({ id: task.id })).toThrow(WorkDomainError)
      service.stopTimer({ runId: run.id })
      expect(service.archiveTask({ id: task.id }).archivedAtUtcMs).not.toBeNull()
    } finally {
      opened.close()
    }
  })

  it('rejects overlapping manual sessions and updates allocations transactionally', () => {
    const { opened, service } = createService()
    try {
      const firstTask = service.createTask(taskInput('اول'))
      const secondTask = service.createTask(taskInput('دوم'))
      const session = service.createManualSession(sessionInput(firstTask.id))[0]

      expect(() =>
        service.createManualSession(sessionInput(secondTask.id, '09:30', '10:30'))
      ).toThrow(WorkDomainError)
      service.updateSession({
        id: session.id,
        input: {
          ...sessionInput(secondTask.id, '10:00', '10:30'),
          allocationMode: 'manual',
          workDate: '2026-11-20'
        }
      })
      expect(service.listSessions()[0]).toMatchObject({
        taskId: secondTask.id,
        allocationMode: 'manual',
        allocations: [{ workDate: '2026-11-20', source: 'manual' }]
      })
    } finally {
      opened.close()
    }
  })

  it('preserves sub-minute timestamps when editing a session', () => {
    const { opened, service } = createService()
    try {
      const task = service.createTask(taskInput('تغییر جزئی'))
      const otherTask = service.createTask(taskInput('تسک مقصد'))
      const session = service.createManualSession({
        ...sessionInput(task.id, '09:00:12.345', '09:30:56.789')
      })[0]
      service.updateSession({
        id: session.id,
        input: { ...sessionInput(otherTask.id, '09:00:12.345', '09:30:56.789') }
      })
      expect(service.listSessions()[0]).toMatchObject({
        taskId: otherTask.id,
        startUtcMs: session.startUtcMs,
        endUtcMs: session.endUtcMs
      })
    } finally {
      opened.close()
    }
  })

  it('closes a paused timer when a new one starts and prevents two running timers', () => {
    const { opened, service, advance } = createService(Date.UTC(2026, 10, 21, 6))
    try {
      const task = service.createTask(taskInput('کار تایمری'))
      const first = service.startTimer({ taskId: task.id }).run!
      advance(30 * 60 * 1000)
      service.pauseTimer({ runId: first.id })

      const second = service.startTimer({ taskId: null }).run!
      expect(second.id).not.toBe(first.id)
      expect(service.listSessions()).toMatchObject([
        { timerRunId: first.id, source: 'timer', durationMs: 30 * 60 * 1000 }
      ])
      expect(() => service.startTimer({ taskId: task.id })).toThrow(/تایمر در حال اجرا/)
      expect(() => service.resumeTimer({ runId: first.id })).toThrow(WorkDomainError)
    } finally {
      opened.close()
    }
  })

  it('rejects a manual session that overlaps a running timer', () => {
    const { opened, service, advance } = createService(Date.UTC(2026, 10, 21, 6))
    try {
      service.startTimer({ taskId: null })
      advance(20 * 60 * 1000)
      expect(() => service.createManualSession(sessionInput(null, '09:40', '09:45'))).toThrow(
        WorkDomainError
      )
      expect(service.listSessions()).toHaveLength(0)
    } finally {
      opened.close()
    }
  })

  it('saves a running segment on clean pause and exposes a paused run after restart', () => {
    const { opened, service, advance } = createService(Date.UTC(2026, 10, 21, 6))
    try {
      const run = service.startTimer({ taskId: null }).run!
      advance(10 * 60 * 1000)
      service.pauseRunningTimer()
      expect(service.timerState().run).toMatchObject({
        id: run.id,
        status: 'paused',
        elapsedMs: 10 * 60 * 1000
      })
      expect(service.listSessions()).toHaveLength(1)
    } finally {
      opened.close()
    }
  })

  it('recovers persisted time after reopening the database and leaves downtime for review', () => {
    const { opened, service, advance, reopen } = createService(Date.UTC(2026, 10, 21, 6))
    let restarted: ReturnType<typeof reopen> | undefined
    try {
      const run = service.startTimer({ taskId: null }).run!
      advance(5 * 60 * 1000)
      service.checkpointRunningTimer()
      opened.close()
      advance(30 * 60 * 1000)
      restarted = reopen()
      restarted.service.recoverInterruptedTimer()

      expect(restarted.service.timerState().run).toMatchObject({
        id: run.id,
        status: 'paused',
        elapsedMs: 5 * 60 * 1000,
        recovery: { durationMs: 30 * 60 * 1000 }
      })
      expect(restarted.service.listSessions()).toMatchObject([
        { timerRunId: run.id, source: 'timer', durationMs: 5 * 60 * 1000 }
      ])
      restarted.service.reviewRecovery({ runId: run.id, decision: 'discard' })
      expect(restarted.service.timerState().run?.recovery).toBeNull()
      expect(restarted.service.listSessions()).toHaveLength(1)
    } finally {
      opened.close()
      restarted?.opened.close()
    }
  })

  it('turns confirmed crash recovery into a persisted session', () => {
    const { opened, service, advance } = createService(Date.UTC(2026, 10, 21, 6))
    try {
      const run = service.startTimer({ taskId: null }).run!
      advance(20 * 60 * 1000)
      service.recoverInterruptedTimer()
      service.reviewRecovery({ runId: run.id, decision: 'accept' })

      expect(service.listSessions()).toHaveLength(1)
      expect(service.listSessions()[0]).toMatchObject({
        source: 'recovery',
        durationMs: 20 * 60 * 1000
      })
    } finally {
      opened.close()
    }
  })
})
