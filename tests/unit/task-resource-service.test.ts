import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  truncateSync,
  unlinkSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import Database from 'better-sqlite3'
import { eq } from 'drizzle-orm'
import { afterEach, describe, expect, it } from 'vitest'
import { openKarnamaDatabase } from '../../src/main/db/client'
import { createTaskResourceService } from '../../src/main/db/task-resource-service'
import { createWorkService } from '../../src/main/db/work-service'
import { attachments, taskLinks, tasks } from '../../src/main/db/schema'
import { maxImageSizeBytes } from '../../src/shared/contracts/resources'

const migrationsFolder = resolve(process.cwd(), 'drizzle')
const temporaryDirectories: string[] = []
const openedDatabases: Array<ReturnType<typeof openKarnamaDatabase>> = []

function createFixture() {
  const directory = mkdtempSync(join(tmpdir(), 'karnama-resources-'))
  temporaryDirectories.push(directory)
  const opened = openKarnamaDatabase({
    databasePath: join(directory, 'karnama.sqlite'),
    migrationsFolder,
    timezoneId: 'Asia/Tehran'
  })
  openedDatabases.push(opened)
  const task = createWorkService(opened.database).createTask({
    title: 'طراحی صفحه اصلی',
    description: 'توضیح تسک',
    notes: '',
    status: 'todo',
    priority: 'medium',
    estimatedDurationMinutes: null
  })
  const storageDirectory = join(directory, 'managed-attachments')
  return {
    directory,
    opened,
    task,
    storageDirectory,
    service: createTaskResourceService(opened.database, storageDirectory)
  }
}

function pngHeader() {
  const bytes = Buffer.alloc(24)
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12)
  bytes.writeUInt32BE(1, 16)
  bytes.writeUInt32BE(1, 20)
  return bytes
}

function jpegHeader() {
  return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0xff, 0xd9])
}

function webpHeader() {
  const bytes = Buffer.alloc(20)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(12, 4)
  bytes.write('WEBP', 8)
  bytes.write('VP8 ', 12)
  return bytes
}

function writeImage(directory: string, name: string, bytes: Buffer) {
  const filePath = join(directory, name)
  writeFileSync(filePath, bytes)
  return filePath
}

