import { sql } from 'drizzle-orm'
import { check, index, integer, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

export const userProfile = sqliteTable('user_profile', {
  id: integer('id').primaryKey(),
  displayName: text('display_name').notNull().default(''),
  jobTitle: text('job_title').notNull().default('Product Designer'),
  updatedAt: integer('updated_at').notNull()
})

export const appSettings = sqliteTable(
  'app_settings',
  {
    id: integer('id').primaryKey(),
    dailyCommitmentMinutes: integer('daily_commitment_minutes').notNull().default(480),
    workingWeekdaysJson: text('working_weekdays_json').notNull().default('[6,7,1,2,3,4]'),
    weeklyHolidayIsoDay: integer('weekly_holiday_iso_day').notNull().default(5),
    workDateBoundaryMinutes: integer('work_date_boundary_minutes').notNull().default(360),
    calendar: text('calendar', { enum: ['jalali', 'gregorian'] })
      .notNull()
      .default('jalali'),
    theme: text('theme', { enum: ['system', 'light', 'dark'] })
      .notNull()
      .default('system'),
    timezoneId: text('timezone_id').notNull(),
    onboardingCompletedAt: integer('onboarding_completed_at'),
    createdAt: integer('created_at').notNull(),
    updatedAt: integer('updated_at').notNull()
  },
  (table) => [
    check('app_settings_singleton_check', sql`${table.id} = 1`),
    check(
      'app_settings_daily_commitment_check',
      sql`${table.dailyCommitmentMinutes} BETWEEN 15 AND 1440`
    ),
    check('app_settings_weekday_check', sql`${table.weeklyHolidayIsoDay} BETWEEN 1 AND 7`),
    check('app_settings_boundary_check', sql`${table.workDateBoundaryMinutes} BETWEEN 0 AND 1439`)
  ]
)

export const appMetadata = sqliteTable('app_metadata', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: integer('updated_at').notNull()
})

export const tasks = sqliteTable(
  'tasks',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    notes: text('notes').notNull().default(''),
    status: text('status', {
      enum: ['todo', 'in_progress', 'waiting_feedback', 'on_hold', 'done']
    })
      .notNull()
      .default('todo'),
    position: integer('position').notNull().default(0),
    priority: text('priority', { enum: ['low', 'medium', 'high'] })
      .notNull()
      .default('medium'),
    estimatedDurationMinutes: integer('estimated_duration_minutes'),
    createdAtUtcMs: integer('created_at_utc_ms').notNull(),
    updatedAtUtcMs: integer('updated_at_utc_ms').notNull(),
    completedAtUtcMs: integer('completed_at_utc_ms'),
    archivedAtUtcMs: integer('archived_at_utc_ms')
  },
  (table) => [
    check(
      'tasks_status_check',
      sql`${table.status} IN ('todo', 'in_progress', 'waiting_feedback', 'on_hold', 'done')`
    ),
    check('tasks_priority_check', sql`${table.priority} IN ('low', 'medium', 'high')`),
    check(
      'tasks_estimated_duration_check',
      sql`${table.estimatedDurationMinutes} IS NULL OR ${table.estimatedDurationMinutes} BETWEEN 1 AND 1000000`
    ),
    check('tasks_position_check', sql`${table.position} >= 0`),
    index('tasks_archive_updated_idx').on(table.archivedAtUtcMs, table.updatedAtUtcMs),
    index('tasks_status_idx').on(table.status),
    index('tasks_board_position_idx').on(table.status, table.archivedAtUtcMs, table.position)
  ]
)

export const taskLinks = sqliteTable(
  'task_links',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    url: text('url').notNull(),
    title: text('title').notNull(),
    type: text('type', { enum: ['figma', 'external'] }).notNull(),
    createdAtUtcMs: integer('created_at_utc_ms').notNull()
  },
  (table) => [
    check('task_links_type_check', sql`${table.type} IN ('figma', 'external')`),
    index('task_links_task_created_idx').on(table.taskId, table.createdAtUtcMs)
  ]
)

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    displayName: text('display_name').notNull(),
    mimeType: text('mime_type', { enum: ['image/png', 'image/jpeg', 'image/webp'] }).notNull(),
    fileSizeBytes: integer('file_size_bytes').notNull(),
    description: text('description'),
    createdAtUtcMs: integer('created_at_utc_ms').notNull(),
    storageRef: text('storage_ref').notNull()
  },
  (table) => [
    check(
      'attachments_mime_type_check',
      sql`${table.mimeType} IN ('image/png', 'image/jpeg', 'image/webp')`
    ),
    check('attachments_file_size_check', sql`${table.fileSizeBytes} BETWEEN 1 AND 20971520`),
    index('attachments_task_created_idx').on(table.taskId, table.createdAtUtcMs),
    uniqueIndex('attachments_storage_ref_idx').on(table.storageRef)
  ]
)

