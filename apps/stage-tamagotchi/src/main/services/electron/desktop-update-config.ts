export interface DesktopUpdatePublishConfig {
  channel: string
  provider: 'generic'
  url: string
}

type UpdateEnvironment = Record<string, string | undefined>

function isValidChannel(value: string) {
  const allowed = 'abcdefghijklmnopqrstuvwxyz0123456789-'
  return value.length <= 32
    && value[0] !== undefined
    && value[0] !== '-'
    && [...value].every(character => allowed.includes(character))
}

function required(value: string | undefined, name: string) {
  const normalized = value?.trim()
  if (!normalized)
    throw new Error(`${name} is required when desktop updates are configured`)
  return normalized
}

function updateUrl(value: string | undefined) {
  const raw = required(value, 'DESKTOP_UPDATE_URL')
  let url: URL
  try {
    url = new URL(raw)
  }
  catch {
    throw new Error('DESKTOP_UPDATE_URL must be a valid HTTPS URL')
  }

  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash)
    throw new Error('DESKTOP_UPDATE_URL must be an HTTPS URL without credentials, query, or fragment')
  return url.toString()
}

/** Resolve the packaged update feed without ever falling back to the source repository. */
export function resolveDesktopUpdatePublishConfig(env: UpdateEnvironment): DesktopUpdatePublishConfig | undefined {
  const provider = env.DESKTOP_UPDATE_PROVIDER?.trim()
  const githubValues = [env.DESKTOP_UPDATE_GITHUB_OWNER, env.DESKTOP_UPDATE_GITHUB_REPO]
  const relatedValues = [
    env.DESKTOP_UPDATE_CHANNEL,
    env.DESKTOP_UPDATE_URL,
    ...githubValues,
  ]

  if (!provider && relatedValues.every(value => !value?.trim()))
    return undefined
  if (provider !== 'generic')
    throw new Error('DESKTOP_UPDATE_PROVIDER must be generic; GitHub update feeds are not supported')
  if (githubValues.some(value => value?.trim()))
    throw new Error('GitHub update settings are not supported; use DESKTOP_UPDATE_URL on an owned HTTPS host')

  const channel = required(env.DESKTOP_UPDATE_CHANNEL, 'DESKTOP_UPDATE_CHANNEL')
  if (!isValidChannel(channel))
    throw new Error('DESKTOP_UPDATE_CHANNEL must contain only lowercase letters, digits, or hyphens')

  return { channel, provider, url: updateUrl(env.DESKTOP_UPDATE_URL) }
}

export function requireDesktopUpdatePublishConfig(env: UpdateEnvironment): DesktopUpdatePublishConfig {
  const config = resolveDesktopUpdatePublishConfig(env)
  if (!config)
    throw new Error('A complete owned DESKTOP_UPDATE_* configuration is required for release publishing')
  return config
}
