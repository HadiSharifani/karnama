import type { ReactNode } from 'react'

export function PageHeading({
  title,
  description,
  action
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="mb-8 flex items-start justify-between gap-6">
      <div className="space-y-2">
        <h1 className="text-2xl font-bold tracking-tight text-ink">{title}</h1>
        {description && <p className="max-w-[68ch] text-sm leading-6 text-muted">{description}</p>}
      </div>
      {action}
    </div>
  )
}
