import { randomUUID } from 'node:crypto'
import {
  and,
  asc,
  desc,
  eq,
  gt,
  inArray,
  isNotNull,
  isNull,
  lt,
  lte,
  ne,
  or,
  sql
} from 'drizzle-orm'
import {
  taskDtoSchema,
  taskInputSchema,
  taskListInputSchema,
  taskMoveInputSchema,
  taskIdSchema,
  timerRecoveryReviewSchema,
  timerRunDtoSchema,
  timerRunIdSchema,
  timerStartInputSchema,
  timerStateDtoSchema,
  workDateAllocationDtoSchema,
  workSessionDtoSchema,
  workSessionInputSchema,
  workSessionUpdateSchema,
  type TaskDto,
  type TaskInput,
  type TaskMoveInput,
  type TimerStateDto,
  type WorkSessionDto,
  type WorkSessionInput
} from '../../shared/contracts/work'
import {
  allocateSessionByBoundary,
  allocateSessionManually,
  localDateTimeToUtc
} from '../../shared/domain/work-time'
import type { KarnamaDatabase } from './client'
import { activeTaskTimeCondition } from './active-time-filter'
import {
  appSettings,
  tasks,
  timerRuns,
  workDateAllocations,
  workDateBoundaryOverrides,
  workScheduleVersions,
  workSessions
} from './schema'

type KarnamaTransaction = Parameters<Parameters<KarnamaDatabase['transaction']>[0]>[0]
export type WorkErrorCode = 'invalid_input' | 'not_found' | 'conflict' | 'recovery_required'

export class WorkDomainError extends Error {
  constructor(
    readonly code: WorkErrorCode,
    message: string
  ) {
    super(message)
  }
}

type ServiceOptions = { now?: () => number; id?: () => string }

