import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Edit2, ExternalLink, ImagePlus, Link2, Plus, Save, Trash2, X } from 'lucide-react'
import type { AttachmentDto, TaskLinkDto, TaskLinkInput } from '@shared/contracts/resources'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { unwrapResult } from '@/lib/api'

const emptyLink: TaskLinkInput = { title: '', url: '', type: 'figma' }
const linkTypeLabels = { figma: 'Figma', external: 'لینک خارجی' } as const

type PreviewState = 'loading' | 'ready' | 'error'

export function TaskResources({ taskId, readOnly }: { taskId: string; readOnly: boolean }) {
  const [links, setLinks] = useState<TaskLinkDto[]>([])
  const [attachments, setAttachments] = useState<AttachmentDto[]>([])
  const [linksLoading, setLinksLoading] = useState(true)
  const [attachmentsLoading, setAttachmentsLoading] = useState(true)
  const [linksError, setLinksError] = useState('')
  const [attachmentsError, setAttachmentsError] = useState('')
  const [linkFormId, setLinkFormId] = useState<string | null | undefined>()
  const [linkForm, setLinkForm] = useState<TaskLinkInput>(emptyLink)
  const [linkSaving, setLinkSaving] = useState(false)
  const [imageImporting, setImageImporting] = useState(false)
  const [descriptionId, setDescriptionId] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [descriptionSaving, setDescriptionSaving] = useState(false)
  const [previewStates, setPreviewStates] = useState<Record<string, PreviewState>>({})
  const [preview, setPreview] = useState<AttachmentDto | null>(null)
  const [previewFailed, setPreviewFailed] = useState(false)
  const previewDialog = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    let active = true
    setLinks([])
    setAttachments([])
    setLinksError('')
    setAttachmentsError('')
    setLinksLoading(true)
    setAttachmentsLoading(true)
    setPreviewStates({})

    void window.karnama.resources.links
      .list(taskId)
      .then((result) => {
        if (active) setLinks(unwrapResult(result))
      })
      .catch((error: unknown) => {
        if (active) setLinksError(errorMessage(error, 'خواندن لینک‌ها انجام نشد.'))
      })
      .finally(() => {
        if (active) setLinksLoading(false)
      })

    void window.karnama.resources.attachments
      .list(taskId)
      .then((result) => {
        if (!active) return
        const items = unwrapResult(result)
        setAttachments(items)
        setPreviewStates(Object.fromEntries(items.map(({ id }) => [id, 'loading'])))
      })
      .catch((error: unknown) => {
        if (active) setAttachmentsError(errorMessage(error, 'خواندن تصویرها انجام نشد.'))
      })
      .finally(() => {
        if (active) setAttachmentsLoading(false)
      })

    return () => {
      active = false
    }
  }, [taskId])

  useEffect(() => {
    if (preview) previewDialog.current?.showModal()
    else if (previewDialog.current?.open) previewDialog.current.close()
  }, [preview])

  async function reloadLinks() {
    setLinks(unwrapResult(await window.karnama.resources.links.list(taskId)))
  }

  async function reloadAttachments() {
    const items = unwrapResult(await window.karnama.resources.attachments.list(taskId))
    setAttachments(items)
    setPreviewStates((current) =>
      Object.fromEntries(items.map(({ id }) => [id, current[id] ?? 'loading']))
    )
  }

  function editLink(link: TaskLinkDto | null) {
    setLinksError('')
    setLinkFormId(link?.id ?? null)
    setLinkForm(link ? { title: link.title, url: link.url, type: link.type } : emptyLink)
  }

  async function saveLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (linkFormId === undefined) return
    setLinkSaving(true)
    setLinksError('')
    try {
      if (linkFormId === null) {
        unwrapResult(await window.karnama.resources.links.create(taskId, linkForm))
      } else {
        unwrapResult(await window.karnama.resources.links.update(linkFormId, linkForm))
      }
      setLinkFormId(undefined)
      await reloadLinks()
    } catch (error) {
      setLinksError(errorMessage(error, 'ذخیره لینک انجام نشد.'))
    } finally {
      setLinkSaving(false)
    }
  }

  async function removeLink(linkId: string) {
    setLinksError('')
    try {
      unwrapResult(await window.karnama.resources.links.delete(linkId))
      setLinks((current) => current.filter(({ id }) => id !== linkId))
    } catch (error) {
      setLinksError(errorMessage(error, 'حذف لینک انجام نشد.'))
    }
  }

  async function openLink(linkId: string) {
    setLinksError('')
    try {
      unwrapResult(await window.karnama.resources.links.open(linkId))
    } catch (error) {
      setLinksError(errorMessage(error, 'بازکردن لینک انجام نشد.'))
    }
  }

  async function importImages() {
    setImageImporting(true)
    setAttachmentsError('')
    try {
      const result = unwrapResult(await window.karnama.resources.attachments.import(taskId))
      if (!result.cancelled) await reloadAttachments()
    } catch (error) {
      setAttachmentsError(errorMessage(error, 'افزودن تصویر انجام نشد.'))
    } finally {
      setImageImporting(false)
    }
  }

  function editDescription(attachment: AttachmentDto) {
    setDescriptionId(attachment.id)
    setDescription(attachment.description ?? '')
    setAttachmentsError('')
  }

  async function saveDescription(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!descriptionId) return
    setDescriptionSaving(true)
    setAttachmentsError('')
    try {
      const updated = unwrapResult(
        await window.karnama.resources.attachments.updateDescription(descriptionId, description)
      )
      setAttachments((current) => current.map((item) => (item.id === updated.id ? updated : item)))
      setDescriptionId(null)
    } catch (error) {
      setAttachmentsError(errorMessage(error, 'ذخیره توضیح تصویر انجام نشد.'))
    } finally {
      setDescriptionSaving(false)
    }
  }

  async function removeAttachment(attachmentId: string) {
    setAttachmentsError('')
    try {
      unwrapResult(await window.karnama.resources.attachments.delete(attachmentId))
      setAttachments((current) => current.filter(({ id }) => id !== attachmentId))
      setPreview((current) => (current?.id === attachmentId ? null : current))
    } catch (error) {
      setAttachmentsError(errorMessage(error, 'حذف تصویر انجام نشد.'))
      try {
        await reloadAttachments()
      } catch {
        // Keep the original error visible; the next refresh can reconcile the list.
      }
    }
  }

  function showPreview(attachment: AttachmentDto) {
    setPreviewFailed(false)
    setPreview(attachment)
  }

  return (
    <div className="mt-6 space-y-6 border-t border-line pt-5">
      <section aria-labelledby="task-links-heading">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink" id="task-links-heading">
            لینک‌ها
          </h3>
          {!readOnly && (
            <Button onClick={() => editLink(null)} size="sm" variant="outline">
              <Plus aria-hidden="true" size={14} />
              افزودن لینک
            </Button>
          )}
        </div>

        {linksError && (
          <p className="mb-3 text-xs text-danger" role="alert">
            {linksError}
          </p>
        )}

        {linksLoading ? (
          <p className="text-xs text-muted" role="status">
            در حال خواندن لینک‌ها…
          </p>
        ) : links.length === 0 ? (
          <p className="rounded-lg bg-subtle px-3.5 py-3 text-xs leading-5 text-muted">
            هنوز لینکی برای این تسک ثبت نشده است.
          </p>
        ) : (
          <ul className="max-h-56 divide-y divide-line overflow-y-auto rounded-lg border border-line">
            {links.map((link) => (
              <li className="flex min-w-0 items-center gap-2 px-3 py-2.5" key={link.id}>
                <Link2 aria-hidden="true" className="shrink-0 text-muted" size={15} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-xs font-semibold text-ink">{link.title}</p>
                  <p className="mt-0.5 text-[11px] text-muted">
                    <span className="me-2">{linkTypeLabels[link.type]}</span>
                    <bdi className="block truncate text-left" dir="ltr" title={link.url}>
                      {link.url}
                    </bdi>
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    aria-label={`بازکردن ${link.title}`}
                    onClick={() => void openLink(link.id)}
                    size="icon"
                    variant="ghost"
                  >
                    <ExternalLink aria-hidden="true" size={15} />
                  </Button>
                  {!readOnly && (
                    <>
                      <Button
                        aria-label={`ویرایش ${link.title}`}
                        onClick={() => editLink(link)}
                        size="icon"
                        variant="ghost"
                      >
                        <Edit2 aria-hidden="true" size={15} />
                      </Button>
                      <Button
                        aria-label={`حذف ${link.title}`}
                        onClick={() => void removeLink(link.id)}
                        size="icon"
                        variant="ghost"
                      >
                        <Trash2 aria-hidden="true" className="text-danger" size={15} />
                      </Button>
                    </>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}

        {linkFormId !== undefined && !readOnly && (
          <form
            className="mt-3 space-y-3 rounded-lg border border-line p-3"
            onSubmit={(event) => void saveLink(event)}
          >
            <label className="block space-y-1.5 text-xs font-medium text-muted">
              عنوان لینک
              <Input
                autoFocus
                maxLength={200}
                onChange={(event) =>
                  setLinkForm((current) => ({ ...current, title: event.target.value }))
                }
                required
                value={linkForm.title}
              />
            </label>
            <label className="block space-y-1.5 text-xs font-medium text-muted">
              نشانی لینک
              <Input
                dir="ltr"
                maxLength={2048}
                onChange={(event) =>
                  setLinkForm((current) => ({ ...current, url: event.target.value }))
                }
                placeholder="https://…"
                required
                type="url"
                value={linkForm.url}
              />
            </label>
            <label className="block space-y-1.5 text-xs font-medium text-muted">
              نوع لینک
              <Select
                onChange={(event) =>
                  setLinkForm((current) => ({
                    ...current,
                    type: event.target.value as TaskLinkInput['type']
                  }))
                }
                value={linkForm.type}
              >
                <option value="figma">Figma</option>
                <option value="external">لینک خارجی</option>
              </Select>
            </label>
            <div className="flex justify-end gap-2">
              <Button onClick={() => setLinkFormId(undefined)} size="sm" variant="ghost">
                لغو
              </Button>
              <Button disabled={linkSaving} size="sm" type="submit">
                <Save aria-hidden="true" size={14} />
                {linkSaving ? 'در حال ذخیره…' : 'ذخیره لینک'}
              </Button>
            </div>
          </form>
        )}
      </section>

      <section aria-labelledby="task-images-heading">
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-ink" id="task-images-heading">
            تصویرها
          </h3>
          {!readOnly && (
            <Button
              disabled={imageImporting}
              onClick={() => void importImages()}
              size="sm"
              variant="outline"
            >
              <ImagePlus aria-hidden="true" size={14} />
              {imageImporting ? 'در حال افزودن…' : 'افزودن تصویر'}
            </Button>
          )}
        </div>

        {attachmentsError && (
          <p className="mb-3 text-xs text-danger" role="alert">
            {attachmentsError}
          </p>
        )}

        {attachmentsLoading ? (
          <p className="text-xs text-muted" role="status">
            در حال خواندن تصویرها…
          </p>
        ) : attachments.length === 0 ? (
          <p className="rounded-lg bg-subtle px-3.5 py-3 text-xs leading-5 text-muted">
            هنوز تصویری برای این تسک پیوست نشده است.
          </p>
        ) : (
          <ul className="grid max-h-80 grid-cols-2 gap-2.5 overflow-y-auto pe-1">
            {attachments.map((attachment) => {
              const state = previewStates[attachment.id] ?? 'loading'
              return (
                <li className="min-w-0 rounded-lg border border-line p-2" key={attachment.id}>
                  <button
                    aria-label={`مشاهده بزرگ‌تر: ${attachment.displayName}`}
                    className="group relative block aspect-[4/3] w-full overflow-hidden rounded-md bg-subtle focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus"
                    onClick={() => showPreview(attachment)}
                    type="button"
                  >
                    <img
                      alt=""
                      className={`h-full w-full object-cover transition-opacity ${state === 'ready' ? 'opacity-100' : 'opacity-0'}`}
                      decoding="async"
                      loading="lazy"
                      onError={() =>
                        setPreviewStates((current) => ({ ...current, [attachment.id]: 'error' }))
                      }
                      onLoad={() =>
                        setPreviewStates((current) => ({ ...current, [attachment.id]: 'ready' }))
                      }
                      src={`app://karnama/attachments/${attachment.id}`}
                    />
                    {state !== 'ready' && (
                      <span
                        className="absolute inset-0 grid place-items-center px-2 text-center text-[11px] text-muted"
                        role="status"
                      >
                        {state === 'error' ? 'پیش‌نمایش در دسترس نیست' : 'در حال بارگذاری…'}
                      </span>
                    )}
                  </button>
                  <p
                    className="mt-2 truncate text-xs font-medium text-ink"
                    title={attachment.displayName}
                  >
                    {attachment.displayName}
                  </p>
                  {descriptionId === attachment.id && !readOnly ? (
                    <form
                      className="mt-2 space-y-2"
                      onSubmit={(event) => void saveDescription(event)}
                    >
                      <Textarea
                        maxLength={1000}
                        onChange={(event) => setDescription(event.target.value)}
                        aria-label={`توضیح تصویر ${attachment.displayName}`}
                        placeholder="توضیح تصویر"
                        rows={2}
                        value={description}
                      />
                      <div className="flex justify-end gap-1">
                        <Button onClick={() => setDescriptionId(null)} size="sm" variant="ghost">
                          لغو
                        </Button>
                        <Button disabled={descriptionSaving} size="sm" type="submit">
                          {descriptionSaving ? 'در حال ذخیره…' : 'ذخیره توضیح'}
                        </Button>
                      </div>
                    </form>
                  ) : (
                    <>
                      <p className="mt-1 min-h-5 line-clamp-2 text-[11px] leading-5 text-muted">
                        {attachment.description || 'توضیحی ثبت نشده است.'}
                      </p>
                      {!readOnly && (
                        <div className="mt-1 flex justify-end gap-0.5">
                          <Button
                            aria-label={`ویرایش توضیح ${attachment.displayName}`}
                            onClick={() => editDescription(attachment)}
                            size="icon"
                            variant="ghost"
                          >
                            <Edit2 aria-hidden="true" size={14} />
                          </Button>
                          <Button
                            aria-label={`حذف تصویر ${attachment.displayName}`}
                            onClick={() => void removeAttachment(attachment.id)}
                            size="icon"
                            variant="ghost"
                          >
                            <Trash2 aria-hidden="true" className="text-danger" size={14} />
                          </Button>
                        </div>
                      )}
                    </>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <dialog
        aria-labelledby="task-image-preview-title"
        className="m-auto max-h-[92vh] w-[min(92vw,960px)] max-w-none rounded-xl border border-line bg-panel p-4 text-ink backdrop:bg-black/65"
        onClose={() => setPreview(null)}
        ref={previewDialog}
      >
        {preview && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-4">
              <h3 className="min-w-0 truncate text-sm font-semibold" id="task-image-preview-title">
                {preview.displayName}
              </h3>
              <Button
                aria-label="بستن پیش‌نمایش"
                onClick={() => previewDialog.current?.close()}
                size="icon"
                variant="ghost"
              >
                <X aria-hidden="true" size={17} />
              </Button>
            </div>
            {previewFailed ? (
              <p className="grid min-h-52 place-items-center text-sm text-muted" role="alert">
                تصویر در دسترس نیست یا فایل آن آسیب دیده است.
              </p>
            ) : (
              <img
                alt={preview.description || preview.displayName}
                className="mx-auto max-h-[calc(92vh-6rem)] max-w-full object-contain"
                onError={() => setPreviewFailed(true)}
                src={`app://karnama/attachments/${preview.id}`}
              />
            )}
            {preview.description && (
              <p className="text-sm leading-6 text-muted">{preview.description}</p>
            )}
          </div>
        )}
      </dialog>
    </div>
  )
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}
