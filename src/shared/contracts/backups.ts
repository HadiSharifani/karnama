import { z } from 'zod'

export const backupKindSchema = z.enum(['manual', 'automatic', 'pre_restore'])
export const backupFileSchema = z.object({
  path: z.string().min(1).max(200),
  sizeBytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/)
})

export const backupManifestSchema = z.object({
  format: z.literal('karnama-backup'),
  formatVersion: z.literal(1),
  appVersion: z.string().regex(/^\d+\.\d+\.\d+$/),
  createdAtUtc: z.string().datetime({ offset: true }),
  schemaVersion: z.number().int().min(1),
  kind: backupKindSchema,
  components: z.array(z.enum(['database', 'attachments'])).length(2),
  files: z.array(backupFileSchema).min(1).max(50_001)
})

export const backupSummarySchema = z.object({
  id: z.string().uuid(),
  createdAtUtc: z.string().datetime({ offset: true }).nullable(),
  appVersion: z.string().nullable(),
  schemaVersion: z.number().int().nonnegative().nullable(),
  kind: backupKindSchema.nullable(),
  sizeBytes: z.number().int().nonnegative(),
  status: z.enum(['valid', 'unverified', 'invalid'])
})

export const backupProgressSchema = z.object({
  phase: z.enum(['snapshot', 'attachments', 'archive', 'validation', 'restore', 'restart']),
  percent: z.number().min(0).max(100),
  message: z.string().max(160)
})

export const backupTargetSchema = z.object({ id: z.string().uuid() })

export const restoreSelectionSchema = z.object({
  selectionId: z.string().uuid(),
  backup: backupSummarySchema
})

export type BackupKind = z.infer<typeof backupKindSchema>
export type BackupFile = z.infer<typeof backupFileSchema>
export type BackupManifest = z.infer<typeof backupManifestSchema>
export type BackupSummaryDto = z.infer<typeof backupSummarySchema>
export type BackupProgressDto = z.infer<typeof backupProgressSchema>
export type RestoreSelectionDto = z.infer<typeof restoreSelectionSchema>
