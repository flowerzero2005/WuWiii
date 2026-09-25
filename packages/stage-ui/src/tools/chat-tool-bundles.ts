import type { Tool } from '@xsai/shared-chat'

import type { StreamToolBundle, StreamToolFallbackContextBuilder, ToolBundleSupportedSource, ToolBundleUnsupportedSource } from '../stores/llm'

import { buildWebSearchFallbackContext, intelligentWebSearch } from './web-search'

export const WORKSPACE_READONLY_TOOL_BUNDLE_ID = 'workspace-readonly'
export const WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID = 'workspace-edit-preview'
export const WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID = 'workspace-edit-apply'
export const WEB_SEARCH_TOOL_BUNDLE_ID = 'web-search'
export const MEMORY_TOOL_BUNDLE_ID = 'memory'
export const BUTLER_TASKS_TOOL_BUNDLE_ID = 'butler-tasks'
export const WIDGETS_TOOL_BUNDLE_ID = 'widgets'
export const MCP_DISCOVERY_TOOL_BUNDLE_ID = 'mcp-discovery'
export const MCP_EXPLICIT_ACTION_TOOL_BUNDLE_ID = 'mcp-explicit-action'
export const MCP_PROACTIVE_TOPIC_TOOL_BUNDLE_ID = 'mcp-proactive-topic'
export const VOICE_CALL_TOOL_BUNDLE_ID = 'voice-call'

export interface ChatToolIntent {
  wantsButlerTasks: boolean
  wantsWorkspaceRead: boolean
  wantsWorkspaceEdit: boolean
  wantsWorkspaceApply: boolean
  isWorkspaceCapabilityQuestion: boolean
  wantsWebSearch: boolean
  requiresWebSearch: boolean
  wantsVoiceCall: boolean
  wantsMemory: boolean
  wantsWidgets: boolean
  wantsMcpDiscovery: boolean
  wantsMcpExplicitAction: boolean
  wantsProactiveTopicOpening: boolean
}

export type ChatToolBundleBlockReason = 'tools-disabled' | 'bundle-known-unsupported'
export type ChatToolBundleSupportSource = ToolBundleSupportedSource
export type ChatToolBundleUnsupportedSource = Exclude<ToolBundleUnsupportedSource, 'tools-disabled'>

export interface ChatToolBlockedBundle {
  bundleId: string
  reason: ChatToolBundleBlockReason
  unsupportedSource?: ChatToolBundleUnsupportedSource
}

export interface ChatToolBundleBuildResult {
  intent: ChatToolIntent
  toolBundles: StreamToolBundle[]
  requestedToolBundleIds: string[]
  blockedToolBundleIds: string[]
  blockedToolBundles: ChatToolBlockedBundle[]
}

type MaybePromise<T> = T | Promise<T>
type ToolLoader = () => MaybePromise<Tool[]>

export interface StageChatToolLoaders {
  workspaceReadonlyFallbackContext?: StreamToolFallbackContextBuilder
  workspaceTools?: ToolLoader
  webSearchTools?: ToolLoader
  memoryTool?: Tool | null
  memoryTools?: ToolLoader
  butlerTasksTools?: ToolLoader
  widgetsTools?: ToolLoader
  mcpDiscoveryTools?: ToolLoader
  mcpExplicitActionTools?: ToolLoader
  mcpProactiveTopicTools?: ToolLoader
  voiceCallTools?: ToolLoader
}

export interface BuildStageChatToolBundlesInput extends StageChatToolLoaders {
  allowButlerTasks?: boolean
  messageText: string
  /** Long-term memory is an explicit user capability; the model still decides when to call it. */
  memoryEnabled?: boolean
  hasPendingWorkspaceEditProposal?: boolean
  includeWorkspaceReadonlyByDefault?: boolean
  previousMessageText?: string
  /** Gate optional capabilities by detected user intent when enabled. */
  intentGated?: boolean
  /** Keep voice-call tools available for an already active call session. */
  voiceCallActive?: boolean
  webSearchEnabled?: boolean
  workspaceAccess?: 'readonly' | 'full'
}

