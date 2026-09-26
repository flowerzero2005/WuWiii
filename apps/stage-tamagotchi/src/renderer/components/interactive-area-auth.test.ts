import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./InteractiveArea.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('interactive area authentication affordances', () => {
  it('keeps send disabled and exposes account settings in collapsed quick chat', () => {
    expect(source).toContain('v-if="isCollapsed && requiresOfficialCloudLogin"')
    expect(source).toContain('@click.stop="openAccountSettings"')
    expect(source).toContain(':disabled="!canSend"')
  })

  it('treats an interrupted queued send as cancellation instead of a visible error', () => {
    expect(source).toContain('run.controller.signal.aborted || !chatSendLifecycle.isCurrent(run)')
    expect(source).toContain('error instanceof Error && error.name === \'AbortError\'')
    expect(source).toMatch(/catch \(error\) \{[\s\S]*?chatSendLifecycle\.isCurrent\(run\)[\s\S]*?restoreSubmittedDraft\(\)\s+return/)
    expect(source).not.toContain('[QuickChatSend]')
  })

  it('skips tool routing for file-write requests that must move to Workbench', () => {
    expect(source).toContain('toolBundleBuildResult.intent.wantsWorkspaceEdit\n    ? []')
  })

  it('uses public billing surfaces instead of the internal page/widget names', () => {
    expect(source).toContain('sourceSurface: props.surface === \'widget\' ? \'quick-chat\' : \'chat\'')
    expect(source).not.toContain('sourceSurface: props.surface,')
  })
})
