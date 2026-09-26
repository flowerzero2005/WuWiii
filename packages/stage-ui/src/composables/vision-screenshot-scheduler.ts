import type { VisionAttachment } from '../stores/modules/vision'

export interface VisionScreenshotSchedulerOptions {
  capture: () => Promise<VisionAttachment>
  analyze: (attachment: VisionAttachment, signal: AbortSignal) => Promise<string | undefined>
  publish: (text: string) => void
  onError: (error: unknown) => void
  intervalMs: number
}

/** A new timer is scheduled only after the previous capture and analysis settle. */
export function createVisionScreenshotScheduler(options: VisionScreenshotSchedulerOptions) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let stopped = false
  const controller = new AbortController()
  async function run() {
    timer = undefined
    try {
      const attachment = await options.capture()
      if (stopped)
        return
      const text = await options.analyze(attachment, controller.signal)
      if (!stopped && text)
        options.publish(text)
    }
    catch (error) {
      if (!stopped)
        options.onError(error)
    }
    finally {
      if (!stopped)
        timer = setTimeout(() => void run(), options.intervalMs)
    }
  }
  timer = setTimeout(() => void run(), options.intervalMs)
  return {
    stop() {
      stopped = true
      if (timer !== undefined)
        clearTimeout(timer)
      controller.abort()
    },
  }
}
