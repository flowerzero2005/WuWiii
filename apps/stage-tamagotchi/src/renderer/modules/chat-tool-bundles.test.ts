import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  buildChatToolBundles,
  BUTLER_TASKS_TOOL_BUNDLE_ID,
  MCP_EXPLICIT_ACTION_TOOL_BUNDLE_ID,
  MEMORY_TOOL_BUNDLE_ID,
  WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID,
  WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID,
  WORKSPACE_READONLY_TOOL_BUNDLE_ID,
} from './chat-tool-bundles'

const toolLoaderMocks = vi.hoisted(() => ({
  butlerTasksTools: vi.fn(async () => [{ function: { name: 'butler_tasks' }, type: 'function' }]),
  mcpDiscoveryTools: vi.fn(async () => []),
  mcpExplicitActionTools: vi.fn(async () => []),
  mcpProactiveTopicTools: vi.fn(async () => []),
  webSearchTools: vi.fn(async () => [{ function: { name: 'intelligent_web_search' }, type: 'function' }]),
  widgetsTools: vi.fn(async () => []),
  workspaceTools: vi.fn(async () => []),
}))

vi.mock('../stores/tools/builtin/butler-tasks', () => ({ butlerTasksTools: toolLoaderMocks.butlerTasksTools }))
vi.mock('../stores/tools/builtin/mcp', () => ({
  mcpDiscoveryTools: toolLoaderMocks.mcpDiscoveryTools,
  mcpExplicitActionTools: toolLoaderMocks.mcpExplicitActionTools,
  mcpProactiveTopicTools: toolLoaderMocks.mcpProactiveTopicTools,
}))
vi.mock('../stores/tools/builtin/web-search', () => ({ webSearchTools: toolLoaderMocks.webSearchTools }))
vi.mock('../stores/tools/builtin/widgets', () => ({ widgetsTools: toolLoaderMocks.widgetsTools }))
vi.mock('../stores/tools/builtin/command-execution', () => ({
  buildWorkspaceReadonlyFallbackContext: vi.fn(async () => []),
  commandExecutionTools: toolLoaderMocks.workspaceTools,
}))

describe('chat tool bundles', () => {
  beforeEach(() => vi.clearAllMocks())

  it('keeps ordinary chat on the local memory path without loading unrelated tool bundles', async () => {
    const memoryTools = vi.fn(async () => [{ function: { name: 'search_memory' }, type: 'function' } as any])
    const result = await buildChatToolBundles({
      memoryEnabled: true,
      memoryTools,
      messageText: '今天心情不错，想和你聊聊',
      webSearchEnabled: true,
    })

    expect(result.toolBundles.map(bundle => bundle.id)).toEqual([MEMORY_TOOL_BUNDLE_ID])
    expect(memoryTools).not.toHaveBeenCalled()
    for (const loader of Object.values(toolLoaderMocks))
      expect(loader).not.toHaveBeenCalled()
  })

  it('exposes the memory bundle whenever long-term memory is enabled', async () => {
    const memoryTool = { function: { name: 'search_memory' }, type: 'function' } as any
    const result = await buildChatToolBundles({
      memoryEnabled: true,
      memoryTool,
      messageText: '今天想随便聊聊',
    })

    expect(result.toolBundles.map(bundle => bundle.id)).toEqual([MEMORY_TOOL_BUNDLE_ID])
  })

  it('gates Butler to explicit task requests', async () => {
    const action = await buildChatToolBundles({ messageText: '明天早上七点叫我' })
    const discussion = await buildChatToolBundles({ messageText: '闹钟好吵，吵死我了' })

    expect(action.requestedToolBundleIds).not.toContain(BUTLER_TASKS_TOOL_BUNDLE_ID)
    expect(discussion.requestedToolBundleIds).not.toContain(BUTLER_TASKS_TOOL_BUNDLE_ID)
    expect(toolLoaderMocks.butlerTasksTools).not.toHaveBeenCalled()
  })

  it('marks an explicit Chinese reminder request for deterministic Butler routing', async () => {
    const result = await buildChatToolBundles({ messageText: '帮我定一个明天中午十二点吃饭的提醒' })

    expect(result.intent.wantsButlerTasks).toBe(true)
    expect(result.toolBundles.find(bundle => bundle.id === BUTLER_TASKS_TOOL_BUNDLE_ID)?.toolChoice).toEqual({
      function: { name: 'butler_tasks' },
      type: 'function',
    })
  })

  it('routes a timed event when the user explicitly asks to record it', async () => {
    const result = await buildChatToolBundles({ messageText: '今天晚上八点钟有个聚餐，帮我记下来' })

    expect(result.intent.wantsButlerTasks).toBe(true)
  })

  it('honors Butler, web-search, and long-term-memory capability gates', async () => {
    const memoryTool = { function: { name: 'search_memory' }, type: 'function' } as any
    const result = await buildChatToolBundles({
      allowButlerTasks: false,
      memoryEnabled: false,
      memoryTool,
      messageText: 'remember this and search the web',
      webSearchEnabled: false,
    })

    expect(result.requestedToolBundleIds).toEqual([])
  })

  it('keeps explicit MCP actions available without eagerly loading them', async () => {
    const result = await buildChatToolBundles({ messageText: 'Use an MCP tool to run this action' })

    expect(result.requestedToolBundleIds).toContain(MCP_EXPLICIT_ACTION_TOOL_BUNDLE_ID)
    expect(toolLoaderMocks.mcpExplicitActionTools).not.toHaveBeenCalled()
    expect(toolLoaderMocks.mcpProactiveTopicTools).not.toHaveBeenCalled()
  })

  it('keeps chat workspace access read-only and skips tools for write requests', async () => {
    const result = await buildChatToolBundles({
      messageText: 'Inspect the repository, run git status, lint and typecheck, then edit and apply package.json',
      workspaceAccess: 'full',
    })

    expect(result.intent).toMatchObject({
      wantsWorkspaceApply: true,
      wantsWorkspaceEdit: true,
      wantsWorkspaceRead: true,
    })
    expect(result.requestedToolBundleIds).toEqual([WORKSPACE_READONLY_TOOL_BUNDLE_ID])
    expect(result.requestedToolBundleIds).not.toContain(WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID)
    expect(result.requestedToolBundleIds).not.toContain(WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID)
    expect(toolLoaderMocks.workspaceTools).not.toHaveBeenCalled()

    const readOnly = await buildChatToolBundles({
      messageText: '查看工作区里的 package.json',
      workspaceAccess: 'full',
    })
    expect(readOnly.requestedToolBundleIds).toContain(WORKSPACE_READONLY_TOOL_BUNDLE_ID)

    const confirmed = await buildChatToolBundles({
      hasPendingWorkspaceEditProposal: true,
      messageText: '确认应用修改',
      workspaceAccess: 'full',
    })
    expect(confirmed.requestedToolBundleIds).toEqual([WORKSPACE_READONLY_TOOL_BUNDLE_ID])
  })
})