const workspaceReadonlyToolNames = new Set([
  'workspace_list_directory',
  'workspace_search',
  'workspace_read_file',
  'workspace_git_status',
  'workspace_git_diff',
  'workspace_typecheck',
  'workspace_lint',
])

const workspaceEditPreviewToolNames = new Set([
  'workspace_preview_text_edit',
  'workspace_search_and_preview_text_edit',
])

const workspaceEditApplyToolNames = new Set([
  'workspace_apply_text_edit',
])

const workspaceSubjectPattern = /\b(?:workspace|repository|repo|source\s+code|codebase|directory|desktop|files?|folders?|documents?|txt|markdown|typecheck|lint|package\.json)\b|\bgit\s+(?:status|diff)\b|[\w@.-]+[\\/][\w@(). /-]+|\.(?:[cm]?[jt]sx?|vue|json|ya?ml|toml|md|txt|rs|swift|kt)\b|\u5DE5\u4F5C\u533A|\u4ED3\u5E93|\u6E90\u7801|\u9879\u76EE\u4EE3\u7801|\u684C\u9762|\u76EE\u5F55|\u6587\u4EF6|\u6587\u6863|\u6587\u672C|\u8DEF\u5F84|\u7C7B\u578B\u68C0\u67E5|\u7F16\u8BD1\u9519\u8BEF/i
const workspaceReadActionPattern = /\b(?:read|open|inspect|check|search|find|list|show|diff|status|typecheck|lint)\b|\u8BFB\u53D6|\u8BFB\u4E00\u4E0B|\u6253\u5F00|\u67E5\u770B|\u770B\u770B|\u770B\u4E0B|\u68C0\u67E5|\u641C\u7D22|\u67E5\u627E|\u5217\u51FA|\u5BF9\u6BD4/i
const workspaceEditActionPattern = /\b(?:edit|patch|fix|implement|refactor|replace|insert|remove|save|write|create|update)\b|apply\s+(?:the\s+)?change|\u4FEE\u6539|\u4FEE\u590D|\u5B9E\u73B0|\u91CD\u6784|\u66FF\u6362|\u63D2\u5165|\u5220\u9664|\u4FDD\u5B58|\u5199|\u521B\u5EFA|\u66F4\u65B0|\u5E94\u7528\u4FEE\u6539/i
const workspaceCapabilityQuestionPattern = /(?:can\s+you|are\s+you\s+able\s+to|do\s+you\s+have\s+access\s+to|\u80FD\u4E0D\u80FD|\u80FD\u5426|\u53EF\u4EE5|\u662F\u5426).{0,32}(?:workspace|repo|files?|folders?|code|\u5DE5\u4F5C\u533A|\u4ED3\u5E93|\u6587\u4EF6|\u76EE\u5F55|\u4EE3\u7801)/i
const workspaceApplyPattern = /apply|confirm|proceed|save|write|\u786E\u8BA4|\u5E94\u7528|\u4FDD\u5B58|\u5199\u5165|\u7EE7\u7EED/i
const pendingWorkspaceConfirmationPatterns = [
  /^(?:please\s+)?(?:ok(?:ay)?|yes|confirm|apply|proceed|save|continue)(?:\s+(?:the\s+)?(?:pending|proposed)\s+(?:change|changes|edit|edits)|\s+(?:the\s+)?(?:change|changes|edit|edits))?(?:\s+please)?[.!?]*$/i,
  /^\u8BF7?(?:\u597D|\u53EF\u4EE5|\u786E\u8BA4|\u5E94\u7528|\u4FDD\u5B58|\u5199\u5165|\u7EE7\u7EED)(?:\u521A\u624D|\u4E0A\u8FF0|\u8FD9\u4E2A|\u8BE5)?\u7684?(?:\u5E94\u7528)?(?:\u4FEE\u6539|\u6539\u52A8|\u53D8\u66F4|\u7F16\u8F91|\u63D0\u6848|\u6587\u4EF6)?(?:\u5427|\u5462)?[.?!\u3002\uFF01\uFF1F]*$/,
]
const memoryPattern = /do\s+you\s+remember|can\s+you\s+remember|search\s+(?:your\s+)?memory|recall\s+(?:what|when|where|my)|what\s+did\s+i\s+(?:say|tell)|\u4F60\u8FD8\u8BB0\u5F97|\u8FD8\u8BB0\u5F97\u5417|\u5E2E\u6211\u56DE\u5FC6|\u641C\u7D22\u8BB0\u5FC6|\u4E4B\u524D\u6211\u8BF4|\u6211\u8BF4\u8FC7|\u4E0A\u6B21(?:\u6211|\u4F60).{0,12}(?:\u8BF4|\u544A\u8BC9|\u63D0\u5230)|\u4E0A\u6B21.{0,12}(?:\u662F\u4EC0\u4E48|\u53EB\u4EC0\u4E48|\u53BB\u4E86\u54EA|\u505A\u4E86\u4EC0\u4E48)/i
const memoryFollowUpPattern = /^(?:and\s+)?(?:what|when|where|which|who)\b|^(?:what|which)\s+was\s+(?:it|that)|^(?:tell\s+me\s+more|that\s+one|the\s+same\s+one)\b|^(?:\u90A3|\u8FD9|\u521A\u624D)[\u4E2A\u4EF6\u5BB6\u6B21]?|\u662F\u4EC0\u4E48|\u53EB\u4EC0\u4E48|\u4EC0\u4E48\u65F6\u5019|\u54EA\u4E2A|\u54EA\u91CC/i
const widgetSubjectPattern = /\bwidgets?\b|\boverlay\b|weather\s+card|\u5C0F\u7EC4\u4EF6|\u6302\u4EF6|\u684C\u9762\u7EC4\u4EF6|\u5929\u6C14\u5361/i
const widgetActionPattern = /\b(?:open|show|add|hide|close|remove|move|resize|configure|change|toggle)\b|\u6253\u5F00|\u663E\u793A|\u6DFB\u52A0|\u5173\u95ED|\u9690\u85CF|\u5220\u9664|\u79FB\u52A8|\u8C03\u6574|\u8BBE\u7F6E|\u5207\u6362|\u6539/i
const mcpDiscoveryPattern = /(?:what|which|show|list).{0,24}(?:mcp|external|plugin).{0,12}tools?|available\s+(?:external\s+|plugin\s+|mcp\s+)?tools|(?:mcp|external|plugin)\s+tool\s+list|(?:\u67E5\u770B|\u5217\u51FA|\u6709|\u54EA\u4E9B|\u4EC0\u4E48).{0,12}(?:mcp|\u5916\u90E8|\u63D2\u4EF6).{0,8}\u5DE5\u5177|(?:mcp|\u5916\u90E8|\u63D2\u4EF6)\u5DE5\u5177\u5217\u8868/i
const mcpActionPattern = /(?:call|use|run|invoke|\u8C03\u7528|\u4F7F\u7528|\u6267\u884C).{0,24}(?:mcp|plugin\s+tool|external\s+tool|\u63D2\u4EF6|\u5916\u90E8\u5DE5\u5177)/i
const mcpFollowUpActionPattern = /^(?:use|call|run|invoke)\s+(?:it|that|the\s+(?:first|second|last)\s+one)|^(?:\u7528|\u8C03\u7528|\u6267\u884C)(?:\u5B83|\u8FD9\u4E2A|\u90A3\u4E2A|\u7B2C[\u4E00\u4E8C\u4E09\d]+\u4E2A)/i
const butlerSubjectPattern = /\b(?:reminder|alarm|timer|todo)\b|\u63D0\u9192|\u95F9\u949F|\u8BA1\u65F6|\u5F85\u529E/i
const butlerActionPattern = /\b(?:set|create|add|schedule|remind)\b|\u5E2E\u6211|\u7ED9\u6211|\u5B9A(?:\u4E00?\u4E2A)?|\u8BBE(?:\u7F6E|\u4E2A)?|\u521B\u5EFA|\u6DFB\u52A0|\u53EB\u6211|\u63D0\u9192\u6211/i
const butlerTimedActionPattern = /(?:\d{1,2}\s*(?:[:：]\s*\d{1,2}|点)|今天|明天|早上|上午|中午|下午|晚上).{0,32}(?:定好|记下来|安排(?:一下)?)/
const webSearchExplicitPattern = /\b(?:search|look\s*up|browse(?:\s+the)?\s+(?:web|internet)|find\s+(?:online|on\s+the\s+web)|google)\b|\u641C\u7D22|\u67E5\u8BE2|\u8054\u7F51|\u7F51\u4E0A|\u67E5\u4E00\u4E0B/i
const webSearchFreshnessPattern = /\b(?:latest|current|today|now|recent|news|weather|forecast|price|score|schedule|release|ranking|review)\b|\u6700\u65B0|\u5F53\u524D|\u4ECA\u5929|\u73B0\u5728|\u6700\u8FD1|\u65B0\u95FB|\u5929\u6C14|\u9884\u62A5|\u4EF7\u683C|\u6BD4\u5206|\u8D5B\u7A0B|\u6392\u540D|\u8BC4\u8BBA/i
const webSearchQuestionPattern = /[?\uFF1F]|\b(?:what|which|where|when|who|how|tell|show|find)\b|\u4EC0\u4E48|\u54EA\u91CC|\u544A\u8BC9/i
const webSearchFollowUpPattern = /^(?:and\s+)?(?:what|which|where|when|who|how)\b|^(?:\u90A3|\u8FD9|\u521A\u624D)[\u4E2A\u4EF6\u5BB6\u6B21]?\u5462?[?\uFF1F]?$/i
const voiceCallPattern = /\b(?:voice\s+call|phone\s+call|telephone|call\s+me|ring\s+me|invite\s+me|cancel\s+(?:the\s+)?call|end\s+(?:the\s+)?call|hang\s*up)\b|\u8BED\u97F3\u901A\u8BDD|\u6253\u7535\u8BDD|\u6765\u7535|\u6302\u65AD|\u53D6\u6D88\u901A\u8BDD|\u901A\u8BDD\u7ED3\u675F/i
const workspaceContinuationPattern = /^(?:continue|again|same\s+file|that\s+file|keep\s+going|\u7EE7\u7EED|\u518D\u770B\u770B|\u518D\u770B\u4E00\u4E0B|\u90A3\u4E2A\u6587\u4EF6|\u8FD9\u4E2A\u6587\u4EF6)(?:\u5427|\u5462)?[.!?\u3002\uFF01\uFF1F]*$/i
const widgetFollowUpPattern = /^(?:hide|close|remove|move|resize|change|toggle)\s+(?:it|that)|^\u628A?(?:\u5B83|\u8FD9\u4E2A|\u90A3\u4E2A)?(?:\u5173\u6389|\u5173\u4E86|\u9690\u85CF|\u5220\u9664|\u79FB\u52A8|\u8C03\u6574|\u6539)/i
const voiceCallFollowUpPattern = /^(?:yes|okay|ok|sure|\u597D|\u53EF\u4EE5|\u7EE7\u7EED|\u53D6\u6D88|\u6302\u65AD)/i
const neutralChatToolIntent: ChatToolIntent = {
  isWorkspaceCapabilityQuestion: false,
  requiresWebSearch: false,
  wantsMcpDiscovery: false,
  wantsMcpExplicitAction: false,
  wantsMemory: false,
  wantsButlerTasks: false,
  wantsProactiveTopicOpening: false,
  wantsWebSearch: false,
  wantsWidgets: false,
  wantsVoiceCall: false,
  wantsWorkspaceApply: false,
  wantsWorkspaceEdit: false,
  wantsWorkspaceRead: false,
}

