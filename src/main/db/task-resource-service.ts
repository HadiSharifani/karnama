import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, lstat, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises'
import { basename, extname, join } from 'node:path'
import { asc, eq } from 'drizzle-orm'
import { ZodError } from 'zod'
import {
  attachmentDescriptionInputSchema,
  attachmentDtoSchema,
  imageMimeTypes,
  maxImageSizeBytes,
  resourceIdSchema,
  resourceTaskIdSchema,
  taskLinkCreateSchema,
  taskLinkDtoSchema,
  taskLinkInputSchema,
  taskLinkUpdateSchema,
  type AttachmentDto,
  type TaskLinkDto
} from '../../shared/contracts/resources'
import type { KarnamaDatabase } from './client'
import { attachments, taskLinks, tasks } from './schema'

export type ResourceErrorCode = 'invalid_input' | 'not_found' | 'conflict' | 'storage_error'

export class ResourceDomainError extends Error {
  constructor(
    readonly code: ResourceErrorCode,
    message: string
  ) {
    super(message)
  }
}

const mimeByExtension: Record<string, (typeof imageMimeTypes)[number]> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp'
}

const extensionByMime: Record<(typeof imageMimeTypes)[number], string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/webp': '.webp'
}

type ServiceOptions = { now?: () => number; id?: () => string }

