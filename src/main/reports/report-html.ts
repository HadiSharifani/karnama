import type { AnalyticsPeriodDto } from '../../shared/contracts/analytics'
import { calendarMonthRange } from '../../shared/domain/calendar-date'

export type ReportType = 'company' | 'personal'
export type EmbeddedImage = { mimeType: string; base64: string }
export type ReportFonts = { arabic: string; latin: string }

const weekdays = ['شنبه', 'یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنج‌شنبه', 'جمعه']

export function buildReportHtml(
  report: AnalyticsPeriodDto,
  reportType: ReportType,
  images: Map<string, EmbeddedImage>,
  fonts: ReportFonts
) {
  const title = reportType === 'company' ? 'گزارش کاری شرکت' : 'گزارش شخصی کار'
  const periodLabel = formatPeriod(
    report.period.startDate,
    report.period.endDate,
    report.period.calendar
  )
  const activeTimerNote = report.activeTimerIncluded
    ? '<p class="note">این خلاصه بخش جاریِ تایمر فعال را تا زمان تهیه گزارش نیز در بر می‌گیرد.</p>'
    : ''
  const summary = `
    <section class="metrics">
      ${metric('مجموع زمان ثبت‌شده', formatDuration(report.summary.actualMinutes))}
      ${metric('تعهد ماه', formatDuration(report.summary.targetMinutes))}
      ${metric('مانده تعهد', formatSignedDuration(report.summary.remainingMinutes))}
      ${metric('تراز تجمعی', formatSignedDuration(report.summary.cumulativeBalanceMinutes))}
      ${metric('روزهای کاری', formatNumber(report.summary.workingDays))}
      ${metric('روزهای مرخصی', formatNumber(report.summary.leaveDays))}
      ${metric('روزهای کاری باقی‌مانده', formatNumber(report.summary.remainingWorkDays))}
    </section>`
  const daily = `
    <section>
      <h2>ریز کار روزانه بر پایه Work Date</h2>
      ${
        report.days.some((day) => day.actualMinutes > 0 || day.targetMinutes > 0)
          ? `
      <table><thead><tr><th>تاریخ</th><th>روز هفته</th><th>ثبت‌شده</th><th>تعهد</th><th>فاصله هدف تا ثبت</th><th>تراز روز</th></tr></thead>
        <tbody>${report.days
          .map(
            (day) => `<tr${day.isCurrentWorkDate ? ' class="current-day"' : ''}>
              <td>${escapeHtml(formatDate(day.workDate, report.period.calendar))}</td>
              <td>${weekdays[day.weekdayIso - 1]}</td>
              <td dir="ltr">${formatDuration(day.actualMinutes)}</td>
              <td dir="ltr">${formatDuration(day.targetMinutes)}</td>
              <td dir="ltr">${formatDuration(day.untrackedTargetGapMinutes)}</td>
              <td dir="ltr">${formatSignedDuration(day.balanceMinutes)}</td>
            </tr>`
          )
          .join('')}</tbody></table>`
          : '<p class="empty">در این ماه تعهد یا زمان ثبت‌شده‌ای وجود ندارد.</p>'
      }
    </section>`
  const targetGap = `
    <section class="notice">
      <h2>داده‌هایی که در این گزارش قابل محاسبه‌اند</h2>
      <p>فاصله هدف تا زمان ثبت‌شده در هر روز: مثبت‌ترین بخشِ تعهد منهای زمان ثبت‌شده محاسبه شده است. این مقدار، بازه ساعت مشخصی از روز نیست.</p>
      <p>${escapeHtml(report.untrackedIntervals.reason)}</p>
    </section>`
  const personal =
    reportType === 'personal'
      ? `
    <section class="two-col">
      <div class="panel">
        <h2>توزیع بر اساس ساعت روز</h2>
        ${barChart(
          report.hourlyDistribution.map((item) => ({
            label: `${formatNumber(item.hour)}:00`,
            value: item.minutes,
            hint: `ساعت ${formatNumber(item.hour)}`
          }))
        )}
      </div>
      <div class="panel">
        <h2>توزیع هفتگی</h2>
        ${barChart(
          report.weekdayDistribution.map((item) => ({
            label: weekdays[item.weekdayIso - 1],
            value: item.minutes,
            hint: weekdays[item.weekdayIso - 1]
          }))
        )}
      </div>
    </section>
    <section class="trend-section">
      <h2>روند شش‌ماهه</h2>
      <div class="trend">${report.monthlyTrend
        .map((item) => {
          const label = escapeHtml(formatMonth(item.year, item.month, item.calendar))
          const height = percent(
            item.actualMinutes,
            Math.max(...report.monthlyTrend.map((trend) => trend.actualMinutes))
          )
          return `<div class="trend-item"><div class="trend-track"><div class="trend-bar" style="height:${height}%"></div></div><span>${label}</span><b dir="ltr">${formatDuration(item.actualMinutes)}</b></div>`
        })
        .join('')}</div>
      <p class="note">تغییر نسبت به ماه قبل: ${formatSignedDuration(report.previousMonth.actualChangeMinutes)}${report.previousMonth.actualChangePercent === null ? '' : ` (${formatSignedPercent(report.previousMonth.actualChangePercent)})`}.</p>
    </section>`
      : ''
  const taskTable = `
    <section>
      <h2>${reportType === 'company' ? 'تسک‌های گزارش' : 'آمار مدت تسک‌ها'}</h2>
      ${
        report.tasks.length
          ? `
        <table><thead><tr><th>تسک</th><th>وضعیت فعلی</th><th>زمان دوره</th><th>زمان کل</th><th>تخمین</th><th>جلسه‌ها</th></tr></thead>
        <tbody>${report.tasks
          .map(
            (task) => `<tr>
            <td>${escapeHtml(task.title)}${task.isArchived ? '<small> · بایگانی‌شده</small>' : ''}</td>
            <td>${escapeHtml(statusLabel(task.status))}</td>
            <td dir="ltr">${formatDuration(task.actualMinutes)}</td>
            <td dir="ltr">${formatDuration(task.lifetimeActualMinutes)}</td>
            <td dir="ltr">${task.estimatedMinutes === null ? '—' : formatDuration(task.estimatedMinutes)}</td>
            <td>${formatNumber(task.sessionCount)}</td>
          </tr>`
          )
          .join('')}</tbody></table>`
          : '<p class="empty">برای این دوره تسکی با زمان ثبت‌شده پیدا نشد.</p>'
      }
    </section>`
  const resources =
    reportType === 'company'
      ? `
    <section>
      <h2>پیوندها و تصاویر تسک‌ها</h2>
      ${
        report.tasks
          .filter((task) => task.links.length || task.attachments.length)
          .map(
            (task) => `<article class="resource-task">
          <h3>${escapeHtml(task.title)}</h3>
          ${
            task.links.length
              ? `<ul class="links">${task.links
                  .map((link) => {
                    const safeUrl = safeHttpUrl(link.url)
                    return safeUrl
                      ? `<li><a href="${escapeHtml(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(link.title || link.type)}</a></li>`
                      : ''
                  })
                  .join('')}</ul>`
              : ''
          }
          ${
            task.attachments.length
              ? `<div class="images">${task.attachments
                  .map((attachment) => {
                    const image = images.get(attachment.id)
                    const imageMarkup = image
                      ? `<img src="data:${image.mimeType};base64,${image.base64}" alt="${escapeHtml(attachment.description || attachment.displayName)}">`
                      : '<div class="missing-image">تصویر در دسترس نیست</div>'
                    return `<figure>${imageMarkup}<figcaption>${escapeHtml(attachment.description || attachment.displayName)}</figcaption></figure>`
                  })
                  .join('')}</div>`
              : ''
          }
        </article>`
          )
          .join('') || '<p class="empty">برای تسک‌های این گزارش پیوند یا تصویری ثبت نشده است.</p>'
      }
    </section>`
      : ''

  return `<!doctype html>
