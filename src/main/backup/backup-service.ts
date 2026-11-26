import { execFile as execFileCallback } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { existsSync, createReadStream, createWriteStream } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  statfs,
  unlink,
  writeFile
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import * as unzipper from 'unzipper'
import { z } from 'zod'
import {
  backupManifestSchema,
  backupSummarySchema,
  backupTargetSchema,
  restoreSelectionSchema,
  type BackupKind,
  type BackupManifest,
  type BackupProgressDto,
  type BackupSummaryDto,
  type RestoreSelectionDto
} from '../../shared/contracts/backups'
import type { KarnamaDatabase } from '../db/client'
import { openKarnamaDatabase } from '../db/client'
import { appMetadata } from '../db/schema'

const execFile = promisify(execFileCallback)
const formatVersion = 1
const automaticBackupIntervalMs = 24 * 60 * 60 * 1000
const fileNamePattern =
  /^karnama-backup-(\d{13})-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.zip$/i
const storageRefPattern =
  /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(png|jpg|webp)$/i
const packageVersion = z.string().regex(/^\d+\.\d+\.\d+$/)
const journalSchema = z.object({
  entries: z.array(z.object({ tag: z.string().regex(/^\d{4}_[a-z0-9_]+$/), when: z.number() }))
})

type MigrationEntry = z.infer<typeof journalSchema>['entries'][number]
type MigrationState = { entries: MigrationEntry[]; hashes: string[] }
type AttachmentRow = {
  id: string
  storage_ref: string
  file_size_bytes: number
  mime_type: string
}
type SummaryIndexEntry = {
  name: string
  manifest: string | null
  error: string | null
}
type RestoreMarker = {
  version: 1
  id: string
  hadAttachments: boolean
  sidecars: string[]
}
type ZipEntry = {
  path: string
  type: 'File' | 'Directory' | string
  flags: number
  compressionMethod: number
  crc32: number
  compressedSize: number
  uncompressedSize: number
  externalFileAttributes: number
  versionMadeBy: number
  fileNameLength: number
  extraFieldLength: number
  offsetToLocalFileHeader: number
  pathBuffer: Buffer
  diskNumber?: number
  stream: () => NodeJS.ReadableStream
}
type InspectedArchive = {
  entries: ZipEntry[]
  sizeBytes: number
  centralDirectoryOffset: number
  totalUncompressedSize: number
}

export type BackupServiceErrorCode =
  'invalid_input' | 'not_found' | 'conflict' | 'incompatible' | 'storage_error'

export class BackupServiceError extends Error {
  constructor(
    readonly code: BackupServiceErrorCode,
    message: string
  ) {
    super(message)
  }
}

type BackupServiceOptions = {
  database: KarnamaDatabase
  backupDatabase: (
    destinationPath: string,
    onProgress: (progress: { totalPages: number; remainingPages: number }) => number
  ) => Promise<unknown>
  attachmentsDirectory: string
  userDataDirectory: string
  backupsDirectory: string
  migrationsFolder: string
  appVersion: string
  prepareForRestore: () => void
  restartAfterRestore: () => void
  reportProgress?: (progress: BackupProgressDto) => void
  now?: () => number
  id?: () => string
}

