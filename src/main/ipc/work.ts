import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ZodError } from 'zod'
import { ipcChannels, type ApiErrorCode, type ApiResult } from '../../shared/contracts/api'
import { isTrustedIpcSender } from '../security/trusted-sender'
import { WorkDomainError, type createWorkService } from '../db/work-service'

type WorkService = ReturnType<typeof createWorkService>

export function registerWorkIpc(
  getWindow: () => BrowserWindow | null,
  expectedOrigin: string,
  service: WorkService
) {
  const wrap = <T>(event: IpcMainInvokeEvent, operation: () => T): ApiResult<T> => {
    try {
      const window = getWindow()
      if (
        !window ||
        !isTrustedIpcSender({
          sender: event.sender,
          expectedSender: window.webContents,
          frame: event.senderFrame,
          mainFrame: window.webContents.mainFrame,
          expectedOrigin
        })
      ) {
        return {
          ok: false,
          error: { code: 'unauthorized', message: 'درخواست از منبع معتبر برنامه ارسال نشده است.' }
        }
      }

      return { ok: true, data: operation() }
    } catch (error) {
      let code: ApiErrorCode = 'storage_error'
      let message = 'عملیات انجام نشد. دوباره تلاش کنید.'
      if (error instanceof ZodError) {
        code = 'invalid_input'
        message = error.issues[0]?.message ?? 'مقادیر واردشده معتبر نیستند.'
      } else if (error instanceof WorkDomainError) {
        code = error.code
        message = error.message
      }
      return { ok: false, error: { code, message } }
    }
  }

  ipcMain.handle(ipcChannels.tasksList, (event, input: unknown) =>
    wrap(event, () => service.listTasks(input))
  )
  ipcMain.handle(ipcChannels.tasksCreate, (event, input: unknown) =>
    wrap(event, () => service.createTask(input))
  )
  ipcMain.handle(ipcChannels.tasksUpdate, (event, input: unknown) =>
    wrap(event, () => service.updateTask(input))
  )
  ipcMain.handle(ipcChannels.tasksArchive, (event, input: unknown) =>
    wrap(event, () => service.archiveTask(input))
  )
  ipcMain.handle(ipcChannels.tasksRestore, (event, input: unknown) =>
    wrap(event, () => service.restoreTask(input))
  )
  ipcMain.handle(ipcChannels.sessionsList, (event) => wrap(event, () => service.listSessions()))
  ipcMain.handle(ipcChannels.sessionsCreate, (event, input: unknown) =>
    wrap(event, () => service.createManualSession(input))
  )
  ipcMain.handle(ipcChannels.sessionsUpdate, (event, input: unknown) =>
    wrap(event, () => service.updateSession(input))
  )
  ipcMain.handle(ipcChannels.sessionsDelete, (event, input: unknown) =>
    wrap(event, () => service.deleteSession(input))
  )
  ipcMain.handle(ipcChannels.timerGet, (event) => wrap(event, () => service.timerState()))
  ipcMain.handle(ipcChannels.timerStart, (event, input: unknown) =>
    wrap(event, () => service.startTimer(input))
  )
  ipcMain.handle(ipcChannels.timerPause, (event, input: unknown) =>
    wrap(event, () => service.pauseTimer(input))
  )
  ipcMain.handle(ipcChannels.timerResume, (event, input: unknown) =>
    wrap(event, () => service.resumeTimer(input))
  )
  ipcMain.handle(ipcChannels.timerStop, (event, input: unknown) =>
    wrap(event, () => service.stopTimer(input))
  )
  ipcMain.handle(ipcChannels.timerReviewRecovery, (event, input: unknown) =>
    wrap(event, () => service.reviewRecovery(input))
  )
}
