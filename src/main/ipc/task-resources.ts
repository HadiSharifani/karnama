import { dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ZodError } from 'zod'
import {
  attachmentDescriptionInputSchema,
  attachmentImportResultSchema,
  resourceIdSchema,
  resourceTaskIdSchema,
  taskLinkCreateSchema,
  taskLinkUpdateSchema
} from '../../shared/contracts/resources'
import { ipcChannels, type ApiErrorCode, type ApiResult } from '../../shared/contracts/api'
import { isTrustedIpcSender } from '../security/trusted-sender'
import { ResourceDomainError, type createTaskResourceService } from '../db/task-resource-service'

type TaskResourceService = ReturnType<typeof createTaskResourceService>
type ImageDialogResult = { canceled: boolean; filePaths: string[] }

type Dependencies = {
  chooseImages?: (window: BrowserWindow) => Promise<ImageDialogResult>
  openExternal?: (url: string) => Promise<void>
}

export function registerTaskResourceIpc(
  getWindow: () => BrowserWindow | null,
  expectedOrigin: string,
  service: TaskResourceService,
  dependencies: Dependencies = {}
) {
  const chooseImages =
    dependencies.chooseImages ??
    (async (window: BrowserWindow) =>
      dialog.showOpenDialog(window, {
        title: 'انتخاب تصویر برای پیوست',
        properties: ['openFile', 'multiSelections'],
        filters: [{ name: 'تصاویر', extensions: ['png', 'jpg', 'jpeg', 'webp'] }]
      }))
  const openExternal = dependencies.openExternal ?? ((url: string) => shell.openExternal(url))

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
      let message = 'عملیات پیوست‌ها انجام نشد. دوباره تلاش کنید.'
      if (error instanceof ZodError) {
        code = 'invalid_input'
        message = error.issues[0]?.message ?? 'مقادیر واردشده معتبر نیستند.'
      } else if (error instanceof ResourceDomainError) {
        code = error.code
        message = error.message
      }
      return { ok: false, error: { code, message } }
    }
  }

  ipcMain.handle(ipcChannels.taskLinksList, (event, input: unknown) =>
    wrap(event, () => {
      resourceTaskIdSchema.parse(input)
      return service.listLinks(input)
    })
  )
  ipcMain.handle(ipcChannels.taskLinksCreate, (event, input: unknown) =>
    wrap(event, () => {
      taskLinkCreateSchema.parse(input)
      return service.createLink(input)
    })
  )
  ipcMain.handle(ipcChannels.taskLinksUpdate, (event, input: unknown) =>
    wrap(event, () => {
      taskLinkUpdateSchema.parse(input)
      return service.updateLink(input)
    })
  )
  ipcMain.handle(ipcChannels.taskLinksDelete, (event, input: unknown) =>
    wrap(event, () => {
      resourceIdSchema.parse(input)
      service.deleteLink(input)
      return true
    })
  )
  ipcMain.handle(ipcChannels.taskLinksOpen, (event, input: unknown) =>
    wrap(event, async () => {
      resourceIdSchema.parse(input)
      const url = await service.getLinkUrl(input)
      await openExternal(url)
      return true
    })
  )
  ipcMain.handle(ipcChannels.attachmentsList, (event, input: unknown) =>
    wrap(event, () => {
      resourceTaskIdSchema.parse(input)
      return service.listAttachments(input)
    })
  )
  ipcMain.handle(ipcChannels.attachmentsImport, (event, input: unknown) =>
    wrap(event, async (window) => {
      const { taskId } = resourceTaskIdSchema.parse(input)
      const selection = await chooseImages(window)
      if (selection.canceled || !selection.filePaths.length) {
        return attachmentImportResultSchema.parse({ cancelled: true, attachments: [] })
      }
      const attachments = await service.importImages({ taskId }, selection.filePaths)
      return attachmentImportResultSchema.parse({ cancelled: false, attachments })
    })
  )
  ipcMain.handle(ipcChannels.attachmentsUpdateDescription, (event, input: unknown) =>
    wrap(event, () => {
      attachmentDescriptionInputSchema.parse(input)
      return service.updateAttachmentDescription(input)
    })
  )
  ipcMain.handle(ipcChannels.attachmentsDelete, (event, input: unknown) =>
    wrap(event, async () => {
      resourceIdSchema.parse(input)
      await service.deleteAttachment(input)
      return true
    })
  )
}