export function createBackupService(options: BackupServiceOptions) {
  const now = options.now ?? Date.now
  const id = options.id ?? randomUUID
  const selections = new Map<string, { path: string; expires: NodeJS.Timeout }>()
  let busy = false

  function progress(phase: BackupProgressDto['phase'], percent: number, message: string) {
    options.reportProgress?.({ phase, percent: Math.min(100, Math.max(0, percent)), message })
  }

  async function ensureDirectories() {
    await mkdir(options.userDataDirectory, { recursive: true })
    await mkdir(options.backupsDirectory, { recursive: true })
  }

  async function archiveOperation(
    operation: 'create' | 'extract' | 'read-manifest' | 'list-manifests',
    source: string,
    target: string
  ) {
    try {
      if (operation === 'create') {
        if (process.platform !== 'win32') {
          throw new BackupServiceError(
            'storage_error',
            'بسته‌بندی نسخهٔ پشتیبان فقط در Windows پشتیبانی می‌شود.'
          )
        }
        const tarPath = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
        await execFile(
          tarPath,
          [
            '-a',
            '-c',
            '-f',
            target,
            '-C',
            source,
            'database.sqlite',
            'manifest.json',
            'attachments'
          ],
          { windowsHide: true, maxBuffer: 2 * 1024 * 1024, timeout: 10 * 60 * 1000 }
        )
        return ''
      }
      if (operation === 'list-manifests') {
        const results: SummaryIndexEntry[] = []
        for (const name of await readdir(source)) {
          if (!fileNamePattern.test(name)) continue
          try {
            const archive = await openZipArchive(join(source, name))
            const entry = archive.entries.find((item) => item.path === 'manifest.json')
            if (!entry || entry.uncompressedSize > 4 * 1024 * 1024) {
              throw new Error('Manifest missing or oversized')
            }
            const manifest = await readZipEntry(entry, 4 * 1024 * 1024)
            results.push({
              name,
              manifest: JSON.stringify(JSON.parse(manifest.toString('utf8'))),
              error: null
            })
          } catch {
            results.push({ name, manifest: null, error: 'invalid' })
          }
        }
        return JSON.stringify(results)
      }
      const archive = await openZipArchive(source)
      if (operation === 'extract') {
        await extractZipArchive(archive, target)
        return ''
      }
      const entry = archive.entries.find((item) => item.path === 'manifest.json')
      if (!entry || entry.uncompressedSize > 4 * 1024 * 1024) {
        throw new BackupServiceError('incompatible', 'manifest نسخهٔ پشتیبان موجود یا معتبر نیست.')
      }
      return (await readZipEntry(entry, 4 * 1024 * 1024)).toString('utf8')
    } catch (error) {
      if (error instanceof BackupServiceError) throw error
      throw new BackupServiceError(
        'storage_error',
        operation === 'extract' || operation === 'read-manifest' || operation === 'list-manifests'
          ? 'فایل پشتیبان قابل‌خواندن نیست یا ساختار ZIP پشتیبانی نمی‌شود.'
          : 'فایل ZIP پشتیبان ساخته نشد. فضای دیسک، نصب Windows و دسترسی پوشه را بررسی کنید.'
      )
    }
  }

  async function getMigrationState(): Promise<MigrationState> {
    try {
      const journal = journalSchema.parse(
        JSON.parse(await readFile(join(options.migrationsFolder, 'meta', '_journal.json'), 'utf8'))
      )
      const hashes = await Promise.all(
        journal.entries.map(async ({ tag }) =>
          createHash('sha256')
            .update(await readFile(join(options.migrationsFolder, `${tag}.sql`)))
            .digest('hex')
        )
      )
      return { entries: journal.entries, hashes }
    } catch {
      throw new BackupServiceError('storage_error', 'فهرست مهاجرت‌های پایگاه داده در دسترس نیست.')
    }
  }

  function validateDatabaseFile(
    databasePath: string,
    schemaVersion: number,
    migrationState: MigrationState
  ) {
    let sqlite: Database.Database | undefined
    try {
      sqlite = new Database(databasePath, { readonly: true, fileMustExist: true })
      sqlite.pragma('busy_timeout = 5000')
      if (sqlite.pragma('integrity_check', { simple: true }) !== 'ok') {
        throw new BackupServiceError(
          'storage_error',
          'بررسی سلامت پایگاه دادهٔ نسخهٔ پشتیبان ناموفق بود.'
        )
      }
      if ((sqlite.pragma('foreign_key_check') as unknown[]).length > 0) {
        throw new BackupServiceError(
          'storage_error',
          'ارجاع‌های پایگاه دادهٔ نسخهٔ پشتیبان ناسازگار هستند.'
        )
      }

      const migrationTable = sqlite
        .prepare(
          "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = '__drizzle_migrations'"
        )
        .get()
      if (!migrationTable) {
        throw new BackupServiceError(
          'incompatible',
          'این پایگاه داده سابقهٔ مهاجرت قابل‌پشتیبانی ندارد.'
        )
      }
      const rows = sqlite
        .prepare('SELECT hash, created_at FROM __drizzle_migrations ORDER BY created_at, rowid')
        .all() as Array<{ hash: string; created_at: number }>
      if (
        schemaVersion !== rows.length ||
        schemaVersion < 1 ||
        schemaVersion > migrationState.entries.length
      ) {
        throw new BackupServiceError(
          'incompatible',
          'نسخهٔ ساختار پایگاه داده با manifest سازگار نیست.'
        )
      }
      for (let index = 0; index < rows.length; index++) {
        if (
          rows[index].hash !== migrationState.hashes[index] ||
          rows[index].created_at !== migrationState.entries[index].when
        ) {
          throw new BackupServiceError(
            'incompatible',
            'زنجیرهٔ مهاجرت این نسخهٔ پشتیبان با نسخهٔ نصب‌شده سازگار نیست.'
          )
        }
      }
      return sqlite
    } catch (error) {
      sqlite?.close()
      if (error instanceof BackupServiceError) throw error
      throw new BackupServiceError('storage_error', 'پایگاه دادهٔ نسخهٔ پشتیبان معتبر نیست.')
    }
  }

  function attachmentRows(sqlite: Database.Database, schemaVersion: number) {
    if (schemaVersion < 5) return [] as AttachmentRow[]
    return sqlite
      .prepare('SELECT id, storage_ref, file_size_bytes, mime_type FROM attachments ORDER BY id')
      .all() as AttachmentRow[]
  }

  async function validateAttachments(
    databasePath: string,
    attachmentDirectory: string,
    schemaVersion: number,
    allowedFiles?: Set<string>
  ) {
    const migrationState = await getMigrationState()
    const sqlite = validateDatabaseFile(databasePath, schemaVersion, migrationState)
    try {
      const rows = attachmentRows(sqlite, schemaVersion)
      const references = new Set<string>()
      for (const row of rows) {
        const match = storageRefPattern.exec(row.storage_ref)
        if (!match || match[1].toLowerCase() !== row.id.toLowerCase()) {
          throw new BackupServiceError(
            'storage_error',
            'ارجاع یکی از تصویرهای پایگاه داده معتبر نیست.'
          )
        }
        const expectedExtension =
          row.mime_type === 'image/png'
            ? 'png'
            : row.mime_type === 'image/jpeg'
              ? 'jpg'
              : row.mime_type === 'image/webp'
                ? 'webp'
                : null
        if (match[2].toLowerCase() !== expectedExtension) {
          throw new BackupServiceError(
            'storage_error',
            'فرمت یکی از تصویرهای پیوست با پایگاه داده هم‌خوان نیست.'
          )
        }
        const relativePath = `attachments/${row.storage_ref}`
        const filePath = join(attachmentDirectory, row.storage_ref)
        let info
        try {
          info = await lstat(filePath)
        } catch {
          throw new BackupServiceError('storage_error', 'یک فایل پیوست در نسخهٔ پشتیبان وجود ندارد.')
        }
        if (!info.isFile() || info.isSymbolicLink() || info.size !== row.file_size_bytes) {
          throw new BackupServiceError(
            'storage_error',
            'اندازه یا نوع یکی از فایل‌های پیوست معتبر نیست.'
          )
        }
        if (!(await hasImageSignature(filePath, row.mime_type))) {
          throw new BackupServiceError(
            'storage_error',
            'محتوای یکی از فایل‌های پیوست با فرمت ثبت‌شده سازگار نیست.'
          )
        }
        if (allowedFiles && !allowedFiles.has(relativePath)) {
          throw new BackupServiceError(
            'storage_error',
            'فایل پیوست موردنیاز در manifest ثبت نشده است.'
          )
        }
        references.add(relativePath)
      }
      if (allowedFiles) {
        for (const path of allowedFiles) {
          if (path.startsWith('attachments/') && !references.has(path)) {
            throw new BackupServiceError(
              'storage_error',
              'نسخهٔ پشتیبان شامل فایل پیوست بدون ارجاع است.'
            )
          }
        }
      }
      return rows
    } finally {
      sqlite.close()
    }
  }

  async function readManifest(archivePath: string) {
    const result = await archiveOperation('read-manifest', archivePath, options.userDataDirectory)
    let parsed: unknown
    try {
      parsed = JSON.parse(result)
    } catch {
      throw new BackupServiceError('storage_error', 'manifest نسخهٔ پشتیبان خوانا نیست.')
    }
    const manifest = backupManifestSchema.safeParse(parsed)
    if (!manifest.success) {
      throw new BackupServiceError(
        'incompatible',
        'manifest نسخهٔ پشتیبان ناقص یا پشتیبانی‌نشده است.'
      )
    }
    return manifest.data
  }

  function compareVersions(left: string, right: string) {
    const a = left.split('.').map(Number)
    const b = right.split('.').map(Number)
    for (let i = 0; i < 3; i++) if (a[i] !== b[i]) return a[i] - b[i]
    return 0
  }

  async function validateExtracted(stageDirectory: string, manifest: BackupManifest) {
    if (manifest.formatVersion !== formatVersion) {
      throw new BackupServiceError('incompatible', 'نسخهٔ قالب این فایل پشتیبان پشتیبانی نمی‌شود.')
    }
    if (
      !packageVersion.safeParse(options.appVersion).success ||
      compareVersions(manifest.appVersion, options.appVersion) > 0
    ) {
      throw new BackupServiceError(
        'incompatible',
        'این نسخهٔ پشتیبان با نسخهٔ فعلی برنامه سازگار نیست.'
      )
    }
    const migrationState = await getMigrationState()
    if (manifest.schemaVersion > migrationState.entries.length) {
      throw new BackupServiceError(
        'incompatible',
        'ساختار این نسخهٔ پشتیبان از نسخهٔ فعلی برنامه جدیدتر است.'
      )
    }
    if (new Set(manifest.components).size !== 2) {
      throw new BackupServiceError('incompatible', 'فهرست اجزای نسخهٔ پشتیبان معتبر نیست.')
    }

    const inventory = new Map<string, { sizeBytes: number; sha256: string }>()
    for (const entry of manifest.files) {
      if (
        entry.path !== 'database.sqlite' &&
        !/^attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/i.test(
          entry.path
        )
      ) {
        throw new BackupServiceError(
          'incompatible',
          'مسیر یکی از فایل‌های manifest پشتیبانی نمی‌شود.'
        )
      }
      if (inventory.has(entry.path.toLowerCase())) {
        throw new BackupServiceError('storage_error', 'manifest شامل مسیر تکراری است.')
      }
      inventory.set(entry.path.toLowerCase(), { sizeBytes: entry.sizeBytes, sha256: entry.sha256 })
    }
    const databaseEntry = inventory.get('database.sqlite')
    if (!databaseEntry || databaseEntry.sizeBytes < 100) {
      throw new BackupServiceError(
        'storage_error',
        'فایل پایگاه داده در manifest موجود یا کامل نیست.'
      )
    }

    const actualFiles = new Map<string, string>()
    for (const entry of await readdir(stageDirectory, { withFileTypes: true })) {
      if (entry.isSymbolicLink())
        throw new BackupServiceError('storage_error', 'پیوند نمادین در مرحلهٔ بازیابی مجاز نیست.')
      if (entry.isFile() && entry.name !== 'manifest.json') {
        actualFiles.set(entry.name.toLowerCase(), entry.name)
      }
      if (entry.isDirectory()) {
        if (entry.name !== 'attachments') {
          throw new BackupServiceError('storage_error', 'پوشهٔ ناشناخته در نسخهٔ پشتیبان وجود دارد.')
        }
        for (const child of await readdir(join(stageDirectory, entry.name), {
          withFileTypes: true
        })) {
          if (!child.isFile() || child.isSymbolicLink() || !storageRefPattern.test(child.name)) {
            throw new BackupServiceError('storage_error', 'محتوای پوشهٔ پیوست‌ها معتبر نیست.')
          }
          actualFiles.set(`attachments/${child.name}`.toLowerCase(), `attachments/${child.name}`)
        }
      }
    }
    if (actualFiles.size !== inventory.size) {
      throw new BackupServiceError(
        'storage_error',
        'فهرست فایل‌های استخراج‌شده با manifest هم‌خوان نیست.'
      )
    }
    for (const [key, entry] of inventory) {
      const actualPath = actualFiles.get(key)
      if (!actualPath)
        throw new BackupServiceError('storage_error', 'یک فایل ثبت‌شده در نسخهٔ پشتیبان موجود نیست.')
      const filePath = join(stageDirectory, actualPath)
      const info = await lstat(filePath)
      if (info.size !== entry.sizeBytes || (await hashFile(filePath)) !== entry.sha256) {
        throw new BackupServiceError(
          'storage_error',
          'اندازه یا checksum یکی از فایل‌های نسخهٔ پشتیبان درست نیست.'
        )
      }
    }

    const attachmentsPath = join(stageDirectory, 'attachments')
    await validateAttachments(
      join(stageDirectory, 'database.sqlite'),
      attachmentsPath,
      manifest.schemaVersion,
      new Set(inventory.keys())
    )
    return inventory
  }

  async function validateArchive(archivePath: string, reportProgress = false) {
    let info
    try {
      info = await lstat(archivePath)
    } catch {
      throw new BackupServiceError('not_found', 'فایل نسخهٔ پشتیبان پیدا نشد.')
    }
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new BackupServiceError('invalid_input', 'باید یک فایل پشتیبان ZIP انتخاب شود.')
    }
    const manifest = await readManifest(archivePath)
    const temporaryDirectory = await mkdtemp(join(options.userDataDirectory, '.karnama-validate-'))
    try {
      if (reportProgress) progress('validation', 10, 'در حال استخراج و بررسی ورودی‌های ZIP…')
      await archiveOperation('extract', archivePath, temporaryDirectory)
      if (reportProgress) progress('validation', 70, 'در حال بررسی checksum و سازگاری پایگاه داده…')
      await validateExtracted(temporaryDirectory, manifest)
      if (reportProgress) progress('validation', 100, 'نسخهٔ پشتیبان سالم است.')
      return { manifest, sizeBytes: info.size }
    } finally {
      await rm(temporaryDirectory, { recursive: true, force: true })
    }
  }

  function summary(
    backupId: string,
    manifest: Pick<BackupManifest, 'createdAtUtc' | 'appVersion' | 'schemaVersion' | 'kind'> | null,
    sizeBytes: number,
    status: BackupSummaryDto['status']
  ): BackupSummaryDto {
    return backupSummarySchema.parse({
      id: backupId,
      createdAtUtc: manifest?.createdAtUtc ?? null,
      appVersion: manifest?.appVersion ?? null,
      schemaVersion: manifest?.schemaVersion ?? null,
      kind: manifest?.kind ?? null,
      sizeBytes,
      status
    })
  }

  async function createArchive(kind: BackupKind) {
    await ensureDirectories()
    const backupId = id()
    const createdAt = now()
    const finalName = `karnama-backup-${createdAt}-${backupId}.zip`
    const finalPath = join(options.backupsDirectory, finalName)
    const workDirectory = await mkdtemp(join(options.backupsDirectory, '.karnama-tmp-'))
    const archivePath = join(options.backupsDirectory, `.karnama-part-${id()}.zip`)
    const snapshotPath = join(workDirectory, 'database.sqlite')
    const attachmentStage = join(workDirectory, 'attachments')
    await mkdir(attachmentStage)
    try {
      progress('snapshot', 1, 'در حال تهیهٔ تصویر سازگار از پایگاه داده…')
      await options.backupDatabase(snapshotPath, ({ totalPages, remainingPages }) => {
        const ratio = totalPages ? 1 - remainingPages / totalPages : 1
        progress('snapshot', Math.round(1 + ratio * 66), 'در حال تهیهٔ تصویر سازگار از پایگاه داده…')
        return 100
      })

      const snapshot = new Database(snapshotPath, { readonly: true, fileMustExist: true })
      let rows: AttachmentRow[]
      let schemaVersion: number
      try {
        const migrationState = await getMigrationState()
        schemaVersion = (
          snapshot.prepare('SELECT hash, created_at FROM __drizzle_migrations').all() as unknown[]
        ).length
        const validated = validateDatabaseFile(snapshotPath, schemaVersion, migrationState)
        validated.close()
        rows = attachmentRows(snapshot, schemaVersion)
      } finally {
        snapshot.close()
      }

      const files: BackupManifest['files'] = [
        {
          path: 'database.sqlite',
          sizeBytes: (await stat(snapshotPath)).size,
          sha256: await hashFile(snapshotPath)
        }
      ]
      let copied = 0
      for (const row of rows) {
        const match = storageRefPattern.exec(row.storage_ref)
        if (!match || match[1].toLowerCase() !== row.id.toLowerCase()) {
          throw new BackupServiceError(
            'storage_error',
            'ارجاع یکی از تصویرهای پایگاه داده معتبر نیست.'
          )
        }
        const sourcePath = join(options.attachmentsDirectory, row.storage_ref)
        const targetPath = join(attachmentStage, row.storage_ref)
        const sourceInfo = await lstat(sourcePath).catch(() => null)
        if (
          !sourceInfo?.isFile() ||
          sourceInfo.isSymbolicLink() ||
          sourceInfo.size !== row.file_size_bytes
        ) {
          throw new BackupServiceError(
            'storage_error',
            'فایل پیوست هنگام تهیهٔ نسخهٔ پشتیبان در دسترس نیست.'
          )
        }
        await copyFile(sourcePath, targetPath)
        if (!(await hasImageSignature(targetPath, row.mime_type))) {
          throw new BackupServiceError(
            'storage_error',
            'یکی از فایل‌های پیوست با پایگاه داده سازگار نیست.'
          )
        }
        const sizeBytes = (await stat(targetPath)).size
        files.push({
          path: `attachments/${row.storage_ref}`,
          sizeBytes,
          sha256: await hashFile(targetPath)
        })
        copied++
        progress(
          'attachments',
          68 + Math.round((copied / Math.max(1, rows.length)) * 9),
          'در حال افزودن تصویرهای پیوست…'
        )
      }

      const manifest: BackupManifest = backupManifestSchema.parse({
        format: 'karnama-backup',
        formatVersion,
        appVersion: options.appVersion,
        createdAtUtc: new Date(createdAt).toISOString(),
        schemaVersion,
        kind,
        components: ['database', 'attachments'],
        files
      })
      await writeFile(join(workDirectory, 'manifest.json'), JSON.stringify(manifest, null, 2), {
        flag: 'wx'
      })
      await syncFile(join(workDirectory, 'manifest.json'))

      progress('archive', 80, 'در حال ساخت فایل ZIP…')
      await archiveOperation('create', workDirectory, archivePath)
      progress('validation', 90, 'در حال بررسی checksum و یکپارچگی نسخهٔ پشتیبان…')
      await validateArchive(archivePath)
      await syncFile(archivePath)
      await rename(archivePath, finalPath)
      progress('validation', 100, 'نسخهٔ پشتیبان با موفقیت آماده شد.')
      return summary(backupId, manifest, (await stat(finalPath)).size, 'valid')
    } catch (error) {
      if (error instanceof BackupServiceError) throw error
      throw new BackupServiceError(
        'storage_error',
        'تهیهٔ نسخهٔ پشتیبان انجام نشد؛ دادهٔ اصلی تغییری نکرده است.'
      )
    } finally {
      await rm(workDirectory, { recursive: true, force: true })
      await rm(archivePath, { force: true })
    }
  }

  async function createBackup(kind: BackupKind = 'manual') {
    if (busy)
      throw new BackupServiceError(
        'conflict',
        'عملیات دیگری برای پشتیبان یا بازیابی در حال اجراست.'
      )
    busy = true
    try {
      return await createArchive(kind)
    } finally {
      busy = false
    }
  }

  async function listBackups() {
    await ensureDirectories()
    let output: SummaryIndexEntry[]
    try {
      const raw = await archiveOperation(
        'list-manifests',
        options.backupsDirectory,
        options.backupsDirectory
      )
      output = raw ? (JSON.parse(raw) as SummaryIndexEntry[]) : []
    } catch {
      throw new BackupServiceError('storage_error', 'فهرست نسخه‌های پشتیبان خوانده نشد.')
    }
    const summaries: BackupSummaryDto[] = []
    for (const item of output) {
      const match = fileNamePattern.exec(item.name)
      if (!match) continue
      const filePath = join(options.backupsDirectory, item.name)
      const info = await lstat(filePath).catch(() => null)
      if (!info?.isFile() || info.isSymbolicLink()) continue
      let manifest: Pick<
        BackupManifest,
        'createdAtUtc' | 'appVersion' | 'schemaVersion' | 'kind'
      > | null = null
      let status: BackupSummaryDto['status'] = 'unverified'
      try {
        if (item.error || !item.manifest) throw new Error('manifest unavailable')
        const partial = z
          .object({
            format: z.literal('karnama-backup'),
            formatVersion: z.literal(1),
            appVersion: packageVersion,
            createdAtUtc: z.string().datetime({ offset: true }),
            schemaVersion: z.number().int().positive(),
            kind: z.enum(['manual', 'automatic', 'pre_restore'])
          })
          .parse(JSON.parse(item.manifest))
        manifest = partial
      } catch {
        status = 'invalid'
      }
      summaries.push(summary(match[2], manifest, info.size, status))
    }
    return summaries.sort((a, b) => (b.createdAtUtc ?? '').localeCompare(a.createdAtUtc ?? ''))
  }

  async function pathForBackup(backupId: string) {
    const { id: safeId } = backupTargetSchema.parse({ id: backupId })
    for (const summary of await listBackups()) {
      if (summary.id !== safeId) continue
      const entries = await readdir(options.backupsDirectory)
      const name = entries.find((entry) => {
        const match = fileNamePattern.exec(entry)
        return match?.[2].toLowerCase() === safeId.toLowerCase()
      })
      if (name) return join(options.backupsDirectory, name)
    }
    throw new BackupServiceError('not_found', 'نسخهٔ پشتیبان انتخاب‌شده پیدا نشد.')
  }

  async function validateBackup(backupId: string) {
    const path = await pathForBackup(backupId)
    const { manifest, sizeBytes } = await validateArchive(path, true)
    return summary(backupId, manifest, sizeBytes, 'valid')
  }

  async function chooseRestoreBackupForPath(selectedPath: string): Promise<RestoreSelectionDto> {
    const absolutePath = resolve(selectedPath)
    const { manifest, sizeBytes } = await validateArchive(absolutePath, true)
    const selectionId = id()
    const expires = setTimeout(() => selections.delete(selectionId), 30 * 60 * 1000)
    expires.unref()
    selections.set(selectionId, { path: absolutePath, expires })
    return restoreSelectionSchema.parse({
      selectionId,
      backup: summary(selectionId, manifest, sizeBytes, 'valid')
    })
  }

  async function restoreBackup(backupId: string) {
    if (busy)
      throw new BackupServiceError(
        'conflict',
        'عملیات دیگری برای پشتیبان یا بازیابی در حال اجراست.'
      )
    busy = true
    let stagingDirectory: string | undefined
    let databaseClosed = false
    try {
      const selection = selections.get(backupId)
      const archivePath = selection ? selection.path : await pathForBackup(backupId)
      if (selection) {
        clearTimeout(selection.expires)
        selections.delete(backupId)
      }

      await ensureDirectories()
      stagingDirectory = await mkdtemp(join(options.userDataDirectory, '.karnama-restore-'))
      progress('restore', 2, 'در حال استخراج و بررسی نسخهٔ پشتیبان…')
      await archiveOperation('extract', archivePath, stagingDirectory)
      const manifest = await readManifest(archivePath)
      await validateExtracted(stagingDirectory, manifest)

      progress('restore', 50, 'در حال آماده‌سازی و مهاجرت پایگاه داده…')
      const stagedDatabasePath = join(stagingDirectory, 'database.sqlite')
      const migrated = openKarnamaDatabase({
        databasePath: stagedDatabasePath,
        migrationsFolder: options.migrationsFolder,
        timezoneId: 'Asia/Tehran'
      })
      migrated.close()
      const currentSchemaVersion = (await getMigrationState()).entries.length
      await validateAttachments(
        stagedDatabasePath,
        join(stagingDirectory, 'attachments'),
        currentSchemaVersion
      )

      progress('restore', 65, 'در حال ساخت نسخهٔ ایمنی از داده‌های فعلی…')
      await createArchive('pre_restore')
      progress(
        'restore',
        82,
        'دادهٔ جایگزین آماده است؛ برنامه برای بازیابی دوباره راه‌اندازی می‌شود…'
      )
      options.prepareForRestore()
      databaseClosed = true
      await replaceCurrentData(options.userDataDirectory, stagingDirectory)
      await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
      progress('restart', 100, 'بازیابی کامل شد؛ برنامه در حال راه‌اندازی دوباره است.')
      options.restartAfterRestore()
      return true
    } catch (error) {
      if (databaseClosed) {
        await recoverInterruptedRestore(options.userDataDirectory).catch(() => undefined)
        options.restartAfterRestore()
      }
      if (error instanceof BackupServiceError) throw error
      throw new BackupServiceError(
        'storage_error',
        'بازیابی انجام نشد؛ داده‌های فعلی حفظ یا از مسیر بازیابی بازگردانده شدند.'
      )
    } finally {
      if (stagingDirectory)
        await rm(stagingDirectory, { recursive: true, force: true }).catch(() => undefined)
      busy = false
    }
  }

  async function deleteBackup(backupId: string) {
    if (busy) throw new BackupServiceError('conflict', 'هنگام عملیات پشتیبان، حذف در دسترس نیست.')
    busy = true
    try {
      const path = await pathForBackup(backupId)
      const { manifest } = await validateArchive(path, true)
      if (manifest.kind !== 'manual') {
        throw new BackupServiceError(
          'conflict',
          'نسخه‌های خودکار و ایمنی از داخل برنامه حذف نمی‌شوند.'
        )
      }
      await unlink(path)
      return true
    } finally {
      busy = false
    }
  }

  function millisecondsUntilAutomaticBackup() {
    const value = options.database
      .select({ value: appMetadata.value })
      .from(appMetadata)
      .where(eq(appMetadata.key, 'last_automatic_backup_at'))
      .get()?.value
    const last = value ? Date.parse(value) : 0
    return Number.isFinite(last) ? Math.max(0, last + automaticBackupIntervalMs - now()) : 0
  }

  async function runAutomaticBackupIfDue() {
    if (millisecondsUntilAutomaticBackup() > 0) return null
    if (busy) return null
    busy = true
    try {
      const result = await createArchive('automatic')
      const timestamp = new Date(now()).toISOString()
      options.database
        .insert(appMetadata)
        .values({ key: 'last_automatic_backup_at', value: timestamp, updatedAt: now() })
        .onConflictDoUpdate({
          target: appMetadata.key,
          set: { value: timestamp, updatedAt: now() }
        })
        .run()
      return result
    } finally {
      busy = false
    }
  }

  return {
    listBackups,
    createBackup: () => createBackup('manual'),
    validateBackup,
    chooseRestoreBackupForPath,
    restoreBackup,
    deleteBackup,
    runAutomaticBackupIfDue,
    millisecondsUntilAutomaticBackup,
    backupsDirectory: options.backupsDirectory
  }
}

