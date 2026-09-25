import { describe, expect, it } from 'vitest'

import {
  drainGroupSpeaker,
  drainGroupTurn,
  finishGroupSpeaker,
  finishGroupTurn,
  GROUP_SPEAKER_IDLE_TIMEOUT_MS,
  isGroupSpeakerIdle,
  noteGroupSpeakerMilestone,
  noteGroupSpeakerProgress,
  startGroupSpeaker,
  startGroupTurn,
} from './group-turn-run-state'

describe('group turn run ownership', () => {
  it('renews a slow streaming speaker from its latest progress instead of total run time', () => {
    let state = startGroupTurn(undefined, { runId: 'run-1', sessionId: 'room-1' })
    state = startGroupSpeaker(state, 'run-1', 'speaker-1', 0)

    state = noteGroupSpeakerProgress(state, 'run-1', 'speaker-1', GROUP_SPEAKER_IDLE_TIMEOUT_MS - 1)
    expect(isGroupSpeakerIdle(state, 'run-1', 'speaker-1', GROUP_SPEAKER_IDLE_TIMEOUT_MS)).toBe(false)

    state = noteGroupSpeakerProgress(state, 'run-1', 'speaker-1', GROUP_SPEAKER_IDLE_TIMEOUT_MS * 2 - 2)
    expect(isGroupSpeakerIdle(state, 'run-1', 'speaker-1', GROUP_SPEAKER_IDLE_TIMEOUT_MS * 2)).toBe(false)
    expect(isGroupSpeakerIdle(state, 'run-1', 'speaker-1', GROUP_SPEAKER_IDLE_TIMEOUT_MS * 3 - 2)).toBe(true)
  })

  it('keeps the send lock while a silent speaker drains and releases it immediately in group finally', () => {
    let state = startGroupTurn(undefined, { runId: 'run-1', sessionId: 'room-1' })
    state = startGroupSpeaker(state, 'run-1', 'speaker-1', 0)

    expect(isGroupSpeakerIdle(state, 'run-1', 'speaker-1', GROUP_SPEAKER_IDLE_TIMEOUT_MS - 1)).toBe(false)
    expect(isGroupSpeakerIdle(state, 'run-1', 'speaker-1', GROUP_SPEAKER_IDLE_TIMEOUT_MS)).toBe(true)
    state = drainGroupSpeaker(state, 'run-1', 'speaker-1')

    expect(startGroupTurn(state, { runId: 'run-2', sessionId: 'room-1' })).toBe(state)
    state = finishGroupSpeaker(state, 'run-1', 'speaker-1', 'error', GROUP_SPEAKER_IDLE_TIMEOUT_MS)
    expect(startGroupTurn(state, { runId: 'run-2', sessionId: 'room-1' })).toBe(state)

    state = finishGroupTurn(state, 'run-1')
    expect(startGroupTurn(state, { runId: 'run-2', sessionId: 'room-1' })).toMatchObject({ runId: 'run-2' })
  })

  it.each([1, 2, 4])('runs %i selected speaker(s) in order', (speakerCount) => {
    let state = startGroupTurn(undefined, { runId: 'run-1', sessionId: 'room-1' })
    const completed: string[] = []

    for (let index = 0; index < speakerCount; index += 1) {
      const speakerId = `speaker-${index + 1}`
      state = startGroupSpeaker(state, 'run-1', speakerId, index * 100)
      state = finishGroupSpeaker(state, 'run-1', speakerId, undefined, index * 100 + 1)
      completed.push(speakerId)
    }

    expect(completed).toHaveLength(speakerCount)
    expect(state?.speaker).toBeUndefined()
  })

  it('continues with speakers three and four after speaker two times out', () => {
    let state = startGroupTurn(undefined, { runId: 'run-1', sessionId: 'room-1' })
    const completed: string[] = []

    for (const [index, speakerId] of ['speaker-1', 'speaker-2', 'speaker-3', 'speaker-4'].entries()) {
      state = startGroupSpeaker(state, 'run-1', speakerId, index * GROUP_SPEAKER_IDLE_TIMEOUT_MS)
      if (speakerId === 'speaker-2') {
        expect(isGroupSpeakerIdle(state, 'run-1', speakerId, (index + 1) * GROUP_SPEAKER_IDLE_TIMEOUT_MS)).toBe(true)
        state = drainGroupSpeaker(state, 'run-1', speakerId)
      }
      state = finishGroupSpeaker(state, 'run-1', speakerId, speakerId === 'speaker-2' ? 'error' : undefined, (index + 1) * GROUP_SPEAKER_IDLE_TIMEOUT_MS)
      completed.push(speakerId)
    }

    expect(completed).toEqual(['speaker-1', 'speaker-2', 'speaker-3', 'speaker-4'])
    expect(state?.phase).toBe('running')
  })

  it('stops all later speakers after a user interrupt', () => {
    let state = startGroupTurn(undefined, { runId: 'run-1', sessionId: 'room-1' })
    state = startGroupSpeaker(state, 'run-1', 'speaker-1', 0)
    state = drainGroupTurn(state, 'run-1')

    expect(state?.phase).toBe('draining')
    expect(state?.speaker?.phase).toBe('draining')
    expect(startGroupSpeaker(state, 'run-1', 'speaker-2', 1)).toBe(state)
    expect(startGroupTurn(state, { runId: 'run-2', sessionId: 'room-1' })).toBe(state)
  })

  it('does not let a late old finally clear a newer run', () => {
    let state = startGroupTurn(undefined, { runId: 'run-1', sessionId: 'room-1' })
    state = finishGroupTurn(state, 'run-1')
    state = startGroupTurn(state, { runId: 'run-2', sessionId: 'room-1' })

    expect(finishGroupTurn(state, 'run-1')).toBe(state)
    expect(finishGroupTurn(state, 'run-2')).toBeUndefined()
  })

  it('records every speaker lifecycle independently by run and character', () => {
    let state = startGroupTurn(undefined, { runId: 'run-1', sessionId: 'room-1' })
    state = startGroupSpeaker(state, 'run-1', 'speaker-1', 10)
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'raw-result-received', 20)
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'visible-text-accepted', 30)
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'message-committed', 40)
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'typing-completed', 45)
    state = finishGroupSpeaker(state, 'run-1', 'speaker-1', undefined, 50)
    state = startGroupSpeaker(state, 'run-1', 'speaker-2', 60)
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'speech-playback-started', 65)
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-2', 'typing-completed', 70)
    state = finishGroupSpeaker(state, 'run-1', 'speaker-2', 'empty', 80)

    expect(state?.speakers['run-1\u0000speaker-1']).toMatchObject({
      requestStartedAt: 10,
      rawResultReceivedAt: 20,
      visibleTextAcceptedAt: 30,
      messageCommittedAt: 40,
      speechPlaybackStartedAt: 65,
      typingCompletedAt: 45,
      requestEndedAt: 50,
      terminalStatus: 'success',
    })
    expect(state?.speakers['run-1\u0000speaker-2']).toMatchObject({
      requestStartedAt: 60,
      typingCompletedAt: 70,
      requestEndedAt: 80,
      terminalStatus: 'empty',
    })
    expect(state?.speakers['run-1\u0000speaker-2'].speechPlaybackStartedAt).toBeUndefined()
  })

  it('does not mark a speaker successful before the raw result arrives', () => {
    let state = startGroupTurn(undefined, { runId: 'run-1', sessionId: 'room-1' })
    state = startGroupSpeaker(state, 'run-1', 'speaker-1', 10)
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'visible-text-accepted', 20)
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'message-committed', 30)
    state = finishGroupSpeaker(state, 'run-1', 'speaker-1', undefined, 40)

    expect(state?.speakers['run-1\u0000speaker-1'].terminalStatus).toBeUndefined()
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'raw-result-received', 50)
    expect(state?.speakers['run-1\u0000speaker-1']).toMatchObject({
      rawResultReceivedAt: 50,
      terminalAt: 50,
      terminalStatus: 'success',
    })
  })

  it('ignores callbacks for another run and never rewrites a terminal status', () => {
    let state = startGroupTurn(undefined, { runId: 'run-2', sessionId: 'room-1' })
    state = startGroupSpeaker(state, 'run-2', 'speaker-1', 10)
    state = finishGroupSpeaker(state, 'run-2', 'speaker-1', 'cancelled', 20)

    const afterStaleRun = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'message-committed', 30)
    expect(afterStaleRun).toBe(state)
    expect(afterStaleRun?.speakers['run-2\u0000speaker-1']).toMatchObject({
      terminalAt: 20,
      terminalStatus: 'cancelled',
    })
  })

  it('retains exact late typing and speech milestones after a committed speaker succeeds', () => {
    let state = startGroupTurn(undefined, { runId: 'run-1', sessionId: 'room-1' })
    state = startGroupSpeaker(state, 'run-1', 'speaker-1', 10)
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'raw-result-received', 20)
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'visible-text-accepted', 30)
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'message-committed', 40)
    state = finishGroupSpeaker(state, 'run-1', 'speaker-1', undefined, 50)

    expect(state?.speakers['run-1\u0000speaker-1'].terminalStatus).toBe('success')
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'typing-completed', 60)
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'speech-playback-started', 70)
    state = noteGroupSpeakerMilestone(state, 'run-1', 'speaker-1', 'speech-playback-completed', 80)
    expect(state?.speakers['run-1\u0000speaker-1']).toMatchObject({
      rawResultReceivedAt: 20,
      speechPlaybackCompletedAt: 80,
      speechPlaybackStartedAt: 70,
      terminalAt: 50,
      terminalStatus: 'success',
      typingCompletedAt: 60,
    })
  })
})
