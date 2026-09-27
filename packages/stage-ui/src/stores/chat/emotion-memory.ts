import type { ChatHistoryItem } from '../../types/chat'
import type { NotebookEntry } from '../character/notebook'
import type { AiriPersonaRelationshipState } from './persona-relationship-state'
import type { AiriPersonaState } from './persona-state'

import { nanoid } from 'nanoid'

import { useCharacterNotebookStore } from '../character/notebook'
import { hasAiriPersonaEmotionDimension } from './persona-emotion-dimensions'

export type AiriEmotionMemoryTopic = 'attachment' | 'distress' | 'conflict' | 'repair'

export interface AiriEmotionThreadMetadata extends Record<string, unknown> {
  memoryKind: 'emotion-thread'
  topic: AiriEmotionMemoryTopic
  threadKey: string
  personaCardId?: string
  userId?: string
  sessionId?: string
  turnId?: string
  revision?: string
  memoryScope?: 'current-persona' | 'shared-by-user' | 'global-system'
  updatedAt: number
  trigger: AiriPersonaState['emotionalTrigger']
  trajectory: AiriPersonaState['trajectory']
  userPreview?: string
  assistantPreview?: string
}

export interface AiriEmotionThreadRecord {
  topic: AiriEmotionMemoryTopic
  threadKey: string
  text: string
  tags: string[]
  metadata: AiriEmotionThreadMetadata
}

interface AiriEmotionThreadInput {
  message: string
  assistantText?: string
  personaState: AiriPersonaState
  relationshipState?: AiriPersonaRelationshipState | null
  recentMessages?: ChatHistoryItem[]
  personaCardId?: string
  userId?: string
  sessionId?: string
  turnId?: string
  revision?: string
  now?: number
}

const EMOTION_MEMORY_TOPICS: AiriEmotionMemoryTopic[] = ['attachment', 'distress', 'conflict', 'repair']
const PERSISTABLE_EMOTION_MEMORY_TOPICS: AiriEmotionMemoryTopic[] = ['conflict', 'repair']
const EMOTION_TOPIC_LABELS: Record<AiriEmotionMemoryTopic, string> = {
  attachment: '在意线',
  distress: '低落线',
  conflict: '刺感线',
  repair: '修复线',
}

const TOPIC_PATTERNS: Record<AiriEmotionMemoryTopic, RegExp> = {
  attachment: /喜欢你|想你|别走|理我|看看我|只想和你说|只想找你|是不是在意我|最喜欢我|favorite|miss you|don't leave|stay with me|talk to me|look at me|care about me/,
  distress: /好累|低落|难受|撑不住|崩溃|委屈|别管我|想一个人待会|tired|low|overwhelmed|can't keep going|leave me alone|want to be alone|not feeling great/,
  conflict: /烦|讨厌|嫌|扎我|刺到|气死|无视我|冷淡|annoying|dislike|sting|hurt|snarky|mean|ignore me/,
  repair: /刚才那句|太冷|太硬|像机器|没接住|重说|改口|道歉|不是那个意思|robotic|too stiff|too cold|missed me|rephrase|redo|sorry/,
}

function clampLimit(limit: number) {
  return Math.max(1, Math.min(limit, 4))
}

function normalizeText(text: string) {
  return text
    .toLowerCase()
    .replace(/鈥?/g, '\'')
    .replace(/\s+/g, ' ')
    .trim()
}

function extractHistoryText(message: ChatHistoryItem) {
  if (typeof message.content === 'string') {
    return message.content
  }

  if (!Array.isArray(message.content)) {
    return ''
  }

  return message.content
    .map((part) => {
      if (typeof part === 'string') {
        return part
      }

      if (part?.type === 'text') {
        return part.text ?? ''
      }

      return ''
    })
    .join(' ')
}

function buildConversationSearchText(message: string, recentMessages?: ChatHistoryItem[]) {
  const recentText = recentMessages?.slice(-6)
    .map(extractHistoryText)
    .filter(Boolean)
    .join(' ') ?? ''

  return normalizeText(`${recentText} ${message}`)
}