<html lang="fa" dir="rtl">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; font-src data:; img-src data:; base-uri 'none'; form-action 'none'; object-src 'none'">
<title>${escapeHtml(title)} — ${escapeHtml(periodLabel)}</title>
<style>
@font-face{font-family:Vazirmatn;src:url(data:font/woff2;base64,${fonts.arabic}) format('woff2');font-weight:100 900;unicode-range:U+0600-06FF,U+0750-077F,U+0870-08FF,U+200C-200E,U+2010-2011,U+204F,U+2E41,U+FB50-FDFF,U+FE70-FEFC}
@font-face{font-family:Vazirmatn;src:url(data:font/woff2;base64,${fonts.latin}) format('woff2');font-weight:100 900;unicode-range:U+0000-00FF,U+2000-206F,U+20AC,U+2122,U+2212}
:root{font-family:Vazirmatn,'Segoe UI',sans-serif;color:#202130;background:#fff;font-size:10pt;line-height:1.7}*{box-sizing:border-box}body{margin:0}h1,h2,h3,p{margin-top:0}h1{font-size:22pt;margin-bottom:3mm}h2{font-size:14pt;margin-bottom:4mm;break-after:avoid;page-break-after:avoid}h3{font-size:11pt;margin-bottom:2mm}header{border-bottom:1px solid #d8dbe5;padding-bottom:6mm;margin-bottom:7mm}.meta{color:#626579;margin:0}.metrics{display:grid;grid-template-columns:repeat(4,1fr);gap:3mm;margin-bottom:6mm}.metric,.panel{border:1px solid #e1e3ec;border-radius:3mm;padding:3mm;background:#fafaff}.metric span{display:block;color:#626579;font-size:8.5pt}.metric strong{display:block;font-size:13pt;margin-top:1mm}.note,.empty{color:#626579;font-size:9pt}.note{margin:2mm 0 6mm}.metrics+.note{margin-top:-4mm}section{margin:7mm 0}.two-col{display:grid;grid-template-columns:1fr 1fr;gap:5mm}.panel{min-width:0}.bars{height:42mm;display:flex;align-items:flex-end;gap:1mm;border-bottom:1px solid #d8dbe5;padding:0 1mm}.bar-item{height:100%;flex:1;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;min-width:0}.bar-value{width:72%;min-height:0;background:#6366f1;border-radius:1mm 1mm 0 0}.bar-label{font-size:6.5pt;white-space:nowrap;writing-mode:vertical-rl;transform:rotate(180deg);height:12mm;padding-top:1mm;color:#626579}.bar-hint{position:absolute;left:-10000px}.trend{display:flex;align-items:flex-end;gap:4mm;height:53mm;border-bottom:1px solid #d8dbe5;padding:0 2mm}.trend-item{height:100%;flex:1;display:flex;flex-direction:column;justify-content:flex-end;align-items:center;gap:1mm;text-align:center;font-size:7.5pt}.trend-track{height:35mm;width:100%;display:flex;align-items:flex-end;justify-content:center}.trend-bar{width:60%;min-height:1px;background:#6366f1;border-radius:1mm 1mm 0 0}.notice{padding:4mm;border:1px solid #e1e3ec;border-radius:3mm;background:#f7f7fb;break-inside:avoid}.notice p{margin-bottom:1mm}table{width:100%;border-collapse:collapse;font-size:8.5pt}th,td{text-align:start;vertical-align:top;padding:2mm;border-bottom:1px solid #e6e8ef}th{background:#f5f6fa;font-weight:700}tr{break-inside:avoid}.current-day{background:#f4f4ff}small{color:#626579}.resource-task{border-top:1px solid #e1e3ec;padding:4mm 0;break-inside:avoid}.links{margin:0 0 3mm;padding-inline-start:5mm}.links a{color:#3730a3;text-decoration:underline}.images{display:grid;grid-template-columns:repeat(2,1fr);gap:4mm}.images figure{margin:0;break-inside:avoid;border:1px solid #e1e3ec;border-radius:2mm;padding:2mm}.images img{display:block;width:100%;height:75mm;object-fit:contain}.images figcaption{font-size:8pt;color:#626579;margin-top:1mm}.missing-image{height:75mm;display:grid;place-items:center;color:#626579;background:#f5f6fa}@page{size:A4;margin:15mm 13mm 17mm}a{color:#3730a3}@media screen{body{max-width:190mm;margin:10mm auto;padding:0 8mm}}@media print{.metric,.panel,.notice{print-color-adjust:exact;-webkit-print-color-adjust:exact}section{break-inside:auto}section.trend-section{break-inside:avoid}}
</style>
</head>
<body>
<header><h1>${escapeHtml(title)}</h1><p class="meta">${escapeHtml(periodLabel)} · تهیه‌شده در ${escapeHtml(formatDateTime(report.generatedAtUtcMs, report.period.calendar, report.timeZoneId))}</p>${report.profile.displayName || report.profile.jobTitle ? `<p class="meta">${escapeHtml(report.profile.displayName)}${report.profile.displayName && report.profile.jobTitle ? ' · ' : ''}${escapeHtml(report.profile.jobTitle)}</p>` : ''}</header>
${summary}${activeTimerNote}
${daily}
${personal}
${targetGap}
${taskTable}
${resources}
</body></html>`
}

function metric(label: string, value: string) {
  return `<div class="metric"><span>${escapeHtml(label)}</span><strong dir="ltr">${value}</strong></div>`
}

function barChart(items: Array<{ label: string; value: number; hint: string }>) {
  const max = Math.max(1, ...items.map((item) => item.value))
  return `<div class="bars" role="img" aria-label="نمودار میله‌ای">${items
    .map(
      (item) =>
        `<div class="bar-item" title="${escapeHtml(item.hint)}: ${formatDuration(item.value)}"><span class="bar-hint">${escapeHtml(item.hint)}: ${formatDuration(item.value)}</span><div class="bar-value" style="height:${percent(item.value, max)}%"></div><span class="bar-label">${escapeHtml(item.label)}</span></div>`
    )
    .join('')}</div>`
}

function percent(value: number, max: number) {
  return max <= 0 ? 0 : Math.round((value / max) * 100)
}

function statusLabel(status: AnalyticsPeriodDto['tasks'][number]['status']) {
  if (status === null) return 'بدون تسک'
  return {
    todo: 'در صف',
    in_progress: 'در حال انجام',
    waiting_feedback: 'در انتظار بازخورد',
    on_hold: 'متوقف',
    done: 'تکمیل‌شده'
  }[status]
}

function formatDuration(minutes: number) {
  const value = new Intl.NumberFormat('fa-IR', { useGrouping: false })
  const hours = Math.floor(Math.abs(minutes) / 60)
  const remainder = Math.abs(minutes) % 60
  return `${value.format(hours).padStart(2, '۰')}:${value.format(remainder).padStart(2, '۰')}`
}

function formatSignedDuration(minutes: number) {
  return `${minutes < 0 ? '−' : minutes > 0 ? '+' : ''}${formatDuration(minutes)}`
}

function formatSignedPercent(value: number) {
  const number = new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 })
  return `${value > 0 ? '+' : ''}${number.format(value)}٪`
}

function formatNumber(value: number) {
  return new Intl.NumberFormat('fa-IR', { maximumFractionDigits: 0 }).format(value)
}

function formatDate(date: string, calendar: 'jalali' | 'gregorian') {
  return new Intl.DateTimeFormat('fa-IR', {
    calendar: calendar === 'jalali' ? 'persian' : 'gregory',
    dateStyle: 'medium',
    timeZone: 'UTC'
  }).format(new Date(`${date}T12:00:00Z`))
}

function formatMonth(year: number, month: number, calendar: 'jalali' | 'gregorian') {
  const range = calendarMonthRange(year, month, calendar)
  return new Intl.DateTimeFormat('fa-IR', {
    calendar: calendar === 'jalali' ? 'persian' : 'gregory',
    month: 'short',
    year: 'numeric',
    timeZone: 'UTC'
  }).format(new Date(`${range.startDate}T12:00:00Z`))
}

function formatPeriod(start: string, end: string, calendar: 'jalali' | 'gregorian') {
  return `${formatDate(start, calendar)} تا ${formatDate(end, calendar)}`
}

function formatDateTime(timestamp: number, calendar: 'jalali' | 'gregorian', timeZoneId: string) {
  return new Intl.DateTimeFormat('fa-IR', {
    calendar: calendar === 'jalali' ? 'persian' : 'gregory',
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timeZoneId
  }).format(timestamp)
}

function safeHttpUrl(value: string) {
  try {
    const url = new URL(value)
    if ((url.protocol === 'http:' || url.protocol === 'https:') && !url.username && !url.password) {
      return url.toString()
    }
  } catch {
    return null
  }
  return null
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    switch (character) {
      case '&':
        return '&amp;'
      case '<':
        return '&lt;'
      case '>':
        return '&gt;'
      case '"':
        return '&quot;'
      default:
        return '&#39;'
    }
  })
}
