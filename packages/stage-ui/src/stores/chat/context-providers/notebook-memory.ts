import type { EmbedProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import type { ChatHistoryItem, ContextMessage } from '../../../types/chat'
import type { NotebookEntry, NotebookMemoryScope } from '../../character/notebook'
import type { MemoryReferenceTrace } from '../memory-manager'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { embedMany } from '@xsai/embed'
import { nanoid } from 'nanoid'
import { toast } from 'vue-sonner'

import { OFFICIAL_CLOUD_EMBED_MODEL } from '../../../libs/providers/providers/official-cloud'
import { useAuthStore } from '../../auth'
import { useOfficialPricingStore } from '../../official-pricing'
import { useProvidersStore } from '../../providers'
import { useMemorySettingsStore } from '../../settings/memory'
import { useMemoryAdvancedSettingsStore } from '../../settings/memory-advanced'
import { useOfficialCapabilityConsentStore } from '../../settings/official-capability-consent'
import { useMemoryManager } from '../memory-manager'

const CONTEXT_WHITESPACE_RE = /\s+/g
const PERSONA_GROWTH_MEMORY_PREFIX_RE = /^人格成长记忆：/
const PERSONA_GROWTH_CANDIDATE_PREFIX_RE = /^人格成长候选（未固化）：/
const REPLY_FEEDBACK_BULLET_PREFIX_RE = /^-\s*/
const TRAILING_COLON_RE = /[:：]$/

export const NOTEBOOK_MEMORY_CONTEXT_ID = 'notebook-memory'
const REPLY_FEEDBACK_SUMMARY_MEMORY_KIND = 'reply-feedback-summary'
const DIRECT_MEMORY_FULL_ENTRY_LIMIT = 12
const DIRECT_MEMORY_CONTEXT_CHAR_BUDGET = 10_000
const DIRECT_MEMORY_CATALOG_CHAR_BUDGET = 7_000
const MAX_EMBEDDING_CANDIDATES = 40
const SEMANTIC_MEMORY_TIMEOUT_MS = 2500
const SEMANTIC_FALLBACK_NOTICE_COOLDOWN_MS = 60_000
let lastSemanticFallbackNoticeAt = 0

function notifySemanticMemoryFallback() {
  const now = Date.now()
  if (now - lastSemanticFallbackNoticeAt < SEMANTIC_FALLBACK_NOTICE_COOLDOWN_MS)
    return

  lastSemanticFallbackNoticeAt = now
  const language = typeof navigator === 'undefined' ? 'en' : navigator.language.toLowerCase()
  toast.warning(language.startsWith('zh')
    ? '官方语义记忆暂时不可用，已改用本地关键词记忆。'
    : 'Official semantic memory is unavailable. The current resident is using local keyword recall instead.')
}

function isEmbedding(value: unknown): value is number[] {
  return Array.isArray(value) && value.length > 0 && value.every(item => typeof item === 'number' && Number.isFinite(item))
}

export function cosineSimilarity(left: number[], right: number[]) {
  if (left.length === 0 || left.length !== right.length)
    return 0

  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!
    leftMagnitude += left[index]! ** 2
    rightMagnitude += right[index]! ** 2
  }

  const denominator = Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude)
  return denominator > 0 ? dot / denominator : 0
}

function isSemanticMemoryCandidate(entry: NotebookEntry) {
  const memoryKind = entry.metadata?.memoryKind
  return entry.kind !== 'diary'
    && memoryKind !== 'emotion-thread'
    && memoryKind !== 'persona-growth-candidate'
    && memoryKind !== REPLY_FEEDBACK_SUMMARY_MEMORY_KIND
    && entry.text.trim().length > 0
}

