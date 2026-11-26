import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'
import { eq } from 'drizzle-orm'
import { createCommitmentService } from '../../src/main/db/commitment-service'
import { createSettingsService } from '../../src/main/db/settings-service'
import { createWorkService } from '../../src/main/db/work-service'
import { openKarnamaDatabase } from '../../src/main/db/client'
import { holidays, workDateAllocations } from '../../src/main/db/schema'
import { calendarMonthRange, shiftCalendarMonth } from '../../src/shared/domain/calendar-date'

const timezoneId = 'Asia/Tehran'
const migrationsFolder = resolve(process.cwd(), 'drizzle')
const longTaskTitle = 'پروژه پذیرش نهایی Phase 4 و 5'

type Period = { calendar: 'gregorian'; year: number; month: number }

function currentLocalDate() {
  const values = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: timezoneId,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit'
    })
      .formatToParts(Date.now())
      .map(({ type, value }) => [type, value])
  )
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) }
}

function isoDate(year: number, month: number, day: number) {
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

function dateInMonth(period: Period, day: number) {
  const range = calendarMonthRange(period.year, period.month, period.calendar)
  const date = new Date(`${range.startDate}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + day - 1)
  return date.toISOString().slice(0, 10)
}

function datesInMonth(period: Period) {
  const range = calendarMonthRange(period.year, period.month, period.calendar)
  const result: string[] = []
  const date = new Date(`${range.startDate}T00:00:00Z`)
  const end = new Date(`${range.endDate}T00:00:00Z`)
  while (date <= end) {
    result.push(date.toISOString().slice(0, 10))
    date.setUTCDate(date.getUTCDate() + 1)
  }
  return result
}

function sessionInput(taskId: string, date: string, startTime: string, endTime: string) {
  return {
    taskId,
    startDate: date,
    startTime,
    startOccurrence: null,
    endDate: date,
    endTime,
    endOccurrence: null,
    allocationMode: 'boundary' as const,
    workDate: null
  }
}

test('Phase 4 and 5 runtime acceptance covers analytics, reports and PDF export', async () => {
  test.setTimeout(180_000)
  const reportDirectory = mkdtempSync(join(tmpdir(), 'karnama-phase45-report-'))
  mkdirSync(reportDirectory, { recursive: true })
  mkdirSync(join(process.cwd(), 'test-results'), { recursive: true })

  const userDataDirectory = mkdtempSync(join(tmpdir(), 'karnama-phase45-acceptance-'))
  const shortUserDataDirectory = mkdtempSync(join(tmpdir(), 'karnama-phase45-short-report-'))
  const databasePath = join(userDataDirectory, 'karnama.sqlite')
  const shortDatabasePath = join(shortUserDataDirectory, 'karnama.sqlite')
  const imageDirectory = join(userDataDirectory, 'fixtures')
  mkdirSync(imageDirectory, { recursive: true })

  const current = currentLocalDate()
  const currentPeriod: Period = {
    calendar: 'gregorian',
    year: current.year,
    month: current.month
  }
  const contentPeriod =
    current.day >= 12
      ? currentPeriod
      : { calendar: 'gregorian' as const, ...shiftCalendarMonth(current.year, current.month, -1) }
  const emptyPeriod = {
    calendar: 'gregorian' as const,
    ...shiftCalendarMonth(contentPeriod.year, contentPeriod.month, -1)
  }
  const shortPdfName = `company-empty-${emptyPeriod.year}-${String(emptyPeriod.month).padStart(2, '0')}.pdf`
  const shortPdfPath = join(reportDirectory, shortPdfName)
  const shortOpened = openKarnamaDatabase({
    databasePath: shortDatabasePath,
    migrationsFolder,
    timezoneId
  })
  const shortSettings = createSettingsService(shortOpened.database)
  const shortInitialSettings = shortSettings.get()
  shortSettings.completeOnboarding({
    profile: { displayName: '', jobTitle: 'Product Designer' },
    workingHours: shortInitialSettings.workingHours,
    preferences: { calendar: 'gregorian', theme: 'light', timezoneId }
  })
  shortOpened.database
    .insert(holidays)
    .values(
      datesInMonth(emptyPeriod).map((workDate) => ({
        workDate,
        name: 'تعطیلی آزمون گزارش خالی',
        kind: 'custom' as const,
        createdAtUtcMs: Date.now()
      }))
    )
    .run()
  shortOpened.close()
  const olderPeriod = {
    calendar: 'gregorian' as const,
    ...shiftCalendarMonth(contentPeriod.year, contentPeriod.month, -2)
  }
  const contentDates =
    contentPeriod.year === current.year && contentPeriod.month === current.month
      ? Array.from({ length: 7 }, (_, index) =>
          isoDate(current.year, current.month, current.day - index - 1)
        )
      : [3, 6, 9, 12, 15, 18, 21].map((day) => dateInMonth(contentPeriod, day))

  const opened = openKarnamaDatabase({ databasePath, migrationsFolder, timezoneId })
  const settings = createSettingsService(opened.database)
  const initialSettings = settings.get()
  settings.completeOnboarding({
    profile: { displayName: 'کاربر پذیرش', jobTitle: 'Product Designer' },
    workingHours: initialSettings.workingHours,
    preferences: { calendar: 'gregorian', theme: 'light', timezoneId }
  })

  const work = createWorkService(opened.database)
  const task = work.createTask({
    title: longTaskTitle,
    description: 'داده‌ی آزمایشی فقط در پایگاه موقت برای بررسی گزارش‌ها.',
    notes: '',
    status: 'in_progress',
    priority: 'high',
    estimatedDurationMinutes: 360
  })

  contentDates.slice(0, 6).forEach((date, index) => {
    const startHour = [8, 9, 10, 13, 14, 16][index]
    work.createManualSession(
      sessionInput(
        task.id,
        date,
        `${String(startHour).padStart(2, '0')}:00`,
        `${String(startHour).padStart(2, '0')}:30`
      )
    )
  })
  const boundaryDate = contentDates[6]
  work.createManualSession(sessionInput(task.id, boundaryDate, '05:30', '06:30'))
  work.createManualSession(sessionInput(task.id, dateInMonth(olderPeriod, 15), '09:00', '10:00'))

  const emptyDates = datesInMonth(emptyPeriod)
  opened.database
    .insert(holidays)
    .values(
      emptyDates.map((workDate) => ({
        workDate,
        name: 'تعطیلی آزمون پذیرش',
        kind: 'custom' as const,
        createdAtUtcMs: Date.now()
      }))
    )
    .run()
  const emptyRange = calendarMonthRange(emptyPeriod.year, emptyPeriod.month, emptyPeriod.calendar)
  const emptyCommitment = createCommitmentService(opened.database).calendarMonth({
    ...emptyPeriod,
    focusDate: emptyRange.endDate
  })
  expect(emptyCommitment.targetMinutes).toBe(0)

  const seededSessionIds = work.listSessions().map((session) => session.id)
  const allocationsBefore = seededSessionIds.flatMap((sessionId) =>
    opened.database
      .select({
        sessionId: workDateAllocations.sessionId,
        segmentIndex: workDateAllocations.segmentIndex,
        workDate: workDateAllocations.workDate,
        startUtcMs: workDateAllocations.startUtcMs,
        endUtcMs: workDateAllocations.endUtcMs
      })
      .from(workDateAllocations)
      .where(eq(workDateAllocations.sessionId, sessionId))
      .all()
  )
  opened.close()

  let application: Awaited<ReturnType<typeof electron.launch>> | null = null
  try {
    const electronArgs = [process.cwd()]
    const launch = () =>
      electron.launch({
        args: electronArgs,
        cwd: process.cwd(),
        env: { ...process.env, KARNAMA_TEST_USER_DATA_DIR: userDataDirectory }
      })
    application = await launch()
    const page = await application.firstWindow()
    const main = page.getByRole('main')

    await expect(main.getByRole('heading', { name: 'سلام کاربر پذیرش' })).toBeVisible()
    const currentPeriodInput = { ...contentPeriod }
    const currentData = await page.evaluate(async (period) => {
      const result = await window.karnama.analytics.getPeriod(period)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }, currentPeriodInput)
    expect(currentData.summary.actualMinutes).toBe(240)
    expect(currentData.monthlyTrend).toHaveLength(6)
    expect(currentData.hourlyDistribution.some((item) => item.minutes > 0)).toBe(true)
    expect(currentData.weekdayDistribution.some((item) => item.minutes > 0)).toBe(true)
    expect(currentData.tasks.some((item) => item.title === longTaskTitle)).toBe(true)
    await expect(page.getByText('۰۴:۰۰ ثبت‌شده از', { exact: false })).toBeVisible()

    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase45-dashboard-light.png')
    })
    await main
      .getByRole('heading', { name: 'ساعت کار روزانه' })
      .evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase45-dashboard-daily-light.png')
    })
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await page.getByRole('button', { name: 'تیره کردن پوسته' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark')
    await main.evaluate((element) => {
      element.scrollTop = 0
    })
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase45-dashboard-dark.png')
    })
    await main
      .getByRole('heading', { name: 'ساعت کار روزانه' })
      .evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase45-dashboard-daily-dark.png')
    })

    await page.getByRole('button', { name: 'تحلیل عملکرد' }).click()
    await main.evaluate((element) => {
      element.scrollTop = 0
    })
    await expect(main.getByRole('heading', { name: 'تحلیل عملکرد' })).toBeVisible()
    await expect(
      page.getByRole('group', { name: 'توزیع زمان ثبت‌شده بر اساس ساعت محلی جلسه‌ها' })
    ).toBeVisible()
    await expect(main.getByRole('heading', { name: 'روند شش‌ماهه' })).toBeVisible()
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase45-analytics-dark.png'),
      fullPage: true
    })
    await main
      .getByRole('heading', { name: 'روند شش‌ماهه' })
      .evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase45-analytics-trend-dark.png')
    })
    await main
      .getByRole('heading', { name: 'تخمین در برابر زمان واقعی تسک' })
      .evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase45-analytics-task-stats-dark.png')
    })
    await page.getByRole('button', { name: 'روشن کردن پوسته' }).click()
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await main.evaluate((element) => {
      element.scrollTop = 0
    })
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase45-analytics-light.png'),
      fullPage: true
    })

    const liveStart = await page.evaluate(async (taskId) => {
      const result = await window.karnama.timer.start(taskId)
      if (!result.ok) throw new Error(result.error.message)
      return result.data.run!
    }, task.id)
    const withTimer = await page.evaluate(async (period) => {
      const result = await window.karnama.analytics.getPeriod(period)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }, currentPeriodInput)
    expect(withTimer.activeTimerIncluded).toBe(true)
    expect(withTimer.summary.actualMinutes).toBe(240)
    const stopped = await page.evaluate(async (runId) => {
      const result = await window.karnama.timer.stop(runId)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }, liveStart.id)
    expect(stopped.run).toBeNull()
    const afterTimer = await page.evaluate(async (period) => {
      const result = await window.karnama.analytics.getPeriod(period)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }, currentPeriodInput)
    expect(afterTimer.activeTimerIncluded).toBe(false)
    expect(afterTimer.summary.actualMinutes).toBe(240)

    await page.getByRole('button', { name: 'تسک‌ها' }).click()
    await page
      .getByRole('article')
      .filter({ hasText: longTaskTitle })
      .getByRole('button')
      .filter({ hasText: longTaskTitle })
      .click()
    await page.getByRole('button', { name: 'افزودن لینک' }).click()
    await page.getByLabel('عنوان لینک').fill('نمونه Figma')
    await page.getByLabel('نشانی لینک').fill('https://www.figma.com/design/acceptance')
    await page.getByLabel('نوع لینک').selectOption('figma')
    await page.getByRole('button', { name: 'ذخیره لینک' }).click()
    await expect(page.getByText('نمونه Figma', { exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'افزودن لینک' }).click()
    await page.getByLabel('عنوان لینک').fill('پیوند بیرونی')
    await page.getByLabel('نشانی لینک').fill('https://example.com/acceptance')
    await page.getByLabel('نوع لینک').selectOption('external')
    await page.getByRole('button', { name: 'ذخیره لینک' }).click()
    await expect(page.getByText('پیوند بیرونی', { exact: true })).toBeVisible()

    await application.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        Object.defineProperty(globalThis, '__karnamaAcceptanceOpenedUrl', {
          configurable: true,
          value: url
        })
      }
    })
    await page.getByRole('button', { name: 'بازکردن نمونه Figma' }).click()
    await expect
      .poll(() =>
        application!.evaluate(
          () =>
            (globalThis as typeof globalThis & { __karnamaAcceptanceOpenedUrl?: string })
              .__karnamaAcceptanceOpenedUrl
        )
      )
      .toBe('https://www.figma.com/design/acceptance')
    await page.getByRole('button', { name: 'بازکردن پیوند بیرونی' }).click()
    await expect
      .poll(() =>
        application!.evaluate(
          () =>
            (globalThis as typeof globalThis & { __karnamaAcceptanceOpenedUrl?: string })
              .__karnamaAcceptanceOpenedUrl
        )
      )
      .toBe('https://example.com/acceptance')

    const canvasDataUrl = await page.evaluate(() => {
      const canvas = document.createElement('canvas')
      canvas.width = 480
      canvas.height = 270
      const context = canvas.getContext('2d')!
      const gradient = context.createLinearGradient(0, 0, 480, 270)
      gradient.addColorStop(0, '#4338ca')
      gradient.addColorStop(1, '#22c55e')
      context.fillStyle = gradient
      context.fillRect(0, 0, canvas.width, canvas.height)
      context.fillStyle = '#ffffff'
      context.font = 'bold 30px sans-serif'
      context.fillText('Acceptance 4/5', 26, 64)
      context.fillStyle = '#fef3c7'
      context.fillRect(26, 100, 175, 110)
      context.fillStyle = '#0f172a'
      context.fillRect(220, 100, 230, 110)
      return canvas.toDataURL('image/png')
    })
    const imageBytes = Buffer.from(canvasDataUrl.split(',')[1], 'base64')
    const imageNames = [
      `طراحی-نهایی-${'جزئیات-'.repeat(8)}.png`,
      'نمودار-فاز-۴.png',
      'نمای-صفحه-گزارش.png',
      'پیوست-روند-کار.png'
    ]
    const imagePaths = imageNames.map((name) => {
      const path = join(imageDirectory, name)
      writeFileSync(path, imageBytes)
      return path
    })
    await application.evaluate(({ dialog }, filePaths) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths })
    }, imagePaths)
    await page.getByRole('button', { name: 'افزودن تصویر' }).click()
    await expect(page.getByRole('button', { name: /مشاهده بزرگ‌تر:/ })).toHaveCount(4)
    const publicAttachments = await page.evaluate(async (taskId) => {
      const result = await window.karnama.resources.attachments.list(taskId)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }, task.id)
    expect(publicAttachments).toHaveLength(4)
    for (const attachment of publicAttachments) {
      expect(attachment).not.toHaveProperty('storageRef')
      expect(attachment).not.toHaveProperty('path')
      expect(attachment).not.toHaveProperty('filePath')
    }
    const firstThumbnail = page
      .getByRole('button', { name: `مشاهده بزرگ‌تر: ${imageNames[0]}` })
      .locator('img')
    await firstThumbnail.scrollIntoViewIfNeeded()
    await expect
      .poll(() => firstThumbnail.evaluate((image) => (image as HTMLImageElement).naturalWidth))
      .toBe(480)
    const imageGrid = page.locator('ul.max-h-80')
    const gridMetrics = await imageGrid.evaluate((element) => ({
      scrollHeight: element.scrollHeight,
      clientHeight: element.clientHeight,
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth
    }))
    expect(gridMetrics.scrollHeight).toBeGreaterThan(gridMetrics.clientHeight)
    expect(gridMetrics.scrollWidth).toBeLessThanOrEqual(gridMetrics.clientWidth)

    const longDescription = 'شرح کامل فرایند طراحی و تصمیم‌های ثبت‌شده برای این تصویر. '
      .repeat(8)
      .trim()
    await page.getByRole('button', { name: `ویرایش توضیح ${imageNames[0]}` }).click()
    await page.getByPlaceholder('توضیح تصویر').fill(longDescription)
    await page.getByRole('button', { name: 'ذخیره توضیح' }).click()
    await expect(page.getByText(longDescription, { exact: true })).toBeVisible()
    await page.getByRole('button', { name: `مشاهده بزرگ‌تر: ${imageNames[0]}` }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
    await expect(page.getByRole('dialog').locator('img')).toHaveAttribute('alt', longDescription)
    await page.screenshot({ path: join(process.cwd(), 'test-results', 'phase45-task-details.png') })
    await page.getByRole('button', { name: 'بستن پیش‌نمایش' }).click()

    await page.getByRole('button', { name: 'گزارش‌ها', exact: true }).click()
    await expect(main.getByRole('heading', { name: 'گزارش‌ها' })).toBeVisible()
    await expect(page.getByText('گزارش شرکت', { exact: true })).toBeVisible()
    await expect(page.getByText('نمونه Figma', { exact: true })).toBeVisible()
    await expect(page.getByText('پیوند بیرونی', { exact: true })).toBeVisible()
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase45-company-report.png'),
      fullPage: true
    })

    async function exportReport(format: 'HTML' | 'PDF', filename: string) {
      const outputPath = join(reportDirectory, filename)
      await application!.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      }, outputPath)
      await page.getByRole('button', { name: `خروجی ${format}` }).click()
      await expect(
        page.getByText(`گزارش در فایل ${filename} ذخیره شد.`, { exact: true })
      ).toBeVisible({
        timeout: 45_000
      })
      return outputPath
    }

    const longHtmlName = `company-${contentPeriod.year}-${String(contentPeriod.month).padStart(2, '0')}.html`
    const longPdfName = `company-${contentPeriod.year}-${String(contentPeriod.month).padStart(2, '0')}.pdf`
    const longHtmlPath = await exportReport('HTML', longHtmlName)
    const longHtml = readFileSync(longHtmlPath, 'utf8')
    expect(longHtml).toContain('<html lang="fa" dir="rtl">')
    expect(longHtml).toContain('data:font/woff2;base64,')
    expect(longHtml).toContain('data:image/png;base64,')
    expect(longHtml).toContain('href="https://www.figma.com/design/acceptance"')
    expect(longHtml).toContain('href="https://example.com/acceptance"')
    expect(longHtml).toContain('تراز تجمعی')
    expect(longHtml.match(/تراز تجمعی/g)).toHaveLength(1)
    expect(longHtml).toContain('روزهای کاری باقی‌مانده')
    expect(longHtml).toContain('۰۴:۰۰')
    expect(longHtml).toContain(longDescription)
    expect(longHtml).not.toContain(task.id)
    const longPdfPath = await exportReport('PDF', longPdfName)

    const monthsBack =
      (contentPeriod.year - current.year) * 12 + contentPeriod.month - current.month
    for (let index = 0; index < Math.abs(monthsBack) + 1; index += 1) {
      await page.getByRole('button', { name: 'ماه قبل' }).click()
    }
    const emptyRange = calendarMonthRange(emptyPeriod.year, emptyPeriod.month, emptyPeriod.calendar)
    const emptyPeriodTitle = new Intl.DateTimeFormat('fa-IR', {
      calendar: 'gregory',
      month: 'long',
      year: 'numeric',
      timeZone: 'UTC'
    }).format(new Date(`${emptyRange.startDate}T12:00:00Z`))
    await expect(page.locator('[aria-label="انتخاب ماه گزارش"] [aria-live="polite"]')).toHaveText(
      emptyPeriodTitle
    )
    const emptyData = await page.evaluate(async (period) => {
      const result = await window.karnama.analytics.getPeriod(period)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }, emptyPeriod)
    expect(emptyData.summary.actualMinutes).toBe(0)
    expect(emptyData.summary.targetMinutes).toBe(0)
    const emptyHtmlName = `company-empty-${emptyPeriod.year}-${String(emptyPeriod.month).padStart(2, '0')}.html`
    const emptyHtmlPath = await exportReport('HTML', emptyHtmlName)
    const emptyHtml = readFileSync(emptyHtmlPath, 'utf8')
    expect(emptyHtml).toContain('در این ماه تعهد یا زمان ثبت‌شده‌ای وجود ندارد.')

    for (let index = 0; index < 1; index += 1) {
      await page.getByRole('button', { name: 'ماه بعد' }).click()
    }
    await page
      .getByRole('group', { name: 'نوع گزارش' })
      .getByRole('button', { name: 'گزارش شخصی' })
      .click()
    await expect(main.getByRole('heading', { name: 'مرور الگوهای ماه' })).toBeVisible()
    await expect(main.getByRole('heading', { name: 'مقایسه شش‌ماهه' })).toBeVisible()
    await main
      .getByRole('heading', { name: 'مقایسه شش‌ماهه' })
      .evaluate((element) => element.scrollIntoView({ block: 'center' }))
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase45-personal-comparison.png')
    })
    await page.screenshot({
      path: join(process.cwd(), 'test-results', 'phase45-personal-report.png'),
      fullPage: true
    })
    const personalHtmlName = `personal-${contentPeriod.year}-${String(contentPeriod.month).padStart(2, '0')}.html`
    const personalHtmlPath = await exportReport('HTML', personalHtmlName)
    const personalHtml = readFileSync(personalHtmlPath, 'utf8')
    expect(personalHtml).toContain('class="bars"')
    expect(personalHtml).toContain('class="trend"')
    const personalPdfName = `personal-${contentPeriod.year}-${String(contentPeriod.month).padStart(2, '0')}.pdf`
    const personalPdfPath = await exportReport('PDF', personalPdfName)

    await page
      .getByRole('complementary')
      .getByRole('button', { name: 'تنظیمات', exact: true })
      .click()
    await page.getByLabel('مرز Work Date').fill('07:00')
    await expect
      .poll(async () =>
        page.evaluate(async () => {
          const result = await window.karnama.settings.get()
          return result.ok ? result.data.workingHours.workDateBoundaryMinutes : null
        })
      )
      .toBe(420)
    const afterBoundary = await page.evaluate(async (period) => {
      const result = await window.karnama.analytics.getPeriod(period)
      if (!result.ok) throw new Error(result.error.message)
      return result.data
    }, currentPeriodInput)
    expect(afterBoundary.summary.actualMinutes).toBe(240)

    await application.close()
    application = null
    const checkDb = new Database(databasePath, { readonly: true, fileMustExist: true })
    try {
      const allocationsAfter = seededSessionIds.flatMap((sessionId) =>
        checkDb
          .prepare(
            'select session_id as sessionId, segment_index as segmentIndex, work_date as workDate, start_utc_ms as startUtcMs, end_utc_ms as endUtcMs from work_date_allocations where session_id = ? order by segment_index'
          )
          .all(sessionId)
      )
      expect(allocationsAfter).toEqual(allocationsBefore)
      const snapshots = checkDb
        .prepare(
          'select report_type as reportType, format, period_key as periodKey, payload_json as payloadJson from report_snapshots'
        )
        .all() as Array<{
        reportType: string
        format: string
        periodKey: string
        payloadJson: string
      }>
      expect(snapshots.map(({ reportType, format }) => `${reportType}:${format}`).sort()).toEqual([
        'company:html',
        'company:html',
        'company:pdf',
        'personal:html',
        'personal:pdf'
      ])
      const currentSnapshots = snapshots.filter(
        (row) =>
          row.periodKey ===
          `gregorian:${contentPeriod.year}-${String(contentPeriod.month).padStart(2, '0')}`
      )
      expect(currentSnapshots.length).toBe(4)
      for (const snapshot of currentSnapshots) {
        expect(JSON.parse(snapshot.payloadJson).summary.actualMinutes).toBe(240)
      }
    } finally {
      checkDb.close()
    }

    const shortApplication = await electron.launch({
      args: [process.cwd()],
      cwd: process.cwd(),
      env: { ...process.env, KARNAMA_TEST_USER_DATA_DIR: shortUserDataDirectory }
    })
    const shortPage = await shortApplication.firstWindow()
    try {
      await shortPage.getByRole('button', { name: 'گزارش‌ها', exact: true }).click()
      const monthsBackToEmpty =
        (emptyPeriod.year - current.year) * 12 + emptyPeriod.month - current.month
      for (let index = 0; index < Math.abs(monthsBackToEmpty); index += 1) {
        await shortPage.getByRole('button', { name: 'ماه قبل' }).click()
      }
      const shortEmptyRange = calendarMonthRange(
        emptyPeriod.year,
        emptyPeriod.month,
        emptyPeriod.calendar
      )
      const shortPeriodTitle = new Intl.DateTimeFormat('fa-IR', {
        calendar: 'gregory',
        month: 'long',
        year: 'numeric',
        timeZone: 'UTC'
      }).format(new Date(`${shortEmptyRange.startDate}T12:00:00Z`))
      await expect(
        shortPage.locator('[aria-label="انتخاب ماه گزارش"] [aria-live="polite"]')
      ).toHaveText(shortPeriodTitle)
      await shortApplication.evaluate(({ dialog }, filePath) => {
        dialog.showSaveDialog = async () => ({ canceled: false, filePath })
      }, shortPdfPath)
      await shortPage.getByRole('button', { name: 'خروجی PDF' }).click()
      await expect(
        shortPage.getByText(`گزارش در فایل ${shortPdfName} ذخیره شد.`, { exact: true })
      ).toBeVisible({
        timeout: 45_000
      })
      const blankDb = new Database(shortDatabasePath, { readonly: true, fileMustExist: true })
      try {
        const snapshot = blankDb
          .prepare('select payload_json as payloadJson from report_snapshots where format = ?')
          .get('pdf') as { payloadJson: string } | undefined
        expect(snapshot).toBeDefined()
        const report = JSON.parse(snapshot!.payloadJson)
        expect(report.summary.actualMinutes).toBe(0)
        expect(report.summary.targetMinutes).toBe(0)
        expect(report.tasks).toEqual([])
      } finally {
        blankDb.close()
      }
    } finally {
      await shortApplication.close()
    }

    const shortReportFiles = [
      longHtmlPath,
      longPdfPath,
      emptyHtmlPath,
      shortPdfPath,
      personalHtmlPath,
      personalPdfPath
    ]
    expect(shortReportFiles.every((path) => existsSync(path))).toBe(true)
    console.log(`PHASE45_REPORT_DIR=${reportDirectory}`)
  } finally {
    if (application) await application.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
    rmSync(shortUserDataDirectory, { recursive: true, force: true })
  }
})
