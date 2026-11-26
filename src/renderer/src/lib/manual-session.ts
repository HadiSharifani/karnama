import type { WorkSessionDto, WorkSessionInput } from '@shared/contracts/work'
import {
  localDateTimeCandidates,
  localDateTimePartsPrecise,
  localDateTimeToUtc
} from '@shared/domain/work-time'

const hourMs = 60 * 60 * 1000
const minuteMs = 60 * 1000

export type ManualSessionForm = {
  taskId: string | null
  startDate: string
  startTime: string
  startOccurrence: 'earlier' | 'later' | null
  durationHours: string
  durationMinutes: string
  durationRemainderMs: number
  exactStartDate: string | null
  exactStartTime: string | null
  allocationMode: 'boundary' | 'manual'
  workDate: string | null
}

export function newManualSessionForm(startDate: string, startTime: string): ManualSessionForm {
  return {
    taskId: null,
    startDate,
    startTime,
    startOccurrence: null,
    durationHours: '1',
    durationMinutes: '0',
    durationRemainderMs: 0,
    exactStartDate: null,
    exactStartTime: null,
    allocationMode: 'boundary',
    workDate: null
  }
}

export function manualSessionFormFromSession(session: WorkSessionDto): ManualSessionForm {
  const start = localDateTimePartsPrecise(session.startUtcMs, session.timeZoneId)
  const durationMinutes = Math.floor(session.durationMs / minuteMs)
  const startCandidates = localDateTimeCandidates(start.date, start.time, session.timeZoneId)
  return {
    taskId: session.taskId,
    startDate: start.date,
    startTime: start.time.slice(0, 5),
    startOccurrence:
      startCandidates.length < 2
        ? null
        : startCandidates[0] === session.startUtcMs
          ? 'earlier'
          : 'later',
    durationHours: String(Math.floor(durationMinutes / 60)),
    durationMinutes: String(durationMinutes % 60),
    durationRemainderMs: session.durationMs % minuteMs,
    exactStartDate: start.date,
    exactStartTime: start.time,
    allocationMode: session.allocationMode,
    workDate:
      session.allocationMode === 'manual' ? (session.allocations[0]?.workDate ?? start.date) : null
  }
}

export function manualSessionDurationMs(form: ManualSessionForm) {
  if (!/^\d+$/.test(form.durationHours) || !/^\d+$/.test(form.durationMinutes)) return null
  const hours = Number(form.durationHours)
  const minutes = Number(form.durationMinutes)
  if (!Number.isSafeInteger(hours) || hours > 1_000_000 || minutes < 0 || minutes > 59) return null
  if (!Number.isSafeInteger(form.durationRemainderMs) || form.durationRemainderMs < 0) return null
  const duration = hours * hourMs + minutes * minuteMs + form.durationRemainderMs
  return Number.isSafeInteger(duration) && duration > 0 ? duration : null
}

export function manualSessionStartChoices(form: ManualSessionForm, timeZoneId: string) {
  try {
    return localDateTimeCandidates(startTimeInput(form).date, startTimeInput(form).time, timeZoneId)
  } catch {
    return []
  }
}

export function manualSessionInput(form: ManualSessionForm, timeZoneId: string): WorkSessionInput {
  const durationMs = manualSessionDurationMs(form)
  if (durationMs === null) throw new Error('مدت را با ساعت و دقیقه معتبر وارد کنید.')

  const { date: startDate, time: startTime } = startTimeInput(form)
  const startCandidates = localDateTimeCandidates(startDate, startTime, timeZoneId)
  if (startCandidates.length > 1 && !form.startOccurrence) {
    throw new Error('برای این ساعت تکرارشونده، بار اول یا دوم را انتخاب کنید.')
  }
  const startUtcMs = localDateTimeToUtc(startDate, startTime, timeZoneId, form.startOccurrence)
  const endUtcMs = startUtcMs + durationMs
  if (!Number.isSafeInteger(endUtcMs)) throw new Error('پایان جلسه خارج از بازه معتبر است.')
  const end = localDateTimePartsPrecise(endUtcMs, timeZoneId)
  const endCandidates = localDateTimeCandidates(end.date, end.time, timeZoneId)
  const endOccurrence =
    endCandidates.length < 2 ? null : endCandidates[0] === endUtcMs ? 'earlier' : 'later'

  return {
    taskId: form.taskId,
    startDate,
    startTime,
    startOccurrence: form.startOccurrence,
    endDate: end.date,
    endTime: end.time,
    endOccurrence,
    allocationMode: form.allocationMode,
    workDate: form.allocationMode === 'manual' ? form.workDate : null
  }
}

function startTimeInput(form: ManualSessionForm) {
  if (
    form.exactStartDate === form.startDate &&
    form.exactStartTime?.slice(0, 5) === form.startTime
  ) {
    return { date: form.exactStartDate, time: form.exactStartTime }
  }
  return { date: form.startDate, time: form.startTime }
}
