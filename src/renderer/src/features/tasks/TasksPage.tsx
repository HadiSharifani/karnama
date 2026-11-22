import { useCallback, useEffect, useState } from 'react'
import { Archive, Check, ListTodo, Plus, RotateCcw, Save } from 'lucide-react'
import type { TaskDto, TaskInput } from '@shared/contracts/work'
import type { SettingsDto } from '@shared/contracts/settings'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatDuration, formatInstant } from '@/lib/time-format'
import { unwrapResult } from '@/lib/api'

type TaskForm = Omit<TaskInput, 'estimatedDurationMinutes'> & { estimatedDurationMinutes: string }

const emptyForm: TaskForm = {
  title: '',
  description: '',
  notes: '',
  status: 'todo',
  priority: 'medium',
  estimatedDurationMinutes: ''
}

const statusLabels = {
  todo: 'برای انجام',
  in_progress: 'در حال انجام',
  waiting_feedback: 'در انتظار بازخورد',
  on_hold: 'متوقف',
  done: 'انجام‌شده'
} as const

const priorityLabels = { low: 'کم', medium: 'معمولی', high: 'زیاد' } as const

function formFromTask(task: TaskDto): TaskForm {
  return {
    title: task.title,
    description: task.description,
    notes: task.notes,
    status: task.status,
    priority: task.priority,
    estimatedDurationMinutes:
      task.estimatedDurationMinutes === null ? '' : String(task.estimatedDurationMinutes)
  }
}

