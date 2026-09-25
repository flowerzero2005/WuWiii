import { useFileDialog } from '@vueuse/core'
import { computed, inject, nextTick, provide, ref } from 'vue'

export type DisplayModelFileKind = 'live2d' | 'picture-oc' | 'vrm'
export type DisplayModelFilePicker = (kind: DisplayModelFileKind) => Promise<File | undefined>

const displayModelFilePickerKey = Symbol('display-model-file-picker')
const activeDesktopPickerCount = ref(0)
const displayModelFilePickerActive = computed(() => activeDesktopPickerCount.value > 0)

export function provideDisplayModelFilePicker(picker: DisplayModelFilePicker) {
  provide(displayModelFilePickerKey, picker)
}

export function useDisplayModelFilePickerActive() {
  return displayModelFilePickerActive
}

// Let Windows and Chromium paint one focused frame before restarting the preview ticker.
function releaseDesktopPickerAfterPaint() {
  const release = () => {
    activeDesktopPickerCount.value = Math.max(0, activeDesktopPickerCount.value - 1)
  }

  if (typeof requestAnimationFrame === 'function')
    requestAnimationFrame(() => requestAnimationFrame(release))
  else
    release()
}

export function useDisplayModelFileDialog(options: {
  accept: string
  kind: DisplayModelFileKind
  onChange: (file: File) => void
  onError?: (error: unknown) => void
}) {
  const desktopPicker = inject<DisplayModelFilePicker | undefined>(displayModelFilePickerKey, undefined)
  const browserDialog = useFileDialog({ accept: options.accept, multiple: false, reset: true })

  browserDialog.onChange((files) => {
    const file = files?.[0]
    if (file)
      options.onChange(file)
  })

  async function open() {
    if (!desktopPicker) {
      browserDialog.open()
      return
    }

    activeDesktopPickerCount.value += 1
    await nextTick()
    try {
      const file = await desktopPicker(options.kind)
      if (file)
        options.onChange(file)
    }
    catch (error) {
      if (options.onError)
        options.onError(error)
      else
        console.error('[DisplayModelFileDialog] Failed to select a file:', error)
    }
    finally {
      releaseDesktopPickerAfterPaint()
    }
  }

  return { open }
}
