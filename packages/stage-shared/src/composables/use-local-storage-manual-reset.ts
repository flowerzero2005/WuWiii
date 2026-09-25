import type { ManualResetRefReturn, UseStorageOptions } from '@vueuse/core'
import type { MaybeRefOrGetter, WatchOptions } from 'vue'

import { refManualReset, StorageSerializers, useLocalStorage } from '@vueuse/core'
import { getCurrentScope, onScopeDispose, toRaw, toValue, watch } from 'vue'

const persistedStateRefreshHandlers = new Set<() => void>()

export function refreshLocalStorageManualResetBindings() {
  for (const refresh of persistedStateRefreshHandlers)
    refresh()
}

function resolveStorageSerializer<T>(value: T, options?: UseStorageOptions<T>) {
  if (options?.serializer)
    return options.serializer
  if (value instanceof Map)
    return StorageSerializers.map
  if (value instanceof Set)
    return StorageSerializers.set
  if (value instanceof Date)
    return StorageSerializers.date
  if (Array.isArray(value))
    return StorageSerializers.object
  if (value === null || typeof value === 'object')
    return StorageSerializers.object
  if (typeof value === 'boolean')
    return StorageSerializers.boolean
  if (typeof value === 'number')
    return StorageSerializers.number
  if (typeof value === 'string')
    return StorageSerializers.string
  return StorageSerializers.any
}

function restoreValueShape<T>(value: T, template: T): T {
  const rawTemplate = toRaw(template)
  const rawValue = toRaw(value) as unknown

  if (rawTemplate instanceof Map) {
    if (rawValue instanceof Map)
      return rawValue as T

    if (Array.isArray(rawValue))
      return new Map(rawValue as Iterable<[unknown, unknown]>) as T

    if (typeof rawValue === 'object' && rawValue !== null)
      return new Map(Object.entries(rawValue as Record<string, unknown>)) as T
  }

  return value
}

export function useLocalStorageManualReset<T>(key: MaybeRefOrGetter<string>, initialValue: MaybeRefOrGetter<T>, options?: UseStorageOptions<T> & WatchOptions): ManualResetRefReturn<T> {
  const value = toValue(initialValue)
  const syncWatchOptions = {
    ...options,
    deep: options?.deep ?? true,
  }
  const localStorageState = useLocalStorage<T>(key, value, options)
  const state = refManualReset<T>(localStorageState)
  const serializer = resolveStorageSerializer(value, options)

  const refreshFromStorage = () => {
    if (typeof window === 'undefined')
      return

    const rawValue = window.localStorage.getItem(toValue(key))
    const persistedValue = rawValue === null
      ? value
      : serializer.read(rawValue) as T
    localStorageState.value = restoreValueShape(persistedValue, value)
  }
  persistedStateRefreshHandlers.add(refreshFromStorage)
  if (getCurrentScope())
    onScopeDispose(() => persistedStateRefreshHandlers.delete(refreshFromStorage))

  const { resume, pause } = watch(state, (newValue) => {
    localStorageState.value = restoreValueShape(newValue, value)
  }, syncWatchOptions)

  watch(localStorageState, (newValue) => {
    const normalizedValue = restoreValueShape(newValue, value)
    pause()
    state.value = normalizedValue
    resume()
  }, syncWatchOptions)

  return state
}
