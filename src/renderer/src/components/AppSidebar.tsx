import { BriefcaseBusiness, ChevronLeft, CircleHelp } from 'lucide-react'
import { routes, type RouteId } from '@/app/routes'
import type { SettingsDto } from '@shared/contracts/settings'

export function AppSidebar({
  activeRoute,
  settings,
  onNavigate
}: {
  activeRoute: RouteId
  settings: SettingsDto
  onNavigate: (route: RouteId) => void
}) {
  const profileName = settings.profile.displayName || 'پروفایل شما'
  const mainRoutes = routes.filter((route) => route.id !== 'settings')
  const settingsRoute = routes.find((route) => route.id === 'settings')!

  return (
    <aside className="flex min-h-0 flex-col border-l border-line bg-panel px-4 py-5">
      <div className="mb-9 flex items-center gap-3 px-2">
        <div className="grid size-10 place-items-center rounded-xl bg-accent text-accent-foreground">
          <BriefcaseBusiness aria-hidden="true" size={19} strokeWidth={1.9} />
        </div>
        <div>
          <div className="text-lg font-bold leading-6 text-ink">کارنما</div>
          <div className="text-xs text-muted">دفتر کار روزانه</div>
        </div>
      </div>

      <div className="mb-2 px-3 text-xs font-semibold text-muted">فضای کار</div>
      <nav aria-label="بخش‌های برنامه" className="space-y-1">
        {mainRoutes.map((route) => {
          const Icon = route.icon
          const selected = activeRoute === route.id
          return (
            <button
              aria-current={selected ? 'page' : undefined}
              className={`group flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${selected ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-subtle hover:text-ink'}`}
              key={route.id}
              onClick={() => onNavigate(route.id)}
              type="button"
            >
              <Icon aria-hidden="true" className="shrink-0" size={18} strokeWidth={1.8} />
              <span className="flex-1 text-right">{route.title}</span>
              {selected && <ChevronLeft aria-hidden="true" size={15} className="opacity-70" />}
            </button>
          )
        })}
      </nav>

      <div className="my-4 border-t border-line" />
      {(() => {
        const Icon = settingsRoute.icon
        const selected = activeRoute === settingsRoute.id
        return (
          <button
            aria-current={selected ? 'page' : undefined}
            className={`flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus ${selected ? 'bg-accent-soft text-accent-ink' : 'text-muted hover:bg-subtle hover:text-ink'}`}
            onClick={() => onNavigate(settingsRoute.id)}
            type="button"
          >
            <Icon aria-hidden="true" size={18} strokeWidth={1.8} />
            <span className="flex-1 text-right">{settingsRoute.title}</span>
          </button>
        )
      })()}

      <div className="mt-auto space-y-4 pt-6">
        <div className="rounded-lg bg-subtle px-3 py-3 text-xs leading-5 text-muted">
          <div className="mb-1 flex items-center gap-2 font-semibold text-ink">
            <CircleHelp aria-hidden="true" size={15} />
            نگهداری محلی
          </div>
          اطلاعات کار شما روی همین دستگاه ذخیره می‌شود.
        </div>
        <div className="flex items-center gap-3 border-t border-line px-2 pt-4">
          <div className="grid size-9 shrink-0 place-items-center rounded-full bg-accent-soft text-accent-ink">
            <BriefcaseBusiness aria-hidden="true" size={16} />
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-ink">{profileName}</div>
            <div className="truncate text-xs text-muted" dir="auto">
              {settings.profile.jobTitle}
            </div>
          </div>
        </div>
      </div>
    </aside>
  )
}
