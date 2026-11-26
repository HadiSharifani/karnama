import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ZodError } from 'zod'
import { backupTargetSchema } from '../../shared/contracts/backups'
import { ipcChannels, type ApiErrorCode, type ApiResult } from '../../shared/contracts/api'
import { BackupServiceError, type createBackupService } from '../backup/backup-service'
import { isTrustedIpcSender } from '../security/trusted-sender'

type BackupService = ReturnType<typeof createBackupService>

export function registerBackupIpc(
  getWindow: () => BrowserWindow | null,
  expectedOrigin: string,
  service: BackupService,
  dependencies: {
    chooseRestoreArchive?: (window: BrowserWindow) => Promise<string | null>
    openLocation?: (path: string) => Promise<string>
  } = {}
) {
  const chooseRestoreArchive =
    dependencies.chooseRestoreArchive ??
    (async (window: BrowserWindow) => {
      const result = await dialog.showOpenDialog(window, {
        title: 'انتخاب نسخهٔ پشتیبان کارنما',
        properties: ['openFile'],
        filters: [{ name: 'نسخهٔ پشتیبان کارنما', extensions: ['zip'] }]
      })
      return result.canceled ? null : (result.filePaths[0] ?? null)
    })
  const openLocation = dependencies.openLocation ?? ((path: string) => shell.openPath(path))

  const wrap = async <T>(
    event: IpcMainInvokeEvent,
    operation: (window: BrowserWindow) => T | Promise<T>
  ): Promise<ApiResult<T>> => {
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
      return { ok: true, data: await operation(window) }
    } catch (error) {
      let code: ApiErrorCode = 'storage_error'
      let message = 'عملیات نسخهٔ پشتیبان انجام نشد.'
      if (error instanceof ZodError) {
        code = 'invalid_input'
        message = error.issues[0]?.message ?? 'شناسهٔ نسخهٔ پشتیبان معتبر نیست.'
      } else if (error instanceof BackupServiceError) {
        code = error.code
        message = error.message
      }
      return { ok: false, error: { code, message } }
    }
  }

  ipcMain.handle(ipcChannels.backupsList, (event) => wrap(event, () => service.listBackups()))
  ipcMain.handle(ipcChannels.backupsCreate, (event) => wrap(event, () => service.createBackup()))
  ipcMain.handle(ipcChannels.backupsValidate, (event, input: unknown) =>
    wrap(event, () => {
      backupTargetSchema.parse(input)
      return service.validateBackup((input as { id: string }).id)
    })
  )
  ipcMain.handle(ipcChannels.backupsChooseRestore, (event) =>
    wrap(event, async (window) => {
      const path = await chooseRestoreArchive(window)
      if (!path) return null
      return service.chooseRestoreBackupForPath(path)
    })
  )
  ipcMain.handle(ipcChannels.backupsRestore, (event, input: unknown) =>
    wrap(event, () => {
      backupTargetSchema.parse(input)
      return service.restoreBackup((input as { id: string }).id)
    })
  )
  ipcMain.handle(ipcChannels.backupsDelete, (event, input: unknown) =>
    wrap(event, () => {
      backupTargetSchema.parse(input)
      return service.deleteBackup((input as { id: string }).id)
    })
  )
  ipcMain.handle(ipcChannels.backupsOpenLocation, (event) =>
    wrap(event, async () => {
      const error = await openLocation(service.backupsDirectory)
      if (error) throw new BackupServiceError('storage_error', 'پوشهٔ نسخه‌های پشتیبان باز نشد.')
      return true
    })
  )
}
