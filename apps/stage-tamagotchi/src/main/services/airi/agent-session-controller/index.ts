import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type {
  ElectronAgentRunFinishPayload,
  ElectronAgentRunStartPayload,
  ElectronAgentSessionCompactRecordedPayload,
  ElectronAgentSessionSetActivePayload,
  ElectronAgentSessionSnapshot,
  ElectronAgentSessionStartPayload,
  ElectronAgentSessionStatus,
  ElectronAgentSessionStopPayload,
  ElectronAgentSessionUpdatePayload,
} from '../../../../shared/eventa'

import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import { app, ipcMain } from 'electron'

import {
  electronAgentSessionEnd,
  electronAgentSessionFinishRun,
  electronAgentSessionGetStatus,
  electronAgentSessionPause,
  electronAgentSessionRecordCompact,
  electronAgentSessionResume,
  electronAgentSessionSetActive,
  electronAgentSessionStart,
  electronAgentSessionStartRun,
  electronAgentSessionStateChanged,
  electronAgentSessionStopCurrentAction,
  electronAgentSessionUpdate,
} from '../../../../shared/eventa'

const AGENT_SESSION_STORE_VERSION = 1
const RESTORED_STOP_REASON = 'restored-after-app-restart'

export interface AgentRunCancellation {
  cancel: (reason?: string) => void | Promise<void>
}

export interface AgentSessionControllerService {
  getStatus: () => ElectronAgentSessionStatus
  startSession: (payload: ElectronAgentSessionStartPayload) => ElectronAgentSessionSnapshot
  setActiveSession: (payload: ElectronAgentSessionSetActivePayload) => ElectronAgentSessionStatus
  updateSession: (payload: ElectronAgentSessionUpdatePayload) => ElectronAgentSessionSnapshot
  startRun: (payload: ElectronAgentRunStartPayload, cancellation?: AgentRunCancellation) => ElectronAgentSessionSnapshot
  finishRun: (payload: ElectronAgentRunFinishPayload) => ElectronAgentSessionSnapshot
  stopCurrentAction: (payload: ElectronAgentSessionStopPayload) => Promise<ElectronAgentSessionSnapshot>
  pauseSession: (payload: ElectronAgentSessionStopPayload) => Promise<ElectronAgentSessionSnapshot>
  resumeSession: (payload: ElectronAgentSessionStopPayload) => ElectronAgentSessionSnapshot
  endSession: (payload: ElectronAgentSessionStopPayload) => Promise<ElectronAgentSessionSnapshot>
  recordCompact: (payload: ElectronAgentSessionCompactRecordedPayload) => ElectronAgentSessionSnapshot
}

type AgentSessionEventContext = ReturnType<typeof createContext>['context']

interface PersistedAgentSessionState {
  activeSessionId?: string
  sessions: ElectronAgentSessionSnapshot[]
  version: typeof AGENT_SESSION_STORE_VERSION
}