async function openZipArchive(archivePath: string): Promise<InspectedArchive> {
  const fileInfo = await lstat(archivePath)
  if (!fileInfo.isFile() || fileInfo.isSymbolicLink()) {
    throw new BackupServiceError('invalid_input', 'نسخهٔ پشتیبان باید یک فایل معمولی باشد.')
  }
  const layout = await readZipLayout(archivePath, fileInfo.size)
  const directory = await unzipper.Open.file(archivePath)
  if (directory.files.length !== layout.entryCount || directory.files.length > 50_003) {
    throw new BackupServiceError('storage_error', 'تعداد ورودی‌های ZIP با ساختار آن سازگار نیست.')
  }

  const handle = await open(archivePath, 'r')
  const names = new Set<string>()
  const ranges: Array<{ start: number; end: number }> = []
  let totalUncompressedSize = 0
  try {
    for (const entry of directory.files) {
      const name = entry.path
      const vars = entry
      const isAttachmentDirectory = name === 'attachments/' && entry.type === 'Directory'
      const isFile =
        name === 'manifest.json' ||
        name === 'database.sqlite' ||
        /^attachments\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.(png|jpg|webp)$/i.test(
          name
        )
      if ((!isAttachmentDirectory && !isFile) || names.has(name.toLowerCase())) {
        throw new BackupServiceError(
          'storage_error',
          'ZIP شامل مسیر ناشناخته، ناامن یا تکراری است.'
        )
      }
      names.add(name.toLowerCase())
      if (
        !Number.isSafeInteger(vars.compressedSize) ||
        !Number.isSafeInteger(vars.uncompressedSize) ||
        !Number.isSafeInteger(vars.offsetToLocalFileHeader) ||
        !Number.isSafeInteger(vars.fileNameLength) ||
        !Number.isSafeInteger(vars.extraFieldLength) ||
        vars.compressedSize < 0 ||
        vars.uncompressedSize < 0 ||
        vars.offsetToLocalFileHeader < 0 ||
        vars.fileNameLength < 0 ||
        vars.extraFieldLength < 0 ||
        (vars.flags & (0x1 | 0x40)) !== 0 ||
        ![0, 8].includes(vars.compressionMethod) ||
        (vars.diskNumber !== undefined && vars.diskNumber !== 0)
      ) {
        throw new BackupServiceError(
          'storage_error',
          'فشرده‌سازی یا پرچم‌های ZIP پشتیبانی نمی‌شوند.'
        )
      }
      if (vars.uncompressedSize > 0xffffffff && vars.compressedSize > 0xffffffff) {
        // Values up to Number.MAX_SAFE_INTEGER remain supported by the Zip64 reader.
        if (
          vars.uncompressedSize > Number.MAX_SAFE_INTEGER ||
          vars.compressedSize > Number.MAX_SAFE_INTEGER
        ) {
          throw new BackupServiceError(
            'storage_error',
            'اندازهٔ ورودی ZIP از حد پشتیبانی فراتر است.'
          )
        }
      }
      if (name === 'manifest.json' && vars.uncompressedSize > 4 * 1024 * 1024) {
        throw new BackupServiceError('storage_error', 'manifest نسخهٔ پشتیبان بیش از حد بزرگ است.')
      }
      if (isAttachmentDirectory && (vars.uncompressedSize !== 0 || vars.compressedSize !== 0)) {
        throw new BackupServiceError('storage_error', 'ورودی پوشهٔ پیوست‌ها در ZIP معتبر نیست.')
      }

      const attributes = vars.externalFileAttributes >>> 0
      const unixType = (attributes >>> 16) & 0xf000
      if (
        (attributes & 0x400) !== 0 ||
        unixType === 0xa000 ||
        (unixType !== 0 &&
          unixType !== 0xa000 &&
          unixType !== (isAttachmentDirectory ? 0x4000 : 0x8000))
      ) {
        throw new BackupServiceError('storage_error', 'پیوند یا فایل ویژه در ZIP مجاز نیست.')
      }

      totalUncompressedSize += vars.uncompressedSize
      if (!Number.isSafeInteger(totalUncompressedSize)) {
        throw new BackupServiceError('storage_error', 'مجموع اندازهٔ ZIP از حد پشتیبانی فراتر است.')
      }

      const localHeader = Buffer.alloc(30)
      const localRead = await handle.read(
        localHeader,
        0,
        localHeader.length,
        vars.offsetToLocalFileHeader
      )
      if (
        localRead.bytesRead !== localHeader.length ||
        localHeader.readUInt32LE(0) !== 0x04034b50
      ) {
        throw new BackupServiceError('storage_error', 'سرآیند یکی از ورودی‌های ZIP معتبر نیست.')
      }
      const localFlags = localHeader.readUInt16LE(6)
      const localMethod = localHeader.readUInt16LE(8)
      const localNameLength = localHeader.readUInt16LE(26)
      const localExtraLength = localHeader.readUInt16LE(28)
      if (
        localFlags !== vars.flags ||
        localMethod !== vars.compressionMethod ||
        localNameLength !== vars.pathBuffer.length
      ) {
        throw new BackupServiceError('storage_error', 'نام یا روش ZIP با سرآیند ورودی سازگار نیست.')
      }
      const localName = Buffer.alloc(localNameLength)
      const localNameRead = await handle.read(
        localName,
        0,
        localNameLength,
        vars.offsetToLocalFileHeader + 30
      )
      if (localNameRead.bytesRead !== localNameLength || !localName.equals(vars.pathBuffer)) {
        throw new BackupServiceError('storage_error', 'نام محلی ورودی ZIP با فهرست آن یکسان نیست.')
      }
      const dataStart = vars.offsetToLocalFileHeader + 30 + localNameLength + localExtraLength
      const dataEnd = dataStart + vars.compressedSize
      if (
        !Number.isSafeInteger(dataEnd) ||
        vars.offsetToLocalFileHeader < 0 ||
        dataStart < vars.offsetToLocalFileHeader + 30 ||
        dataEnd > layout.centralDirectoryOffset
      ) {
        throw new BackupServiceError('storage_error', 'بازهٔ دادهٔ ورودی ZIP خارج از محدوده است.')
      }
      ranges.push({ start: vars.offsetToLocalFileHeader, end: dataEnd })
    }
  } finally {
    await handle.close()
  }

  if (!names.has('manifest.json') || !names.has('database.sqlite')) {
    throw new BackupServiceError('storage_error', 'نسخهٔ پشتیبان فایل‌های الزامی را ندارد.')
  }
  ranges.sort((a, b) => a.start - b.start)
  for (let index = 1; index < ranges.length; index++) {
    if (ranges[index].start < ranges[index - 1].end) {
      throw new BackupServiceError('storage_error', 'بازه‌های ورودی ZIP روی هم افتاده‌اند.')
    }
  }
  return {
    entries: directory.files,
    sizeBytes: fileInfo.size,
    centralDirectoryOffset: layout.centralDirectoryOffset,
    totalUncompressedSize
  }
}

