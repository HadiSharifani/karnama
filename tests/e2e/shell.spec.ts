import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'

test('first-run shell stays honest and setup persists across restart', async () => {
  mkdirSync(join(process.cwd(), 'test-results'), { recursive: true })
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
    await application.evaluate(({ ipcMain }) => {
      type Handler = (...args: unknown[]) => Promise<unknown>
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })
        ._invokeHandlers
      const original = handlers.get('analytics:get-period')
      if (!original) throw new Error('Missing analytics IPC handler')
      let attempts = 0
      handlers.set('analytics:get-period', async (...args) => {
        await new Promise<void>((resolve) => setTimeout(resolve, 250))
        if (attempts++ === 0) {
          return {
            ok: false,
            error: { code: 'storage_error', message: 'خطای آزمایش پذیرش.' }
          }
        }
        return original(...args)
      })
    })
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
    await expect(firstPage.getByRole('status')).toHaveText('در حال آماده‌سازی خلاصه‌ها…')
    await firstPage.screenshot({
      path: join(process.cwd(), 'test-results', 'phase5-dashboard-loading.png')
    })
    await expect(firstPage.getByRole('alert')).toContainText('خطای آزمایش پذیرش.')
    await firstPage.screenshot({
      path: join(process.cwd(), 'test-results', 'phase5-dashboard-error.png')
    })
    await firstPage.getByRole('button', { name: 'تلاش دوباره' }).click()
    await expect(firstPage.getByRole('status')).toHaveText('در حال آماده‌سازی خلاصه‌ها…')
    await expect(firstPage.getByRole('heading', { name: 'هنوز زمانی ثبت نشده است' })).toBeVisible()
    await firstPage.getByRole('button', { name: 'تقویم کاری' }).click()
    await expect(
      firstPage.getByRole('main').getByRole('heading', { name: 'تقویم کاری' })
    ).toBeVisible()
    await expect(firstPage.getByText('تعهد ماه', { exact: true })).toBeVisible()
  } finally {
    await application.close()
  }

  application = await launch()
  try {
    const secondPage = await application.firstWindow()
    await expect(secondPage.getByRole('heading', { name: 'هنوز زمانی ثبت نشده است' })).toBeVisible()
    await expect(secondPage.getByRole('heading', { name: 'به کارنما خوش آمدید' })).toHaveCount(0)
  } finally {
    await application.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})

