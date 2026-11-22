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
import { secureWindowPreferences } from './security/window-preferences'

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } }
])

const rendererUrl = process.env.ELECTRON_RENDERER_URL
const expectedRendererOrigin = rendererUrl ? new URL(rendererUrl).origin : 'app://karnama'
const rendererDirectory = resolve(__dirname, '../renderer')
let mainWindow: BrowserWindow | null = null
let closeDatabase: () => void = () => {}
let timerCheckpoint: NodeJS.Timeout | null = null

const testDataDirectory = process.env.KARNAMA_TEST_USER_DATA_DIR
if (testDataDirectory) app.setPath('userData', resolve(testDataDirectory))

app.whenReady().then(() => {
  const timezoneId = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Tehran'
  const databasePath = join(app.getPath('userData'), 'karnama.sqlite')
  const migrationsFolder = app.isPackaged
    ? join(process.resourcesPath, 'drizzle')
    : resolve(__dirname, '../../drizzle')

  const opened = openKarnamaDatabase({ databasePath, migrationsFolder, timezoneId })
  const workService = createWorkService(opened.database)
  const commitmentService = createCommitmentService(opened.database)
  workService.recoverInterruptedTimer()
  timerCheckpoint = setInterval(() => workService.checkpointRunningTimer(), 15_000)
  closeDatabase = () => {
    if (timerCheckpoint) clearInterval(timerCheckpoint)
    timerCheckpoint = null
    workService.pauseRunningTimer()
    opened.close()
  }
  registerSettingsIpc(
    () => mainWindow,
    expectedRendererOrigin,
    createSettingsService(opened.database)
  )
  registerWorkIpc(() => mainWindow, expectedRendererOrigin, workService)
  registerCalendarIpc(() => mainWindow, expectedRendererOrigin, commitmentService)

  installContentSecurityPolicy()
  if (!rendererUrl) installApplicationProtocol()
  createMainWindow()

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
  try {
    return new URL(value).origin === expectedRendererOrigin
  } catch {
    return false
  }
}

function installContentSecurityPolicy() {
  const developmentPolicy = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "img-src 'self' data:",
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
    "img-src 'self' data:",
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

function installApplicationProtocol() {
  protocol.handle('app', async (request) => {
    const url = new URL(request.url)
    if (url.hostname !== 'karnama') return new Response('Not found', { status: 404 })

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
