import { defineInvokeEventa } from '@moeru/eventa'

export interface ElectronClearApplicationDataResult {
  clearedEntries: number
  restarting: boolean
}

export const electronClearApplicationData = defineInvokeEventa<ElectronClearApplicationDataResult>('eventa:invoke:electron:app-data:clear')