async function blendSemanticNotebookMemories(
  query: string,
  keywordMemories: NotebookEntry[],
  entries: NotebookEntry[],
  notebookStore: {
    entryBelongsToCurrentScope?: (entry: NotebookEntry) => boolean
    entryBelongsToMemoryScope?: (entry: NotebookEntry, scope?: Partial<NotebookMemoryScope>) => boolean
  },
  scope: Partial<NotebookMemoryScope> | undefined,
  limit: number,
) {
  if (!Array.isArray(entries))
    return keywordMemories

  // Long-term-memory recall is a free, optional context feature.  Generating
  // embeddings through the official cloud provider here creates a second
  // billable model request before every chat turn (and can stall first-token
  // / TTS playback while the request times out).  Existing locally persisted
  // embeddings are still usable by callers that provide their own ranker, but
  // this path intentionally falls back to deterministic local keyword recall.
  // NOTICE: do not re-enable remote embedMany here without an explicit
  // non-billable provider contract and a latency budget enforced at the call
  // site.
  const settings = useMemoryAdvancedSettingsStore()
  // Remote embeddings are deliberately disabled until a free provider is
  // available; this keeps memory search non-billable and off the chat latency
  // critical path while preserving the existing local keyword result.
  const allowRemoteEmbedding = false as boolean
  if (!allowRemoteEmbedding || !settings.settings.enableSemanticSearch || !settings.settings.enableOfficialCloudEmbedding)
    return keywordMemories

  const candidates = entries
    .filter(entry => notebookStore.entryBelongsToMemoryScope?.(entry, scope) ?? notebookStore.entryBelongsToCurrentScope?.(entry) ?? true)
    .filter(isSemanticMemoryCandidate)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, MAX_EMBEDDING_CANDIDATES)
  if (candidates.length === 0)
    return keywordMemories

  try {
    const pricingStore = useOfficialPricingStore()
    const consentStore = useOfficialCapabilityConsentStore()
    if (!pricingStore.snapshot)
      await pricingStore.refresh()
    const quote = consentStore.getQuote('embedding')
    if (consentStore.needsConsent(useAuthStore().user?.id, 'embedding', quote))
      return keywordMemories

    const missing = candidates.filter(entry => entry.embeddingModel !== OFFICIAL_CLOUD_EMBED_MODEL || !isEmbedding(entry.embedding))
    const provider = await useProvidersStore().getProviderInstance<EmbedProviderWithExtraOptions<string, any>>('official-cloud-embed')
    const input = [query, ...missing.map(entry => entry.text.slice(0, 2000))]
    const abortController = new AbortController()
    const timeout = setTimeout(() => abortController.abort(), SEMANTIC_MEMORY_TIMEOUT_MS)
    const result = await embedMany({
      ...provider.embed(OFFICIAL_CLOUD_EMBED_MODEL),
      abortSignal: abortController.signal,
      input,
    }).finally(() => clearTimeout(timeout))
    const queryEmbedding = result.embeddings[0]
    if (!isEmbedding(queryEmbedding))
      return keywordMemories

    missing.forEach((entry, index) => {
      const embedding = result.embeddings[index + 1]
      if (!isEmbedding(embedding))
        return
      entry.embedding = embedding
      entry.embeddingModel = OFFICIAL_CLOUD_EMBED_MODEL
    })

    const keywordRanks = new Map(keywordMemories.map((entry, index) => [entry.id, 1 - index / Math.max(1, keywordMemories.length)]))
    return candidates
      .flatMap((entry) => {
        if (!isEmbedding(entry.embedding) || entry.embeddingModel !== OFFICIAL_CLOUD_EMBED_MODEL)
          return []
        const semanticScore = Math.max(0, Math.min(1, (cosineSimilarity(queryEmbedding, entry.embedding) + 1) / 2))
        const keywordScore = keywordRanks.get(entry.id) ?? 0
        return [{ entry, score: semanticScore * 0.7 + keywordScore * 0.3 }]
      })
      .filter(item => item.score >= 0.35 || keywordRanks.has(item.entry.id))
      .sort((left, right) => right.score - left.score)
      .slice(0, limit)
      .map(item => item.entry)
  }
  catch (error) {
    console.warn('[NotebookMemory] Official embedding unavailable; using keyword recall.', error)
    notifySemanticMemoryFallback()
    return keywordMemories
  }
}

export interface SearchRelevantNotebookMemoriesOptions {
  entries?: NotebookEntry[]
  referenceTrace?: MemoryReferenceTrace
  scope?: Partial<NotebookMemoryScope>
}

/**
 * Runs the shared long-term memory recall path. Recall is local and free by
 * default; the legacy remote embedding branch is intentionally disabled so a
 * chat turn can never trigger a hidden paid request.
 */
