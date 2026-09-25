import { defineStore } from 'pinia'

import { createSpeechPipelineRuntime } from '../services/speech/pipeline-runtime'

export const useSpeechRuntimeStore = defineStore('speech-runtime', () => {
  const runtime = createSpeechPipelineRuntime()

  function openIntent(options?: Parameters<typeof runtime.openIntent>[0]) {
    return runtime.openIntent(options)
  }

  async function registerHost(...args: Parameters<typeof runtime.registerHost>) {
    return runtime.registerHost(...args)
  }

  async function disposeHost(pipeline: Parameters<typeof runtime.disposeHost>[0]) {
    return runtime.disposeHost(pipeline)
  }

  function isHost() {
    return runtime.isHost()
  }

  function cancelIntent(intentId: string, reason?: string, streamId?: string) {
    return runtime.cancelIntent(intentId, reason, streamId)
  }

  function interrupt(reason?: string) {
    return runtime.interrupt(reason)
  }

  function stopAll(reason?: string) {
    return runtime.stopAll(reason)
  }

  async function dispose() {
    await runtime.dispose()
  }

  return {
    openIntent,
    registerHost,
    disposeHost,
    cancelIntent,
    isHost,
    interrupt,
    stopAll,
    dispose,
  }
})
