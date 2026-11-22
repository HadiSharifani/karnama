import { z } from 'zod'

const timezoneIdSchema = z
  .string()
  .trim()
  .min(1, 'منطقه زمانی را وارد کنید.')
  .max(64, 'شناسه منطقه زمانی بیش از حد طولانی است.')
  .refine((value) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: value }).format(0)
      return true
    } catch {
      return false
    }
  }, 'شناسه IANA معتبر نیست؛ برای نمونه Asia/Tehran را وارد کنید.')

export const settingsInputSchema = z.object({
  profile: z.object({
    displayName: z.string().trim().max(100, 'نام نباید بیش از ۱۰۰ نویسه باشد.'),
    jobTitle: z.string().trim().min(1, 'عنوان شغلی را وارد کنید.').max(100)
  }),
  workingHours: z.object({
    dailyCommitmentMinutes: z.number().int().min(15).max(1440),
    workingWeekdays: z
      .array(z.number().int().min(1).max(7))
      .min(1, 'حداقل یک روز کاری انتخاب کنید.')
      .max(7)
      .refine((days) => new Set(days).size === days.length, 'روزهای تکراری مجاز نیستند.'),
    weeklyHolidayIsoDay: z.number().int().min(1).max(7),
    workDateBoundaryMinutes: z.number().int().min(0).max(1439)
  }),
  preferences: z.object({
    calendar: z.enum(['jalali', 'gregorian']),
    theme: z.enum(['system', 'light', 'dark']),
    timezoneId: timezoneIdSchema
  })
})

export const settingsDtoSchema = settingsInputSchema.extend({
  onboardingCompleted: z.boolean()
})

export type SettingsInput = z.infer<typeof settingsInputSchema>
export type SettingsDto = z.infer<typeof settingsDtoSchema>