function createNeutralChatToolIntent(): ChatToolIntent {
  return { ...neutralChatToolIntent }
}

function filterToolsByName(tools: Tool[], allowedNames: Set<string>) {
  return tools.filter(tool => allowedNames.has(tool.function.name))
}

function createToolLoader(loadTools: ToolLoader, allowedNames?: Set<string>) {
  return async () => {
    const tools = await loadTools()
    return allowedNames ? filterToolsByName(tools, allowedNames) : tools
  }
}

function appendToolBundle(
  result: ChatToolBundleBuildResult,
  bundle: StreamToolBundle,
) {
  result.requestedToolBundleIds.push(bundle.id)
  result.toolBundles.push(bundle)
}

export function detectStageChatToolIntent(messageText: string, options?: {
  hasPendingWorkspaceEditProposal?: boolean
  previousMessageText?: string
}): ChatToolIntent {
  const text = messageText.trim()
  if (!text)
    return createNeutralChatToolIntent()

  const previousText = options?.previousMessageText?.trim() ?? ''
  const hasPreviousWorkspaceIntent = workspaceSubjectPattern.test(previousText)
    && (workspaceReadActionPattern.test(previousText) || workspaceEditActionPattern.test(previousText))
  const hasWorkspaceSubject = workspaceSubjectPattern.test(text)
  const isWorkspaceCapabilityQuestion = hasWorkspaceSubject && workspaceCapabilityQuestionPattern.test(text)
  const wantsPendingWorkspaceApply = Boolean(options?.hasPendingWorkspaceEditProposal)
    && pendingWorkspaceConfirmationPatterns.some(pattern => pattern.test(text))
  const continuesWorkspaceAction = hasPreviousWorkspaceIntent
    && workspaceContinuationPattern.test(text)
  const wantsWorkspaceEdit = (hasWorkspaceSubject && workspaceEditActionPattern.test(text)) || wantsPendingWorkspaceApply
  const wantsWorkspaceApply = wantsPendingWorkspaceApply
    || (wantsWorkspaceEdit && workspaceApplyPattern.test(text))
  const wantsWorkspaceRead = !isWorkspaceCapabilityQuestion
    && ((hasWorkspaceSubject && workspaceReadActionPattern.test(text)) || wantsWorkspaceEdit || continuesWorkspaceAction)
  const wantsMemory = memoryPattern.test(text)
    || (memoryPattern.test(previousText) && memoryFollowUpPattern.test(text))
  const hasWebSearchQuestion = webSearchQuestionPattern.test(text)
  const wantsWebSearch = webSearchExplicitPattern.test(text)
    || (webSearchFreshnessPattern.test(text) && hasWebSearchQuestion)
    || (webSearchFreshnessPattern.test(previousText) && webSearchFollowUpPattern.test(text))
  const requiresWebSearch = webSearchFreshnessPattern.test(text) && hasWebSearchQuestion
  const wantsMcpExplicitAction = mcpActionPattern.test(text)
    || ((mcpDiscoveryPattern.test(previousText) || mcpActionPattern.test(previousText)) && mcpFollowUpActionPattern.test(text))
  const wantsWidgets = (widgetSubjectPattern.test(text) && widgetActionPattern.test(text))
    || (widgetSubjectPattern.test(previousText) && widgetFollowUpPattern.test(text))
  const wantsVoiceCall = voiceCallPattern.test(text)
    || (voiceCallPattern.test(previousText) && voiceCallFollowUpPattern.test(text))
  return {
    isWorkspaceCapabilityQuestion,
    requiresWebSearch,
    wantsMcpDiscovery: mcpDiscoveryPattern.test(text),
    wantsMcpExplicitAction,
    wantsMemory,
    wantsButlerTasks: (butlerSubjectPattern.test(text) && butlerActionPattern.test(text)) || butlerTimedActionPattern.test(text),
    wantsProactiveTopicOpening: false,
    wantsWebSearch,
    wantsWidgets,
    wantsVoiceCall,
    wantsWorkspaceApply,
    wantsWorkspaceEdit,
    wantsWorkspaceRead,
  }
}

