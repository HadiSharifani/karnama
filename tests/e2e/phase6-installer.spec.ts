import { mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'

const installedExecutable = process.env.KARNAMA_INSTALLED_EXE

test('installed NSIS app starts offline and creates a verified local backup', async () => {
  test.skip(!installedExecutable, 'Set KARNAMA_INSTALLED_EXE to the isolated installed app.')
  test.setTimeout(120_000)
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'karnama-installed-user-data-'))
  const application = await electron.launch({
    executablePath: resolve(installedExecutable!),
    args: [],
    cwd: dirname(resolve(installedExecutable!)),
    env: { ...process.env, KARNAMA_TEST_USER_DATA_DIR: userDataDirectory }
  })

  try {
    expect(await application.evaluate(({ app }) => app.isPackaged)).toBe(true)
    expect(await application.evaluate(({ app }) => app.getPath('userData'))).toBe(userDataDirectory)

    const page = await application.firstWindow()
    const externalRequests: string[] = []
    page.on('request', (request) => {
      if (/^https?:/i.test(request.url())) externalRequests.push(request.url())
    })
    const offlineSession = await page.context().newCDPSession(page)
    await offlineSession.send('Network.enable')
    await offlineSession.send('Network.emulateNetworkConditions', {
      offline: true,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1
    })
    await expect(page.getByRole('heading', { name: 'به کارنما خوش آمدید' })).toBeVisible()
    await page.getByRole('button', { name: 'تکمیل تنظیمات' }).click()
    const finishSetup = page.getByRole('button', { name: 'اتمام تنظیمات و رفتن به داشبورد' })
    await expect(finishSetup).toBeEnabled()
    await finishSetup.click()

    await page.getByRole('complementary').getByRole('button', { name: 'تنظیمات' }).click()
    const backupCard = page
      .getByRole('main')
      .locator('section')
      .filter({ hasText: 'پشتیبان‌گیری و بازیابی' })
    await backupCard.getByRole('button', { name: 'ساخت نسخهٔ دستی' }).click()
    await expect(backupCard.getByText(/آماده شد/)).toBeVisible({ timeout: 30_000 })

    const backupRow = backupCard.getByRole('listitem')
    await expect(backupRow).toContainText('دستی')
    await backupRow.getByRole('button', { name: 'بررسی' }).click()
    await expect(backupCard.getByText('فایل‌های آن تأیید شدند.')).toBeVisible()
    expect(
      readdirSync(join(userDataDirectory, 'backups')).some((name) => name.endsWith('.zip'))
    ).toBe(true)
    expect(externalRequests).toEqual([])
    await offlineSession.detach()
  } finally {
    await application.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})