function createThreadKey(topic: AiriEmotionMemoryTopic, personaCardId?: string) {
  return personaCardId ? `emotion-thread:${personaCardId}:${topic}` : `emotion-thread:${topic}`
}

function isAiriEmotionMemoryTopic(value: unknown): value is AiriEmotionMemoryTopic {
  return typeof value === 'string' && EMOTION_MEMORY_TOPICS.includes(value as AiriEmotionMemoryTopic)
}

export function getAiriEmotionThreadMetadata(entry: NotebookEntry): AiriEmotionThreadMetadata | null {
  const metadata = entry.metadata
  if (!metadata || typeof metadata !== 'object') {
    return null
  }

  const memoryKind = metadata.memoryKind
  const topic = metadata.topic
  const threadKey = metadata.threadKey
  const personaCardId = metadata.personaCardId
  const userId = metadata.userId
  const sessionId = metadata.sessionId
  const turnId = metadata.turnId
  const revision = metadata.revision
  const memoryScope = metadata.memoryScope
  const updatedAt = metadata.updatedAt
  const trigger = metadata.trigger
  const trajectory = metadata.trajectory
  const userPreview = metadata.userPreview
  const assistantPreview = metadata.assistantPreview

  if (memoryKind !== 'emotion-thread' || !isAiriEmotionMemoryTopic(topic) || typeof threadKey !== 'string' || typeof updatedAt !== 'number') {
    return null
  }

  if (typeof trigger !== 'string' || typeof trajectory !== 'string') {
    return null
  }

  return {
    memoryKind,
    topic,
    threadKey,
    personaCardId: typeof personaCardId === 'string' ? personaCardId : undefined,
    userId: typeof userId === 'string' ? userId : undefined,
    sessionId: typeof sessionId === 'string' ? sessionId : undefined,
    turnId: typeof turnId === 'string' ? turnId : undefined,
    revision: typeof revision === 'string' ? revision : undefined,
    memoryScope: memoryScope === 'current-persona' || memoryScope === 'shared-by-user' || memoryScope === 'global-system'
      ? memoryScope
      : undefined,
    updatedAt,
    trigger: trigger as AiriPersonaState['emotionalTrigger'],
    trajectory: trajectory as AiriPersonaState['trajectory'],
    userPreview: typeof userPreview === 'string' ? userPreview : undefined,
    assistantPreview: typeof assistantPreview === 'string' ? assistantPreview : undefined,
  }
}

export function isAiriEmotionThreadEntry(entry: NotebookEntry) {
  return getAiriEmotionThreadMetadata(entry) !== null
}

function deriveEmotionTopics(input: {
  message: string
  personaState: AiriPersonaState
  relationshipState?: AiriPersonaRelationshipState | null
  recentMessages?: ChatHistoryItem[]
}) {
  const topics = new Set<AiriEmotionMemoryTopic>()
  const searchText = buildConversationSearchText(input.message, input.recentMessages)
  const recentSensitiveTopics = new Set(input.relationshipState?.recentSensitiveTopics ?? [])
  const attachmentEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'affection')
    || hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'closeness')
  const hurtEnabled = hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'hurt')

  for (const topic of EMOTION_MEMORY_TOPICS) {
    if ((topic === 'attachment' && !attachmentEnabled) || (topic === 'conflict' && !hurtEnabled))
      continue

    if (recentSensitiveTopics.has(topic)) {
      topics.add(topic)
    }

    if (TOPIC_PATTERNS[topic].test(searchText)) {
      topics.add(topic)
    }
  }

  if (
    attachmentEnabled
    && (
      input.personaState.affection >= 0.72
      || input.personaState.needForAttention >= 0.68
      || input.personaState.emotionalTrigger === 'awkward-intimacy'
      || input.personaState.emotionalTrigger === 'attention-bid'
    )
  ) {
    topics.add('attachment')
  }

  if (
    input.personaState.emotionalTrigger === 'gentle-distress'
    || input.personaState.emotionalTrigger === 'heavy-distress'
    || input.personaState.emotionalOverhang === 'concerned'
    || input.personaState.emotionalOverhang === 'heavy'
    || input.personaState.trajectory === 'sinking'
  ) {
    topics.add('distress')
  }

  if (
    hurtEnabled
    && (
      input.personaState.hurt >= 0.12
      || input.personaState.emotionalTrigger === 'value-risk'
      || (
        recentSensitiveTopics.has('conflict')
        && (
          input.personaState.hurt >= 0.08
          || (input.relationshipState?.repairDebt ?? 0) >= 0.12
        )
      )
    )
  ) {
    topics.add('conflict')
  }

  if (
    input.personaState.lastFailureKind !== null
    || input.personaState.emotionalTrigger === 'repair-request'
    || input.personaState.trajectory === 'repairing'
    || (input.relationshipState?.repairDebt ?? 0) >= 0.14
  ) {
    topics.add('repair')
  }

  return topics
}