export const timerRuns = sqliteTable(
  'timer_runs',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    status: text('status', { enum: ['running', 'paused', 'stopped'] })
      .notNull()
      .default('running'),
    startedAtUtcMs: integer('started_at_utc_ms').notNull(),
    currentSegmentStartedAtUtcMs: integer('current_segment_started_at_utc_ms'),
    checkpointAtUtcMs: integer('checkpoint_at_utc_ms'),
    timeZoneId: text('time_zone_id').notNull(),
    workDateBoundaryMinutes: integer('work_date_boundary_minutes').notNull(),
    recoveryStartUtcMs: integer('recovery_start_utc_ms'),
    recoveryEndUtcMs: integer('recovery_end_utc_ms'),
    recoveryReviewedAtUtcMs: integer('recovery_reviewed_at_utc_ms'),
    createdAtUtcMs: integer('created_at_utc_ms').notNull(),
    updatedAtUtcMs: integer('updated_at_utc_ms').notNull()
  },
  (table) => [
    check('timer_runs_status_check', sql`${table.status} IN ('running', 'paused', 'stopped')`),
    check('timer_runs_boundary_check', sql`${table.workDateBoundaryMinutes} BETWEEN 0 AND 1439`),
    check(
      'timer_runs_recovery_range_check',
      sql`${table.recoveryStartUtcMs} IS NULL OR (${table.recoveryEndUtcMs} IS NOT NULL AND ${table.recoveryEndUtcMs} >= ${table.recoveryStartUtcMs})`
    ),
    uniqueIndex('timer_one_running_idx')
      .on(table.status)
      .where(sql`${table.status} = 'running'`),
    index('timer_runs_status_updated_idx').on(table.status, table.updatedAtUtcMs)
  ]
)

export const workSessions = sqliteTable(
  'work_sessions',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
    timerRunId: text('timer_run_id').references(() => timerRuns.id, { onDelete: 'set null' }),
    source: text('source', { enum: ['manual', 'timer', 'recovery'] }).notNull(),
    startUtcMs: integer('start_utc_ms').notNull(),
    endUtcMs: integer('end_utc_ms').notNull(),
    timeZoneId: text('time_zone_id').notNull(),
    workDateBoundaryMinutes: integer('work_date_boundary_minutes').notNull(),
    allocationMode: text('allocation_mode', { enum: ['boundary', 'manual'] })
      .notNull()
      .default('boundary'),
    createdAtUtcMs: integer('created_at_utc_ms').notNull(),
    updatedAtUtcMs: integer('updated_at_utc_ms').notNull()
  },
  (table) => [
    check('work_sessions_time_check', sql`${table.endUtcMs} > ${table.startUtcMs}`),
    check('work_sessions_boundary_check', sql`${table.workDateBoundaryMinutes} BETWEEN 0 AND 1439`),
    index('work_sessions_range_idx').on(table.startUtcMs, table.endUtcMs),
    index('work_sessions_task_start_idx').on(table.taskId, table.startUtcMs),
    index('work_sessions_timer_run_idx').on(table.timerRunId)
  ]
)

export const workDateAllocations = sqliteTable(
  'work_date_allocations',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    sessionId: text('session_id')
      .notNull()
      .references(() => workSessions.id, { onDelete: 'cascade' }),
    segmentIndex: integer('segment_index').notNull(),
    startUtcMs: integer('start_utc_ms').notNull(),
    endUtcMs: integer('end_utc_ms').notNull(),
    workDate: text('work_date').notNull(),
    source: text('source', { enum: ['boundary', 'manual'] }).notNull()
  },
  (table) => [
    check('work_date_allocation_range_check', sql`${table.endUtcMs} > ${table.startUtcMs}`),
    check('work_date_allocation_segment_check', sql`${table.segmentIndex} >= 0`),
    uniqueIndex('work_date_allocation_session_segment_idx').on(table.sessionId, table.segmentIndex),
    index('work_date_allocations_date_idx').on(table.workDate)
  ]
)

export const workScheduleVersions = sqliteTable(
  'work_schedule_versions',
  {
    id: text('id').primaryKey(),
    effectiveFromWorkDate: text('effective_from_work_date').notNull(),
    timeZoneId: text('time_zone_id').notNull(),
    workDateBoundaryMinutes: integer('work_date_boundary_minutes').notNull(),
    dailyCommitmentMinutes: integer('daily_commitment_minutes').notNull(),
    weeklyHolidayIsoDay: integer('weekly_holiday_iso_day').notNull(),
    workingWeekdaysJson: text('working_weekdays_json').notNull(),
    createdAtUtcMs: integer('created_at_utc_ms').notNull()
  },
  (table) => [
    check('work_schedule_boundary_check', sql`${table.workDateBoundaryMinutes} BETWEEN 0 AND 1439`),
    check('work_schedule_daily_check', sql`${table.dailyCommitmentMinutes} BETWEEN 0 AND 1440`),
    check('work_schedule_holiday_check', sql`${table.weeklyHolidayIsoDay} BETWEEN 1 AND 7`),
    index('work_schedule_effective_idx').on(table.effectiveFromWorkDate)
  ]
)

