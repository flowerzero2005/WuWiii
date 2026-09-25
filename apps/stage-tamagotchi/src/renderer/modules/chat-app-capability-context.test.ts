import {
  BUTLER_TASKS_TOOL_BUNDLE_ID,
  MCP_DISCOVERY_TOOL_BUNDLE_ID,
  MEMORY_TOOL_BUNDLE_ID,
  WEB_SEARCH_TOOL_BUNDLE_ID,
  WIDGETS_TOOL_BUNDLE_ID,
  WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID,
  WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID,
  WORKSPACE_READONLY_TOOL_BUNDLE_ID,
} from '@proj-airi/stage-ui/tools/chat-tool-bundles'
import { describe, expect, it } from 'vitest'

import { CHAT_APP_CAPABILITY_CONTEXT_ID, createChatAppCapabilityContext, ingestChatAppCapabilityContext } from './chat-app-capability-context'

describe('chat app capability context', () => {
  it('always stores runtime capability facts in an explicit session scope', () => {
    const calls: unknown[][] = []
    const store = {
      ingestContextMessage: (...args: unknown[]) => {
        calls.push(args)
        return true
      },
    }
    const context = createChatAppCapabilityContext({ surface: 'chat' })

    expect(ingestChatAppCapabilityContext(store, context, 'session-1')).toBe(true)
    expect(calls).toEqual([[context, { type: 'session', sessionId: 'session-1' }]])
    expect(ingestChatAppCapabilityContext(store, context, '')).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('tells the main model which app capabilities are actually available', () => {
    const context = createChatAppCapabilityContext({
      availableToolBundleIds: [MEMORY_TOOL_BUNDLE_ID, BUTLER_TASKS_TOOL_BUNDLE_ID, MCP_DISCOVERY_TOOL_BUNDLE_ID, WIDGETS_TOOL_BUNDLE_ID, WORKSPACE_READONLY_TOOL_BUNDLE_ID],
      blockedToolBundleIds: [WEB_SEARCH_TOOL_BUNDLE_ID, WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID, WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID],
      memoryEnabled: true,
      speechInputConfigured: true,
      surface: 'quick-chat',
      webSearchEnabled: false,
      workbenchAvailable: true,
    })

    expect(context.contextId).toBe(CHAT_APP_CAPABILITY_CONTEXT_ID)
    expect(context.text).toContain('长期记忆')
    expect(context.text).toContain('提醒、闹钟、计时与待办')
    expect(context.text).toContain('外部连接')
    expect(context.text).toContain('桌面组件')
    expect(context.text).toContain('当前不可用 / Unavailable now: 联网搜索')
    expect(context.text).toContain('没有成功结果')
    expect(context.text).toContain('管家球 -> 更多 -> 工作台')
    expect(context.text).toContain('工作台')
    expect(context.text).toContain('Quick Chat supports fast desktop exchanges')
    expect(context.text).toContain('Current conversation surface: quick-chat')
    expect(context.text).toContain('Long-term memory')
    expect(context.text).toContain('Speech input')
    expect(context.text).toContain('When onboarding a new user')
    expect(context.text.toLowerCase()).not.toContain('git')
    expect(context.text.toLowerCase()).not.toContain('lint')
    expect(context.text.toLowerCase()).not.toContain('typecheck')
  })

  it('reports real voice-call and audible speech state without implying a connection', () => {
    const incoming = createChatAppCapabilityContext({
      speechOutputEnabled: false,
      voiceCallState: 'incoming',
    })
    expect(incoming.text).toContain('当前电话状态 / Current call state: incoming')
    expect(incoming.text).toContain('语音播放 未启用或未配置')
    expect(incoming.text).toContain('用户接听前不得假装已经通话')

    const active = createChatAppCapabilityContext({
      speechOutputEnabled: true,
      voiceCallState: 'active',
    })
    expect(active.text).toContain('当前电话状态 / Current call state: active')
    expect(active.text).toContain('语音播放 已启用')
  })

  it('delegates a pending hangup withdrawal to the main model by meaning', () => {
    const context = createChatAppCapabilityContext({
      surface: 'voice-call',
      voiceCallHangupPending: true,
      voiceCallState: 'active',
    })

    expect(context.text).toContain('`keep_voice_call_open`')
    expect(context.text).toContain('等一下，我还有件事')
    expect(context.text).toContain('不是关键词清单')
    expect(context.text).toContain('只是补充信息但没有撤回结束通话')
  })

  it('states the Workbench boundary for a file write request', () => {
    const context = createChatAppCapabilityContext({
      workbenchAvailable: true,
      workspaceWriteRequested: true,
    })

    expect(context.text).toContain('这个对话表面没有写入权限')
    expect(context.text).toContain('需要打开“管家球 -> 更多 -> 工作台”')
    expect(context.text).toContain('不得说“我现在就写”')
    expect(context.text).toContain('不得模拟进度或虚构后台任务')
    expect(context.text).toContain('Never say you are writing now')
  })

  it('does not direct consumer editions to a hidden Workbench entry', () => {
    const context = createChatAppCapabilityContext({
      workbenchAvailable: false,
      workspaceWriteRequested: true,
    })

    expect(context.text).toContain('当前版本没有可见的工作台入口')
    expect(context.text).toContain('this edition has no visible Workbench entry')
    expect(context.text).not.toContain('立即用符合当前角色的自然口吻说明需要打开“管家球')
  })

  it.each(['chat', 'quick-chat', 'voice-call'] as const)('keeps the same execution truth rules on %s', (surface) => {
    const context = createChatAppCapabilityContext({ surface })

    expect(context.text).toContain(`Current conversation surface: ${surface}`)
    expect(context.text).toContain('没有成功结果')
    expect(context.text).toContain('Without it, nothing has started')
  })
})
