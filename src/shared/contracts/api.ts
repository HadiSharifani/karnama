export type ApiErrorCode =
  | 'invalid_input'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'recovery_required'
  | 'confirmation_required'
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
  tasksArchive: 'tasks:archive',
  tasksRestore: 'tasks:restore',
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
  calendarSetBoundary: 'calendar:set-boundary'
} as const
