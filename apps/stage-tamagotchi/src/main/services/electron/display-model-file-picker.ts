import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type { BrowserWindow, OpenDialogOptions } from 'electron'

import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { dialog } from 'electron'

import { electronPickDisplayModelFile } from '../../../shared/eventa'

export const MAX_DISPLAY_MODEL_FILE_BYTES = 256 * 1024 * 1024

const pickerOptions = {
  'live2d': {
    extension: '.zip',
    mimeType: 'application/zip',
    filters: [{ extensions: ['zip'], name: 'Live2D ZIP archive' }],
  },
  'picture-oc': {
    extension: '.zip',
    mimeType: 'application/zip',
    filters: [{ extensions: ['zip'], name: 'Picture OC ZIP archive' }],
  },
  'vrm': {
    extension: '.vrm',
    mimeType: 'model/gltf-binary',
    filters: [{ extensions: ['vrm'], name: 'VRM model' }],
  },
} as const satisfies Record<string, Pick<OpenDialogOptions, 'filters'> & { extension: string, mimeType: string }>

export function createDisplayModelFilePickerService(params: {
  context: ReturnType<typeof createContext>['context']
  window: BrowserWindow
}) {
  defineInvokeHandler(params.context, electronPickDisplayModelFile, async (payload, options) => {
    if (!payload || params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id)
      return

    const config = pickerOptions[payload.kind]
    // NOTICE: Keep this chooser modeless. Parenting it to a settings window
    // stalls the other always-on-top transparent companion windows on Windows.
    const result = await dialog.showOpenDialog({
      filters: config.filters.map(filter => ({ ...filter, extensions: [...filter.extensions] })),
      properties: ['openFile'],
    })
    const filePath = result.filePaths[0]
    if (result.canceled || !filePath)
      return

    if (extname(filePath).toLowerCase() !== config.extension)
      throw new Error(`Expected a ${config.extension} display model file.`)

    const fileStats = await stat(filePath)
    if (!fileStats.isFile())
      throw new Error('The selected display model is not a file.')
    // NOTICE: Electron IPC clones the selected bytes. Bound peak memory while still
    // covering normal Live2D and VRM packages; larger models need a streamed contract.
    if (fileStats.size > MAX_DISPLAY_MODEL_FILE_BYTES)
      throw new Error('Display model files must be 256 MiB or smaller.')

    const bytes = await readFile(filePath)
    return {
      bytes: new Uint8Array(bytes.buffer, bytes.byteOffset, bytes.byteLength),
      lastModified: fileStats.mtimeMs,
      mimeType: config.mimeType,
      name: basename(filePath),
    }
  })
}
