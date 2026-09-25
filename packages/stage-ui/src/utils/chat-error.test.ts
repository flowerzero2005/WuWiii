import { describe, expect, it } from 'vitest'

import { getChatErrorMessage } from './chat-error'

describe('chat errors', () => {
  it('hides internal tool stream timeouts and confirms no action completed', () => {
    const message = getChatErrorMessage(new Error('Tool stream timed out before first response event after 8000ms.'))

    expect(message).toBe('The tool service is temporarily unavailable. No action was completed; please retry shortly or switch provider/model.')
    expect(message).not.toContain('8000ms')
  })
})
