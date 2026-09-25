import { describe, expect, it } from 'vitest'

import { createVoiceCallTools, executeKeepVoiceCallOpen, executeVoiceCallCancellation, executeVoiceCallInvitation } from './voice-call'

describe('voice call invitation tool', () => {
  it.each([
    ['ringing', true, 'now ringing'],
    ['unavailable', false, 'could not be completed'],
  ] as const)('returns an authoritative %s result', async (status, completed, expectedText) => {
    await expect(executeVoiceCallInvitation(async () => status, { reason: 'I want to check in.' }))
      .resolves
      .toEqual({
        completed,
        message: expect.stringContaining(expectedText),
        status,
      })
  })

  it.each([
    [async (): Promise<'cancelled'> => 'cancelled', 'cancelled', true],
    [async (): Promise<'unavailable'> => 'unavailable', 'unavailable', false],
    [undefined, 'unavailable', false],
  ] as const)('returns an authoritative cancellation result', async (cancel, status, completed) => {
    await expect(executeVoiceCallCancellation(cancel))
      .resolves
      .toEqual(expect.objectContaining({ completed, status }))
  })

  it('exposes keep-open only for a pending active call and executes it idempotently', async () => {
    const invite = async (): Promise<'ringing'> => 'ringing'
    const keepOpen = async (): Promise<'kept-open'> => 'kept-open'
    const ordinaryTools = await createVoiceCallTools(invite)
    const pendingTools = await createVoiceCallTools(invite, undefined, keepOpen)

    expect(ordinaryTools.map(tool => tool.function.name)).not.toContain('keep_voice_call_open')
    expect(pendingTools.map(tool => tool.function.name)).toContain('keep_voice_call_open')
    await expect(executeKeepVoiceCallOpen(keepOpen)).resolves.toMatchObject({ completed: true, status: 'kept-open' })
    await expect(executeKeepVoiceCallOpen(keepOpen)).resolves.toMatchObject({ completed: true, status: 'kept-open' })
  })
})
