import { rm } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'

const DESKTOP_APPLICATION_DATA_ENTRIES = [
  'airi-agent-sessions',
  'airi-butler-tasks',
  'airi-command-journal',
  'airi-workbench-memory',
  'app-config.json',
  'app-options.json',
  'mcp.json',
  'plugins',
  'plugins-v1.json',
  'server-channel-config.json',
  'websocket-ca-cert.pem',
  'websocket-ca-key.pem',
  'websocket-cert.pem',
  'websocket-key.pem',
  'windows-butler-config.json',
  'windows-caption-config.json',
  'windows-quick-chat-config.json',
  'windows-widgets-config.json',
  'workbench-workspaces-v1.json',
] as const

export function resolveDesktopApplicationDataTargets(userDataRoot: string) {
  const resolvedRoot = resolve(userDataRoot)
  return DESKTOP_APPLICATION_DATA_ENTRIES.map((entry) => {
    const target = resolve(resolvedRoot, entry)
    const pathFromRoot = relative(resolvedRoot, target)
    if (!pathFromRoot || pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot))
      throw new Error(`Refusing to clear application data outside userData: ${target}`)
    return target
  })
}

export async function clearDesktopApplicationData(userDataRoot: string) {
  const targets = resolveDesktopApplicationDataTargets(userDataRoot)
  await Promise.all(targets.map(target => rm(target, { force: true, recursive: true })))
  return { clearedEntries: targets.length }
}
