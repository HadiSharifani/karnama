import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm'
import {
  calendarMonthDtoSchema,
  calendarMonthInputSchema,
  holidayInputSchema,
  leaveInputSchema,
  monthlyCommitmentOverrideSchema,
  workDateBoundaryInputSchema,
  workDateOverrideInputSchema,
  type CalendarMonthDto
} from '../../shared/contracts/calendar'
import { calendarMonthRange, type CalendarMode } from '../../shared/domain/calendar-date'
import {
  addIsoDays,
  allocateSessionByBoundary,
  allocateSessionByCalendarDate,
  localDayStartUtc,
  workDateAtInstant
} from '../../shared/domain/work-time'
import type { KarnamaDatabase } from './client'
import {
  appSettings,
  holidays,
  leaveEntries,
  monthlyCommitmentDays,
  monthlyCommitments,
  tasks,
  timerRuns,
  workDateAllocations,
  workDateBoundaryOverrides,
  workDateOverrides,
  workScheduleVersions,
  workSessions
} from './schema'

type KarnamaTransaction = Parameters<Parameters<KarnamaDatabase['transaction']>[0]>[0]
type ServiceOptions = { now?: () => number; id?: () => string }
type Schedule = typeof workScheduleVersions.$inferSelect
type Snapshot = typeof monthlyCommitments.$inferSelect
type DaySnapshot = typeof monthlyCommitmentDays.$inferSelect

export class CommitmentDomainError extends Error {
  constructor(
    readonly code: 'invalid_input' | 'not_found' | 'conflict' | 'confirmation_required',
    message: string
  ) {
    super(message)
  }
}

