export const GROUP_SPEAKER_IDLE_TIMEOUT_MS = 35_000

export type GroupSpeakerTerminalStatus = 'success' | 'empty' | 'error' | 'cancelled'
export type GroupSpeakerMilestone
  = | 'raw-result-received'
    | 'visible-text-accepted'
    | 'message-committed'
    | 'typing-completed'
    | 'speech-playback-started'
    | 'speech-playback-completed'

export interface GroupTurnSpeakerRun {
  characterId: string
  key: string
  lastProgressAt: number
  messageCommittedAt?: number
  phase: 'running' | 'draining'
  rawResultReceivedAt?: number
  requestEndedAt?: number
  requestStartedAt: number
  speechPlaybackCompletedAt?: number
  speechPlaybackStartedAt?: number
  terminalAt?: number
  terminalStatus?: GroupSpeakerTerminalStatus
  typingCompletedAt?: number
  visibleTextAcceptedAt?: number
}

export interface GroupTurnRunState {
  phase: 'running' | 'draining'
  runId: string
  sessionId: string
  speaker?: GroupTurnSpeakerRun
  speakers: Record<string, GroupTurnSpeakerRun>
}

export function createGroupSpeakerRunKey(runId: string, characterId: string) {
  return `${runId}\u0000${characterId}`
}

/** Starts a group turn only when no earlier turn still owns the send pipeline. */
export function startGroupTurn(
  current: GroupTurnRunState | undefined,
  input: Pick<GroupTurnRunState, 'runId' | 'sessionId'>,
): GroupTurnRunState | undefined {
  if (current)
    return current

  return { ...input, phase: 'running', speakers: {} }
}

/** Gives one speaker the idle-timeout budget without releasing group ownership. */
export function startGroupSpeaker(
  current: GroupTurnRunState | undefined,
  runId: string,
  characterId: string,
  now: number,
): GroupTurnRunState | undefined {
  if (!current || current.runId !== runId || current.phase !== 'running')
    return current

  const key = createGroupSpeakerRunKey(runId, characterId)
  const speaker: GroupTurnSpeakerRun = {
    characterId,
    key,
    lastProgressAt: now,
    phase: 'running',
    requestStartedAt: now,
  }

  return {
    ...current,
    speaker,
    speakers: { ...current.speakers, [key]: speaker },
  }
}

/** Renews the current speaker's idle budget only for matching, live progress. */
export function noteGroupSpeakerProgress(
  current: GroupTurnRunState | undefined,
  runId: string,
  characterId: string,
  now: number,
): GroupTurnRunState | undefined {
  if (!current
    || current.runId !== runId
    || current.phase !== 'running'
    || current.speaker?.characterId !== characterId
    || current.speaker.phase !== 'running') {
    return current
  }

  const speaker = { ...current.speaker, lastProgressAt: now }
  return {
    ...current,
    speaker,
    speakers: { ...current.speakers, [speaker.key]: speaker },
  }
}

/** Records one exact speaker milestone without consulting the current speaker. */
export function noteGroupSpeakerMilestone(
  current: GroupTurnRunState | undefined,
  runId: string,
  characterId: string,
  milestone: GroupSpeakerMilestone,
  now: number,
): GroupTurnRunState | undefined {
  if (!current || current.runId !== runId)
    return current

  const key = createGroupSpeakerRunKey(runId, characterId)
  const existing = current.speakers[key]
  if (!existing)
    return current

  const timestampField = ({
    'message-committed': 'messageCommittedAt',
    'raw-result-received': 'rawResultReceivedAt',
    'speech-playback-completed': 'speechPlaybackCompletedAt',
    'speech-playback-started': 'speechPlaybackStartedAt',
    'typing-completed': 'typingCompletedAt',
    'visible-text-accepted': 'visibleTextAcceptedAt',
  } as Record<GroupSpeakerMilestone, keyof GroupTurnSpeakerRun>)[milestone]
  if (existing[timestampField] !== undefined)
    return current

  const speaker = completeSuccessfulSpeaker({ ...existing, [timestampField]: now }, now)
  return {
    ...current,
    speaker: current.speaker?.key === key ? speaker : current.speaker,
    speakers: { ...current.speakers, [key]: speaker },
  }
}

export function isGroupSpeakerIdle(
  current: GroupTurnRunState | undefined,
  runId: string,
  characterId: string,
  now: number,
  timeoutMs = GROUP_SPEAKER_IDLE_TIMEOUT_MS,
): boolean {
  return Boolean(current
    && current.runId === runId
    && current.phase === 'running'
    && current.speaker?.characterId === characterId
    && current.speaker.phase === 'running'
    && now - current.speaker.lastProgressAt >= timeoutMs)
}

/** Marks one timed-out speaker as draining while the group run retains ownership. */
export function drainGroupSpeaker(
  current: GroupTurnRunState | undefined,
  runId: string,
  characterId: string,
): GroupTurnRunState | undefined {
  if (!current
    || current.runId !== runId
    || current.phase !== 'running'
    || current.speaker?.characterId !== characterId) {
    return current
  }

  const speaker = { ...current.speaker, phase: 'draining' as const }
  return {
    ...current,
    speaker,
    speakers: { ...current.speakers, [speaker.key]: speaker },
  }
}

/** Ends the matching speaker drain; stale completions cannot touch a newer speaker. */
export function finishGroupSpeaker(
  current: GroupTurnRunState | undefined,
  runId: string,
  characterId: string,
  terminalStatus: Exclude<GroupSpeakerTerminalStatus, 'success'> | undefined,
  now: number,
): GroupTurnRunState | undefined {
  if (!current || current.runId !== runId || current.speaker?.characterId !== characterId)
    return current

  const key = createGroupSpeakerRunKey(runId, characterId)
  const speaker = current.speakers[key]
  if (!speaker)
    return current

  const requestEndedSpeaker: GroupTurnSpeakerRun = {
    ...speaker,
    requestEndedAt: speaker.requestEndedAt ?? now,
    ...(terminalStatus
      ? {
          terminalAt: speaker.terminalAt ?? now,
          terminalStatus: speaker.terminalStatus ?? terminalStatus,
        }
      : {}),
  }
  const completedSpeaker = completeSuccessfulSpeaker(requestEndedSpeaker, now)
  return {
    ...current,
    speaker: undefined,
    speakers: { ...current.speakers, [key]: completedSpeaker },
  }
}

function completeSuccessfulSpeaker(speaker: GroupTurnSpeakerRun, now: number): GroupTurnSpeakerRun {
  if (speaker.terminalStatus
    || speaker.requestEndedAt === undefined
    || speaker.rawResultReceivedAt === undefined
    || speaker.visibleTextAcceptedAt === undefined
    || speaker.messageCommittedAt === undefined) {
    return speaker
  }

  return {
    ...speaker,
    terminalAt: now,
    terminalStatus: 'success',
  }
}

/** User interruption drains the whole run and prevents any later speaker starting. */
export function drainGroupTurn(current: GroupTurnRunState | undefined, runId: string): GroupTurnRunState | undefined {
  if (!current || current.runId !== runId)
    return current

  const speaker = current.speaker ? { ...current.speaker, phase: 'draining' as const } : undefined
  return {
    ...current,
    phase: 'draining',
    speaker,
    speakers: speaker ? { ...current.speakers, [speaker.key]: speaker } : current.speakers,
  }
}

/** Releases ownership only from the matching handleGroupSend finally block. */
export function finishGroupTurn(current: GroupTurnRunState | undefined, runId: string): GroupTurnRunState | undefined {
  if (!current || current.runId !== runId)
    return current

  return undefined
}
