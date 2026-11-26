import { useEffect, useRef, useState } from 'react'
import { Check, CircleAlert, LoaderCircle } from 'lucide-react'
import {
  settingsInputSchema,
  type SettingsDto,
  type SettingsInput
} from '@shared/contracts/settings'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { isValidTime24 } from '@/lib/time-format'
import { unwrapResult } from '@/lib/api'
import { BackupSettings } from './BackupSettings'

const weekDays = [
  { isoDay: 6, label: 'ش' },
  { isoDay: 7, label: 'ی' },
  { isoDay: 1, label: 'د' },
  { isoDay: 2, label: 'س' },
  { isoDay: 3, label: 'چ' },
  { isoDay: 4, label: 'پ' },
  { isoDay: 5, label: 'ج' }
]

const weekDayNames: Record<number, string> = {
  1: 'دوشنبه',
  2: 'سه‌شنبه',
  3: 'چهارشنبه',
  4: 'پنج‌شنبه',
  5: 'جمعه',
  6: 'شنبه',
  7: 'یکشنبه'
}

function inputFromSettings(settings: SettingsDto): SettingsInput {
  return {
    profile: settings.profile,
    workingHours: settings.workingHours,
    preferences: settings.preferences
  }
}

function formatBoundary(minutes: number) {
  return `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`
}

function minutesFromBoundary(value: string) {
  const [hours, minutes] = value.split(':').map(Number)
  return hours * 60 + minutes
}