export function createCommitmentService(database: KarnamaDatabase, options: ServiceOptions = {}) {
  const now = options.now ?? Date.now
  const id = options.id ?? randomUUID

  function settings() {
    const row = database.select().from(appSettings).where(eq(appSettings.id, 1)).get()
    if (!row) throw new Error('تنظیمات برنامه پیدا نشد.')
    return row
  }

  function scheduleFor(transaction: KarnamaTransaction, workDate: string): Schedule | undefined {
    return transaction
      .select()
      .from(workScheduleVersions)
      .where(lte(workScheduleVersions.effectiveFromWorkDate, workDate))
      .orderBy(
        desc(workScheduleVersions.effectiveFromWorkDate),
        desc(workScheduleVersions.createdAtUtcMs)
      )
      .limit(1)
      .get()
  }

  function defaultBoundary(transaction: KarnamaTransaction, workDate: string, fallback: number) {
    return (
      transaction
        .select({ minutes: workDateBoundaryOverrides.boundaryMinutes })
        .from(workDateBoundaryOverrides)
        .where(eq(workDateBoundaryOverrides.workDate, workDate))
        .get()?.minutes ??
      scheduleFor(transaction, workDate)?.workDateBoundaryMinutes ??
      fallback
    )
  }

  function currentWorkDate(transaction: KarnamaTransaction) {
    const currentSettings = settings()
    return workDateAtInstant(
      now(),
      currentSettings.timezoneId,
      currentSettings.workDateBoundaryMinutes,
      (date) => defaultBoundary(transaction, date, currentSettings.workDateBoundaryMinutes)
    )
  }

  function assertHistoricalAllowed(
    transaction: KarnamaTransaction,
    workDate: string,
    allowHistorical: boolean
  ) {
    if (workDate < currentWorkDate(transaction) && !allowHistorical) {
      throw new CommitmentDomainError(
        'confirmation_required',
        'این تغییر روی یک Work Date گذشته اثر می‌گذارد؛ پس از تأیید دوباره تلاش کنید.'
      )
    }
  }

  function approvedLeaveMinutes(
    transaction: KarnamaTransaction,
    workDate: string,
    plannedMinutes: number
  ) {
    const rows = transaction
      .select()
      .from(leaveEntries)
      .where(and(eq(leaveEntries.workDate, workDate), eq(leaveEntries.status, 'approved')))
      .all()
    const requested = rows.reduce((total, leave) => {
      if (leave.kind === 'full') return total + plannedMinutes
      if (leave.kind === 'half') return total + Math.ceil(plannedMinutes / 2)
      return total + (leave.customMinutes ?? 0)
    }, 0)
    return Math.min(plannedMinutes, requested)
  }

  function dayTarget(transaction: KarnamaTransaction, workDate: string) {
    const schedule = scheduleFor(transaction, workDate)
    const override = transaction
      .select({ targetMinutes: workDateOverrides.targetMinutes })
      .from(workDateOverrides)
      .where(eq(workDateOverrides.workDate, workDate))
      .get()
    const holiday = transaction
      .select({ workDate: holidays.workDate })
      .from(holidays)
      .where(eq(holidays.workDate, workDate))
      .get()
    let weekdays: number[] = []
    try {
      weekdays = JSON.parse(schedule?.workingWeekdaysJson ?? '[]') as number[]
    } catch {
      throw new Error('فهرست روزهای کاری ذخیره‌شده معتبر نیست.')
    }
    const weekday = new Date(`${workDate}T00:00:00Z`).getUTCDay() || 7
    const scheduledMinutes =
      override?.targetMinutes ??
      (holiday || weekday === schedule?.weeklyHolidayIsoDay
        ? 0
        : weekdays.includes(weekday)
          ? (schedule?.dailyCommitmentMinutes ?? 0)
          : 0)
    const leaveMinutes = approvedLeaveMinutes(transaction, workDate, scheduledMinutes)
    return {
      workDate,
      scheduleVersionId: schedule?.id ?? null,
      scheduledMinutes,
      approvedLeaveMinutes: leaveMinutes,
      targetMinutes: Math.max(0, scheduledMinutes - leaveMinutes)
    }
  }

  function snapshotDays(transaction: KarnamaTransaction, snapshot: Snapshot) {
    return transaction
      .select()
      .from(monthlyCommitmentDays)
      .where(eq(monthlyCommitmentDays.commitmentId, snapshot.id))
      .orderBy(asc(monthlyCommitmentDays.workDate))
      .all()
  }

  function createSnapshotRevision(
    transaction: KarnamaTransaction,
    previous: Snapshot | null,
    period: ReturnType<typeof calendarMonthRange>,
    days: Array<
      Pick<
        DaySnapshot,
        | 'workDate'
        | 'scheduleVersionId'
        | 'scheduledMinutes'
        | 'approvedLeaveMinutes'
        | 'targetMinutes'
      >
    >,
    overrideMinutes: number | null
  ) {
    const revision = (previous?.revision ?? 0) + 1
    const commitmentId = id()
    const targetMinutes =
      overrideMinutes ?? days.reduce((total, day) => total + day.targetMinutes, 0)
    if (previous) {
      transaction
        .update(monthlyCommitments)
        .set({ isCurrent: false })
        .where(eq(monthlyCommitments.id, previous.id))
        .run()
    }
    const snapshot = transaction
      .insert(monthlyCommitments)
      .values({
        id: commitmentId,
        calendar: period.calendar,
        periodKey: period.periodKey,
        periodStartWorkDate: period.startDate,
        periodEndWorkDate: period.endDate,
        revision,
        targetMinutes,
        overrideMinutes,
        isCurrent: true,
        createdAtUtcMs: now()
      })
      .returning()
      .get()
    transaction
      .insert(monthlyCommitmentDays)
      .values(
        days.map((day) => ({
          commitmentId,
          workDate: day.workDate,
          scheduleVersionId: day.scheduleVersionId,
          scheduledMinutes: day.scheduledMinutes,
          approvedLeaveMinutes: day.approvedLeaveMinutes,
          targetMinutes: day.targetMinutes
        }))
      )
      .run()
    return snapshot
  }

  function ensureSnapshot(
    transaction: KarnamaTransaction,
    period: ReturnType<typeof calendarMonthRange>
  ) {
    const current = transaction
      .select()
      .from(monthlyCommitments)
      .where(
        and(
          eq(monthlyCommitments.calendar, period.calendar),
          eq(monthlyCommitments.periodKey, period.periodKey),
          eq(monthlyCommitments.isCurrent, true)
        )
      )
      .get()
    if (current) return current
    const days = []
    for (let date = period.startDate; date <= period.endDate; date = addIsoDays(date, 1)) {
      days.push(dayTarget(transaction, date))
    }
    return createSnapshotRevision(transaction, null, period, days, null)
  }

  function refreshSnapshotsFrom(transaction: KarnamaTransaction, fromWorkDate: string) {
    const currentSnapshots = transaction
      .select()
      .from(monthlyCommitments)
      .where(
        and(
          eq(monthlyCommitments.isCurrent, true),
          gte(monthlyCommitments.periodEndWorkDate, fromWorkDate)
        )
      )
      .all()
    for (const current of currentSnapshots) {
      const period = calendarMonthRange(
        Number(current.periodKey.split(':')[1].split('-')[0]),
        Number(current.periodKey.split(':')[1].split('-')[1]),
        current.calendar as CalendarMode
      )
      const previousDays = snapshotDays(transaction, current)
      const previousByDate = new Map(previousDays.map((day) => [day.workDate, day]))
      const days = []
      for (let date = period.startDate; date <= period.endDate; date = addIsoDays(date, 1)) {
        days.push(
          date < fromWorkDate
            ? previousByDate.get(date)!
            : { ...dayTarget(transaction, date), commitmentId: current.id, id: 0 }
        )
      }
      const unchanged = days.every((day, index) => {
        const previous = previousDays[index]
        return (
          day.workDate === previous.workDate &&
          day.scheduleVersionId === previous.scheduleVersionId &&
          day.scheduledMinutes === previous.scheduledMinutes &&
          day.approvedLeaveMinutes === previous.approvedLeaveMinutes &&
          day.targetMinutes === previous.targetMinutes
        )
      })
      if (unchanged) continue
      createSnapshotRevision(transaction, current, period, days, current.overrideMinutes)
    }
  }

  function calendarMonth(input: unknown): CalendarMonthDto {
    const parsed = calendarMonthInputSchema.parse(input)
    const period = calendarMonthRange(parsed.year, parsed.month, parsed.calendar)
    return database.transaction((transaction) => {
      refreshSnapshotsFrom(transaction, currentWorkDate(transaction))
      const snapshot = ensureSnapshot(transaction, period)
      const focusDate = parsed.focusDate ?? currentWorkDate(transaction)
      const currentDate = currentWorkDate(transaction)
      if (focusDate < period.startDate || focusDate > period.endDate) {
        throw new CommitmentDomainError('invalid_input', 'روز انتخاب‌شده در ماه جاری نیست.')
      }

      const snapshotByDate = new Map(
        snapshotDays(transaction, snapshot).map((day) => [day.workDate, day])
      )
      const workRows = transaction
        .select({
          allocation: workDateAllocations,
          session: workSessions,
          taskTitle: tasks.title
        })
        .from(workDateAllocations)
        .innerJoin(workSessions, eq(workDateAllocations.sessionId, workSessions.id))
        .leftJoin(tasks, eq(workSessions.taskId, tasks.id))
        .where(
          and(
            gte(workDateAllocations.workDate, period.startDate),
            lte(workDateAllocations.workDate, period.endDate)
          )
        )
        .all()
      const actualMs = new Map<string, number>()
      const sessionsByDate = new Map<string, CalendarMonthDto['days'][number]['sessions']>()
      const calendarActualMs = new Map<string, number>()
      const calendarSessionsByDate = new Map<
        string,
        CalendarMonthDto['days'][number]['calendarSessions']
      >()
      for (const row of workRows) {
        const durationMs = row.allocation.endUtcMs - row.allocation.startUtcMs
        actualMs.set(
          row.allocation.workDate,
          (actualMs.get(row.allocation.workDate) ?? 0) + durationMs
        )
        const dateSessions = sessionsByDate.get(row.allocation.workDate) ?? []
        dateSessions.push({
          id: row.session.id,
          taskTitle: row.taskTitle,
          startUtcMs: row.allocation.startUtcMs,
          endUtcMs: row.allocation.endUtcMs,
          durationMinutes: Math.floor(durationMs / 60_000),
          timeZoneId: row.session.timeZoneId,
          source: row.session.source
        })
        sessionsByDate.set(row.allocation.workDate, dateSessions)
      }

      const currentSettings = settings()
      const rangeStartUtcMs = localDayStartUtc(period.startDate, currentSettings.timezoneId)
      const rangeEndUtcMs = localDayStartUtc(
        addIsoDays(period.endDate, 1),
        currentSettings.timezoneId
      )
      const timelineRows = transaction
        .select({ session: workSessions, taskTitle: tasks.title })
        .from(workSessions)
        .leftJoin(tasks, eq(workSessions.taskId, tasks.id))
        .where(
          and(
            lte(workSessions.startUtcMs, rangeEndUtcMs + 36 * 60 * 60 * 1000),
            gte(workSessions.endUtcMs, rangeStartUtcMs - 36 * 60 * 60 * 1000)
          )
        )
        .all()
      for (const row of timelineRows) {
        for (const allocation of allocateSessionByCalendarDate(
          row.session.startUtcMs,
          row.session.endUtcMs,
          row.session.timeZoneId
        )) {
          if (
            allocation.calendarDate < period.startDate ||
            allocation.calendarDate > period.endDate
          )
            continue
          const durationMs = allocation.endUtcMs - allocation.startUtcMs
          calendarActualMs.set(
            allocation.calendarDate,
            (calendarActualMs.get(allocation.calendarDate) ?? 0) + durationMs
          )
          const dateSessions = calendarSessionsByDate.get(allocation.calendarDate) ?? []
          dateSessions.push({
            id: row.session.id,
            taskTitle: row.taskTitle,
            startUtcMs: allocation.startUtcMs,
            endUtcMs: allocation.endUtcMs,
            durationMinutes: Math.floor(durationMs / 60_000),
            timeZoneId: row.session.timeZoneId,
            source: row.session.source
          })
          calendarSessionsByDate.set(allocation.calendarDate, dateSessions)
        }
      }

      const timer = transaction
        .select()
        .from(timerRuns)
        .where(eq(timerRuns.status, 'running'))
        .get()
      if (
        timer?.currentSegmentStartedAtUtcMs !== null &&
        timer?.currentSegmentStartedAtUtcMs !== undefined
      ) {
        const endUtcMs = now()
        if (endUtcMs > timer.currentSegmentStartedAtUtcMs) {
          const allocations = allocateSessionByBoundary(
            timer.currentSegmentStartedAtUtcMs,
            endUtcMs,
            timer.timeZoneId,
            timer.workDateBoundaryMinutes,
            (date) => defaultBoundary(transaction, date, timer.workDateBoundaryMinutes)
          )
          for (const allocation of allocations) {
            if (allocation.workDate < period.startDate || allocation.workDate > period.endDate)
              continue
            actualMs.set(
              allocation.workDate,
              (actualMs.get(allocation.workDate) ?? 0) + allocation.endUtcMs - allocation.startUtcMs
            )
          }
          const taskTitle = timer.taskId
            ? (transaction
                .select({ title: tasks.title })
                .from(tasks)
                .where(eq(tasks.id, timer.taskId))
                .get()?.title ?? null)
            : null
          for (const allocation of allocateSessionByCalendarDate(
            timer.currentSegmentStartedAtUtcMs,
            endUtcMs,
            timer.timeZoneId
          )) {
            if (
              allocation.calendarDate < period.startDate ||
              allocation.calendarDate > period.endDate
            )
              continue
            const durationMs = allocation.endUtcMs - allocation.startUtcMs
            calendarActualMs.set(
              allocation.calendarDate,
              (calendarActualMs.get(allocation.calendarDate) ?? 0) + durationMs
            )
            const dateSessions = calendarSessionsByDate.get(allocation.calendarDate) ?? []
            dateSessions.push({
              id: timer.id,
              taskTitle,
              startUtcMs: allocation.startUtcMs,
              endUtcMs: allocation.endUtcMs,
              durationMinutes: Math.floor(durationMs / 60_000),
              timeZoneId: timer.timeZoneId,
              source: 'timer'
            })
            calendarSessionsByDate.set(allocation.calendarDate, dateSessions)
          }
        }
      }

      const days = []
      for (let date = period.startDate; date <= period.endDate; date = addIsoDays(date, 1)) {
        const snapshotDay = snapshotByDate.get(date)
        if (!snapshotDay) throw new Error(`تصویر تعهد روز ${date} پیدا نشد.`)
        const holiday = transaction
          .select({ name: holidays.name, kind: holidays.kind })
          .from(holidays)
          .where(eq(holidays.workDate, date))
          .get()
        const leave = transaction
          .select({
            kind: leaveEntries.kind,
            customMinutes: leaveEntries.customMinutes,
            status: leaveEntries.status
          })
          .from(leaveEntries)
          .where(eq(leaveEntries.workDate, date))
          .orderBy(desc(leaveEntries.updatedAtUtcMs))
          .limit(1)
          .get()
        const boundaryOverride = transaction
          .select({ minutes: workDateBoundaryOverrides.boundaryMinutes })
          .from(workDateBoundaryOverrides)
          .where(eq(workDateBoundaryOverrides.workDate, date))
          .get()
        const actualMinutes = Math.floor((actualMs.get(date) ?? 0) / 60_000)
        const weekdayIso = new Date(`${date}T00:00:00Z`).getUTCDay() || 7
        days.push({
          workDate: date,
          weekdayIso,
          scheduledMinutes: snapshotDay.scheduledMinutes,
          approvedLeaveMinutes: snapshotDay.approvedLeaveMinutes,
          targetMinutes: snapshotDay.targetMinutes,
          actualMinutes,
          dailyBalanceMinutes: actualMinutes - snapshotDay.targetMinutes,
          isCurrentWorkDate: date === currentDate,
          dayOverrideMinutes:
            transaction
              .select({ minutes: workDateOverrides.targetMinutes })
              .from(workDateOverrides)
              .where(eq(workDateOverrides.workDate, date))
              .get()?.minutes ?? null,
          holiday: holiday ? { name: holiday.name, kind: holiday.kind } : null,
          leave: leave ?? null,
          boundaryMinutes:
            boundaryOverride?.minutes ??
            defaultBoundary(transaction, date, settings().workDateBoundaryMinutes),
          hasBoundaryOverride: boundaryOverride !== undefined,
          sessions: sessionsByDate.get(date) ?? [],
          calendarActualMinutes: Math.floor((calendarActualMs.get(date) ?? 0) / 60_000),
          calendarSessions: calendarSessionsByDate.get(date) ?? []
        })
      }
      const actualMinutes = Math.floor(
        [...actualMs.values()].reduce((sum, value) => sum + value, 0) / 60_000
      )
      const commitmentDays = snapshotDays(transaction, snapshot)
      const remainingWorkDays = commitmentDays.filter(
        (day) => day.targetMinutes > 0 && day.workDate >= currentDate
      ).length
      const targetMinutes =
        snapshot.overrideMinutes ?? commitmentDays.reduce((sum, day) => sum + day.targetMinutes, 0)
      const cumulativeActual = days
        .filter((day) => day.workDate <= focusDate)
        .reduce((sum, day) => sum + day.actualMinutes, 0)
      const cumulativeTarget = commitmentDays
        .filter((day) => day.workDate <= focusDate)
        .reduce((sum, day) => sum + day.targetMinutes, 0)
      return calendarMonthDtoSchema.parse({
        calendar: parsed.calendar,
        periodKey: period.periodKey,
        periodStart: period.startDate,
        periodEnd: period.endDate,
        focusDate,
        currentWorkDate: currentDate,
        targetMinutes,
        overrideMinutes: snapshot.overrideMinutes,
        actualMinutes,
        remainingMinutes: targetMinutes - actualMinutes,
        requiredAverageMinutes:
          targetMinutes > actualMinutes && remainingWorkDays > 0
            ? Math.ceil((targetMinutes - actualMinutes) / remainingWorkDays)
            : null,
        remainingWorkDays,
        workingDays: commitmentDays.filter((day) => day.targetMinutes > 0).length,
        leaveDays: commitmentDays.filter((day) => day.approvedLeaveMinutes > 0).length,
        cumulativeBalanceMinutes: cumulativeActual - cumulativeTarget,
        days
      })
    })
  }

  function setMonthlyOverride(input: unknown) {
    const parsed = monthlyCommitmentOverrideSchema.parse(input)
    const period = calendarMonthRange(parsed.year, parsed.month, parsed.calendar)
    return database.transaction((transaction) => {
      const currentDate = currentWorkDate(transaction)
      if (period.startDate < currentDate && !parsed.allowHistorical) {
        throw new CommitmentDomainError(
          'confirmation_required',
          'این ماه روزهای سپری‌شده دارد؛ برای اصلاح تعهد ثبت‌شده تأیید لازم است.'
        )
      }
      const current = ensureSnapshot(transaction, period)
      const days = snapshotDays(transaction, current)
      return createSnapshotRevision(transaction, current, period, days, parsed.targetMinutes)
    })
  }

  function setDayOverride(input: unknown) {
    const parsed = workDateOverrideInputSchema.parse(input)
    return database.transaction((transaction) => {
      assertHistoricalAllowed(transaction, parsed.workDate, parsed.allowHistorical)
      if (parsed.targetMinutes === null) {
        transaction
          .delete(workDateOverrides)
          .where(eq(workDateOverrides.workDate, parsed.workDate))
          .run()
      } else {
        transaction
          .insert(workDateOverrides)
          .values({
            workDate: parsed.workDate,
            targetMinutes: parsed.targetMinutes,
            updatedAtUtcMs: now()
          })
          .onConflictDoUpdate({
            target: workDateOverrides.workDate,
            set: { targetMinutes: parsed.targetMinutes, updatedAtUtcMs: now() }
          })
          .run()
      }
      refreshSnapshotsFrom(transaction, parsed.workDate)
    })
  }

  function setHoliday(input: unknown) {
    const parsed = holidayInputSchema.parse(input)
    return database.transaction((transaction) => {
      assertHistoricalAllowed(transaction, parsed.workDate, parsed.allowHistorical)
      if (parsed.holiday === null) {
        transaction.delete(holidays).where(eq(holidays.workDate, parsed.workDate)).run()
      } else {
        transaction
          .insert(holidays)
          .values({ workDate: parsed.workDate, ...parsed.holiday, createdAtUtcMs: now() })
          .onConflictDoUpdate({ target: holidays.workDate, set: parsed.holiday })
          .run()
      }
      refreshSnapshotsFrom(transaction, parsed.workDate)
    })
  }

  function setLeave(input: unknown) {
    const parsed = leaveInputSchema.parse(input)
    return database.transaction((transaction) => {
      const dates: string[] = []
      for (
        let date = parsed.startWorkDate;
        date <= parsed.endWorkDate && dates.length <= 366;
        date = addIsoDays(date, 1)
      ) {
        dates.push(date)
      }
      if (dates.at(-1) !== parsed.endWorkDate) {
        throw new CommitmentDomainError('invalid_input', 'بازه مرخصی حداکثر می‌تواند ۳۶۶ روز باشد.')
      }
      for (const date of dates) assertHistoricalAllowed(transaction, date, parsed.allowHistorical)
      if (parsed.leave === null) {
        transaction.delete(leaveEntries).where(inArray(leaveEntries.workDate, dates)).run()
      } else {
        const timestamp = now()
        const groupId = id()
        transaction.delete(leaveEntries).where(inArray(leaveEntries.workDate, dates)).run()
        transaction
          .insert(leaveEntries)
          .values(
            dates.map((workDate) => ({
              id: id(),
              groupId,
              workDate,
              ...parsed.leave!,
              createdAtUtcMs: timestamp,
              updatedAtUtcMs: timestamp
            }))
          )
          .run()
      }
      refreshSnapshotsFrom(transaction, parsed.startWorkDate)
    })
  }

  function setBoundary(input: unknown) {
    const parsed = workDateBoundaryInputSchema.parse(input)
    return database.transaction((transaction) => {
      assertHistoricalAllowed(transaction, parsed.workDate, parsed.allowHistorical)
      if (parsed.boundaryMinutes === null) {
        transaction
          .delete(workDateBoundaryOverrides)
          .where(eq(workDateBoundaryOverrides.workDate, parsed.workDate))
          .run()
      } else {
        transaction
          .insert(workDateBoundaryOverrides)
          .values({
            workDate: parsed.workDate,
            boundaryMinutes: parsed.boundaryMinutes,
            updatedAtUtcMs: now()
          })
          .onConflictDoUpdate({
            target: workDateBoundaryOverrides.workDate,
            set: { boundaryMinutes: parsed.boundaryMinutes, updatedAtUtcMs: now() }
          })
          .run()
      }
    })
  }

  return {
    calendarMonth,
    setMonthlyOverride,
    setDayOverride,
    setHoliday,
    setLeave,
    setBoundary
  }
}
