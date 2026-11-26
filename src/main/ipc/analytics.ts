import { ipcMain, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { ZodError } from 'zod'
import { ipcChannels, type ApiErrorCode, type ApiResult } from '../../shared/contracts/api'
import { CommitmentDomainError } from '../db/commitment-service'
import type { createAnalyticsService } from '../db/analytics-service'
import { ReportExportError, type createReportExportService } from '../reports/report-export-service'
import { isTrustedIpcSender } from '../security/trusted-sender'

type AnalyticsService = ReturnType<typeof createAnalyticsService>
type ReportExportService = ReturnType<typeof createReportExportService>

export function registerAnalyticsIpc(
  getWindow: () => BrowserWindow | null,
  expectedOrigin: string,
  services: {
    analytics: AnalyticsService
    reports: ReportExportService
  }
) {
  const wrap = async <T>(
    event: IpcMainInvokeEvent,
    operation: () => T | Promise<T>
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

      return { ok: true, data: await operation() }
    } catch (error) {
      let code: ApiErrorCode = 'storage_error'
      let message = 'گزارش کاری آماده نشد.'
      if (error instanceof ZodError) {
        code = 'invalid_input'
        message = error.issues[0]?.message ?? 'مقادیر گزارش معتبر نیستند.'
      } else if (error instanceof CommitmentDomainError || error instanceof ReportExportError) {
        code = error.code
        message = error.message
      }
      return { ok: false, error: { code, message } }
    }
  }

  ipcMain.handle(ipcChannels.analyticsGetPeriod, (event, input: unknown) =>
    wrap(event, () => services.analytics.getPeriod(input))
  )
  ipcMain.handle(ipcChannels.reportsExport, (event, input: unknown) =>
    wrap(event, () => services.reports.exportReport(input))
  )
}
