import { z } from 'zod'

export const taskStatuses = ['todo', 'in_progress', 'waiting_feedback', 'on_hold', 'done'] as const
export const taskPriorities = ['low', 'medium', 'high'] as const

export const taskInputSchema = z.object({
  title: z.string().trim().min(1, 'عنوان تسک را وارد کنید.').max(200),
  description: z.string().max(10_000),
  notes: z.string().max(10_000),
  status: z.enum(taskStatuses),
  priority: z.enum(taskPriorities),
  estimatedDurationMinutes: z.number().int().min(1).max(1_000_000).nullable()
})

export const taskListInputSchema = z.object({ includeArchived: z.boolean().default(false) })

export const taskDtoSchema = taskInputSchema.extend({
  id: z.string().uuid(),
  createdAtUtcMs: z.number().int(),
  updatedAtUtcMs: z.number().int(),
  completedAtUtcMs: z.number().int().nullable(),
  archivedAtUtcMs: z.number().int().nullable(),
  trackedDurationMs: z.number().int().nonnegative(),
  sessionCount: z.number().int().nonnegative()
})

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ را به شکل میلادی معتبر وارد کنید.')
const localTime = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d(?:\.\d{1,3})?)?$/, 'ساعت معتبر نیست.')

export const workSessionInputSchema = z
  .object({
    taskId: z.string().uuid().nullable(),
    startDate: isoDate,
    startTime: localTime,
    startOccurrence: z.enum(['earlier', 'later']).nullable(),
    endDate: isoDate,
    endTime: localTime,
    endOccurrence: z.enum(['earlier', 'later']).nullable(),
    allocationMode: z.enum(['boundary', 'manual']),
    workDate: isoDate.nullable()
  })
  .superRefine((input, context) => {
    if (input.allocationMode === 'manual' && !input.workDate) {
      context.addIssue({
        code: 'custom',
        path: ['workDate'],
        message: 'برای تخصیص دستی، Work Date را انتخاب کنید.'
      })
    }
    if (input.allocationMode === 'boundary' && input.workDate) {
      context.addIssue({
        code: 'custom',
        path: ['workDate'],
        message: 'در تخصیص خودکار Work Date جداگانه انتخاب نمی‌شود.'
      })
    }
  })

export const workDateAllocationDtoSchema = z.object({
  id: z.number().int(),
  segmentIndex: z.number().int(),
  startUtcMs: z.number().int(),
  endUtcMs: z.number().int(),
  workDate: isoDate,
  source: z.enum(['boundary', 'manual'])
})

export const workSessionDtoSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  taskTitle: z.string().nullable(),
  timerRunId: z.string().uuid().nullable(),
  source: z.enum(['manual', 'timer', 'recovery']),
  startUtcMs: z.number().int(),
  endUtcMs: z.number().int(),
  durationMs: z.number().int().positive(),
  timeZoneId: z.string(),
  allocationMode: z.enum(['boundary', 'manual']),
  allocations: z.array(workDateAllocationDtoSchema)
})

export const timerRunDtoSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid().nullable(),
  taskTitle: z.string().nullable(),
  status: z.enum(['running', 'paused']),
  startedAtUtcMs: z.number().int(),
  elapsedMs: z.number().int().nonnegative(),
  timeZoneId: z.string(),
  workDateBoundaryMinutes: z.number().int(),
  recovery: z
    .object({
      startUtcMs: z.number().int(),
      endUtcMs: z.number().int(),
      durationMs: z.number().int().nonnegative()
    })
    .nullable()
})

export const timerStateDtoSchema = z.object({ run: timerRunDtoSchema.nullable() })

export const timerStartInputSchema = z.object({ taskId: z.string().uuid().nullable() })
export const timerRunIdSchema = z.object({ runId: z.string().uuid() })
export const timerRecoveryReviewSchema = z.object({
  runId: z.string().uuid(),
  decision: z.enum(['accept', 'discard'])
})
export const taskIdSchema = z.object({ id: z.string().uuid() })
export const workSessionUpdateSchema = z.object({
  id: z.string().uuid(),
  input: workSessionInputSchema
})

export type TaskInput = z.infer<typeof taskInputSchema>
export type TaskDto = z.infer<typeof taskDtoSchema>
export type WorkSessionInput = z.infer<typeof workSessionInputSchema>
export type WorkSessionDto = z.infer<typeof workSessionDtoSchema>
export type TimerStateDto = z.infer<typeof timerStateDtoSchema>
export type TimerRunDto = z.infer<typeof timerRunDtoSchema>