export async function searchRelevantNotebookMemories(
  query: string,
  limit = 5,
  options?: SearchRelevantNotebookMemoriesOptions,
): Promise<NotebookEntry[]> {
  const normalizedQuery = typeof query === 'string' ? query.trim() : ''
  if (!normalizedQuery)
    return []

  if (!useMemorySettingsStore().settings.enabled)
    return []

  const boundedLimit = Math.max(1, Math.min(Math.floor(limit) || 5, 10))
  const memoryManager = useMemoryManager()
  const { useCharacterNotebookStore } = await import('../../character/notebook')
  const notebookStore = useCharacterNotebookStore()
  const scope = notebookStore.resolveMemoryScope(options?.scope ?? options?.referenceTrace)
  const entries = options?.entries ?? await notebookStore.getMemoryEntriesForScope(scope)

  const keywordMemories = memoryManager.searchRelevantMemories(normalizedQuery, boundedLimit, {
    entries,
    referenceTrace: options?.referenceTrace,
    scope,
  })
  return blendSemanticNotebookMemories(normalizedQuery, keywordMemories, entries, notebookStore, scope, boundedLimit)
}

export interface NotebookMemoryContextOptions {
  characterId?: string
  personaCardId?: string
  referenceSessionId?: string
  referenceSource?: string
  referenceUserMessageId?: string
  includeReplyFeedbackMemories?: boolean
  scope?: Partial<NotebookMemoryScope>
}