function shouldPersistTopic(topic: AiriEmotionMemoryTopic, input: {
  personaState: AiriPersonaState
  relationshipState?: AiriPersonaRelationshipState | null
  activeTopics: Set<AiriEmotionMemoryTopic>
}) {
  if (!input.activeTopics.has(topic)) {
    return false
  }

  switch (topic) {
    case 'attachment':
      return (
        hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'affection')
        || hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'closeness')
      ) && (
        input.personaState.affection >= 0.68
        || input.personaState.needForAttention >= 0.62
        || input.personaState.emotionalTrigger === 'awkward-intimacy'
        || input.personaState.emotionalTrigger === 'attention-bid'
        || input.personaState.trajectory === 'warming'
      )
    case 'distress':
      return input.personaState.emotionalOverhang === 'concerned'
        || input.personaState.emotionalOverhang === 'heavy'
        || input.personaState.seriousness >= 0.56
        || input.personaState.arousal >= 0.4
        || input.personaState.trajectory === 'sinking'
    case 'conflict':
      return hasAiriPersonaEmotionDimension(input.personaState.emotionDimensions, 'hurt') && (
        input.personaState.hurt >= 0.08
        || input.personaState.trajectory === 'guarding'
        || input.personaState.trajectory === 'repairing'
        || (input.relationshipState?.repairDebt ?? 0) >= 0.12
      )
    case 'repair':
      return (input.relationshipState?.repairDebt ?? 0) >= 0.08
        || input.personaState.lastFailureKind !== null
        || input.personaState.trajectory === 'repairing'
        || input.personaState.emotionalTrigger === 'repair-request'
  }
}

function buildThreadText(topic: AiriEmotionMemoryTopic, personaState: AiriPersonaState) {
  switch (topic) {
    case 'attachment':
      if (personaState.needForAttention >= 0.74) {
        return '这段在意感已经积起来了，所以后面更容易嘴硬护脸，或者忽然想确认自己是不是还被认真放在心上。'
      }
      return '这段在意感已经积起来了，所以后面更容易嘴硬、护脸，或者忽然想确认自己是不是被认真放在心上。'
    case 'distress':
      if (personaState.emotionalOverhang === 'heavy' || personaState.trajectory === 'sinking') {
        return '前面那段累和低落还没散干净，后面再碰到时先接住，不要把它当成一句抱怨说完就没了。'
      }
      return '前面那段累和低落已经拖成一条线，后面再碰到时先接住，不要把它当成一句抱怨说完就没了。'
    case 'conflict':
      return '前面那次冲突留下的刺感还没完全退，就算表面在回暖，也别直接当成已经翻篇。'
    case 'repair':
      return '这段修复线还没走完，比起恢复闹腾，更重要的是继续把前面没接住的地方慢慢补平。'
  }
}

