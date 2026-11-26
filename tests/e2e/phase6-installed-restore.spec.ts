import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:net'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import Database from 'better-sqlite3'
import { _electron as electron, chromium, type Browser, type Page } from 'playwright'
import { expect, test } from '@playwright/test'

const installedExecutable = process.env.KARNAMA_INSTALLED_EXE
const configuredInstallDirectory = process.env.KARNAMA_ACCEPTANCE_INSTALL_DIR
const configuredProfileRoot = process.env.KARNAMA_ACCEPTANCE_PROFILE_ROOT

type AcceptanceSnapshot = {
  tasks: Array<{ id: string; title: string; archived: boolean }>
  sessions: Array<{
    id: string
    taskId: string | null
    allocations: Array<{ workDate: string; source: 'boundary' | 'manual' }>
  }>
  links: Array<{ id: string; taskId: string; title: string; url: string; type: string }>
  attachments: Array<{
    id: string
    taskId: string
    displayName: string
    description: string | null
    fileSizeBytes: number
  }>
  settings: {
    profile: { displayName: string; jobTitle: string }
    workingHours: {
      dailyCommitmentMinutes: number
      workingWeekdays: number[]
      weeklyHolidayIsoDay: number
      workDateBoundaryMinutes: number
    }
    preferences: { calendar: string; theme: string; timezoneId: string }
  }
}

function assertInside(parent: string, child: string) {
  const rel = relative(resolve(parent), resolve(child))
  expect(rel).not.toBe('..')
  expect(rel.startsWith(`..${sep}`)).toBe(false)
  expect(isAbsolute(rel)).toBe(false)
}

async function freePort() {
  const server = createServer()
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolveListen)
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No local TCP port was allocated.')
  await new Promise<void>((resolveClose, reject) =>
    server.close((error) => (error ? reject(error) : resolveClose()))
  )
  return address.port
}

async function waitForDebugEndpoint(port: number, timeoutMs = 30_000) {
  const until = Date.now() + timeoutMs
  while (Date.now() < until) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`)
      if (response.ok) return await response.json()
    } catch {
      // The restored process needs a moment to start its Chromium debugging endpoint.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 250))
  }
  throw new Error(`The restored application's debugging endpoint did not start on port ${port}.`)
}

