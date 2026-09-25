import { describe, expect, it } from 'vitest'

import {
  announcementPreview,
  announcementStorageKey,
  matchingProductRelease,
  mergeCachedAnnouncements,
  parseCachedAnnouncements,
  parseSeenAnnouncementKeys,
  productUpdateAnnouncementState,
  rememberAnnouncementKey,
  selectUnseenAnnouncements,
} from './product-notices'

describe('desktop product notices', () => {
  it('keeps the newest revision in the local notification center', () => {
    const oldNotice = { id: 'notice-1', title: 'Old', body: 'Old body', level: 'info' as const, updatedAt: '2026-07-30T00:00:00.000Z' }
    const newNotice = { ...oldNotice, title: 'New', updatedAt: '2026-07-31T00:00:00.000Z' }
    const cached = mergeCachedAnnouncements([oldNotice], [newNotice])
    expect(cached).toEqual([newNotice])
    expect(parseCachedAnnouncements(JSON.stringify(cached))).toEqual(cached)
  })

  it('deduplicates announcement revisions and recovers from invalid storage', () => {
    expect(parseSeenAnnouncementKeys('{broken')).toEqual([])
    expect(announcementStorageKey({ id: 'notice-1', updatedAt: '2026-07-31T12:00:00.000Z' }))
      .toBe('notice-1:2026-07-31T12:00:00.000Z')
    expect(rememberAnnouncementKey(['old', 'notice'], 'notice')).toEqual(['old', 'notice'])
  })

  it('keeps notice text compact and only matches exact updater versions', () => {
    expect(announcementPreview(`  ${'a'.repeat(400)}  `)).toHaveLength(362)
    const release = { forceUpdate: true, notes: 'Security update', version: '1.2.3' }
    expect(matchingProductRelease(release, '1.2.3')).toBe(release)
    expect(matchingProductRelease(release, '1.2.4')).toBeNull()
  })

  it('selects unread notices after filtering already-seen revisions', () => {
    const notices = ['seen-1', 'seen-2', 'seen-3', 'unseen'].map(id => ({
      body: id,
      id,
      level: 'info' as const,
      title: id,
      updatedAt: '2026-07-31T12:00:00.000Z',
    }))
    const seen = notices.slice(0, 3).map(announcementStorageKey)
    expect(selectUnseenAnnouncements(notices, seen)).toEqual([notices[3]])
  })

  it('changes update state when matching release policy arrives after the updater event', () => {
    const initial = productUpdateAnnouncementState('available', '1.2.3', null)
    const enriched = productUpdateAnnouncementState('available', '1.2.3', {
      forceUpdate: true,
      notes: 'Security update',
      version: '1.2.3',
    })
    expect(enriched).not.toBe(initial)
  })
})
