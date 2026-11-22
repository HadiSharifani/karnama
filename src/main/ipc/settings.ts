import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ZodError } from 'zod'
import { ipcChannels, type ApiErrorCode, type ApiResult } from '../../shared/contracts/api'
import { type SettingsDto } from '../../shared/contracts/settings'
import { isTrustedIpcSender } from '../security/trusted-sender'

type SettingsService = {
  get: () => SettingsDto
  save: (input: unknown) => SettingsDto
  completeOnboarding: (input: unknown) => SettingsDto
}

export function registerSettingsIpc(
  getWindow: () => BrowserWindow | null,
  expectedOrigin: string,
  settingsService: SettingsService
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
      const code: ApiErrorCode = error instanceof ZodError ? 'invalid_input' : 'storage_error'
      const message =
        error instanceof ZodError
          ? (error.issues[0]?.message ?? 'مقادیر تنظیمات معتبر نیستند.')
          : 'خواندن یا ذخیره تنظیمات انجام نشد.'
      return { ok: false, error: { code, message } }
    }
  }

  ipcMain.handle(ipcChannels.settingsGet, (event) => wrap(event, () => settingsService.get()))
  ipcMain.handle(ipcChannels.settingsSave, (event, input: unknown) =>
    wrap(event, () => settingsService.save(input))
  )
  ipcMain.handle(ipcChannels.settingsCompleteOnboarding, (event, input: unknown) =>
    wrap(event, () => settingsService.completeOnboarding(input))
  )
}
