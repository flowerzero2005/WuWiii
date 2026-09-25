import type { ServerEvent } from './'

import { describe, expect, it, vi } from 'vitest'

import { createAliyunNLSSession } from './'
import { errorFromAliyunServerEvent } from './stream-transcription'

describe('createAliyunNLSSession', () => {
  it('forwards PCM session options to StartTranscription', () => {
    const send = vi.fn()
    const session = createAliyunNLSSession('access-key', 'access-secret', 'app-key')

    session.start({ send } as unknown as WebSocket, {
      enable_intermediate_result: true,
      enable_punctuation_prediction: true,
      format: 'pcm',
      sample_rate: 16000,
    })

    expect(send).toHaveBeenCalledOnce()
    expect(JSON.parse(send.mock.calls[0][0])).toMatchObject({
      header: {
        appkey: 'app-key',
        name: 'StartTranscription',
        namespace: 'SpeechTranscriber',
      },
      payload: {
        enable_intermediate_result: true,
        enable_punctuation_prediction: true,
        format: 'pcm',
        sample_rate: 16000,
      },
    })
  })
})

describe('errorFromAliyunServerEvent', () => {
  it('turns TaskFailed into an actionable error', () => {
    const event = {
      header: {
        appkey: 'app-key',
        message_id: 'message-id',
        task_id: 'task-id',
        namespace: 'SpeechTranscriber',
        name: 'TaskFailed',
        status: 40000004,
        status_text: 'Gateway:NO_PRIVILEGE:Access denied',
      },
      payload: undefined,
    } satisfies ServerEvent

    expect(errorFromAliyunServerEvent(event)?.message)
      .toBe('Aliyun NLS task failed (40000004): Gateway:NO_PRIVILEGE:Access denied')
  })
})
