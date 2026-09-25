import type { Session } from 'electron'

function isTrustedRendererUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === 'file:'
      || (url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))
  }
  catch {
    return false
  }
}

function isOpaqueOrigin(value: string | undefined) {
  return value === '' || value === 'null' || value === undefined
}

function isTrustedMediaRequest(webContents: { getURL: () => string } | null | undefined, requestingOrigin: string | undefined) {
  return isTrustedRendererUrl(webContents?.getURL() ?? '')
    && (isTrustedRendererUrl(requestingOrigin ?? '') || isOpaqueOrigin(requestingOrigin))
}

/** Allow microphone capture only for Wuwiii's local renderer pages. */
export function setupMediaPermissions(targetSession: Session) {
  targetSession.setPermissionCheckHandler((webContents, permission, requestingOrigin, details) => {
    return permission === 'media'
      && details.mediaType !== 'video'
      && isTrustedMediaRequest(webContents, requestingOrigin)
  })

  targetSession.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const allowed = permission === 'media'
      && isTrustedMediaRequest(webContents, details.requestingUrl)
      && (!('mediaTypes' in details)
        || details.mediaTypes === undefined
        || (details.mediaTypes.includes('audio') && !details.mediaTypes.includes('video')))
    callback(allowed)
  })
}
