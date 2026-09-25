import type {
  ElectronWorkbenchStaticPreviewSnapshot,
  ElectronWorkbenchStaticPreviewStartPayload,
  ElectronWorkbenchStaticPreviewStopPayload,
} from '../../shared/eventa'

import { defineInvoke } from '@moeru/eventa'
import { createContext } from '@moeru/eventa/adapters/electron/renderer'
import { defineStore } from 'pinia'
import { ref } from 'vue'

import {
  electronWorkbenchStaticPreviewStart,
  electronWorkbenchStaticPreviewStop,
} from '../../shared/eventa'

type WorkbenchStaticPreviewInvokers = ReturnType<typeof createInvokers>

let cachedInvokers: WorkbenchStaticPreviewInvokers | undefined

function createInvokers() {
  const { context } = createContext(window.electron.ipcRenderer)
  return {
    start: defineInvoke(context, electronWorkbenchStaticPreviewStart),
    stop: defineInvoke(context, electronWorkbenchStaticPreviewStop),
  }
}

function resolveInvokers() {
  if (!cachedInvokers)
    cachedInvokers = createInvokers()
  return cachedInvokers
}

function stringifyError(error: unknown) {
  if (error instanceof Error)
    return error.message

  return String(error)
}

export const useWorkbenchStaticPreviewStore = defineStore('tamagotchi-workbench-static-preview', () => {
  const error = ref<string>()
  const lastPreview = ref<ElectronWorkbenchStaticPreviewSnapshot>()
  const loading = ref(false)

  function clearError() {
    error.value = undefined
  }

  async function withRequest<T>(action: string, run: (invokers: WorkbenchStaticPreviewInvokers) => Promise<T>) {
    loading.value = true
    clearError()

    try {
      return await run(resolveInvokers())
    }
    catch (cause) {
      error.value = `Workbench static preview ${action} failed: ${stringifyError(cause)}`
      throw cause
    }
    finally {
      loading.value = false
    }
  }

  async function start(payload: ElectronWorkbenchStaticPreviewStartPayload) {
    const preview = await withRequest('start', invokers => invokers.start(payload))
    lastPreview.value = { ...preview }
    return preview
  }

  async function stop(payload: ElectronWorkbenchStaticPreviewStopPayload) {
    await withRequest('stop', invokers => invokers.stop(payload))
    if (lastPreview.value?.previewId === payload.previewId) {
      lastPreview.value = {
        ...lastPreview.value,
        status: 'stopped',
      }
    }
  }

  return {
    error,
    lastPreview,
    loading,

    clearError,
    start,
    stop,
  }
})
