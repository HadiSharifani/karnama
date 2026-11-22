import { randomUUID } from 'node:crypto'
import { and, eq } from 'drizzle-orm'
import { addIsoDays, workDateAtInstant } from '../../shared/domain/work-time'
import {
  settingsDtoSchema,
  settingsInputSchema,
  type SettingsDto,
  type SettingsInput
} from '../../shared/contracts/settings'
import type { KarnamaDatabase } from './client'
import { appSettings, userProfile, workScheduleVersions } from './schema'

export function createSettingsService(database: KarnamaDatabase, now = () => Date.now()) {
  function get(): SettingsDto {
    const profile = database.select().from(userProfile).where(eq(userProfile.id, 1)).get()
    const settings = database.select().from(appSettings).where(eq(appSettings.id, 1)).get()

    if (!profile || !settings) throw new Error('تنظیمات برنامه پیدا نشد.')

    let workingWeekdays: unknown
    try {
      workingWeekdays = JSON.parse(settings.workingWeekdaysJson) as unknown
    } catch {
      throw new Error('فهرست روزهای کاری در پایگاه داده معتبر نیست.')
    }

    return settingsDtoSchema.parse({
      profile: { displayName: profile.displayName, jobTitle: profile.jobTitle },
      workingHours: {
        dailyCommitmentMinutes: settings.dailyCommitmentMinutes,
        workingWeekdays,
        weeklyHolidayIsoDay: settings.weeklyHolidayIsoDay,
        workDateBoundaryMinutes: settings.workDateBoundaryMinutes
      },
      preferences: {
        calendar: settings.calendar,
        theme: settings.theme,
        timezoneId: settings.timezoneId
      },
      onboardingCompleted: settings.onboardingCompletedAt !== null
    })
  }

  function save(input: unknown, completeOnboarding = false): SettingsDto {
    const parsed: SettingsInput = settingsInputSchema.parse(input)
    const timestamp = now()

    database.transaction((transaction) => {
      const previous = transaction.select().from(appSettings).where(eq(appSettings.id, 1)).get()
      if (!previous) throw new Error('تنظیمات برنامه پیدا نشد.')
      const previousWeekdays = JSON.parse(previous.workingWeekdaysJson) as number[]
      const scheduleChanged =
        previous.dailyCommitmentMinutes !== parsed.workingHours.dailyCommitmentMinutes ||
        JSON.stringify(previousWeekdays) !== JSON.stringify(parsed.workingHours.workingWeekdays) ||
        previous.weeklyHolidayIsoDay !== parsed.workingHours.weeklyHolidayIsoDay ||
        previous.workDateBoundaryMinutes !== parsed.workingHours.workDateBoundaryMinutes ||
        previous.timezoneId !== parsed.preferences.timezoneId
      const effectiveFromWorkDate = scheduleChanged
        ? addIsoDays(
            workDateAtInstant(timestamp, previous.timezoneId, previous.workDateBoundaryMinutes),
            1
          )
        : null

      transaction
        .insert(userProfile)
        .values({
          id: 1,
          displayName: parsed.profile.displayName,
          jobTitle: parsed.profile.jobTitle,
          updatedAt: timestamp
        })
        .onConflictDoUpdate({
          target: userProfile.id,
          set: {
            displayName: parsed.profile.displayName,
            jobTitle: parsed.profile.jobTitle,
            updatedAt: timestamp
          }
        })
        .run()

      transaction
        .update(appSettings)
        .set({
          dailyCommitmentMinutes: parsed.workingHours.dailyCommitmentMinutes,
          weeklyHolidayIsoDay: parsed.workingHours.weeklyHolidayIsoDay,
          workingWeekdaysJson: JSON.stringify(parsed.workingHours.workingWeekdays),
          workDateBoundaryMinutes: parsed.workingHours.workDateBoundaryMinutes,
          calendar: parsed.preferences.calendar,
          theme: parsed.preferences.theme,
          timezoneId: parsed.preferences.timezoneId,
          ...(completeOnboarding ? { onboardingCompletedAt: timestamp } : {}),
          updatedAt: timestamp
        })
        .where(eq(appSettings.id, 1))
        .run()

      if (effectiveFromWorkDate) {
        const futureVersion = transaction
          .select({ id: workScheduleVersions.id })
          .from(workScheduleVersions)
          .where(eq(workScheduleVersions.effectiveFromWorkDate, effectiveFromWorkDate))
          .get()
        const schedule = {
          effectiveFromWorkDate,
          timeZoneId: parsed.preferences.timezoneId,
          workDateBoundaryMinutes: parsed.workingHours.workDateBoundaryMinutes,
          dailyCommitmentMinutes: parsed.workingHours.dailyCommitmentMinutes,
          weeklyHolidayIsoDay: parsed.workingHours.weeklyHolidayIsoDay,
          workingWeekdaysJson: JSON.stringify(parsed.workingHours.workingWeekdays),
          createdAtUtcMs: timestamp
        }
        if (futureVersion) {
          transaction
            .update(workScheduleVersions)
            .set(schedule)
            .where(
              and(
                eq(workScheduleVersions.id, futureVersion.id),
                eq(workScheduleVersions.effectiveFromWorkDate, effectiveFromWorkDate)
              )
            )
            .run()
        } else {
          transaction
            .insert(workScheduleVersions)
            .values({ id: randomUUID(), ...schedule })
            .run()
        }
      }
    })

    return get()
  }

  return {
    get,
    save: (input: unknown) => save(input),
    completeOnboarding: (input: unknown) => save(input, true)
  }
}
