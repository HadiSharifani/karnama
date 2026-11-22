import { z } from 'zod'

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number)
    const date = new Date(`${value}T00:00:00Z`)
    return (
      year >= 1800 &&
      year <= 2256 &&
      date.getUTCFullYear() === year &&
      date.getUTCMonth() + 1 === month &&
      date.getUTCDate() === day
    )
  }, 'تاریخ معتبر میلادی در بازه پشتیبانی‌شده وارد کنید.')

const calendarMonthInputObjectSchema = z.object({
  calendar: z.enum(['jalali', 'gregorian']),
  year: z.number().int().min(1178).max(2256),
  month: z.number().int().min(1).max(12),
  focusDate: isoDate.optional()
})

function validateCalendarYear(calendar: 'jalali' | 'gregorian', year: number) {
  return calendar === 'jalali' ? year <= 1634 : year >= 1800 && year <= 2256
}

export const calendarMonthInputSchema = calendarMonthInputObjectSchema.refine(
  ({ calendar, year }) => validateCalendarYear(calendar, year),
  { path: ['year'], message: 'سال تقویم در بازه پشتیبانی‌شده نیست.' }
)

export const monthlyCommitmentOverrideSchema = calendarMonthInputObjectSchema
  .extend({
    targetMinutes: z.number().int().min(0).max(100_000).nullable(),
    allowHistorical: z.boolean().default(false)
  })
  .refine(({ calendar, year }) => validateCalendarYear(calendar, year), {
    path: ['year'],
    message: 'سال تقویم در بازه پشتیبانی‌شده نیست.'
  })

export const workDateOverrideInputSchema = z.object({
  workDate: isoDate,
  targetMinutes: z.number().int().min(0).max(1440).nullable(),
  allowHistorical: z.boolean().default(false)
})

export const holidayInputSchema = z.object({
  workDate: isoDate,
  holiday: z
    .object({
      name: z.string().trim().min(1).max(100),
      kind: z.enum(['public', 'custom'])
    })
    .nullable(),
  allowHistorical: z.boolean().default(false)
})

export const leaveInputSchema = z
  .object({
    startWorkDate: isoDate,
    endWorkDate: isoDate,
    leave: z
      .object({
        kind: z.enum(['full', 'half', 'custom']),
        customMinutes: z.number().int().min(1).max(1440).nullable(),
        status: z.enum(['pending', 'approved', 'rejected'])
      })
      .nullable(),
    allowHistorical: z.boolean().default(false)
  })
  .superRefine((input, context) => {
    if (input.startWorkDate > input.endWorkDate) {
      context.addIssue({
        code: 'custom',
        path: ['endWorkDate'],
        message: 'پایان بازه مرخصی باید پس از آغاز آن باشد.'
      })
    }
    if (input.leave?.kind === 'custom' && input.leave.customMinutes === null) {
      context.addIssue({
        code: 'custom',
        path: ['leave', 'customMinutes'],
        message: 'مدت مرخصی دلخواه را وارد کنید.'
      })
    }
    if (input.leave && input.leave.kind !== 'custom' && input.leave.customMinutes !== null) {
      context.addIssue({
        code: 'custom',
        path: ['leave', 'customMinutes'],
        message: 'برای مرخصی تمام‌روز یا نیم‌روز مدت جداگانه وارد نکنید.'
      })
    }
  })

export const workDateBoundaryInputSchema = z.object({
  workDate: isoDate,
  boundaryMinutes: z.number().int().min(0).max(1439).nullable(),
  allowHistorical: z.boolean().default(false)
})

const sessionSummarySchema = z.object({
  id: z.string().uuid(),
  taskTitle: z.string().nullable(),
  startUtcMs: z.number().int(),
  endUtcMs: z.number().int(),
  durationMinutes: z.number().int().nonnegative(),
  timeZoneId: z.string(),
  source: z.enum(['manual', 'timer', 'recovery'])
})

const leaveSummarySchema = z.object({
  kind: z.enum(['full', 'half', 'custom']),
  customMinutes: z.number().int().nullable(),
  status: z.enum(['pending', 'approved', 'rejected'])
})

const calendarDaySchema = z.object({
  workDate: isoDate,
  weekdayIso: z.number().int().min(1).max(7),
  scheduledMinutes: z.number().int().nonnegative(),
  approvedLeaveMinutes: z.number().int().nonnegative(),
  targetMinutes: z.number().int().nonnegative(),
  actualMinutes: z.number().int().nonnegative(),
  dailyBalanceMinutes: z.number().int(),
  isCurrentWorkDate: z.boolean(),
  dayOverrideMinutes: z.number().int().nullable(),
  holiday: z.object({ name: z.string(), kind: z.enum(['public', 'custom']) }).nullable(),
  leave: leaveSummarySchema.nullable(),
  boundaryMinutes: z.number().int().min(0).max(1439),
  hasBoundaryOverride: z.boolean(),
  sessions: z.array(sessionSummarySchema),
  calendarActualMinutes: z.number().int().nonnegative(),
  calendarSessions: z.array(sessionSummarySchema)
})

export const calendarMonthDtoSchema = z.object({
  calendar: z.enum(['jalali', 'gregorian']),
  periodKey: z.string(),
  periodStart: isoDate,
  periodEnd: isoDate,
  focusDate: isoDate,
  currentWorkDate: isoDate,
  targetMinutes: z.number().int().nonnegative(),
  overrideMinutes: z.number().int().nullable(),
  actualMinutes: z.number().int().nonnegative(),
  remainingMinutes: z.number().int(),
  requiredAverageMinutes: z.number().int().nonnegative().nullable(),
  remainingWorkDays: z.number().int().nonnegative(),
  workingDays: z.number().int().nonnegative(),
  leaveDays: z.number().int().nonnegative(),
  cumulativeBalanceMinutes: z.number().int(),
  days: z.array(calendarDaySchema)
})

export type CalendarMonthInput = z.infer<typeof calendarMonthInputSchema>
export type CalendarMonthDto = z.infer<typeof calendarMonthDtoSchema>
export type MonthlyCommitmentOverrideInput = z.infer<typeof monthlyCommitmentOverrideSchema>
export type WorkDateOverrideInput = z.infer<typeof workDateOverrideInputSchema>
export type HolidayInput = z.infer<typeof holidayInputSchema>
export type LeaveInput = z.infer<typeof leaveInputSchema>
export type WorkDateBoundaryInput = z.infer<typeof workDateBoundaryInputSchema>
