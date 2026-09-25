import type { NotebookEntry } from '../character/notebook'

import { describe, expect, it, vi } from 'vitest'

import {
  collectAiriEmotionThreadRecords,
  createAiriEmotionMemorySignals,
  formatAiriEmotionMemoryContext,
  mergeAiriEmotionThreadEntries,
  selectRelevantAiriEmotionThreadEntries,
} from './emotion-memory'
import { createDefaultAiriRelationshipState } from './persona-relationship-state'
import { createDefaultAiriPersonaState } from './persona-state'

vi.mock('../character/notebook', () => ({
  useCharacterNotebookStore: () => ({
    entries: [],
    isLoaded: true,
    activePersonaCardId: 'default',
  }),
}))

function createEmotionEntry(topic: 'attachment' | 'distress' | 'conflict' | 'repair', text: string, updatedAt = 100): NotebookEntry {
  return {
    id: `emotion-${topic}`,
    kind: 'note',
    text,
    createdAt: updatedAt - 10,
    tags: ['emotion-thread', `emotion:${topic}`],
    metadata: {
      memoryKind: 'emotion-thread',
      topic,
      threadKey: `emotion-thread:${topic}`,
      updatedAt,
      trigger: 'none',
      trajectory: 'steady',
      userPreview: '',
      assistantPreview: '',
    },
  }
}