async function readZipLayout(archivePath: string, archiveSize: number) {
  if (archiveSize < 22) throw new BackupServiceError('storage_error', 'فایل ZIP ناقص است.')
  const handle = await open(archivePath, 'r')
  try {
    const tailLength = Math.min(archiveSize, 22 + 65_535)
    const tail = Buffer.alloc(tailLength)
    const tailRead = await handle.read(tail, 0, tailLength, archiveSize - tailLength)
    if (tailRead.bytesRead !== tailLength) throw new Error('Incomplete ZIP footer')
    const signature = Buffer.from([0x50, 0x4b, 0x05, 0x06])
    let endIndex = tail.lastIndexOf(signature)
    while (
      endIndex >= 0 &&
      (endIndex + 22 > tail.length ||
        endIndex + 22 + tail.readUInt16LE(endIndex + 20) !== tail.length)
    ) {
      endIndex = tail.lastIndexOf(signature, endIndex - 1)
    }
    if (endIndex < 0) throw new Error('ZIP footer not found')
    const footerOffset = archiveSize - tailLength + endIndex
    const disk = tail.readUInt16LE(endIndex + 4)
    const centralDisk = tail.readUInt16LE(endIndex + 6)
    const countOnDisk = tail.readUInt16LE(endIndex + 8)
    const classicCount = tail.readUInt16LE(endIndex + 10)
    const classicSize = tail.readUInt32LE(endIndex + 12)
    const classicOffset = tail.readUInt32LE(endIndex + 16)
    let entryCount = classicCount
    let centralDirectorySize = classicSize
    let centralDirectoryOffset = classicOffset
    let centralEndOffset = footerOffset

    const zip64 =
      countOnDisk === 0xffff ||
      classicCount === 0xffff ||
      classicSize === 0xffffffff ||
      classicOffset === 0xffffffff
    if (disk !== 0 || centralDisk !== 0) throw new Error('Multi-disk ZIP is unsupported')
    if (zip64) {
      const locatorOffset = footerOffset - 20
      if (locatorOffset < 0) throw new Error('ZIP64 locator missing')
      const locator = Buffer.alloc(20)
      const locatorRead = await handle.read(locator, 0, locator.length, locatorOffset)
      if (locatorRead.bytesRead !== 20 || locator.readUInt32LE(0) !== 0x07064b50) {
        throw new Error('ZIP64 locator invalid')
      }
      if (locator.readUInt32LE(4) !== 0 || locator.readUInt32LE(16) !== 1) {
        throw new Error('Multi-disk ZIP64 is unsupported')
      }
      const zip64Offset = safeZipNumber(locator.readBigUInt64LE(8))
      const record = Buffer.alloc(56)
      const recordRead = await handle.read(record, 0, record.length, zip64Offset)
      if (recordRead.bytesRead !== 56 || record.readUInt32LE(0) !== 0x06064b50) {
        throw new Error('ZIP64 end record invalid')
      }
      const recordSize = safeZipNumber(record.readBigUInt64LE(4))
      if (recordSize < 44 || zip64Offset + 12 + recordSize !== locatorOffset) {
        throw new Error('ZIP64 end record range invalid')
      }
      const diskNumber = record.readUInt32LE(16)
      const startDisk = record.readUInt32LE(20)
      const diskEntries = safeZipNumber(record.readBigUInt64LE(24))
      entryCount = safeZipNumber(record.readBigUInt64LE(32))
      centralDirectorySize = safeZipNumber(record.readBigUInt64LE(40))
      centralDirectoryOffset = safeZipNumber(record.readBigUInt64LE(48))
      if (diskNumber !== 0 || startDisk !== 0 || diskEntries !== entryCount) {
        throw new Error('Multi-disk ZIP64 is unsupported')
      }
      centralEndOffset = zip64Offset
    } else if (countOnDisk !== classicCount) {
      throw new Error('ZIP entry counts do not match')
    }

    if (
      entryCount < 2 ||
      entryCount > 50_003 ||
      centralDirectoryOffset + centralDirectorySize !== centralEndOffset ||
      centralEndOffset > footerOffset
    ) {
      throw new Error('ZIP central directory range or count invalid')
    }
    return { entryCount, centralDirectoryOffset }
  } catch {
    throw new BackupServiceError('storage_error', 'ساختار ZIP ناقص یا پشتیبانی‌نشده است.')
  } finally {
    await handle.close()
  }
}

