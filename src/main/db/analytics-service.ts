import { randomUUID } from 'node:crypto'
import { and, asc, desc, eq, gte, inArray, isNull, lte, sql } from 'drizzle-orm'
import {
  analyticsPeriodDtoSchema,
  analyticsPeriodInputSchema,
  type AnalyticsPeriodDto
} from '../../shared/contracts/analytics'
import {
  averagePerScheduledDay,
  compareActualMinutes,
  localHourMilliseconds
} from '../../shared/domain/analytics'
import { calendarMonthRange, shiftCalendarMonth } from '../../shared/domain/calendar-date'
import { workDateAtInstant } from '../../shared/domain/work-time'
import type { createCommitmentService } from './commitment-service'
import type { KarnamaDatabase } from './client'
import { activeTaskTimeCondition } from './active-time-filter'
import {
  appSettings,
  attachments,
  reportSnapshots,
  tasks,
  taskLinks,
  userProfile,
  workDateAllocations,
  workDateBoundaryOverrides,
  workScheduleVersions,
  workSessions
} from './schema'

type CommitmentService = ReturnType<typeof createCommitmentService>
type ServiceOptions = { now?: () => number; id?: () => string }
type AppSettingsRow = typeof appSettings.$inferSelect

type TaskActivity = {
  taskId: string | null
  monthMs: number
  lifetimeMs: number
  sessionDurations: Map<string, number>
}