async function readSnapshot(page: Page): Promise<AcceptanceSnapshot> {
  return page.evaluate(async () => {
    const unwrap = <T>(
      result: { ok: true; data: T } | { ok: false; error: { message: string } }
    ) => {
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
    const [taskRows, sessionRows, settings] = await Promise.all([
      window.karnama.tasks.list(true).then(unwrap),
      window.karnama.sessions.list().then(unwrap),
      window.karnama.settings.get().then(unwrap)
    ])
    const resources = await Promise.all(
      taskRows.map(async (task) => {
        const [links, attachments] = await Promise.all([
          window.karnama.resources.links.list(task.id).then(unwrap),
          window.karnama.resources.attachments.list(task.id).then(unwrap)
        ])
        return { links, attachments }
      })
    )
    return {
      tasks: taskRows
        .map((task) => ({
          id: task.id,
          title: task.title,
          archived: task.archivedAtUtcMs !== null
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      sessions: sessionRows
        .map((session) => ({
          id: session.id,
          taskId: session.taskId,
          allocations: session.allocations.map(({ workDate, source }) => ({ workDate, source }))
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      links: resources
        .flatMap(({ links }) =>
          links.map(({ id, taskId, title, url, type }) => ({ id, taskId, title, url, type }))
        )
        .sort((left, right) => left.id.localeCompare(right.id)),
      attachments: resources
        .flatMap(({ attachments }) =>
          attachments.map(({ id, taskId, displayName, description, fileSizeBytes }) => ({
            id,
            taskId,
            displayName,
            description,
            fileSizeBytes
          }))
        )
        .sort((left, right) => left.id.localeCompare(right.id)),
      settings: {
        profile: settings.profile,
        workingHours: settings.workingHours,
        preferences: settings.preferences
      }
    }
  })
}

async function waitForAppReady(page: Page) {
  await expect(page.getByRole('button', { name: 'تسک‌ها', exact: true })).toBeVisible({
    timeout: 30_000
  })
}

test('installed Windows UI restores tasks, Work Dates, links, images and settings after restart', async () => {
  test.skip(
    !installedExecutable || !configuredInstallDirectory || !configuredProfileRoot,
    'Set the installed app, isolated install directory, and isolated profile root to run this release acceptance test.'
  )
  test.setTimeout(240_000)

  const executablePath = resolve(installedExecutable!)
  const installDirectory = resolve(configuredInstallDirectory!)
  const profileRoot = resolve(configuredProfileRoot!)
  expect(existsSync(executablePath)).toBe(true)
  expect(dirname(executablePath).toLowerCase()).toContain(installDirectory.toLowerCase())
  expect(existsSync(profileRoot)).toBe(false)
  mkdirSync(profileRoot, { recursive: true })
  assertInside(profileRoot, join(profileRoot, 'profile-marker'))
  assertInside(installDirectory, executablePath)

  const userDataTarget = join(profileRoot, 'user-data')

  const debugPort = await freePort()
  const environment = {
    ...process.env,
    KARNAMA_TEST_USER_DATA_DIR: userDataTarget
  }
  const launch = () =>
    electron.launch({
      executablePath,
      args: [`--remote-debugging-port=${debugPort}`],
      cwd: installDirectory,
      env: environment
    })

  let application: Awaited<ReturnType<typeof electron.launch>> | null = null
  let restoredBrowser: Browser | null = null
  let restoredPage: Page | null = null
  let userDataDirectory = ''

  try {
    application = await launch()
    expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(true)
    expect(await application.evaluate(({ app }) => app.getVersion())).toBe('0.1.0')
    expect(await application.evaluate(() => process.arch)).toBe('x64')
    userDataDirectory = await application.evaluate(({ app }) => app.getPath('userData'))
    expect(resolve(userDataDirectory).toLowerCase()).toBe(resolve(userDataTarget).toLowerCase())
    assertInside(profileRoot, userDataDirectory)
    assertInside(resolve(process.cwd()), userDataDirectory)
    expect(relative(installDirectory, resolve(userDataDirectory)).startsWith(`..${sep}`)).toBe(true)

    const page = await application.firstWindow()
    expect(await page.title()).toBe('کارنما')
    await expect(page.getByRole('heading', { name: 'به کارنما خوش آمدید' })).toBeVisible()
    await page.getByRole('button', { name: 'تکمیل تنظیمات' }).click()
    const finishSetup = page.getByRole('button', { name: 'اتمام تنظیمات و رفتن به داشبورد' })
    await expect(finishSetup).toBeEnabled()
    await finishSetup.click()

    await page
      .getByRole('complementary')
      .getByRole('button', { name: 'تنظیمات', exact: true })
      .click()
    await page.getByLabel('نام نمایشی').fill('Phase 6 Restore Acceptance')
    await page.getByLabel('عنوان شغلی').fill('Release QA')
    await page.getByLabel('تعهد روزانه، ساعت').fill('7.5')
    await page.getByLabel('مرز Work Date').fill('04:00')
    await page.getByLabel('تقویم پیش‌فرض').selectOption('gregorian')
    await page
      .getByRole('main')
      .locator('label')
      .filter({ hasText: 'پوسته' })
      .getByRole('combobox')
      .selectOption('dark')
    await page.getByLabel('منطقه زمانی IANA').fill('Asia/Tehran')
    await expect
      .poll(async () => {
        const settings = await page.evaluate(async () => {
          const result = await window.karnama.settings.get()
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        })
        return {
          name: settings.profile.displayName,
          job: settings.profile.jobTitle,
          commitment: settings.workingHours.dailyCommitmentMinutes,
          boundary: settings.workingHours.workDateBoundaryMinutes,
          calendar: settings.preferences.calendar,
          theme: settings.preferences.theme,
          timezone: settings.preferences.timezoneId
        }
      })
      .toEqual({
        name: 'Phase 6 Restore Acceptance',
        job: 'Release QA',
        commitment: 450,
        boundary: 240,
        calendar: 'gregorian',
        theme: 'dark',
        timezone: 'Asia/Tehran'
      })

    await page.getByRole('button', { name: 'تسک‌ها', exact: true }).click()
    const tasks = [
      {
        title: 'Phase 6 restore task alpha',
        description: 'Task restored with links, images and historical Work Date allocation.',
        notes: 'alpha acceptance note'
      },
      {
        title: 'Phase 6 restore task beta',
        description: 'Second record retained by the restore.',
        notes: 'beta acceptance note'
      }
    ]
    for (const task of tasks) {
      await page.getByRole('button', { name: 'تسک تازه' }).click()
      await page.getByLabel('عنوان', { exact: true }).fill(task.title)
      await page.getByLabel('توضیحات', { exact: true }).fill(task.description)
      await page.getByLabel('یادداشت', { exact: true }).fill(task.notes)
      await page.getByRole('button', { name: 'ذخیره تسک' }).click()
      await expect(page.getByText('ذخیره شد', { exact: true })).toBeVisible()
    }
    const taskRows = await page.evaluate(async () => {
      const result = await window.karnama.tasks.list()
      if (!result.ok) throw new Error(result.error.message)
      return result.data.map(({ id, title }) => ({ id, title }))
    })
    const alpha = taskRows.find(({ title }) => title === tasks[0].title)
    const beta = taskRows.find(({ title }) => title === tasks[1].title)
    expect(alpha).toBeDefined()
    expect(beta).toBeDefined()

    const sessionIds = await page.evaluate(
      async ({ alphaId, betaId }) => {
        const inputs = [
          {
            taskId: alphaId,
            startDate: '2024-06-05',
            startTime: '09:00',
            startOccurrence: null,
            endDate: '2024-06-05',
            endTime: '09:45',
            endOccurrence: null,
            allocationMode: 'manual' as const,
            workDate: '2024-06-04'
          },
          {
            taskId: betaId,
            startDate: '2024-06-06',
            startTime: '14:10',
            startOccurrence: null,
            endDate: '2024-06-06',
            endTime: '15:00',
            endOccurrence: null,
            allocationMode: 'manual' as const,
            workDate: '2024-06-06'
          }
        ]
        for (const input of inputs) {
          const result = await window.karnama.sessions.create(input)
          if (!result.ok) throw new Error(result.error.message)
        }
        const listed = await window.karnama.sessions.list()
        if (!listed.ok) throw new Error(listed.error.message)
        return listed.data.map(({ id }) => id)
      },
      { alphaId: alpha!.id, betaId: beta!.id }
    )
    expect(sessionIds).toHaveLength(2)

    await page.getByRole('button', { name: new RegExp(tasks[0].title) }).click()
    await page.getByRole('button', { name: 'افزودن لینک' }).click()
    await page.getByLabel('عنوان لینک').fill('Alpha design source')
    await page.getByLabel('نشانی لینک').fill('https://example.invalid/phase6-alpha')
    await page.getByLabel('نوع لینک').selectOption('figma')
    await page.getByRole('button', { name: 'ذخیره لینک' }).click()
    await expect(page.getByText('Alpha design source', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: new RegExp(tasks[1].title) }).click()
    await page.getByRole('button', { name: 'افزودن لینک' }).click()
    await page.getByLabel('عنوان لینک').fill('Beta reference')
    await page.getByLabel('نشانی لینک').fill('https://example.invalid/phase6-beta')
    await page.getByLabel('نوع لینک').selectOption('external')
    await page.getByRole('button', { name: 'ذخیره لینک' }).click()
    await expect(page.getByText('Beta reference', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: new RegExp(tasks[0].title) }).click()
    const imageDirectory = join(profileRoot, 'source-images')
    mkdirSync(imageDirectory, { recursive: true })
    const pngDataUrls = await page.evaluate(() =>
      ['#2563eb', '#f97316'].map((color) => {
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 24
        const context = canvas.getContext('2d')
        if (!context) throw new Error('Canvas 2D context is unavailable.')
        context.fillStyle = color
        context.fillRect(0, 0, canvas.width, canvas.height)
        return canvas.toDataURL('image/png')
      })
    )
    const imagePaths = ['alpha-layout.png', 'alpha-flow.png'].map((name, index) => {
      const path = join(imageDirectory, name)
      writeFileSync(path, Buffer.from(pngDataUrls[index].split(',')[1], 'base64'))
      return path
    })
    await application.evaluate(({ dialog }, filePaths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
    }, imagePaths)
    await page.getByRole('button', { name: 'افزودن تصویر' }).click()
    for (const name of ['alpha-layout.png', 'alpha-flow.png']) {
      await expect(page.getByRole('button', { name: `مشاهده بزرگ‌تر: ${name}` })).toBeVisible()
      await page.getByRole('button', { name: `ویرایش توضیح ${name}` }).click()
      await page
        .getByLabel(`توضیح تصویر ${name}`)
        .fill(`Verified attachment description for ${name}`)
      await page.getByRole('button', { name: 'ذخیره توضیح' }).click()
      await expect(
        page.getByText(`Verified attachment description for ${name}`, { exact: true })
      ).toBeVisible()
    }

    const originalSnapshot = await readSnapshot(page)
    expect(originalSnapshot.tasks).toHaveLength(2)
    expect(originalSnapshot.sessions).toHaveLength(2)
    expect(
      originalSnapshot.sessions
        .map(({ allocations }) => allocations[0])
        .sort((left, right) => left.workDate.localeCompare(right.workDate))
    ).toEqual([
      { workDate: '2024-06-04', source: 'manual' },
      { workDate: '2024-06-06', source: 'manual' }
    ])
    expect(originalSnapshot.links).toHaveLength(2)
    expect(originalSnapshot.attachments).toHaveLength(2)
    expect(originalSnapshot.attachments.every(({ description }) => description)).toBe(true)

    await page
      .getByRole('complementary')
      .getByRole('button', { name: 'تنظیمات', exact: true })
      .click()
    const main = page.getByRole('main')
    const backupCard = main.locator('section').filter({ hasText: 'پشتیبان‌گیری و بازیابی' })
    await backupCard.getByRole('button', { name: 'ساخت نسخهٔ دستی' }).click()
    await expect(backupCard.getByText(/آماده شد/)).toBeVisible({ timeout: 30_000 })
    const backupRows = await page.evaluate(async () => {
      const result = await window.karnama.backups.list()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    })
    const manualBackup = backupRows.find(({ kind }) => kind === 'manual')
    expect(manualBackup).toBeDefined()
    const manualRow = backupCard.getByRole('listitem').filter({ hasText: 'دستی' }).first()
    await manualRow.getByRole('button', { name: 'بررسی' }).click()
    await expect(backupCard.getByText('فایل‌های آن تأیید شدند.')).toBeVisible()

    const backupName = readdirSync(join(userDataDirectory, 'backups')).find((name) =>
      name.endsWith(`-${manualBackup!.id}.zip`)
    )
    expect(backupName).toBeDefined()
    const backupPath = join(userDataDirectory, 'backups', backupName!)
    const tarPath = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
    const manifest = JSON.parse(
      execFileSync(tarPath, ['-xOf', backupPath, 'manifest.json'], { encoding: 'utf8' })
    ) as {
      kind: string
      files: Array<{ path: string; sizeBytes: number; sha256: string }>
    }
    expect(manifest.kind).toBe('manual')
    expect(manifest.files.filter(({ path }) => path.startsWith('attachments/'))).toHaveLength(2)

    const mutationResult = await page.evaluate(
      async ({ alphaId, betaId, sessionId, linkId, attachmentId }) => {
        const unwrap = <T>(
          result: { ok: true; data: T } | { ok: false; error: { message: string } }
        ) => {
          if (!result.ok) throw new Error(result.error.message)
          return result.data
        }
        unwrap(
          await window.karnama.tasks.update(alphaId, {
            title: 'MUTATED restore task alpha',
            description: 'This mutation must be undone by restore.',
            notes: 'mutated note',
            status: 'on_hold',
            priority: 'low',
            estimatedDurationMinutes: null
          })
        )
        unwrap(await window.karnama.tasks.archive(betaId))
        unwrap(await window.karnama.sessions.delete(sessionId))
        unwrap(await window.karnama.resources.links.delete(linkId))
        unwrap(await window.karnama.resources.attachments.delete(attachmentId))
        const settings = unwrap(await window.karnama.settings.get())
        unwrap(
          await window.karnama.settings.save({
            ...settings,
            profile: { ...settings.profile, displayName: 'Mutated after backup' }
          })
        )
        return true
      },
      {
        alphaId: alpha!.id,
        betaId: beta!.id,
        sessionId: originalSnapshot.sessions[0].id,
        linkId: originalSnapshot.links.find(({ taskId }) => taskId === alpha!.id)!.id,
        attachmentId: originalSnapshot.attachments[0].id
      }
    )
    expect(mutationResult).toBe(true)
    const mutatedSnapshot = await readSnapshot(page)
    expect(mutatedSnapshot.tasks.find(({ id }) => id === alpha!.id)?.title).toBe(
      'MUTATED restore task alpha'
    )
    expect(mutatedSnapshot.tasks.find(({ id }) => id === beta!.id)?.archived).toBe(true)
    expect(mutatedSnapshot.sessions).toHaveLength(1)
    expect(mutatedSnapshot.links).toHaveLength(1)
    expect(mutatedSnapshot.attachments).toHaveLength(1)
    expect(mutatedSnapshot.settings.profile.displayName).toBe('Mutated after backup')

    await application.close()
    application = await launch()
    const restartedPage = await application.firstWindow()
    await waitForAppReady(restartedPage)
    expect(await readSnapshot(restartedPage)).toEqual(mutatedSnapshot)

    await restartedPage
      .getByRole('complementary')
      .getByRole('button', { name: 'تنظیمات', exact: true })
      .click()
    const restartedMain = restartedPage.getByRole('main')
    const restartedBackupCard = restartedMain
      .locator('section')
      .filter({ hasText: 'پشتیبان‌گیری و بازیابی' })
    const restartedManualRow = restartedBackupCard
      .getByRole('listitem')
      .filter({ hasText: 'دستی' })
      .first()
    await restartedManualRow.getByRole('button', { name: 'بازیابی' }).click()
    const cancelDialog = restartedPage.getByRole('dialog', { name: 'تأیید جایگزینی داده‌ها' })
    await expect(cancelDialog).toContainText('یک نسخهٔ ایمنی می‌سازد')
    await cancelDialog.getByRole('button', { name: 'انصراف' }).click()
    await expect(cancelDialog).toHaveCount(0)
    expect(await readSnapshot(restartedPage)).toEqual(mutatedSnapshot)

    await restartedManualRow.getByRole('button', { name: 'بازیابی' }).click()
    const restoreDialog = restartedPage.getByRole('dialog', { name: 'تأیید جایگزینی داده‌ها' })
    await expect(restoreDialog).toBeVisible()
    const oldProcessClosed = application.waitForEvent('close', { timeout: 45_000 })
    await restoreDialog.getByRole('button', { name: 'جایگزینی و راه‌اندازی دوباره' }).click()
    await oldProcessClosed
    application = null

    await waitForDebugEndpoint(debugPort)
    restoredBrowser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`, {
      timeout: 30_000
    })
    const restoredContext = restoredBrowser.contexts()[0]
    restoredPage = restoredContext.pages()[0]
    expect(restoredPage).toBeDefined()
    await waitForAppReady(restoredPage!)
    expect(
      readdirSync(userDataDirectory).filter((name) => name.startsWith('.karnama-restore-'))
    ).toEqual([])

    const restoredSnapshot = await readSnapshot(restoredPage!)
    expect(restoredSnapshot).toEqual(originalSnapshot)
    await restoredPage!.getByRole('button', { name: 'تسک‌ها', exact: true }).click()
    await expect(
      restoredPage!.getByRole('button', { name: new RegExp(tasks[0].title) })
    ).toBeVisible()
    await expect(
      restoredPage!.getByRole('button', { name: new RegExp(tasks[1].title) })
    ).toBeVisible()
    await restoredPage!.getByRole('button', { name: new RegExp(tasks[0].title) }).click()
    await expect(restoredPage!.getByText('Alpha design source', { exact: true })).toBeVisible()
    await expect(
      restoredPage!.getByText('Verified attachment description for alpha-layout.png', {
        exact: true
      })
    ).toBeVisible()
    await expect(
      restoredPage!.getByText('Verified attachment description for alpha-flow.png', { exact: true })
    ).toBeVisible()

    const dbPath = join(userDataDirectory, 'karnama.sqlite')
    expect(existsSync(dbPath)).toBe(true)
    const database = new Database(dbPath, { readonly: true, fileMustExist: true })
    try {
      expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
      expect(database.pragma('foreign_key_check')).toEqual([])
      const rows = database
        .prepare('SELECT id, storage_ref, file_size_bytes FROM attachments ORDER BY id')
        .all() as Array<{ id: string; storage_ref: string; file_size_bytes: number }>
      expect(rows).toHaveLength(2)
      const manifestFiles = new Map(manifest.files.map((file) => [file.path, file]))
      for (const attachment of rows) {
        const relativePath = `attachments/${attachment.storage_ref}`
        const manifestFile = manifestFiles.get(relativePath)
        expect(manifestFile).toBeDefined()
        const attachmentPath = join(userDataDirectory, 'attachments', attachment.storage_ref)
        expect(existsSync(attachmentPath)).toBe(true)
        const bytes = readFileSync(attachmentPath)
        expect(bytes.length).toBe(attachment.file_size_bytes)
        expect(bytes.length).toBe(manifestFile!.sizeBytes)
        expect(createHash('sha256').update(bytes).digest('hex')).toBe(manifestFile!.sha256)
      }
    } finally {
      database.close()
    }

    const backupList = await restoredPage!.evaluate(async () => {
      const result = await window.karnama.backups.list()
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    })
    expect(backupList.some(({ kind }) => kind === 'pre_restore')).toBe(true)
    await restoredPage!
      .getByRole('complementary')
      .getByRole('button', { name: 'تنظیمات', exact: true })
      .click()
    const restoredMain = restoredPage!.getByRole('main')
    const restoredBackupCard = restoredMain
      .locator('section')
      .filter({ hasText: 'پشتیبان‌گیری و بازیابی' })
    const safetyRow = restoredBackupCard
      .getByRole('listitem')
      .filter({ hasText: 'نسخهٔ ایمنی بازیابی' })
      .first()
    await expect(safetyRow).toBeVisible()
    await safetyRow.getByRole('button', { name: 'بررسی' }).click()
    await expect(restoredBackupCard.getByText('فایل‌های آن تأیید شدند.')).toBeVisible()
  } finally {
    if (application) await application.close().catch(() => undefined)
    if (restoredPage) await restoredPage.evaluate(() => window.close()).catch(() => undefined)
    if (restoredBrowser) await restoredBrowser.close().catch(() => undefined)
  }
})