export function createTaskResourceService(
  database: KarnamaDatabase,
  storageDirectory: string,
  options: ServiceOptions = {}
) {
  const now = options.now ?? Date.now
  const id = options.id ?? randomUUID

  function requireTask(taskId: string, editable = false) {
    const task = database.select().from(tasks).where(eq(tasks.id, taskId)).get()
    if (!task) throw new ResourceDomainError('not_found', 'تسک پیدا نشد.')
    if (editable && task.archivedAtUtcMs !== null) {
      throw new ResourceDomainError('conflict', 'تسک بایگانی شده و فقط در حالت مشاهده است.')
    }
    return task
  }

  function requireEditableTask(taskId: string) {
    return requireTask(taskId, true)
  }

  function linkDto(linkId: string): TaskLinkDto {
    const link = database.select().from(taskLinks).where(eq(taskLinks.id, linkId)).get()
    if (!link) throw new ResourceDomainError('not_found', 'لینک پیدا نشد.')
    return taskLinkDtoSchema.parse(link)
  }

  function attachmentDto(attachmentId: string): AttachmentDto {
    const attachment = database
      .select()
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .get()
    if (!attachment) throw new ResourceDomainError('not_found', 'تصویر پیدا نشد.')
    return publicAttachment(attachment)
  }

  function listLinks(input: unknown) {
    const { taskId } = resourceTaskIdSchema.parse(input)
    requireTask(taskId)
    return database
      .select()
      .from(taskLinks)
      .where(eq(taskLinks.taskId, taskId))
      .orderBy(asc(taskLinks.createdAtUtcMs), asc(taskLinks.id))
      .all()
      .map((link) => taskLinkDtoSchema.parse(link))
  }

  function createLink(input: unknown) {
    const { taskId, input: rawLink } = taskLinkCreateSchema.parse(input)
    const link = taskLinkInputSchema.parse(rawLink)
    const url = normalizeHttpUrl(link.url)
    requireEditableTask(taskId)
    const linkId = resourceIdSchema.parse({ id: id() }).id
    database
      .insert(taskLinks)
      .values({ ...link, id: linkId, taskId, url, createdAtUtcMs: now() })
      .run()
    return linkDto(linkId)
  }

  function updateLink(input: unknown) {
    const { id: linkId, input: rawLink } = taskLinkUpdateSchema.parse(input)
    const link = taskLinkInputSchema.parse(rawLink)
    const current = database.select().from(taskLinks).where(eq(taskLinks.id, linkId)).get()
    if (!current) throw new ResourceDomainError('not_found', 'لینک پیدا نشد.')
    requireEditableTask(current.taskId)
    database
      .update(taskLinks)
      .set({ ...link, url: normalizeHttpUrl(link.url) })
      .where(eq(taskLinks.id, linkId))
      .run()
    return linkDto(linkId)
  }

  function deleteLink(input: unknown) {
    const { id: linkId } = resourceIdSchema.parse(input)
    const current = database.select().from(taskLinks).where(eq(taskLinks.id, linkId)).get()
    if (!current) throw new ResourceDomainError('not_found', 'لینک پیدا نشد.')
    requireEditableTask(current.taskId)
    database.delete(taskLinks).where(eq(taskLinks.id, linkId)).run()
  }

  function getLinkUrl(input: unknown) {
    const { id: linkId } = resourceIdSchema.parse(input)
    const link = database.select().from(taskLinks).where(eq(taskLinks.id, linkId)).get()
    if (!link) throw new ResourceDomainError('not_found', 'لینک پیدا نشد.')
    return normalizeHttpUrl(link.url)
  }

  function listAttachments(input: unknown) {
    const { taskId } = resourceTaskIdSchema.parse(input)
    requireTask(taskId)
    return database
      .select()
      .from(attachments)
      .where(eq(attachments.taskId, taskId))
      .orderBy(asc(attachments.createdAtUtcMs), asc(attachments.id))
      .all()
      .map(publicAttachment)
  }

  async function importImages(taskIdInput: unknown, filePathsInput: unknown) {
    const { taskId } = resourceTaskIdSchema.parse(taskIdInput)
    if (!Array.isArray(filePathsInput) || filePathsInput.some((path) => typeof path !== 'string')) {
      throw new ResourceDomainError('invalid_input', 'انتخاب تصویرها معتبر نیست.')
    }
    const filePaths = filePathsInput as string[]
    if (!filePaths.length) return []
    requireEditableTask(taskId)
    await mkdir(storageDirectory, { recursive: true })

    const prepared: PreparedAttachment[] = []
    try {
      for (const filePath of filePaths) {
        const displayName = safeDisplayName(basename(filePath))
        const expectedMime = mimeByExtension[extname(displayName).toLowerCase()]
        if (!expectedMime) {
          throw new ResourceDomainError(
            'invalid_input',
            'فقط تصویرهای PNG، JPEG و WebP قابل افزودن هستند.'
          )
        }

        const source = await inspectImageFile(filePath, expectedMime)
        const attachmentId = resourceIdSchema.parse({ id: id() }).id
        const storageRef = `${attachmentId}${extensionByMime[expectedMime]}`
        const stagedRef = `${attachmentId}.tmp`
        const item: PreparedAttachment = {
          id: attachmentId,
          taskId,
          displayName,
          mimeType: expectedMime,
          fileSizeBytes: source.size,
          description: null,
          createdAtUtcMs: now(),
          storageRef,
          stagedRef,
          stageCreated: false,
          finalCreated: false
        }
        prepared.push(item)

        await copyFile(filePath, join(storageDirectory, stagedRef), constants.COPYFILE_EXCL)
        item.stageCreated = true
        const copied = await inspectImageFile(
          join(storageDirectory, stagedRef),
          expectedMime,
          false
        )
        if (copied.size !== source.size) {
          throw new ResourceDomainError('invalid_input', 'فایل هنگام واردکردن تغییر کرد.')
        }
        const bytes = await readFile(join(storageDirectory, stagedRef))
        if (bytes.byteLength !== source.size || bytes.byteLength > maxImageSizeBytes) {
          throw new ResourceDomainError('invalid_input', 'فایل هنگام واردکردن تغییر کرد.')
        }
        const output = await open(join(storageDirectory, storageRef), 'wx')
        item.finalCreated = true
        try {
          await output.writeFile(bytes)
          await output.sync()
        } finally {
          await output.close()
        }
        await unlink(join(storageDirectory, stagedRef))
        item.stageCreated = false
      }

      database.transaction((transaction) => {
        const task = transaction.select().from(tasks).where(eq(tasks.id, taskId)).get()
        if (!task) throw new ResourceDomainError('not_found', 'تسک پیدا نشد.')
        if (task.archivedAtUtcMs !== null) {
          throw new ResourceDomainError('conflict', 'تسک بایگانی شده و فقط در حالت مشاهده است.')
        }
        transaction
          .insert(attachments)
          .values(
            prepared.map(
              ({
                stagedRef: _stagedRef,
                stageCreated: _stageCreated,
                finalCreated: _finalCreated,
                ...attachment
              }) => attachment
            )
          )
          .run()
      })
    } catch (error) {
      await Promise.all(
        prepared
          .flatMap(({ storageRef, stagedRef, finalCreated, stageCreated }) => [
            ...(finalCreated ? [storageRef] : []),
            ...(stageCreated ? [stagedRef] : [])
          ])
          .map((ref) => unlink(join(storageDirectory, ref)).catch(() => undefined))
      )
      // The metadata insert is transactional; startup reconciliation removes any failed remnants.
      if (error instanceof ResourceDomainError || error instanceof ZodError) throw error
      throw new ResourceDomainError('storage_error', 'واردکردن تصویرها انجام نشد.')
    }

    return prepared.map(
      ({
        stagedRef: _stagedRef,
        stageCreated: _stageCreated,
        finalCreated: _finalCreated,
        ...attachment
      }) => attachmentDtoSchema.parse(attachment)
    )
  }

  async function updateAttachmentDescription(input: unknown) {
    const { id: attachmentId, description } = attachmentDescriptionInputSchema.parse(input)
    const attachment = database
      .select()
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .get()
    if (!attachment) throw new ResourceDomainError('not_found', 'تصویر پیدا نشد.')
    requireEditableTask(attachment.taskId)
    database
      .update(attachments)
      .set({ description: description || null })
      .where(eq(attachments.id, attachmentId))
      .run()
    return attachmentDto(attachmentId)
  }

  async function deleteAttachment(input: unknown) {
    const { id: attachmentId } = resourceIdSchema.parse(input)
    const attachment = database
      .select()
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .get()
    if (!attachment) throw new ResourceDomainError('not_found', 'تصویر پیدا نشد.')
    requireEditableTask(attachment.taskId)
    database.delete(attachments).where(eq(attachments.id, attachmentId)).run()
    try {
      await unlink(managedFilePath(attachment.storageRef, attachment.id, storageDirectory))
    } catch (error) {
      if (isMissingFileError(error)) return
      throw new ResourceDomainError(
        'storage_error',
        'اطلاعات تصویر حذف شد، اما پاک‌سازی فایل کامل نشد. با اجرای دوباره برنامه پاک‌سازی تکرار می‌شود.'
      )
    }
  }

  async function readAttachmentImage(input: unknown) {
    const { id: attachmentId } = resourceIdSchema.parse(input)
    const attachment = database
      .select()
      .from(attachments)
      .where(eq(attachments.id, attachmentId))
      .get()
    if (!attachment) throw new ResourceDomainError('not_found', 'تصویر پیدا نشد.')
    const filePath = managedFilePath(attachment.storageRef, attachment.id, storageDirectory)
    try {
      const fileInfo = await lstat(filePath)
      if (!fileInfo.isFile() || fileInfo.size > maxImageSizeBytes) {
        throw new ResourceDomainError('storage_error', 'فایل تصویر در دسترس نیست یا آسیب دیده است.')
      }
      const handle = await open(filePath, 'r')
      const bytes = await handle.readFile().finally(() => handle.close())
      if (
        bytes.byteLength > maxImageSizeBytes ||
        bytes.byteLength !== attachment.fileSizeBytes ||
        detectImageMime(bytes, bytes.byteLength) !== attachment.mimeType
      ) {
        throw new ResourceDomainError('storage_error', 'فایل تصویر در دسترس نیست یا آسیب دیده است.')
      }
      return { mimeType: attachment.mimeType, bytes }
    } catch (error) {
      if (error instanceof ResourceDomainError) throw error
      if (isMissingFileError(error)) {
        throw new ResourceDomainError('not_found', 'فایل تصویر دیگر در دسترس نیست.')
      }
      throw new ResourceDomainError('storage_error', 'خواندن تصویر انجام نشد.')
    }
  }

  async function recoverStorage() {
    await mkdir(storageDirectory, { recursive: true })
    const rows = database.select().from(attachments).all()
    const retained = new Set<string>()
    for (const row of rows) {
      let filePath: string
      try {
        filePath = managedFilePath(row.storageRef, row.id, storageDirectory)
      } catch {
        database.delete(attachments).where(eq(attachments.id, row.id)).run()
        continue
      }
      try {
        if (!(await lstat(filePath)).isFile()) {
          database.delete(attachments).where(eq(attachments.id, row.id)).run()
          continue
        }
        retained.add(row.storageRef)
      } catch (error) {
        if (!isMissingFileError(error)) throw error
        database.delete(attachments).where(eq(attachments.id, row.id)).run()
      }
    }

    for (const entry of await readdir(storageDirectory, { withFileTypes: true })) {
      if (!entry.isFile() && !entry.isSymbolicLink()) continue
      if (!retained.has(entry.name)) {
        await unlink(join(storageDirectory, entry.name)).catch((error: unknown) => {
          if (!isMissingFileError(error)) throw error
        })
      }
    }
  }

  return {
    listLinks,
    createLink,
    updateLink,
    deleteLink,
    getLinkUrl,
    listAttachments,
    importImages,
    updateAttachmentDescription,
    deleteAttachment,
    readAttachmentImage,
    recoverStorage
  }
}

