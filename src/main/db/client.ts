import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { appMetadata, appSettings, userProfile, workScheduleVersions } from './schema'
import * as schema from './schema'

export type KarnamaDatabase = BetterSQLite3Database<typeof schema>

export type OpenDatabaseOptions = {
  databasePath: string
  migrationsFolder: string
  timezoneId: string
}

export function openKarnamaDatabase(options: OpenDatabaseOptions) {
  mkdirSync(dirname(options.databasePath), { recursive: true })
  const sqlite = new Database(options.databasePath)
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('journal_mode = WAL')

  const database = drizzle(sqlite, { schema })
  migrate(database, { migrationsFolder: options.migrationsFolder })
  seedDatabase(database, options.timezoneId)
  let closed = false

  return {
    database,
    backupTo: (
      destinationPath: string,
      onProgress: (progress: { totalPages: number; remainingPages: number }) => number
    ) => sqlite.backup(destinationPath, { progress: onProgress }),
    close: () => {
      if (!closed) {
        closed = true
        sqlite.close()
      }
    }
  }
}

function seedDatabase(database: KarnamaDatabase, timezoneId: string) {
  const now = Date.now()

  database.transaction((transaction) => {
    transaction
      .insert(userProfile)
      .values({ id: 1, displayName: '', jobTitle: 'Product Designer', updatedAt: now })
      .onConflictDoNothing()
      .run()

    transaction
      .insert(appSettings)
      .values({
        id: 1,
        dailyCommitmentMinutes: 480,
        workingWeekdaysJson: JSON.stringify([6, 7, 1, 2, 3, 4]),
        weeklyHolidayIsoDay: 5,
        workDateBoundaryMinutes: 360,
        calendar: 'jalali',
        theme: 'system',
        timezoneId,
        createdAt: now,
        updatedAt: now
      })
      .onConflictDoNothing()
      .run()

    if (
      transaction
        .select({ id: workScheduleVersions.id })
        .from(workScheduleVersions)
        .limit(1)
        .get() === undefined
    ) {
      const settings = transaction.select().from(appSettings).where(eq(appSettings.id, 1)).get()!
      transaction
        .insert(workScheduleVersions)
        .values({
          id: crypto.randomUUID(),
          effectiveFromWorkDate: '1800-01-01',
          timeZoneId: settings.timezoneId,
          workDateBoundaryMinutes: settings.workDateBoundaryMinutes,
          dailyCommitmentMinutes: settings.dailyCommitmentMinutes,
          weeklyHolidayIsoDay: settings.weeklyHolidayIsoDay,
          workingWeekdaysJson: settings.workingWeekdaysJson,
          createdAtUtcMs: now
        })
        .run()
    }

    transaction
      .insert(appMetadata)
      .values([
        { key: 'database_id', value: crypto.randomUUID(), updatedAt: now },
        { key: 'initialized_at', value: new Date(now).toISOString(), updatedAt: now }
      ])
      .onConflictDoNothing()
      .run()
  })
}
