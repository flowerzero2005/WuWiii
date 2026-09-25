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
} from '../../shared/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

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
} from '../../shared/eventa'

type AgentSessionControllerInvokers = ReturnType<typeof createInvokers>

let cachedInvokers: AgentSessionControllerInvokers | undefined
let cachedContext: ReturnType<typeof createContext>['context'] | undefined

function createInvokers() {
  const { context } = createContext(window.electron.ipcRenderer)
  cachedContext = context

  return {
    endSession: defineInvoke(context, electronAgentSessionEnd),
    finishRun: defineInvoke(context, electronAgentSessionFinishRun),
    getStatus: defineInvoke(context, electronAgentSessionGetStatus),
    pauseSession: defineInvoke(context, electronAgentSessionPause),
    recordCompact: defineInvoke(context, electronAgentSessionRecordCompact),
    resumeSession: defineInvoke(context, electronAgentSessionResume),
    setActiveSession: defineInvoke(context, electronAgentSessionSetActive),
    startRun: defineInvoke(context, electronAgentSessionStartRun),
    startSession: defineInvoke(context, electronAgentSessionStart),
    stopCurrentAction: defineInvoke(context, electronAgentSessionStopCurrentAction),
    updateSession: defineInvoke(context, electronAgentSessionUpdate),
  }
}

function resolveInvokers() {
  if (!cachedInvokers)
    cachedInvokers = createInvokers()
  return cachedInvokers
}

function resolveContext() {
  resolveInvokers()
  return cachedContext
}

function stringifyError(error: unknown) {
  if (error instanceof Error) {
    return error.message
  }

  return String(error)
}

function cloneSession(session: ElectronAgentSessionSnapshot): ElectronAgentSessionSnapshot {
  return {
    ...session,
    activeRun: session.activeRun
      ? {
          ...session.activeRun,
          metadata: session.activeRun.metadata ? { ...session.activeRun.metadata } : undefined,
        }
      : undefined,
    compactSummaryIds: [...session.compactSummaryIds],
  }
}

export const useAgentSessionControllerStore = defineStore('tamagotchi-agent-session-controller', () => {
  const status = ref<ElectronAgentSessionStatus>({ sessions: [] })
  const loading = ref(false)
  const error = ref<string>()
  let subscribed = false

  const activeSession = computed(() => {
    const activeSessionId = status.value.activeSessionId
    return status.value.sessions.find(session => session.sessionId === activeSessionId)
  })
  const workbenchSessions = computed(() => status.value.sessions.filter(session => session.surface === 'workbench'))
  const chatSessions = computed(() => status.value.sessions.filter(session => session.surface === 'chat'))

  function applyStatus(nextStatus: ElectronAgentSessionStatus) {
    status.value = {
      activeSessionId: nextStatus.activeSessionId,
      sessions: nextStatus.sessions.map(cloneSession),
    }
  }

  function upsertSession(session: ElectronAgentSessionSnapshot, options?: { setActive?: boolean }) {
    const nextSession = cloneSession(session)
    const sessions = [
      nextSession,
      ...status.value.sessions.filter(candidate => candidate.sessionId !== session.sessionId),
    ].sort((left, right) => right.updatedAt - left.updatedAt)

    status.value = {
      activeSessionId: options?.setActive
        ? session.sessionId
        : status.value.activeSessionId ?? session.sessionId,
      sessions,
    }
  }

  function clearError() {
    error.value = undefined
  }

  function subscribe() {
    if (subscribed)
      return

    const context = resolveContext()
    context?.on(electronAgentSessionStateChanged, (event) => {
      if (event.body)
        applyStatus(event.body)
    })
    subscribed = true
  }

  async function withRequest<T>(action: string, run: (invokers: AgentSessionControllerInvokers) => Promise<T>) {
    loading.value = true
    clearError()

    try {
      subscribe()
      return await run(resolveInvokers())
    }
    catch (cause) {
      error.value = `Agent session controller ${action} failed: ${stringifyError(cause)}`
      throw cause
    }
    finally {
      loading.value = false
    }
  }

  async function refreshStatus() {
    const nextStatus = await withRequest('get-status', async invokers => await invokers.getStatus())
    applyStatus(nextStatus)
    return nextStatus
  }

  async function startSession(payload: ElectronAgentSessionStartPayload) {
    const session = await withRequest('start-session', async invokers => await invokers.startSession(payload))
    upsertSession(session, { setActive: true })
    return session
  }

  async function setActiveSession(payload: ElectronAgentSessionSetActivePayload) {
    const nextStatus = await withRequest('set-active-session', async invokers => await invokers.setActiveSession(payload))
    applyStatus(nextStatus)
    return nextStatus
  }

  async function updateSession(payload: ElectronAgentSessionUpdatePayload) {
    const session = await withRequest('update-session', async invokers => await invokers.updateSession(payload))
    upsertSession(session)
    return session
  }

  async function startRun(payload: ElectronAgentRunStartPayload) {
    const session = await withRequest('start-run', async invokers => await invokers.startRun(payload))
    upsertSession(session)
    return session
  }

  async function finishRun(payload: ElectronAgentRunFinishPayload) {
    const session = await withRequest('finish-run', async invokers => await invokers.finishRun(payload))
    upsertSession(session)
    return session
  }

  async function stopCurrentAction(payload: ElectronAgentSessionStopPayload) {
    const session = await withRequest('stop-current-action', async invokers => await invokers.stopCurrentAction(payload))
    upsertSession(session)
    return session
  }

  async function pauseSession(payload: ElectronAgentSessionStopPayload) {
    const session = await withRequest('pause-session', async invokers => await invokers.pauseSession(payload))
    upsertSession(session)
    return session
  }

  async function resumeSession(payload: ElectronAgentSessionStopPayload) {
    const session = await withRequest('resume-session', async invokers => await invokers.resumeSession(payload))
    upsertSession(session)
    return session
  }

  async function endSession(payload: ElectronAgentSessionStopPayload) {
    const session = await withRequest('end-session', async invokers => await invokers.endSession(payload))
    upsertSession(session)
    return session
  }

  async function recordCompact(payload: ElectronAgentSessionCompactRecordedPayload) {
    const session = await withRequest('record-compact', async invokers => await invokers.recordCompact(payload))
    upsertSession(session)
    return session
  }

  function getSession(sessionId: string): ElectronAgentSessionSnapshot | undefined {
    return status.value.sessions.find(session => session.sessionId === sessionId)
  }

  return {
    activeSession,
    chatSessions,
    error,
    loading,
    status,
    workbenchSessions,

    clearError,
    endSession,
    finishRun,
    getSession,
    pauseSession,
    recordCompact,
    refreshStatus,
    resumeSession,
    setActiveSession,
    startRun,
    startSession,
    stopCurrentAction,
    subscribe,
    updateSession,
  }
})
