import type { Tool } from '@xsai/shared-chat'

import { describe, expect, it, vi } from 'vitest'

import {
  buildStageChatToolBundles,
  BUTLER_TASKS_TOOL_BUNDLE_ID,
  detectStageChatToolIntent,
  MCP_DISCOVERY_TOOL_BUNDLE_ID,
  MCP_EXPLICIT_ACTION_TOOL_BUNDLE_ID,
  MCP_PROACTIVE_TOPIC_TOOL_BUNDLE_ID,
  MEMORY_TOOL_BUNDLE_ID,
  VOICE_CALL_TOOL_BUNDLE_ID,
  WEB_SEARCH_TOOL_BUNDLE_ID,
  WIDGETS_TOOL_BUNDLE_ID,
  WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID,
  WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID,
  WORKSPACE_READONLY_TOOL_BUNDLE_ID,
} from './chat-tool-bundles'

function makeTool(name: string) {
  return {
    function: { name },
    type: 'function',
  } as Tool
}

const webSearchTool = makeTool('intelligent_web_search')
const memoryTool = makeTool('search_memory')
const butlerTasksTool = makeTool('butler_tasks')
const widgetsTool = makeTool('stage_widgets')
const mcpTool = makeTool('mcp_tool')
const workspaceListDirectoryTool = makeTool('workspace_list_directory')
const workspacePreviewTextEditTool = makeTool('workspace_preview_text_edit')
const workspaceApplyTextEditTool = makeTool('workspace_apply_text_edit')
const voiceCallTool = makeTool('voice_call')

async function resolveBundleTools(result: Awaited<ReturnType<typeof buildStageChatToolBundles>>, bundleId: string) {
  const tools = result.toolBundles.find(bundle => bundle.id === bundleId)?.tools
  if (!tools)
    return []

  return typeof tools === 'function' ? await tools() : tools
}