test('task links and images are editable, previewable, and read-only when archived', async () => {
  mkdirSync(join(process.cwd(), 'test-results'), { recursive: true })
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'karnama-resources-e2e-'))
  const sourceDirectory = mkdtempSync(join(tmpdir(), 'karnama-image-e2e-'))
  const firstImage = join(sourceDirectory, 'hero.png')
  const retainedImage = join(sourceDirectory, 'retained.png')
  const unsupportedImage = join(sourceDirectory, 'unsupported.svg')
  const oversizedImage = join(sourceDirectory, 'oversized.png')
  const imageBytes = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/8M8AAAAASUVORK5CYII=',
    'base64'
  )
  writeFileSync(firstImage, imageBytes)
  writeFileSync(retainedImage, imageBytes)
  writeFileSync(unsupportedImage, '<svg/>')
  writeFileSync(oversizedImage, Buffer.alloc(20 * 1024 * 1024 + 1))
  const electronArgs = [
    ...(process.env.KARNAMA_E2E_NO_SANDBOX === '1' ? ['--no-sandbox'] : []),
    process.cwd()
  ]
  let application = await electron.launch({
    args: electronArgs,
    cwd: process.cwd(),
    env: { ...process.env, KARNAMA_TEST_USER_DATA_DIR: userDataDirectory }
  })

  try {
    const page = await application.firstWindow()
    await page.getByRole('button', { name: 'تسک‌ها' }).click()
    await application.evaluate(({ ipcMain }) => {
      type Handler = (...args: unknown[]) => Promise<unknown>
      const handlers = (ipcMain as unknown as { _invokeHandlers: Map<string, Handler> })
        ._invokeHandlers
      for (const channel of ['task-links:list', 'attachments:list']) {
        const original = handlers.get(channel)
        if (!original) throw new Error(`Missing IPC handler: ${channel}`)
        handlers.set(channel, async (...args) => {
          await new Promise<void>((resolve) => setTimeout(resolve, 250))
          return original(...args)
        })
      }
    })
    await page.getByRole('button', { name: 'تسک تازه' }).click()
    await page.getByLabel('عنوان', { exact: true }).fill('تسک پیوست‌ها')
    await page.getByRole('button', { name: 'ذخیره تسک' }).click()
    await expect(page.getByRole('heading', { name: 'جزئیات تسک' })).toBeVisible()
    await expect(page.getByText('در حال خواندن لینک‌ها…', { exact: true })).toBeVisible({
      timeout: 1_000
    })
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase4-task-resources-loading.png')
    })
    await expect(page.getByText('هنوز لینکی برای این تسک ثبت نشده است.')).toBeVisible()
    await expect(page.getByText('هنوز تصویری برای این تسک پیوست نشده است.')).toBeVisible()
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase4-task-resources-empty.png')
    })

    await page.getByRole('button', { name: 'افزودن لینک' }).click()
    await page.getByLabel('عنوان لینک').fill('طرح فیگما')
    await page.getByLabel('نشانی لینک').fill('https://www.figma.com/design/example')
    await page.getByLabel('نوع لینک').selectOption('figma')
    await page.getByRole('button', { name: 'ذخیره لینک' }).click()
    await expect(page.getByText('طرح فیگما', { exact: true })).toBeVisible()

    await application.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        Object.defineProperty(globalThis, '__karnamaOpenedExternalUrl', {
          configurable: true,
          value: url
        })
      }
    })
    await page.getByRole('button', { name: 'بازکردن طرح فیگما' }).click()
    await expect
      .poll(() =>
        application.evaluate(
          () =>
            (globalThis as unknown as Record<string, string | undefined>)[
              '__karnamaOpenedExternalUrl'
            ]
        )
      )
      .toBe('https://www.figma.com/design/example')

    await page.getByRole('button', { name: 'ویرایش طرح فیگما' }).click()
    await page.getByLabel('عنوان لینک').fill('طرح به‌روز')
    await page.getByRole('button', { name: 'ذخیره لینک' }).click()
    await expect(page.getByText('طرح به‌روز', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'افزودن لینک' }).click()
    await page.getByLabel('عنوان لینک').fill('نشانی نامعتبر')
    await page.getByLabel('نشانی لینک').fill('https://[')
    await page.getByLabel('نوع لینک').selectOption('external')
    const invalidUrlInput = page.getByLabel('نشانی لینک')
    await expect
      .poll(() =>
        invalidUrlInput.evaluate((input) => (input as HTMLInputElement).validity.typeMismatch)
      )
      .toBe(true)
    await page.getByRole('button', { name: 'ذخیره لینک' }).click()
    await expect(page.getByText('نشانی نامعتبر', { exact: true })).toHaveCount(0)
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase4-task-resources-invalid-url.png')
    })
    await page.getByRole('button', { name: 'لغو' }).click()

    await page.getByRole('button', { name: 'افزودن لینک' }).click()
    await page.getByLabel('عنوان لینک').fill('طرح ناامن')
    await page.getByLabel('نشانی لینک').fill('file:///C:/Windows/win.ini')
    await page.getByLabel('نوع لینک').selectOption('external')
    await page.getByRole('button', { name: 'ذخیره لینک' }).click()
    await expect(page.getByRole('alert')).toHaveText('فقط لینک‌های HTTP و HTTPS مجاز هستند.')
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase4-task-resources-link-error.png')
    })
    await page.getByRole('button', { name: 'لغو' }).click()

    await page.getByRole('button', { name: 'افزودن لینک' }).click()
    await page.getByLabel('عنوان لینک').fill('حذف‌شدنی')
    await page.getByLabel('نشانی لینک').fill('http://example.com/resource')
    await page.getByLabel('نوع لینک').selectOption('external')
    await page.getByRole('button', { name: 'ذخیره لینک' }).click()
    await expect(page.getByText('حذف‌شدنی', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'حذف حذف‌شدنی' }).click()
    await expect(page.getByText('حذف‌شدنی', { exact: true })).toHaveCount(0)

    const encodedImages = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 32
      canvas.height = 24
      const context = canvas.getContext('2d')!
      context.fillStyle = '#4338ca'
      context.fillRect(0, 0, canvas.width, canvas.height)
      return {
        jpeg: canvas.toDataURL('image/jpeg', 0.9),
        webp: canvas.toDataURL('image/webp')
      }
    })
    expect(encodedImages.jpeg).toMatch(/^data:image\/jpeg;base64,/)
    expect(encodedImages.webp).toMatch(/^data:image\/webp;base64,/)
    const jpegImage = join(sourceDirectory, 'photo.jpeg')
    const webpImage = join(sourceDirectory, 'preview.webp')
    writeFileSync(jpegImage, Buffer.from(encodedImages.jpeg.split(',')[1], 'base64'))
    writeFileSync(webpImage, Buffer.from(encodedImages.webp.split(',')[1], 'base64'))

    await application.evaluate(
      ({ dialog }, filePaths) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
      },
      [unsupportedImage]
    )
    await page.getByRole('button', { name: 'افزودن تصویر' }).click()
    await expect(page.getByRole('alert')).toHaveText(
      'فقط تصویرهای PNG، JPEG و WebP قابل افزودن هستند.'
    )
    await application.evaluate(
      ({ dialog }, filePaths) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
      },
      [oversizedImage]
    )
    await page.getByRole('button', { name: 'افزودن تصویر' }).click()
    await expect(page.getByRole('alert')).toHaveText('حجم تصویر نباید بیش از ۲۰ مگابایت باشد.')
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase4-task-resources-image-error.png')
    })

    await application.evaluate(
      ({ dialog }, filePaths) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
      },
      [firstImage, retainedImage, jpegImage, webpImage]
    )
    await page.getByRole('button', { name: 'افزودن تصویر' }).click()
    await expect(page.getByRole('button', { name: 'مشاهده بزرگ‌تر: hero.png' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'مشاهده بزرگ‌تر: retained.png' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'مشاهده بزرگ‌تر: photo.jpeg' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'مشاهده بزرگ‌تر: preview.webp' })).toBeVisible()

    const thumbnail = page.getByRole('button', { name: 'مشاهده بزرگ‌تر: hero.png' }).locator('img')
    await thumbnail.scrollIntoViewIfNeeded()
    await expect
      .poll(() => thumbnail.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBe(1)
    for (const imageName of ['photo.jpeg', 'preview.webp']) {
      const imageThumbnail = page
        .getByRole('button', { name: `مشاهده بزرگ‌تر: ${imageName}` })
        .locator('img')
      await imageThumbnail.scrollIntoViewIfNeeded()
      await expect
        .poll(() => imageThumbnail.evaluate((image) => (image as HTMLImageElement).naturalWidth))
        .toBeGreaterThan(0)
    }
    await page.getByRole('button', { name: 'مشاهده بزرگ‌تر: hero.png' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await page.getByRole('button', { name: 'بستن پیش‌نمایش' }).click()

    await page.getByRole('button', { name: 'ویرایش توضیح hero.png' }).click()
    await page.getByPlaceholder('توضیح تصویر').fill('صفحه ورود')
    await page.getByRole('button', { name: 'ذخیره توضیح' }).click()
    await expect(page.getByText('صفحه ورود', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'حذف تصویر hero.png' }).click()
    await expect(page.getByRole('button', { name: 'مشاهده بزرگ‌تر: hero.png' })).toHaveCount(0)

    await page.getByRole('button', { name: 'بایگانی', exact: true }).last().click()
    await page.getByRole('button', { name: 'بایگانی', exact: true }).click()
    await page.getByRole('button', { name: /تسک پیوست‌ها/ }).click()
    await expect(page.getByText('طرح به‌روز', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'افزودن لینک' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'افزودن تصویر' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'ویرایش توضیح retained.png' })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'مشاهده بزرگ‌تر: retained.png' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'ویرایش طرح به‌روز' })).toHaveCount(0)

    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase4-task-resources.png')
    })
    await application.close()
    application = await electron.launch({
      args: electronArgs,
      cwd: process.cwd(),
      env: { ...process.env, KARNAMA_TEST_USER_DATA_DIR: userDataDirectory }
    })
    const restartedPage = await application.firstWindow()
    await restartedPage.getByRole('button', { name: 'تسک‌ها' }).click()
    await restartedPage.getByRole('button', { name: 'بایگانی', exact: true }).click()
    await restartedPage.getByRole('button', { name: /^تسک پیوست‌ها/ }).click()
    await expect(restartedPage.getByText('طرح به‌روز', { exact: true })).toBeVisible()
    await expect(
      restartedPage.getByRole('button', { name: 'مشاهده بزرگ‌تر: retained.png' })
    ).toBeVisible()
    await expect(
      restartedPage.getByRole('button', { name: 'مشاهده بزرگ‌تر: photo.jpeg' })
    ).toBeVisible()
    await expect(
      restartedPage.getByRole('button', { name: 'مشاهده بزرگ‌تر: preview.webp' })
    ).toBeVisible()
    await expect(restartedPage.getByRole('button', { name: 'بازیابی تسک' })).toBeVisible()
    await restartedPage.getByRole('button', { name: 'بازیابی تسک' }).click()
    await restartedPage.getByRole('button', { name: 'تسک‌های فعال' }).click()
    await restartedPage
      .getByRole('article')
      .filter({ hasText: 'تسک پیوست‌ها' })
      .getByRole('button')
      .filter({ hasText: 'تسک پیوست‌ها' })
      .click()
    await expect(restartedPage.getByRole('button', { name: 'ویرایش طرح به‌روز' })).toBeVisible()
    await expect(
      restartedPage.getByRole('button', { name: 'مشاهده بزرگ‌تر: retained.png' })
    ).toBeVisible()
  } finally {
    await application.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
    rmSync(sourceDirectory, { recursive: true, force: true })
  }
})
