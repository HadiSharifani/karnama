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
  AttachmentDto,
  AttachmentImportResult,
  TaskLinkDto,
  TaskLinkInput
} from '../shared/contracts/resources'
import type {
  TaskDto,
  TaskInput,
  TimerStateDto,
  WorkSessionDto,
  WorkSessionInput
} from '../shared/contracts/work'
import type {
  AnalyticsPeriodDto,
  AnalyticsPeriodInput,
  ReportExportInput,
  ReportExportResult
} from '../shared/contracts/analytics'
import type {
  BackupProgressDto,
  BackupSummaryDto,
  RestoreSelectionDto
} from '../shared/contracts/backups'

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
    move: (id: string, status: TaskDto['status'], index: number) =>
      ipcRenderer.invoke(ipcChannels.tasksMove, { id, status, index }) as Promise<
        ApiResult<TaskDto>
      >,
    archive: (id: string) =>
      ipcRenderer.invoke(ipcChannels.tasksArchive, { id }) as Promise<ApiResult<TaskDto>>,
    restore: (id: string) =>
      ipcRenderer.invoke(ipcChannels.tasksRestore, { id }) as Promise<ApiResult<TaskDto>>
  },
  resources: {
    links: {
      list: (taskId: string) =>
        ipcRenderer.invoke(ipcChannels.taskLinksList, { taskId }) as Promise<
          ApiResult<TaskLinkDto[]>
        >,
      create: (taskId: string, input: TaskLinkInput) =>
        ipcRenderer.invoke(ipcChannels.taskLinksCreate, { taskId, input }) as Promise<
          ApiResult<TaskLinkDto>
        >,
      update: (id: string, input: TaskLinkInput) =>
        ipcRenderer.invoke(ipcChannels.taskLinksUpdate, { id, input }) as Promise<
          ApiResult<TaskLinkDto>
        >,
      delete: (id: string) =>
        ipcRenderer.invoke(ipcChannels.taskLinksDelete, { id }) as Promise<ApiResult<boolean>>,
      open: (id: string) =>
        ipcRenderer.invoke(ipcChannels.taskLinksOpen, { id }) as Promise<ApiResult<boolean>>
    },
    attachments: {
      list: (taskId: string) =>
        ipcRenderer.invoke(ipcChannels.attachmentsList, { taskId }) as Promise<
          ApiResult<AttachmentDto[]>
        >,
      import: (taskId: string) =>
        ipcRenderer.invoke(ipcChannels.attachmentsImport, { taskId }) as Promise<
          ApiResult<AttachmentImportResult>
        >,
      updateDescription: (id: string, description: string) =>
        ipcRenderer.invoke(ipcChannels.attachmentsUpdateDescription, {
          id,
          description
        }) as Promise<ApiResult<AttachmentDto>>,
      delete: (id: string) =>
        ipcRenderer.invoke(ipcChannels.attachmentsDelete, { id }) as Promise<ApiResult<boolean>>
    }
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
  },
  analytics: {
    getPeriod: (input: AnalyticsPeriodInput) =>
      ipcRenderer.invoke(ipcChannels.analyticsGetPeriod, input) as Promise<
        ApiResult<AnalyticsPeriodDto>
      >
  },
  reports: {
    export: (input: ReportExportInput) =>
      ipcRenderer.invoke(ipcChannels.reportsExport, input) as Promise<ApiResult<ReportExportResult>>
  },
  backups: {
    list: () =>
      ipcRenderer.invoke(ipcChannels.backupsList) as Promise<ApiResult<BackupSummaryDto[]>>,
    create: () =>
      ipcRenderer.invoke(ipcChannels.backupsCreate) as Promise<ApiResult<BackupSummaryDto>>,
    validate: (id: string) =>
      ipcRenderer.invoke(ipcChannels.backupsValidate, { id }) as Promise<
        ApiResult<BackupSummaryDto>
      >,
    chooseRestore: () =>
      ipcRenderer.invoke(ipcChannels.backupsChooseRestore) as Promise<
        ApiResult<RestoreSelectionDto | null>
      >,
    restore: (id: string) =>
      ipcRenderer.invoke(ipcChannels.backupsRestore, { id }) as Promise<ApiResult<boolean>>,
    delete: (id: string) =>
      ipcRenderer.invoke(ipcChannels.backupsDelete, { id }) as Promise<ApiResult<boolean>>,
    openLocation: () =>
      ipcRenderer.invoke(ipcChannels.backupsOpenLocation) as Promise<ApiResult<boolean>>,
    onProgress: (callback: (progress: BackupProgressDto) => void) => {
      const listener = (_event: Electron.IpcRendererEvent, input: unknown) => {
        callback(input as BackupProgressDto)
      }
      ipcRenderer.on(ipcChannels.backupsProgress, listener)
      return () => {
        ipcRenderer.removeListener(ipcChannels.backupsProgress, listener)
      }
    }
  }
}

contextBridge.exposeInMainWorld('karnama', karnamaApi)

export type KarnamaApi = typeof karnamaApi
