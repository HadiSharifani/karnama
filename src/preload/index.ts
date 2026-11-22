import { contextBridge, ipcRenderer } from 'electron'
import { ipcChannels, type ApiResult } from '../shared/contracts/api'
import type {
  CalendarMonthDto,
  CalendarMonthInput,
  HolidayInput,
  LeaveInput,
  MonthlyCommitmentOverrideInput,
  WorkDateBoundaryInput,
  WorkDateOverrideInput
} from '../shared/contracts/calendar'
import type { SettingsDto, SettingsInput } from '../shared/contracts/settings'
import type {
  TaskDto,
  TaskInput,
  TimerStateDto,
  WorkSessionDto,
  WorkSessionInput
} from '../shared/contracts/work'

const karnamaApi = {
  settings: {
    get: () => ipcRenderer.invoke(ipcChannels.settingsGet) as Promise<ApiResult<SettingsDto>>,
    save: (input: SettingsInput) =>
      ipcRenderer.invoke(ipcChannels.settingsSave, input) as Promise<ApiResult<SettingsDto>>,
    completeOnboarding: (input: SettingsInput) =>
      ipcRenderer.invoke(ipcChannels.settingsCompleteOnboarding, input) as Promise<
        ApiResult<SettingsDto>
      >
  },
  tasks: {
    list: (includeArchived = false) =>
      ipcRenderer.invoke(ipcChannels.tasksList, { includeArchived }) as Promise<
        ApiResult<TaskDto[]>
      >,
    create: (input: TaskInput) =>
      ipcRenderer.invoke(ipcChannels.tasksCreate, input) as Promise<ApiResult<TaskDto>>,
    update: (id: string, input: TaskInput) =>
      ipcRenderer.invoke(ipcChannels.tasksUpdate, { id, input }) as Promise<ApiResult<TaskDto>>,
    archive: (id: string) =>
      ipcRenderer.invoke(ipcChannels.tasksArchive, { id }) as Promise<ApiResult<TaskDto>>,
    restore: (id: string) =>
      ipcRenderer.invoke(ipcChannels.tasksRestore, { id }) as Promise<ApiResult<TaskDto>>
  },
  sessions: {
    list: () =>
      ipcRenderer.invoke(ipcChannels.sessionsList) as Promise<ApiResult<WorkSessionDto[]>>,
    create: (input: WorkSessionInput) =>
      ipcRenderer.invoke(ipcChannels.sessionsCreate, input) as Promise<ApiResult<WorkSessionDto[]>>,
    update: (id: string, input: WorkSessionInput) =>
      ipcRenderer.invoke(ipcChannels.sessionsUpdate, { id, input }) as Promise<
        ApiResult<WorkSessionDto[]>
      >,
    delete: (id: string) =>
      ipcRenderer.invoke(ipcChannels.sessionsDelete, { id }) as Promise<ApiResult<WorkSessionDto[]>>
  },
  timer: {
    get: () => ipcRenderer.invoke(ipcChannels.timerGet) as Promise<ApiResult<TimerStateDto>>,
    start: (taskId: string | null) =>
      ipcRenderer.invoke(ipcChannels.timerStart, { taskId }) as Promise<ApiResult<TimerStateDto>>,
    pause: (runId: string) =>
      ipcRenderer.invoke(ipcChannels.timerPause, { runId }) as Promise<ApiResult<TimerStateDto>>,
    resume: (runId: string) =>
      ipcRenderer.invoke(ipcChannels.timerResume, { runId }) as Promise<ApiResult<TimerStateDto>>,
    stop: (runId: string) =>
      ipcRenderer.invoke(ipcChannels.timerStop, { runId }) as Promise<ApiResult<TimerStateDto>>,
    reviewRecovery: (runId: string, decision: 'accept' | 'discard') =>
      ipcRenderer.invoke(ipcChannels.timerReviewRecovery, { runId, decision }) as Promise<
        ApiResult<TimerStateDto>
      >
  },
  calendar: {
    month: (input: CalendarMonthInput) =>
      ipcRenderer.invoke(ipcChannels.calendarMonth, input) as Promise<ApiResult<CalendarMonthDto>>,
    setMonthlyOverride: (input: MonthlyCommitmentOverrideInput) =>
      ipcRenderer.invoke(ipcChannels.calendarSetMonthlyOverride, input) as Promise<
        ApiResult<boolean>
      >,
    setDayOverride: (input: WorkDateOverrideInput) =>
      ipcRenderer.invoke(ipcChannels.calendarSetDayOverride, input) as Promise<ApiResult<boolean>>,
    setHoliday: (input: HolidayInput) =>
      ipcRenderer.invoke(ipcChannels.calendarSetHoliday, input) as Promise<ApiResult<boolean>>,
    setLeave: (input: LeaveInput) =>
      ipcRenderer.invoke(ipcChannels.calendarSetLeave, input) as Promise<ApiResult<boolean>>,
    setBoundary: (input: WorkDateBoundaryInput) =>
      ipcRenderer.invoke(ipcChannels.calendarSetBoundary, input) as Promise<ApiResult<boolean>>
  }
}

contextBridge.exposeInMainWorld('karnama', karnamaApi)

export type KarnamaApi = typeof karnamaApi
