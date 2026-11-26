import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { _electron as electron } from 'playwright'
import { expect, test } from '@playwright/test'

test('Phase 7 board ordering, Jalali manual time entry and chart values work in Electron', async () => {
  test.setTimeout(120_000)
  mkdirSync(join(process.cwd(), 'test-results'), { recursive: true })
  const userDataDirectory = mkdtempSync(join(tmpdir(), 'karnama-phase7-acceptance-'))
  const launch = () =>
    electron.launch({
      args: [process.cwd()],
      cwd: process.cwd(),
      env: { ...process.env, KARNAMA_TEST_USER_DATA_DIR: userDataDirectory }
    })

  let application = await launch()
  try {
    let page = await application.firstWindow()
    await page.getByRole('button', { name: 'تکمیل تنظیمات' }).click()
    const finishSetup = page.getByRole('button', { name: 'اتمام تنظیمات و رفتن به داشبورد' })
    await expect(finishSetup).toBeEnabled()
    await finishSetup.click()

    const navigation = page.getByRole('navigation', { name: 'بخش‌های برنامه' })
    await navigation.getByRole('button', { name: 'تسک‌ها' }).click()

    async function createTask(title: string) {
      await page.getByRole('button', { name: 'تسک تازه' }).click()
      await page.getByLabel('عنوان', { exact: true }).fill(title)
      await page.getByRole('button', { name: 'ذخیره تسک' }).click()
      await expect(page.getByRole('region', { name: /برای انجام/ })).toContainText(title)
    }

    const firstTitle = 'Phase 7 اول'
    const secondTitle = 'Phase 7 دوم'
    await createTask(firstTitle)
    await createTask(secondTitle)

    let todoColumn = page.getByRole('region', { name: /برای انجام/ })
    await expect(todoColumn.locator('article')).toHaveCount(2)
    await todoColumn.getByRole('button', { name: `انتقال ${secondTitle} به جایگاه بالاتر` }).click()
    await expect(todoColumn.locator('article').first()).toContainText(secondTitle)

    await application.close()
    application = await launch()
    page = await application.firstWindow()
    await page
      .getByRole('navigation', { name: 'بخش‌های برنامه' })
      .getByRole('button', {
        name: 'تسک‌ها'
      })
      .click()
    todoColumn = page.getByRole('region', { name: /برای انجام/ })
    await expect(todoColumn.locator('article').first()).toContainText(secondTitle)

    const inProgressColumn = page.getByRole('region', { name: /در حال انجام/ })
    await todoColumn
      .getByRole('button', { name: `گرفتن و جابه‌جایی ${secondTitle}` })
      .dragTo(inProgressColumn)
    await expect(inProgressColumn).toContainText(secondTitle)

    const search = page.getByRole('searchbox', { name: 'جست‌وجوی تسک‌ها' })
    await search.fill(secondTitle)
    await page.getByRole('button', { name: 'فهرست', exact: false }).click()
    await expect(page.getByRole('heading', { name: 'فهرست تسک‌ها' })).toBeVisible()
    await expect(page.getByRole('heading', { name: secondTitle })).toBeVisible()
    await page.getByRole('button', { name: 'برد', exact: false }).click()
    await expect(page.getByRole('heading', { name: 'برد تسک‌ها' })).toBeVisible()
    await expect(page.getByRole('region', { name: /در حال انجام/ })).toContainText(secondTitle)
    await page.screenshot({ path: join(process.cwd(), 'test-results', 'phase7-board.png') })
    const themeBefore = await page.locator('html').getAttribute('data-theme')
    await page.getByRole('button', { name: /پوسته/ }).click()
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).not.toBe(themeBefore)
    const themeAfter = await page.locator('html').getAttribute('data-theme')
    const selectedCard = page
      .getByRole('region', { name: /در حال انجام/ })
      .locator('article')
      .first()
    await expect(selectedCard).toHaveCSS(
      'background-color',
      themeAfter === 'dark' ? 'rgb(25, 26, 36)' : 'rgb(255, 255, 255)'
    )
    await page.screenshot({ path: join(process.cwd(), 'test-results', 'phase7-board-theme.png') })
    await page.getByRole('button', { name: /پوسته/ }).click()
    await expect.poll(() => page.locator('html').getAttribute('data-theme')).toBe(themeBefore)

    await page
      .getByRole('navigation', { name: 'بخش‌های برنامه' })
      .getByRole('button', {
        name: 'زمان‌سنج'
      })
      .click()
    const startDate = page.getByRole('button', { name: /تاریخ شروع جلسه:/ })
    const originalDateLabel = await startDate.getAttribute('aria-label')
    await startDate.click()
    const dateDialog = page.getByRole('dialog', { name: 'انتخاب تاریخ' })
    await expect(dateDialog).toBeVisible()
    await expect(dateDialog).toContainText(
      /فروردین|اردیبهشت|خرداد|تیر|مرداد|شهریور|مهر|آبان|آذر|دی|بهمن|اسفند/
    )
    await page.screenshot({ path: join(process.cwd(), 'test-results', 'phase7-jalali-picker.png') })
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('Enter')
    await expect(startDate).not.toHaveAttribute('aria-label', originalDateLabel ?? '')

    const startTime = page.getByLabel('ساعت شروع', { exact: true })
    await expect(startTime).toHaveAttribute('type', 'text')
    await expect(startTime).toHaveAttribute('pattern', '(?:[01][0-9]|2[0-3]):[0-5][0-9]')
    await startTime.fill('09:15')
    await page.locator('fieldset').getByLabel('ساعت', { exact: true }).fill('2')
    await page.locator('fieldset').getByLabel('دقیقه', { exact: true }).fill('45')
    await expect(page.locator('input[type="number"]')).toHaveCount(2)
    await page.getByLabel('تخصیص Work Date').selectOption('manual')
    await expect(page.getByRole('button', { name: /^Work Date:/ })).toBeVisible()
    await expect(page.getByText('مدت: 02:45')).toBeVisible()
    await page.screenshot({ path: join(process.cwd(), 'test-results', 'phase7-manual-time.png') })
    await page.getByRole('button', { name: 'ثبت زمان' }).click()
    await expect(page.getByRole('listitem').filter({ hasText: '02:45' })).toHaveCount(1)

    await page
      .getByRole('navigation', { name: 'بخش‌های برنامه' })
      .getByRole('button', {
        name: 'تحلیل عملکرد'
      })
      .click()
    const chartPoint = page.getByRole('button', {
      name: /^(شنبه|یکشنبه|دوشنبه|سه‌شنبه|چهارشنبه|پنج‌شنبه|جمعه)، زمان ثبت‌شده 2 ساعت و 45 دقیقه$/
    })
    await expect(chartPoint).toBeVisible()
    const tooltipId = await chartPoint.getAttribute('aria-describedby')
    if (!tooltipId) throw new Error('The chart data point has no tooltip description')
    const tooltip = page.locator(`#${tooltipId}`)
    await chartPoint.focus()
    await expect(tooltip).toContainText('2 ساعت و 45 دقیقه')
    await page.screenshot({ path: join(process.cwd(), 'test-results', 'phase7-chart-tooltip.png') })
    await chartPoint.click()
    await expect(tooltip).toContainText('2 ساعت و 45 دقیقه زمان ثبت‌شده')
  } finally {
    await application.close()
    rmSync(userDataDirectory, { recursive: true, force: true })
  }
})
