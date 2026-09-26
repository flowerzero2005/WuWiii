import { toRaw } from 'vue'

/** Values accepted by the browser structured-clone transport. */
type TransportValue = null | boolean | number | string | TransportValue[] | { [key: string]: TransportValue }

export interface BroadcastTransportPreparation<T> {
  cloneFailurePath?: string
  droppedPaths: string[]
  payload: T
}

function isPlainObject(value: object) {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

function sanitizeTransportValue(value: unknown, path: string, seen: WeakSet<object>, droppedPaths: string[]): TransportValue | undefined {
  if (value === null || typeof value === 'string' || typeof value === 'boolean')
    return value
  if (typeof value === 'number') {
    if (Number.isFinite(value))
      return value
    droppedPaths.push(path)
    return undefined
  }
  if (typeof value !== 'object') {
    if (value !== undefined)
      droppedPaths.push(path)
    return undefined
  }

  const rawValue = toRaw(value)
  // Promises, AbortSignal instances, streams and runtime class instances are
  // intentionally excluded. They do not describe UI state and cannot cross
  // a BroadcastChannel safely.
  if (typeof (rawValue as PromiseLike<unknown>).then === 'function' || (!isPlainObject(rawValue) && !Array.isArray(rawValue))) {
    droppedPaths.push(path)
    return undefined
  }
  if (seen.has(rawValue)) {
    droppedPaths.push(path)
    return undefined
  }
  seen.add(rawValue)

  if (Array.isArray(rawValue)) {
    const result: TransportValue[] = []
    for (let index = 0; index < rawValue.length; index++) {
      const item = sanitizeTransportValue(rawValue[index], `${path}[${index}]`, seen, droppedPaths)
      if (item !== undefined)
        result.push(item)
    }
    seen.delete(rawValue)
    return result
  }

  const result: { [key: string]: TransportValue } = {}
  for (const [key, itemValue] of Object.entries(rawValue)) {
    const item = sanitizeTransportValue(itemValue, `${path}.${key}`, seen, droppedPaths)
    if (item !== undefined)
      result[key] = item
  }
  seen.delete(rawValue)
  return result
}

/**
 * Creates a plain transport DTO and probes it before BroadcastChannel sees it.
 * Diagnostics contain only paths, never values, prompts, or credentials.
 */
export function prepareBroadcastTransport<T>(payload: T): BroadcastTransportPreparation<T> {
  const droppedPaths: string[] = []
  const sanitized = sanitizeTransportValue(payload, 'payload', new WeakSet(), droppedPaths)
  const transportPayload = (sanitized ?? {}) as T

  if (typeof structuredClone !== 'function')
    return { payload: transportPayload, droppedPaths }

  try {
    structuredClone(transportPayload)
    return { payload: transportPayload, droppedPaths }
  }
  catch {
    return {
      payload: transportPayload,
      droppedPaths,
      cloneFailurePath: droppedPaths[0] ?? 'payload',
    }
  }
}
