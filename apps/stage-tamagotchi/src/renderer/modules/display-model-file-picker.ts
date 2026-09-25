import type { DisplayModelFilePicker } from '@proj-airi/stage-ui/composables/use-display-model-file-dialog'

import type { ElectronDisplayModelFilePickerRequest, ElectronDisplayModelFilePickerResult } from '../../shared/eventa'

export function createDesktopDisplayModelFilePicker(
  invoke: (payload: ElectronDisplayModelFilePickerRequest) => Promise<ElectronDisplayModelFilePickerResult | undefined>,
): DisplayModelFilePicker {
  return async (kind) => {
    const result = await invoke({ kind })
    if (!result)
      return

    const bytes = new Uint8Array(result.bytes.byteLength)
    bytes.set(result.bytes)

    return new File([bytes.buffer], result.name, {
      lastModified: result.lastModified,
      type: result.mimeType,
    })
  }
}