function safeZipNumber(value: bigint) {
  const number = Number(value)
  if (!Number.isSafeInteger(number) || number < 0)
    throw new Error('ZIP size is not safely representable')
  return number
}

async function extractZipArchive(archive: InspectedArchive, targetDirectory: string) {
  const disk = await statfs(targetDirectory).catch(() => null)
  if (disk) {
    const available = disk.bavail * disk.bsize
    const reserve = Math.min(512 * 1024 * 1024, Math.floor(available / 10))
    if (archive.totalUncompressedSize > available - reserve) {
      throw new BackupServiceError(
        'storage_error',
        'فضای خالی برای استخراج نسخهٔ پشتیبان و نگه‌داشتن حاشیهٔ ایمنی کافی نیست.'
      )
    }
  }
  if ((await readdir(targetDirectory)).length !== 0) {
    throw new BackupServiceError('storage_error', 'پوشهٔ موقت استخراج خالی نیست.')
  }
  await mkdir(join(targetDirectory, 'attachments'))
  for (const entry of archive.entries) {
    if (entry.type === 'Directory') continue
    const outputPath =
      entry.path === 'database.sqlite'
        ? join(targetDirectory, 'database.sqlite')
        : entry.path === 'manifest.json'
          ? join(targetDirectory, 'manifest.json')
          : join(targetDirectory, 'attachments', entry.path.slice('attachments/'.length))
    await extractZipEntry(entry, outputPath)
  }
}