export function createWorkService(database: KarnamaDatabase, options: ServiceOptions = {}) {
  const now = options.now ?? Date.now
  const id = options.id ?? randomUUID

  function settingsSnapshot() {
    const settings = database.select().from(appSettings).where(eq(appSettings.id, 1)).get()
    if (!settings) throw new Error('تنظیمات زمانی برنامه پیدا نشد.')
    return {
      timeZoneId: settings.timezoneId,
      boundaryMinutes: settings.workDateBoundaryMinutes
    }
  }

  function boundaryForDate(transaction: KarnamaTransaction, workDate: string, fallback: number) {
    return (
      transaction
        .select({ minutes: workDateBoundaryOverrides.boundaryMinutes })
        .from(workDateBoundaryOverrides)
        .where(eq(workDateBoundaryOverrides.workDate, workDate))
        .get()?.minutes ??
      transaction
        .select({ minutes: workScheduleVersions.workDateBoundaryMinutes })
        .from(workScheduleVersions)
        .where(lte(workScheduleVersions.effectiveFromWorkDate, workDate))
        .orderBy(
          desc(workScheduleVersions.effectiveFromWorkDate),
          desc(workScheduleVersions.createdAtUtcMs)
        )
        .limit(1)
        .get()?.minutes ??
      fallback
    )
  }

  function requireTask(
    transaction: KarnamaTransaction,
    taskId: string | null,
    allowArchived = false
  ) {
    if (!taskId) return
    const task = transaction.select().from(tasks).where(eq(tasks.id, taskId)).get()
    if (!task || (!allowArchived && task.archivedAtUtcMs !== null)) {
      throw new WorkDomainError('not_found', 'تسک انتخاب‌شده پیدا نشد یا بایگانی شده است.')
    }
  }

  function orderedActiveTaskIds(transaction: KarnamaTransaction, status: TaskInput['status']) {
    return transaction
      .select({ id: tasks.id })
      .from(tasks)
      .where(and(eq(tasks.status, status), isNull(tasks.archivedAtUtcMs)))
      .orderBy(asc(tasks.position), asc(tasks.createdAtUtcMs), asc(tasks.id))
      .all()
      .map(({ id }) => id)
  }

  function normalizeTaskPositions(transaction: KarnamaTransaction, taskIds: string[]) {
    taskIds.forEach((taskId, position) => {
      transaction.update(tasks).set({ position }).where(eq(tasks.id, taskId)).run()
    })
  }

  function nextTaskPosition(transaction: KarnamaTransaction, status: TaskInput['status']) {
    const result = transaction
      .select({ position: sql<number>`coalesce(max(${tasks.position}), -1)` })
      .from(tasks)
      .where(and(eq(tasks.status, status), isNull(tasks.archivedAtUtcMs)))
      .get()
    return (result?.position ?? -1) + 1
  }

  function taskDto(transaction: KarnamaTransaction, taskId: string): TaskDto {
    const task = transaction.select().from(tasks).where(eq(tasks.id, taskId)).get()
    if (!task) throw new WorkDomainError('not_found', 'تسک پیدا نشد.')
    const total = transaction
      .select({
        durationMs: sql<number>`coalesce(sum(${workSessions.endUtcMs} - ${workSessions.startUtcMs}), 0)`,
        sessionCount: sql<number>`count(*)`,
        linkCount: sql<number>`(SELECT count(*) FROM task_links WHERE task_id = ${taskId})`,
        attachmentCount: sql<number>`(SELECT count(*) FROM attachments WHERE task_id = ${taskId})`
      })
      .from(workSessions)
      .leftJoin(tasks, eq(workSessions.taskId, tasks.id))
      .where(
        and(
          eq(workSessions.taskId, taskId),
          activeTaskTimeCondition(workSessions.taskId, tasks.id, tasks.archivedAtUtcMs)
        )
      )
      .get()
    return taskDtoSchema.parse({
      ...task,
      trackedDurationMs: total?.durationMs ?? 0,
      sessionCount: total?.sessionCount ?? 0,
      linkCount: total?.linkCount ?? 0,
      attachmentCount: total?.attachmentCount ?? 0
    })
  }

  function readTaskDto(taskId: string) {
    return database.transaction((transaction) => taskDto(transaction, taskId))
  }

  function listTasks(input: unknown = {}) {
    const { includeArchived } = taskListInputSchema.parse(input)
    return database.transaction((transaction) => {
      const rows = transaction
        .select({ task: tasks })
        .from(tasks)
        .where(includeArchived ? undefined : isNull(tasks.archivedAtUtcMs))
        .orderBy(
          sql`CASE ${tasks.status} WHEN 'todo' THEN 0 WHEN 'in_progress' THEN 1 WHEN 'waiting_feedback' THEN 2 WHEN 'on_hold' THEN 3 ELSE 4 END`,
          asc(tasks.position),
          desc(tasks.updatedAtUtcMs)
        )
        .all()
      return rows.map(({ task }) => taskDto(transaction, task.id))
    })
  }

  function createTask(input: unknown) {
    const task: TaskInput = taskInputSchema.parse(input)
    const timestamp = now()
    const taskId = id()
    database.transaction((transaction) => {
      transaction
        .insert(tasks)
        .values({
          id: taskId,
          ...task,
          position: nextTaskPosition(transaction, task.status),
          createdAtUtcMs: timestamp,
          updatedAtUtcMs: timestamp,
          completedAtUtcMs: task.status === 'done' ? timestamp : null
        })
        .run()
    })
    return readTaskDto(taskId)
  }

  function updateTask(input: unknown) {
    const { id: taskId, input: rawInput } = taskIdWithInputSchema.parse(input)
    const task: TaskInput = taskInputSchema.parse(rawInput)
    const timestamp = now()
    database.transaction((transaction) => {
      const current = transaction.select().from(tasks).where(eq(tasks.id, taskId)).get()
      if (!current || current.archivedAtUtcMs !== null) {
        throw new WorkDomainError('not_found', 'تسک پیدا نشد یا بایگانی شده است.')
      }
      const completedAtUtcMs =
        task.status === 'done' ? (current.completedAtUtcMs ?? timestamp) : null
      if (current.status === task.status) {
        transaction
          .update(tasks)
          .set({ ...task, completedAtUtcMs, updatedAtUtcMs: timestamp })
          .where(eq(tasks.id, taskId))
          .run()
        return
      }
      const sourceIds = orderedActiveTaskIds(transaction, current.status).filter(
        (orderedId) => orderedId !== taskId
      )
      const targetIds = orderedActiveTaskIds(transaction, task.status).filter(
        (orderedId) => orderedId !== taskId
      )
      transaction
        .update(tasks)
        .set({
          ...task,
          position: targetIds.length,
          completedAtUtcMs,
          updatedAtUtcMs: timestamp
        })
        .where(eq(tasks.id, taskId))
        .run()
      normalizeTaskPositions(transaction, sourceIds)
      normalizeTaskPositions(transaction, [...targetIds, taskId])
    })
    return readTaskDto(taskId)
  }

  function moveTask(input: unknown) {
    const { id: taskId, status, index }: TaskMoveInput = taskMoveInputSchema.parse(input)
    const timestamp = now()
    database.transaction((transaction) => {
      const current = transaction.select().from(tasks).where(eq(tasks.id, taskId)).get()
      if (!current || current.archivedAtUtcMs !== null) {
        throw new WorkDomainError('not_found', 'تسک پیدا نشد یا بایگانی شده است.')
      }

      const sourceIds = orderedActiveTaskIds(transaction, current.status).filter(
        (orderedId) => orderedId !== taskId
      )
      const targetIds =
        current.status === status
          ? sourceIds
          : orderedActiveTaskIds(transaction, status).filter((orderedId) => orderedId !== taskId)
      const destination = Math.min(index, targetIds.length)
      targetIds.splice(destination, 0, taskId)

      if (current.status !== status) {
        transaction
          .update(tasks)
          .set({
            status,
            completedAtUtcMs: status === 'done' ? (current.completedAtUtcMs ?? timestamp) : null,
            updatedAtUtcMs: timestamp
          })
          .where(eq(tasks.id, taskId))
          .run()
        normalizeTaskPositions(transaction, sourceIds)
      }
      normalizeTaskPositions(transaction, targetIds)
    })
    return readTaskDto(taskId)
  }

  function archiveTask(input: unknown) {
    const { id: taskId } = taskIdSchema.parse(input)
    database.transaction((transaction) => {
      const task = transaction.select().from(tasks).where(eq(tasks.id, taskId)).get()
      if (!task) throw new WorkDomainError('not_found', 'تسک پیدا نشد.')
      const timestamp = task.archivedAtUtcMs ?? now()
      const openRuns = transaction
        .select()
        .from(timerRuns)
        .where(and(inArray(timerRuns.status, ['running', 'paused']), eq(timerRuns.taskId, taskId)))
        .all()
      if (task.archivedAtUtcMs !== null && openRuns.length === 0) return
      if (
        openRuns.some(
          (run) => run.recoveryStartUtcMs !== null && run.recoveryReviewedAtUtcMs === null
        )
      ) {
        throw new WorkDomainError(
          'conflict',
          'پیش از بایگانی تسک، بازهٔ بازیابی تایمر را بررسی کنید.'
        )
      }
      for (const run of openRuns) {
        if (run.status === 'running') closeTimerSegment(transaction, run, timestamp)
        transaction
          .update(timerRuns)
          .set({
            status: 'stopped',
            currentSegmentStartedAtUtcMs: null,
            checkpointAtUtcMs: timestamp,
            updatedAtUtcMs: timestamp
          })
          .where(eq(timerRuns.id, run.id))
          .run()
      }
      if (task.archivedAtUtcMs === null) {
        transaction
          .update(tasks)
          .set({ archivedAtUtcMs: timestamp, updatedAtUtcMs: timestamp })
          .where(eq(tasks.id, taskId))
          .run()
      }
    })
    return readTaskDto(taskId)
  }

  function restoreTask(input: unknown) {
    const { id: taskId } = taskIdSchema.parse(input)
    const timestamp = now()
    database.transaction((transaction) => {
      const task = transaction
        .select({ id: tasks.id, status: tasks.status, archivedAtUtcMs: tasks.archivedAtUtcMs })
        .from(tasks)
        .where(eq(tasks.id, taskId))
        .get()
      if (!task) throw new WorkDomainError('not_found', 'تسک پیدا نشد.')
      if (task.archivedAtUtcMs === null) return
      const activeIds = orderedActiveTaskIds(transaction, task.status)
      transaction
        .update(tasks)
        .set({ archivedAtUtcMs: null, position: activeIds.length, updatedAtUtcMs: timestamp })
        .where(eq(tasks.id, taskId))
        .run()
      normalizeTaskPositions(transaction, [...activeIds, taskId])
    })
    return readTaskDto(taskId)
  }

  function assertNoOverlap(
    transaction: KarnamaTransaction,
    startUtcMs: number,
    endUtcMs: number,
    options: { sessionId?: string; timerRunId?: string } = {}
  ) {
    const conditions = [
      lt(workSessions.startUtcMs, endUtcMs),
      gt(workSessions.endUtcMs, startUtcMs)
    ]
    if (options.sessionId) conditions.push(ne(workSessions.id, options.sessionId)!)
    const overlap = transaction
      .select({ id: workSessions.id })
      .from(workSessions)
      .where(and(...conditions))
      .limit(1)
      .get()
    if (overlap)
      throw new WorkDomainError('conflict', 'این بازه با یک ثبت زمان دیگر هم‌پوشانی دارد.')

    const running = transaction
      .select()
      .from(timerRuns)
      .where(eq(timerRuns.status, 'running'))
      .get()
    if (
      !running ||
      running.id === options.timerRunId ||
      running.currentSegmentStartedAtUtcMs === null
    ) {
      return
    }
    const currentEnd = now()
    if (
      currentEnd > running.currentSegmentStartedAtUtcMs &&
      startUtcMs < currentEnd &&
      endUtcMs > running.currentSegmentStartedAtUtcMs
    ) {
      throw new WorkDomainError('conflict', 'این بازه با تایمر در حال اجرا هم‌پوشانی دارد.')
    }
  }

  function insertSession(
    transaction: KarnamaTransaction,
    input: {
      taskId: string | null
      timerRunId: string | null
      source: 'manual' | 'timer' | 'recovery'
      startUtcMs: number
      endUtcMs: number
      timeZoneId: string
      boundaryMinutes: number
      allocationMode: 'boundary' | 'manual'
      workDate?: string
      sessionId?: string
      ignoreTimerRunId?: string
      boundaryForDate?: (transaction: KarnamaTransaction, workDate: string) => number
    }
  ) {
    if (input.endUtcMs <= input.startUtcMs) {
      throw new WorkDomainError('invalid_input', 'زمان پایان باید پس از زمان آغاز باشد.')
    }
    assertNoOverlap(transaction, input.startUtcMs, input.endUtcMs, {
      timerRunId: input.ignoreTimerRunId
    })
    const sessionId = input.sessionId ?? id()
    const timestamp = now()
    const allocations =
      input.allocationMode === 'manual'
        ? allocateSessionManually(input.startUtcMs, input.endUtcMs, input.workDate!)
        : allocateSessionByBoundary(
            input.startUtcMs,
            input.endUtcMs,
            input.timeZoneId,
            input.boundaryMinutes,
            (date) => input.boundaryForDate?.(transaction, date) ?? input.boundaryMinutes
          )

    transaction
      .insert(workSessions)
      .values({
        id: sessionId,
        taskId: input.taskId,
        timerRunId: input.timerRunId,
        source: input.source,
        startUtcMs: input.startUtcMs,
        endUtcMs: input.endUtcMs,
        timeZoneId: input.timeZoneId,
        workDateBoundaryMinutes: input.boundaryMinutes,
        allocationMode: input.allocationMode,
        createdAtUtcMs: timestamp,
        updatedAtUtcMs: timestamp
      })
      .run()
    transaction
      .insert(workDateAllocations)
      .values(allocations.map((allocation) => ({ sessionId, ...allocation })))
      .run()
    return sessionId
  }

  function resolveInput(input: WorkSessionInput, timeZoneId: string) {
    try {
      const startUtcMs = localDateTimeToUtc(
        input.startDate,
        input.startTime,
        timeZoneId,
        input.startOccurrence
      )
      const endUtcMs = localDateTimeToUtc(
        input.endDate,
        input.endTime,
        timeZoneId,
        input.endOccurrence
      )
      if (endUtcMs <= startUtcMs) {
        throw new WorkDomainError('invalid_input', 'زمان پایان باید پس از زمان آغاز باشد.')
      }
      if (endUtcMs > now()) {
        throw new WorkDomainError('invalid_input', 'زمان پایان نمی‌تواند در آینده باشد.')
      }
      return { startUtcMs, endUtcMs }
    } catch (error) {
      if (error instanceof WorkDomainError) throw error
      throw new WorkDomainError(
        'invalid_input',
        error instanceof Error ? error.message : 'تاریخ یا ساعت معتبر نیست.'
      )
    }
  }

  function createManualSession(input: unknown) {
    const parsed: WorkSessionInput = workSessionInputSchema.parse(input)
    const { timeZoneId, boundaryMinutes } = settingsSnapshot()
    const { startUtcMs, endUtcMs } = resolveInput(parsed, timeZoneId)
    database.transaction((transaction) => {
      requireTask(transaction, parsed.taskId)
      insertSession(transaction, {
        taskId: parsed.taskId,
        timerRunId: null,
        source: 'manual',
        startUtcMs,
        endUtcMs,
        timeZoneId,
        boundaryMinutes,
        allocationMode: parsed.allocationMode,
        workDate: parsed.workDate ?? undefined,
        boundaryForDate: (transaction, date) => boundaryForDate(transaction, date, boundaryMinutes)
      })
    })
    return listSessions()
  }

  function updateSession(input: unknown) {
    const { id: sessionId, input: rawInput } = workSessionUpdateSchema.parse(input)
    const parsed: WorkSessionInput = workSessionInputSchema.parse(rawInput)
    database.transaction((transaction) => {
      const current = transaction
        .select()
        .from(workSessions)
        .where(eq(workSessions.id, sessionId))
        .get()
      if (!current) throw new WorkDomainError('not_found', 'ثبت زمان پیدا نشد.')
      requireTask(transaction, parsed.taskId, parsed.taskId === current.taskId)
      const { startUtcMs, endUtcMs } = resolveInput(parsed, current.timeZoneId)
      assertNoOverlap(transaction, startUtcMs, endUtcMs, { sessionId })
      const allocations =
        parsed.allocationMode === 'manual'
          ? allocateSessionManually(startUtcMs, endUtcMs, parsed.workDate!)
          : allocateSessionByBoundary(
              startUtcMs,
              endUtcMs,
              current.timeZoneId,
              current.workDateBoundaryMinutes,
              (date) => boundaryForDate(transaction, date, current.workDateBoundaryMinutes)
            )
      transaction
        .update(workSessions)
        .set({
          taskId: parsed.taskId,
          startUtcMs,
          endUtcMs,
          allocationMode: parsed.allocationMode,
          updatedAtUtcMs: now()
        })
        .where(eq(workSessions.id, sessionId))
        .run()
      transaction
        .delete(workDateAllocations)
        .where(eq(workDateAllocations.sessionId, sessionId))
        .run()
      transaction
        .insert(workDateAllocations)
        .values(allocations.map((allocation) => ({ sessionId, ...allocation })))
        .run()
    })
    return listSessions()
  }

  function listSessions(): WorkSessionDto[] {
    const rows = database
      .select({ session: workSessions, taskTitle: tasks.title })
      .from(workSessions)
      .leftJoin(tasks, eq(workSessions.taskId, tasks.id))
      .orderBy(desc(workSessions.startUtcMs))
      .limit(200)
      .all()
    if (rows.length === 0) return []
    const allocations = database
      .select()
      .from(workDateAllocations)
      .where(
        inArray(
          workDateAllocations.sessionId,
          rows.map(({ session }) => session.id)
        )
      )
      .orderBy(workDateAllocations.segmentIndex)
      .all()
    const bySession = new Map<string, typeof allocations>()
    for (const allocation of allocations) {
      const grouped = bySession.get(allocation.sessionId) ?? []
      grouped.push(allocation)
      bySession.set(allocation.sessionId, grouped)
    }
    return rows.map(({ session, taskTitle }) =>
      workSessionDtoSchema.parse({
        id: session.id,
        taskId: session.taskId,
        taskTitle,
        timerRunId: session.timerRunId,
        source: session.source,
        startUtcMs: session.startUtcMs,
        endUtcMs: session.endUtcMs,
        durationMs: session.endUtcMs - session.startUtcMs,
        timeZoneId: session.timeZoneId,
        allocationMode: session.allocationMode,
        allocations: (bySession.get(session.id) ?? []).map((allocation) =>
          workDateAllocationDtoSchema.parse(allocation)
        )
      })
    )
  }

  function deleteSession(input: unknown) {
    const { id: sessionId } = taskIdSchema.parse(input)
    database.transaction((transaction) => {
      const session = transaction
        .select({ id: workSessions.id })
        .from(workSessions)
        .where(eq(workSessions.id, sessionId))
        .get()
      if (!session) throw new WorkDomainError('not_found', 'ثبت زمان پیدا نشد.')
      transaction.delete(workSessions).where(eq(workSessions.id, sessionId)).run()
    })
    return listSessions()
  }

  function timerState(): TimerStateDto {
    const run = database
      .select({ run: timerRuns, taskTitle: tasks.title })
      .from(timerRuns)
      .leftJoin(tasks, eq(timerRuns.taskId, tasks.id))
      .where(
        and(
          or(eq(timerRuns.status, 'running'), eq(timerRuns.status, 'paused')),
          activeTaskTimeCondition(timerRuns.taskId, tasks.id, tasks.archivedAtUtcMs)
        )
      )
      .orderBy(desc(timerRuns.updatedAtUtcMs))
      .limit(1)
      .get()
    if (!run) return timerStateDtoSchema.parse({ run: null })

    const recorded =
      database
        .select({
          durationMs: sql<number>`coalesce(sum(${workSessions.endUtcMs} - ${workSessions.startUtcMs}), 0)`
        })
        .from(workSessions)
        .leftJoin(tasks, eq(workSessions.taskId, tasks.id))
        .where(
          and(
            eq(workSessions.timerRunId, run.run.id),
            activeTaskTimeCondition(workSessions.taskId, tasks.id, tasks.archivedAtUtcMs)
          )
        )
        .get()?.durationMs ?? 0
    const activeMs =
      run.run.status === 'running' && run.run.currentSegmentStartedAtUtcMs !== null
        ? Math.max(0, now() - run.run.currentSegmentStartedAtUtcMs)
        : 0
    const recovery =
      run.run.recoveryStartUtcMs !== null &&
      run.run.recoveryEndUtcMs !== null &&
      run.run.recoveryReviewedAtUtcMs === null
        ? {
            startUtcMs: run.run.recoveryStartUtcMs,
            endUtcMs: run.run.recoveryEndUtcMs,
            durationMs: run.run.recoveryEndUtcMs - run.run.recoveryStartUtcMs
          }
        : null
    return timerStateDtoSchema.parse({
      run: timerRunDtoSchema.parse({
        id: run.run.id,
        taskId: run.run.taskId,
        taskTitle: run.taskTitle,
        status: run.run.status,
        startedAtUtcMs: run.run.startedAtUtcMs,
        elapsedMs: recorded + activeMs,
        timeZoneId: run.run.timeZoneId,
        workDateBoundaryMinutes: run.run.workDateBoundaryMinutes,
        recovery
      })
    })
  }

  function startTimer(input: unknown) {
    const { taskId } = timerStartInputSchema.parse(input)
    const { timeZoneId, boundaryMinutes } = settingsSnapshot()
    const timestamp = now()
    const runId = id()
    database.transaction((transaction) => {
      const running = transaction
        .select({ id: timerRuns.id })
        .from(timerRuns)
        .where(eq(timerRuns.status, 'running'))
        .get()
      if (running)
        throw new WorkDomainError('conflict', 'ابتدا تایمر در حال اجرا را pause یا stop کنید.')
      const pendingRecovery = transaction
        .select({ id: timerRuns.id })
        .from(timerRuns)
        .where(
          and(
            eq(timerRuns.status, 'paused'),
            isNotNull(timerRuns.recoveryStartUtcMs),
            isNull(timerRuns.recoveryReviewedAtUtcMs)
          )
        )
        .get()
      if (pendingRecovery) {
        throw new WorkDomainError(
          'recovery_required',
          'پیش از شروع تایمر تازه، بازه مشکوک را بررسی کنید.'
        )
      }
      requireTask(transaction, taskId)
      transaction
        .update(timerRuns)
        .set({ status: 'stopped', updatedAtUtcMs: timestamp })
        .where(eq(timerRuns.status, 'paused'))
        .run()
      transaction
        .insert(timerRuns)
        .values({
          id: runId,
          taskId,
          status: 'running',
          startedAtUtcMs: timestamp,
          currentSegmentStartedAtUtcMs: timestamp,
          checkpointAtUtcMs: timestamp,
          timeZoneId,
          workDateBoundaryMinutes: boundaryMinutes,
          createdAtUtcMs: timestamp,
          updatedAtUtcMs: timestamp
        })
        .run()
    })
    return timerState()
  }

  function closeTimerSegment(
    transaction: KarnamaTransaction,
    run: typeof timerRuns.$inferSelect,
    endUtcMs: number
  ) {
    const startUtcMs = run.currentSegmentStartedAtUtcMs
    if (startUtcMs === null || endUtcMs <= startUtcMs) return
    insertSession(transaction, {
      taskId: run.taskId,
      timerRunId: run.id,
      source: 'timer',
      startUtcMs,
      endUtcMs,
      timeZoneId: run.timeZoneId,
      boundaryMinutes: run.workDateBoundaryMinutes,
      allocationMode: 'boundary',
      boundaryForDate: (transaction, date) =>
        boundaryForDate(transaction, date, run.workDateBoundaryMinutes),
      ignoreTimerRunId: run.id
    })
  }

  function pauseTimer(input: unknown) {
    const { runId } = timerRunIdSchema.parse(input)
    const timestamp = now()
    database.transaction((transaction) => {
      const run = transaction.select().from(timerRuns).where(eq(timerRuns.id, runId)).get()
      if (!run || run.status !== 'running') {
        throw new WorkDomainError('conflict', 'تایمر در حال اجرا نیست.')
      }
      closeTimerSegment(transaction, run, timestamp)
      transaction
        .update(timerRuns)
        .set({
          status: 'paused',
          currentSegmentStartedAtUtcMs: null,
          checkpointAtUtcMs: timestamp,
          updatedAtUtcMs: timestamp
        })
        .where(eq(timerRuns.id, runId))
        .run()
    })
    return timerState()
  }

  function resumeTimer(input: unknown) {
    const { runId } = timerRunIdSchema.parse(input)
    const timestamp = now()
    database.transaction((transaction) => {
      const run = transaction.select().from(timerRuns).where(eq(timerRuns.id, runId)).get()
      if (!run || run.status !== 'paused') {
        throw new WorkDomainError('conflict', 'تایمر مکث‌شده پیدا نشد.')
      }
      requireTask(transaction, run.taskId)
      if (run.recoveryStartUtcMs !== null && run.recoveryReviewedAtUtcMs === null) {
        throw new WorkDomainError(
          'recovery_required',
          'پیش از ادامه تایمر، بازه مشکوک را بررسی کنید.'
        )
      }
      const otherRunning = transaction
        .select({ id: timerRuns.id })
        .from(timerRuns)
        .where(eq(timerRuns.status, 'running'))
        .get()
      if (otherRunning) throw new WorkDomainError('conflict', 'یک تایمر دیگر در حال اجراست.')
      transaction
        .update(timerRuns)
        .set({
          status: 'running',
          currentSegmentStartedAtUtcMs: timestamp,
          checkpointAtUtcMs: timestamp,
          updatedAtUtcMs: timestamp
        })
        .where(eq(timerRuns.id, runId))
        .run()
    })
    return timerState()
  }

  function stopTimer(input: unknown) {
    const { runId } = timerRunIdSchema.parse(input)
    const timestamp = now()
    database.transaction((transaction) => {
      const run = transaction.select().from(timerRuns).where(eq(timerRuns.id, runId)).get()
      if (!run || run.status === 'stopped') {
        throw new WorkDomainError('not_found', 'تایمر پیدا نشد.')
      }
      if (run.recoveryStartUtcMs !== null && run.recoveryReviewedAtUtcMs === null) {
        throw new WorkDomainError(
          'recovery_required',
          'پیش از توقف تایمر، بازه مشکوک را بررسی کنید.'
        )
      }
      if (run.status === 'running') closeTimerSegment(transaction, run, timestamp)
      transaction
        .update(timerRuns)
        .set({
          status: 'stopped',
          currentSegmentStartedAtUtcMs: null,
          checkpointAtUtcMs: timestamp,
          updatedAtUtcMs: timestamp
        })
        .where(eq(timerRuns.id, runId))
        .run()
    })
    return timerState()
  }

  function reviewRecovery(input: unknown) {
    const { runId, decision } = timerRecoveryReviewSchema.parse(input)
    const timestamp = now()
    database.transaction((transaction) => {
      const run = transaction.select().from(timerRuns).where(eq(timerRuns.id, runId)).get()
      if (
        !run ||
        run.status !== 'paused' ||
        run.recoveryStartUtcMs === null ||
        run.recoveryEndUtcMs === null ||
        run.recoveryReviewedAtUtcMs !== null
      ) {
        throw new WorkDomainError('not_found', 'بازه مشکوکی برای بررسی وجود ندارد.')
      }
      if (decision === 'accept' && run.recoveryEndUtcMs > run.recoveryStartUtcMs) {
        insertSession(transaction, {
          taskId: run.taskId,
          timerRunId: run.id,
          source: 'recovery',
          startUtcMs: run.recoveryStartUtcMs,
          endUtcMs: run.recoveryEndUtcMs,
          timeZoneId: run.timeZoneId,
          boundaryMinutes: run.workDateBoundaryMinutes,
          allocationMode: 'boundary'
        })
      }
      transaction
        .update(timerRuns)
        .set({ recoveryReviewedAtUtcMs: timestamp, updatedAtUtcMs: timestamp })
        .where(eq(timerRuns.id, runId))
        .run()
    })
    return timerState()
  }

  function checkpointRunningTimer() {
    const timestamp = now()
    database
      .update(timerRuns)
      .set({ checkpointAtUtcMs: timestamp, updatedAtUtcMs: timestamp })
      .where(eq(timerRuns.status, 'running'))
      .run()
  }

  function recoverInterruptedTimer() {
    const timestamp = now()
    database.transaction((transaction) => {
      const run = transaction.select().from(timerRuns).where(eq(timerRuns.status, 'running')).get()
      if (!run) return
      const segmentStart = run.currentSegmentStartedAtUtcMs
      const safeCheckpoint = Math.min(run.checkpointAtUtcMs ?? segmentStart ?? timestamp, timestamp)
      if (segmentStart !== null && safeCheckpoint > segmentStart) {
        closeTimerSegment(transaction, run, safeCheckpoint)
      }
      const recoveryStart = safeCheckpoint
      const recoveryEnd = timestamp > safeCheckpoint ? timestamp : null
      transaction
        .update(timerRuns)
        .set({
          status: 'paused',
          currentSegmentStartedAtUtcMs: null,
          checkpointAtUtcMs: timestamp,
          recoveryStartUtcMs: recoveryEnd === null ? null : recoveryStart,
          recoveryEndUtcMs: recoveryEnd,
          recoveryReviewedAtUtcMs: null,
          updatedAtUtcMs: timestamp
        })
        .where(eq(timerRuns.id, run.id))
        .run()
    })
  }

  function pauseRunningTimer() {
    const timestamp = now()
    database.transaction((transaction) => {
      const run = transaction.select().from(timerRuns).where(eq(timerRuns.status, 'running')).get()
      if (!run) return
      closeTimerSegment(transaction, run, timestamp)
      transaction
        .update(timerRuns)
        .set({
          status: 'paused',
          currentSegmentStartedAtUtcMs: null,
          checkpointAtUtcMs: timestamp,
          updatedAtUtcMs: timestamp
        })
        .where(eq(timerRuns.id, run.id))
        .run()
    })
  }

  return {
    listTasks,
    createTask,
    updateTask,
    moveTask,
    archiveTask,
    restoreTask,
    listSessions,
    createManualSession,
    updateSession,
    deleteSession,
    timerState,
    startTimer,
    pauseTimer,
    resumeTimer,
    stopTimer,
    reviewRecovery,
    checkpointRunningTimer,
    recoverInterruptedTimer,
    pauseRunningTimer
  }
}

const taskIdWithInputSchema = taskIdSchema.extend({ input: taskInputSchema })
