import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { PageHeading } from '@/components/PageHeading'
import { routes, type RouteId } from '@/app/routes'

const emptyMessages: Record<Exclude<RouteId, 'dashboard' | 'settings'>, string> = {
  tasks: 'با ثبت تسک‌ها، فهرست کارهای شما در این بخش نمایش داده می‌شود.',
  timer: 'پس از شروع ثبت زمان، وضعیت و مدت فعالیت شما اینجا دیده می‌شود.',
  calendar: 'فعالیت‌های ثبت‌شده بر اساس تاریخ در این تقویم نمایش داده می‌شوند.',
  analytics: 'با ثبت زمان‌های کاری، روند واقعی فعالیت شما در این بخش قابل مرور است.',
  reports: 'گزارش‌های شما پس از ثبت داده‌های کاری در این بخش در دسترس خواهند بود.'
}

export function EmptyPage({ page }: { page: Exclude<RouteId, 'dashboard' | 'settings'> }) {
  const route = routes.find((item) => item.id === page)!
  const Icon = route.icon

  return (
    <div className="mx-auto max-w-5xl">
      <PageHeading title={route.title} description={route.description} />
      <Card className="flex min-h-72 flex-col items-center justify-center border-dashed px-8 text-center">
        <div className="mb-4 grid size-12 place-items-center rounded-full bg-subtle text-muted">
          <Icon aria-hidden="true" size={21} />
        </div>
        <CardHeader className="mb-0 max-w-lg">
          <CardTitle>هنوز داده‌ای برای نمایش ندارید</CardTitle>
          <CardDescription>{emptyMessages[page]}</CardDescription>
        </CardHeader>
      </Card>
    </div>
  )
}