function cloneSession(session: ElectronAgentSessionSnapshot): ElectronAgentSessionSnapshot {
  return {
    ...session,
    activeRun: session.activeRun ? { ...session.activeRun, metadata: session.activeRun.metadata ? { ...session.activeRun.metadata } : undefined } : undefined,
    compactSummaryIds: [...session.compactSummaryIds],
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isPersistedAgentSession(value: unknown): value is ElectronAgentSessionSnapshot {
  if (!isRecord(value))
    return false

  return typeof value.sessionId === 'string'
    && typeof value.surface === 'string'
    && typeof value.runMode === 'string'
    && typeof value.permissionLevel === 'string'
    && typeof value.state === 'string'
    && Array.isArray(value.compactSummaryIds)
    && typeof value.createdAt === 'number'
    && typeof value.updatedAt === 'number'
}

function getAgentSessionStorePath() {
  return join(app.getPath('userData'), 'airi-agent-sessions', 'v1.json')
}

function restoreAgentSessionRuntimeState(session: ElectronAgentSessionSnapshot): ElectronAgentSessionSnapshot {
  const shouldStopStaleRun = session.state === 'running'
    || session.state === 'compacting'
    || session.activeRun?.status === 'running'

  if (!shouldStopStaleRun)
    return cloneSession(session)

  return {
    ...cloneSession(session),
    activeRun: undefined,
    lastStopReason: session.lastStopReason ?? RESTORED_STOP_REASON,
    state: 'stopped-action',
    updatedAt: Date.now(),
  }
}

function hydratePersistedAgentSessions(sessions: Map<string, ElectronAgentSessionSnapshot>) {
  const storagePath = getAgentSessionStorePath()
  if (!existsSync(storagePath))
    return undefined

  try {
    const rawState = JSON.parse(readFileSync(storagePath, { encoding: 'utf-8' })) as unknown
    if (!isRecord(rawState) || rawState.version !== AGENT_SESSION_STORE_VERSION || !Array.isArray(rawState.sessions))
      return undefined

    for (const rawSession of rawState.sessions) {
      if (!isPersistedAgentSession(rawSession))
        continue

      const session = restoreAgentSessionRuntimeState(rawSession)
      sessions.set(session.sessionId, session)
    }

    if (typeof rawState.activeSessionId === 'string' && sessions.has(rawState.activeSessionId))
      return rawState.activeSessionId

    return sortSessions(Array.from(sessions.values()))[0]?.sessionId
  }
  catch (error) {
    console.warn('[airi] Failed to restore agent sessions.', error)
    return undefined
  }
}

function persistAgentSessions(sessions: Map<string, ElectronAgentSessionSnapshot>, activeSessionId?: string) {
  const storagePath = getAgentSessionStorePath()
  const state: PersistedAgentSessionState = {
    activeSessionId,
    sessions: sortSessions(Array.from(sessions.values()).map(cloneSession)),
    version: AGENT_SESSION_STORE_VERSION,
  }

  try {
    mkdirSync(dirname(storagePath), { recursive: true })
    const tempPath = `${storagePath}.tmp`
    writeFileSync(tempPath, JSON.stringify(state, undefined, 2), { encoding: 'utf-8' })
    renameSync(tempPath, storagePath)
  }
  catch (error) {
    console.warn('[airi] Failed to persist agent sessions.', error)
  }
}

function sortSessions(sessions: ElectronAgentSessionSnapshot[]) {
  return [...sessions].sort((left, right) => right.updatedAt - left.updatedAt)
}

function createSessionNotFoundError(sessionId: string) {
  return new Error(`Agent session not found: ${sessionId}`)
}

export function createAgentSessionControllerService(options?: {
  context?: AgentSessionEventContext
}): AgentSessionControllerService {
  const sessions = new Map<string, ElectronAgentSessionSnapshot>()
  const runCancellations = new Map<string, AgentRunCancellation>()
  let activeSessionId: string | undefined = hydratePersistedAgentSessions(sessions)

  function persistSessions() {
    persistAgentSessions(sessions, activeSessionId)
  }

  function getStatus(): ElectronAgentSessionStatus {
    return {
      activeSessionId,
      sessions: sortSessions(Array.from(sessions.values()).map(cloneSession)),
    }
  }

  function emitStatusChanged() {
    options?.context?.emit(electronAgentSessionStateChanged, getStatus())
  }

  function requireSession(sessionId: string) {
    const session = sessions.get(sessionId)
    if (!session) {
      throw createSessionNotFoundError(sessionId)
    }

    return session
  }

  function saveSession(session: ElectronAgentSessionSnapshot) {
    sessions.set(session.sessionId, session)
    activeSessionId ??= session.sessionId
    persistSessions()
    emitStatusChanged()
    return cloneSession(session)
  }

  function startSession(payload: ElectronAgentSessionStartPayload) {
    const now = Date.now()
    const sessionId = payload.sessionId || `agent-session-${randomUUID()}`
    const existing = sessions.get(sessionId)
    const session: ElectronAgentSessionSnapshot = {
      compactSummaryIds: existing?.compactSummaryIds ?? [],
      createdAt: existing?.createdAt ?? now,
      endedAt: undefined,
      lastStopReason: undefined,
      nextStep: existing?.nextStep,
      permissionLevel: payload.permissionLevel ?? existing?.permissionLevel ?? 'observe',
      runMode: payload.runMode ?? existing?.runMode ?? 'assisted',
      sessionId,
      state: existing?.state === 'completed' ? 'idle' : existing?.state ?? 'idle',
      surface: payload.surface,
      updatedAt: now,
      userGoal: payload.userGoal ?? existing?.userGoal,
      workspaceId: payload.workspaceId ?? existing?.workspaceId,
      workspaceRoot: payload.workspaceRoot ?? existing?.workspaceRoot,
    }

    sessions.set(sessionId, session)
    activeSessionId = sessionId
    persistSessions()
    emitStatusChanged()
    return cloneSession(session)
  }

  function setActiveSession(payload: ElectronAgentSessionSetActivePayload) {
    requireSession(payload.sessionId)
    activeSessionId = payload.sessionId
    persistSessions()
    emitStatusChanged()
    return getStatus()
  }

  function updateSession(payload: ElectronAgentSessionUpdatePayload) {
    const session = requireSession(payload.sessionId)
    const updated: ElectronAgentSessionSnapshot = {
      ...session,
      nextStep: payload.nextStep ?? session.nextStep,
      permissionLevel: payload.permissionLevel ?? session.permissionLevel,
      runMode: payload.runMode ?? session.runMode,
      state: payload.state ?? session.state,
      updatedAt: Date.now(),
      userGoal: payload.userGoal ?? session.userGoal,
    }

    return saveSession(updated)
  }

  function startRun(payload: ElectronAgentRunStartPayload, cancellation?: AgentRunCancellation) {
    const session = requireSession(payload.sessionId)
    const now = Date.now()
    const runId = payload.runId || `agent-run-${randomUUID()}`
    const updated: ElectronAgentSessionSnapshot = {
      ...session,
      activeRun: {
        cancellable: payload.cancellable !== false,
        kind: payload.kind,
        label: payload.label,
        metadata: payload.metadata,
        runId,
        sessionId: payload.sessionId,
        startedAt: now,
        status: 'running',
        updatedAt: now,
      },
      endedAt: undefined,
      lastStopReason: undefined,
      state: payload.kind === 'compact' ? 'compacting' : 'running',
      updatedAt: now,
    }

    if (cancellation) {
      runCancellations.set(runId, cancellation)
    }

    return saveSession(updated)
  }

  function finishRun(payload: ElectronAgentRunFinishPayload) {
    const session = requireSession(payload.sessionId)
    const now = Date.now()
    const matchesActiveRun = session.activeRun?.runId === payload.runId
    runCancellations.delete(payload.runId)

    const updated: ElectronAgentSessionSnapshot = {
      ...session,
      activeRun: matchesActiveRun
        ? {
            ...session.activeRun!,
            status: payload.status,
            updatedAt: now,
          }
        : session.activeRun,
      lastStopReason: payload.status === 'cancelled' ? payload.reason : session.lastStopReason,
      state: payload.status === 'cancelled'
        ? 'stopped-action'
        : payload.status === 'failed'
          ? 'failed'
          : payload.status === 'blocked'
            ? 'waiting-approval'
            : 'idle',
      updatedAt: now,
    }

    if (matchesActiveRun && payload.status !== 'blocked') {
      updated.activeRun = undefined
    }

    return saveSession(updated)
  }

  async function stopCurrentAction(payload: ElectronAgentSessionStopPayload) {
    const session = requireSession(payload.sessionId)
    const activeRun = session.activeRun
    const reason = payload.reason ?? 'user-stop-current-action'

    if (activeRun?.cancellable) {
      await runCancellations.get(activeRun.runId)?.cancel(reason)
      runCancellations.delete(activeRun.runId)
    }

    const now = Date.now()
    const updated: ElectronAgentSessionSnapshot = {
      ...session,
      activeRun: activeRun
        ? {
            ...activeRun,
            status: 'cancelled',
            updatedAt: now,
          }
        : undefined,
      lastStopReason: reason,
      state: 'stopped-action',
      updatedAt: now,
    }

    return saveSession(updated)
  }

  async function pauseSession(payload: ElectronAgentSessionStopPayload) {
    const stopped = await stopCurrentAction({
      reason: payload.reason ?? 'user-pause',
      sessionId: payload.sessionId,
    })
    const updated: ElectronAgentSessionSnapshot = {
      ...stopped,
      state: 'paused',
      updatedAt: Date.now(),
    }

    return saveSession(updated)
  }

  function resumeSession(payload: ElectronAgentSessionStopPayload) {
    const session = requireSession(payload.sessionId)
    const updated: ElectronAgentSessionSnapshot = {
      ...session,
      activeRun: undefined,
      lastStopReason: undefined,
      state: 'idle',
      updatedAt: Date.now(),
    }

    return saveSession(updated)
  }

  async function endSession(payload: ElectronAgentSessionStopPayload) {
    const stopped = await stopCurrentAction({
      reason: payload.reason ?? 'user-end-session',
      sessionId: payload.sessionId,
    })
    const updated: ElectronAgentSessionSnapshot = {
      ...stopped,
      activeRun: undefined,
      endedAt: Date.now(),
      state: 'completed',
      updatedAt: Date.now(),
    }

    return saveSession(updated)
  }

  function recordCompact(payload: ElectronAgentSessionCompactRecordedPayload) {
    const session = requireSession(payload.sessionId)
    const compactSummaryIds = session.compactSummaryIds.includes(payload.compactSummaryId)
      ? session.compactSummaryIds
      : [...session.compactSummaryIds, payload.compactSummaryId]
    const updated: ElectronAgentSessionSnapshot = {
      ...session,
      compactSummaryIds,
      nextStep: payload.nextStep ?? session.nextStep,
      state: session.state === 'compacting' ? 'idle' : session.state,
      updatedAt: Date.now(),
    }

    return saveSession(updated)
  }

  return {
    endSession,
    finishRun,
    getStatus,
    pauseSession,
    recordCompact,
    resumeSession,
    setActiveSession,
    startRun,
    startSession,
    stopCurrentAction,
    updateSession,
  }
}

export function createAgentSessionControllerHandlers(params: {
  context: AgentSessionEventContext
  service: AgentSessionControllerService
}) {
  defineInvokeHandler(params.context, electronAgentSessionGetStatus, () => {
    return params.service.getStatus()
  })

  defineInvokeHandler(params.context, electronAgentSessionStart, (payload) => {
    return params.service.startSession(payload)
  })

  defineInvokeHandler(params.context, electronAgentSessionSetActive, (payload) => {
    return params.service.setActiveSession(payload)
  })

  defineInvokeHandler(params.context, electronAgentSessionUpdate, (payload) => {
    return params.service.updateSession(payload)
  })

  defineInvokeHandler(params.context, electronAgentSessionStartRun, (payload) => {
    return params.service.startRun(payload)
  })

  defineInvokeHandler(params.context, electronAgentSessionFinishRun, (payload) => {
    return params.service.finishRun(payload)
  })

  defineInvokeHandler(params.context, electronAgentSessionStopCurrentAction, async (payload) => {
    return await params.service.stopCurrentAction(payload)
  })

  defineInvokeHandler(params.context, electronAgentSessionPause, async (payload) => {
    return await params.service.pauseSession(payload)
  })

  defineInvokeHandler(params.context, electronAgentSessionResume, (payload) => {
    return params.service.resumeSession(payload)
  })

  defineInvokeHandler(params.context, electronAgentSessionEnd, async (payload) => {
    return await params.service.endSession(payload)
  })

  defineInvokeHandler(params.context, electronAgentSessionRecordCompact, (payload) => {
    return params.service.recordCompact(payload)
  })
}

export function setupAgentSessionControllerService() {
  const { context } = createElectronContext(ipcMain)
  const service = createAgentSessionControllerService({ context })
  createAgentSessionControllerHandlers({ context, service })
  return service
}
