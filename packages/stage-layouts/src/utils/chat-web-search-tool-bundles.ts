import type { StreamToolBundle } from '@proj-airi/stage-ui/stores/llm'
import type { ChatToolBundleBuildResult } from '@proj-airi/stage-ui/tools/chat-tool-bundles'

import {
  buildStageChatToolBundles,
  getDefaultWebSearchTools,
  MEMORY_TOOL_BUNDLE_ID,
  WEB_SEARCH_TOOL_BUNDLE_ID,
} from '@proj-airi/stage-ui/tools/chat-tool-bundles'
import { memoryTool } from '@proj-airi/stage-ui/tools/memory'

export { MEMORY_TOOL_BUNDLE_ID, WEB_SEARCH_TOOL_BUNDLE_ID }

export async function buildStageLayoutChatToolBundleResult(
  messageText: string,
  webSearchEnabled = false,
): Promise<ChatToolBundleBuildResult> {
  return buildStageChatToolBundles({
    messageText,
    memoryTools: async () => [await memoryTool],
    webSearchEnabled,
    webSearchTools: getDefaultWebSearchTools,
  })
}

export async function buildWebSearchToolBundles(messageText: string, webSearchEnabled = false): Promise<StreamToolBundle[]> {
  return (await buildStageLayoutChatToolBundleResult(messageText, webSearchEnabled)).toolBundles
}
