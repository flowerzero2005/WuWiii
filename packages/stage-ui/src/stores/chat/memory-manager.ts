import type { AiriReplyFeedbackMemorySummary, AiriReplyFeedbackScope } from '../../types/reply-feedback'
import type { NotebookEntry, NotebookMemoryScope } from '../character/notebook'
import type { ChatTraceContext } from './chat-diagnostics'
import type { MemoryExtractionCandidate, MemoryExtractionRuntime } from './memory-extractor'

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useCharacterNotebookStore } from '../character/notebook'
import { useMemorySettingsStore } from '../settings/memory'
import { useMemoryAdvancedSettingsStore } from '../settings/memory-advanced'
import { calculateSimilarity, findDuplicates, mergeDuplicates } from './memory-deduplication'
import { validateMemoryExtractionCandidates } from './memory-extractor'
import { canRecoverMemoryWork, completeMemoryWork, journalCompletedMemoryWork, readPendingMemoryWork } from './memory-work-journal'
import { isSessionMemoryWorkCancelled } from './session-memory-lifecycle'

const RECENT_PROCESSED_TURN_TTL_MS = 60_000
const MAX_RECENT_PROCESSED_TURNS = 40
const DAY_MS = 24 * 60 * 60 * 1000
const WHITESPACE_RE = /\s+/g
const PERSONA_GROWTH_CANDIDATE_PREFIX_RE = /^人格成长候选（未固化）：/
const CHINESE_SEGMENT_RE = /[\u4E00-\u9FA5]+/g
const EXPLICIT_MEMORY_RECALL_PATTERN = /还记得|记不记得|想起|以前|之前|上次|我说过|我告诉过|回忆|remember|recall|memory/i
const REPLY_FEEDBACK_SUMMARY_MEMORY_KIND = 'reply-feedback-summary'
const PERSONA_GROWTH_CANDIDATE_MEMORY_KIND = 'persona-growth-candidate'
const PERSONA_GROWTH_MEMORY_KIND = 'persona-growth-memory'
const PERSONA_GROWTH_REPLY_FEEDBACK_SOURCE = 'reply-feedback-summary'

type PersonaGrowthCandidateKind = 'principle' | 'preferred-style' | 'avoid-pattern' | 'answering-bias' | 'emotional-cue'

export interface MemorySourceTrace {
  sourceSessionId?: string
  sourceCreatedAt?: number
  sourceUserMessageId?: string
  sourceAssistantMessageId?: string
  sourceAssistantMessageIds?: string[]
  sourceSurface?: string
  userId?: string
  personaCardId?: string
  characterId?: string
  memoryScope?: string
}

export interface DeleteMemoriesForSourceMessageInput {
  sourceSessionId?: string
  sourceMessageId?: string
}

export interface MemoryReferenceTrace {
  referenceQuery?: string
  referenceSessionId?: string
  referenceSource?: string
  referenceUserMessageId?: string
  referencedAt?: number
  userId?: string
  personaCardId?: string
  characterId?: string
}

export interface CompletedChatTurnForMemory extends MemorySourceTrace {
  userMessage: string
  assistantMessage: string
  trace?: ChatTraceContext
  extractionRuntime?: MemoryExtractionRuntime
}

function candidateToMemoryResult(candidate: MemoryExtractionCandidate) {
  return {
    shouldRemember: true,
    importance: candidate.importance,
    summary: candidate.summary,
    tags: candidate.tags,
    reason: candidate.reason,
  }
}

/** The primary completion owns both value and provenance decisions. */
function selectModelCandidates(candidates: MemoryExtractionCandidate[] | undefined, _userMessage: string) {
  return candidates ?? []
}

interface ScoredMemoryEntry {
  directSignalScore: number
  entry: NotebookEntry
  latestActivityAt: number
  score: number
}

interface ReplyFeedbackSummarySyncResult {
  changed: boolean
  entry?: NotebookEntry
  removedCount?: number
  skipped?: boolean
}

interface PersonaGrowthCandidateDraft {
  confidence: number
  kind: PersonaGrowthCandidateKind
  sourceSection: string
  text: string
}

interface PersonaGrowthCandidateSyncResult {
  changed: boolean
  removedCount: number
  skipped?: boolean
  upsertedCount: number
}

function normalizeTurnText(text: string) {
  return text.replace(WHITESPACE_RE, ' ').trim().slice(0, 1000)
}

function createProcessedTurnKey(scopeId: string, userMessage: string, assistantMessage: string, trace?: MemorySourceTrace) {
  if (trace?.sourceUserMessageId || trace?.sourceAssistantMessageId) {
    return [
      scopeId,
      trace.sourceSessionId ?? '',
      trace.sourceUserMessageId ?? '',
      trace.sourceAssistantMessageId ?? '',
    ].join('\n---\n')
  }

  return `${scopeId}\n---\n${normalizeTurnText(userMessage)}\n---\n${normalizeTurnText(assistantMessage)}`
}

function compactTraceMetadata(trace?: MemorySourceTrace): Record<string, unknown> {
  if (!trace)
    return {}

  return Object.fromEntries(
    Object.entries(trace).filter(([, value]) => {
      return typeof value === 'string' ? value.trim().length > 0 : value !== undefined
    }),
  )
}

function isExplicitMemoryRecallQuery(query: string) {
  return EXPLICIT_MEMORY_RECALL_PATTERN.test(query)
}

