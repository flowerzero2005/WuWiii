import type { NotebookEntry, NotebookMemoryScope } from '../stores/character/notebook'

import { tool } from '@xsai/tool'
import { z } from 'zod'

import { searchRelevantNotebookMemories } from '../stores/chat/context-providers/notebook-memory'

const COMPACT_WHITESPACE_RE = /\s+/g
const PERSONA_GROWTH_MEMORY_PREFIX_RE = /^人格成长记忆：/
const PERSONA_GROWTH_CANDIDATE_PREFIX_RE = /^人格成长候选（未固化）：/

function compactMemoryToolText(text: string, maxLength = 1600) {
  return text.replace(COMPACT_WHITESPACE_RE, ' ').trim().slice(0, maxLength)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function sanitizeMemoryToolText(text: string) {
  return compactMemoryToolText(text)
    .replace(PERSONA_GROWTH_MEMORY_PREFIX_RE, '')
    .replace(PERSONA_GROWTH_CANDIDATE_PREFIX_RE, '')
}

function getMemoryToolNodeCues(value: unknown) {
  if (!isRecord(value))
    return []

  return Object.values(value)
    .map(item => typeof item === 'string' ? compactMemoryToolText(item, 400) : '')
    .filter(Boolean)
}

function getMemoryToolFeatureCues(value: unknown) {
  if (!isRecord(value))
    return []

  return Object.entries(value)
    .map(([feature, info]) => {
      const detail = isRecord(info) && typeof info.text === 'string'
        ? compactMemoryToolText(info.text, 400)
        : ''

      return detail ? `${compactMemoryToolText(feature, 100)}: ${detail}` : compactMemoryToolText(feature, 400)
    })
    .filter(Boolean)
}

function getTimestamp(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string') {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed))
      return parsed
  }
  return undefined
}

function formatRelativeAge(timestamp: number, now = Date.now()) {
  const elapsedMs = Math.max(0, now - timestamp)
  if (elapsedMs < 60_000)
    return 'less than a minute ago'
  const minutes = Math.floor(elapsedMs / 60_000)
  if (minutes < 60)
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24)
    return `${hours} hour${hours === 1 ? '' : 's'} ago`
  const days = Math.floor(hours / 24)
  if (days < 30)
    return `${days} day${days === 1 ? '' : 's'} ago`
  const months = Math.floor(days / 30)
  if (months < 12)
    return `${months} month${months === 1 ? '' : 's'} ago`
  const years = Math.floor(months / 12)
  return `${years} year${years === 1 ? '' : 's'} ago`
}

function addTemporalMetadata(note: Record<string, unknown>, memory: NotebookEntry, now = Date.now()) {
  const sourceCreatedAt = getTimestamp(memory.metadata?.sourceCreatedAt)
  if (sourceCreatedAt !== undefined) {
    note.sourceCreatedAt = sourceCreatedAt
    note.sourceTime = new Date(sourceCreatedAt).toISOString()
    note.sourceAge = formatRelativeAge(sourceCreatedAt, now)
  }
  else {
    note.sourceTime = 'unknown; the original event time was not recorded'
  }

  const recordedAt = getTimestamp(memory.createdAt)
  if (recordedAt !== undefined) {
    note.recordedAt = new Date(recordedAt).toISOString()
    note.recordedAge = formatRelativeAge(recordedAt, now)
  }

  for (const field of ['extractedAt', 'lastReferencedAt'] as const) {
    const timestamp = getTimestamp(memory.metadata?.[field])
    if (timestamp !== undefined)
      note[field] = new Date(timestamp).toISOString()
  }

  note.temporalGuidance = 'sourceTime is when the remembered event/conversation happened; recordedAt is when this note was stored. Never treat recordedAt as the event time.'
}

function formatMemoryToolNote(memory: NotebookEntry) {
  const note: Record<string, unknown> = {
    note: sanitizeMemoryToolText(memory.text),
  }

  addTemporalMetadata(note, memory)

  if (typeof memory.metadata?.memoryKey === 'string')
    note.memoryKey = compactMemoryToolText(memory.metadata.memoryKey, 200)
  if (typeof memory.metadata?.memoryType === 'string')
    note.memoryType = compactMemoryToolText(memory.metadata.memoryType, 120)
  if (typeof memory.metadata?.memoryContext === 'string')
    note.memoryContext = compactMemoryToolText(memory.metadata.memoryContext, 800)
  if (Array.isArray(memory.metadata?.involvedPeople)) {
    note.involvedPeople = memory.metadata.involvedPeople
      .filter((person): person is string => typeof person === 'string' && person.trim().length > 0)
      .map(person => compactMemoryToolText(person, 120))
  }
  if (typeof memory.metadata?.antecedent === 'string')
    note.antecedent = compactMemoryToolText(memory.metadata.antecedent, 500)
  if (typeof memory.metadata?.outcome === 'string')
    note.outcome = compactMemoryToolText(memory.metadata.outcome, 500)
  if (typeof memory.metadata?.timeExpression === 'string')
    note.timeExpression = compactMemoryToolText(memory.metadata.timeExpression, 120)

  const context = getMemoryToolNodeCues(memory.metadata?.nodeSummaries).slice(0, 3)
  const stableCues = getMemoryToolFeatureCues(memory.metadata?.featureTimeline).slice(0, 3)

  if (context.length > 0)
    note.context = context

  if (stableCues.length > 0)
    note.stableCues = stableCues

  return note
}

export function createMemoryTool(scope?: Partial<NotebookMemoryScope>): ReturnType<typeof tool> {
  return tool({
    name: 'search_memory',
    description: 'Search the current character’s local long-term memory when it would materially help answer, understand the user, continue a relationship thread, or avoid losing context. You may use it even when the user did not explicitly ask for recall, but avoid frequent nostalgic callbacks or searching for greetings, ordinary small talk, generic opinions, hypotheticals, or incidental mentions of memory/reminders. Use results as private background for a natural reply; do not expose memory fields, sources, labels, or the search process unless explicitly asked.',
    parameters: z.object({
      query: z.string().describe('Search query for the relevant user fact, relationship thread, preference, plan, event, context, person, or topic.'),
      limit: z.number().optional().default(5).describe('Maximum number of memories to return, bounded to a small result. Defaults to 5.'),
    }),
    execute: async ({ query, limit = 5 }) => {
      try {
        const { useChatSessionStore } = await import('../stores/chat/session-store')
        const chatSession = useChatSessionStore()

        const memories = await searchRelevantNotebookMemories(query, limit, {
          referenceTrace: {
            referenceSessionId: chatSession.activeSessionId,
            referenceSource: 'tool:search_memory',
          },
          scope,
        })

        if (memories.length === 0) {
          return {
            success: true,
            message: 'No relevant long-term memory was found.',
            privateGuidance: 'Answer naturally from the current conversation. Do not mention that memory was empty or that a search occurred.',
            memoryNotes: [],
          }
        }

        return {
          success: true,
          message: `Found ${memories.length} relevant long-term memory note${memories.length === 1 ? '' : 's'}.`,
          privateGuidance: 'Treat these as private background. Integrate at most one relevant point only when it naturally helps the current topic. Do not say “according to memory” and do not expose fields, sources, labels, timestamps, or the search process. Keep event time (sourceTime) distinct from storage time (recordedAt).',
          memoryNotes: memories.map(formatMemoryToolNote),
        }
      }
      catch (error) {
        console.error('[MemoryTool] Search failed:', error)
        return {
          success: false,
          message: 'Memory search failed.',
          error: error instanceof Error ? error.message : String(error),
        }
      }
    },
  })
}

export const memoryTool = createMemoryTool()
