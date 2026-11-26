import { app, BrowserWindow, net, protocol, session } from 'electron'
import { existsSync } from 'node:fs'
import { join, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'
import { openKarnamaDatabase } from './db/client'
import { createSettingsService } from './db/settings-service'
import { registerSettingsIpc } from './ipc/settings'
import { createWorkService } from './db/work-service'
import { registerWorkIpc } from './ipc/work'
import { createCommitmentService } from './db/commitment-service'
import { registerCalendarIpc } from './ipc/calendar'
import { createTaskResourceService, ResourceDomainError } from './db/task-resource-service'
import { registerTaskResourceIpc } from './ipc/task-resources'
import { createAnalyticsService } from './db/analytics-service'
import { registerAnalyticsIpc } from './ipc/analytics'
import { createReportExportService } from './reports/report-export-service'
import {
  cleanupBackupTemporaryFiles,
  createBackupService,
  recoverInterruptedRestore
} from './backup/backup-service'
import { registerBackupIpc } from './ipc/backups'
import { backupProgressSchema } from '../shared/contracts/backups'
import { ipcChannels } from '../shared/contracts/api'
import { secureWindowPreferences } from './security/window-preferences'
import { isTrustedOrigin } from './security/trusted-sender'

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const rendererUrl = process.env.ELECTRON_RENDERER_URL
const expectedRendererOrigin = rendererUrl ? new URL(rendererUrl).origin : 'app://karnama'
const rendererDirectory = resolve(__dirname, '../renderer')
let mainWindow: BrowserWindow | null = null
let closeDatabase: () => void = () => {}
let timerCheckpoint: NodeJS.Timeout | null = null
let automaticBackupTimer: NodeJS.Timeout | null = null
let isShuttingDown = false

const testDataDirectory = process.env.KARNAMA_TEST_USER_DATA_DIR
if (testDataDirectory) app.setPath('userData', resolve(testDataDirectory))
const hasSingleInstanceLock = app.requestSingleInstanceLock()
if (!hasSingleInstanceLock) app.quit()
else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
}

if (hasSingleInstanceLock)
  void app.whenReady().then(async () => {
    const timezoneId = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tehran'
    const userDataDirectory = app.getPath('userData')
    await recoverInterruptedRestore(userDataDirectory)
    await cleanupBackupTemporaryFiles(userDataDirectory, join(userDataDirectory, 'backups'))
    const databasePath = join(app.getPath('userData'), 'karnama.sqlite')
    const migrationsFolder = app.isPackaged
      ? join(process.resourcesPath, 'drizzle')
      : resolve(__dirname, '../../drizzle')

    const opened = openKarnamaDatabase({ databasePath, migrationsFolder, timezoneId })
    const taskResources = createTaskResourceService(
      opened.database,
      join(app.getPath('userData'), 'attachments')
    )
    try {
      await taskResources.recoverStorage()
    } catch {
      // Keep the app available; attachment operations report storage errors through IPC.
    }
    const workService = createWorkService(opened.database)
    const commitmentService = createCommitmentService(opened.database)
    const analyticsService = createAnalyticsService(opened.database, commitmentService)
    const reportExportService = createReportExportService({
      getWindow: () => mainWindow,
      getSnapshot: analyticsService.getSnapshot,
      persistSnapshot: analyticsService.persistExportSnapshot,
      readAttachmentImage: taskResources.readAttachmentImage,
      arabicFontPath: join(
        __dirname,
        '../../node_modules/@fontsource-variable/vazirmatn/files/vazirmatn-arabic-wght-normal.woff2'
      ),
      latinFontPath: join(
        __dirname,
        '../../node_modules/@fontsource-variable/vazirmatn/files/vazirmatn-latin-wght-normal.woff2'
      )
    })
    const backupService = createBackupService({
      database: opened.database,
      backupDatabase: (destination, onProgress) => opened.backupTo(destination, onProgress),
      attachmentsDirectory: join(userDataDirectory, 'attachments'),
      userDataDirectory,
      backupsDirectory: join(userDataDirectory, 'backups'),
      migrationsFolder,
      appVersion: app.getVersion(),
      prepareForRestore: () => {
        mainWindow?.setEnabled(false)
        closeDatabase()
      },
      restartAfterRestore: () => {
        app.relaunch()
        app.exit(0)
      },
      reportProgress: (progress) => {
        const parsed = backupProgressSchema.parse(progress)
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send(ipcChannels.backupsProgress, parsed)
        }
      }
    })
    workService.recoverInterruptedTimer()
    timerCheckpoint = setInterval(() => workService.checkpointRunningTimer(), 15_000)
    let databaseClosed = false
    closeDatabase = () => {
      if (databaseClosed) return
      isShuttingDown = true
      if (timerCheckpoint) clearInterval(timerCheckpoint)
      timerCheckpoint = null
      if (automaticBackupTimer) clearTimeout(automaticBackupTimer)
      automaticBackupTimer = null
      try {
        workService.pauseRunningTimer()
      } finally {
        opened.close()
        databaseClosed = true
      }
    }
    registerSettingsIpc(
      () => mainWindow,
      expectedRendererOrigin,
      createSettingsService(opened.database)
    )
    registerWorkIpc(() => mainWindow, expectedRendererOrigin, workService)
    registerCalendarIpc(() => mainWindow, expectedRendererOrigin, commitmentService)
    registerAnalyticsIpc(() => mainWindow, expectedRendererOrigin, {
      analytics: analyticsService,
      reports: reportExportService
    })
    registerTaskResourceIpc(() => mainWindow, expectedRendererOrigin, taskResources)
    registerBackupIpc(() => mainWindow, expectedRendererOrigin, backupService)

    installContentSecurityPolicy()
    installApplicationProtocol(taskResources)
    createMainWindow()
    const scheduleAutomaticBackup = (delayMs: number) => {
      automaticBackupTimer = setTimeout(
        () => {
          automaticBackupTimer = null
          void runAutomaticBackup()
        },
        Math.min(delayMs, 2_000_000_000)
      )
      automaticBackupTimer.unref()
    }
    const runAutomaticBackup = async () => {
      try {
        await backupService.runAutomaticBackupIfDue()
      } catch (error) {
        console.error('Automatic backup failed:', error)
      }
      if (isShuttingDown) return
      const delay = backupService.millisecondsUntilAutomaticBackup()
      scheduleAutomaticBackup(delay || 60 * 60 * 1000)
    }
    scheduleAutomaticBackup(30_000)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => closeDatabase())

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 1080,
    minHeight: 720,
    show: false,
    backgroundColor: '#f5f6fa',
    title: 'کارنما',
    webPreferences: secureWindowPreferences(join(__dirname, '../preload/index.js'))
  })

  mainWindow = window
  window.once('ready-to-show', () => window.show())
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', (event, url) => {
    if (!isExpectedOrigin(url)) event.preventDefault()
  })
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null
  })

  if (rendererUrl) void window.loadURL(rendererUrl)
  else void window.loadURL('app://karnama/index.html')
}

