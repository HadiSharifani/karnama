import {
  CalendarDays,
  ChartNoAxesColumnIncreasing,
  FileText,
  LayoutDashboard,
  ListTodo,
  Settings2,
  Timer
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'

export type RouteId =
  'dashboard' | 'tasks' | 'timer' | 'calendar' | 'analytics' | 'reports' | 'settings'

export type RouteDefinition = {
  id: RouteId
  title: string
  description: string
  icon: LucideIcon
}

export const routes: RouteDefinition[] = [
  {
    id: 'dashboard',
    title: 'داشبورد',
    description: 'نمای کلی روزهای کاری شما',
    icon: LayoutDashboard
  },
  { id: 'tasks', title: 'تسک‌ها', description: 'فهرست کارهای شما', icon: ListTodo },
  { id: 'timer', title: 'زمان‌سنج', description: 'ثبت مدت فعالیت‌ها', icon: Timer },
  { id: 'calendar', title: 'تقویم کاری', description: 'نمای زمانی فعالیت‌ها', icon: CalendarDays },
  {
    id: 'analytics',
    title: 'تحلیل عملکرد',
    description: 'مرور روند ساعات کاری',
    icon: ChartNoAxesColumnIncreasing
  },
  { id: 'reports', title: 'گزارش‌ها', description: 'گزارش‌های کاری شما', icon: FileText },
  { id: 'settings', title: 'تنظیمات', description: 'پروفایل و ترجیحات برنامه', icon: Settings2 }
]

const routeIds = new Set<string>(routes.map((route) => route.id))

export function routeFromHash(hash: string): RouteId {
  const route = hash.replace(/^#\/?/, '').split('/')[0]
  return routeIds.has(route) ? (route as RouteId) : 'dashboard'
}

export function navigateTo(route: RouteId) {
  window.location.hash = `/${route}`
}
