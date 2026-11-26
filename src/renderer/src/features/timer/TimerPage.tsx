import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  Activity,
  Check,
  CircleAlert,
  Clock3,
  Pencil,
  Play,
  RotateCcw,
  Save,
  Square,
  Trash2
} from 'lucide-react'
import type { SettingsDto } from '@shared/contracts/settings'
import type { TaskDto, TimerStateDto, WorkSessionDto } from '@shared/contracts/work'
import { localDateTimeParts } from '@shared/domain/work-time'
import { PageHeading } from '@/components/PageHeading'
import { CalendarDatePicker } from '@/components/CalendarDatePicker'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { formatDuration, formatInstant, formatIsoDate, isValidTime24 } from '@/lib/time-format'
import { unwrapResult } from '@/lib/api'
import type { TimerAction } from '@/lib/timer-action'
import {
  manualSessionDurationMs,
  manualSessionFormFromSession,
  manualSessionInput,
  manualSessionStartChoices,
  newManualSessionForm,
  type ManualSessionForm
} from '@/lib/manual-session'

const hour = 60 * 60 * 1000

function newSessionForm(timeZoneId: string): ManualSessionForm {
  const start = localDateTimeParts(Date.now() - hour, timeZoneId)
  return newManualSessionForm(start.date, start.time)
}

function OccurrenceSelect({
  label,
  choices,
  value,
  onChange
}: {
  label: string
  choices: number[]
  value: 'earlier' | 'later' | null
  onChange: (value: 'earlier' | 'later' | null) => void
}) {
  if (choices.length <= 1) return null
  return (
    <label className="mt-2 block space-y-1 text-[11px] font-medium text-warning">
      {label} دو بار در این روز رخ می‌دهد؛ یک مورد را انتخاب کنید.
      <Select
        className="h-9"
        onChange={(event) =>
          onChange(event.target.value === '' ? null : (event.target.value as 'earlier' | 'later'))
        }
        value={value ?? ''}
      >
        <option value="">انتخاب وقوع ساعت</option>
        <option value="earlier">بار اول</option>
        <option value="later">بار دوم</option>
      </Select>
    </label>
  )
}

