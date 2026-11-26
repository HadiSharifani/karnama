export type ApiErrorCode =
  | 'invalid_input'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'recovery_required'
  | 'confirmation_required'
  | 'incompatible'
  | 'storage_error'
  | 'internal_error'

export type ApiResult<T> =
  { ok: true; data: T } | { ok: false; error: { code: ApiErrorCode; message: string } }

export const ipcChannels = {
  settingsGet: 'settings:get',
  settingsSave: 'settings:save',
  settingsCompleteOnboarding: 'settings:complete-onboarding',
  tasksList: 'tasks:list',
  tasksCreate: 'tasks:create',
  tasksUpdate: 'tasks:update',
  tasksMove: 'tasks:move',
  tasksArchive: 'tasks:archive',
  tasksRestore: 'tasks:restore',
  taskLinksList: 'task-links:list',
  taskLinksCreate: 'task-links:create',
  taskLinksUpdate: 'task-links:update',
  taskLinksDelete: 'task-links:delete',
  taskLinksOpen: 'task-links:open',
  attachmentsList: 'attachments:list',
  attachmentsImport: 'attachments:import',
  attachmentsUpdateDescription: 'attachments:update-description',
  attachmentsDelete: 'attachments:delete',
  sessionsList: 'sessions:list',
  sessionsCreate: 'sessions:create',
  sessionsUpdate: 'sessions:update',
  sessionsDelete: 'sessions:delete',
  timerGet: 'timer:get',
  timerStart: 'timer:start',
  timerPause: 'timer:pause',
  timerResume: 'timer:resume',
  timerStop: 'timer:stop',
  timerReviewRecovery: 'timer:review-recovery',
  calendarMonth: 'calendar:month',
  calendarSetMonthlyOverride: 'calendar:set-monthly-override',
  calendarSetDayOverride: 'calendar:set-day-override',
  calendarSetHoliday: 'calendar:set-holiday',
  calendarSetLeave: 'calendar:set-leave',
  calendarSetBoundary: 'calendar:set-boundary',
  analyticsGetPeriod: 'analytics:get-period',
  reportsExport: 'reports:export',
  backupsList: 'backups:list',
  backupsCreate: 'backups:create',
  backupsValidate: 'backups:validate',
  backupsChooseRestore: 'backups:choose-restore',
  backupsRestore: 'backups:restore',
  backupsDelete: 'backups:delete',
  backupsOpenLocation: 'backups:open-location',
  backupsProgress: 'backups:progress'
} as const
