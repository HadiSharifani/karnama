import { app, BrowserWindow, dialog } from 'electron'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { reportExportInputSchema, reportExportResultSchema } from '../../shared/contracts/analytics'
import type { AnalyticsPeriodDto } from '../../shared/contracts/analytics'
import { buildReportHtml, type EmbeddedImage } from './report-html'

type Options = {
  getWindow: () => BrowserWindow | null
  getSnapshot: (snapshotId: string) => AnalyticsPeriodDto | null
  persistSnapshot: (
    snapshotId: string,
    reportType: 'company' | 'personal',
    format: 'pdf' | 'html'
  ) => boolean
  readAttachmentImage: (input: unknown) => Promise<{ mimeType: string; bytes: Uint8Array }>
  arabicFontPath: string
  latinFontPath: string
}

export class ReportExportError extends Error {
  constructor(
    readonly code: 'not_found' | 'storage_error',
    message: string
  ) {
    super(message)
  }
}

export function createReportExportService(options: Options) {
  async function exportReport(input: unknown) {
    const parsed = reportExportInputSchema.parse(input)
    const report = options.getSnapshot(parsed.snapshotId)
    if (!report) {
      throw new ReportExportError(
        'not_found',
        'داده گزارش در دسترس نیست؛ گزارش را دوباره بارگذاری کنید.'
      )
    }

    const extension = parsed.format === 'pdf' ? 'pdf' : 'html'
    const periodName = report.period.periodKey.replace(':', '-')
    const defaultPath = join(
      app.getPath('documents'),
      `Karnama-${parsed.reportType}-${periodName}.${extension}`
    )
    const saveOptions = {
      title: parsed.format === 'pdf' ? 'ذخیره گزارش PDF' : 'ذخیره گزارش HTML',
      defaultPath,
      filters: [
        {
          name: parsed.format === 'pdf' ? 'گزارش PDF' : 'گزارش HTML',
          extensions: [extension]
        }
      ]
    }
    const window = options.getWindow()
    const selection = window
      ? await dialog.showSaveDialog(window, saveOptions)
      : await dialog.showSaveDialog(saveOptions)
    if (selection.canceled || !selection.filePath) {
      return reportExportResultSchema.parse({ saved: false, format: parsed.format, fileName: null })
    }

    try {
      const [arabicFont, latinFont, images] = await Promise.all([
        readFile(options.arabicFontPath),
        readFile(options.latinFontPath),
        loadImages(report, options.readAttachmentImage)
      ])
      const html = buildReportHtml(report, parsed.reportType, images, {
        arabic: arabicFont.toString('base64'),
        latin: latinFont.toString('base64')
      })
      if (!options.persistSnapshot(parsed.snapshotId, parsed.reportType, parsed.format)) {
        throw new ReportExportError(
          'not_found',
          'داده گزارش در دسترس نیست؛ گزارش را دوباره بارگذاری کنید.'
        )
      }
      if (parsed.format === 'html') {
        await writeFile(selection.filePath, html, 'utf8')
      } else {
        await writePdf(selection.filePath, html)
      }
      return reportExportResultSchema.parse({
        saved: true,
        format: parsed.format,
        fileName: basename(selection.filePath)
      })
    } catch (error) {
      if (error instanceof ReportExportError) throw error
      throw new ReportExportError('storage_error', 'ساخت یا ذخیره گزارش انجام نشد.')
    }
  }

  return { exportReport }
}

async function loadImages(
  report: AnalyticsPeriodDto,
  readAttachmentImage: Options['readAttachmentImage']
) {
  const images = new Map<string, EmbeddedImage>()
  const attachments = report.tasks.flatMap((task) => task.attachments)
  for (const attachment of attachments) {
    try {
      const image = await readAttachmentImage({ id: attachment.id })
      if (image.mimeType !== attachment.mimeType) continue
      images.set(attachment.id, {
        mimeType: image.mimeType,
        base64: Buffer.from(image.bytes).toString('base64')
      })
    } catch {
      // Keep the rest of the report available when a previously attached file is missing.
    }
  }
  return images
}

async function writePdf(outputPath: string, html: string) {
  const directory = await mkdtemp(join(tmpdir(), 'karnama-report-'))
  const reportPath = join(directory, 'report.html')
  const reportUrl = pathToFileURL(reportPath).toString()
  let window: BrowserWindow | null = null

  try {
    await writeFile(reportPath, html, 'utf8')
    window = new BrowserWindow({
      show: false,
      width: 1024,
      height: 768,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        webSecurity: true
      }
    })
    window.removeMenu()
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, target) => {
      if (target !== reportUrl) event.preventDefault()
    })
    await window.loadURL(reportUrl)
    const pdf = await window.webContents.printToPDF({
      pageSize: 'A4',
      printBackground: true,
      landscape: false,
      preferCSSPageSize: true,
      margins: { top: 0.55, bottom: 0.7, left: 0.5, right: 0.5 },
      headerTemplate:
        '<div style="font-family:sans-serif;font-size:8px;direction:rtl;width:100%;text-align:center;color:#626579"><span class="title"></span></div>',
      footerTemplate:
        '<div style="font-family:sans-serif;font-size:8px;direction:ltr;unicode-bidi:isolate;width:100%;text-align:center;color:#626579"><span class="pageNumber"></span> / <span class="totalPages"></span></div>',
      displayHeaderFooter: true
    })
    await writeFile(outputPath, pdf)
  } finally {
    if (window && !window.isDestroyed()) window.destroy()
    await rm(directory, { recursive: true, force: true })
  }
}