export function createAnalyticsService(
  database: KarnamaDatabase,
  commitments: CommitmentService,
  options: ServiceOptions = {}
) {
  const now = options.now ?? Date.now
  const id = options.id ?? randomUUID
  const snapshots = new Map<string, AnalyticsPeriodDto>()

  function effectiveBoundary(workDate: string, fallback: number) {
    return (
      database
        .select({ minutes: workDateBoundaryOverrides.boundaryMinutes })
        .from(workDateBoundaryOverrides)
        .where(eq(workDateBoundaryOverrides.workDate, workDate))
        .get()?.minutes ??
      database
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

  function completionWorkDate(instantUtcMs: number, currentSettings: AppSettingsRow) {
    let workDate = workDateAtInstant(
      instantUtcMs,
      currentSettings.timezoneId,
      currentSettings.workDateBoundaryMinutes,
      (date) => effectiveBoundary(date, currentSettings.workDateBoundaryMinutes)
    )
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const schedule = database
        .select()
        .from(workScheduleVersions)
        .where(lte(workScheduleVersions.effectiveFromWorkDate, workDate))
        .orderBy(
          desc(workScheduleVersions.effectiveFromWorkDate),
          desc(workScheduleVersions.createdAtUtcMs)
        )
        .limit(1)
        .get()
      const timeZoneId = schedule?.timeZoneId ?? currentSettings.timezoneId
      const boundaryMinutes =
        schedule?.workDateBoundaryMinutes ?? currentSettings.workDateBoundaryMinutes
      const nextWorkDate = workDateAtInstant(instantUtcMs, timeZoneId, boundaryMinutes, (date) =>
        effectiveBoundary(date, boundaryMinutes)
      )
      if (nextWorkDate === workDate) return workDate
      workDate = nextWorkDate
    }
    return workDate
  }

  function readPeriod(input: unknown) {
    const parsed = analyticsPeriodInputSchema.parse(input)
    const period = calendarMonthRange(parsed.year, parsed.month, parsed.calendar)
    const generatedAtUtcMs = now()
    const currentSettings = database.select().from(appSettings).where(eq(appSettings.id, 1)).get()
    if (!currentSettings) throw new Error('تنظیمات برنامه پیدا نشد.')

    const currentWorkDate = workDateAtInstant(
      generatedAtUtcMs,
      currentSettings.timezoneId,
      currentSettings.workDateBoundaryMinutes,
      (date) => effectiveBoundary(date, currentSettings.workDateBoundaryMinutes)
    )
    const focusDate =
      currentWorkDate >= period.startDate && currentWorkDate <= period.endDate
        ? currentWorkDate
        : period.endDate
    const month = commitments.calendarMonth({ ...parsed, focusDate })

    const profile = database.select().from(userProfile).where(eq(userProfile.id, 1)).get()
    if (!profile) throw new Error('پروفایل برنامه پیدا نشد.')

    const allocationRows = database
      .select({
        allocation: workDateAllocations,
        session: workSessions,
        task: tasks
      })
      .from(workDateAllocations)
      .innerJoin(workSessions, eq(workDateAllocations.sessionId, workSessions.id))
      .leftJoin(tasks, eq(workSessions.taskId, tasks.id))
      .where(
        and(
          gte(workDateAllocations.workDate, period.startDate),
          lte(workDateAllocations.workDate, period.endDate),
          activeTaskTimeCondition(workSessions.taskId, tasks.id, tasks.archivedAtUtcMs)
        )
      )
      .all()

    const taskActivity = new Map<string, TaskActivity>()
    const intervals: Array<{ startUtcMs: number; endUtcMs: number; timeZoneId: string }> = []
    const weekdayMs = Array<number>(7).fill(0)
    const getTaskActivity = (taskId: string | null) => {
      const key = taskId ?? ''
      let activity = taskActivity.get(key)
      if (!activity) {
        activity = { taskId, monthMs: 0, lifetimeMs: 0, sessionDurations: new Map() }
        taskActivity.set(key, activity)
      }
      return activity
    }

    for (const row of allocationRows) {
      const { allocation, session } = row
      const durationMs = allocation.endUtcMs - allocation.startUtcMs
      if (durationMs <= 0) continue
      const activity = getTaskActivity(session.taskId)
      activity.monthMs += durationMs
      activity.sessionDurations.set(
        session.id,
        (activity.sessionDurations.get(session.id) ?? 0) + durationMs
      )
      intervals.push({
        startUtcMs: allocation.startUtcMs,
        endUtcMs: allocation.endUtcMs,
        timeZoneId: session.timeZoneId
      })
      const weekdayIso = new Date(`${allocation.workDate}T00:00:00Z`).getUTCDay() || 7
      weekdayMs[weekdayIso - 1] += durationMs
    }

    const activeTimer = commitments.getCurrentTimerSegment()
    let activeTimerIncluded = false
    if (activeTimer) {
      for (const allocation of activeTimer.workDateAllocations) {
        if (allocation.workDate < period.startDate || allocation.workDate > period.endDate) continue
        activeTimerIncluded = true
        const durationMs = allocation.endUtcMs - allocation.startUtcMs
        getTaskActivity(activeTimer.run.taskId).monthMs += durationMs
        intervals.push({
          startUtcMs: allocation.startUtcMs,
          endUtcMs: allocation.endUtcMs,
          timeZoneId: activeTimer.timeZoneId
        })
        const weekdayIso = new Date(`${allocation.workDate}T00:00:00Z`).getUTCDay() || 7
        weekdayMs[weekdayIso - 1] += durationMs
      }
      if (activeTimer.run.taskId) {
        getTaskActivity(activeTimer.run.taskId).lifetimeMs +=
          activeTimer.endUtcMs - activeTimer.startUtcMs
      }
    }

    const lifetimeRows = database
      .select({
        taskId: workSessions.taskId,
        durationMs: sql<number>`coalesce(sum(${workDateAllocations.endUtcMs} - ${workDateAllocations.startUtcMs}), 0)`
      })
      .from(workDateAllocations)
      .innerJoin(workSessions, eq(workDateAllocations.sessionId, workSessions.id))
      .innerJoin(tasks, eq(workSessions.taskId, tasks.id))
      .where(activeTaskTimeCondition(workSessions.taskId, tasks.id, tasks.archivedAtUtcMs))
      .groupBy(workSessions.taskId)
      .all()
    for (const row of lifetimeRows) {
      if (row.taskId) getTaskActivity(row.taskId).lifetimeMs += row.durationMs
    }

    const allTasks = database.select().from(tasks).where(isNull(tasks.archivedAtUtcMs)).all()
    const periodTaskIds = new Set(
      [...taskActivity.values()].flatMap((activity) => (activity.taskId ? [activity.taskId] : []))
    )
    const reportTasks = allTasks.filter((task) => {
      if (
        periodTaskIds.has(task.id) ||
        (task.status === 'in_progress' && task.archivedAtUtcMs === null)
      ) {
        return true
      }
      if (task.status !== 'done' || task.completedAtUtcMs === null) return false
      const completedWorkDate = completionWorkDate(task.completedAtUtcMs, currentSettings)
      return completedWorkDate >= period.startDate && completedWorkDate <= period.endDate
    })
    const reportTaskIds = reportTasks.map((task) => task.id)
    const linksByTask = new Map<
      string,
      Array<{ id: string; title: string; url: string; type: 'figma' | 'external' }>
    >()
    const attachmentsByTask = new Map<
      string,
      Array<{
        id: string
        displayName: string
        mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
        description: string | null
      }>
    >()
    if (reportTaskIds.length) {
      for (const link of database
        .select()
        .from(taskLinks)
        .where(inArray(taskLinks.taskId, reportTaskIds))
        .orderBy(asc(taskLinks.createdAtUtcMs))
        .all()) {
        const list = linksByTask.get(link.taskId) ?? []
        list.push({ id: link.id, title: link.title, url: link.url, type: link.type })
        linksByTask.set(link.taskId, list)
      }
      for (const attachment of database
        .select()
        .from(attachments)
        .where(inArray(attachments.taskId, reportTaskIds))
        .orderBy(asc(attachments.createdAtUtcMs))
        .all()) {
        const list = attachmentsByTask.get(attachment.taskId) ?? []
        list.push({
          id: attachment.id,
          displayName: attachment.displayName,
          mimeType: attachment.mimeType,
          description: attachment.description
        })
        attachmentsByTask.set(attachment.taskId, list)
      }
    }

    const taskBuckets = [...taskActivity.values()].map((activity) => ({
      key: activity.taskId ?? '',
      milliseconds: activity.monthMs
    }))
    const roundedTaskMinutes = distributeMinutes(taskBuckets, month.actualMinutes)
    const minutesByTaskKey = new Map(roundedTaskMinutes.map((entry) => [entry.key, entry.minutes]))
    const activityByTaskId = new Map(
      [...taskActivity.values()]
        .filter((activity) => activity.taskId)
        .map((activity) => [activity.taskId!, activity])
    )
    const taskDtos: AnalyticsPeriodDto['tasks'] = reportTasks.map((task) => {
      const activity = activityByTaskId.get(task.id)
      const closedSessions = [...(activity?.sessionDurations.values() ?? [])]
      const longestSessionMs = closedSessions.length
        ? closedSessions.reduce((longest, duration) => Math.max(longest, duration), 0)
        : null
      return {
        id: task.id,
        title: task.title,
        status: task.status,
        isArchived: task.archivedAtUtcMs !== null,
        estimatedMinutes: task.estimatedDurationMinutes,
        actualMinutes: minutesByTaskKey.get(task.id) ?? 0,
        lifetimeActualMinutes: Math.floor((activity?.lifetimeMs ?? 0) / 60_000),
        estimateVarianceMinutes:
          task.estimatedDurationMinutes === null
            ? null
            : Math.floor((activity?.lifetimeMs ?? 0) / 60_000) - task.estimatedDurationMinutes,
        sessionCount: closedSessions.length,
        averageSessionMinutes: closedSessions.length
          ? Math.floor(
              closedSessions.reduce((sum, milliseconds) => sum + milliseconds, 0) /
                closedSessions.length /
                60_000
            )
          : null,
        longestSessionMinutes:
          longestSessionMs === null ? null : Math.floor(longestSessionMs / 60_000),
        links: linksByTask.get(task.id) ?? [],
        attachments: attachmentsByTask.get(task.id) ?? []
      }
    })
    const unassignedActivity = taskActivity.get('')
    if (unassignedActivity) {
      taskDtos.push({
        id: null,
        title: 'فعالیت بدون تسک',
        status: null,
        isArchived: false,
        estimatedMinutes: null,
        actualMinutes: minutesByTaskKey.get('') ?? 0,
        lifetimeActualMinutes: Math.floor(unassignedActivity.lifetimeMs / 60_000),
        estimateVarianceMinutes: null,
        sessionCount: unassignedActivity.sessionDurations.size,
        averageSessionMinutes: unassignedActivity.sessionDurations.size
          ? Math.floor(
              [...unassignedActivity.sessionDurations.values()].reduce(
                (sum, value) => sum + value,
                0
              ) /
                unassignedActivity.sessionDurations.size /
                60_000
            )
          : null,
        longestSessionMinutes: unassignedActivity.sessionDurations.size
          ? Math.floor(Math.max(...unassignedActivity.sessionDurations.values()) / 60_000)
          : null,
        links: [],
        attachments: []
      })
    }
    taskDtos.sort(
      (left, right) =>
        right.actualMinutes - left.actualMinutes || left.title.localeCompare(right.title)
    )

    const trendPeriods = Array.from({ length: 6 }, (_, index) => {
      const delta = index - 5
      const shifted = shiftCalendarMonth(parsed.year, parsed.month, delta)
      return { ...shifted, calendar: parsed.calendar }
    })
    const monthlyTrend = trendPeriods.map((trendPeriod) => {
      const range = calendarMonthRange(trendPeriod.year, trendPeriod.month, trendPeriod.calendar)
      const monthSummary =
        range.periodKey === month.periodKey
          ? month
          : commitments.calendarMonth({
              calendar: trendPeriod.calendar,
              year: trendPeriod.year,
              month: trendPeriod.month,
              focusDate: range.endDate
            })
      return {
        calendar: trendPeriod.calendar,
        year: trendPeriod.year,
        month: trendPeriod.month,
        periodKey: range.periodKey,
        actualMinutes: monthSummary.actualMinutes,
        targetMinutes: monthSummary.targetMinutes
      }
    })
    const previous = monthlyTrend[monthlyTrend.length - 2]
    const change = compareActualMinutes(month.actualMinutes, previous.actualMinutes)
    const dailyRows = month.days.map((day) => ({
      workDate: day.workDate,
      weekdayIso: day.weekdayIso,
      targetMinutes: day.targetMinutes,
      actualMinutes: day.actualMinutes,
      balanceMinutes: day.dailyBalanceMinutes,
      untrackedTargetGapMinutes: Math.max(0, day.targetMinutes - day.actualMinutes),
      isCurrentWorkDate: day.isCurrentWorkDate,
      leaveMinutes: day.approvedLeaveMinutes,
      holidayName: day.holiday?.name ?? null
    }))
    const averageDays = dailyRows.filter(
      (day) => day.targetMinutes > 0 && day.workDate <= month.currentWorkDate
    )
    const activeDays = dailyRows.filter((day) => day.actualMinutes > 0).length
    const currentDayDto = month.days.find((day) => day.workDate === month.currentWorkDate)
    const hourlyDistribution = distributeMinutes(
      localHourMilliseconds(intervals).map((milliseconds, hour) => ({
        key: String(hour),
        milliseconds
      })),
      month.actualMinutes
    ).map((item) => ({ hour: Number(item.key), minutes: item.minutes }))
    const weekdayDistribution = distributeMinutes(
      weekdayMs.map((milliseconds, index) => ({ key: String(index + 1), milliseconds })),
      month.actualMinutes
    ).map((item) => ({ weekdayIso: Number(item.key), minutes: item.minutes }))
    const mostActiveHour = hourlyDistribution.reduce<{ hour: number; minutes: number } | null>(
      (best, current) =>
        current.minutes > 0 && (!best || current.minutes > best.minutes)
          ? { hour: current.hour, minutes: current.minutes }
          : best,
      null
    )
    const mostActiveWeekday = weekdayDistribution.reduce<{
      weekdayIso: number
      minutes: number
    } | null>(
      (best, current) =>
        current.minutes > 0 && (!best || current.minutes > best.minutes)
          ? { weekdayIso: current.weekdayIso, minutes: current.minutes }
          : best,
      null
    )
    const currentTasks = allTasks.filter(
      (task) => task.archivedAtUtcMs === null && task.status === 'in_progress'
    )
    const completedToday = allTasks.filter(
      (task) =>
        task.archivedAtUtcMs === null &&
        task.status === 'done' &&
        task.completedAtUtcMs !== null &&
        completionWorkDate(task.completedAtUtcMs, currentSettings) === month.currentWorkDate
    )

    const previousSummary = previous
    const snapshotId = id()
    const dto = analyticsPeriodDtoSchema.parse({
      snapshotId,
      generatedAtUtcMs,
      timeZoneId: currentSettings.timezoneId,
      period: { ...period },
      profile: { displayName: profile.displayName, jobTitle: profile.jobTitle },
      summary: {
        actualMinutes: month.actualMinutes,
        targetMinutes: month.targetMinutes,
        remainingMinutes: month.remainingMinutes,
        cumulativeBalanceMinutes: month.cumulativeBalanceMinutes,
        workingDays: month.workingDays,
        leaveDays: month.leaveDays,
        remainingWorkDays: month.remainingWorkDays,
        requiredAverageMinutes: month.requiredAverageMinutes,
        averageDailyMinutes: averagePerScheduledDay(averageDays),
        activeDays
      },
      activeTimerIncluded,
      currentDay: currentDayDto
        ? {
            workDate: currentDayDto.workDate,
            actualMinutes: currentDayDto.actualMinutes,
            targetMinutes: currentDayDto.targetMinutes,
            balanceMinutes: currentDayDto.dailyBalanceMinutes,
            completedTaskTitles: completedToday.slice(0, 5).map((task) => task.title),
            currentTaskTitles: currentTasks.slice(0, 5).map((task) => task.title)
          }
        : null,
      days: dailyRows,
      hourlyDistribution,
      weekdayDistribution,
      insights: {
        mostActiveHour: mostActiveHour?.hour ?? null,
        mostActiveWeekdayIso: mostActiveWeekday?.weekdayIso ?? null
      },
      monthlyTrend,
      previousMonth: {
        periodKey: previousSummary.periodKey,
        actualMinutes: previousSummary.actualMinutes,
        targetMinutes: previousSummary.targetMinutes,
        actualChangeMinutes: change.changeMinutes,
        actualChangePercent: change.changePercent
      },
      tasks: taskDtos,
      untrackedIntervals: {
        available: false,
        reason:
          'تنظیمات برنامه فقط مدت هدف روزانه را نگه می‌دارد و ساعت آغاز/پایان بازه کاری ذخیره نمی‌شود؛ بنابراین بازه‌های دقیقِ بدون ثبت قابل محاسبه نیستند.'
      }
    })

    snapshots.set(snapshotId, dto)
    while (snapshots.size > 12) snapshots.delete(snapshots.keys().next().value!)
    return dto
  }

  function getSnapshot(snapshotId: string) {
    return snapshots.get(snapshotId) ?? null
  }

  function persistExportSnapshot(
    snapshotId: string,
    reportType: 'company' | 'personal',
    format: 'pdf' | 'html'
  ) {
    const snapshot = snapshots.get(snapshotId)
    if (!snapshot) return false
    database
      .insert(reportSnapshots)
      .values({
        id: id(),
        reportType,
        calendar: snapshot.period.calendar,
        periodKey: snapshot.period.periodKey,
        periodStartWorkDate: snapshot.period.startDate,
        periodEndWorkDate: snapshot.period.endDate,
        format,
        generatedAtUtcMs: snapshot.generatedAtUtcMs,
        payloadJson: JSON.stringify({ ...snapshot, snapshotId: undefined })
      })
      .run()
    return true
  }

  return { getPeriod: readPeriod, getSnapshot, persistExportSnapshot }
}

function distributeMinutes(
  buckets: Array<{ key: string; milliseconds: number }>,
  totalMinutes: number
) {
  const values = buckets.map((bucket) => ({
    key: bucket.key,
    minutes: Math.floor(bucket.milliseconds / 60_000),
    remainder: bucket.milliseconds % 60_000
  }))
  let remainder = totalMinutes - values.reduce((sum, value) => sum + value.minutes, 0)
  if (remainder > 0) {
    const largestRemainders = [...values].sort((left, right) => right.remainder - left.remainder)
    for (const value of largestRemainders) {
      if (remainder <= 0) break
      value.minutes += 1
      remainder -= 1
    }
  } else if (remainder < 0) {
    const smallestRemainders = [...values].sort((left, right) => left.remainder - right.remainder)
    for (const value of smallestRemainders) {
      if (remainder >= 0) break
      if (value.minutes === 0) continue
      value.minutes -= 1
      remainder += 1
    }
  }
  return values.map(({ key, minutes }) => ({ key, minutes }))
}
