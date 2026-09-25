import type { ChatTrustedRuntimeSignal, ContextMessage } from '@proj-airi/stage-ui/types/chat'

import type { ElectronButlerReminderTaskSnapshot } from '../../shared/eventa'

import { getStageProductEdition } from '@proj-airi/stage-shared'

import { createDesktopFeatureManifest } from '../../shared/desktop-feature-manifest'
import { createChatAppCapabilityContext, ingestChatAppCapabilityContext } from './chat-app-capability-context'

export interface ButlerProactiveReplyRequest {
  appCapabilityContext: ContextMessage
  memoryUserMessage: string
  prompt: string
  runtimeSignal: ChatTrustedRuntimeSignal
  sourceSurface: 'butler-task-reminder'
}

export interface ButlerProactiveReplyTiming {
  currentAt?: number
  triggeredAt?: number
}

function formatOptionalTimestamp(value: number | undefined) {
  return typeof value === 'number' ? new Date(value).toISOString() : undefined
}

function createButlerProactiveReplyCapabilityContext() {
  return createChatAppCapabilityContext({
    availableToolBundleIds: [],
    includeRuntimeStatus: false,
    surface: 'butler-task-reminder',
    workbenchAvailable: createDesktopFeatureManifest(getStageProductEdition()).features.workbench,
  })
}

/** Injects the same no-fabricated-execution contract before a trusted reminder reply. */
export function ingestButlerProactiveReplyCapabilityContext(
  store: { ingestContextMessage: (message: ContextMessage, scope: { sessionId: string, type: 'session' }) => boolean },
  request: ButlerProactiveReplyRequest,
  sessionId: string,
) {
  return ingestChatAppCapabilityContext(store, request.appCapabilityContext, sessionId)
}

export function createButlerProactiveReplyRequest(
  task: ElectronButlerReminderTaskSnapshot,
  timing: ButlerProactiveReplyTiming = {},
): ButlerProactiveReplyRequest {
  const kind = task.kind ?? 'reminder'
  const title = task.title?.trim() || kind
  const dueAtText = new Date(task.dueAt).toISOString()
  const triggeredAtText = formatOptionalTimestamp(timing.triggeredAt)
  const currentAtText = formatOptionalTimestamp(timing.currentAt)

  return {
    appCapabilityContext: createButlerProactiveReplyCapabilityContext(),
    memoryUserMessage: `Butler ${kind} triggered: ${title} at ${dueAtText}.`,
    prompt: [
      'A trusted desktop Butler event supplied optional context for this moment.',
      'Stay in the current resident persona and speak naturally from the current moment.',
      'Use the user\'s current language when possible. Do not mention systems, tools, or internal triggers.',
      'The task context below is optional background only: it may inform your reply when helpful, but you do not need to mention it. Never recite, list, or account for its fields.',
      `- task title: ${title}`,
      task.note ? `- note: ${task.note}` : '',
      `- scheduled time: ${dueAtText}`,
      triggeredAtText ? `- trigger time: ${triggeredAtText}` : '',
      currentAtText ? `- current time: ${currentAtText}` : '',
      `- task status: ${task.status}`,
    ].filter(Boolean).join('\n'),
    runtimeSignal: {
      dueAt: task.dueAt,
      kind,
      source: 'butler',
      taskId: task.id,
      title,
    },
    sourceSurface: 'butler-task-reminder',
  }
}