export function SettingsPage({
  settings,
  onSaved,
  onCompleted
}: {
  settings: SettingsDto
  onSaved: (settings: SettingsDto) => void
  onCompleted: (settings: SettingsDto) => void
}) {
  const [form, setForm] = useState<SettingsInput>(() => inputFromSettings(settings))
  const [boundaryDraft, setBoundaryDraft] = useState(() =>
    formatBoundary(settings.workingHours.workDateBoundaryMinutes)
  )
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'error'>('saved')
  const [saveMessage, setSaveMessage] = useState('')
  const [completing, setCompleting] = useState(false)
  const revision = useRef(0)

  useEffect(() => {
    const currentRevision = ++revision.current
    const timeout = window.setTimeout(async () => {
      setSaveState('saving')
      setSaveMessage('')
      try {
        const result = await window.karnama.settings.save(form)
        if (currentRevision !== revision.current) return
        const saved = unwrapResult(result)
        onSaved(saved)
        setSaveState('saved')
      } catch (error) {
        if (currentRevision !== revision.current) return
        setSaveState('error')
        setSaveMessage(error instanceof Error ? error.message : 'ذخیره تنظیمات انجام نشد.')
      }
    }, 500)

    return () => window.clearTimeout(timeout)
  }, [form, onSaved])

  function updateProfile(key: keyof SettingsInput['profile'], value: string) {
    setForm((current) => ({ ...current, profile: { ...current.profile, [key]: value } }))
  }

  function updateWorkingHours<K extends keyof SettingsInput['workingHours']>(
    key: K,
    value: SettingsInput['workingHours'][K]
  ) {
    setForm((current) => ({ ...current, workingHours: { ...current.workingHours, [key]: value } }))
  }

  function updatePreference<K extends keyof SettingsInput['preferences']>(
    key: K,
    value: SettingsInput['preferences'][K]
  ) {
    setForm((current) => ({ ...current, preferences: { ...current.preferences, [key]: value } }))
  }

  async function completeSetup() {
    const parsed = settingsInputSchema.safeParse(form)
    if (!parsed.success) {
      setSaveState('error')
      setSaveMessage(parsed.error.issues[0]?.message ?? 'مقادیر تنظیمات را بررسی کنید.')
      return
    }

    setCompleting(true)
    try {
      const result = await window.karnama.settings.completeOnboarding(parsed.data)
      onCompleted(unwrapResult(result))
    } catch (error) {
      setSaveState('error')
      setSaveMessage(error instanceof Error ? error.message : 'اتمام تنظیمات انجام نشد.')
      setCompleting(false)
    }
  }

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading
        title="تنظیمات"
        description="مشخصات و ترجیحات کارنما را هر زمان که خواستید تغییر دهید. تغییرات به‌صورت خودکار ذخیره می‌شوند."
        action={
          <div aria-live="polite" className="flex min-h-10 items-center gap-2 text-xs text-muted">
            {saveState === 'saving' ? (
              <>
                <LoaderCircle aria-hidden="true" className="animate-spin" size={15} />
                در حال ذخیره
              </>
            ) : saveState === 'error' ? (
              <>
                <CircleAlert aria-hidden="true" className="text-danger" size={15} />
                ذخیره نشد
              </>
            ) : (
              <>
                <Check aria-hidden="true" className="text-success" size={15} />
                ذخیره شد
              </>
            )}
          </div>
        }
      />

      {saveMessage && (
        <p
          className="mb-5 rounded-lg border border-danger/20 bg-danger-soft px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {saveMessage}
        </p>
      )}

      <div className="space-y-5">
        <Card>
          <CardHeader>
            <CardTitle>مشخصات فردی</CardTitle>
            <CardDescription>
              این اطلاعات برای شخصی‌سازی فضای کار شما استفاده می‌شوند.
            </CardDescription>
          </CardHeader>
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block space-y-2 text-sm font-medium text-ink">
              نام نمایشی
              <Input
                autoComplete="name"
                maxLength={100}
                onChange={(event) => updateProfile('displayName', event.target.value)}
                placeholder="نام شما"
                value={form.profile.displayName}
              />
            </label>
            <label className="block space-y-2 text-sm font-medium text-ink">
              عنوان شغلی
              <Input
                dir="auto"
                maxLength={100}
                onChange={(event) => updateProfile('jobTitle', event.target.value)}
                value={form.profile.jobTitle}
              />
            </label>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>ساعات کاری</CardTitle>
            <CardDescription>
              برنامه پیش‌فرض شما قابل تغییر است و هنوز محاسبه تعهد انجام نمی‌دهد.
            </CardDescription>
          </CardHeader>
          <div className="grid gap-6 lg:grid-cols-2">
            <label className="block space-y-2 text-sm font-medium text-ink">
              تعهد روزانه، ساعت
              <Input
                dir="ltr"
                inputMode="decimal"
                max="24"
                min="0.25"
                onChange={(event) => {
                  const hours = Number(event.target.value)
                  if (Number.isFinite(hours)) {
                    updateWorkingHours('dailyCommitmentMinutes', Math.round(hours * 60))
                  }
                }}
                step="0.25"
                type="number"
                value={form.workingHours.dailyCommitmentMinutes / 60}
              />
              <span className="block text-xs font-normal text-muted">مقدار پیش‌فرض: 8 ساعت</span>
            </label>
            <label className="block space-y-2 text-sm font-medium text-ink">
              مرز Work Date
              <Input
                aria-invalid={!isValidTime24(boundaryDraft)}
                dir="ltr"
                inputMode="numeric"
                maxLength={5}
                onChange={(event) => {
                  const value = event.target.value
                  setBoundaryDraft(value)
                  if (isValidTime24(value)) {
                    updateWorkingHours('workDateBoundaryMinutes', minutesFromBoundary(value))
                  }
                }}
                onBlur={() => {
                  if (!isValidTime24(boundaryDraft)) {
                    setBoundaryDraft(formatBoundary(form.workingHours.workDateBoundaryMinutes))
                  }
                }}
                pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
                placeholder="06:00"
                type="text"
                value={boundaryDraft}
              />
              <span className="block text-xs font-normal text-muted">
                شروع پیش‌فرض روز کاری: 06:00 به وقت منطقه انتخاب‌شده
              </span>
            </label>
            <div className="space-y-3 lg:col-span-2">
              <div className="text-sm font-medium text-ink">روزهای کاری</div>
              <div aria-label="روزهای کاری هفته" className="flex flex-wrap gap-2" role="group">
                {weekDays.map((day) => {
                  const selected = form.workingHours.workingWeekdays.includes(day.isoDay)
                  return (
                    <button
                      aria-label={`${weekDayNames[day.isoDay]}${selected ? '، کاری' : '، تعطیل'}`}
                      aria-pressed={selected}
                      className={`grid size-11 place-items-center rounded-full border text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${selected ? 'border-accent bg-accent text-accent-foreground' : 'border-line bg-panel text-muted hover:bg-subtle'}`}
                      key={day.isoDay}
                      onClick={() => {
                        const current = form.workingHours.workingWeekdays
                        const next = selected
                          ? current.filter((value) => value !== day.isoDay)
                          : [...current, day.isoDay]
                        updateWorkingHours('workingWeekdays', next)
                      }}
                      type="button"
                    >
                      {day.label}
                    </button>
                  )
                })}
              </div>
            </div>
            <label className="block space-y-2 text-sm font-medium text-ink">
              تعطیلی هفتگی
              <Select
                onChange={(event) =>
                  updateWorkingHours('weeklyHolidayIsoDay', Number(event.target.value))
                }
                value={form.workingHours.weeklyHolidayIsoDay}
              >
                {weekDays.map((day) => (
                  <option key={day.isoDay} value={day.isoDay}>
                    {weekDayNames[day.isoDay]}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>نمایش و منطقه زمانی</CardTitle>
            <CardDescription>
              تاریخ‌ها بر اساس تقویم انتخابی و منطقه زمانی ذخیره‌شده نمایش داده می‌شوند.
            </CardDescription>
          </CardHeader>
          <div className="grid gap-5 md:grid-cols-2">
            <label className="block space-y-2 text-sm font-medium text-ink">
              تقویم پیش‌فرض
              <Select
                onChange={(event) =>
                  updatePreference('calendar', event.target.value as 'jalali' | 'gregorian')
                }
                value={form.preferences.calendar}
              >
                <option value="jalali">هجری شمسی</option>
                <option value="gregorian">میلادی</option>
              </Select>
            </label>
            <label className="block space-y-2 text-sm font-medium text-ink">
              پوسته
              <Select
                onChange={(event) =>
                  updatePreference('theme', event.target.value as 'system' | 'light' | 'dark')
                }
                value={form.preferences.theme}
              >
                <option value="system">همگام با سیستم</option>
                <option value="light">روشن</option>
                <option value="dark">تیره</option>
              </Select>
            </label>
            <label className="block space-y-2 text-sm font-medium text-ink md:col-span-2">
              منطقه زمانی IANA
              <Input
                autoCapitalize="off"
                autoComplete="off"
                dir="ltr"
                maxLength={64}
                onChange={(event) => updatePreference('timezoneId', event.target.value)}
                placeholder="Asia/Tehran"
                spellCheck={false}
                value={form.preferences.timezoneId}
              />
              <span className="block text-xs font-normal text-muted">
                نمونه: Asia/Tehran؛ از شناسه منطقه زمانی ویندوز در اولین اجرا استفاده می‌شود.
              </span>
            </label>
          </div>
        </Card>

        <BackupSettings
          calendar={settings.preferences.calendar}
          timeZoneId={settings.preferences.timezoneId}
        />
      </div>

      {!settings.onboardingCompleted && (
        <div className="mt-7 flex flex-wrap items-center justify-between gap-4 border-t border-line pt-6">
          <p className="max-w-[65ch] text-sm leading-6 text-muted">
            با پایان تنظیمات، راهنمای شروع از داشبورد کنار می‌رود. می‌توانید این مقادیر را بعداً
            تغییر دهید.
          </p>
          <Button disabled={completing || saveState === 'saving'} onClick={completeSetup}>
            {completing ? 'در حال تکمیل…' : 'اتمام تنظیمات و رفتن به داشبورد'}
          </Button>
        </div>
      )}
    </div>
  )
}