function isExpectedOrigin(value: string) {
  return isTrustedOrigin(value, expectedRendererOrigin)
}

function installContentSecurityPolicy() {
  const developmentPolicy = [
    "default-src 'self'",
    // Allow only the fixed inline preamble injected by the pinned Vite React plugin.
    "script-src 'self' 'unsafe-eval' 'sha256-Z2/iFzh9VMlVkEOar1f/oSHWwQk3ve1qk/C2WdsC4Xk='",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' app://karnama data:",
    "connect-src 'self' http://localhost:* ws://localhost:*",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'"
  ].join('; ')
  const productionPolicy = [
    "default-src 'self'",
    "script-src 'self'",
    "style-src 'self'",
    "font-src 'self' data:",
    "img-src 'self' app://karnama data:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'"
  ].join('; ')

  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const isApplicationRequest = rendererUrl
      ? details.url.startsWith(expectedRendererOrigin)
      : details.url.startsWith('app://karnama/')
    if (!isApplicationRequest) return callback({ responseHeaders: details.responseHeaders })

    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [rendererUrl ? developmentPolicy : productionPolicy]
      }
    })
  })
}

function installApplicationProtocol(taskResources: ReturnType<typeof createTaskResourceService>) {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'karnama') return new Response('Not found', { status: 404 })

    if (url.pathname.startsWith('/attachments/')) {
      if (request.method !== 'GET') return new Response('Method not allowed', { status: 405 })
      const initiatorOrigin = (request as Request & { initiatorOrigin?: string }).initiatorOrigin
      if (url.search || url.hash || !isExpectedOrigin(initiatorOrigin ?? '')) {
        return new Response('Forbidden', { status: 403 })
      }
      const match = /^\/attachments\/([0-9a-f-]{36})$/i.exec(url.pathname)
      if (!match) return new Response('Not found', { status: 404 })
      try {
        const image = await taskResources.readAttachmentImage({ id: match[1] })
        return new Response(image.bytes, {
          headers: {
            'Content-Type': image.mimeType,
            'X-Content-Type-Options': 'nosniff',
            'Cache-Control': 'no-store'
          }
        })
      } catch (error) {
        const status =
          error instanceof ResourceDomainError && error.code === 'not_found'
            ? 404
            : error instanceof ResourceDomainError && error.code === 'invalid_input'
              ? 400
              : 422
        return new Response('Image unavailable', { status })
      }
    }
    if (rendererUrl) return new Response('Not found', { status: 404 })

    let relativePath: string
    try {
      relativePath = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html'
    } catch {
      return new Response('Bad request', { status: 400 })
    }

    const root = resolve(rendererDirectory)
    const target = resolve(root, relativePath)
    const prefix = root.endsWith(sep) ? root : `${root}${sep}`
    const normalizedTarget = process.platform === 'win32' ? target.toLowerCase() : target
    const normalizedPrefix = process.platform === 'win32' ? prefix.toLowerCase() : prefix
    if (!normalizedTarget.startsWith(normalizedPrefix) || !existsSync(target)) {
      return new Response('Not found', { status: 404 })
    }

    return net.fetch(pathToFileURL(target).toString())
  })
}