function compactContextLine(text: string) {
  return text.replace(CONTEXT_WHITESPACE_RE, ' ').trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeMemoryTextForContext(text: string) {
  return compactContextLine(text)
    .replace(PERSONA_GROWTH_MEMORY_PREFIX_RE, '')
    .replace(PERSONA_GROWTH_CANDIDATE_PREFIX_RE, '')
}

function getNodeSummaryCues(value: unknown) {
  if (!isRecord(value))
    return []

  return Object.values(value)
    .map(item => typeof item === 'string' ? compactContextLine(item) : '')
    .filter(Boolean)
}

function getFeatureTimelineCues(value: unknown) {
  if (!isRecord(value))
    return []

  return Object.entries(value)
    .map(([feature, info]) => {
      const detail = isRecord(info) && typeof info.text === 'string'
        ? compactContextLine(info.text)
        : ''

      return detail ? `${feature}: ${detail}` : compactContextLine(feature)
    })
    .filter(Boolean)
}

function formatReplyFeedbackCue(text: string) {
  const calibrationLines = text
    .split('\n')
    .map(line => compactContextLine(line.replace(REPLY_FEEDBACK_BULLET_PREFIX_RE, '')))
    .filter(line => line.length > 0)
    .filter(line => !line.startsWith('当前人格的回复评价总结'))
    .filter(line => !line.startsWith('样本数：'))
    .filter(line => !TRAILING_COLON_RE.test(line))
    .slice(0, 8)

  if (calibrationLines.length === 0)
    return ''

  return `- 私下表达校准：${calibrationLines.join('；')}`
}

function formatMemoryCue(memory: NotebookEntry) {
  if (memory.metadata?.memoryKind === REPLY_FEEDBACK_SUMMARY_MEMORY_KIND)
    return formatReplyFeedbackCue(memory.text)

  const primaryText = sanitizeMemoryTextForContext(memory.text)
  if (!primaryText)
    return ''

  const sourceCreatedAt = typeof memory.metadata?.sourceCreatedAt === 'number'
    ? memory.metadata.sourceCreatedAt
    : undefined
  const cueLines = [
    `memoryId=${memory.id}`,
    ...(typeof memory.metadata?.memoryKey === 'string' ? [`memoryKey=${memory.metadata.memoryKey}`] : []),
    primaryText,
    ...(typeof memory.metadata?.memoryContext === 'string' ? [`context=${compactContextLine(memory.metadata.memoryContext)}`] : []),
    ...(Array.isArray(memory.metadata?.involvedPeople) ? [`involvedPeople=${memory.metadata.involvedPeople.filter((person): person is string => typeof person === 'string').map(compactContextLine).join(', ')}`] : []),
    ...(typeof memory.metadata?.antecedent === 'string' ? [`antecedent=${compactContextLine(memory.metadata.antecedent)}`] : []),
    ...(typeof memory.metadata?.outcome === 'string' ? [`outcome=${compactContextLine(memory.metadata.outcome)}`] : []),
    `sourceTime=${sourceCreatedAt === undefined ? 'unknown' : new Date(sourceCreatedAt).toISOString()}`,
    `recordedAt=${new Date(memory.createdAt).toISOString()}`,
  ]
  const nodeSummaryCues = getNodeSummaryCues(memory.metadata?.nodeSummaries).slice(0, 3)
  const featureTimelineCues = getFeatureTimelineCues(memory.metadata?.featureTimeline).slice(0, 3)

  if (nodeSummaryCues.length > 0)
    cueLines.push(`前情补充：${nodeSummaryCues.join('；')}`)

  if (featureTimelineCues.length > 0)
    cueLines.push(`稳定线索：${featureTimelineCues.join('；')}`)

  return `- ${cueLines.join('\n  ')}`
}

function formatCompactMemoryCue(memory: NotebookEntry) {
  const primaryText = sanitizeMemoryTextForContext(memory.text).slice(0, 320)
  if (!primaryText)
    return ''

  const memoryKey = typeof memory.metadata?.memoryKey === 'string'
    ? `memoryKey=${memory.metadata.memoryKey}`
    : undefined
  const sourceTime = typeof memory.metadata?.sourceCreatedAt === 'number'
    ? new Date(memory.metadata.sourceCreatedAt).toISOString()
    : 'unknown'
  const tags = memory.tags?.map(compactContextLine).filter(Boolean).slice(0, 6).join(', ')
  return `- memoryId=${memory.id}${memoryKey ? ` | ${memoryKey}` : ''} | ${primaryText}${tags ? ` | tags=${tags}` : ''} | sourceTime=${sourceTime}`
}

function takeLinesWithinBudget(lines: string[], budget: number) {
  const selected: string[] = []
  let used = 0
  for (const line of lines) {
    const cost = line.length + 1
    if (used + cost > budget) {
      if (selected.length === 0)
        selected.push(line.slice(0, budget))
      break
    }
    selected.push(line)
    used += cost
  }
  return selected
}

/**
 * Creates a context message containing relevant memories from the notebook.
 * This context is injected before each chat message to provide memory awareness.
 *
 * @param userMessage - The current user message
 * @param recentMessages - Optional recent conversation history for context-aware search
 */
export async function createNotebookMemoryContext(
  userMessage: string,
  recentMessages?: ChatHistoryItem[],
  options?: NotebookMemoryContextOptions,
): Promise<ContextMessage> {
  // Input validation
  if (!userMessage || typeof userMessage !== 'string' || userMessage.trim().length === 0) {
    return {
      id: nanoid(),
      contextId: NOTEBOOK_MEMORY_CONTEXT_ID,
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: '',
      createdAt: Date.now(),
    }
  }

  // 构建搜索查询
  let searchQuery = userMessage

  // 如果用户消息很短（少于10个字符），且提供了对话历史，则基于上下文搜索
  if (userMessage.trim().length < 10 && recentMessages && recentMessages.length > 0) {
    // 提取最近3轮对话的关键内容
    const contextMessages = recentMessages
      .slice(-6) // 最近3轮（用户+AI各3条）
      .filter(msg => msg.role === 'user' || msg.role === 'assistant')
      .map((msg) => {
        if (typeof msg.content === 'string') {
          return msg.content
        }
        if (Array.isArray(msg.content)) {
          return msg.content
            .map(part => (typeof part === 'string' ? part : (part && typeof part === 'object' && 'text' in part ? String(part.text ?? '') : '')))
            .join(' ')
        }
        return ''
      })
      .filter(text => text.length > 0)
      .join(' ')

    // 组合当前消息和上下文
    searchQuery = `${contextMessages} ${userMessage}`.slice(0, 500) // 限制长度
  }

  // Search for relevant memories
  const memoryScope = {
    ...options?.scope,
    characterId: options?.characterId ?? options?.scope?.characterId,
    personaCardId: options?.personaCardId ?? options?.scope?.personaCardId,
  }
  const { useCharacterNotebookStore } = await import('../../character/notebook')
  const notebookStore = useCharacterNotebookStore()
  const resolvedScope = notebookStore.resolveMemoryScope(memoryScope)
  const scopedEntries = await notebookStore.getMemoryEntriesForScope(resolvedScope)
  const directMemories = scopedEntries
    .filter(isSemanticMemoryCandidate)
    .sort((left, right) => right.createdAt - left.createdAt)
  const relevantMemories = await searchRelevantNotebookMemories(searchQuery, 5, {
    entries: scopedEntries,
    referenceTrace: {
      referenceSessionId: options?.referenceSessionId,
      referenceSource: options?.referenceSource ?? 'context-injection',
      referenceUserMessageId: options?.referenceUserMessageId,
    },
    scope: resolvedScope,
  })
  const memoryManager = useMemoryManager()
  const includeReplyFeedbackMemories = options?.includeReplyFeedbackMemories ?? true
  const replyFeedbackMemories = includeReplyFeedbackMemories
    ? await memoryManager.getReplyFeedbackSummaryMemories(memoryScope)
    : []
  const directDetailedMemories = directMemories.length <= DIRECT_MEMORY_FULL_ENTRY_LIMIT
    ? [
        ...directMemories,
        ...relevantMemories.filter(memory => !directMemories.some(directMemory => directMemory.id === memory.id)),
      ]
    : relevantMemories
  const detailedMemories = [
    ...directDetailedMemories,
    ...replyFeedbackMemories.filter(memory => !relevantMemories.some(relevantMemory => relevantMemory.id === memory.id)),
  ]

  if (directMemories.length === 0 && detailedMemories.length === 0) {
    // Return empty context if no relevant memories found
    return {
      id: nanoid(),
      contextId: NOTEBOOK_MEMORY_CONTEXT_ID,
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: '',
      createdAt: Date.now(),
    }
  }

  const compactMemoryLines = directMemories.length > DIRECT_MEMORY_FULL_ENTRY_LIMIT
    ? takeLinesWithinBudget(directMemories.map(formatCompactMemoryCue).filter(Boolean), DIRECT_MEMORY_CATALOG_CHAR_BUDGET)
    : []
  const detailedMemoryLines = takeLinesWithinBudget(
    detailedMemories.map(formatMemoryCue).filter(Boolean),
    compactMemoryLines.length > 0
      ? DIRECT_MEMORY_CONTEXT_CHAR_BUDGET - DIRECT_MEMORY_CATALOG_CHAR_BUDGET
      : DIRECT_MEMORY_CONTEXT_CHAR_BUDGET,
  )

  if (detailedMemoryLines.length === 0 && compactMemoryLines.length === 0) {
    return {
      id: nanoid(),
      contextId: NOTEBOOK_MEMORY_CONTEXT_ID,
      strategy: ContextUpdateStrategy.ReplaceSelf,
      text: '',
      createdAt: Date.now(),
    }
  }

  const contextText = [
    '私下连续性参考：这些内容只用于理解用户、维持关系连续性和校准表达分寸。',
    '不要在回复里说“根据记忆”、系统、标签、来源、会话编号或检索过程；不要逐条复述。',
    '只在当前话题自然需要时，选择真正相关的少量记忆融入理解、情绪连续性或回应；不要为了证明记得而堆砌。',
    'sourceTime 是原始对话或事件时间；recordedAt 只是笔记保存时间。sourceTime 缺失时不得用 recordedAt 替代或猜测。',
    ...(compactMemoryLines.length > 0
      ? [
          '[当前角色长期记忆目录——由聊天模型直接阅读，不是关键词匹配结论]',
          '请按完整语义自行判断相关性；目录较长时只列压缩摘要，若本轮还提供了 search_memory，需要细节时可主动查询。',
          ...compactMemoryLines,
          '[当前话题的详细候选与表达校准]',
        ]
      : ['[当前角色长期记忆——由聊天模型直接阅读并自行判断相关性]']),
    ...detailedMemoryLines,
  ].join('\n')

  return {
    id: nanoid(),
    contextId: NOTEBOOK_MEMORY_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: contextText,
    createdAt: Date.now(),
  }
}
