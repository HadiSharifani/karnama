import { ChevronLeft, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { shiftCalendarMonth } from '@shared/domain/calendar-date'
import type { AnalyticsPeriodInput } from '@shared/contracts/analytics'
import { formatCalendarMonth } from '@/lib/time-format'

export function PeriodSelector({
  period,
  onChange
}: {
  period: AnalyticsPeriodInput
  onChange: (period: AnalyticsPeriodInput) => void
}) {
  const title = formatCalendarMonth(period.year, period.month, period.calendar)

  function move(delta: number) {
    const next = shiftCalendarMonth(period.year, period.month, delta)
    onChange({ ...period, ...next })
  }
  const lowerYear = period.calendar === 'jalali' ? 1178 : 1800
  const upperYear = period.calendar === 'jalali' ? 1634 : 2256
  const previous = shiftCalendarMonth(period.year, period.month, -1)
  const next = shiftCalendarMonth(period.year, period.month, 1)

  return (
    <div className="flex items-center gap-2" aria-label="انتخاب ماه گزارش">
      <Button
        aria-label="ماه قبل"
        disabled={previous.year < lowerYear}
        onClick={() => move(-1)}
        size="icon"
        variant="outline"
      >
        <ChevronRight aria-hidden="true" size={17} />
      </Button>
      <p className="min-w-36 text-center text-sm font-semibold text-ink" aria-live="polite">
        {title}
      </p>
      <Button
        aria-label="ماه بعد"
        disabled={next.year > upperYear}
        onClick={() => move(1)}
        size="icon"
        variant="outline"
      >
        <ChevronLeft aria-hidden="true" size={17} />
      </Button>
    </div>
  )
}
