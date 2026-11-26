import { randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { copyFile, mkdir, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import * as unzipper from 'unzipper'
import { afterEach, describe, expect, it } from 'vitest'
import { openKarnamaDatabase } from '../../src/main/db/client'
import { createAnalyticsService } from '../../src/main/db/analytics-service'
import { createCommitmentService } from '../../src/main/db/commitment-service'
import {
  cleanupBackupTemporaryFiles,
  createBackupService,
  recoverInterruptedRestore
} from '../../src/main/backup/backup-service'
import {
  appSettings,
  attachments,
  reportSnapshots,
  tasks,
  timerRuns,
  userProfile,
  workDateAllocations,
  workSessions
} from '../../src/main/db/schema'
import { createTaskResourceService } from '../../src/main/db/task-resource-service'
import { createWorkService } from '../../src/main/db/work-service'

const migrationsFolder = resolve(process.cwd(), 'drizzle')
const temporaryDirectories: string[] = []
const openedDatabases: Array<ReturnType<typeof openKarnamaDatabase>> = []
const appTime = Date.UTC(2026, 10, 25, 12)

function createContext(
  options: { profileDirectory?: string; migrations?: string; now?: () => number } = {}
) {
  const profileDirectory =
    options.profileDirectory ?? mkdtempSync(join(tmpdir(), 'karnama-backup-profile-'))
  if (!temporaryDirectories.includes(profileDirectory)) temporaryDirectories.push(profileDirectory)
  mkdirSync(profileDirectory, { recursive: true })
  const databasePath = join(profileDirectory, 'karnama.sqlite')
  const attachmentsDirectory = join(profileDirectory, 'attachments')
  const backupsDirectory = join(profileDirectory, 'backups')
  const opened = openKarnamaDatabase({
    databasePath,
    migrationsFolder: options.migrations ?? migrationsFolder,
    timezoneId: 'Asia/Tehran'
  })
  openedDatabases.push(opened)
  const now = options.now ?? (() => appTime)
  const work = createWorkService(opened.database, { now })
  const backups = createBackupService({
    database: opened.database,
    backupDatabase: (destination, onProgress) => opened.backupTo(destination, onProgress),
    attachmentsDirectory,
    userDataDirectory: profileDirectory,
    backupsDirectory,
    migrationsFolder,
    appVersion: '0.1.0',
    prepareForRestore: () => opened.close(),
    restartAfterRestore: () => undefined,
    now
  })
  return {
    profileDirectory,
    databasePath,
    attachmentsDirectory,
    backupsDirectory,
    opened,
    work,
    backups
  }
}

function taskInput(title: string) {
  return {
    title,
    description: '',
    notes: '',
    status: 'todo' as const,
    priority: 'medium' as const,
    estimatedDurationMinutes: null
  }
}

function pngBytes(seed: number) {
  const bytes = Buffer.alloc(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12)
  bytes.writeUInt32BE(seed, 16)
  bytes.writeUInt32BE(1, 20)
  return bytes
}

async function readEntry(entry: { stream(): NodeJS.ReadableStream }) {
  const chunks: Buffer[] = []
  for await (const chunk of entry.stream()) chunks.push(Buffer.from(chunk as Buffer))
  return Buffer.concat(chunks)
}

function crc32(bytes: Buffer) {
  let crc = 0xffffffff
  for (const byte of bytes) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1
  }
  return (crc ^ 0xffffffff) >>> 0
}

function storedZip(entries: Array<{ name: string; data: Buffer; externalAttributes?: number }>) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const crc = crc32(entry.data)
    const local = Buffer.alloc(30 + name.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(0, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(entry.data.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    name.copy(local, 30)
    localParts.push(local, entry.data)

    const central = Buffer.alloc(46 + name.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(entry.data.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE((entry.externalAttributes ?? 0) >>> 0, 38)
    central.writeUInt32LE(offset, 42)
    name.copy(central, 46)
    centralParts.push(central)
    offset += local.length + entry.data.length
  }
  const localData = Buffer.concat(localParts)
  const centralData = Buffer.concat(centralParts)
  const footer = Buffer.alloc(22)
  footer.writeUInt32LE(0x06054b50, 0)
  footer.writeUInt16LE(entries.length, 8)
  footer.writeUInt16LE(entries.length, 10)
  footer.writeUInt32LE(centralData.length, 12)
  footer.writeUInt32LE(localData.length, 16)
  return Buffer.concat([localData, centralData, footer])
}

async function rewriteBackupManifest(
  context: ReturnType<typeof createContext>,
  backupId: string,
  update: (manifest: Record<string, unknown>) => void,
  removeAttachment?: string
) {
  const archivePath = await backupPath(context, backupId)
  const archive = await unzipper.Open.file(archivePath)
  const temporary = mkdtempSync(join(tmpdir(), 'karnama-rewrite-'))
  temporaryDirectories.push(temporary)
  for (const entry of archive.files) {
    if (removeAttachment && entry.path === removeAttachment) continue
    const outputPath = join(temporary, entry.path.replaceAll('/', '\\'))
    if (entry.type === 'Directory') mkdirSync(outputPath, { recursive: true })
    else {
      mkdirSync(join(outputPath, '..'), { recursive: true })
      writeFileSync(outputPath, await readEntry(entry))
    }
  }
  const manifestPath = join(temporary, 'manifest.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
  update(manifest)
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
  const rewritten = join(dirname(temporary), `karnama-rewrite-${randomUUID()}.zip`)
  const tarPath = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  execFileSync(
    tarPath,
    [
      '-a',
      '-c',
      '-f',
      rewritten,
      '-C',
      temporary,
      'database.sqlite',
      'manifest.json',
      'attachments'
    ],
    { windowsHide: true }
  )
  try {
    await copyFile(rewritten, archivePath)
  } finally {
    await rm(rewritten, { force: true })
  }
}

async function backupPath(context: ReturnType<typeof createContext>, backupId: string) {
  const entries = await readdir(context.backupsDirectory)
  const name = entries.find((value) => value.endsWith(`${backupId}.zip`))
  if (!name) throw new Error('Backup file was not published')
  return join(context.backupsDirectory, name)
}

function createPhase4Migrations(directory: string) {
  const target = join(directory, 'phase4-migrations')
  const targetMeta = join(target, 'meta')
  mkdirSync(targetMeta, { recursive: true })
  for (const file of [
    '0000_adorable_callisto.sql',
    '0001_sad_rumiko_fujikawa.sql',
    '0002_remarkable_sunspot.sql',
    '0003_abnormal_hemingway.sql',
    '0004_purple_risque.sql'
  ]) {
    writeFileSync(join(target, file), readFileSync(join(migrationsFolder, file)))
  }
  const journal = JSON.parse(
    readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')
  ) as {
    version: string
    dialect: string
    entries: unknown[]
  }
  writeFileSync(
    join(targetMeta, '_journal.json'),
    JSON.stringify({ ...journal, entries: journal.entries.slice(0, 5) })
  )
  return target
}

afterEach(() => {
  for (const opened of openedDatabases.splice(0)) opened.close()
  for (const directory of temporaryDirectories.splice(0))
    rmSync(directory, { recursive: true, force: true })
})

describe('local backup and restore', () => {
  it('cleans abandoned restore staging directories with mkdtemp suffixes', async () => {
    const context = createContext()
    const staleStage = join(context.profileDirectory, '.karnama-restore-VpxOOF')
    await mkdir(staleStage)
    await writeFile(join(staleStage, 'manifest.json'), '{}')

    await cleanupBackupTemporaryFiles(context.profileDirectory, context.backupsDirectory)

    expect(existsSync(staleStage)).toBe(false)
  })

  it('creates and validates a portable ZIP for a database with no tasks', async () => {
    const context = createContext()
    const created = await context.backups.createBackup()
    const path = await backupPath(context, created.id)
    const archive = await unzipper.Open.file(path)
    const manifestEntry = archive.files.find((entry) => entry.path === 'manifest.json')
    expect(manifestEntry).toBeDefined()
    const manifest = JSON.parse((await readEntry(manifestEntry!)).toString('utf8')) as {
      format: string
      formatVersion: number
      createdAtUtc: string
      appVersion: string
      schemaVersion: number
      components: string[]
      files: Array<{ path: string; sizeBytes: number; sha256: string }>
    }

    expect(created.status).toBe('valid')
    expect(manifest).toMatchObject({
      format: 'karnama-backup',
      formatVersion: 1,
      appVersion: '0.1.0',
      schemaVersion: 7,
      components: ['database', 'attachments']
    })
    expect(manifest.createdAtUtc).toBe(new Date(appTime).toISOString())
    expect(manifest.files.map((file) => file.path)).toEqual(['database.sqlite'])
    expect(manifest.files[0].sha256).toMatch(/^[0-9a-f]{64}$/)
    expect((await context.backups.validateBackup(created.id)).status).toBe('valid')
  })

  it('backs up WAL data and leaves a running timer untouched', async () => {
    const context = createContext()
    const task = context.work.createTask(taskInput('تایمر فعال'))
    context.work.startTimer({ taskId: task.id })
    const databaseBefore = readFileSync(context.databasePath)

    const created = await context.backups.createBackup()

    expect((await context.backups.validateBackup(created.id)).status).toBe('valid')
    expect(readFileSync(context.databasePath)).toEqual(databaseBefore)
    expect(context.opened.database.select().from(timerRuns).get()?.status).toBe('running')
  })

  it('backs up multiple attachments, sessions, links, settings, and report snapshots then restores them', async () => {
    const source = createContext()
    const task = source.work.createTask(taskInput('دادهٔ اصلی'))
    source.work.createManualSession({
      taskId: task.id,
      startDate: '2026-11-25',
      startTime: '09:00',
      startOccurrence: null,
      endDate: '2026-11-25',
      endTime: '10:00',
      endOccurrence: null,
      allocationMode: 'boundary',
      workDate: null
    })
    const resourceService = createTaskResourceService(
      source.opened.database,
      source.attachmentsDirectory
    )
    const inputDirectory = join(source.profileDirectory, 'inputs')
    await mkdir(inputDirectory)
    const imageOne = join(inputDirectory, 'one.png')
    const imageTwo = join(inputDirectory, 'two.png')
    await writeFile(imageOne, pngBytes(1))
    await writeFile(imageTwo, pngBytes(2))
    const imported = await resourceService.importImages({ taskId: task.id }, [imageOne, imageTwo])
    resourceService.createLink({
      taskId: task.id,
      input: { title: 'Design', type: 'external', url: 'https://example.com/spec' }
    })
    source.opened.database
      .update(userProfile)
      .set({ displayName: 'کاربر پشتیبان' })
      .where(eq(userProfile.id, 1))
      .run()
    source.opened.database
      .update(appSettings)
      .set({ theme: 'dark' })
      .where(eq(appSettings.id, 1))
      .run()
    source.opened.database
      .insert(reportSnapshots)
      .values({
        id: randomUUID(),
        reportType: 'personal',
        calendar: 'jalali',
        periodKey: '1405-09',
        periodStartWorkDate: '2026-11-22',
        periodEndWorkDate: '2026-12-21',
        format: 'html',
        generatedAtUtcMs: appTime,
        payloadJson: '{"saved":true}'
      })
      .run()
    source.work.archiveTask({ id: task.id })
    const created = await source.backups.createBackup()

    const target = createContext()
    target.work.createTask(taskInput('دادهٔ جایگزین'))
    await mkdir(target.backupsDirectory, { recursive: true })
    await copyFile(
      await backupPath(source, created.id),
      join(
        target.backupsDirectory,
        (await readdir(source.backupsDirectory)).find((name) => name.endsWith(`${created.id}.zip`))!
      )
    )

    await target.backups.restoreBackup(created.id)
    await recoverInterruptedRestore(target.profileDirectory)
    const reopened = openKarnamaDatabase({
      databasePath: target.databasePath,
      migrationsFolder,
      timezoneId: 'Asia/Tehran'
    })
    openedDatabases.push(reopened)

    const restoredTask = reopened.database.select().from(tasks).get()
    expect(restoredTask?.title).toBe('دادهٔ اصلی')
    expect(restoredTask?.archivedAtUtcMs).not.toBeNull()
    expect(reopened.database.select().from(workSessions).all()).toHaveLength(1)
    expect(reopened.database.select().from(workDateAllocations).all()).toHaveLength(1)
    expect(reopened.database.select().from(reportSnapshots).all()).toHaveLength(1)
    expect(reopened.database.select().from(userProfile).get()?.displayName).toBe('کاربر پشتیبان')
    expect(reopened.database.select().from(appSettings).get()?.theme).toBe('dark')
    expect(reopened.database.select().from(attachments).all()).toHaveLength(2)
    const restoredCommitments = createCommitmentService(reopened.database, { now: () => appTime })
    const restoredAnalytics = createAnalyticsService(reopened.database, restoredCommitments, {
      now: () => appTime
    })
    expect(
      restoredAnalytics.getPeriod({ calendar: 'gregorian', year: 2026, month: 11 }).summary
        .actualMinutes
    ).toBe(0)
    const restoredWork = createWorkService(reopened.database, { now: () => appTime })
    restoredWork.restoreTask({ id: restoredTask!.id })
    expect(
      restoredAnalytics.getPeriod({ calendar: 'gregorian', year: 2026, month: 11 }).summary
        .actualMinutes
    ).toBe(60)
    const restoredResources = createTaskResourceService(
      reopened.database,
      target.attachmentsDirectory
    )
    const restoredAttachments = restoredResources.listAttachments({ taskId: restoredTask!.id })
    expect(restoredAttachments).toHaveLength(2)
    for (const attachment of imported) {
      const restored = restoredAttachments.find((item) => item.id === attachment.id)
      expect(restored).toBeDefined()
      expect((await restoredResources.readAttachmentImage({ id: restored!.id })).bytes).toEqual(
        attachment.id === imported[0].id ? pngBytes(1) : pngBytes(2)
      )
    }
    await expect(target.backups.listBackups()).resolves.toHaveLength(2)
  })

  it('rejects a corrupted database payload before restore', async () => {
    const context = createContext()
    context.work.createTask(taskInput('Integrity'))
    const created = await context.backups.createBackup()
    const path = await backupPath(context, created.id)
    const archive = await unzipper.Open.file(path)
    const databaseEntry = archive.files.find((entry) => entry.path === 'database.sqlite')!
    const bytes = readFileSync(path)
    const localHeader = bytes.subarray(
      databaseEntry.offsetToLocalFileHeader,
      databaseEntry.offsetToLocalFileHeader + 30
    )
    const payloadOffset =
      databaseEntry.offsetToLocalFileHeader +
      30 +
      localHeader.readUInt16LE(26) +
      localHeader.readUInt16LE(28)
    bytes[payloadOffset] ^= 0xff
    writeFileSync(path, bytes)

    await expect(context.backups.validateBackup(created.id)).rejects.toMatchObject({
      code: 'storage_error'
    })
    expect(context.opened.database.select().from(tasks).get()?.title).toBe('Integrity')
  })

  it('rejects unsupported format and newer schema versions', async () => {
    const context = createContext()
    const created = await context.backups.createBackup()

    await rewriteBackupManifest(context, created.id, (manifest) => {
      manifest.formatVersion = 2
    })
    await expect(context.backups.validateBackup(created.id)).rejects.toMatchObject({
      code: 'incompatible'
    })

    await rewriteBackupManifest(context, created.id, (manifest) => {
      manifest.formatVersion = 1
      manifest.schemaVersion = 8
    })
    await expect(context.backups.validateBackup(created.id)).rejects.toMatchObject({
      code: 'incompatible'
    })
  })

  it('detects a missing attachment file in an otherwise readable archive', async () => {
    const context = createContext()
    const task = context.work.createTask(taskInput('Missing file'))
    const resources = createTaskResourceService(
      context.opened.database,
      context.attachmentsDirectory
    )
    const inputDirectory = join(context.profileDirectory, 'attachment-input')
    await mkdir(inputDirectory)
    const imagePath = join(inputDirectory, 'missing.png')
    await writeFile(imagePath, pngBytes(1))
    const [image] = await resources.importImages({ taskId: task.id }, [imagePath])
    const created = await context.backups.createBackup()

    await rewriteBackupManifest(context, created.id, () => undefined, `attachments/${image.id}.png`)

    await expect(context.backups.validateBackup(created.id)).rejects.toMatchObject({
      code: 'storage_error'
    })
  })

  it('rejects path traversal, absolute paths, and symbolic links in selected ZIP files', async () => {
    const context = createContext()
    const maliciousArchiveDirectory = mkdtempSync(join(tmpdir(), 'karnama-malicious-zip-'))
    temporaryDirectories.push(maliciousArchiveDirectory)
    const baseEntries = [
      { name: 'manifest.json', data: Buffer.from('{}') },
      { name: 'database.sqlite', data: Buffer.from('not a database') }
    ]
    for (const unsafeName of ['../outside.txt', 'C:/outside.txt']) {
      const path = join(maliciousArchiveDirectory, `${randomUUID()}.zip`)
      writeFileSync(
        path,
        storedZip([...baseEntries, { name: unsafeName, data: Buffer.from('blocked') }])
      )
      await expect(context.backups.chooseRestoreBackupForPath(path)).rejects.toMatchObject({
        code: 'storage_error'
      })
    }
    const linkPath = join(maliciousArchiveDirectory, `${randomUUID()}.zip`)
    writeFileSync(
      linkPath,
      storedZip([
        ...baseEntries,
        {
          name: `attachments/${randomUUID()}.png`,
          data: pngBytes(1),
          externalAttributes: (0xa000 << 16) >>> 0
        }
      ])
    )
    await expect(context.backups.chooseRestoreBackupForPath(linkPath)).rejects.toMatchObject({
      code: 'storage_error'
    })
  })

  it('migrates a compatible Phase 4 schema when restoring', async () => {
    const sourceRoot = mkdtempSync(join(tmpdir(), 'karnama-backup-phase4-'))
    temporaryDirectories.push(sourceRoot)
    const phase4Migrations = createPhase4Migrations(sourceRoot)
    const source = createContext({
      profileDirectory: join(sourceRoot, 'profile'),
      migrations: phase4Migrations
    })
    const taskId = randomUUID()
    const timestamp = appTime
    const legacyDatabase = new Database(source.databasePath)
    legacyDatabase
      .prepare(
        'INSERT INTO tasks (id, title, description, notes, status, priority, created_at_utc_ms, updated_at_utc_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(taskId, 'Phase 4 record', '', '', 'todo', 'medium', timestamp, timestamp)
    legacyDatabase.close()
    const created = await source.backups.createBackup()

    const target = createContext()
    await mkdir(target.backupsDirectory, { recursive: true })
    const sourceName = (await readdir(source.backupsDirectory)).find((name) =>
      name.endsWith(`${created.id}.zip`)
    )!
    await copyFile(
      join(source.backupsDirectory, sourceName),
      join(target.backupsDirectory, sourceName)
    )
    await target.backups.restoreBackup(created.id)
    await recoverInterruptedRestore(target.profileDirectory)
    const reopened = openKarnamaDatabase({
      databasePath: target.databasePath,
      migrationsFolder,
      timezoneId: 'Asia/Tehran'
    })
    openedDatabases.push(reopened)

    expect(reopened.database.select().from(tasks).where(eq(tasks.id, taskId)).get()).toMatchObject({
      title: 'Phase 4 record',
      position: 0
    })
    const db = new Database(target.databasePath, { readonly: true })
    const migrationCount = db
      .prepare('SELECT COUNT(*) AS count FROM __drizzle_migrations')
      .get() as {
      count: number
    }
    db.close()
    expect(migrationCount.count).toBe(7)
  })

  it('keeps data unchanged when current attachment storage fails a restore precondition', async () => {
    const source = createContext()
    source.work.createTask(taskInput('Backup source'))
    const backup = await source.backups.createBackup()

    const target = createContext()
    const task = target.work.createTask(taskInput('Keep this task'))
    await rm(target.attachmentsDirectory, { recursive: true, force: true })
    await writeFile(target.attachmentsDirectory, 'not a directory')
    await mkdir(target.backupsDirectory, { recursive: true })
    const name = (await readdir(source.backupsDirectory)).find((item) =>
      item.endsWith(`${backup.id}.zip`)
    )!
    await copyFile(join(source.backupsDirectory, name), join(target.backupsDirectory, name))

    await expect(target.backups.restoreBackup(backup.id)).rejects.toMatchObject({
      code: 'storage_error'
    })
    expect(existsSync(target.databasePath)).toBe(true)
    const reopened = openKarnamaDatabase({
      databasePath: target.databasePath,
      migrationsFolder,
      timezoneId: 'Asia/Tehran'
    })
    openedDatabases.push(reopened)
    expect(reopened.database.select().from(tasks).get()?.id).toBe(task.id)
  })

  it('restores an empty-profile backup and recovers the previous database after an interrupted swap', async () => {
    const source = createContext()
    const emptyBackup = await source.backups.createBackup()
    const emptyTarget = createContext()
    await mkdir(emptyTarget.backupsDirectory, { recursive: true })
    const emptyName = (await readdir(source.backupsDirectory)).find((name) =>
      name.endsWith(`${emptyBackup.id}.zip`)
    )!
    await copyFile(
      join(source.backupsDirectory, emptyName),
      join(emptyTarget.backupsDirectory, emptyName)
    )
    await emptyTarget.backups.restoreBackup(emptyBackup.id)
    await recoverInterruptedRestore(emptyTarget.profileDirectory)
    const restoredEmpty = openKarnamaDatabase({
      databasePath: emptyTarget.databasePath,
      migrationsFolder,
      timezoneId: 'Asia/Tehran'
    })
    openedDatabases.push(restoredEmpty)
    expect(restoredEmpty.database.select().from(tasks).all()).toEqual([])

    const previous = createContext()
    const previousTask = previous.work.createTask(taskInput('Rollback target'))
    const resources = createTaskResourceService(
      previous.opened.database,
      previous.attachmentsDirectory
    )
    const inputDirectory = join(previous.profileDirectory, 'rollback-input')
    await mkdir(inputDirectory)
    const imagePath = join(inputDirectory, 'rollback.png')
    await writeFile(imagePath, pngBytes(1))
    await resources.importImages({ taskId: previousTask.id }, [imagePath])
    const transactionId = randomUUID()
    const rollback = join(previous.profileDirectory, `.karnama-rollback-${transactionId}`)
    await mkdir(rollback)
    previous.opened.close()
    await rename(previous.databasePath, join(rollback, 'karnama.sqlite'))
    await rename(previous.attachmentsDirectory, join(rollback, 'attachments'))
    const stage = join(previous.profileDirectory, `.karnama-restore-${transactionId}`)
    await mkdir(stage)
    await writeFile(
      join(previous.profileDirectory, '.karnama-restore-transaction.json'),
      JSON.stringify({ version: 1, id: transactionId, hadAttachments: true, sidecars: [] })
    )

    await recoverInterruptedRestore(previous.profileDirectory)
    const recovered = openKarnamaDatabase({
      databasePath: previous.databasePath,
      migrationsFolder,
      timezoneId: 'Asia/Tehran'
    })
    openedDatabases.push(recovered)
    expect(recovered.database.select().from(tasks).get()?.id).toBe(previousTask.id)
    expect(recovered.database.select().from(attachments).all()).toHaveLength(1)
    expect(
      existsSync(
        join(
          previous.attachmentsDirectory,
          recovered.database.select().from(attachments).get()!.storageRef
        )
      )
    ).toBe(true)
    expect(existsSync(stage)).toBe(false)
  })

  it('creates at most one scheduled backup per 24 hours and does not remove old archives', async () => {
    let clock = appTime
    const context = createContext({ now: () => clock })
    expect(context.backups.millisecondsUntilAutomaticBackup()).toBe(0)
    expect(await context.backups.runAutomaticBackupIfDue()).toMatchObject({ kind: 'automatic' })
    expect(context.backups.millisecondsUntilAutomaticBackup()).toBe(24 * 60 * 60 * 1000)
    expect(await context.backups.runAutomaticBackupIfDue()).toBeNull()
    clock += 24 * 60 * 60 * 1000
    expect(context.backups.millisecondsUntilAutomaticBackup()).toBe(0)
    expect(await context.backups.runAutomaticBackupIfDue()).toMatchObject({ kind: 'automatic' })
    expect(
      (await context.backups.listBackups()).filter((item) => item.kind === 'automatic')
    ).toHaveLength(2)
  })

  it('allows explicit deletion of a manual backup and protects automatic backups', async () => {
    const context = createContext()
    const manual = await context.backups.createBackup()
    const automatic = await context.backups.runAutomaticBackupIfDue()
    expect(automatic?.kind).toBe('automatic')

    await expect(context.backups.deleteBackup(manual.id)).resolves.toBe(true)
    await expect(context.backups.deleteBackup(automatic!.id)).rejects.toMatchObject({
      code: 'conflict'
    })
    expect((await context.backups.listBackups()).map((item) => item.id)).toEqual([automatic!.id])
  })
})
