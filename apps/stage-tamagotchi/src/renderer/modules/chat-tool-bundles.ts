import type { StreamToolFallbackContextBuilder } from '@proj-airi/stage-ui/stores/llm'
import type {
  BuildStageChatToolBundlesInput,
  ChatToolBlockedBundle,
  ChatToolBundleBlockReason,
  ChatToolBundleBuildResult,
  ChatToolBundleSupportSource,
  ChatToolBundleUnsupportedSource,
  ChatToolIntent,
} from '@proj-airi/stage-ui/tools/chat-tool-bundles'

import {
  buildStageChatToolBundles,
  BUTLER_TASKS_TOOL_BUNDLE_ID,
  detectStageChatToolIntent,
  MCP_DISCOVERY_TOOL_BUNDLE_ID,
  MCP_EXPLICIT_ACTION_TOOL_BUNDLE_ID,
  MCP_PROACTIVE_TOPIC_TOOL_BUNDLE_ID,
  MEMORY_TOOL_BUNDLE_ID,
  VOICE_CALL_TOOL_BUNDLE_ID,
  VISION_SCREEN_TOOL_BUNDLE_ID,
  WEB_SEARCH_TOOL_BUNDLE_ID,
  WIDGETS_TOOL_BUNDLE_ID,
  WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID,
  WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID,
  WORKSPACE_READONLY_TOOL_BUNDLE_ID,
} from '@proj-airi/stage-ui/tools/chat-tool-bundles'

const butlerTasksTools = async () => (await import('../stores/tools/builtin/butler-tasks')).butlerTasksTools()
const mcpDiscoveryTools = async () => (await import('../stores/tools/builtin/mcp')).mcpDiscoveryTools()
const mcpExplicitActionTools = async () => (await import('../stores/tools/builtin/mcp')).mcpExplicitActionTools()
const mcpProactiveTopicTools = async () => (await import('../stores/tools/builtin/mcp')).mcpProactiveTopicTools()
const webSearchTools = async () => (await import('../stores/tools/builtin/web-search')).webSearchTools()
const widgetsTools = async () => (await import('../stores/tools/builtin/widgets')).widgetsTools()
const workspaceTools = async () => (await import('../stores/tools/builtin/command-execution')).commandExecutionTools()
const workspaceReadonlyFallbackContext: StreamToolFallbackContextBuilder = async input => (await import('../stores/tools/builtin/command-execution')).buildWorkspaceReadonlyFallbackContext(input)

export type {
  ChatToolBlockedBundle,
  ChatToolBundleBlockReason,
  ChatToolBundleBuildResult,
  ChatToolBundleSupportSource,
  ChatToolBundleUnsupportedSource,
  ChatToolIntent,
}

export {
  BUTLER_TASKS_TOOL_BUNDLE_ID,
  MCP_DISCOVERY_TOOL_BUNDLE_ID,
  MCP_EXPLICIT_ACTION_TOOL_BUNDLE_ID,
  MCP_PROACTIVE_TOPIC_TOOL_BUNDLE_ID,
  MEMORY_TOOL_BUNDLE_ID,
  VOICE_CALL_TOOL_BUNDLE_ID,
  VISION_SCREEN_TOOL_BUNDLE_ID,
  WEB_SEARCH_TOOL_BUNDLE_ID,
  WIDGETS_TOOL_BUNDLE_ID,
  WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID,
  WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID,
  WORKSPACE_READONLY_TOOL_BUNDLE_ID,
}

export async function buildChatToolBundles(input: Pick<BuildStageChatToolBundlesInput, 'allowButlerTasks' | 'hasPendingWorkspaceEditProposal' | 'messageText' | 'memoryEnabled' | 'memoryTool' | 'memoryTools' | 'previousMessageText' | 'webSearchEnabled' | 'workspaceAccess' | 'voiceCallActive' | 'visionScreenEnabled'> & { voiceCallTools?: () => Promise<import('@xsai/shared-chat').Tool[]>, visionScreenTools?: () => Promise<import('@xsai/shared-chat').Tool[]> }): Promise<ChatToolBundleBuildResult> {
  const intent = detectStageChatToolIntent(input.messageText, {
    hasPendingWorkspaceEditProposal: input.hasPendingWorkspaceEditProposal,
    previousMessageText: input.previousMessageText,
  })
  return buildStageChatToolBundles({
    ...input,
    workspaceAccess: 'readonly',
    butlerTasksTools,
    mcpDiscoveryTools,
    mcpExplicitActionTools,
    mcpProactiveTopicTools,
    webSearchTools,
    widgetsTools,
    voiceCallTools: input.voiceCallTools,
    intentGated: true,
    voiceCallActive: input.voiceCallActive,
    // Chat surfaces are read-only. A write request belongs in Workbench and
    // must not enter a slow read-tool route while trying to invent a write path.
    includeWorkspaceReadonlyByDefault: intent.wantsWorkspaceRead && !intent.wantsWorkspaceEdit,
    workspaceReadonlyFallbackContext,
    workspaceTools,
  })
}