export async function getDefaultWebSearchTools() {
  return [await intelligentWebSearch]
}

export async function buildStageChatToolBundles(input: BuildStageChatToolBundlesInput): Promise<ChatToolBundleBuildResult> {
  const intent = detectStageChatToolIntent(input.messageText, {
    hasPendingWorkspaceEditProposal: input.hasPendingWorkspaceEditProposal,
    previousMessageText: input.previousMessageText,
  })
  const result: ChatToolBundleBuildResult = {
    blockedToolBundleIds: [],
    blockedToolBundles: [],
    intent,
    requestedToolBundleIds: [],
    toolBundles: [],
  }

  // The main model receives the capability-gated catalog and uses toolChoice=auto.
  // Irreversible actions still require a fresh deterministic confirmation gate.
  if (input.workspaceTools && input.workspaceAccess && (!input.intentGated || input.includeWorkspaceReadonlyByDefault === true || intent.wantsWorkspaceRead || intent.wantsWorkspaceEdit)) {
    appendToolBundle(result, {
      fallbackContext: input.workspaceReadonlyFallbackContext,
      id: WORKSPACE_READONLY_TOOL_BUNDLE_ID,
      tools: createToolLoader(input.workspaceTools, workspaceReadonlyToolNames),
    })
  }

  if (input.workspaceTools && input.workspaceAccess === 'full' && (!input.intentGated || intent.wantsWorkspaceEdit)) {
    appendToolBundle(result, {
      id: WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID,
      tools: createToolLoader(input.workspaceTools, workspaceEditPreviewToolNames),
    })

    if (input.hasPendingWorkspaceEditProposal && intent.wantsWorkspaceApply) {
      appendToolBundle(result, {
        id: WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID,
        tools: createToolLoader(input.workspaceTools, workspaceEditApplyToolNames),
      })
    }
  }

  if (input.webSearchEnabled && input.webSearchTools && (!input.intentGated || intent.wantsWebSearch || intent.requiresWebSearch)) {
    appendToolBundle(result, {
      fallbackContext: buildWebSearchFallbackContext,
      id: WEB_SEARCH_TOOL_BUNDLE_ID,
      tools: createToolLoader(input.webSearchTools),
    })
  }

  // Memory lookup is local and non-billable. Expose it whenever long-term
  // memory is enabled, then let the main model decide whether the current turn
  // benefits from an explicit lookup.
  if (input.memoryEnabled && (input.memoryTool || input.memoryTools)) {
    appendToolBundle(result, {
      id: MEMORY_TOOL_BUNDLE_ID,
      tools: input.memoryTool ? [input.memoryTool] : createToolLoader(input.memoryTools!),
    })
  }

  if (input.allowButlerTasks !== false && (!input.intentGated || intent.wantsButlerTasks) && input.butlerTasksTools) {
    appendToolBundle(result, {
      id: BUTLER_TASKS_TOOL_BUNDLE_ID,
      toolChoice: intent.wantsButlerTasks ? { type: 'function', function: { name: 'butler_tasks' } } : undefined,
      tools: createToolLoader(input.butlerTasksTools),
    })
  }

  if (input.voiceCallTools && (!input.intentGated || input.voiceCallActive || intent.wantsVoiceCall)) {
    appendToolBundle(result, {
      id: VOICE_CALL_TOOL_BUNDLE_ID,
      tools: createToolLoader(input.voiceCallTools),
    })
  }

  if (input.widgetsTools && (!input.intentGated || intent.wantsWidgets)) {
    appendToolBundle(result, {
      id: WIDGETS_TOOL_BUNDLE_ID,
      tools: createToolLoader(input.widgetsTools),
    })
  }

  if (input.mcpDiscoveryTools && (!input.intentGated || intent.wantsMcpDiscovery)) {
    appendToolBundle(result, {
      id: MCP_DISCOVERY_TOOL_BUNDLE_ID,
      tools: createToolLoader(input.mcpDiscoveryTools),
    })
  }

  if (input.mcpExplicitActionTools && intent.wantsMcpExplicitAction) {
    appendToolBundle(result, {
      id: MCP_EXPLICIT_ACTION_TOOL_BUNDLE_ID,
      tools: createToolLoader(input.mcpExplicitActionTools),
    })
  }

  if (input.mcpProactiveTopicTools && (!input.intentGated || intent.wantsProactiveTopicOpening)) {
    appendToolBundle(result, {
      id: MCP_PROACTIVE_TOPIC_TOOL_BUNDLE_ID,
      tools: createToolLoader(input.mcpProactiveTopicTools),
    })
  }

  return result
}
