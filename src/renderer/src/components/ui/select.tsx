import type { SelectHTMLAttributes } from 'react'
import { cn } from '@/lib/utils'

export function Select({
  className,
  dir = 'rtl',
  ...props
}: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'h-11 w-full rounded-lg border border-line bg-panel px-3.5 text-sm text-ink outline-none focus-visible:border-focus focus-visible:ring-2 focus-visible:ring-focus/20',
        className
      )}
      dir={dir}
      {...props}
    />
  )
}
