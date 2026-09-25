import type { WindowEventaContext } from './window'

const windowEventaContexts = new Set<WindowEventaContext>()

export function registerWindowEventaContext(context: WindowEventaContext) {
  windowEventaContexts.add(context)
  return () => windowEventaContexts.delete(context)
}

export function broadcastToWindowEventaContexts(emit: (context: WindowEventaContext) => void) {
  let emittedCount = 0

  for (const context of windowEventaContexts) {
    try {
      emit(context)
      emittedCount += 1
    }
    catch (error) {
      console.warn('[WindowEventa] Failed to emit to a renderer window:', error)
    }
  }

  return emittedCount
}
