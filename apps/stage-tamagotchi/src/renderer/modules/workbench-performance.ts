export const WORKBENCH_PROCESS_EVENT_RENDER_LIMIT = 120
export const WORKBENCH_AUDIT_ENTRY_RENDER_LIMIT = 160
export const WORKBENCH_COMMAND_OUTPUT_PREVIEW_CHAR_LIMIT = 12_000

export interface WorkbenchRenderWindow<T> {
  items: T[]
  limit: number
  omittedCount: number
  totalCount: number
  visibleCount: number
}

export interface BuildWorkbenchRenderWindowInput<T> {
  focusedId?: string
  getId: (item: T) => string
  items: T[]
  limit: number
}

export interface WorkbenchBoundedTextPreview {
  text: string
  truncated: boolean
}

function normalizeRenderLimit(limit: number) {
  if (!Number.isFinite(limit))
    return 0

  return Math.max(0, Math.floor(limit))
}

export function buildWorkbenchRenderWindow<T>(input: BuildWorkbenchRenderWindowInput<T>): WorkbenchRenderWindow<T> {
  const limit = normalizeRenderLimit(input.limit)
  const totalCount = input.items.length

  if (limit === 0) {
    return {
      items: [],
      limit,
      omittedCount: totalCount,
      totalCount,
      visibleCount: 0,
    }
  }

  if (totalCount <= limit) {
    return {
      items: input.items,
      limit,
      omittedCount: 0,
      totalCount,
      visibleCount: totalCount,
    }
  }

  const focusedItem = input.focusedId
    ? input.items.find(item => input.getId(item) === input.focusedId)
    : undefined
  const recentLimit = focusedItem ? Math.max(1, limit - 1) : limit
  const retainedIds = new Set(input.items.slice(-recentLimit).map(input.getId))
  if (focusedItem)
    retainedIds.add(input.getId(focusedItem))

  const items = input.items.filter(item => retainedIds.has(input.getId(item)))

  return {
    items,
    limit,
    omittedCount: totalCount - items.length,
    totalCount,
    visibleCount: items.length,
  }
}

export function limitWorkbenchTextPreview(
  text: string,
  maxChars = WORKBENCH_COMMAND_OUTPUT_PREVIEW_CHAR_LIMIT,
): WorkbenchBoundedTextPreview {
  const limit = normalizeRenderLimit(maxChars)
  if (text.length <= limit) {
    return {
      text,
      truncated: false,
    }
  }

  return {
    text: text.slice(0, limit),
    truncated: true,
  }
}
