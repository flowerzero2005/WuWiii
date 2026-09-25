import type { Message } from '@xsai/shared-chat'

function getMessageSize(message: Message) {
  return JSON.stringify(message).length
}

export function fitMessagesToContextWindow(
  messages: Message[],
  options: { contextTokens?: number, maxOutputTokens?: number, maxInputCharacters?: number, protectedPrefixCount: number },
) {
  // Unknown provider metadata must not disable trimming entirely. A conservative
  // fallback keeps enough reply budget for common local and cloud models.
  const contextTokens = Math.floor(options.contextTokens && options.contextTokens > 0 ? options.contextTokens : 16_384)

  const outputReserve = Math.max(256, Math.floor(options.maxOutputTokens ?? Math.min(2000, contextTokens * 0.2)))
  const providerInputCharacterBudget = Math.max(1000, (contextTokens - outputReserve - 512) * 3)
  const inputCharacterBudget = Math.max(1000, Math.min(
    providerInputCharacterBudget,
    options.maxInputCharacters ?? providerInputCharacterBudget,
  ))
  if (messages.reduce((total, message) => total + getMessageSize(message), 0) <= inputCharacterBudget)
    return messages

  const protectedPrefixCount = Math.min(messages.length, Math.max(0, options.protectedPrefixCount))
  const prefix = messages.slice(0, protectedPrefixCount)
  const suffixCandidates = messages.slice(protectedPrefixCount)
  let remainingCharacters = inputCharacterBudget - prefix.reduce((total, message) => total + getMessageSize(message), 0)
  let startIndex = suffixCandidates.length

  while (startIndex > 0) {
    const nextSize = getMessageSize(suffixCandidates[startIndex - 1]!)
    if (remainingCharacters - nextSize < 0 && startIndex < suffixCandidates.length)
      break
    remainingCharacters -= nextSize
    startIndex -= 1
  }

  const retained = suffixCandidates.slice(startIndex)
  const firstUserIndex = retained.findIndex(message => message.role === 'user')
  return [
    ...prefix,
    ...(firstUserIndex > 0 ? retained.slice(firstUserIndex) : retained),
  ]
}
