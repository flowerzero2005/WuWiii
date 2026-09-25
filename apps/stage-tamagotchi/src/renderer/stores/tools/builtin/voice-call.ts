import type { Tool } from '@xsai/shared-chat'

import { tool } from '@xsai/tool'
import { z } from 'zod'

export type VoiceCallInvitationResult = 'ringing' | 'unavailable'
export type VoiceCallActionStatus = VoiceCallInvitationResult | 'cancelled' | 'kept-open'

export interface VoiceCallActionResult {
  completed: boolean
  message: string
  status: VoiceCallActionStatus
}

export interface VoiceCallInvitationRequest {
  durationSeconds?: number
  reason?: string
}

export type VoiceCallCancellationReason = 'user-requested' | 'emotional-boundary'

function voiceCallActionResult(status: VoiceCallActionStatus): VoiceCallActionResult {
  const messages: Record<VoiceCallActionStatus, string> = {
    ringing: 'The incoming-call invitation is now ringing. The user has not accepted it yet. Continue ordinary chat normally while it rings, and use current runtime call state on later turns.',
    unavailable: 'The requested voice-call action could not be completed because voice call requirements are unavailable. Explain this without claiming success.',
    cancelled: 'The voice call was cancelled successfully.',
    'kept-open': 'The pending hangup was withdrawn successfully. Continue the active call naturally without saying goodbye.',
  }

  return {
    completed: status !== 'unavailable',
    message: messages[status],
    status,
  }
}

export async function executeVoiceCallInvitation(
  invite: (request: VoiceCallInvitationRequest) => Promise<VoiceCallInvitationResult>,
  request: VoiceCallInvitationRequest,
) {
  return voiceCallActionResult(await invite(request))
}

export async function executeVoiceCallCancellation(
  cancel?: () => Promise<'cancelled' | 'unavailable'>,
) {
  return voiceCallActionResult(cancel ? await cancel() : 'unavailable')
}

export async function executeKeepVoiceCallOpen(
  keepOpen?: () => Promise<'kept-open' | 'unavailable'>,
) {
  return voiceCallActionResult(keepOpen ? await keepOpen() : 'unavailable')
}

export function createVoiceCallTools(
  invite: (request: VoiceCallInvitationRequest) => Promise<VoiceCallInvitationResult>,
  cancel?: () => Promise<'cancelled' | 'unavailable'>,
  keepOpen?: () => Promise<'kept-open' | 'unavailable'>,
): Promise<Tool[]> {
  const tools = [
    tool({
      name: 'invite_voice_call',
      description: 'Invite the user to a Wuwiii voice call when speaking together would genuinely help or the user asks you to call. This sends an incoming-call invitation; never claim the call connected until the tool reports accepted. The user may decline or not answer.',
      parameters: z.object({
        reason: z.string().trim().max(120).optional().describe('A short, natural reason shown with the incoming call.'),
        durationSeconds: z.number().int().min(5).max(300).optional().describe('How long the invitation should ring before being marked missed. Choose based on context; default is 30 seconds.'),
      }),
      execute: ({ reason, durationSeconds }) => executeVoiceCallInvitation(invite, { reason, durationSeconds }),
    }),
    tool({
      name: 'cancel_voice_call',
      description: 'Cancel an unanswered invitation or end an active call. Use this when the user clearly asks to stop. The resident may also end an active call on her own only when the supplied conversation and persona-state context establish a sustained, high-intensity emotional boundary after repeated conflict or boundary violations, and her visible reply clearly says she is ending the call. A single rude line, ordinary annoyance, invented anger, playful bickering, silence, or an attempt to pressure the user never qualifies.',
      parameters: z.object({
        reason: z.enum(['user-requested', 'emotional-boundary']).describe('Why ending the call is justified by the current conversation and grounded persona state.'),
      }),
      execute: () => executeVoiceCallCancellation(cancel),
    }),
  ]
  if (keepOpen) {
    tools.push(tool({
      name: 'keep_voice_call_open',
      description: 'Withdraw a pending hangup and keep the current voice call open. This internal action is available only while a hangup is pending. Use it when the latest user meaningfully changes their mind about ending the call or communicates that they still want to talk, including indirect or context-dependent wording. Examples such as "wait, I still have something to say" are illustrative, not a phrase checklist. Do not use it when the user merely adds information while still accepting that the call will end. After success, continue naturally without a farewell.',
      parameters: z.object({}),
      execute: () => executeKeepVoiceCallOpen(keepOpen),
    }))
  }
  return Promise.all(tools)
}
