import { SERVER_URL } from './auth'

export type OfficialCapabilityAvailability = 'available' | 'unavailable'

export async function fetchOfficialCapabilityAvailability(capabilityId: string): Promise<OfficialCapabilityAvailability> {
  const url = new URL(`/api/model-gateway/v1/capabilities/${encodeURIComponent(capabilityId)}`, SERVER_URL)
  const response = await fetch(url, { credentials: 'include' })
  if (!response.ok)
    return 'unavailable'

  const body = await response.json() as { configured?: unknown }
  return body.configured === true ? 'available' : 'unavailable'
}
