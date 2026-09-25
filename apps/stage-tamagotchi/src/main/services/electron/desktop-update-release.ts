import type { DesktopUpdatePublishConfig } from './desktop-update-config'

import { parse } from 'yaml'

function metadataObject(raw: string) {
  const value = parse(raw) as unknown
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Packaged app-update.yml must contain an object')
  return value as Record<string, unknown>
}

/** Verify that the packaged updater metadata targets the exact owned release source. */
export function assertPackagedDesktopUpdateConfig(raw: string, expected: DesktopUpdatePublishConfig) {
  const metadata = metadataObject(raw)
  if (metadata.provider !== expected.provider)
    throw new Error(`Packaged update provider must be ${expected.provider}`)

  if (metadata.url !== expected.url)
    throw new Error('Packaged generic update URL does not match DESKTOP_UPDATE_URL')

  if (metadata.channel !== expected.channel)
    throw new Error('Packaged update channel does not match DESKTOP_UPDATE_CHANNEL')
}