async function extractZipEntry(entry: ZipEntry, outputPath: string) {
  let crc = 0xffffffff
  let size = 0
  const verifier = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      size += chunk.length
      if (size > entry.uncompressedSize) {
        callback(new Error('ZIP entry exceeded its declared size'))
        return
      }
      crc = updateCrc(crc, chunk)
      callback(null, chunk)
    }
  })
  await pipeline(entry.stream(), verifier, createWriteStream(outputPath, { flags: 'wx' }))
  if (size !== entry.uncompressedSize || (crc ^ 0xffffffff) >>> 0 !== entry.crc32 >>> 0) {
    throw new BackupServiceError('storage_error', 'CRC یا اندازهٔ یکی از ورودی‌های ZIP معتبر نیست.')
  }
  await syncFile(outputPath)
}

async function readZipEntry(entry: ZipEntry, maxBytes: number) {
  const chunks: Buffer[] = []
  let size = 0
  let crc = 0xffffffff
  for await (const chunk of entry.stream()) {
    const bytes = Buffer.from(chunk as Buffer)
    size += bytes.length
    if (size > maxBytes || size > entry.uncompressedSize) {
      throw new BackupServiceError(
        'storage_error',
        'manifest بزرگ‌تر از حد مجاز یا از اندازهٔ اعلام‌شده است.'
      )
    }
    crc = updateCrc(crc, bytes)
    chunks.push(bytes)
  }
  if (size !== entry.uncompressedSize || (crc ^ 0xffffffff) >>> 0 !== entry.crc32 >>> 0) {
    throw new BackupServiceError('storage_error', 'CRC یا اندازهٔ manifest معتبر نیست.')
  }
  return Buffer.concat(chunks, size)
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

function updateCrc(crc: number, bytes: Buffer) {
  let value = crc
  for (const byte of bytes) value = crcTable[(value ^ byte) & 0xff] ^ (value >>> 8)
  return value >>> 0
}

export async function recoverInterruptedRestore(userDataDirectory: string) {
  const markerPath = join(userDataDirectory, '.karnama-restore-transaction.json')
  const completePath = join(userDataDirectory, '.karnama-restore-complete')
  const markerInfo = await lstat(markerPath).catch((error: unknown) => {
    if (isMissing(error)) return null
    throw error
  })
  if (!markerInfo) return
  if (!markerInfo.isFile() || markerInfo.isSymbolicLink()) {
    throw new BackupServiceError(
      'storage_error',
      'نشانگر بازیابی معتبر نیست؛ داده‌ها برای بررسی دست‌نخورده مانده‌اند.'
    )
  }
  const markerContent = await readFile(markerPath, 'utf8').catch((error: unknown) => {
    if (isMissing(error)) return null
    throw error
  })
  if (markerContent === null) return

  let marker: RestoreMarker
  try {
    const value = JSON.parse(markerContent) as RestoreMarker
    if (
      value.version !== 1 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value.id
      ) ||
      typeof value.hadAttachments !== 'boolean' ||
      !Array.isArray(value.sidecars) ||
      value.sidecars.some(
        (name) =>
          !['karnama.sqlite-wal', 'karnama.sqlite-shm', 'karnama.sqlite-journal'].includes(name)
      )
    ) {
      throw new Error('invalid transaction')
    }
    marker = value
  } catch {
    throw new BackupServiceError(
      'storage_error',
      'تراکنش بازیابی قبلی قابل‌تأیید نیست؛ داده‌ها برای بررسی دست‌نخورده مانده‌اند.'
    )
  }

  const rollback = join(userDataDirectory, `.karnama-rollback-${marker.id}`)
  const staging = join(userDataDirectory, `.karnama-restore-${marker.id}`)
  const rollbackInfo = await lstat(rollback).catch((error: unknown) => {
    if (isMissing(error)) return null
    throw error
  })
  if (rollbackInfo && (!rollbackInfo.isDirectory() || rollbackInfo.isSymbolicLink())) {
    throw new BackupServiceError(
      'storage_error',
      'پوشهٔ بازیابی امن نیست؛ داده‌ها برای بررسی دست‌نخورده مانده‌اند.'
    )
  }
  const completeInfo = await lstat(completePath).catch((error: unknown) => {
    if (isMissing(error)) return null
    throw error
  })
  if (completeInfo && (!completeInfo.isFile() || completeInfo.isSymbolicLink())) {
    throw new BackupServiceError(
      'storage_error',
      'نشانگر تکمیل بازیابی معتبر نیست؛ داده‌ها حفظ شدند.'
    )
  }
  const currentDatabase = join(userDataDirectory, 'karnama.sqlite')
  const oldDatabase = join(rollback, 'karnama.sqlite')
  const currentAttachments = join(userDataDirectory, 'attachments')
  const oldAttachments = join(rollback, 'attachments')

  if (completeInfo) {
    await rm(rollback, { recursive: true, force: true })
  } else {
    const oldDbInfo = await lstat(oldDatabase).catch((error: unknown) => {
      if (isMissing(error)) return null
      throw error
    })
    if (oldDbInfo && (!oldDbInfo.isFile() || oldDbInfo.isSymbolicLink())) {
      throw new BackupServiceError(
        'storage_error',
        'نسخهٔ پایگاه دادهٔ بازگشت امن نیست؛ داده‌ها حفظ شدند.'
      )
    }
    const oldDbExists = Boolean(oldDbInfo)
    const currentDbExists = existsSync(currentDatabase)
    if (oldDbExists) {
      await removeFileOrDirectory(currentDatabase)
      await rename(oldDatabase, currentDatabase)
    } else if (!currentDbExists) {
      throw new BackupServiceError('storage_error', 'نسخهٔ پایگاه دادهٔ قبلی برای بازیابی پیدا نشد.')
    }

    if (marker.hadAttachments) {
      const oldAttachmentsInfo = await lstat(oldAttachments).catch((error: unknown) => {
        if (isMissing(error)) return null
        throw error
      })
      if (
        oldAttachmentsInfo &&
        (!oldAttachmentsInfo.isDirectory() || oldAttachmentsInfo.isSymbolicLink())
      ) {
        throw new BackupServiceError(
          'storage_error',
          'نسخهٔ پوشهٔ پیوست‌ها امن نیست؛ داده‌ها حفظ شدند.'
        )
      }
      if (oldAttachmentsInfo) {
        await removeFileOrDirectory(currentAttachments)
        await rename(oldAttachments, currentAttachments)
      } else if (!existsSync(currentAttachments)) {
        throw new BackupServiceError('storage_error', 'پوشهٔ پیوست‌های قبلی برای بازیابی پیدا نشد.')
      }
    } else {
      await removeFileOrDirectory(currentAttachments)
    }
    for (const name of marker.sidecars) {
      const backupPath = join(rollback, name)
      const currentPath = join(userDataDirectory, name)
      const backupInfo = await lstat(backupPath).catch((error: unknown) => {
        if (isMissing(error)) return null
        throw error
      })
      if (backupInfo && (!backupInfo.isFile() || backupInfo.isSymbolicLink())) {
        throw new BackupServiceError(
          'storage_error',
          'فایل journal بازگشتی امن نیست؛ داده‌ها حفظ شدند.'
        )
      }
      if (backupInfo) {
        await removeFileOrDirectory(currentPath)
        await rename(backupPath, currentPath)
      }
    }
    await rm(rollback, { recursive: true, force: true })
  }
  await rm(staging, { recursive: true, force: true })
  await rm(completePath, { force: true })
  await rm(markerPath, { force: true })
}

