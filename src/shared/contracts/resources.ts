import { z } from 'zod'

export const taskLinkTypes = ['figma', 'external'] as const
export const imageMimeTypes = ['image/png', 'image/jpeg', 'image/webp'] as const
export const maxImageSizeBytes = 20 * 1024 * 1024

export const resourceTaskIdSchema = z.object({ taskId: z.string().uuid() })
export const resourceIdSchema = z.object({ id: z.string().uuid() })

export const taskLinkInputSchema = z.object({
  url: z.string().trim().min(1, 'نشانی لینک را وارد کنید.').max(2048),
  title: z.string().trim().min(1, 'عنوان لینک را وارد کنید.').max(200),
  type: z.enum(taskLinkTypes)
})

export const taskLinkDtoSchema = taskLinkInputSchema.extend({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  url: z.string().min(1).max(2048),
  createdAtUtcMs: z.number().int()
})

export const taskLinkUpdateSchema = resourceIdSchema.extend({
  input: taskLinkInputSchema
})

export const taskLinkCreateSchema = resourceTaskIdSchema.extend({
  input: taskLinkInputSchema
})

export const attachmentDtoSchema = z.object({
  id: z.string().uuid(),
  taskId: z.string().uuid(),
  displayName: z.string().min(1).max(255),
  mimeType: z.enum(imageMimeTypes),
  fileSizeBytes: z.number().int().min(1).max(maxImageSizeBytes),
  description: z.string().max(1000).nullable(),
  createdAtUtcMs: z.number().int()
})

export const attachmentDescriptionInputSchema = resourceIdSchema.extend({
  description: z.string().trim().max(1000)
})

export const attachmentImportResultSchema = z.object({
  cancelled: z.boolean(),
  attachments: z.array(attachmentDtoSchema)
})

export type TaskLinkInput = z.infer<typeof taskLinkInputSchema>
export type TaskLinkDto = z.infer<typeof taskLinkDtoSchema>
export type AttachmentDto = z.infer<typeof attachmentDtoSchema>
export type AttachmentImportResult = z.infer<typeof attachmentImportResultSchema>
