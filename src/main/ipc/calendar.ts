import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ZodError } from 'zod'
import { ipcChannels, type ApiErrorCode, type ApiResult } from '../../shared/contracts/api'
import { CommitmentDomainError, type createCommitmentService } from '../db/commitment-service'
import { isTrustedIpcSender } from '../security/trusted-sender'

type CommitmentService = ReturnType<typeof createCommitmentService>

export function registerCalendarIpc(
  getWindow: () => BrowserWindow | null,
  expectedOrigin: string,
  service: CommitmentService
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
      let message = 'عملیات تقویم کاری انجام نشد.'
      if (error instanceof ZodError) {
        code = 'invalid_input'
        message = error.issues[0]?.message ?? 'مقادیر واردشده معتبر نیستند.'
      } else if (error instanceof CommitmentDomainError) {
        code = error.code
        message = error.message
      }
      return { ok: false, error: { code, message } }
    }
  }

  ipcMain.handle(ipcChannels.calendarMonth, (event, input: unknown) =>
    wrap(event, () => service.calendarMonth(input))
  )
  ipcMain.handle(ipcChannels.calendarSetMonthlyOverride, (event, input: unknown) =>
    wrap(event, () => {
      service.setMonthlyOverride(input)
      return true
    })
  )
  ipcMain.handle(ipcChannels.calendarSetDayOverride, (event, input: unknown) =>
    wrap(event, () => {
      service.setDayOverride(input)
      return true
    })
  )
  ipcMain.handle(ipcChannels.calendarSetHoliday, (event, input: unknown) =>
    wrap(event, () => {
      service.setHoliday(input)
      return true
    })
  )
  ipcMain.handle(ipcChannels.calendarSetLeave, (event, input: unknown) =>
    wrap(event, () => {
      service.setLeave(input)
      return true
    })
  )
  ipcMain.handle(ipcChannels.calendarSetBoundary, (event, input: unknown) =>
    wrap(event, () => {
      service.setBoundary(input)
      return true
    })
  )
}