export async function cleanupBackupTemporaryFiles(
  userDataDirectory: string,
  backupsDirectory: string
) {
  const tempPatterns = [
    /^\.karnama-validate-[a-z0-9-]+$/i,
    /^\.karnama-restore-[a-z0-9-]+$/i,
    /^\.karnama-restore-transaction\.json\.[0-9a-f-]{36}\.tmp$/i
  ]
  for (const entry of await readdir(userDataDirectory, { withFileTypes: true }).catch(() => [])) {
    if (/^\.karnama-rollback-[0-9a-f-]{36}$/i.test(entry.name)) {
      const marker = await lstat(
        join(userDataDirectory, '.karnama-restore-transaction.json')
      ).catch((error: unknown) => {
        if (isMissing(error)) return null
        throw error
      })
      if (marker) continue
      const path = join(userDataDirectory, entry.name)
      const info = await lstat(path).catch(() => null)
      if (info?.isDirectory() && !info.isSymbolicLink()) {
        await rm(path, { recursive: true, force: true })
      }
      continue
    }
    if (!tempPatterns.some((pattern) => pattern.test(entry.name))) continue
    const path = join(userDataDirectory, entry.name)
    const info = await lstat(path).catch(() => null)
    if (info?.isDirectory() && !info.isSymbolicLink()) {
      await rm(path, { recursive: true, force: true })
    }
  }

  for (const entry of await readdir(backupsDirectory, { withFileTypes: true }).catch(() => [])) {
    if (/^\.karnama-tmp-[a-z0-9-]+$/i.test(entry.name)) {
      const path = join(backupsDirectory, entry.name)
      const info = await lstat(path).catch(() => null)
      if (info?.isDirectory() && !info.isSymbolicLink()) {
        await rm(path, { recursive: true, force: true })
      }
    } else if (/^\.karnama-part-[0-9a-f-]{36}\.zip$/i.test(entry.name)) {
      const path = join(backupsDirectory, entry.name)
      const info = await lstat(path).catch(() => null)
      if (info?.isFile() && !info.isSymbolicLink()) await unlink(path)
    }
  }
}

