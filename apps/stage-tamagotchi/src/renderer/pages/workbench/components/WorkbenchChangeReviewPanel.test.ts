// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import WorkbenchChangeReviewPanel from './WorkbenchChangeReviewPanel.vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    t: (key: string) => ({
      'tamagotchi.stage.workbench.changes.apply-and-preview': 'Apply and Preview',
    }[key] ?? key),
  }),
}))

function changeItem(path: string) {
  return {
    applying: false,
    canApply: true,
    createdAtLabel: 'now',
    detailFacts: [],
    discarding: false,
    hasActions: true,
    id: 'change-1',
    metaLabel: 'Waiting',
    path,
    preview: '<!doctype html>',
    previewLabel: 'Preview',
    previewOpen: false,
    statusClass: [],
    statusLabel: 'Pending',
    summary: 'Prepared change',
  }
}

describe('workbenchChangeReviewPanel', () => {
  it('renders apply-and-preview for index.html proposals and emits when clicked', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const onApplyAndPreview = vi.fn()
    const app = createApp({
      render: () => h(WorkbenchChangeReviewPanel, {
        items: [changeItem('src/index.html')],
        onApplyAndPreview,
        pendingCount: 1,
      }),
    })

    app.mount(host)
    const button = [...host.querySelectorAll('button')]
      .find(button => button.textContent?.includes('Apply and Preview'))

    expect(button).toBeTruthy()
    button?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await nextTick()

    expect(onApplyAndPreview).toHaveBeenCalledTimes(1)
    app.unmount()
    host.remove()
  })
})
