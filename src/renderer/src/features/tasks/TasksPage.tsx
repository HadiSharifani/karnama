import { useCallback, useEffect, useMemo, useState, type DragEvent } from 'react'
import {
  Archive,
  ArrowDown,
  ArrowUp,
  Check,
  GripVertical,
  Image,
  LayoutGrid,
  Link2,
  List,
  ListTodo,
  Plus,
  RotateCcw,
  Save
} from 'lucide-react'
import { taskStatuses, type TaskDto, type TaskInput } from '@shared/contracts/work'
import type { SettingsDto } from '@shared/contracts/settings'
import { PageHeading } from '@/components/PageHeading'
import { Button } from '@/components/ui/button'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { formatDuration, formatInstant } from '@/lib/time-format'
import { unwrapResult } from '@/lib/api'
import { TaskResources } from './TaskResources'

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
type TaskStatus = TaskDto['status']
type DropTarget = { status: TaskStatus; taskId: string; after: boolean; index: number } | null

const statusOrder: TaskStatus[] = [...taskStatuses]

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
  const [view, setView] = useState<'board' | 'list'>('board')
  const [search, setSearch] = useState('')
  const [moving, setMoving] = useState(false)
  const [draggedId, setDraggedId] = useState<string | null>(null)
  const [dropTarget, setDropTarget] = useState<DropTarget>(null)
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
  const visibleTasks = useMemo(() => {
    const query = search.trim().toLocaleLowerCase()
    return tasks.filter(
      (task) =>
        !query ||
        [task.title, task.description, task.notes].some((value) =>
          value.toLocaleLowerCase().includes(query)
        )
    )
  }, [search, tasks])
  const activeTasks = visibleTasks.filter((task) => task.archivedAtUtcMs === null)

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

  function destinationIndex(taskId: string, status: TaskStatus, targetId?: string, after = false) {
    const targetColumn = tasks
      .filter((task) => task.archivedAtUtcMs === null && task.status === status)
      .sort((a, b) => a.position - b.position)
    let index = targetId
      ? targetColumn.findIndex((task) => task.id === targetId)
      : targetColumn.length
    if (index < 0) index = targetColumn.length
    if (targetId && after) index += 1
    const moved = tasks.find((task) => task.id === taskId)
    if (moved?.status === status && moved.position < index) index -= 1
    return Math.max(0, index)
  }

  function optimisticallyMove(taskId: string, status: TaskStatus, index: number) {
    const moved = tasks.find((task) => task.id === taskId)
    if (!moved) return tasks
    const sourceIds = tasks
      .filter(
        (task) =>
          task.archivedAtUtcMs === null && task.status === moved.status && task.id !== taskId
      )
      .sort((a, b) => a.position - b.position)
      .map((task) => task.id)
    const targetIds =
      moved.status === status
        ? sourceIds
        : tasks
            .filter((task) => task.archivedAtUtcMs === null && task.status === status)
            .sort((a, b) => a.position - b.position)
            .map((task) => task.id)
    targetIds.splice(Math.min(index, targetIds.length), 0, taskId)
    const nextPositions = new Map<string, { status: TaskStatus; position: number }>()
    sourceIds.forEach((id, position) => nextPositions.set(id, { status: moved.status, position }))
    targetIds.forEach((id, position) => nextPositions.set(id, { status, position }))
    return tasks.map((task) => {
      const next = nextPositions.get(task.id)
      return next ? { ...task, status: next.status, position: next.position } : task
    })
  }

  async function persistMove(taskId: string, status: TaskStatus, index: number) {
    if (moving) return
    const previousTasks = tasks
    const previousTask = tasks.find((task) => task.id === taskId)
    if (!previousTask || (previousTask.status === status && previousTask.position === index)) return
    setMoving(true)
    setError('')
    setTasks(optimisticallyMove(taskId, status, index))
    if (selectedId === taskId) setForm((current) => ({ ...current, status }))
    try {
      unwrapResult(await window.karnama.tasks.move(taskId, status, index))
    } catch (moveError) {
      setTasks(previousTasks)
      if (selectedId === taskId) setForm((current) => ({ ...current, status: previousTask.status }))
      setError(moveError instanceof Error ? moveError.message : 'جابجایی تسک ذخیره نشد.')
      setMoving(false)
      return
    }
    try {
      setTasks(unwrapResult(await window.karnama.tasks.list(showArchived)))
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'ترتیب تازه خوانده نشد.')
    } finally {
      setMoving(false)
    }
  }

  function startDrag(event: DragEvent<HTMLButtonElement>, taskId: string) {
    if (moving) {
      event.preventDefault()
      return
    }
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', taskId)
    setDraggedId(taskId)
  }

  function allowDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault()
    event.dataTransfer.dropEffect = 'move'
  }

  function finishDrop(event: DragEvent<HTMLElement>, status: TaskStatus, index?: number) {
    event.preventDefault()
    event.stopPropagation()
    const taskId = event.dataTransfer.getData('text/plain') || draggedId
    setDropTarget(null)
    setDraggedId(null)
    if (taskId) void persistMove(taskId, status, index ?? destinationIndex(taskId, status))
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <PageHeading
        title="تسک‌ها"
        description="تسک‌های چندروزه را مدیریت کنید و زمان ثبت‌شده را کنار هر کار ببینید."
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

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Input
          aria-label="جست‌وجوی تسک‌ها"
          className="max-w-sm"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="جست‌وجو در عنوان و توضیحات"
          type="search"
          value={search}
        />
        {!showArchived && (
          <div
            aria-label="نحوه نمایش تسک‌ها"
            className="flex gap-1 rounded-lg bg-subtle p-1"
            role="group"
          >
            <Button
              aria-pressed={view === 'board'}
              onClick={() => setView('board')}
              size="sm"
              variant={view === 'board' ? 'default' : 'ghost'}
            >
              <LayoutGrid aria-hidden="true" size={15} />
              برد
            </Button>
            <Button
              aria-pressed={view === 'list'}
              onClick={() => setView('list')}
              size="sm"
              variant={view === 'list' ? 'default' : 'ghost'}
            >
              <List aria-hidden="true" size={15} />
              فهرست
            </Button>
          </div>
        )}
      </div>

      {error && (
        <p
          className="rounded-lg border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger"
          role="alert"
        >
          {error}
        </p>
      )}

      <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <Card className="min-w-0 p-0">
          <CardHeader className="border-b border-line px-5 py-4">
            <CardTitle>
              {showArchived
                ? 'تسک‌های بایگانی‌شده'
                : view === 'board'
                  ? 'برد تسک‌ها'
                  : 'فهرست تسک‌ها'}
            </CardTitle>
            <CardDescription>
              {visibleTasks.length} تسک{search.trim() ? ' مطابق جست‌وجو' : ''}
            </CardDescription>
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
          ) : visibleTasks.length === 0 ? (
            <p className="p-8 text-center text-sm text-muted">تسکی با این عبارت پیدا نشد.</p>
          ) : view === 'board' && !showArchived ? (
            <div className="overflow-x-auto px-4 pb-4 pt-4">
              <div className="flex min-w-max items-start gap-3">
                {statusOrder.map((status) => {
                  const columnTasks = activeTasks
                    .filter((task) => task.status === status)
                    .sort((a, b) => a.position - b.position)
                  const fullColumn = tasks
                    .filter((task) => task.archivedAtUtcMs === null && task.status === status)
                    .sort((a, b) => a.position - b.position)
                  return (
                    <section
                      aria-label={`${statusLabels[status]}، ${columnTasks.length} تسک`}
                      className="flex w-[270px] shrink-0 flex-col rounded-xl border border-line bg-subtle/50 p-2.5"
                      key={status}
                      onDragOver={allowDrop}
                      onDrop={(event) => finishDrop(event, status)}
                    >
                      <header className="flex items-center justify-between gap-2 px-1 pb-2.5 pt-1">
                        <h2 className="text-sm font-semibold text-ink">{statusLabels[status]}</h2>
                        <span className="rounded-full bg-panel px-2 py-0.5 text-xs tabular-nums text-muted">
                          {columnTasks.length}
                        </span>
                      </header>
                      <div className="max-h-[calc(100vh-300px)] min-h-44 space-y-2 overflow-y-auto px-0.5 pb-1">
                        {columnTasks.length === 0 && (
                          <p className="rounded-lg border border-dashed border-line bg-panel/70 px-3 py-5 text-center text-xs leading-5 text-muted">
                            {search.trim() ? 'تسکی مطابق جست‌وجو نیست' : 'تسکی در این ستون نیست'}
                          </p>
                        )}
                        {columnTasks.map((task) => {
                          const before =
                            dropTarget?.status === status &&
                            dropTarget.taskId === task.id &&
                            !dropTarget.after
                          const after =
                            dropTarget?.status === status &&
                            dropTarget.taskId === task.id &&
                            dropTarget.after
                          return (
                            <div key={task.id}>
                              {before && (
                                <div
                                  aria-hidden="true"
                                  className="mb-2 h-1 rounded-full bg-accent"
                                />
                              )}
                              <article
                                className={`space-y-3 rounded-lg border bg-panel p-3 transition-colors ${selectedId === task.id ? 'border-accent ring-1 ring-accent/20' : 'border-line'} ${draggedId === task.id ? 'opacity-50' : ''}`}
                                onDragOver={(event) => {
                                  allowDrop(event)
                                  if (!draggedId) return
                                  const bounds = event.currentTarget.getBoundingClientRect()
                                  const afterTarget =
                                    event.clientY >= bounds.top + bounds.height / 2
                                  const index = destinationIndex(
                                    draggedId,
                                    status,
                                    task.id,
                                    afterTarget
                                  )
                                  setDropTarget({
                                    status,
                                    taskId: task.id,
                                    after: afterTarget,
                                    index
                                  })
                                }}
                                onDrop={(event) => {
                                  const id = event.dataTransfer.getData('text/plain') || draggedId
                                  const afterTarget =
                                    dropTarget?.taskId === task.id ? dropTarget.after : false
                                  finishDrop(
                                    event,
                                    status,
                                    id
                                      ? destinationIndex(id, status, task.id, afterTarget)
                                      : undefined
                                  )
                                }}
                              >
                                <div className="flex min-w-0 items-start gap-1">
                                  <Button
                                    aria-label={`گرفتن و جابه‌جایی ${task.title}`}
                                    className="-ms-2 -mt-2 shrink-0 cursor-grab active:cursor-grabbing"
                                    draggable={!moving}
                                    onDragEnd={() => {
                                      setDraggedId(null)
                                      setDropTarget(null)
                                    }}
                                    onDragStart={(event) => startDrag(event, task.id)}
                                    size="icon"
                                    variant="ghost"
                                  >
                                    <GripVertical aria-hidden="true" size={16} />
                                  </Button>
                                  <button
                                    aria-current={selectedId === task.id ? 'true' : undefined}
                                    className="min-w-0 flex-1 rounded-sm text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                                    onClick={() => selectTask(task)}
                                    type="button"
                                  >
                                    <span className="block break-words text-sm font-semibold leading-6 text-ink">
                                      {task.title}
                                    </span>
                                    {task.description && (
                                      <span className="mt-1 line-clamp-2 block break-words text-xs leading-5 text-muted">
                                        {task.description}
                                      </span>
                                    )}
                                  </button>
                                </div>
                                <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted">
                                  <span
                                    className={`rounded-full px-2 py-1 ${task.priority === 'high' ? 'bg-warning/10 text-warning' : 'bg-subtle'}`}
                                  >
                                    اولویت {priorityLabels[task.priority]}
                                  </span>
                                  {task.estimatedDurationMinutes !== null && (
                                    <span>
                                      تخمین {formatDuration(task.estimatedDurationMinutes * 60_000)}
                                    </span>
                                  )}
                                </div>
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
                                  <span>{formatDuration(task.trackedDurationMs)} ثبت‌شده</span>
                                  <span>{task.sessionCount} جلسه</span>
                                  {task.linkCount > 0 && (
                                    <span className="inline-flex items-center gap-1">
                                      <Link2 aria-hidden="true" size={12} />
                                      {task.linkCount}
                                    </span>
                                  )}
                                  {task.attachmentCount > 0 && (
                                    <span className="inline-flex items-center gap-1">
                                      <Image aria-hidden="true" size={12} />
                                      {task.attachmentCount}
                                    </span>
                                  )}
                                </div>
                                <div className="flex items-center justify-between gap-2 border-t border-line pt-2">
                                  <Select
                                    aria-label={`تغییر وضعیت ${task.title}`}
                                    className="h-9 min-w-0 flex-1 text-xs"
                                    disabled={moving}
                                    onChange={(event) => {
                                      const nextStatus = event.target.value as TaskStatus
                                      const count = tasks.filter(
                                        (item) =>
                                          item.archivedAtUtcMs === null &&
                                          item.status === nextStatus
                                      ).length
                                      void persistMove(task.id, nextStatus, count)
                                    }}
                                    value={status}
                                  >
                                    {statusOrder.map((value) => (
                                      <option key={value} value={value}>
                                        {statusLabels[value]}
                                      </option>
                                    ))}
                                  </Select>
                                  <div className="flex shrink-0">
                                    <Button
                                      aria-label={`انتقال ${task.title} به جایگاه بالاتر`}
                                      disabled={moving || task.position === 0}
                                      onClick={() =>
                                        void persistMove(task.id, status, task.position - 1)
                                      }
                                      size="icon"
                                      variant="ghost"
                                    >
                                      <ArrowUp aria-hidden="true" size={14} />
                                    </Button>
                                    <Button
                                      aria-label={`انتقال ${task.title} به جایگاه پایین‌تر`}
                                      disabled={moving || task.position >= fullColumn.length - 1}
                                      onClick={() =>
                                        void persistMove(task.id, status, task.position + 1)
                                      }
                                      size="icon"
                                      variant="ghost"
                                    >
                                      <ArrowDown aria-hidden="true" size={14} />
                                    </Button>
                                  </div>
                                </div>
                              </article>
                              {after && (
                                <div
                                  aria-hidden="true"
                                  className="mt-2 h-1 rounded-full bg-accent"
                                />
                              )}
                            </div>
                          )
                        })}
                        {dropTarget?.status === status &&
                          !columnTasks.some((task) => task.id === dropTarget.taskId) && (
                            <div aria-hidden="true" className="h-1 rounded-full bg-accent" />
                          )}
                      </div>
                    </section>
                  )
                })}
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-line">
              {[...visibleTasks]
                .sort((a, b) => b.updatedAtUtcMs - a.updatedAtUtcMs)
                .map((task) => (
                  <li key={task.id}>
                    <button
                      aria-current={selectedId === task.id ? 'true' : undefined}
                      className={`w-full px-5 py-4 text-right transition-colors hover:bg-subtle/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-focus ${selectedId === task.id ? 'bg-accent-soft/60' : ''}`}
                      onClick={() => selectTask(task)}
                      type="button"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="break-words text-sm font-semibold text-ink">
                            {task.title}
                          </h2>
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
                        {task.linkCount > 0 && <span>لینک {task.linkCount}</span>}
                        {task.attachmentCount > 0 && <span>تصویر {task.attachmentCount}</span>}
                      </div>
                    </button>
                  </li>
                ))}
            </ul>
          )}
        </Card>

        <div className="space-y-5">
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
                  ? 'این تسک بایگانی شده و جلسه‌های قبلی آن حفظ شده‌اند.'
                  : 'مدت واقعی از جلسه‌های ثبت‌شده محاسبه می‌شود.'}
              </CardDescription>
            </CardHeader>
            {selectedTask?.archivedAtUtcMs !== null && selectedTask ? (
              <div className="space-y-4">
                <div className="rounded-lg bg-subtle p-4">
                  <p className="break-words font-semibold text-ink">{selectedTask.title}</p>
                  <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-6 text-muted">
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
                  <div className="space-y-1 rounded-lg bg-subtle px-3.5 py-3 text-xs text-muted">
                    <div className="flex justify-between">
                      <span>زمان ثبت‌شده</span>
                      <span className="font-semibold text-ink">
                        {formatDuration(selectedTask.trackedDurationMs)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span>تعداد جلسه‌ها</span>
                      <span className="font-semibold text-ink">{selectedTask.sessionCount}</span>
                    </div>
                    <div className="flex justify-between">
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
                      <div className="flex justify-between">
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
          {selectedTask && (
            <Card>
              <TaskResources
                readOnly={selectedTask.archivedAtUtcMs !== null}
                taskId={selectedTask.id}
              />
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