async function replaceCurrentData(userDataDirectory: string, stagingDirectory: string) {
  const transactionId = randomUUID()
  const rollbackDirectory = join(userDataDirectory, `.karnama-rollback-${transactionId}`)
  const markerPath = join(userDataDirectory, '.karnama-restore-transaction.json')
  const completePath = join(userDataDirectory, '.karnama-restore-complete')
  const currentDatabase = join(userDataDirectory, 'karnama.sqlite')
  const currentAttachments = join(userDataDirectory, 'attachments')
  const sidecars: string[] = []
  for (const name of ['karnama.sqlite-wal', 'karnama.sqlite-shm', 'karnama.sqlite-journal']) {
    const info = await lstat(join(userDataDirectory, name)).catch((error: unknown) => {
      if (isMissing(error)) return null
      throw error
    })
    if (!info) continue
    if (!info.isFile() || info.isSymbolicLink()) {
      throw new BackupServiceError(
        'storage_error',
        'فایل جانبی SQLite امن نیست و داده جایگزین نشد.'
      )
    }
    sidecars.push(name)
  }
  const attachmentInfo = await lstat(currentAttachments).catch(() => null)
  if (attachmentInfo && (!attachmentInfo.isDirectory() || attachmentInfo.isSymbolicLink())) {
    throw new BackupServiceError('storage_error', 'پوشهٔ پیوست‌های فعلی معتبر نیست و جایگزین نشد.')
  }
  const databaseInfo = await lstat(currentDatabase).catch(() => null)
  if (!databaseInfo?.isFile() || databaseInfo.isSymbolicLink()) {
    throw new BackupServiceError('storage_error', 'پایگاه دادهٔ فعلی پیدا نشد و جایگزین نشد.')
  }
  await mkdir(rollbackDirectory)
  await writeAtomicJson(markerPath, {
    version: 1,
    id: transactionId,
    hadAttachments: Boolean(attachmentInfo),
    sidecars
  } satisfies RestoreMarker)

  try {
    await rename(currentDatabase, join(rollbackDirectory, 'karnama.sqlite'))
    if (attachmentInfo) await rename(currentAttachments, join(rollbackDirectory, 'attachments'))
    for (const name of sidecars)
      await rename(join(userDataDirectory, name), join(rollbackDirectory, name))
    await rename(join(stagingDirectory, 'database.sqlite'), currentDatabase)
    await rename(join(stagingDirectory, 'attachments'), currentAttachments)
    const completeHandle = await open(completePath, 'wx')
    await completeHandle.sync()
    await completeHandle.close()
  } catch (error) {
    await recoverInterruptedRestore(userDataDirectory).catch(() => undefined)
    throw error
  }
}

async function writeAtomicJson(path: string, value: unknown) {
  const temporary = `${path}.${randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value), { flag: 'wx' })
  await syncFile(temporary)
  await rename(temporary, path)
}

async function syncFile(path: string) {
  const handle = await open(path, 'r+')
  try {
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function removeFileOrDirectory(path: string) {
  const info = await lstat(path).catch(() => null)
  if (!info) return
  if (info.isDirectory() && !info.isSymbolicLink()) await rm(path, { recursive: true, force: true })
  else await unlink(path)
}

async function hashFile(path: string) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex')
}

async function hasImageSignature(path: string, mimeType: string) {
  const handle = await open(path, 'r').catch(() => null)
  if (!handle) return false
  try {
    const bytes = Buffer.alloc(24)
    const { bytesRead } = await handle.read(bytes, 0, bytes.length, 0)
    if (mimeType === 'image/png') {
      return (
        bytesRead >= 24 &&
        bytes[0] === 0x89 &&
        bytes[1] === 0x50 &&
        bytes[2] === 0x4e &&
        bytes[3] === 0x47 &&
        bytes[12] === 0x49 &&
        bytes[13] === 0x48 &&
        bytes[14] === 0x44 &&
        bytes[15] === 0x52
      )
    }
    if (mimeType === 'image/jpeg')
      return bytesRead >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
    if (mimeType === 'image/webp') {
      return (
        bytesRead >= 12 &&
        bytes.toString('ascii', 0, 4) === 'RIFF' &&
        bytes.toString('ascii', 8, 12) === 'WEBP' &&
        bytes.readUInt32LE(4) + 8 <= (await handle.stat()).size
      )
    }
    return false
  } finally {
    await handle.close()
  }
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