afterEach(() => {
  for (const opened of openedDatabases.splice(0)) opened.close()
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('task resource migrations and service', () => {
  it('creates resource tables on a clean database', () => {
    const { opened } = createFixture()
    expect(opened.database.select().from(taskLinks).all()).toEqual([])
    expect(opened.database.select().from(attachments).all()).toEqual([])
  })

  it('migrates a Phase 3 database without losing tasks', () => {
    const directory = mkdtempSync(join(tmpdir(), 'karnama-phase3-'))
    temporaryDirectories.push(directory)
    const phase3Folder = join(directory, 'phase3-migrations')
    const phase3Meta = join(phase3Folder, 'meta')
    mkdirSync(phase3Meta, { recursive: true })

    for (const fileName of readdirSync(migrationsFolder).filter((name) =>
      /^000[0-3]_.*\.sql$/.test(name)
    )) {
      copyFileSync(join(migrationsFolder, fileName), join(phase3Folder, fileName))
    }
    const journal = JSON.parse(
      readFileSync(join(migrationsFolder, 'meta', '_journal.json'), 'utf8')
    ) as { entries: unknown[] }
    journal.entries = journal.entries.slice(0, 4)
    writeFileSync(join(phase3Meta, '_journal.json'), JSON.stringify(journal))

    const databasePath = join(directory, 'karnama.sqlite')
    const phase3 = openKarnamaDatabase({
      databasePath,
      migrationsFolder: phase3Folder,
      timezoneId: 'Asia/Tehran'
    })
    openedDatabases.push(phase3)
    const taskId = randomUUID()
    const timestamp = Date.now()
    const legacySqlite = new Database(databasePath)
    legacySqlite
      .prepare(
        'INSERT INTO tasks (id, title, description, notes, status, priority, created_at_utc_ms, updated_at_utc_ms) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      )
      .run(taskId, 'داده پیشین', '', '', 'todo', 'medium', timestamp, timestamp)
    legacySqlite.close()
    phase3.close()

    const migrated = openKarnamaDatabase({
      databasePath,
      migrationsFolder,
      timezoneId: 'Asia/Tehran'
    })
    openedDatabases.push(migrated)
    expect(migrated.database.select().from(tasks).where(eq(tasks.id, taskId)).get()).toMatchObject({
      title: 'داده پیشین',
      position: 0
    })
    expect(migrated.database.select().from(taskLinks).all()).toEqual([])
    expect(migrated.database.select().from(attachments).all()).toEqual([])
  })

  it('normalizes and supports link CRUD while rejecting unsafe protocols', () => {
    const { task, service } = createFixture()
    const link = service.createLink({
      taskId: task.id,
      input: { title: 'طرح فیگما', url: ' HTTPS://FIGMA.COM/design/abc ', type: 'figma' }
    })
    expect(link).toMatchObject({
      taskId: task.id,
      title: 'طرح فیگما',
      url: 'https://figma.com/design/abc',
      type: 'figma'
    })
    expect(service.getLinkUrl({ id: link.id })).toBe('https://figma.com/design/abc')

    const updated = service.updateLink({
      id: link.id,
      input: { title: 'نمونه زنده', url: 'http://example.com/demo', type: 'external' }
    })
    expect(updated).toMatchObject({ title: 'نمونه زنده', type: 'external' })
    expect(service.listLinks({ taskId: task.id })).toEqual([updated])

    for (const url of [
      'javascript:alert(1)',
      'file:///etc/passwd',
      'data:text/html,hello',
      'ftp://example.com/file',
      'https://user:pass@example.com/'
    ]) {
      expect(() =>
        service.createLink({ taskId: task.id, input: { title: 'ناامن', url, type: 'external' } })
      ).toThrow(/HTTP|HTTPS|نشانی/)
    }

    service.deleteLink({ id: link.id })
    expect(service.listLinks({ taskId: task.id })).toEqual([])
  })

  it('imports multiple supported image types without exposing storage details', async () => {
    const { task, service, directory, storageDirectory } = createFixture()
    const sourceDirectory = join(directory, 'source-files')
    mkdirSync(sourceDirectory)
    const paths = [
      writeImage(sourceDirectory, 'طرح.png', pngHeader()),
      writeImage(sourceDirectory, 'عکس.jpeg', jpegHeader()),
      writeImage(sourceDirectory, 'نمونه.webp', webpHeader())
    ]

    const imported = await service.importImages({ taskId: task.id }, paths)
    expect(imported.map(({ mimeType }) => mimeType)).toEqual([
      'image/png',
      'image/jpeg',
      'image/webp'
    ])
    expect(imported.map(({ displayName }) => displayName)).toEqual([
      'طرح.png',
      'عکس.jpeg',
      'نمونه.webp'
    ])
    for (const attachment of imported) {
      expect(attachment).not.toHaveProperty('storageRef')
      expect(attachment).not.toHaveProperty('path')
      expect(attachment).not.toHaveProperty('filePath')
      expect((await service.readAttachmentImage({ id: attachment.id })).mimeType).toBe(
        attachment.mimeType
      )
    }
    expect(readdirSync(storageDirectory)).toEqual(
      expect.arrayContaining(
        imported.map(
          ({ id, mimeType }) =>
            `${id}.${mimeType === 'image/png' ? 'png' : mimeType === 'image/jpeg' ? 'jpg' : 'webp'}`
        )
      )
    )
  })

  it('rejects non-image files, mismatched content, and files over 20 MiB', async () => {
    const { task, service, directory, storageDirectory } = createFixture()
    const sourceDirectory = join(directory, 'invalid-files')
    mkdirSync(sourceDirectory)
    const svg = writeImage(sourceDirectory, 'shape.svg', Buffer.from('<svg/>'))
    const mismatch = writeImage(sourceDirectory, 'photo.png', jpegHeader())
    const oversized = writeImage(sourceDirectory, 'large.png', pngHeader())
    truncateSync(oversized, maxImageSizeBytes + 1)

    for (const filePath of [svg, mismatch, oversized]) {
      await expect(service.importImages({ taskId: task.id }, [filePath])).rejects.toMatchObject({
        code: 'invalid_input'
      })
    }
    expect(service.listAttachments({ taskId: task.id })).toEqual([])
    expect(readdirSync(storageDirectory)).toEqual([])
  })

  it('cleans earlier files when one selected image makes the batch fail', async () => {
    const { opened, task, service, directory, storageDirectory } = createFixture()
    const sourceDirectory = join(directory, 'mixed-files')
    mkdirSync(sourceDirectory)
    const valid = writeImage(sourceDirectory, 'valid.png', pngHeader())
    const invalid = writeImage(sourceDirectory, 'invalid.svg', Buffer.from('<svg/>'))

    await expect(service.importImages({ taskId: task.id }, [valid, invalid])).rejects.toMatchObject(
      {
        code: 'invalid_input'
      }
    )
    expect(service.listAttachments({ taskId: task.id })).toEqual([])
    expect(opened.database.select().from(attachments).all()).toEqual([])
    expect(readdirSync(storageDirectory)).toEqual([])
  })

  it('does not overwrite an existing file if a generated attachment ID collides', async () => {
    const { opened, task, service, directory, storageDirectory } = createFixture()
    const sourceDirectory = join(directory, 'collision-files')
    mkdirSync(sourceDirectory)
    const firstPath = writeImage(sourceDirectory, 'first.png', pngHeader())
    const original = await service.importImages({ taskId: task.id }, [firstPath])
    const collisionService = createTaskResourceService(opened.database, storageDirectory, {
      id: () => original[0].id
    })
    const secondPath = writeImage(sourceDirectory, 'second.png', pngHeader())

    await expect(
      collisionService.importImages({ taskId: task.id }, [secondPath])
    ).rejects.toMatchObject({ code: 'storage_error' })
    expect(service.listAttachments({ taskId: task.id })).toHaveLength(1)
    expect((await service.readAttachmentImage({ id: original[0].id })).mimeType).toBe('image/png')
    const row = opened.database
      .select()
      .from(attachments)
      .where(eq(attachments.id, original[0].id))
      .get()!
    expect(readdirSync(storageDirectory)).toEqual([row.storageRef])
  })

  it('reports corrupted data and rejects attachment IDs that could name paths', async () => {
    const { opened, task, service, directory, storageDirectory } = createFixture()
    const sourceDirectory = join(directory, 'source-files')
    mkdirSync(sourceDirectory)
    const [image] = await service.importImages({ taskId: task.id }, [
      writeImage(sourceDirectory, 'screen.png', pngHeader())
    ])
    const row = opened.database
      .select()
      .from(attachments)
      .where(eq(attachments.id, image.id))
      .get()!
    writeFileSync(join(storageDirectory, row.storageRef), Buffer.alloc(image.fileSizeBytes))

    await expect(service.readAttachmentImage({ id: image.id })).rejects.toMatchObject({
      code: 'storage_error'
    })
    await expect(service.readAttachmentImage({ id: '../outside.png' })).rejects.toThrow()
  })

  it('edits descriptions, removes files, and preserves attachments across restart', async () => {
    const { opened, task, service, directory, storageDirectory } = createFixture()
    const sourceDirectory = join(directory, 'source-files')
    mkdirSync(sourceDirectory)
    const imported = await service.importImages({ taskId: task.id }, [
      writeImage(sourceDirectory, 'screen.png', pngHeader())
    ])
    const described = await service.updateAttachmentDescription({
      id: imported[0].id,
      description: 'صفحه ورود'
    })
    expect(described.description).toBe('صفحه ورود')

    const row = opened.database
      .select()
      .from(attachments)
      .where(eq(attachments.id, described.id))
      .get()!
    const managedPath = join(storageDirectory, row.storageRef)
    expect(readdirSync(storageDirectory)).toContain(row.storageRef)

    opened.close()
    const reopened = openKarnamaDatabase({
      databasePath: join(directory, 'karnama.sqlite'),
      migrationsFolder,
      timezoneId: 'Asia/Tehran'
    })
    openedDatabases.push(reopened)
    const restartedService = createTaskResourceService(reopened.database, storageDirectory)
    await restartedService.recoverStorage()
    expect(restartedService.listAttachments({ taskId: task.id })[0].description).toBe('صفحه ورود')
    expect((await restartedService.readAttachmentImage({ id: described.id })).mimeType).toBe(
      'image/png'
    )

    await restartedService.deleteAttachment({ id: described.id })
    expect(readdirSync(storageDirectory)).toEqual([])
    expect(() => readFileSync(managedPath)).toThrow()
  })

  it('retains resources while archived and removes missing rows and orphan files on recovery', async () => {
    const { opened, task, service, directory, storageDirectory } = createFixture()
    const sourceDirectory = join(directory, 'source-files')
    mkdirSync(sourceDirectory)
    const image = await service.importImages({ taskId: task.id }, [
      writeImage(sourceDirectory, 'screen.png', pngHeader())
    ])
    const link = service.createLink({
      taskId: task.id,
      input: { title: 'نمونه', url: 'https://example.com', type: 'external' }
    })
    const work = createWorkService(opened.database)

    work.archiveTask({ id: task.id })
    expect(service.listLinks({ taskId: task.id })).toHaveLength(1)
    expect(service.listAttachments({ taskId: task.id })).toHaveLength(1)
    await expect(
      service.updateAttachmentDescription({ id: image[0].id, description: 'تغییر ممنوع' })
    ).rejects.toMatchObject({ code: 'conflict' })
    expect(() =>
      service.createLink({
        taskId: task.id,
        input: { title: 'تغییر ممنوع', url: 'https://example.com/new', type: 'external' }
      })
    ).toThrow(/بایگانی/)
    expect(() =>
      service.updateLink({
        id: link.id,
        input: { title: 'تغییر ممنوع', url: 'https://example.com/new', type: 'external' }
      })
    ).toThrow(/بایگانی/)
    expect(service.getLinkUrl({ id: link.id })).toBe('https://example.com/')
    work.restoreTask({ id: task.id })

    const row = opened.database
      .select()
      .from(attachments)
      .where(eq(attachments.id, image[0].id))
      .get()!
    unlinkSync(join(storageDirectory, row.storageRef))
    const orphan = join(storageDirectory, `${randomUUID()}.png`)
    const interruptedCopy = join(storageDirectory, `${randomUUID()}.tmp`)
    writeFileSync(orphan, pngHeader())
    writeFileSync(interruptedCopy, pngHeader())
    await service.recoverStorage()
    expect(service.listAttachments({ taskId: task.id })).toEqual([])
    expect(readdirSync(storageDirectory)).toEqual([])
  })

  it('enforces task foreign keys without adding a hard-delete operation', async () => {
    const { opened, task, service, directory } = createFixture()
    const sourceDirectory = join(directory, 'source-files')
    mkdirSync(sourceDirectory)
    const image = await service.importImages({ taskId: task.id }, [
      writeImage(sourceDirectory, 'screen.png', pngHeader())
    ])
    const link = service.createLink({
      taskId: task.id,
      input: { title: 'نمونه', url: 'https://example.com', type: 'external' }
    })
    expect(() =>
      opened.database
        .insert(taskLinks)
        .values({
          id: randomUUID(),
          taskId: randomUUID(),
          url: 'https://example.com/',
          title: 'Invalid task',
          type: 'external',
          createdAtUtcMs: Date.now()
        })
        .run()
    ).toThrow()
    const imageId = randomUUID()
    expect(() =>
      opened.database
        .insert(attachments)
        .values({
          id: imageId,
          taskId: randomUUID(),
          displayName: 'image.png',
          mimeType: 'image/png',
          fileSizeBytes: pngHeader().byteLength,
          description: null,
          createdAtUtcMs: Date.now(),
          storageRef: `${imageId}.png`
        })
        .run()
    ).toThrow()
    expect(
      opened.database.select().from(taskLinks).where(eq(taskLinks.id, link.id)).get()
    ).toBeDefined()
    expect(
      opened.database.select().from(attachments).where(eq(attachments.id, image[0].id)).get()
    ).toBeDefined()
  })
})
