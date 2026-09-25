import type { PlaybackItem } from '../types'

import { describe, expect, it } from 'vitest'

import { createPlaybackManager } from './playback-manager'

function item(id: string): PlaybackItem<string> {
  return {
    id,
    streamId: 'stream',
    intentId: 'turn',
    segmentId: id,
    ownerId: 'airi',
    priority: 0,
    text: id,
    special: null,
    audio: id,
    createdAt: Date.now(),
  }
}

describe('playback manager', () => {
  it('queues same-owner segments instead of interrupting the first one', async () => {
    const starts: string[] = []
    const resolvers = new Map<string, () => void>()
    const manager = createPlaybackManager<string>({
      play: (entry) => {
        starts.push(entry.text)
        return new Promise<void>((resolve) => {
          resolvers.set(entry.id, resolve)
        })
      },
      maxVoices: 1,
      overflowPolicy: 'queue',
    })

    manager.schedule(item('first'))
    manager.schedule(item('second'))

    expect(starts).toEqual(['first'])
    resolvers.get('first')?.()
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(starts).toEqual(['first', 'second'])
  })
})
