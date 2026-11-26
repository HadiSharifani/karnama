import { z } from 'zod'
import { calendarMonthInputSchema } from './calendar'

export const analyticsPeriodInputSchema = calendarMonthInputSchema.transform(
  ({ calendar, year, month }) => ({ calendar, year, month })
)

export const reportExportInputSchema = z.object({
  snapshotId: z.string().uuid(),
  reportType: z.enum(['company', 'personal']),
  format: z.enum(['pdf', 'html'])
})

const reportPeriodSchema = z.object({
  calendar: z.enum(['jalali', 'gregorian']),
  year: z.number().int(),
  month: z.number().int().min(1).max(12),
  periodKey: z.string(),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/)
})

const reportDaySchema = z.object({
  workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  weekdayIso: z.number().int().min(1).max(7),
  targetMinutes: z.number().int().nonnegative(),
  actualMinutes: z.number().int().nonnegative(),
  balanceMinutes: z.number().int(),
  untrackedTargetGapMinutes: z.number().int().nonnegative(),
  isCurrentWorkDate: z.boolean(),
  leaveMinutes: z.number().int().nonnegative(),
  holidayName: z.string().nullable()
})

const reportTaskSchema = z.object({
  id: z.string().uuid().nullable(),
  title: z.string(),
  status: z.enum(['todo', 'in_progress', 'waiting_feedback', 'on_hold', 'done']).nullable(),
  isArchived: z.boolean(),
  estimatedMinutes: z.number().int().positive().nullable(),
  actualMinutes: z.number().int().nonnegative(),
  lifetimeActualMinutes: z.number().int().nonnegative(),
  estimateVarianceMinutes: z.number().int().nullable(),
  sessionCount: z.number().int().nonnegative(),
  averageSessionMinutes: z.number().int().nonnegative().nullable(),
  longestSessionMinutes: z.number().int().nonnegative().nullable(),
  links: z.array(
    z.object({
      id: z.string().uuid(),
      title: z.string(),
      url: z.string().url(),
      type: z.enum(['figma', 'external'])
    })
  ),
  attachments: z.array(
    z.object({
      id: z.string().uuid(),
      displayName: z.string(),
      mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']),
      description: z.string().nullable()
    })
  )
})

export const analyticsPeriodDtoSchema = z.object({
  snapshotId: z.string().uuid(),
  generatedAtUtcMs: z.number().int(),
  timeZoneId: z.string().min(1),
  period: reportPeriodSchema,
  profile: z.object({ displayName: z.string(), jobTitle: z.string() }),
  summary: z.object({
    actualMinutes: z.number().int().nonnegative(),
    targetMinutes: z.number().int().nonnegative(),
    remainingMinutes: z.number().int(),
    cumulativeBalanceMinutes: z.number().int(),
    workingDays: z.number().int().nonnegative(),
    leaveDays: z.number().int().nonnegative(),
    remainingWorkDays: z.number().int().nonnegative(),
    requiredAverageMinutes: z.number().int().nonnegative().nullable(),
    averageDailyMinutes: z.number().int().nonnegative().nullable(),
    activeDays: z.number().int().nonnegative()
  }),
  activeTimerIncluded: z.boolean(),
  currentDay: z
    .object({
      workDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      actualMinutes: z.number().int().nonnegative(),
      targetMinutes: z.number().int().nonnegative(),
      balanceMinutes: z.number().int(),
      completedTaskTitles: z.array(z.string()),
      currentTaskTitles: z.array(z.string())
    })
    .nullable(),
  days: z.array(reportDaySchema),
  hourlyDistribution: z.array(
    z.object({ hour: z.number().int().min(0).max(23), minutes: z.number().int().nonnegative() })
  ),
  weekdayDistribution: z.array(
    z.object({
      weekdayIso: z.number().int().min(1).max(7),
      minutes: z.number().int().nonnegative()
    })
  ),
  insights: z.object({
    mostActiveHour: z.number().int().min(0).max(23).nullable(),
    mostActiveWeekdayIso: z.number().int().min(1).max(7).nullable()
  }),
  monthlyTrend: z.array(
    z.object({
      calendar: z.enum(['jalali', 'gregorian']),
      year: z.number().int(),
      month: z.number().int().min(1).max(12),
      periodKey: z.string(),
      actualMinutes: z.number().int().nonnegative(),
      targetMinutes: z.number().int().nonnegative()
    })
  ),
  previousMonth: z.object({
    periodKey: z.string(),
    actualMinutes: z.number().int().nonnegative(),
    targetMinutes: z.number().int().nonnegative(),
    actualChangeMinutes: z.number().int(),
    actualChangePercent: z.number().nullable()
  }),
  tasks: z.array(reportTaskSchema),
  untrackedIntervals: z.object({
    available: z.literal(false),
    reason: z.string()
  })
})

export const reportExportResultSchema = z.object({
  saved: z.boolean(),
  format: z.enum(['pdf', 'html']),
  fileName: z.string().nullable()
})

export type AnalyticsPeriodInput = z.output<typeof analyticsPeriodInputSchema>
export type AnalyticsPeriodDto = z.infer<typeof analyticsPeriodDtoSchema>
export type ReportExportInput = z.infer<typeof reportExportInputSchema>
export type ReportExportResult = z.infer<typeof reportExportResultSchema>
