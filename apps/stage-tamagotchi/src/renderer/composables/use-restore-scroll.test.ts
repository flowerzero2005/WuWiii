import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

const route = reactive({ fullPath: '/settings/first' })

vi.mock('vue-router', () => ({
  useRoute: () => route,
}))

describe('useRestoreScroll', () => {
  beforeEach(() => {
    route.fullPath = '/settings/first'
  })

  it('resets the container when restoration is not explicitly enabled', async () => {
    const { useRestoreScroll } = await import('./use-restore-scroll')
    const container = { scrollTop: 240 } as HTMLElement

    useRestoreScroll(container)
    route.fullPath = '/settings/second'
    await nextTick()
    await nextTick()

    expect(container.scrollTop).toBe(0)
  })

  it('keeps opt-in route restoration available', async () => {
    const { useRestoreScroll } = await import('./use-restore-scroll')
    const container = { scrollTop: 0 } as HTMLElement

    useRestoreScroll(container, { restore: true })
    container.scrollTop = 96
    route.fullPath = '/settings/second'
    await nextTick()
    await nextTick()
    container.scrollTop = 12
    route.fullPath = '/settings/first'
    await nextTick()
    await nextTick()

    expect(container.scrollTop).toBe(96)
  })
})
