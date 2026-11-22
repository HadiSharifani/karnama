import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { openKarnamaDatabase } from '../../src/main/db/client'
import { createSettingsService } from '../../src/main/db/settings-service'
import type { SettingsInput } from '../../src/shared/contracts/settings'

const migrationsFolder = resolve(process.cwd(), 'drizzle')
const temporaryDirectories: string[] = []

function createDatabase() {
  const directory = mkdtempSync(join(tmpdir(), 'karnama-settings-'))
  temporaryDirectories.push(directory)
  return openKarnamaDatabase({
    databasePath: join(directory, 'karnama.sqlite'),
    migrationsFolder,
    timezoneId: 'Asia/Tehran'
  })
}

const validSettings: SettingsInput = {
  profile: { displayName: 'هانیه', jobTitle: 'Product Designer' },
  workingHours: {
    dailyCommitmentMinutes: 480,
    workingWeekdays: [6, 7, 1, 2, 3, 4],
    weeklyHolidayIsoDay: 5,
    workDateBoundaryMinutes: 360
  },
  preferences: { calendar: 'jalali', theme: 'system', timezoneId: 'Asia/Tehran' }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('settings persistence', () => {
  it('seeds the confirmed defaults and leaves onboarding open', () => {
    const opened = createDatabase()
    try {
      expect(createSettingsService(opened.database).get()).toEqual({
        profile: { displayName: '', jobTitle: 'Product Designer' },
        workingHours: {
          dailyCommitmentMinutes: 480,
          workingWeekdays: [6, 7, 1, 2, 3, 4],
          weeklyHolidayIsoDay: 5,
          workDateBoundaryMinutes: 360
        },
        preferences: { calendar: 'jalali', theme: 'system', timezoneId: 'Asia/Tehran' },
        onboardingCompleted: false
      })
    } finally {
      opened.close()
    }
  })

  it('persists profile and preferences after the database is reopened', () => {
    const firstOpen = createDatabase()
    const path = join(temporaryDirectories.at(-1)!, 'karnama.sqlite')
    try {
      const service = createSettingsService(firstOpen.database, () => 1_800_000_000_000)
      service.save({
        ...validSettings,
        preferences: { ...validSettings.preferences, theme: 'dark' }
      })
      firstOpen.close()

      const reopened = openKarnamaDatabase({
        databasePath: path,
        migrationsFolder,
        timezoneId: 'America/Los_Angeles'
      })
      try {
        expect(createSettingsService(reopened.database).get()).toMatchObject({
          profile: validSettings.profile,
          workingHours: validSettings.workingHours,
          preferences: { ...validSettings.preferences, theme: 'dark' },
          onboardingCompleted: false
        })
      } finally {
        reopened.close()
      }
    } finally {
      firstOpen.close()
    }
  })

  it('completes onboarding only through the explicit completion action', () => {
    const opened = createDatabase()
    try {
      const service = createSettingsService(opened.database)
      expect(service.save(validSettings).onboardingCompleted).toBe(false)
      expect(service.completeOnboarding(validSettings).onboardingCompleted).toBe(true)
    } finally {
      opened.close()
    }
  })

  it('rejects invalid IANA timezone input before changing stored data', () => {
    const opened = createDatabase()
    try {
      const service = createSettingsService(opened.database)
      expect(() =>
        service.save({
          ...validSettings,
          preferences: { ...validSettings.preferences, timezoneId: 'Not/A-Timezone' }
        })
      ).toThrow()
      expect(service.get().preferences.timezoneId).toBe('Asia/Tehran')
    } finally {
      opened.close()
    }
  })
})