type PreparedAttachment = typeof attachments.$inferInsert & {
  stagedRef: string
  stageCreated: boolean
  finalCreated: boolean
}

function publicAttachment(attachment: typeof attachments.$inferSelect): AttachmentDto {
  return attachmentDtoSchema.parse({
    id: attachment.id,
    taskId: attachment.taskId,
    displayName: attachment.displayName,
    mimeType: attachment.mimeType,
    fileSizeBytes: attachment.fileSizeBytes,
    description: attachment.description,
    createdAtUtcMs: attachment.createdAtUtcMs
  })
}

function normalizeHttpUrl(value: string) {
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    throw new ResourceDomainError('invalid_input', 'نشانی لینک معتبر نیست.')
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    !url.hostname ||
    url.username ||
    url.password
  ) {
    throw new ResourceDomainError('invalid_input', 'فقط لینک‌های HTTP و HTTPS مجاز هستند.')
  }
  return url.toString()
}

function safeDisplayName(value: string) {
  const name = value
    .replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, '')
    .trim()
    .slice(0, 255)
  if (!name) throw new ResourceDomainError('invalid_input', 'نام فایل تصویر معتبر نیست.')
  return name
}

async function inspectImageFile(
  filePath: string,
  expectedMime: (typeof imageMimeTypes)[number],
  checkExtension = true
) {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(filePath, 'r')
    const info = await handle.stat()
    if (!info.isFile() || info.size < 1) {
      throw new ResourceDomainError('invalid_input', 'فایل انتخاب‌شده تصویر معتبری نیست.')
    }
    if (info.size > maxImageSizeBytes) {
      throw new ResourceDomainError('invalid_input', 'حجم تصویر نباید بیش از ۲۰ مگابایت باشد.')
    }
    const header = Buffer.alloc(24)
    const { bytesRead } = await handle.read(header, 0, header.length, 0)
    const actualMime = detectImageMime(header.subarray(0, bytesRead), info.size)
    if (!actualMime || actualMime !== expectedMime) {
      throw new ResourceDomainError(
        'invalid_input',
        'محتوای فایل با فرمت تصویر سازگار نیست یا فایل آسیب دیده است.'
      )
    }
    if (
      checkExtension &&
      mimeByExtension[extname(basename(filePath)).toLowerCase()] !== actualMime
    ) {
      throw new ResourceDomainError('invalid_input', 'پسوند فایل با محتوای تصویر هم‌خوان نیست.')
    }
    return { size: info.size, mimeType: actualMime }
  } catch (error) {
    if (error instanceof ResourceDomainError) throw error
    throw new ResourceDomainError('invalid_input', 'خواندن فایل تصویر انتخاب‌شده ممکن نیست.')
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

function detectImageMime(bytes: Uint8Array, fileSize: number) {
  if (
    bytes.byteLength >= 24 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a &&
    bytes[12] === 0x49 &&
    bytes[13] === 0x48 &&
    bytes[14] === 0x44 &&
    bytes[15] === 0x52
  ) {
    return 'image/png'
  }
  if (bytes.byteLength >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg'
  }
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50 &&
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(4, true) + 8 <=
      fileSize
  ) {
    return 'image/webp'
  }
  return null
}

function managedFilePath(storageRef: string, attachmentId: string, storageDirectory: string) {
  const match =
    /^([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.(?:png|jpg|webp)$/i.exec(
      storageRef
    )
  if (
    !match ||
    match[1].toLowerCase() !== attachmentId.toLowerCase() ||
    basename(storageRef) !== storageRef
  ) {
    throw new ResourceDomainError('storage_error', 'ارجاع داخلی تصویر معتبر نیست.')
  }
  return join(storageDirectory, storageRef)
}

function isMissingFileError(error: unknown) {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT'
}