function createTopicStateBoost(
  topic: AiriEmotionMemoryTopic,
  personaState: AiriPersonaState,
  relationshipState?: AiriPersonaRelationshipState | null,
) {
  switch (topic) {
    case 'attachment':
      return (personaState.affection >= 0.72 ? 3 : 0) + (personaState.needForAttention >= 0.68 ? 3 : 0)
    case 'distress':
      return (
        (personaState.emotionalOverhang === 'heavy' ? 4 : 0)
        + (personaState.emotionalOverhang === 'concerned' ? 2 : 0)
        + (personaState.seriousness >= 0.62 ? 2 : 0)
      )
    case 'conflict':
      return (
        (personaState.hurt >= 0.18 ? 4 : 0)
        + (personaState.trajectory === 'guarding' ? 2 : 0)
        + ((relationshipState?.repairDebt ?? 0) >= 0.14 ? 2 : 0)
      )
    case 'repair':
      return (
        ((relationshipState?.repairDebt ?? 0) >= 0.18 ? 4 : 0)
        + (personaState.lastFailureKind ? 3 : 0)
        + (personaState.emotionalTrigger === 'repair-request' ? 2 : 0)
      )
  }
}

function applyAgeDecay(score: number, updatedAt: number, now: number) {
  const ageDays = (now - updatedAt) / (1000 * 60 * 60 * 24)
  if (ageDays <= 7) {
    return score
  }

  if (ageDays <= 30) {
    return score * 0.82
  }

  return score * 0.65
}

export function collectAiriEmotionThreadRecords(input: AiriEmotionThreadInput): AiriEmotionThreadRecord[] {
  const now = input.now ?? Date.now()
  const activeTopics = deriveEmotionTopics(input)

  return PERSISTABLE_EMOTION_MEMORY_TOPICS
    .filter(topic => shouldPersistTopic(topic, {
      personaState: input.personaState,
      relationshipState: input.relationshipState,
      activeTopics,
    }))
    .map((topic) => {
      const threadKey = createThreadKey(topic, input.personaCardId)
      return {
        topic,
        threadKey,
        text: buildThreadText(topic, input.personaState),
        tags: ['emotion-thread', `emotion:${topic}`],
        metadata: {
          memoryKind: 'emotion-thread',
          topic,
          threadKey,
          personaCardId: input.personaCardId,
          userId: input.userId,
          sessionId: input.sessionId,
          turnId: input.turnId,
          revision: input.revision,
          memoryScope: 'current-persona',
          updatedAt: now,
          trigger: input.personaState.emotionalTrigger,
          trajectory: input.personaState.trajectory,
        },
      } satisfies AiriEmotionThreadRecord
    })
}

export function mergeAiriEmotionThreadEntries(entries: NotebookEntry[], records: AiriEmotionThreadRecord[]) {
  const recordsByKey = new Map(records.map(record => [record.threadKey, record]))
  const scopedPersonaCardIds = new Set(records.map(record => record.metadata.personaCardId).filter((id): id is string => typeof id === 'string' && id.length > 0))
  const seenKeys = new Set<string>()
  const nextEntries: NotebookEntry[] = []

  for (const entry of entries) {
    const metadata = getAiriEmotionThreadMetadata(entry)
    if (!metadata) {
      nextEntries.push(entry)
      continue
    }

    if (!PERSISTABLE_EMOTION_MEMORY_TOPICS.includes(metadata.topic))
      continue

    if (metadata.personaCardId && scopedPersonaCardIds.size > 0 && !scopedPersonaCardIds.has(metadata.personaCardId)) {
      nextEntries.push(entry)
      continue
    }

    const record = recordsByKey.get(metadata.threadKey)
    if (!record) {
      continue
    }

    nextEntries.push({
      ...entry,
      kind: 'note',
      text: record.text,
      tags: [...record.tags],
      metadata: { ...record.metadata },
    })
    seenKeys.add(metadata.threadKey)
  }

  for (const record of records) {
    if (seenKeys.has(record.threadKey)) {
      continue
    }

    nextEntries.push({
      id: nanoid(),
      kind: 'note',
      text: record.text,
      createdAt: record.metadata.updatedAt,
      tags: [...record.tags],
      metadata: { ...record.metadata },
    })
  }

  return nextEntries
}