export function TasksPage({ settings }: { settings: SettingsDto }) {
  const [tasks, setTasks] = useState<TaskDto[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [form, setForm] = useState<TaskForm>(emptyForm)
  const [showArchived, setShowArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState(false)

  const loadTasks = useCallback(async () => {
    setError('')
    try {
      const items = unwrapResult(await window.karnama.tasks.list(showArchived))
      setTasks(items)
      setSelectedId((current) => (items.some((task) => task.id === current) ? current : null))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'خواندن تسک‌ها انجام نشد.')
    } finally {
      setLoading(false)
    }
  }, [showArchived])

  useEffect(() => {
    void loadTasks()
  }, [loadTasks])

  const selectedTask = tasks.find((task) => task.id === selectedId) ?? null

  function selectTask(task: TaskDto) {
    setSelectedId(task.id)
    setForm(formFromTask(task))
    setSaved(false)
    setError('')
  }

  function beginNewTask() {
    setSelectedId(null)
    setForm(emptyForm)
    setSaved(false)
    setError('')
  }

  function updateForm<Key extends keyof TaskForm>(key: Key, value: TaskForm[Key]) {
    setSaved(false)
    setForm((current) => ({ ...current, [key]: value }))
  }

  async function saveTask(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSaving(true)
    setSaved(false)
    setError('')
    const payload: TaskInput = {
      ...form,
      estimatedDurationMinutes:
        form.estimatedDurationMinutes.trim() === '' ? null : Number(form.estimatedDurationMinutes)
    }
    try {
      const task = selectedId
        ? unwrapResult(await window.karnama.tasks.update(selectedId, payload))
        : unwrapResult(await window.karnama.tasks.create(payload))
      const items = unwrapResult(await window.karnama.tasks.list(showArchived))
      setTasks(items)
      setSelectedId(task.id)
      setForm(formFromTask(task))
      setSaved(true)
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'ذخیره تسک انجام نشد.')
    } finally {
      setSaving(false)
    }
  }

  async function changeArchiveState(task: TaskDto) {
    setError('')
    try {
      if (task.archivedAtUtcMs === null) {
        unwrapResult(await window.karnama.tasks.archive(task.id))
      } else {
        unwrapResult(await window.karnama.tasks.restore(task.id))
      }
      await loadTasks()
      setSelectedId(null)
      setForm(emptyForm)
    } catch (archiveError) {
      setError(
        archiveError instanceof Error ? archiveError.message : 'تغییر وضعیت بایگانی انجام نشد.'
      )
    }
  }

  return (
    <div className="mx-auto max-w-6xl">
      <PageHeading
        title="تسک‌ها"
        description="تسک‌های چندروزه را یکجا مدیریت کنید و زمان ثبت‌شده را کنار هر کار ببینید."
        action={
          <div className="flex shrink-0 gap-2">
            <Button onClick={() => setShowArchived((value) => !value)} variant="outline">
              {showArchived ? 'تسک‌های فعال' : 'بایگانی'}
            </Button>
            {!showArchived && (
              <Button onClick={beginNewTask}>
                <Plus aria-hidden="true" size={16} />
                تسک تازه
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <p
          className="mb-5 rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <Card className="p-0">
          <CardHeader className="border-b border-line px-5 py-4">
            <CardTitle>{showArchived ? 'تسک‌های بایگانی‌شده' : 'فهرست تسک‌ها'}</CardTitle>
            <CardDescription>{tasks.length} تسک</CardDescription>
          </CardHeader>
          {loading ? (
            <p className="p-8 text-sm text-muted" role="status">
              در حال خواندن تسک‌ها…
            </p>
          ) : tasks.length === 0 ? (
            <div className="flex min-h-64 flex-col items-center justify-center px-8 text-center">
              <div className="mb-3 grid size-11 place-items-center rounded-full bg-subtle text-muted">
                <ListTodo aria-hidden="true" size={19} />
              </div>
              <p className="text-sm font-semibold text-ink">
                {showArchived ? 'تسکی در بایگانی نیست' : 'هنوز تسکی نساخته‌اید'}
              </p>
              <p className="mt-1 max-w-sm text-xs leading-5 text-muted">
                {showArchived
                  ? 'تسک‌های بایگانی‌شده از اینجا قابل بازیابی هستند.'
                  : 'با ساخت اولین تسک، پیگیری و ثبت زمان آن را شروع کنید.'}
              </p>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {tasks.map((task) => (
                <li key={task.id}>
                  <button
                    aria-current={selectedId === task.id ? 'true' : undefined}
                    className={`w-full px-5 py-4 text-right transition-colors hover:bg-subtle/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${selectedId === task.id ? 'bg-accent-soft/60' : ''}`}
                    onClick={() => selectTask(task)}
                    type="button"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <h2 className="truncate text-sm font-semibold text-ink">{task.title}</h2>
                        {task.description && (
                          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted">
                            {task.description}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 rounded-full bg-subtle px-2.5 py-1 text-[11px] text-muted">
                        {statusLabels[task.status]}
                      </span>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                      <span>اولویت {priorityLabels[task.priority]}</span>
                      <span>زمان ثبت‌شده {formatDuration(task.trackedDurationMs)}</span>
                      <span>{task.sessionCount} جلسه</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader>
            <div className="flex items-center justify-between gap-3">
              <CardTitle>{selectedTask ? 'جزئیات تسک' : 'ساخت تسک'}</CardTitle>
              {saved && (
                <span className="flex items-center gap-1 text-xs text-success">
                  <Check size={14} /> ذخیره شد
                </span>
              )}
            </div>
            <CardDescription>
              {selectedTask?.archivedAtUtcMs !== null && selectedTask
                ? 'این تسک بایگانی شده و جلسات قبلی آن حفظ شده‌اند.'
                : 'اطلاعات را وارد کنید؛ مدت واقعی فقط از sessionهای ثبت‌شده به دست می‌آید.'}
            </CardDescription>
          </CardHeader>
          {selectedTask?.archivedAtUtcMs !== null && selectedTask ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-subtle p-4">
                <p className="font-semibold text-ink">{selectedTask.title}</p>
                <p className="mt-2 text-sm leading-6 text-muted">
                  {selectedTask.description || 'توضیحی ثبت نشده است.'}
                </p>
                <p className="mt-3 text-xs text-muted">
                  زمان ثبت‌شده: {formatDuration(selectedTask.trackedDurationMs)}
                </p>
              </div>
              <Button onClick={() => void changeArchiveState(selectedTask)} variant="outline">
                <RotateCcw aria-hidden="true" size={15} />
                بازیابی تسک
              </Button>
            </div>
          ) : (
            <form className="space-y-4" onSubmit={(event) => void saveTask(event)}>
              <label className="block space-y-1.5 text-xs font-medium text-muted">
                عنوان
                <Input
                  autoFocus={!selectedTask}
                  maxLength={200}
                  onChange={(event) => updateForm('title', event.target.value)}
                  required
                  value={form.title}
                />
              </label>
              <label className="block space-y-1.5 text-xs font-medium text-muted">
                توضیحات
                <Textarea
                  maxLength={10_000}
                  onChange={(event) => updateForm('description', event.target.value)}
                  value={form.description}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="block space-y-1.5 text-xs font-medium text-muted">
                  وضعیت
                  <Select
                    onChange={(event) =>
                      updateForm('status', event.target.value as TaskInput['status'])
                    }
                    value={form.status}
                  >
                    {Object.entries(statusLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="block space-y-1.5 text-xs font-medium text-muted">
                  اولویت
                  <Select
                    onChange={(event) =>
                      updateForm('priority', event.target.value as TaskInput['priority'])
                    }
                    value={form.priority}
                  >
                    {Object.entries(priorityLabels).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </Select>
                </label>
              </div>
              <label className="block space-y-1.5 text-xs font-medium text-muted">
                زمان تخمینی، دقیقه
                <Input
                  dir="ltr"
                  inputMode="numeric"
                  min={1}
                  onChange={(event) => updateForm('estimatedDurationMinutes', event.target.value)}
                  placeholder="اختیاری"
                  type="number"
                  value={form.estimatedDurationMinutes}
                />
              </label>
              <label className="block space-y-1.5 text-xs font-medium text-muted">
                یادداشت
                <Textarea
                  maxLength={10_000}
                  onChange={(event) => updateForm('notes', event.target.value)}
                  value={form.notes}
                />
              </label>
              {selectedTask && (
                <div className="rounded-lg bg-subtle px-3.5 py-3 text-xs text-muted">
                  <div className="flex justify-between">
                    <span>زمان ثبت‌شده</span>
                    <span className="font-semibold text-ink">
                      {formatDuration(selectedTask.trackedDurationMs)}
                    </span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span>تعداد جلسات</span>
                    <span className="font-semibold text-ink">{selectedTask.sessionCount}</span>
                  </div>
                  <div className="mt-1 flex justify-between">
                    <span>ایجاد شده</span>
                    <span className="font-semibold text-ink">
                      {formatInstant(
                        selectedTask.createdAtUtcMs,
                        settings.preferences.timezoneId,
                        settings.preferences.calendar
                      )}
                    </span>
                  </div>
                  {selectedTask.completedAtUtcMs !== null && (
                    <div className="mt-1 flex justify-between">
                      <span>تکمیل شده</span>
                      <span className="font-semibold text-ink">
                        {formatInstant(
                          selectedTask.completedAtUtcMs,
                          settings.preferences.timezoneId,
                          settings.preferences.calendar
                        )}
                      </span>
                    </div>
                  )}
                </div>
              )}
              <div className="flex items-center justify-between gap-3 pt-1">
                <Button disabled={saving} type="submit">
                  <Save aria-hidden="true" size={15} />
                  {saving ? 'در حال ذخیره…' : 'ذخیره تسک'}
                </Button>
                {selectedTask && (
                  <Button
                    className="text-danger hover:bg-danger/10 hover:text-danger"
                    onClick={() => void changeArchiveState(selectedTask)}
                    type="button"
                    variant="ghost"
                  >
                    <Archive aria-hidden="true" size={15} />
                    بایگانی
                  </Button>
                )}
              </div>
            </form>
          )}
        </Card>
      </div>
    </div>
  )
}