export const workDateOverrides = sqliteTable(
  'work_date_overrides',
  {
    workDate: text('work_date').primaryKey(),
    targetMinutes: integer('target_minutes').notNull(),
    updatedAtUtcMs: integer('updated_at_utc_ms').notNull()
  },
  (table) => [
    check('work_date_override_minutes_check', sql`${table.targetMinutes} BETWEEN 0 AND 1440`)
  ]
)

export const holidays = sqliteTable('holidays', {
  workDate: text('work_date').primaryKey(),
  name: text('name').notNull(),
  kind: text('kind', { enum: ['public', 'custom'] }).notNull(),
  createdAtUtcMs: integer('created_at_utc_ms').notNull()
})

export const leaveEntries = sqliteTable(
  'leave_entries',
  {
    id: text('id').primaryKey(),
    groupId: text('group_id').notNull(),
    workDate: text('work_date').notNull(),
    kind: text('kind', { enum: ['full', 'half', 'custom'] }).notNull(),
    customMinutes: integer('custom_minutes'),
    status: text('status', { enum: ['pending', 'approved', 'rejected'] }).notNull(),
    createdAtUtcMs: integer('created_at_utc_ms').notNull(),
    updatedAtUtcMs: integer('updated_at_utc_ms').notNull()
  },
  (table) => [
    check(
      'leave_custom_minutes_check',
      sql`${table.customMinutes} IS NULL OR ${table.customMinutes} BETWEEN 1 AND 1440`
    ),
    uniqueIndex('leave_group_date_idx').on(table.groupId, table.workDate),
    index('leave_date_status_idx').on(table.workDate, table.status)
  ]
)

export const workDateBoundaryOverrides = sqliteTable(
  'work_date_boundary_overrides',
  {
    workDate: text('work_date').primaryKey(),
    boundaryMinutes: integer('boundary_minutes').notNull(),
    updatedAtUtcMs: integer('updated_at_utc_ms').notNull()
  },
  (table) => [
    check('work_date_boundary_override_check', sql`${table.boundaryMinutes} BETWEEN 0 AND 1439`)
  ]
)

export const monthlyCommitments = sqliteTable(
  'monthly_commitments',
  {
    id: text('id').primaryKey(),
    calendar: text('calendar', { enum: ['jalali', 'gregorian'] }).notNull(),
    periodKey: text('period_key').notNull(),
    periodStartWorkDate: text('period_start_work_date').notNull(),
    periodEndWorkDate: text('period_end_work_date').notNull(),
    revision: integer('revision').notNull(),
    targetMinutes: integer('target_minutes').notNull(),
    overrideMinutes: integer('override_minutes'),
    isCurrent: integer('is_current', { mode: 'boolean' }).notNull().default(true),
    createdAtUtcMs: integer('created_at_utc_ms').notNull()
  },
  (table) => [
    uniqueIndex('monthly_commitment_revision_idx').on(
      table.calendar,
      table.periodKey,
      table.revision
    ),
    uniqueIndex('monthly_commitment_current_idx')
      .on(table.calendar, table.periodKey)
      .where(sql`${table.isCurrent} = 1`),
    index('monthly_commitment_range_idx').on(table.periodStartWorkDate, table.periodEndWorkDate)
  ]
)

export const monthlyCommitmentDays = sqliteTable(
  'monthly_commitment_days',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    commitmentId: text('commitment_id')
      .notNull()
      .references(() => monthlyCommitments.id, { onDelete: 'cascade' }),
    workDate: text('work_date').notNull(),
    scheduleVersionId: text('schedule_version_id').references(() => workScheduleVersions.id),
    scheduledMinutes: integer('scheduled_minutes').notNull(),
    approvedLeaveMinutes: integer('approved_leave_minutes').notNull(),
    targetMinutes: integer('target_minutes').notNull()
  },
  (table) => [
    uniqueIndex('monthly_commitment_day_idx').on(table.commitmentId, table.workDate),
    index('monthly_commitment_day_date_idx').on(table.workDate)
  ]
)

export const reportSnapshots = sqliteTable(
  'report_snapshots',
  {
    id: text('id').primaryKey(),
    reportType: text('report_type', { enum: ['company', 'personal'] }).notNull(),
    calendar: text('calendar', { enum: ['jalali', 'gregorian'] }).notNull(),
    periodKey: text('period_key').notNull(),
    periodStartWorkDate: text('period_start_work_date').notNull(),
    periodEndWorkDate: text('period_end_work_date').notNull(),
    format: text('format', { enum: ['pdf', 'html'] }).notNull(),
    generatedAtUtcMs: integer('generated_at_utc_ms').notNull(),
    payloadJson: text('payload_json').notNull()
  },
  (table) => [
    check('report_snapshots_type_check', sql`${table.reportType} IN ('company', 'personal')`),
    check('report_snapshots_calendar_check', sql`${table.calendar} IN ('jalali', 'gregorian')`),
    check('report_snapshots_format_check', sql`${table.format} IN ('pdf', 'html')`),
    check(
      'report_snapshots_period_check',
      sql`${table.periodStartWorkDate} <= ${table.periodEndWorkDate}`
    ),
    index('report_snapshots_period_created_idx').on(
      table.calendar,
      table.periodKey,
      table.generatedAtUtcMs
    )
  ]
)
