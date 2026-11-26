import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'

test('Phase 6 backup settings create, validate and cancel restore safely', async () => {
  test.setTimeout(120_000)
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'karnama-phase6-backup-'))
  const application = await electron.launch({
    args: [process.cwd()],
    cwd: process.cwd(),
    env: { ...process.env, KARNAMA_TEST_USER_DATA_DIR: userDataDirectory }
  })

  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'تکمیل تنظیمات' }).click()
    const finishSetup = page.getByRole('button', { name: 'اتمام تنظیمات و رفتن به داشبورد' })
    await expect(finishSetup).toBeEnabled()
    await finishSetup.click()
    await page.getByRole('complementary').getByRole('button', { name: 'تنظیمات' }).click()

    const main = page.getByRole('main')
    const backupCard = main.locator('section').filter({ hasText: 'پشتیبان‌گیری و بازیابی' })
    await expect(main.getByRole('heading', { name: 'پشتیبان‌گیری و بازیابی' })).toBeVisible()
    await expect(main.getByText(/هنوز نسخهٔ پشتیبانی وجود ندارد/)).toBeVisible()

    await backupCard.getByRole('button', { name: 'ساخت نسخهٔ دستی' }).click()
    await expect(main.getByRole('status').filter({ hasText: 'آماده شد' })).toBeVisible({
      timeout: 30_000
    })

    const backupRow = backupCard.getByRole('listitem')
    await expect(backupRow).toContainText('دستی')
    await expect(backupRow).toContainText('بررسی‌نشده')
    await backupRow.getByRole('button', { name: 'بررسی' }).click()
    await expect(main.getByText('فایل‌های آن تأیید شدند.')).toBeVisible()

    await backupRow.getByRole('button', { name: 'بازیابی' }).click()
    const confirmation = page.getByRole('dialog', { name: 'تأیید جایگزینی داده‌ها' })
    await expect(confirmation).toContainText('یک نسخهٔ ایمنی می‌سازد')
    await confirmation.getByRole('button', { name: 'انصراف' }).click()
    await expect(confirmation).toHaveCount(0)
    await expect(backupRow).toBeVisible()
  } finally {
    await application.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})
