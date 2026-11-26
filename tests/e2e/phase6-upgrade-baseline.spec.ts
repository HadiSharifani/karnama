import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { relative, resolve, sep } from 'node:path'
import Database from 'better-sqlite3'
import { _electron as electron, type Page } from 'playwright'
import { expect, test } from '@playwright/test'

const baselineExecutable = process.env.KARNAMA_BASELINE_INSTALLED_EXE
const currentInstaller = process.env.KARNAMA_CURRENT_INSTALLER
const currentAppAsar = process.env.KARNAMA_CURRENT_APP_ASAR
const installDirectory = process.env.KARNAMA_ACCEPTANCE_INSTALL_DIR
const profileRoot = process.env.KARNAMA_ACCEPTANCE_PROFILE_ROOT

async function readSnapshot(page: Page) {
  return page.evaluate(async () => {
    const unwrap = <T>(
      result: { ok: true; data: T } | { ok: false; error: { message: string } }
    ) => {
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }
    const [tasks, sessions, settings] = await Promise.all([
      window.karnama.tasks.list(true).then(unwrap),
      window.karnama.sessions.list().then(unwrap),
      window.karnama.settings.get().then(unwrap)
    ])
    return {
      tasks: tasks
        .map(({ id, title, description, notes, status, priority, estimatedDurationMinutes }) => ({
          id,
          title,
          description,
          notes,
          status,
          priority,
          estimatedDurationMinutes
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      sessions: sessions
        .map(({ id, taskId, startUtcMs, endUtcMs, durationMs, allocationMode, allocations }) => ({
          id,
          taskId,
          startUtcMs,
          endUtcMs,
          durationMs,
          allocationMode,
          allocations: allocations.map(({ workDate, source }) => ({ workDate, source }))
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
      settings: {
        profile: settings.profile,
        workingHours: settings.workingHours,
        preferences: settings.preferences
      }
    }
  })
}

function verifyDatabase(databasePath: string, expectedMigrationCount: number) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    expect(database.pragma('integrity_check', { simple: true })).toBe('ok')
    expect(database.pragma('foreign_key_check')).toEqual([])
    const migrationCount = database
      .prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations')
      .get() as { count: number }
    expect(migrationCount.count).toBe(expectedMigrationCount)
  } finally {
    database.close()
  }
}

function verifyTaskPositions(databasePath: string) {
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  try {
    const rows = database
      .prepare(
        'SELECT status, position, archived_at_utc_ms FROM tasks ORDER BY status, position, created_at_utc_ms, id'
      )
      .all() as Array<{ status: string; position: number; archived_at_utc_ms: number | null }>
    const counts = new Map<string, number>()
    for (const row of rows.filter((task) => task.archived_at_utc_ms === null)) {
      const expected = counts.get(row.status) ?? 0
      expect(row.position).toBe(expected)
      counts.set(row.status, expected + 1)
    }
  } finally {
    database.close()
  }
}

test('current installer upgrades the commit-built pre-Phase-4 baseline and preserves data', async () => {
  test.skip(
    !baselineExecutable ||
      !currentInstaller ||
      !currentAppAsar ||
      !installDirectory ||
      !profileRoot,
    'Set the baseline app, current installer/app.asar, isolated install directory, and profile root to run the upgrade acceptance test.'
  )
  test.setTimeout(240_000)

  const baselinePath = resolve(baselineExecutable!)
  const installerPath = resolve(currentInstaller!)
  const expectedAppAsar = resolve(currentAppAsar!)
  const installPath = resolve(installDirectory!)
  const isolatedProfile = resolve(profileRoot!)
  const testDataDirectory = resolve(isolatedProfile, 'user-data')
  const appExecutable = resolve(installPath, 'کارنما.exe')
  const appAsarPath = resolve(installPath, 'resources', 'app.asar')
  const databasePath = resolve(testDataDirectory, 'karnama.sqlite')

  expect(existsSync(baselinePath)).toBe(true)
  expect(existsSync(installerPath)).toBe(true)
  expect(existsSync(expectedAppAsar)).toBe(true)
  expect(existsSync(appExecutable)).toBe(true)
  expect(existsSync(isolatedProfile)).toBe(false)
  expect(resolve(baselinePath).toLowerCase()).toBe(appExecutable.toLowerCase())
  expect(relative(installPath, installerPath).startsWith(`..${sep}`)).toBe(true)
  mkdirSync(isolatedProfile, { recursive: true })

  const environment = { ...process.env, KARNAMA_TEST_USER_DATA_DIR: testDataDirectory }
  const launch = (executablePath: string) =>
    electron.launch({
      executablePath,
      args: [],
      cwd: installPath,
      env: environment
    })

  let application: Awaited<ReturnType<typeof electron.launch>> | null = null
  try {
    const baselineAsarPath = resolve(installPath, 'resources', 'app.asar')
    const baselineAsarHash = createHash('sha256')
      .update(readFileSync(baselineAsarPath))
      .digest('hex')
    application = await launch(baselinePath)
    expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(true)
    expect(await application.evaluate(({ app }) => app.getVersion())).toBe('0.1.0')
    expect(
      resolve(await application.evaluate(({ app }) => app.getPath('userData'))).toLowerCase()
    ).toBe(testDataDirectory.toLowerCase())

    const baselinePage = await application.firstWindow()
    await expect(baselinePage.getByRole('heading', { name: 'به کارنما خوش آمدید' })).toBeVisible()
    await baselinePage.getByRole('button', { name: 'تکمیل تنظیمات' }).click()
    const finishSetup = baselinePage.getByRole('button', {
      name: 'اتمام تنظیمات و رفتن به داشبورد'
    })
    await expect(finishSetup).toBeEnabled()
    await finishSetup.click()

    const setup = await baselinePage.evaluate(async () => {
      const unwrap = <T>(
        result: { ok: true; data: T } | { ok: false; error: { message: string } }
      ) => {
        if (!result.ok) throw new Error(result.error.message)
        return result.data
      }
      const settings = unwrap(await window.karnama.settings.get())
      unwrap(
        await window.karnama.settings.save({
          profile: { displayName: 'Pre-Phase-4 Baseline', jobTitle: 'Migration Acceptance' },
          workingHours: {
            ...settings.workingHours,
            dailyCommitmentMinutes: 465,
            workDateBoundaryMinutes: 300
          },
          preferences: {
            calendar: 'gregorian',
            theme: 'light',
            timezoneId: 'Asia/Tehran'
          }
        })
      )
      const first = unwrap(
        await window.karnama.tasks.create({
          title: 'Baseline existing task alpha',
          description: 'Must survive migration from commit e20f2a4.',
          notes: 'old schema note alpha',
          status: 'in_progress',
          priority: 'high',
          estimatedDurationMinutes: 120
        })
      )
      const second = unwrap(
        await window.karnama.tasks.create({
          title: 'Baseline existing task beta',
          description: 'Second old-schema row.',
          notes: 'old schema note beta',
          status: 'todo',
          priority: 'medium',
          estimatedDurationMinutes: 60
        })
      )
      const inputs = [
        {
          taskId: first.id,
          startDate: '2024-05-10',
          startTime: '09:00',
          startOccurrence: null,
          endDate: '2024-05-10',
          endTime: '09:40',
          endOccurrence: null,
          allocationMode: 'manual' as const,
          workDate: '2024-05-09'
        },
        {
          taskId: second.id,
          startDate: '2024-05-11',
          startTime: '13:00',
          startOccurrence: null,
          endDate: '2024-05-11',
          endTime: '13:35',
          endOccurrence: null,
          allocationMode: 'manual' as const,
          workDate: '2024-05-11'
        }
      ]
      for (const input of inputs) unwrap(await window.karnama.sessions.create(input))
      return true
    })
    expect(setup).toBe(true)
    const baselineSnapshot = await readSnapshot(baselinePage)
    expect(baselineSnapshot.tasks).toHaveLength(2)
    expect(baselineSnapshot.sessions).toHaveLength(2)
    expect(baselineSnapshot.settings.profile.displayName).toBe('Pre-Phase-4 Baseline')
    expect(baselineSnapshot.settings.workingHours.dailyCommitmentMinutes).toBe(465)
    await application.close()
    application = null

    expect(existsSync(databasePath)).toBe(true)
    verifyDatabase(databasePath, 4)
    execFileSync(installerPath, ['/S'], {
      cwd: installPath,
      env: process.env,
      timeout: 120_000,
      stdio: 'pipe'
    })
    expect(existsSync(appExecutable)).toBe(true)
    expect(existsSync(appAsarPath)).toBe(true)
    const installedAsarHash = createHash('sha256').update(readFileSync(appAsarPath)).digest('hex')
    const expectedAsarHash = createHash('sha256')
      .update(readFileSync(expectedAppAsar))
      .digest('hex')
    expect(installedAsarHash).toBe(expectedAsarHash)
    expect(installedAsarHash).not.toBe(baselineAsarHash)

    application = await launch(appExecutable)
    expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(true)
    expect(await application.evaluate(({ app }) => app.getVersion())).toBe('0.1.0')
    const upgradedPage = await application.firstWindow()
    expect(await upgradedPage.title()).toBe('کارنما')
    await expect(upgradedPage.getByRole('button', { name: 'تسک‌ها', exact: true })).toBeVisible()
    expect(await readSnapshot(upgradedPage)).toEqual(baselineSnapshot)
    verifyDatabase(databasePath, 7)
    verifyTaskPositions(databasePath)

    await application.close()
    application = await launch(appExecutable)
    const restartedPage = await application.firstWindow()
    await expect(restartedPage.getByRole('button', { name: 'تسک‌ها', exact: true })).toBeVisible()
    expect(await readSnapshot(restartedPage)).toEqual(baselineSnapshot)
    verifyDatabase(databasePath, 7)
    verifyTaskPositions(databasePath)
  } finally {
    if (application) await application.close().catch(() => undefined)
  }
})
