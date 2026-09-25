export interface ProductAnnouncement {
  body: string
  id: string
  level: 'critical' | 'info' | 'warning'
  title: string
  updatedAt: string | Date
}

export interface ProductRelease {
  forceUpdate: boolean
  notes: string
  version: string
}

const MAX_SEEN_ANNOUNCEMENTS = 100
const MAX_CACHED_ANNOUNCEMENTS = 100
const MAX_ANNOUNCEMENT_PREVIEW_LENGTH = 360

export function announcementStorageKey(announcement: Pick<ProductAnnouncement, 'id' | 'updatedAt'>) {
  return `${announcement.id}:${new Date(announcement.updatedAt).toISOString()}`
}

export function parseSeenAnnouncementKeys(raw: string | null) {
  if (!raw)
    return []

  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed))
      return []
    return parsed.filter((value): value is string => typeof value === 'string').slice(-MAX_SEEN_ANNOUNCEMENTS)
  }
  catch {
    return []
  }
}

export function rememberAnnouncementKey(keys: string[], key: string) {
  return [...keys.filter(value => value !== key), key].slice(-MAX_SEEN_ANNOUNCEMENTS)
}

export function parseCachedAnnouncements(raw: string | null): ProductAnnouncement[] {
  if (!raw)
    return []
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed))
      return []
    return parsed.filter((item): item is ProductAnnouncement => !!item
      && typeof item === 'object'
      && typeof item.id === 'string'
      && typeof item.title === 'string'
      && typeof item.body === 'string'
      && typeof item.updatedAt === 'string'
      && ['critical', 'info', 'warning'].includes(item.level))
      .slice(0, MAX_CACHED_ANNOUNCEMENTS)
  }
  catch {
    return []
  }
}

export function mergeCachedAnnouncements(current: ProductAnnouncement[], incoming: ProductAnnouncement[]) {
  const byId = new Map(current.map(item => [item.id, item]))
  for (const item of incoming)
    byId.set(item.id, item)
  return [...byId.values()]
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .slice(0, MAX_CACHED_ANNOUNCEMENTS)
}

export function selectUnseenAnnouncements(announcements: ProductAnnouncement[], seenKeys: string[], limit = 3) {
  const seen = new Set(seenKeys)
  return announcements.filter(announcement => !seen.has(announcementStorageKey(announcement))).slice(0, limit)
}

export function announcementPreview(body: string) {
  const normalized = body.trim()
  if (normalized.length <= MAX_ANNOUNCEMENT_PREVIEW_LENGTH)
    return normalized
  return `${normalized.slice(0, MAX_ANNOUNCEMENT_PREVIEW_LENGTH - 1).trimEnd()}...`
}

export function matchingProductRelease(release: ProductRelease | null, version: string | undefined) {
  return release?.version === version ? release : null
}

export function productUpdateAnnouncementState(status: string, version: string, release: ProductRelease | null) {
  return `${status}:${version}:${release?.forceUpdate ?? false}:${release?.notes ?? ''}`
}