describe('emotion-memory', () => {
  it('does not persist or recall attachment and hurt threads for an ordinary card with those dimensions disabled', () => {
    const personaState = {
      ...createDefaultAiriPersonaState([], false),
      seriousness: 0.7,
    }
    const relationshipState = {
      ...createDefaultAiriRelationshipState([], false),
      recentSensitiveTopics: ['attachment', 'conflict'] as const,
    }
    const records = collectAiriEmotionThreadRecords({
      message: '我喜欢你，但刚才那句也有点扎。',
      assistantText: '我听到了。',
      personaState,
      relationshipState: {
        ...relationshipState,
        recentSensitiveTopics: [...relationshipState.recentSensitiveTopics],
      },
      now: 1000,
    })
    const selected = selectRelevantAiriEmotionThreadEntries({
      entries: [
        createEmotionEntry('attachment', '旧的在意线', 100),
        createEmotionEntry('conflict', '旧的刺感线', 120),
      ],
      message: '我喜欢你，但刚才那句也有点扎。',
      personaState,
      relationshipState: {
        ...relationshipState,
        recentSensitiveTopics: [...relationshipState.recentSensitiveTopics],
      },
      now: 1000,
    })

    expect(records.map(record => record.topic)).not.toEqual(expect.arrayContaining(['attachment', 'conflict']))
    expect(selected).toEqual([])
  })

  it('collects unresolved conflict and repair threads from the latest emotional state', () => {
    const records = collectAiriEmotionThreadRecords({
      message: '你刚才那句还是有点像机器，而且扎我一下。',
      assistantText: '那句太硬了，我重说。',
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.24,
        affection: 0.62,
        seriousness: 0.72,
        arousal: 0.7,
        inhibition: 0.64,
        trajectory: 'repairing',
        emotionalTrigger: 'repair-request',
        lastFailureKind: 'too-hard',
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.26,
        recentSensitiveTopics: ['conflict', 'repair'],
      },
      now: 1000,
    })

    expect(records.map(record => record.topic)).toEqual(['conflict', 'repair'])
    expect(records[0]?.text).toContain('冲突留下的刺感')
    expect(records[1]?.text).toContain('修复线还没走完')
    expect(records[1]?.metadata.memoryKind).toBe('emotion-thread')
    expect(records[1]?.metadata.threadKey).toBe('emotion-thread:repair')
    expect(records[1]?.metadata.userPreview).toBeUndefined()
    expect(records[1]?.metadata.assistantPreview).toBeUndefined()
  })

  it('merges active emotion-thread entries while removing stale ones', () => {
    const baseEntries: NotebookEntry[] = [
      {
        id: 'note-1',
        kind: 'note',
        text: '普通记忆',
        createdAt: 1,
      },
      createEmotionEntry('attachment', '旧的在意线', 100),
      createEmotionEntry('conflict', '旧的刺感线', 120),
    ]
    const records = collectAiriEmotionThreadRecords({
      message: '你刚才那句还是有点扎。',
      assistantText: '我收一点，重新说。',
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.2,
        seriousness: 0.66,
        arousal: 0.64,
        trajectory: 'guarding',
        emotionalTrigger: 'value-risk',
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.06,
        recentSensitiveTopics: ['conflict'],
      },
      now: 500,
    })

    const mergedEntries = mergeAiriEmotionThreadEntries(baseEntries, records)

    expect(mergedEntries).toHaveLength(2)
    expect(mergedEntries[0]?.id).toBe('note-1')
    expect(mergedEntries.find(entry => entry.id === 'emotion-attachment')).toBeUndefined()
    expect(mergedEntries.find(entry => entry.id === 'emotion-conflict')?.text).toContain('还没完全退')
  })

  it('selects the most relevant long-horizon thread for the current turn', () => {
    const entries: NotebookEntry[] = [
      createEmotionEntry('attachment', '这段在意感已经积起来了。', 100),
      createEmotionEntry('distress', '前面那段累和低落已经拖成一条线。', 200),
    ]

    const selected = selectRelevantAiriEmotionThreadEntries({
      entries,
      message: '今天真的好累，我想先安静一会。',
      personaState: {
        ...createDefaultAiriPersonaState(),
        seriousness: 0.78,
        arousal: 0.62,
        inhibition: 0.74,
        emotionalOverhang: 'heavy',
        emotionalTrigger: 'heavy-distress',
        trajectory: 'sinking',
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['distress'],
      },
      limit: 1,
      now: 400,
    })

    expect(selected).toEqual([])
  })

  it('scopes emotion thread keys and recall by persona card', () => {
    const records = collectAiriEmotionThreadRecords({
      message: '你刚才那句还是有点扎。',
      assistantText: '我收一点。',
      personaCardId: 'miside',
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.2,
        seriousness: 0.66,
        arousal: 0.64,
        trajectory: 'guarding',
        emotionalTrigger: 'value-risk',
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.06,
        recentSensitiveTopics: ['conflict'],
      },
      now: 500,
    })

    expect(records[0]?.threadKey).toBe('emotion-thread:miside:conflict')
    expect(records[0]?.metadata.personaCardId).toBe('miside')

    const selected = selectRelevantAiriEmotionThreadEntries({
      entries: [
        {
          ...createEmotionEntry('conflict', 'miside 的刺感线', 500),
          metadata: {
            ...createEmotionEntry('conflict', 'miside 的刺感线', 500).metadata,
            threadKey: 'emotion-thread:miside:conflict',
            personaCardId: 'miside',
          },
        },
        {
          ...createEmotionEntry('conflict', 'other 的刺感线', 600),
          metadata: {
            ...createEmotionEntry('conflict', 'other 的刺感线', 600).metadata,
            threadKey: 'emotion-thread:other:conflict',
            personaCardId: 'other',
          },
        },
      ],
      message: '刚才那句有点扎我。',
      personaCardId: 'miside',
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.2,
        trajectory: 'guarding',
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        recentSensitiveTopics: ['conflict'],
      },
      limit: 2,
      now: 700,
    })

    expect(selected).toHaveLength(1)
    expect(selected[0]?.metadata?.personaCardId).toBe('miside')
  })

  it('keeps frozen turn attribution and decays stale thread salience', () => {
    const records = collectAiriEmotionThreadRecords({
      message: 'That reply hurt and still needs repair.',
      assistantText: 'I will rephrase it.',
      personaCardId: 'persona-a',
      userId: 'user-a',
      sessionId: 'session-a',
      turnId: 'turn-a',
      revision: 'model-a',
      personaState: {
        ...createDefaultAiriPersonaState(),
        hurt: 0.2,
        trajectory: 'repairing',
        emotionalTrigger: 'repair-request',
      },
      relationshipState: {
        ...createDefaultAiriRelationshipState(),
        repairDebt: 0.2,
        recentSensitiveTopics: ['conflict', 'repair'],
      },
      now: 100,
    })
    expect(records[0]?.metadata).toMatchObject({
      personaCardId: 'persona-a',
      userId: 'user-a',
      sessionId: 'session-a',
      turnId: 'turn-a',
      revision: 'model-a',
    })

    const entry = {
      ...createEmotionEntry('repair', 'unfinished repair', 100),
      metadata: records.find(record => record.topic === 'repair')!.metadata,
    }
    const fresh = createAiriEmotionMemorySignals([entry], 100)[0]!
    const stale = createAiriEmotionMemorySignals([entry], 100 + 31 * 24 * 60 * 60 * 1000)[0]!
    expect(stale.salience).toBeLessThan(fresh.salience)
  })

  it('formats recalled emotion threads into a dedicated context block', () => {
    const contextText = formatAiriEmotionMemoryContext([
      createEmotionEntry('repair', '这段修复线还没走完。', 100),
      createEmotionEntry('conflict', '前面那次冲突留下的刺感还没完全退。', 120),
    ])

    expect(contextText).toContain('[emotion-thread-memory]')
    expect(contextText).toContain('修复线: 这段修复线还没走完。')
    expect(contextText).toContain('刺感线: 前面那次冲突留下的刺感还没完全退。')
    expect(contextText).toContain('不要照抄')
    expect(contextText).toContain('priority=这是人物长期情绪弧线')
    expect(contextText).toContain('不要为表现情绪而捏造事实')
  })
})
