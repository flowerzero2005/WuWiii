/** A request deadline linked to its parent's cancellation; dispose after use. */
export function createLinkedSearchAbortSignal(
  parentSignal: AbortSignal | undefined,
  timeoutMs: number,
  timeoutReason: string,
  cancellationReason: string,
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => {
    if (!controller.signal.aborted)
      controller.abort(timeoutReason)
  }, timeoutMs)
  const abortFromParent = () => {
    if (!controller.signal.aborted)
      controller.abort(parentSignal?.reason ?? cancellationReason)
  }

  if (parentSignal?.aborted)
    abortFromParent()
  else
    parentSignal?.addEventListener('abort', abortFromParent, { once: true })

  return {
    dispose: () => {
      clearTimeout(timeout)
      parentSignal?.removeEventListener('abort', abortFromParent)
    },
    signal: controller.signal,
  }
}
