import { useCallback, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  FolderOpen,
  LoaderCircle,
  Plus,
  RotateCcw,
  ShieldCheck,
  Trash2
} from 'lucide-react'
import type { BackupProgressDto, BackupSummaryDto } from '@shared/contracts/backups'
import type { CalendarMode } from '@shared/domain/calendar-date'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { unwrapResult } from '@/lib/api'
import { formatInstant } from '@/lib/time-format'

type ConfirmAction = { kind: 'restore' | 'delete'; backup: BackupSummaryDto }

function formatDate(value: string | null, calendar: CalendarMode, timeZoneId: string) {
  if (!value) return 'تاریخ نامشخص'
  return formatInstant(Date.parse(value), timeZoneId, calendar)
}

function formatSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} کیلوبایت`
  return `${(bytes / (1024 * 1024)).toLocaleString('fa-IR', { maximumFractionDigits: 1 })} مگابایت`
}

function kindLabel(kind: BackupSummaryDto['kind']) {
  return kind === 'automatic' ? 'خودکار' : kind === 'pre_restore' ? 'نسخهٔ ایمنی بازیابی' : 'دستی'
}

function statusLabel(status: BackupSummaryDto['status']) {
  return status === 'valid' ? 'سالم' : status === 'invalid' ? 'نامعتبر' : 'بررسی‌نشده'
}

export function BackupSettings({
  calendar,
  timeZoneId
}: {
  calendar: CalendarMode
  timeZoneId: string
}) {
  const [backups, setBackups] = useState<BackupSummaryDto[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<BackupProgressDto | null>(null)
  const [feedback, setFeedback] = useState('')
  const [error, setError] = useState('')
  const [confirmation, setConfirmation] = useState<ConfirmAction | null>(null)

  const loadBackups = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      setBackups(unwrapResult(await window.karnama.backups.list()))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'فهرست نسخه‌های پشتیبان خوانده نشد.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadBackups()
    return window.karnama.backups.onProgress(setProgress)
  }, [loadBackups])

  async function createBackup() {
    setBusy(true)
    setFeedback('')
    setError('')
    try {
      const created = unwrapResult(await window.karnama.backups.create())
      setFeedback(
        `نسخهٔ پشتیبان ${formatDate(created.createdAtUtc, calendar, timeZoneId)} آماده شد.`
      )
      await loadBackups()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'ساخت نسخهٔ پشتیبان انجام نشد.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function validateBackup(backup: BackupSummaryDto) {
    setBusy(true)
    setFeedback('')
    setError('')
    try {
      const validated = unwrapResult(await window.karnama.backups.validate(backup.id))
      setBackups((current) => current.map((item) => (item.id === backup.id ? validated : item)))
      setFeedback(
        `نسخهٔ ${formatDate(validated.createdAtUtc, calendar, timeZoneId)} سالم است و فایل‌های آن تأیید شدند.`
      )
    } catch (cause) {
      setBackups((current) =>
        current.map((item) => (item.id === backup.id ? { ...item, status: 'invalid' } : item))
      )
      setError(cause instanceof Error ? cause.message : 'اعتبارسنجی نسخهٔ پشتیبان ناموفق بود.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function requestRestore(backup: BackupSummaryDto) {
    setBusy(true)
    setFeedback('')
    setError('')
    try {
      const validated = unwrapResult(await window.karnama.backups.validate(backup.id))
      setBackups((current) => current.map((item) => (item.id === backup.id ? validated : item)))
      setConfirmation({ kind: 'restore', backup: validated })
    } catch (cause) {
      setBackups((current) =>
        current.map((item) => (item.id === backup.id ? { ...item, status: 'invalid' } : item))
      )
      setError(cause instanceof Error ? cause.message : 'اعتبارسنجی نسخهٔ پشتیبان ناموفق بود.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function chooseRestore() {
    setBusy(true)
    setFeedback('')
    setError('')
    try {
      const chosen = unwrapResult(await window.karnama.backups.chooseRestore())
      if (chosen) setConfirmation({ kind: 'restore', backup: chosen.backup })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'فایل انتخاب‌شده نسخهٔ پشتیبان معتبری نیست.')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  async function confirmAction() {
    if (!confirmation) return
    setBusy(true)
    setError('')
    setFeedback('')
    try {
      if (confirmation.kind === 'restore') {
        unwrapResult(await window.karnama.backups.restore(confirmation.backup.id))
        setFeedback(
          'بازیابی انجام شد؛ برنامه برای بارگذاری داده‌های بازیابی‌شده دوباره راه‌اندازی می‌شود.'
        )
        setConfirmation(null)
      } else {
        unwrapResult(await window.karnama.backups.delete(confirmation.backup.id))
        setFeedback('نسخهٔ پشتیبان دستی حذف شد.')
        setConfirmation(null)
        await loadBackups()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'عملیات نسخهٔ پشتیبان انجام نشد.')
      setBusy(false)
      setProgress(null)
    }
  }

  async function openBackupFolder() {
    setError('')
    try {
      unwrapResult(await window.karnama.backups.openLocation())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'پوشهٔ نسخه‌های پشتیبان باز نشد.')
    }
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1.5">
            <CardTitle>پشتیبان‌گیری و بازیابی</CardTitle>
            <CardDescription>
              نسخهٔ پشتیبان شامل پایگاه داده، تنظیمات، گزارش‌ها و تصویرهای پیوست است. یک نسخهٔ خودکار
              نیز هر ۲۴ ساعت ساخته می‌شود.
            </CardDescription>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button disabled={busy} onClick={() => void createBackup()}>
              {busy ? (
                <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
              ) : (
                <Plus aria-hidden="true" size={16} />
              )}
              ساخت نسخهٔ دستی
            </Button>
            <Button disabled={busy} onClick={() => void chooseRestore()} variant="outline">
              <RotateCcw aria-hidden="true" size={16} />
              بازیابی از فایل…
            </Button>
            <Button disabled={busy} onClick={() => void openBackupFolder()} variant="ghost">
              <FolderOpen aria-hidden="true" size={16} />
              پوشه
            </Button>
          </div>
        </div>
      </CardHeader>

      {progress && busy && (
        <div aria-live="polite" className="mb-4 rounded-lg bg-subtle px-4 py-3" role="status">
          <div className="mb-2 flex items-center justify-between gap-4 text-sm text-ink">
            <span>{progress.message}</span>
            <span dir="ltr">{Math.round(progress.percent)}%</span>
          </div>
          <div
            aria-label="پیشرفت عملیات"
            className="h-2 overflow-hidden rounded-full bg-line"
            role="progressbar"
            aria-valuenow={progress.percent}
            aria-valuemin={0}
            aria-valuemax={100}
          >
            <div
              className="h-full rounded-full bg-accent transition-[width]"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {feedback && (
        <p
          aria-live="polite"
          className="mb-4 rounded-lg bg-success-soft px-4 py-3 text-sm text-success"
          role="status"
        >
          {feedback}
        </p>
      )}
      {error && (
        <p
          className="mb-4 rounded-lg border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      )}

      {loading ? (
        <p className="flex items-center gap-2 py-4 text-sm text-muted" role="status">
          <LoaderCircle aria-hidden="true" className="animate-spin" size={16} />
          در حال خواندن فهرست نسخه‌ها…
        </p>
      ) : backups.length === 0 ? (
        <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-sm leading-6 text-muted">
          هنوز نسخهٔ پشتیبانی وجود ندارد. می‌توانید همین حالا یک نسخه بسازید؛ نسخه‌های خودکار نیز
          به‌صورت دوره‌ای نگه‌داری می‌شوند.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {backups.map((backup) => (
            <li
              className="flex flex-wrap items-center justify-between gap-4 py-4 first:pt-0 last:pb-0"
              key={backup.id}
            >
              <div className="min-w-52 space-y-1">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-ink">
                  <span>{formatDate(backup.createdAtUtc, calendar, timeZoneId)}</span>
                  <span className="rounded-full bg-subtle px-2 py-0.5 text-xs font-medium text-muted">
                    {kindLabel(backup.kind)}
                  </span>
                </p>
                <p className="text-xs text-muted">
                  {formatSize(backup.sizeBytes)} · نسخهٔ برنامه {backup.appVersion ?? 'نامشخص'} ·
                  ساختار {backup.schemaVersion ?? 'نامشخص'} · {statusLabel(backup.status)}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  disabled={busy}
                  onClick={() => void validateBackup(backup)}
                  size="sm"
                  variant="outline"
                >
                  <ShieldCheck aria-hidden="true" size={15} />
                  بررسی
                </Button>
                <Button
                  disabled={busy}
                  onClick={() => void requestRestore(backup)}
                  size="sm"
                  variant="secondary"
                >
                  <RotateCcw aria-hidden="true" size={15} />
                  بازیابی
                </Button>
                {backup.kind === 'manual' && (
                  <Button
                    disabled={busy}
                    onClick={() => setConfirmation({ kind: 'delete', backup })}
                    size="icon"
                    variant="ghost"
                    aria-label="حذف نسخهٔ دستی"
                  >
                    <Trash2 aria-hidden="true" size={16} />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {confirmation && (
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/45 p-4"
          role="presentation"
        >
          <section
            aria-labelledby="backup-confirm-title"
            aria-modal="true"
            className="w-full max-w-lg rounded-xl border border-line bg-panel p-6 shadow-xl"
            role="dialog"
          >
            <h3
              className="flex items-center gap-2 text-base font-semibold text-ink"
              id="backup-confirm-title"
            >
              {confirmation.kind === 'restore' ? (
                <AlertTriangle aria-hidden="true" className="text-danger" size={19} />
              ) : (
                <Trash2 aria-hidden="true" className="text-danger" size={19} />
              )}
              {confirmation.kind === 'restore' ? 'تأیید جایگزینی داده‌ها' : 'حذف نسخهٔ پشتیبان دستی'}
            </h3>
            <p className="mt-3 text-sm leading-6 text-muted">
              {confirmation.kind === 'restore'
                ? `داده‌های فعلی با نسخهٔ ${formatDate(confirmation.backup.createdAtUtc, calendar, timeZoneId)} جایگزین می‌شوند؛ کارنما پیش از جایگزینی یک نسخهٔ ایمنی می‌سازد و سپس دوباره راه‌اندازی می‌شود. این فرایند نشست تایمر را از نسخهٔ انتخاب‌شده بازیابی می‌کند.`
                : `فایل نسخهٔ دستی ${formatDate(confirmation.backup.createdAtUtc, calendar, timeZoneId)} برای همیشه از فهرست کارنما حذف می‌شود.`}
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button disabled={busy} onClick={() => setConfirmation(null)} variant="outline">
                انصراف
              </Button>
              <Button disabled={busy} onClick={() => void confirmAction()}>
                {busy ? (
                  <LoaderCircle aria-hidden="true" className="animate-spin" size={15} />
                ) : confirmation.kind === 'restore' ? (
                  <Check aria-hidden="true" size={15} />
                ) : (
                  <Trash2 aria-hidden="true" size={15} />
                )}
                {confirmation.kind === 'restore' ? 'جایگزینی و راه‌اندازی دوباره' : 'حذف نسخه'}
              </Button>
            </div>
          </section>
        </div>
      )}
    </Card>
  )
}