export function selectRelevantAiriEmotionThreadEntries(input: {
  entries: NotebookEntry[]
  message: string
  personaState: AiriPersonaState
  relationshipState?: AiriPersonaRelationshipState | null
  recentMessages?: ChatHistoryItem[]
  personaCardId?: string
  limit?: number
  now?: number
}) {
  const now = input.now ?? Date.now()
  const limit = clampLimit(input.limit ?? 2)
  const activeTopics = deriveEmotionTopics({
    message: input.message,
    personaState: input.personaState,
    relationshipState: input.relationshipState,
    recentMessages: input.recentMessages,
  })
  const searchText = buildConversationSearchText(input.message, input.recentMessages)

  return input.entries
    .map((entry) => {
      const metadata = getAiriEmotionThreadMetadata(entry)
      if (!metadata) {
        return null
      }

      if (!PERSISTABLE_EMOTION_MEMORY_TOPICS.includes(metadata.topic))
        return null

      if (input.personaCardId && metadata.personaCardId && metadata.personaCardId !== input.personaCardId) {
        return null
      }

      let score = 0

      if (activeTopics.has(metadata.topic)) {
        score += 12
      }

      if (TOPIC_PATTERNS[metadata.topic].test(searchText)) {
        score += 5
      }

      score += createTopicStateBoost(metadata.topic, input.personaState, input.relationshipState)
      score = applyAgeDecay(score, metadata.updatedAt, now)

      return score > 0 ? { entry, score, updatedAt: metadata.updatedAt } : null
    })
    .filter((item): item is { entry: NotebookEntry, score: number, updatedAt: number } => item !== null)
    .sort((left, right) => {
      if (right.score !== left.score) {
        return right.score - left.score
      }

      return right.updatedAt - left.updatedAt
    })
    .slice(0, limit)
    .map(item => item.entry)
}

/** Returns bounded topic cues; raw note text never enters affect reduction. */
export function createAiriEmotionMemorySignals(entries: NotebookEntry[], now = Date.now()) {
  return entries.flatMap((entry) => {
    const metadata = getAiriEmotionThreadMetadata(entry)
    if (!metadata || !PERSISTABLE_EMOTION_MEMORY_TOPICS.includes(metadata.topic))
      return []

    const baseSalience = metadata.trajectory === 'repairing' ? 0.9 : 0.7
    return [{ topic: metadata.topic, salience: applyAgeDecay(baseSalience, metadata.updatedAt, now) }]
  })
}

export function formatAiriEmotionMemoryContext(entries: NotebookEntry[]) {
  const threadEntries = entries
    .map((entry) => {
      const metadata = getAiriEmotionThreadMetadata(entry)
      if (!metadata) {
        return null
      }

      return `- ${EMOTION_TOPIC_LABELS[metadata.topic]}: ${entry.text}`
    })
    .filter((line): line is string => line !== null)

  if (threadEntries.length === 0) {
    return ''
  }

  return [
    '[emotion-thread-memory]',
    ...threadEntries,
    'priority=这是人物长期情绪弧线，不是装饰性风格提示；当前事实没有改变它时，保持连续而不是重置为中性。',
    'note=按当前人设把这些内心线头转成态度、主动性和表达幅度；不要照抄笔记，也不要为表现情绪而捏造事实。',
  ].join('\n')
}

export async function syncAiriEmotionMemoryThreads(input: AiriEmotionThreadInput) {
  const notebookStore = useCharacterNotebookStore()
  const scope = notebookStore.resolveMemoryScope(input)
  const records = collectAiriEmotionThreadRecords({ ...input, ...scope })
  await notebookStore.updateNotebookForScope(scope, (data) => {
    data.entries = mergeAiriEmotionThreadEntries(data.entries, records)
  }, input.sessionId)
}