export function TimerPage({
  settings,
  timerState,
  timerError,
  onTimerAction
}: {
  settings: SettingsDto
  timerState: TimerStateDto
  timerError: string
  onTimerAction: (action: TimerAction) => Promise<void>
}) {
  const [tasks, setTasks] = useState<TaskDto[]>([])
  const [sessions, setSessions] = useState<WorkSessionDto[]>([])
  const [timerTaskId, setTimerTaskId] = useState('')
  const [sessionForm, setSessionForm] = useState<ManualSessionForm>(() =>
    newSessionForm(settings.preferences.timezoneId)
  )
  const [sessionZoneId, setSessionZoneId] = useState(settings.preferences.timezoneId)
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [savingSession, setSavingSession] = useState(false)
  const [error, setError] = useState('')

  const loadData = useCallback(async () => {
    setError('')
    try {
      const [nextTasks, nextSessions] = await Promise.all([
        window.karnama.tasks.list(true).then(unwrapResult),
        window.karnama.sessions.list().then(unwrapResult)
      ])
      setTasks(nextTasks)
      setSessions(nextSessions)
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'خواندن زمان‌های کاری انجام نشد.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadData()
  }, [loadData])

  const activeTasks = useMemo(() => tasks.filter((task) => task.archivedAtUtcMs === null), [tasks])
  const formDuration = manualSessionDurationMs(sessionForm)
  const startChoices = manualSessionStartChoices(sessionForm, sessionZoneId)
  const currentRun = timerState.run

  function updateSession<Key extends keyof ManualSessionForm>(
    key: Key,
    value: ManualSessionForm[Key]
  ) {
    setSessionForm((current) => {
      if (current[key] === value) return current
      const next = { ...current, [key]: value }
      if (key === 'startDate' || key === 'startTime') {
        next.startOccurrence = null
        next.exactStartDate = null
        next.exactStartTime = null
      }
      if (key === 'durationHours' || key === 'durationMinutes') next.durationRemainderMs = 0
      return next
    })
  }

  async function saveSession(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSavingSession(true)
    setError('')
    try {
      const input = manualSessionInput(sessionForm, sessionZoneId)
      const nextSessions = editingSessionId
        ? unwrapResult(await window.karnama.sessions.update(editingSessionId, input))
        : unwrapResult(await window.karnama.sessions.create(input))
      setSessions(nextSessions)
      setEditingSessionId(null)
      setSessionForm(newSessionForm(settings.preferences.timezoneId))
      setSessionZoneId(settings.preferences.timezoneId)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'ذخیره جلسه انجام نشد.')
    } finally {
      setSavingSession(false)
    }
  }

  function editSession(session: WorkSessionDto) {
    setEditingSessionId(session.id)
    setSessionForm(manualSessionFormFromSession(session))
    setSessionZoneId(session.timeZoneId)
    setError('')
  }

  async function deleteSession(session: WorkSessionDto) {
    if (!window.confirm('این ثبت زمان و تخصیص‌های Work Date آن حذف شود؟')) return
    setError('')
    try {
      setSessions(unwrapResult(await window.karnama.sessions.delete(session.id)))
      if (editingSessionId === session.id) {
        setEditingSessionId(null)
        setSessionForm(newSessionForm(settings.preferences.timezoneId))
        setSessionZoneId(settings.preferences.timezoneId)
      }
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : 'حذف جلسه انجام نشد.')
    }
  }

  function renderSessionForm() {
    const selectedArchivedTask = tasks.find(
      (task) => task.id === sessionForm.taskId && task.archivedAtUtcMs
    )
    return (
      <form className="space-y-4" onSubmit={(event) => void saveSession(event)}>
        <label className="block space-y-1.5 text-xs font-medium text-muted">
          تسک
          <Select
            onChange={(event) => updateSession('taskId', event.target.value || null)}
            value={sessionForm.taskId ?? ''}
          >
            <option value="">فعالیت عمومی، بدون تسک</option>
            {tasks.map((task) => (
              <option
                disabled={task.archivedAtUtcMs !== null && task.id !== sessionForm.taskId}
                key={task.id}
                value={task.id}
              >
                {task.title}
                {task.archivedAtUtcMs !== null ? ' (بایگانی‌شده)' : ''}
              </option>
            ))}
          </Select>
        </label>
        {selectedArchivedTask && (
          <p className="text-xs text-warning">این جلسه به تسک بایگانی‌شده متصل می‌ماند.</p>
        )}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1.5 text-xs font-medium text-muted">
            تاریخ شروع
            <CalendarDatePicker
              calendar={settings.preferences.calendar}
              label="تاریخ شروع جلسه"
              onChange={(value) => updateSession('startDate', value)}
              timeZoneId={sessionZoneId}
              value={sessionForm.startDate}
            />
          </label>
          <label className="block space-y-1.5 text-xs font-medium text-muted">
            ساعت شروع
            <Input
              aria-invalid={!isValidTime24(sessionForm.startTime)}
              dir="ltr"
              inputMode="numeric"
              maxLength={5}
              onChange={(event) => updateSession('startTime', event.target.value)}
              pattern="(?:[01][0-9]|2[0-3]):[0-5][0-9]"
              placeholder="09:30"
              required
              type="text"
              value={sessionForm.startTime}
            />
            <OccurrenceSelect
              label="ساعت شروع"
              choices={startChoices}
              value={sessionForm.startOccurrence}
              onChange={(value) => updateSession('startOccurrence', value)}
            />
          </label>
        </div>
        <fieldset className="space-y-2">
          <legend className="text-xs font-medium text-muted">مدت کار</legend>
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1.5 text-xs font-medium text-muted">
              ساعت
              <Input
                dir="ltr"
                inputMode="numeric"
                min={0}
                max={1_000_000}
                onChange={(event) => updateSession('durationHours', event.target.value)}
                required
                type="number"
                value={sessionForm.durationHours}
              />
            </label>
            <label className="space-y-1.5 text-xs font-medium text-muted">
              دقیقه
              <Input
                dir="ltr"
                inputMode="numeric"
                min={0}
                max={59}
                onChange={(event) => updateSession('durationMinutes', event.target.value)}
                required
                type="number"
                value={sessionForm.durationMinutes}
              />
            </label>
          </div>
        </fieldset>
        <label className="block space-y-1.5 text-xs font-medium text-muted">
          تخصیص Work Date
          <Select
            onChange={(event) => {
              const allocationMode = event.target.value as 'boundary' | 'manual'
              updateSession('allocationMode', allocationMode)
              updateSession('workDate', allocationMode === 'manual' ? sessionForm.startDate : null)
            }}
            value={sessionForm.allocationMode}
          >
            <option value="boundary">تقسیم خودکار در مرزهای روز کاری</option>
            <option value="manual">اختصاص کل جلسه به یک Work Date</option>
          </Select>
        </label>
        {sessionForm.allocationMode === 'manual' && (
          <label className="block space-y-1.5 text-xs font-medium text-muted">
            Work Date
            <CalendarDatePicker
              calendar={settings.preferences.calendar}
              label="Work Date"
              onChange={(value) => updateSession('workDate', value)}
              timeZoneId={sessionZoneId}
              value={sessionForm.workDate ?? ''}
            />
          </label>
        )}
        <div className="flex items-center justify-between gap-3 rounded-lg bg-subtle px-3.5 py-3 text-xs">
          <span className="text-muted">
            منطقه زمانی ثبت: <bdi dir="ltr">{sessionZoneId}</bdi>
          </span>
          <span className="font-semibold text-ink">
            مدت: {formDuration === null ? '—' : formatDuration(formDuration)}
          </span>
        </div>
        <p className="text-[11px] leading-5 text-muted">
          مدت با ساعت و دقیقه ثبت می‌شود و ثانیهٔ ورودی ندارد. اگر ساعت شروع در تغییر منطقه زمانی
          وجود نداشته باشد، آن را به ساعت معتبر دیگری تغییر دهید.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button
            disabled={
              savingSession ||
              formDuration === null ||
              startChoices.length === 0 ||
              (startChoices.length > 1 && !sessionForm.startOccurrence)
            }
            type="submit"
          >
            <Save aria-hidden="true" size={15} />
            {savingSession ? 'در حال ذخیره…' : editingSessionId ? 'ذخیره تغییرات' : 'ثبت زمان'}
          </Button>
          {editingSessionId && (
            <Button
              onClick={() => {
                setEditingSessionId(null)
                setSessionForm(newSessionForm(settings.preferences.timezoneId))
                setSessionZoneId(settings.preferences.timezoneId)
              }}
              variant="outline"
              type="button"
            >
              لغو ویرایش
            </Button>
          )}
        </div>
      </form>
    )
  }

  return (
    <div className="mx-auto max-w-6xl space-y-7">
      <PageHeading
        title="زمان‌سنج"
        description="تایمر در همه بخش‌ها پایدار می‌ماند؛ ثبت دستی هم از همین‌جا در دسترس است."
      />

      {(error || timerError) && (
        <p
          className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {error || timerError}
        </p>
      )}

      <Card className="border-accent/20">
        <CardHeader>
          <div className="flex items-center justify-between gap-4">
            <div>
              <CardTitle>تایمر سراسری</CardTitle>
              <CardDescription>
                فقط یک اجرای فعال؛ segmentها هنگام مکث یا توقف ذخیره می‌شوند.
              </CardDescription>
            </div>
            <div className="grid size-11 place-items-center rounded-full bg-accent-soft text-accent-ink">
              <Clock3 aria-hidden="true" size={20} />
            </div>
          </div>
        </CardHeader>

        {currentRun ? (
          <div className="space-y-5">
            <div className="flex flex-wrap items-end justify-between gap-5 rounded-xl bg-subtle px-5 py-4">
              <div>
                <p className="text-xs text-muted">
                  {currentRun.status === 'running' ? 'در حال ثبت زمان' : 'تایمر مکث‌شده'}
                </p>
                <p className="mt-1 text-lg font-semibold text-ink">
                  {currentRun.taskTitle || 'فعالیت عمومی'}
                </p>
                <p className="mt-1 text-xs text-muted">
                  شروع:{' '}
                  {formatInstant(
                    currentRun.startedAtUtcMs,
                    currentRun.timeZoneId,
                    settings.preferences.calendar
                  )}
                </p>
              </div>
              <p
                className="font-mono text-3xl font-semibold tracking-tight text-accent-ink"
                dir="ltr"
              >
                {formatDuration(currentRun.elapsedMs, true)}
              </p>
            </div>
            {currentRun.recovery && (
              <div className="rounded-xl border border-warning/30 bg-warning/5 p-4">
                <div className="flex items-start gap-3">
                  <CircleAlert
                    aria-hidden="true"
                    className="mt-0.5 shrink-0 text-warning"
                    size={18}
                  />
                  <div className="space-y-2">
                    <p className="font-semibold text-ink">بازه‌ای برای بررسی باقی مانده است</p>
                    <p className="text-sm leading-6 text-muted">
                      از{' '}
                      {formatInstant(
                        currentRun.recovery.startUtcMs,
                        currentRun.timeZoneId,
                        settings.preferences.calendar
                      )}{' '}
                      تا{' '}
                      {formatInstant(
                        currentRun.recovery.endUtcMs,
                        currentRun.timeZoneId,
                        settings.preferences.calendar
                      )}
                      . این مدت هنوز ثبت نشده است.
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <Button
                        onClick={() =>
                          void onTimerAction({
                            type: 'review-recovery',
                            runId: currentRun.id,
                            decision: 'accept'
                          })
                        }
                        size="sm"
                      >
                        <Check aria-hidden="true" size={14} />
                        تأیید و ثبت {formatDuration(currentRun.recovery.durationMs)}
                      </Button>
                      <Button
                        onClick={() =>
                          void onTimerAction({
                            type: 'review-recovery',
                            runId: currentRun.id,
                            decision: 'discard'
                          })
                        }
                        size="sm"
                        variant="outline"
                      >
                        رد بازه
                      </Button>
                    </div>
                  </div>
                </div>
              </div>
            )}
            <div className="flex flex-wrap items-end justify-between gap-3">
              <label className="min-w-64 flex-1 space-y-1.5 text-xs font-medium text-muted">
                اجرای بعدی
                <Select
                  onChange={(event) => setTimerTaskId(event.target.value)}
                  value={timerTaskId}
                >
                  <option value="">فعالیت عمومی، بدون تسک</option>
                  {activeTasks.map((task) => (
                    <option key={task.id} value={task.id}>
                      {task.title}
                    </option>
                  ))}
                </Select>
              </label>
              <div className="flex flex-wrap gap-2">
                {currentRun.status === 'running' ? (
                  <Button
                    onClick={() => void onTimerAction({ type: 'pause', runId: currentRun.id })}
                    variant="secondary"
                  >
                    مکث
                  </Button>
                ) : (
                  <Button
                    disabled={Boolean(currentRun.recovery)}
                    onClick={() => void onTimerAction({ type: 'resume', runId: currentRun.id })}
                  >
                    <Play aria-hidden="true" size={15} /> ادامه
                  </Button>
                )}
                <Button
                  disabled={Boolean(currentRun.recovery)}
                  onClick={() => void onTimerAction({ type: 'start', taskId: timerTaskId || null })}
                  variant="outline"
                >
                  <RotateCcw aria-hidden="true" size={15} /> شروع اجرای تازه
                </Button>
                <Button
                  disabled={Boolean(currentRun.recovery)}
                  onClick={() => void onTimerAction({ type: 'stop', runId: currentRun.id })}
                  className="text-danger hover:bg-danger/10 hover:text-danger"
                  variant="ghost"
                >
                  <Square aria-hidden="true" size={14} /> توقف
                </Button>
              </div>
            </div>
            {currentRun.status === 'paused' && !currentRun.recovery && (
              <p className="text-xs text-muted">
                با شروع اجرای تازه، این تایمر مکث‌شده بسته می‌شود و زمان ثبت‌شده‌اش می‌ماند.
              </p>
            )}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <label className="space-y-1.5 text-xs font-medium text-muted">
              ثبت زمان برای
              <Select onChange={(event) => setTimerTaskId(event.target.value)} value={timerTaskId}>
                <option value="">فعالیت عمومی، بدون تسک</option>
                {activeTasks.map((task) => (
                  <option key={task.id} value={task.id}>
                    {task.title}
                  </option>
                ))}
              </Select>
            </label>
            <Button
              onClick={() => void onTimerAction({ type: 'start', taskId: timerTaskId || null })}
            >
              <Play aria-hidden="true" size={15} /> شروع تایمر
            </Button>
          </div>
        )}
      </Card>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <Card>
          <CardHeader>
            <CardTitle>{editingSessionId ? 'ویرایش ثبت زمان' : 'ثبت دستی زمان'}</CardTitle>
            <CardDescription>
              ثبت‌ها با UTC ذخیره می‌شوند؛ منطقه زمانی و Work Date تخصیص جداگانه دارند.
            </CardDescription>
          </CardHeader>
          {renderSessionForm()}
        </Card>

        <Card className="p-0">
          <CardHeader className="border-b border-line px-5 py-4">
            <CardTitle>تاریخچه جلسه‌ها</CardTitle>
            <CardDescription>آخرین ۲۰۰ ثبت زمان</CardDescription>
          </CardHeader>
          {loading ? (
            <p className="p-6 text-sm text-muted" role="status">
              در حال خواندن تاریخچه…
            </p>
          ) : sessions.length === 0 ? (
            <div className="flex min-h-52 flex-col items-center justify-center px-6 text-center">
              <Activity aria-hidden="true" className="mb-3 text-muted" size={20} />
              <p className="text-sm font-semibold text-ink">هنوز زمانی ثبت نشده است</p>
              <p className="mt-1 text-xs leading-5 text-muted">
                جلسه‌های دستی و تایمر پس از ذخیره اینجا دیده می‌شوند.
              </p>
            </div>
          ) : (
            <ul className="max-h-[760px] divide-y divide-line overflow-y-auto">
              {sessions.map((session) => (
                <li className="space-y-3 px-5 py-4" key={session.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-ink">
                        {session.taskTitle || 'فعالیت عمومی'}
                      </p>
                      <p className="mt-1 text-xs text-muted">
                        {formatInstant(
                          session.startUtcMs,
                          session.timeZoneId,
                          settings.preferences.calendar
                        )}{' '}
                        –{' '}
                        {formatInstant(
                          session.endUtcMs,
                          session.timeZoneId,
                          settings.preferences.calendar
                        )}
                      </p>
                    </div>
                    <span
                      className="shrink-0 rounded-md bg-subtle px-2 py-1 font-mono text-xs text-ink"
                      dir="ltr"
                    >
                      {formatDuration(session.durationMs)}
                    </span>
                  </div>
                  <div className="space-y-1 rounded-lg bg-subtle/70 px-3 py-2 text-[11px] text-muted">
                    {session.allocations.map((allocation) => (
                      <div className="flex justify-between gap-2" key={allocation.id}>
                        <span>
                          {formatIsoDate(allocation.workDate, settings.preferences.calendar)}
                        </span>
                        <span>{allocation.source === 'manual' ? 'تخصیص دستی' : 'Work Date'}</span>
                        <bdi className="font-mono" dir="ltr">
                          {formatDuration(allocation.endUtcMs - allocation.startUtcMs)}
                        </bdi>
                      </div>
                    ))}
                  </div>
                  <div className="flex justify-end gap-1">
                    <Button
                      aria-label="ویرایش جلسه"
                      onClick={() => editSession(session)}
                      size="icon"
                      variant="ghost"
                    >
                      <Pencil aria-hidden="true" size={14} />
                    </Button>
                    <Button
                      aria-label="حذف جلسه"
                      className="text-danger hover:bg-danger/10 hover:text-danger"
                      onClick={() => void deleteSession(session)}
                      size="icon"
                      variant="ghost"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  )
}