describe('buildStageChatToolBundles', () => {
  it('keeps cheap intent signals for diagnostics without using them as capability gates', () => {
    expect(detectStageChatToolIntent('write a short story')).toMatchObject({
      wantsMemory: false,
      wantsWorkspaceRead: false,
    })
    expect(detectStageChatToolIntent('do you remember last time')).toMatchObject({ wantsMemory: true })
    expect(detectStageChatToolIntent('save it as story.md')).toMatchObject({
      wantsWorkspaceEdit: true,
      wantsWorkspaceRead: true,
    })
  })

  it('exposes enabled capabilities to the same main-model request while gating high-impact actions', async () => {
    const loaders = {
      butlerTasksTools: vi.fn(async () => [butlerTasksTool]),
      mcpDiscoveryTools: vi.fn(async () => [mcpTool]),
      mcpExplicitActionTools: vi.fn(async () => [mcpTool]),
      mcpProactiveTopicTools: vi.fn(async () => [mcpTool]),
      memoryTools: vi.fn(async () => [memoryTool]),
      webSearchTools: vi.fn(async () => [webSearchTool]),
      widgetsTools: vi.fn(async () => [widgetsTool]),
      workspaceTools: vi.fn(async () => [
        workspaceListDirectoryTool,
        workspacePreviewTextEditTool,
        workspaceApplyTextEditTool,
      ]),
    }
    const result = await buildStageChatToolBundles({
      ...loaders,
      memoryEnabled: true,
      messageText: 'write a short poem about the sea',
      webSearchEnabled: true,
      workspaceAccess: 'full',
    })

    expect(result.requestedToolBundleIds).toEqual([
      WORKSPACE_READONLY_TOOL_BUNDLE_ID,
      WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID,
      WEB_SEARCH_TOOL_BUNDLE_ID,
      MEMORY_TOOL_BUNDLE_ID,
      BUTLER_TASKS_TOOL_BUNDLE_ID,
      WIDGETS_TOOL_BUNDLE_ID,
      MCP_DISCOVERY_TOOL_BUNDLE_ID,
      MCP_PROACTIVE_TOPIC_TOOL_BUNDLE_ID,
    ])
    expect(result.toolBundles.map(bundle => bundle.id)).toEqual(result.requestedToolBundleIds)
    expect(result.toolBundles.every(bundle => bundle.toolChoice === undefined)).toBe(true)
    for (const loader of Object.values(loaders))
      expect(loader).not.toHaveBeenCalled()
  })

  it.each([
    ['set an alarm for 8:30', { type: 'function', function: { name: 'butler_tasks' } }],
    ['my alarm is so noisy', undefined],
    ['闹钟好吵，吵死我了', undefined],
  ])('always exposes Butler and forces only explicit task commands: %s', async (messageText, toolChoice) => {
    const butlerTasksTools = vi.fn(async () => [butlerTasksTool])
    const result = await buildStageChatToolBundles({ butlerTasksTools, messageText })

    expect(result.requestedToolBundleIds).toEqual([BUTLER_TASKS_TOOL_BUNDLE_ID])
    expect(result.toolBundles[0]?.toolChoice).toEqual(toolChoice)
    expect(butlerTasksTools).not.toHaveBeenCalled()
  })

  it('lets trusted runtime policy suppress Butler tools', async () => {
    const butlerTasksTools = vi.fn(async () => [butlerTasksTool])
    const result = await buildStageChatToolBundles({
      allowButlerTasks: false,
      butlerTasksTools,
      messageText: 'set an alarm for 8:30',
    })

    expect(result.requestedToolBundleIds).toEqual([])
    expect(butlerTasksTools).not.toHaveBeenCalled()
  })

  it('exposes memory whenever long-term memory is enabled', async () => {
    const memoryTools = vi.fn(async () => [memoryTool])
    const enabledConversation = await buildStageChatToolBundles({
      memoryEnabled: true,
      memoryTools,
      messageText: 'tell me a short story',
    })
    const explicitRecall = await buildStageChatToolBundles({
      memoryEnabled: true,
      memoryTools,
      messageText: 'ordinary chat without recall wording',
      intentGated: true,
    })
    const disabledRecall = await buildStageChatToolBundles({
      memoryEnabled: false,
      memoryTools,
      messageText: 'do you remember last time',
    })

    expect(enabledConversation.requestedToolBundleIds).toEqual([MEMORY_TOOL_BUNDLE_ID])
    expect(explicitRecall.requestedToolBundleIds).toEqual([MEMORY_TOOL_BUNDLE_ID])
    expect(disabledRecall.requestedToolBundleIds).toEqual([])
    expect(memoryTools).not.toHaveBeenCalled()
  })

  it('uses workspace access and pending proposal state as the workspace gates', async () => {
    const workspaceTools = vi.fn(async () => [
      workspaceListDirectoryTool,
      workspacePreviewTextEditTool,
      workspaceApplyTextEditTool,
    ])
    const disabled = await buildStageChatToolBundles({ messageText: 'read package.json', workspaceTools })
    const readonly = await buildStageChatToolBundles({
      messageText: 'ordinary chat',
      workspaceAccess: 'readonly',
      workspaceTools,
    })
    const full = await buildStageChatToolBundles({
      messageText: 'ordinary chat',
      workspaceAccess: 'full',
      workspaceTools,
    })
    const pendingWithoutConfirmation = await buildStageChatToolBundles({
      hasPendingWorkspaceEditProposal: true,
      messageText: 'ordinary chat',
      workspaceAccess: 'full',
      workspaceTools,
    })
    const apply = await buildStageChatToolBundles({
      hasPendingWorkspaceEditProposal: true,
      messageText: '\u8BF7\u5E94\u7528\u521A\u624D\u7684\u4FEE\u6539',
      workspaceAccess: 'full',
      workspaceTools,
    })

    expect(disabled.requestedToolBundleIds).toEqual([])
    expect(readonly.requestedToolBundleIds).toEqual([WORKSPACE_READONLY_TOOL_BUNDLE_ID])
    expect(full.requestedToolBundleIds).toEqual([
      WORKSPACE_READONLY_TOOL_BUNDLE_ID,
      WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID,
    ])
    expect(pendingWithoutConfirmation.requestedToolBundleIds).toEqual([
      WORKSPACE_READONLY_TOOL_BUNDLE_ID,
      WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID,
    ])
    expect(apply.requestedToolBundleIds).toEqual([
      WORKSPACE_READONLY_TOOL_BUNDLE_ID,
      WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID,
      WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID,
    ])
    expect(workspaceTools).not.toHaveBeenCalled()
  })

  it('exposes generic MCP execution only for a fresh explicit MCP action request', async () => {
    const mcpExplicitActionTools = vi.fn(async () => [mcpTool])
    const ordinary = await buildStageChatToolBundles({
      mcpExplicitActionTools,
      messageText: 'tell me a story',
    })
    const explicit = await buildStageChatToolBundles({
      mcpExplicitActionTools,
      messageText: 'use the MCP tool to run this action',
    })

    expect(ordinary.requestedToolBundleIds).toEqual([])
    expect(explicit.requestedToolBundleIds).toEqual([MCP_EXPLICIT_ACTION_TOOL_BUNDLE_ID])
    expect(mcpExplicitActionTools).not.toHaveBeenCalled()
  })

  it('uses only the web-search toggle to expose search', async () => {
    const webSearchTools = vi.fn(async () => [webSearchTool])
    const enabledConversation = await buildStageChatToolBundles({
      messageText: 'tell me a short story',
      webSearchEnabled: true,
      webSearchTools,
    })
    const disabledLookup = await buildStageChatToolBundles({
      messageText: 'look up current news',
      webSearchEnabled: false,
      webSearchTools,
    })

    expect(enabledConversation.requestedToolBundleIds).toEqual([WEB_SEARCH_TOOL_BUNDLE_ID])
    expect(disabledLookup.requestedToolBundleIds).toEqual([])
    expect(webSearchTools).not.toHaveBeenCalled()
  })

  it('gates optional capabilities by intent and preserves active voice calls', async () => {
    const loaders = {
      butlerTasksTools: vi.fn(async () => [butlerTasksTool]),
      mcpDiscoveryTools: vi.fn(async () => [mcpTool]),
      mcpProactiveTopicTools: vi.fn(async () => [mcpTool]),
      voiceCallTools: vi.fn(async () => [voiceCallTool]),
      webSearchTools: vi.fn(async () => [webSearchTool]),
      widgetsTools: vi.fn(async () => [widgetsTool]),
    }

    const ordinary = await buildStageChatToolBundles({
      ...loaders,
      intentGated: true,
      messageText: 'tell me a story',
      webSearchEnabled: true,
    })
    expect(ordinary.requestedToolBundleIds).toEqual([])

    const search = await buildStageChatToolBundles({
      ...loaders,
      intentGated: true,
      messageText: 'search the latest news',
      webSearchEnabled: true,
    })
    expect(search.requestedToolBundleIds).toEqual([WEB_SEARCH_TOOL_BUNDLE_ID])
    expect(search.intent.wantsWebSearch).toBe(true)

    const call = await buildStageChatToolBundles({
      ...loaders,
      intentGated: true,
      messageText: 'call me for a voice call',
    })
    expect(call.requestedToolBundleIds).toEqual([VOICE_CALL_TOOL_BUNDLE_ID])
    expect(call.intent.wantsVoiceCall).toBe(true)

    const activeCall = await buildStageChatToolBundles({
      ...loaders,
      intentGated: true,
      messageText: 'hello',
      voiceCallActive: true,
    })
    expect(activeCall.requestedToolBundleIds).toEqual([VOICE_CALL_TOOL_BUNDLE_ID])
  })

  it('keeps implementations lazy until the selected bundle is resolved', async () => {
    const butlerTasksTools = vi.fn(async () => [butlerTasksTool])
    const result = await buildStageChatToolBundles({ butlerTasksTools, messageText: 'hello' })

    expect(butlerTasksTools).not.toHaveBeenCalled()
    await expect(resolveBundleTools(result, BUTLER_TASKS_TOOL_BUNDLE_ID)).resolves.toEqual([butlerTasksTool])
    expect(butlerTasksTools).toHaveBeenCalledOnce()
  })
})
