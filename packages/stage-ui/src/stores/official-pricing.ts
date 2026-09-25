import { defineStore } from 'pinia'
import { ref } from 'vue'

import { SERVER_URL } from '../libs/auth'

export interface OfficialModelPrice { id: string, minimumSettlePoints: number, name: string, nameZh?: string, pointsPerTokenUnit: number, priceVersion: string, reserveBasePoints: number, tokenUnit: number }
export interface OfficialFeaturePrice { feature: string, multiplier: number, priceVersion: string }
export interface OfficialCapabilityPrices {
  speech: { chains: Array<{ channel: 'primary' | 'secondary', minimumBasePoints: number, pointsPerMinute: number, priceVersion: string, provider: string, state: string }> }
  transcription: { additionalMinutePoints: number, billingMode: 'duration', firstMinutePoints: number, priceVersion: string }
  embedding: { billingMode: 'request', pointsPerRequest: number, priceVersion: string }
  webSearch: { billingMode: 'request', pointsPerRequest: number, priceVersion: string }
}
export interface OfficialPricingSnapshot { capabilities: OfficialCapabilityPrices, features: OfficialFeaturePrice[], generatedAt: string, models: OfficialModelPrice[] }

function finiteNonNegative(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

export function parseOfficialPricing(input: unknown): OfficialPricingSnapshot | undefined {
  if (!input || typeof input !== 'object') {
    return
  }
  const value = input as any
  const validRequest = (item: any) => item?.billingMode === 'request' && finiteNonNegative(item.pointsPerRequest) && typeof item.priceVersion === 'string'
  const transcription = value.capabilities?.transcription
  const chains = value.capabilities?.speech?.chains
  if (typeof value.generatedAt !== 'string' || !Array.isArray(value.models) || !Array.isArray(value.features) || !Array.isArray(chains)
    || transcription?.billingMode !== 'duration' || !finiteNonNegative(transcription.firstMinutePoints) || !finiteNonNegative(transcription.additionalMinutePoints)
    || !validRequest(value.capabilities?.embedding) || !validRequest(value.capabilities?.webSearch)) {
    return
  }
  if (!value.models.every((item: any) => typeof item?.id === 'string' && typeof item.name === 'string' && finiteNonNegative(item.pointsPerTokenUnit) && finiteNonNegative(item.tokenUnit) && finiteNonNegative(item.minimumSettlePoints) && finiteNonNegative(item.reserveBasePoints) && typeof item.priceVersion === 'string'))
    return
  if (!value.features.every((item: any) => typeof item?.feature === 'string' && finiteNonNegative(item.multiplier) && typeof item.priceVersion === 'string'))
    return
  if (!chains.every((item: any) => (item?.channel === 'primary' || item?.channel === 'secondary') && typeof item.provider === 'string' && finiteNonNegative(item.pointsPerMinute) && finiteNonNegative(item.minimumBasePoints) && typeof item.priceVersion === 'string' && typeof item.state === 'string'))
    return
  return value as OfficialPricingSnapshot
}

export const useOfficialPricingStore = defineStore('official-pricing', () => {
  const snapshot = ref<OfficialPricingSnapshot>()
  const error = ref<unknown>()
  let request: Promise<OfficialPricingSnapshot | undefined> | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let subscribers = 0

  async function refresh() {
    if (request)
      return request
    request = (async () => {
      try {
        const response = await fetch(new URL('/api/model-gateway/v1/pricing', SERVER_URL), { credentials: 'include' })
        if (!response.ok)
          throw new Error(`Official pricing request failed (${response.status})`)
        const parsed = parseOfficialPricing(await response.json())
        if (!parsed)
          throw new Error('Official pricing response is invalid')
        snapshot.value = parsed
        error.value = undefined
        return parsed
      }
      catch (nextError) {
        error.value = nextError
        return snapshot.value
      }
      finally {
        request = undefined
      }
    })()
    return request
  }

  const onFocus = () => {
    void refresh()
  }
  const onVisibility = () => {
    if (document.visibilityState === 'visible')
      void refresh()
  }
  function start() {
    subscribers += 1
    if (subscribers > 1 || typeof window === 'undefined')
      return
    void refresh()
    timer = setInterval(() => void refresh(), 60_000)
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibility)
  }
  function stop() {
    subscribers = Math.max(0, subscribers - 1)
    if (subscribers || typeof window === 'undefined')
      return
    if (timer)
      clearInterval(timer)
    timer = undefined
    window.removeEventListener('focus', onFocus)
    document.removeEventListener('visibilitychange', onVisibility)
  }
  const getCapability = <K extends keyof OfficialCapabilityPrices>(key: K) => snapshot.value?.capabilities[key]
  const getModel = (id: string) => snapshot.value?.models.find(model => model.id === id)
  const getFeature = (feature: string) => snapshot.value?.features.find(item => item.feature === feature)
  return { error, getCapability, getFeature, getModel, refresh, snapshot, start, stop }
})