function getMetadataNumber(entry: NotebookEntry, key: string) {
  const value = entry.metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getLatestMemoryActivityAt(entry: NotebookEntry) {
  return Math.max(
    entry.createdAt,
    getMetadataNumber(entry, 'sourceCreatedAt') ?? 0,
    getMetadataNumber(entry, 'extractedAt') ?? 0,
    getMetadataNumber(entry, 'lastReferencedAt') ?? 0,
  )
}

function calculateAgeScore(timestamp: number | undefined, now: number, maxScore: number) {
  if (!timestamp)
    return 0

  const ageDays = Math.max(0, (now - timestamp) / DAY_MS)
  if (ageDays <= 1)
    return maxScore
  if (ageDays <= 7)
    return maxScore * 0.75
  if (ageDays <= 30)
    return maxScore * 0.5
  if (ageDays <= 90)
    return maxScore * 0.25
  return 0
}

function calculateMemoryRecencyScore(entry: NotebookEntry, now: number) {
  return calculateAgeScore(getLatestMemoryActivityAt(entry), now, 4)
}

function calculateMemoryReferenceScore(entry: NotebookEntry, now: number) {
  const referenceCount = Math.max(0, getMetadataNumber(entry, 'referenceCount') ?? 0)
  const countScore = Math.min(referenceCount, 5) * 0.75
  const recentReferenceScore = calculateAgeScore(getMetadataNumber(entry, 'lastReferencedAt'), now, 2)
  return countScore + recentReferenceScore
}

function calculateMemoryImportanceScore(entry: NotebookEntry) {
  const importance = entry.metadata?.importance
  if (importance === 'high')
    return 8
  if (importance === 'medium')
    return 4
  return 0
}

function calculateMemoryScopeScore(entry: NotebookEntry) {
  const memoryScope = entry.metadata?.memoryScope
  let score = 0

  if (memoryScope === 'current-persona')
    score += 2.5
  else if (memoryScope === 'shared-by-user')
    score += 1.5
  else if (memoryScope === 'global-system')
    score += 0.5

  if (typeof entry.metadata?.personaCardId === 'string' && entry.metadata.personaCardId.length > 0)
    score += 1
  if (typeof entry.metadata?.characterId === 'string' && entry.metadata.characterId.length > 0)
    score += 0.5

  return score
}

function hasRecallableMemoryAnchor(entry: NotebookEntry) {
  return calculateMemoryImportanceScore(entry) > 0
    || getMetadataNumber(entry, 'lastReferencedAt') !== undefined
    || getMetadataNumber(entry, 'referenceCount') !== undefined
    || getMetadataNumber(entry, 'sourceCreatedAt') !== undefined
    || typeof entry.metadata?.sourceSessionId === 'string'
    || typeof entry.metadata?.sourceUserMessageId === 'string'
    || typeof entry.metadata?.sourceAssistantMessageId === 'string'
}

function getKeywordMatchScore(keyword: string) {
  if (keyword.length >= 4)
    return 12
  if (keyword.length >= 3)
    return 9
  return 6
}

function hasExactPhraseMatch(textLower: string, queryLower: string, finalKeywords: string[]) {
  const exactQuery = queryLower.trim()
  if (exactQuery.length >= 4 && textLower.includes(exactQuery))
    return true

  return finalKeywords.some((keyword) => {
    return keyword.length >= 4 && queryLower.includes(keyword) && textLower.includes(keyword)
  })
}

function getMetadataSearchText(entry: NotebookEntry) {
  const metadata = entry.metadata ?? {}
  const parts = [
    entry.text,
    ...(entry.tags ?? []),
    metadata.memoryKey,
    metadata.memoryType,
    metadata.memoryContext,
    metadata.antecedent,
    metadata.outcome,
    metadata.timeExpression,
    ...(Array.isArray(metadata.involvedPeople) ? metadata.involvedPeople : []),
  ]
  return parts
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
}

function scoreMemoryEntryForQuery(entry: NotebookEntry, finalKeywords: string[], queryLower: string, now: number) {
  const textLower = getMetadataSearchText(entry).toLowerCase()
  const normalizedKeywords = finalKeywords
    .map(keyword => keyword.trim().toLowerCase())
    .filter(keyword => keyword.length > 0)

  let score = 0
  let directSignalScore = 0

  if (hasExactPhraseMatch(textLower, queryLower, normalizedKeywords)) {
    score += 14
    directSignalScore += 14
  }

  for (const keyword of normalizedKeywords) {
    if (!textLower.includes(keyword))
      continue

    const keywordScore = getKeywordMatchScore(keyword)
    score += keywordScore
    directSignalScore += keywordScore
  }

  for (const tag of entry.tags ?? []) {
    const tagLower = tag.toLowerCase()
    const matchedByKeyword = normalizedKeywords.some((keyword) => {
      return tagLower.includes(keyword) || (tagLower.length >= 2 && keyword.includes(tagLower))
    })

    if (!matchedByKeyword)
      continue

    const tagScore = normalizedKeywords.includes(tagLower) ? 9 : 6
    score += tagScore
    directSignalScore += tagScore
  }

  const explicitRecallQuery = isExplicitMemoryRecallQuery(queryLower)
  const importanceScore = calculateMemoryImportanceScore(entry)
  const recencyScore = calculateMemoryRecencyScore(entry, now)
  const referenceScore = calculateMemoryReferenceScore(entry, now)
  const scopeScore = calculateMemoryScopeScore(entry)

  if (directSignalScore > 0) {
    score += importanceScore + recencyScore + referenceScore + scopeScore
    if (explicitRecallQuery && hasRecallableMemoryAnchor(entry))
      score += 3
  }
  else if (explicitRecallQuery && hasRecallableMemoryAnchor(entry)) {
    score += 4 + importanceScore + recencyScore + referenceScore + scopeScore
    directSignalScore = 1
  }
  else {
    return undefined
  }

  return {
    directSignalScore,
    entry,
    latestActivityAt: getLatestMemoryActivityAt(entry),
    score,
  }
}

function isScoredMemoryEntry(item: ScoredMemoryEntry | undefined): item is ScoredMemoryEntry {
  return item !== undefined && item.directSignalScore > 0
}

function appendReplyFeedbackMemorySection(lines: string[], label: string, values: string[], limit = 4) {
  const visibleValues = values
    .map(value => value.trim())
    .filter(Boolean)
    .slice(0, limit)

  if (visibleValues.length === 0)
    return

  lines.push(`${label}:`)
  lines.push(...visibleValues.map(value => `- ${value}`))
}

function buildReplyFeedbackSummaryMemoryText(summary: AiriReplyFeedbackMemorySummary) {
  const lines = [
    '当前人格的回复评价总结：用于低优先级表达校准，不要在回复里提到评价系统。',
    `样本数：${summary.recordCount}；可信度：${summary.confidence.toFixed(2)}。`,
  ]

  appendReplyFeedbackMemorySection(lines, '表达原则', summary.principles)
  appendReplyFeedbackMemorySection(lines, '用户偏好的说法', summary.preferredStyles)
  appendReplyFeedbackMemorySection(lines, '需要避免的说法', summary.avoidPatterns)
  appendReplyFeedbackMemorySection(lines, '回答倾向', summary.answeringBiases)
  appendReplyFeedbackMemorySection(lines, '情绪提示', summary.emotionalCues)

  return lines.join('\n')
}

function normalizePersonaGrowthCandidateText(text: string) {
  return text.replace(WHITESPACE_RE, ' ').trim()
}

function createPersonaGrowthCandidateKey(scope: AiriReplyFeedbackScope, kind: PersonaGrowthCandidateKind, text: string) {
  const normalized = normalizePersonaGrowthCandidateText(text).toLowerCase().slice(0, 160)
  return `${PERSONA_GROWTH_REPLY_FEEDBACK_SOURCE}:${scope.userId}:${scope.personaCardId}:${kind}:${normalized}`
}

function appendPersonaGrowthCandidateDrafts(
  drafts: PersonaGrowthCandidateDraft[],
  kind: PersonaGrowthCandidateKind,
  sourceSection: string,
  label: string,
  values: string[],
  confidence: number,
) {
  for (const value of values.slice(0, 4)) {
    const normalized = normalizePersonaGrowthCandidateText(value)
    if (!normalized)
      continue

    drafts.push({
      confidence,
      kind,
      sourceSection,
      text: `人格成长候选（未固化）：${label}：${normalized}`,
    })
  }
}

function buildPersonaGrowthCandidateDraftsFromReplyFeedbackSummary(
  summary: AiriReplyFeedbackMemorySummary,
) {
  if (!summary.principles.length || summary.confidence < 0.4)
    return []

  const confidence = Math.min(0.85, Math.max(0.4, summary.confidence))
  const drafts: PersonaGrowthCandidateDraft[] = []

  appendPersonaGrowthCandidateDrafts(drafts, 'principle', 'principles', '表达原则', summary.principles, confidence)
  appendPersonaGrowthCandidateDrafts(drafts, 'preferred-style', 'preferredStyles', '用户偏好的表达方式', summary.preferredStyles, confidence)
  appendPersonaGrowthCandidateDrafts(drafts, 'avoid-pattern', 'avoidPatterns', '需要避免的表达习惯', summary.avoidPatterns, confidence)
  appendPersonaGrowthCandidateDrafts(drafts, 'answering-bias', 'answeringBiases', '回答倾向', summary.answeringBiases, confidence)
  appendPersonaGrowthCandidateDrafts(drafts, 'emotional-cue', 'emotionalCues', '情绪表达提示', summary.emotionalCues, confidence)

  return drafts
}

export const useMemoryManager = defineStore('memory-manager', () => {
  const notebookStore = useCharacterNotebookStore()
  const memorySettings = useMemorySettingsStore()
  const memoryAdvancedSettings = useMemoryAdvancedSettingsStore()
  const isProcessing = ref(false)
  const lastProcessedAt = ref<number>(0)
  const lastDeduplicationAt = ref<number>(0)
  const recentProcessedTurnKeys = new Map<string, number>()
  const processingByScope = new Map<string, Promise<unknown>>()

  // Recovery only persists the last completion's stored candidates. It never
  // invokes a model, replays a message, or retries a paid extraction request.
  void Promise.resolve().then(async () => {
    for (const turn of readPendingMemoryWork()) {
      try {
        if (!await canRecoverMemoryWork(turn)) {
          completeMemoryWork(turn)
          continue
        }
        await processCompletedChatTurnForMemory(turn)
      }
      catch (error) {
        console.warn('[MemoryManager] Pending memory work remains recoverable:', error)
      }
    }
  }).catch(error => console.warn('[MemoryManager] Memory recovery unavailable:', error))

  // 确保 notebook store 已加载
  if (!notebookStore.isLoaded) {
    notebookStore.loadFromStorage().catch((err) => {
      console.error('[MemoryManager] Notebook store 加载失败:', err)
    })
  }

  // Log callback for UI display
  type LogCallback = (type: 'info' | 'success' | 'warning', message: string) => void
  const logCallbacks: LogCallback[] = []

  function onLog(callback: LogCallback) {
    logCallbacks.push(callback)
    return () => {
      const index = logCallbacks.indexOf(callback)
      if (index !== -1) {
        logCallbacks.splice(index, 1)
      }
    }
  }

  function emitLog(type: 'info' | 'success' | 'warning', message: string) {
    logCallbacks.forEach(cb => cb(type, message))
  }

  function pruneRecentProcessedTurnKeys(now = Date.now()) {
    for (const [key, processedAt] of recentProcessedTurnKeys) {
      if (now - processedAt > RECENT_PROCESSED_TURN_TTL_MS) {
        recentProcessedTurnKeys.delete(key)
      }
    }

    while (recentProcessedTurnKeys.size > MAX_RECENT_PROCESSED_TURNS) {
      const oldestKey = recentProcessedTurnKeys.keys().next().value
      if (!oldestKey)
        break
      recentProcessedTurnKeys.delete(oldestKey)
    }
  }

  async function runConversationTurn(
    userMessage: string,
    assistantMessage: string,
    memoryScope: NotebookMemoryScope,
    options?: {
      sourceTrace?: MemorySourceTrace
      trace?: ChatTraceContext
      extractionRuntime?: MemoryExtractionRuntime
    },
  ) {
    // 检查记忆系统是否启用
    if (!memorySettings.settings.enabled) {
      emitLog('info', '记忆系统已禁用')
      return
    }

    // 检查是否启用自动提取
    if (!memorySettings.settings.autoExtract) {
      emitLog('info', '自动提取已禁用')
      return
    }

    let scopedEntries = await notebookStore.getMemoryEntriesForScope(memoryScope)
    if (isSessionMemoryWorkCancelled(options?.sourceTrace?.sourceSessionId))
      return

    // 输入验证
    if (!userMessage || !assistantMessage || typeof userMessage !== 'string' || typeof assistantMessage !== 'string') {
      emitLog('warning', '无效的输入消息')
      return
    }

    if (userMessage.trim().length === 0 || assistantMessage.trim().length === 0) {
      emitLog('info', '消息为空，跳过处理')
      return
    }

    const now = Date.now()
    const processedTurnKey = createProcessedTurnKey(memoryScope.characterId, userMessage, assistantMessage, options?.sourceTrace)
    pruneRecentProcessedTurnKeys(now)
    if (recentProcessedTurnKeys.has(processedTurnKey)) {
      emitLog('info', '同一轮对话已处理，跳过重复记忆提取')
      return
    }

    // NOTICE: Desktop, quick chat, and shared stage surfaces can register completion hooks
    // at the same time. Keying the finished turn prevents duplicate extraction without
    // depending on which surface mounted first.
    recentProcessedTurnKeys.set(processedTurnKey, now)

    emitLog('info', '开始分析对话内容...')

    try {
      // 使用混合策略提取记忆。用户在长期记忆页维护的关键词只是模型
      // 的关注提示，随本轮快照传入，避免把设置误当成硬触发规则。
      const memoryHints = memorySettings.customKeywords
        .filter(keyword => keyword.enabled)
        .slice(0, 32)
        .map(keyword => keyword.description?.trim()
          ? `${keyword.keyword}（${keyword.description.trim()}）`
          : keyword.keyword)
      const extractionRuntime = {
        ...options?.extractionRuntime,
        memoryHints,
      }
      // The primary chat completion owns the semantic decision. This boundary
      // normalizes its private candidates but never replaces a missing model
      // decision with keyword or score-based importance rules.
      const memoryItems = selectModelCandidates(validateMemoryExtractionCandidates(extractionRuntime.memoryCandidates), userMessage)
        .map(structuredCandidate => ({
          memoryResult: candidateToMemoryResult(structuredCandidate),
          structuredCandidate,
        }))

      if (memoryItems.length === 0) {
        emitLog('info', '聊天模型本轮未选择保存长期记忆')
        return
      }

      const persistedFeedback: Array<{
        importance: 'low' | 'medium' | 'high'
        reason: string
        summary: string
        tags: string[]
        updated?: boolean
      }> = []

      let candidateFailed = false
      for (const [candidateIndex, { memoryResult, structuredCandidate }] of memoryItems.entries()) {
        if (isSessionMemoryWorkCancelled(options?.sourceTrace?.sourceSessionId))
          return
        const candidateKey = `${processedTurnKey}:${candidateIndex}`
        if (scopedEntries.some(entry => Array.isArray(entry.metadata?.appliedMemoryCandidateKeys)
          && entry.metadata.appliedMemoryCandidateKeys.includes(candidateKey)))
          continue
        // A malformed or temporarily unwritable candidate must not prevent
        // the remaining model-approved memories from being persisted.
        try {
          const importanceLabel = memoryResult.importance === 'high'
            ? '高'
            : memoryResult.importance === 'medium' ? '中' : '低'
          emitLog('info', `检测到${importanceLabel}优先级信息`)
          emitLog('info', `匹配原因: ${memoryResult.reason}`)

          // 检查是否与现有记忆重复
          const targetedEntry = structuredCandidate?.action === 'update'
            ? scopedEntries.find(entry => entry.id === structuredCandidate.targetMemoryId
              && notebookStore.entryBelongsToMemoryScope(entry, memoryScope))
            : undefined
          if (structuredCandidate?.action === 'update' && !targetedEntry) {
            emitLog('info', '目标记忆不属于当前角色，跳过更新')
            continue
          }
          const keyedEntry = structuredCandidate?.memoryKey
            ? scopedEntries.find(entry => entry.metadata?.memoryKey === structuredCandidate.memoryKey)
            : undefined
          const similarEntry = targetedEntry ?? keyedEntry ?? await findSimilarMemory(memoryResult.summary, scopedEntries, memoryScope)
          if (similarEntry) {
          // Keep one scoped memory current when the user repeats or changes a
          // preference. Dropping similar facts made stable preferences vanish.
            const importanceRank = { low: 0, medium: 1, high: 2 } as const
            const currentImportance = similarEntry.metadata?.importance
            const currentRank = currentImportance === 'high' || currentImportance === 'medium' || currentImportance === 'low'
              ? importanceRank[currentImportance]
              : -1
            const nextImportance = importanceRank[memoryResult.importance] >= currentRank
              ? memoryResult.importance
              : currentImportance as 'low' | 'medium' | 'high'
            const updatedEntry = await notebookStore.updateMemoryEntryInScope(similarEntry.id, memoryScope, (entry) => {
              entry.text = memoryResult.summary
              entry.tags = Array.from(new Set([...(entry.tags ?? []), ...memoryResult.tags]))
              entry.metadata = {
                ...entry.metadata,
                appliedMemoryCandidateKeys: [...(Array.isArray(entry.metadata?.appliedMemoryCandidateKeys) ? entry.metadata.appliedMemoryCandidateKeys : []), candidateKey],
                importance: nextImportance,
                reason: memoryResult.reason,
                extractedAt: Date.now(),
                memoryUpdateCount: (typeof entry.metadata?.memoryUpdateCount === 'number' ? entry.metadata.memoryUpdateCount : 0) + 1,
                ...(structuredCandidate
                  ? {
                      memoryKey: structuredCandidate.memoryKey,
                      memoryType: structuredCandidate.memoryType,
                      memoryContext: structuredCandidate.context,
                      userEvidence: structuredCandidate.userEvidence,
                      involvedPeople: structuredCandidate.involvedPeople,
                      antecedent: structuredCandidate.antecedent,
                      outcome: structuredCandidate.outcome,
                      certainty: structuredCandidate.certainty,
                      confidence: structuredCandidate.confidence,
                      timeExpression: structuredCandidate.timeExpression,
                    }
                  : {}),
                ...compactTraceMetadata(options?.sourceTrace),
              }
            }, options?.sourceTrace?.sourceSessionId)
            emitLog('success', `已更新相似记忆: ${memoryResult.summary.slice(0, 50)}...`)
            if (!updatedEntry)
              throw new Error('Memory target disappeared before it could be persisted.')
            persistedFeedback.push({ ...memoryResult, updated: true })
            scopedEntries = await notebookStore.getMemoryEntriesForScope(memoryScope)
            continue
          }

          emitLog('success', `保存记忆: ${memoryResult.summary.slice(0, 50)}...`)

          const sourceMetadata = compactTraceMetadata(options?.sourceTrace)
          const memoryMetadata = {
            appliedMemoryCandidateKeys: [candidateKey],
            importance: memoryResult.importance,
            reason: memoryResult.reason,
            extractedAt: Date.now(),
            userMessage: userMessage.slice(0, 200), // 保留原始消息片段
            ...(structuredCandidate
              ? {
                  memoryKey: structuredCandidate.memoryKey,
                  memoryType: structuredCandidate.memoryType,
                  memoryContext: structuredCandidate.context,
                  userEvidence: structuredCandidate.userEvidence,
                  involvedPeople: structuredCandidate.involvedPeople,
                  antecedent: structuredCandidate.antecedent,
                  outcome: structuredCandidate.outcome,
                  certainty: structuredCandidate.certainty,
                  confidence: structuredCandidate.confidence,
                  timeExpression: structuredCandidate.timeExpression,
                }
              : {}),
            ...sourceMetadata,
          }

          // 根据重要性决定存储类型
          if (memoryResult.importance === 'high') {
          // 高优先级：存为 focus（焦点）
            await notebookStore.addMemoryEntryToScope('focus', memoryResult.summary, {
              scope: memoryScope,
              tags: memoryResult.tags,
              metadata: memoryMetadata,
            })
          }
          else {
          // Medium/low memories are useful context but do not belong in focus.
            await notebookStore.addMemoryEntryToScope('note', memoryResult.summary, {
              scope: memoryScope,
              tags: memoryResult.tags,
              metadata: memoryMetadata,
            })
          }

          lastProcessedAt.value = Date.now()

          emitLog('success', `记忆已保存到${memoryResult.importance === 'high' ? '焦点' : '笔记'}区`)
          emitLog('info', `当前记忆总数: ${(await notebookStore.getMemoryEntriesForScope(memoryScope)).length}`)

          persistedFeedback.push(memoryResult)
          scopedEntries = await notebookStore.getMemoryEntriesForScope(memoryScope)
        }
        catch (error) {
          candidateFailed = true
          emitLog('warning', '一个记忆条目保存失败，继续处理其他条目')
          console.warn('[MemoryManager] Failed to persist one memory candidate:', error)
        }
      }

      if (candidateFailed)
        throw new Error('Some completed-turn memories remain pending')

      if (persistedFeedback.length === 0)
        return { success: false, skipped: true, reason: 'no-persisted-candidates' }

      // 返回反馈信息，用于 AI 感知
      const feedback = {
        success: true,
        summary: persistedFeedback[0].summary,
        importance: persistedFeedback[0].importance,
        tags: persistedFeedback[0].tags,
        reason: persistedFeedback[0].reason,
        savedCount: persistedFeedback.length,
        memories: persistedFeedback,
      }

      return feedback
    }
    catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error)
      emitLog('warning', `记忆提取失败: ${errorMessage}`)
      recentProcessedTurnKeys.delete(processedTurnKey)
      console.error('[MemoryManager] Failed to process conversation:', error)
      throw error
    }
  }

  async function processConversationTurn(
    userMessage: string,
    assistantMessage: string,
    options?: {
      sourceTrace?: MemorySourceTrace
      trace?: ChatTraceContext
      extractionRuntime?: MemoryExtractionRuntime
    },
  ) {
    // Freeze ownership at submission time. A card/session switch while an
    // earlier extraction runs must not redirect this queued turn elsewhere.
    const memoryScope = notebookStore.resolveMemoryScope(options?.sourceTrace)
    const scopeKey = memoryScope.characterId
    const previous = processingByScope.get(scopeKey) ?? Promise.resolve()
    const run = previous
      .catch(() => undefined)
      .then(async () => {
        const process = async () => {
          // Another window may have applied a journal candidate already.
          // Refresh while owning the turn lock before checking its source key.
          if (notebookStore.characterId === scopeKey)
            await notebookStore.loadFromStorage({ force: true })
          return runConversationTurn(userMessage, assistantMessage, memoryScope, options)
        }
        const locks = globalThis.navigator?.locks
        return locks ? locks.request(`airi-memory-turn:${scopeKey}`, process) : process()
      })

    // Serialize one memory owner's turns instead of dropping every request
    // received while a global isProcessing flag is true. Distinct scopes can
    // still progress independently and the processed-turn key keeps duplicate
    // completion hooks idempotent.
    processingByScope.set(scopeKey, run)
    isProcessing.value = true
    try {
      return await run
    }
    finally {
      if (processingByScope.get(scopeKey) === run)
        processingByScope.delete(scopeKey)
      isProcessing.value = processingByScope.size > 0
    }
  }

  function stageCompletedChatTurnForMemory(turn: CompletedChatTurnForMemory) {
    if (!memorySettings.settings.enabled || !memorySettings.settings.autoExtract)
      return
    journalCompletedMemoryWork({ ...turn, ...notebookStore.resolveMemoryScope(turn) })
  }

  async function processCompletedChatTurnForMemory(turn: CompletedChatTurnForMemory) {
    const scope = notebookStore.resolveMemoryScope(turn)
    turn = { ...turn, ...scope }
    if (!memorySettings.settings.enabled || !memorySettings.settings.autoExtract || isSessionMemoryWorkCancelled(turn.sourceSessionId))
      return
    if (turn.sourceAssistantMessageId && !journalCompletedMemoryWork(turn))
      return
    const result = await processConversationTurn(turn.userMessage, turn.assistantMessage, {
      trace: turn.trace,
      extractionRuntime: turn.extractionRuntime,
      sourceTrace: {
        sourceSessionId: turn.sourceSessionId,
        sourceCreatedAt: turn.sourceCreatedAt,
        sourceUserMessageId: turn.sourceUserMessageId,
        sourceAssistantMessageId: turn.sourceAssistantMessageId,
        sourceAssistantMessageIds: turn.sourceAssistantMessageIds,
        sourceSurface: turn.sourceSurface,
        userId: turn.userId,
        personaCardId: turn.personaCardId,
        characterId: turn.characterId,
        memoryScope: turn.memoryScope,
      },
    })
    completeMemoryWork(turn)
    return result
  }

  async function deleteMemoriesForSourceMessage(input: DeleteMemoriesForSourceMessageInput) {
    if (!input.sourceMessageId)
      return []

    if (!notebookStore.isLoaded) {
      await notebookStore.loadFromStorage()
    }

    const removedEntries = notebookStore.removeEntriesBySourceMessage(input)
    if (removedEntries.length > 0) {
      await notebookStore.saveToStorage()
      emitLog('info', `已清理由该消息写入的长期记忆 ${removedEntries.length} 条`)
    }

    return removedEntries
  }

  function entryMatchesReplyFeedbackSummaryScope(entry: NotebookEntry, scope?: AiriReplyFeedbackScope) {
    const metadata = entry.metadata
    if (!metadata || metadata.memoryKind !== REPLY_FEEDBACK_SUMMARY_MEMORY_KIND)
      return false

    if (!scope)
      return notebookStore.entryBelongsToCurrentScope(entry)

    const metadataPersonaCardId = metadata.replyFeedbackPersonaCardId ?? metadata.personaCardId
    const metadataUserId = metadata.replyFeedbackUserId ?? metadata.userId
    return metadataPersonaCardId === scope.personaCardId
      && (!metadataUserId || metadataUserId === scope.userId)
  }

  async function getReplyFeedbackSummaryMemories(scope?: Partial<NotebookMemoryScope>) {
    const resolvedScope = notebookStore.resolveMemoryScope(scope)
    const entries = await notebookStore.getMemoryEntriesForScope(resolvedScope)
    return entries.filter(entry => entry.metadata?.memoryKind === REPLY_FEEDBACK_SUMMARY_MEMORY_KIND
      && notebookStore.entryBelongsToMemoryScope(entry, resolvedScope))
  }

  function entryMatchesPersonaGrowthCandidateScope(entry: NotebookEntry, scope?: AiriReplyFeedbackScope) {
    const metadata = entry.metadata
    if (!metadata || metadata.memoryKind !== PERSONA_GROWTH_CANDIDATE_MEMORY_KIND)
      return false

    if (metadata.personaGrowthSource !== PERSONA_GROWTH_REPLY_FEEDBACK_SOURCE)
      return false

    if (!scope)
      return notebookStore.entryBelongsToCurrentScope(entry)

    const metadataPersonaCardId = metadata.personaGrowthPersonaCardId ?? metadata.personaCardId
    const metadataUserId = metadata.personaGrowthUserId ?? metadata.userId
    return metadataPersonaCardId === scope.personaCardId
      && (!metadataUserId || metadataUserId === scope.userId)
  }

  function entryMatchesPersonaGrowthSourceScope(entry: NotebookEntry, scope: AiriReplyFeedbackScope) {
    const metadata = entry.metadata
    if (!metadata || metadata.personaGrowthSource !== PERSONA_GROWTH_REPLY_FEEDBACK_SOURCE)
      return false

    const metadataPersonaCardId = metadata.personaGrowthPersonaCardId ?? metadata.personaCardId
    const metadataUserId = metadata.personaGrowthUserId ?? metadata.userId
    return metadataPersonaCardId === scope.personaCardId
      && (!metadataUserId || metadataUserId === scope.userId)
  }

  function getPersonaGrowthCandidateMemories() {
    return notebookStore.entries.filter(entry => entryMatchesPersonaGrowthCandidateScope(entry))
  }

  async function syncReplyFeedbackSummaryToLongTermMemory(
    scope: AiriReplyFeedbackScope,
    summary: AiriReplyFeedbackMemorySummary | null | undefined,
  ): Promise<ReplyFeedbackSummarySyncResult> {
    if (scope.personaCardId !== notebookStore.activePersonaCardId) {
      return {
        changed: false,
        skipped: true,
      }
    }

    if (!notebookStore.isLoaded || notebookStore.loadedScopeId !== notebookStore.characterId) {
      await notebookStore.loadFromStorage()
    }

    const existingEntries = notebookStore.entries.filter(entry => entryMatchesReplyFeedbackSummaryScope(entry, scope))
    const [primaryEntry, ...duplicateEntries] = existingEntries

    if (!summary?.principles.length) {
      for (const entry of existingEntries)
        notebookStore.removeEntry(entry.id)

      if (existingEntries.length > 0)
        await notebookStore.saveToStorage()

      return {
        changed: existingEntries.length > 0,
        removedCount: existingEntries.length,
      }
    }

    const now = Date.now()
    const text = buildReplyFeedbackSummaryMemoryText(summary)
    const metadata = {
      importance: summary.confidence >= 0.48 ? 'medium' : 'low',
      reason: '用户回复评价总结',
      extractedAt: summary.generatedAt,
      lastReinforcedAt: now,
      memoryKind: REPLY_FEEDBACK_SUMMARY_MEMORY_KIND,
      memoryScope: 'current-persona',
      personaCardId: scope.personaCardId,
      replyFeedbackConfidence: summary.confidence,
      replyFeedbackGeneratedAt: summary.generatedAt,
      replyFeedbackPersonaCardId: scope.personaCardId,
      replyFeedbackRecordCount: summary.recordCount,
      replyFeedbackSchemaVersion: summary.schemaVersion,
      replyFeedbackSourceIds: summary.sourceFeedbackIds,
      replyFeedbackUserId: scope.userId,
    }

    let entry = primaryEntry
    if (entry) {
      entry.text = text
      entry.tags = ['回复反馈', '评价总结', '表达偏好', '人格校准']
      entry.metadata = {
        ...entry.metadata,
        ...metadata,
      }
    }
    else {
      entry = notebookStore.addNote(text, {
        metadata,
        tags: ['回复反馈', '评价总结', '表达偏好', '人格校准'],
      })
    }

    for (const duplicateEntry of duplicateEntries)
      notebookStore.removeEntry(duplicateEntry.id)

    await notebookStore.saveToStorage()

    return {
      changed: true,
      entry,
      removedCount: duplicateEntries.length,
    }
  }

  async function syncPersonaGrowthCandidatesFromReplyFeedbackSummary(
    scope: AiriReplyFeedbackScope,
    summary: AiriReplyFeedbackMemorySummary | null | undefined,
  ): Promise<PersonaGrowthCandidateSyncResult> {
    if (scope.personaCardId !== notebookStore.activePersonaCardId) {
      return {
        changed: false,
        removedCount: 0,
        skipped: true,
        upsertedCount: 0,
      }
    }

    if (!notebookStore.isLoaded || notebookStore.loadedScopeId !== notebookStore.characterId) {
      await notebookStore.loadFromStorage()
    }

    const existingEntries = notebookStore.entries.filter(entry => entryMatchesPersonaGrowthCandidateScope(entry, scope))
    const sourceEntries = notebookStore.entries.filter(entry => entryMatchesPersonaGrowthSourceScope(entry, scope))
    const existingByKey = new Map<string, NotebookEntry>()
    for (const entry of existingEntries) {
      const key = entry.metadata?.personaGrowthCandidateKey
      if (typeof key === 'string' && !existingByKey.has(key))
        existingByKey.set(key, entry)
    }
    const blockedKeys = new Set<string>()
    for (const entry of sourceEntries) {
      const key = entry.metadata?.personaGrowthCandidateKey
      const status = entry.metadata?.personaGrowthStatus
      if (typeof key === 'string' && (status === 'disabled' || status === 'solidified'))
        blockedKeys.add(key)
    }

    const drafts = summary ? buildPersonaGrowthCandidateDraftsFromReplyFeedbackSummary(summary) : []
    const nextKeys = new Set<string>()
    let upsertedCount = 0
    let removedCount = 0

    if (!summary || drafts.length === 0) {
      for (const entry of existingEntries) {
        notebookStore.removeEntry(entry.id)
        removedCount += 1
      }

      if (removedCount > 0)
        await notebookStore.saveToStorage()

      return {
        changed: removedCount > 0,
        removedCount,
        upsertedCount: 0,
      }
    }

    const now = Date.now()
    for (const draft of drafts) {
      const candidateKey = createPersonaGrowthCandidateKey(scope, draft.kind, draft.text)
      nextKeys.add(candidateKey)

      if (blockedKeys.has(candidateKey))
        continue

      const metadata = {
        importance: 'low',
        extractedAt: summary.generatedAt,
        lastReinforcedAt: now,
        memoryKind: PERSONA_GROWTH_CANDIDATE_MEMORY_KIND,
        memoryScope: 'current-persona',
        personaCardId: scope.personaCardId,
        personaGrowthCandidateKey: candidateKey,
        personaGrowthConfidence: draft.confidence,
        personaGrowthKind: draft.kind,
        personaGrowthPersonaCardId: scope.personaCardId,
        personaGrowthSource: PERSONA_GROWTH_REPLY_FEEDBACK_SOURCE,
        personaGrowthSourceFeedbackIds: summary.sourceFeedbackIds,
        personaGrowthSourceSection: draft.sourceSection,
        personaGrowthStatus: 'candidate',
        personaGrowthUserId: scope.userId,
        replyFeedbackGeneratedAt: summary.generatedAt,
        replyFeedbackSchemaVersion: summary.schemaVersion,
      }
      const existingEntry = existingByKey.get(candidateKey)

      if (existingEntry?.metadata?.personaGrowthStatus === 'disabled')
        continue

      if (existingEntry) {
        existingEntry.text = draft.text
        existingEntry.tags = ['人格成长候选', '未固化', '回复反馈', draft.kind]
        existingEntry.metadata = {
          ...existingEntry.metadata,
          ...metadata,
        }
      }
      else {
        notebookStore.addNote(draft.text, {
          metadata,
          tags: ['人格成长候选', '未固化', '回复反馈', draft.kind],
        })
      }

      upsertedCount += 1
    }

    for (const entry of existingEntries) {
      const key = entry.metadata?.personaGrowthCandidateKey
      if (typeof key === 'string' && nextKeys.has(key))
        continue

      notebookStore.removeEntry(entry.id)
      removedCount += 1
    }

    await notebookStore.saveToStorage()

    return {
      changed: upsertedCount > 0 || removedCount > 0,
      removedCount,
      upsertedCount,
    }
  }

  async function solidifyPersonaGrowthCandidate(entryId: string, scope?: Partial<NotebookMemoryScope>) {
    const targetScope = notebookStore.resolveMemoryScope(scope)
    let changed = false
    const updated = await notebookStore.updateMemoryEntryInScope(entryId, targetScope, (entry) => {
      if (entry.metadata?.memoryKind !== PERSONA_GROWTH_CANDIDATE_MEMORY_KIND)
        return
      changed = true
      const now = Date.now()
      entry.text = entry.text.replace(PERSONA_GROWTH_CANDIDATE_PREFIX_RE, '人格成长记忆：')
      entry.tags = Array.from(new Set([
        ...(entry.tags ?? []).filter(tag => tag !== '未固化' && tag !== '已忽略'),
        '人格成长记忆',
        '已固化',
      ]))
      entry.metadata = {
        ...entry.metadata,
        importance: 'medium',
        lastReinforcedAt: now,
        memoryKind: PERSONA_GROWTH_MEMORY_KIND,
        personaGrowthSolidifiedAt: now,
        personaGrowthStatus: 'solidified',
      }
    })
    return changed ? updated : undefined
  }

  async function disablePersonaGrowthCandidate(entryId: string, scope?: Partial<NotebookMemoryScope>) {
    const targetScope = notebookStore.resolveMemoryScope(scope)
    let changed = false
    const updated = await notebookStore.updateMemoryEntryInScope(entryId, targetScope, (entry) => {
      if (entry.metadata?.memoryKind !== PERSONA_GROWTH_CANDIDATE_MEMORY_KIND)
        return
      changed = true
      const now = Date.now()
      entry.tags = Array.from(new Set([
        ...(entry.tags ?? []).filter(tag => tag !== '已固化'),
        '已忽略',
      ]))
      entry.metadata = {
        ...entry.metadata,
        lastReinforcedAt: now,
        personaGrowthDisabledAt: now,
        personaGrowthStatus: 'disabled',
      }
    })
    return changed ? updated : undefined
  }

  function markMemoriesReferenced(entries: Array<{ id: string, metadata?: Record<string, unknown> }>, trace: MemoryReferenceTrace) {
    if (entries.length === 0)
      return

    const referencedAt = trace.referencedAt ?? Date.now()
    const referencedEntryIds = new Set(entries.map(entry => entry.id))

    for (const entry of notebookStore.entries) {
      if (!referencedEntryIds.has(entry.id))
        continue

      const currentReferenceCount = typeof entry.metadata?.referenceCount === 'number'
        ? entry.metadata.referenceCount
        : 0

      entry.metadata = {
        ...entry.metadata,
        lastReferencedAt: referencedAt,
        lastReferenceQuery: trace.referenceQuery?.slice(0, 200),
        lastReferenceSessionId: trace.referenceSessionId,
        lastReferenceSource: trace.referenceSource,
        lastReferenceUserMessageId: trace.referenceUserMessageId,
        referenceCount: currentReferenceCount + 1,
      }
    }
  }

  /**
   * 检查新记忆是否与现有记忆重复
   */
  async function findSimilarMemory(
    newMemoryText: string,
    entries = notebookStore.entries,
    scope?: Partial<NotebookMemoryScope>,
    threshold = 0.75,
  ): Promise<NotebookEntry | undefined> {
    const tempEntry = {
      id: 'temp',
      kind: 'note' as const,
      text: newMemoryText,
      createdAt: Date.now(),
      tags: [],
    }

    for (const existingEntry of entries.filter(entry => notebookStore.entryBelongsToMemoryScope(entry, scope))) {
      const similarity = calculateSimilarity(tempEntry, existingEntry)
      if (similarity >= threshold) {
        return existingEntry
      }
    }

    return undefined
  }

  async function checkForDuplicates(
    newMemoryText: string,
    entries = notebookStore.entries,
    scope?: Partial<NotebookMemoryScope>,
    threshold = 0.75,
  ): Promise<boolean> {
    return Boolean(await findSimilarMemory(newMemoryText, entries, scope, threshold))
  }

  /**
   * 对现有记忆进行去重
   */
  async function deduplicateMemories(threshold = 0.85): Promise<number> {
    if (notebookStore.entries.length === 0) {
      return 0
    }

    try {
      const duplicateGroups = findDuplicates(
        notebookStore.entries.filter(notebookStore.entryBelongsToCurrentScope),
        threshold,
      )

      if (duplicateGroups.length === 0) {
        emitLog('info', '未发现重复记忆')
        return 0
      }

      let mergedCount = 0
      for (const group of duplicateGroups) {
        try {
          // 合并重复条目
          const mergedEntry = mergeDuplicates(group.entry, group.duplicates)

          // 删除旧条目
          notebookStore.removeEntry(group.entry.id)
          group.duplicates.forEach(dup => notebookStore.removeEntry(dup.id))

          // 添加合并后的条目
          if (mergedEntry.kind === 'focus') {
            notebookStore.addFocusEntry(mergedEntry.text, {
              tags: mergedEntry.tags,
              metadata: mergedEntry.metadata,
            })
          }
          else {
            notebookStore.addNote(mergedEntry.text, {
              tags: mergedEntry.tags,
              metadata: mergedEntry.metadata,
            })
          }

          mergedCount += group.duplicates.length
        }
        catch (error) {
          console.error('[MemoryManager] Failed to merge duplicate group:', error)
          // 继续处理其他组
        }
      }

      lastDeduplicationAt.value = Date.now()
      const message = `已合并 ${mergedCount} 条重复记忆`
      emitLog('success', message)

      return mergedCount
    }
    catch (error) {
      console.error('[MemoryManager] Failed to deduplicate memories:', error)
      emitLog('warning', '去重过程出错')
      return 0
    }
  }

  /**
   * 知识图谱：用于语义扩展关键词
   * 将关键词映射到相关概念，提高记忆召回率
   */
  function expandKeywordsWithKnowledgeGraph(keywords: string[]): string[] {
    // 知识图谱映射表
    const knowledgeGraph: Record<string, string[]> = {
      // 动物宠物类
      猫: ['宠物', '动物', '猫粮', '猫砂', '喵', '猫咪'],
      狗: ['宠物', '动物', '狗粮', '汪', '狗狗'],
      宠物: ['猫', '狗', '动物', '养', '饲养'],
      动物: ['猫', '狗', '宠物', '生物'],

      // 工作职业类
      工作: ['职业', '公司', '上班', '就业', '工作单位', '单位'],
      职业: ['工作', '公司', '上班', '就业'],
      公司: ['工作', '职业', '上班', '企业', '单位'],
      上班: ['工作', '职业', '公司'],

      // 学习教育类
      学习: ['学校', '大学', '专业', '课程', '学业', '读书'],
      学校: ['学习', '大学', '学院', '就读', '教育'],
      大学: ['学校', '学习', '专业', '就读', '高校'],
      专业: ['学习', '大学', '学校', '学科'],
      课程: ['学习', '学校', '专业', '上课'],

      // 家庭关系类
      家人: ['父母', '爸爸', '妈妈', '兄弟', '姐妹', '家庭'],
      父母: ['爸爸', '妈妈', '家人', '家庭'],
      爸爸: ['父亲', '父母', '家人'],
      妈妈: ['母亲', '父母', '家人'],
      兄弟: ['哥哥', '弟弟', '家人'],
      姐妹: ['姐姐', '妹妹', '家人'],

      // 兴趣爱好类
      喜欢: ['爱好', '偏好', '喜爱', '兴趣'],
      爱好: ['喜欢', '偏好', '兴趣'],
      兴趣: ['喜欢', '爱好', '偏好'],

      // 地点位置类
      住: ['居住', '常住', '地址', '城市', '家'],
      居住: ['住', '常住', '地址', '城市'],
      城市: ['住', '居住', '地址', '地方'],
      地址: ['住', '居住', '城市', '位置'],

      // 饮食类
      吃: ['食物', '美食', '餐厅', '饮食'],
      食物: ['吃', '美食', '饮食'],
      美食: ['吃', '食物', '餐厅'],
      餐厅: ['吃', '美食', '饭店'],

      // 运动健康类
      运动: ['健身', '锻炼', '体育', '跑步'],
      健身: ['运动', '锻炼', '体育'],
      锻炼: ['运动', '健身', '体育'],

      // 娱乐休闲类
      游戏: ['玩', '娱乐', '电子游戏'],
      电影: ['看', '娱乐', '影片'],
      音乐: ['听', '歌', '娱乐'],
      旅游: ['旅行', '出游', '游玩'],
      旅行: ['旅游', '出游', '游玩'],

      // 情感状态类
      开心: ['高兴', '快乐', '愉快', '心情'],
      难过: ['伤心', '悲伤', '不开心', '心情'],
      生气: ['愤怒', '不满', '心情'],
      心情: ['情绪', '感受', '状态'],
    }

    const expandedKeywords = new Set<string>()

    // 遍历每个关键词，查找知识图谱中的相关概念
    for (const keyword of keywords) {
      // 保留原始关键词
      expandedKeywords.add(keyword)

      // 查找知识图谱中的映射
      if (knowledgeGraph[keyword]) {
        for (const relatedConcept of knowledgeGraph[keyword]) {
          expandedKeywords.add(relatedConcept)
        }
      }
    }

    return Array.from(expandedKeywords)
  }

  function searchRelevantMemories(
    query: string,
    limit = 5,
    options?: { entries?: NotebookEntry[], referenceTrace?: MemoryReferenceTrace, scope?: Partial<NotebookMemoryScope> },
  ) {
    if (!memorySettings.settings.enabled)
      return []
    // 输入验证
    if (!query || typeof query !== 'string' || query.trim().length === 0) {
      return []
    }

    const queryLower = query.toLowerCase()

    // 智能关键词映射：将问句转换为实际要搜索的概念
    const conceptMap: Record<string, string[]> = {
      // 身份相关
      我是谁: ['用户', '姓名', '名字', '身份', '自称'],
      叫什么: ['姓名', '名字', '用户名', '自称'],
      名字: ['姓名', '名字', '用户名', '自称'],
      是谁: ['用户', '姓名', '名字', '身份'],
      // 年龄相关
      多大: ['年龄', '岁', '出生'],
      几岁: ['年龄', '岁', '出生'],
      年龄: ['年龄', '岁', '出生'],
      // 地点相关
      住在: ['住', '居住', '常住', '地址', '城市'],
      哪里: ['住', '居住', '地址', '城市', '来自'],
      在哪: ['住', '居住', '地址', '城市'],
      // 喜好相关
      喜欢: ['喜欢', '爱好', '偏好', '喜爱'],
      爱好: ['喜欢', '爱好', '偏好', '兴趣'],
      // 学习工作相关
      学校: ['学校', '大学', '学院', '就读'],
      工作: ['工作', '职业', '公司'],
      专业: ['专业', '学', '就读'],
    }

    // 改进的关键词提取：支持中文和英文
    const keywords: string[] = []

    // 先检查是否匹配概念映射
    for (const [pattern, concepts] of Object.entries(conceptMap)) {
      if (queryLower.includes(pattern)) {
        keywords.push(...concepts)
      }
    }

    // 英文分词
    const englishWords = queryLower.split(WHITESPACE_RE).filter(k => k.length > 1)
    keywords.push(...englishWords)

    // 中文字符提取（提取 2-4 字的词组）
    const chineseChars = queryLower.match(CHINESE_SEGMENT_RE) || []
    for (const segment of chineseChars) {
      // 提取 2 字词
      for (let i = 0; i <= segment.length - 2; i++) {
        keywords.push(segment.slice(i, i + 2))
      }
      // 提取 3 字词
      for (let i = 0; i <= segment.length - 3; i++) {
        keywords.push(segment.slice(i, i + 3))
      }
      // 提取 4 字词
      for (let i = 0; i <= segment.length - 4; i++) {
        keywords.push(segment.slice(i, i + 4))
      }
      // 也保留完整的中文段落
      if (segment.length > 1) {
        keywords.push(segment)
      }
    }

    // 去重
    const uniqueKeywords = [...new Set(keywords)]

    // ========== 语义搜索：使用知识图谱扩展关键词 ==========
    let finalKeywords = uniqueKeywords
    try {
      // 检查是否启用语义搜索功能
      if (memoryAdvancedSettings.settings.enableSemanticSearch) {
        // 使用知识图谱扩展关键词
        const expandedKeywords = expandKeywordsWithKnowledgeGraph(uniqueKeywords)
        // 使用扩展后的关键词
        finalKeywords = expandedKeywords
      }
    }
    catch (error) {
      // 语义扩展失败时，降级到原有逻辑
      console.error('[MemoryManager] 语义扩展失败，降级到原有逻辑:', error)
      finalKeywords = uniqueKeywords
    }

    if (finalKeywords.length === 0) {
      return []
    }

    const now = Date.now()

    // 计算结构化相关性分数：文本/标签负责进入候选，重要性/新近度/引用/范围只做排序修正。
    const scope = notebookStore.resolveMemoryScope(options?.scope ?? options?.referenceTrace)
    const scored = (options?.entries ?? notebookStore.entries)
      .filter((entry) => {
        return notebookStore.entryBelongsToMemoryScope(entry, scope)
      })
      .filter(entry => entry.kind !== 'diary') // 排除日记
      .filter(entry => entry.metadata?.memoryKind !== 'emotion-thread')
      .filter(entry => entry.metadata?.memoryKind !== PERSONA_GROWTH_CANDIDATE_MEMORY_KIND)
      .map(entry => scoreMemoryEntryForQuery(entry, finalKeywords, queryLower, now))
      .filter(isScoredMemoryEntry)
      .sort((a, b) => {
        if (b.score !== a.score)
          return b.score - a.score
        return b.latestActivityAt - a.latestActivityAt
      })
      .slice(0, Math.max(1, Math.min(limit, 20))) // 限制在 1-20 之间

    const results = scored.map(item => item.entry)
    if (options?.referenceTrace) {
      markMemoriesReferenced(results, {
        ...options.referenceTrace,
        referenceQuery: options.referenceTrace.referenceQuery ?? query,
      })
    }

    return results
  }

  return {
    isProcessing,
    lastProcessedAt,
    lastDeduplicationAt,
    processConversationTurn,
    processCompletedChatTurnForMemory,
    stageCompletedChatTurnForMemory,
    deleteMemoriesForSourceMessage,
    disablePersonaGrowthCandidate,
    getPersonaGrowthCandidateMemories,
    getReplyFeedbackSummaryMemories,
    solidifyPersonaGrowthCandidate,
    syncPersonaGrowthCandidatesFromReplyFeedbackSummary,
    syncReplyFeedbackSummaryToLongTermMemory,
    searchRelevantMemories,
    deduplicateMemories,
    checkForDuplicates,
    onLog,
  }
})
