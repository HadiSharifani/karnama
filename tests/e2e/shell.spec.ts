import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'

test('first-run shell stays honest and setup persists across restart', async () => {
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'karnama-e2e-'))
  const electronArgs = [
    ...(process.env.KARNAMA_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    process.cwd()
  ]
  const launch = () =>
    electron.launch({
      args: electronArgs,
      cwd: process.cwd(),
      env: { ...process.env, KARNAMA_TEST_USER_DATA_DIR: userDataDirectory }
    })

  let application = await launch()
  try {
    const firstPage = await application.firstWindow()
    await expect(firstPage.getByRole('heading', { name: 'به کارنما خوش آمدید' })).toBeVisible()
    await expect(firstPage.getByText('0 ساعت')).toHaveCount(0)
    await expect(firstPage.getByRole('navigation', { name: 'بخش‌های برنامه' })).toBeVisible()

    await firstPage.getByRole('button', { name: 'تکمیل تنظیمات' }).click()
    await expect(firstPage.getByLabel('عنوان شغلی')).toHaveValue('Product Designer')
    await expect(firstPage.getByLabel('تعهد روزانه، ساعت')).toHaveValue('8')
    await expect(firstPage.getByLabel('مرز Work Date')).toHaveValue('06:00')

    const finishSetup = firstPage.getByRole('button', { name: 'اتمام تنظیمات و رفتن به داشبورد' })
    await expect(finishSetup).toBeEnabled({ timeout: 5_000 })
    await finishSetup.click()
    await expect(
      firstPage.getByRole('heading', { name: 'هنوز زمان کاری ثبت نشده است' })
    ).toBeVisible()
    await firstPage.getByRole('button', { name: 'تقویم کاری' }).click()
    await expect(firstPage.getByRole('heading', { name: 'تقویم کاری' })).toBeVisible()
    await expect(firstPage.getByText('تعهد ماه')).toBeVisible()
  } finally {
    await application.close()
  }

  application = await launch()
  try {
    const secondPage = await application.firstWindow()
    await expect(
      secondPage.getByRole('heading', { name: 'هنوز زمان کاری ثبت نشده است' })
    ).toBeVisible()
    await expect(secondPage.getByRole('heading', { name: 'به کارنما خوش آمدید' })).toHaveCount(0)
  } finally {
    await application.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})
