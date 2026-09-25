import type { OfficialPricingSnapshot } from '../official-pricing'

import { defineStore } from 'pinia'
import { ref } from 'vue'

import { useOfficialPricingStore } from '../official-pricing'

export type OfficialPaidCapability = 'web-search' | 'embedding' | 'transcription' | 'inner-voice-note' | 'speech'

export type OfficialCapabilityConsentDisplay
  = | { billingMode: 'request', pointsPerRequest: number }
    | { billingMode: 'duration', additionalMinutePoints: number, firstMinutePoints: number }
    | { billingMode: 'model-usage', minimumPoints: number, modelId: string, multiplier: number, pointsPerTokenUnit: number, tokenUnit: number }
    | { billingMode: 'speech-duration', channel: 'primary' | 'secondary', minimumBasePoints: number, pointsPerMinute: number }

export interface OfficialCapabilityConsentQuote {
  capability: OfficialPaidCapability
  display: OfficialCapabilityConsentDisplay
  fingerprint: string
  priceVersion: string
  priceVector: number[]
}

export interface OfficialCapabilityConsentAcceptance {
  acceptedAt: string
  quote: OfficialCapabilityConsentQuote
}

export interface OfficialCapabilityConsentQuoteOptions {
  modelId?: string
  speechChannel?: 'primary' | 'secondary'
}

export type OfficialCapabilityConsentAcceptances = Record<string, OfficialCapabilityConsentAcceptance>

const STORAGE_KEY = 'settings/official-capability-consents'

/** Ordinary speech follows its explicit playback switch; other paid capabilities need first-use confirmation. */
export function requiresOfficialCapabilityConsent(capability: OfficialPaidCapability): boolean {
  return capability !== 'speech'
}

function quoteInput(quote: Omit<OfficialCapabilityConsentQuote, 'fingerprint'>) {
  const display = quote.display
  switch (display.billingMode) {
    case 'request':
      return [quote.capability, quote.priceVersion, display.billingMode, display.pointsPerRequest]
    case 'duration':
      return [quote.capability, quote.priceVersion, display.billingMode, display.firstMinutePoints, display.additionalMinutePoints]
    case 'model-usage':
      return [quote.capability, quote.priceVersion, display.billingMode, display.modelId, display.minimumPoints, display.pointsPerTokenUnit, display.tokenUnit, display.multiplier]
    case 'speech-duration':
      return [quote.capability, quote.priceVersion, display.billingMode, display.channel, display.minimumBasePoints, display.pointsPerMinute]
  }
}

/** Returns the same fingerprint for the same capability and published billing terms. */
export function createOfficialCapabilityConsentFingerprint(quote: Omit<OfficialCapabilityConsentQuote, 'fingerprint'>): string {
  return JSON.stringify(quoteInput(quote))
}

function completeQuote(quote: Omit<OfficialCapabilityConsentQuote, 'fingerprint'>): OfficialCapabilityConsentQuote {
  return { ...quote, fingerprint: createOfficialCapabilityConsentFingerprint(quote) }
}

/** Converts the live pricing snapshot into terms suitable for a consent dialog. */
export function createOfficialCapabilityConsentQuote(
  snapshot: OfficialPricingSnapshot | undefined,
  capability: OfficialPaidCapability,
  options: OfficialCapabilityConsentQuoteOptions = {},
): OfficialCapabilityConsentQuote | undefined {
  if (!snapshot)
    return

  if (capability === 'web-search' || capability === 'embedding') {
    const price = capability === 'web-search' ? snapshot.capabilities.webSearch : snapshot.capabilities.embedding
    return completeQuote({
      capability,
      display: { billingMode: 'request', pointsPerRequest: price.pointsPerRequest },
      priceVector: [price.pointsPerRequest],
      priceVersion: price.priceVersion,
    })
  }

  if (capability === 'transcription') {
    const price = snapshot.capabilities.transcription
    return completeQuote({
      capability,
      display: { billingMode: 'duration', additionalMinutePoints: price.additionalMinutePoints, firstMinutePoints: price.firstMinutePoints },
      priceVector: [price.firstMinutePoints, price.additionalMinutePoints],
      priceVersion: price.priceVersion,
    })
  }

  if (capability === 'speech') {
    const price = snapshot.capabilities.speech.chains.find(chain => chain.channel === options.speechChannel)
    if (!price)
      return
    return completeQuote({
      capability,
      display: { billingMode: 'speech-duration', channel: price.channel, minimumBasePoints: price.minimumBasePoints, pointsPerMinute: price.pointsPerMinute },
      priceVector: [price.minimumBasePoints, price.pointsPerMinute],
      priceVersion: price.priceVersion,
    })
  }

  const model = snapshot.models.find(item => item.id === (options.modelId || 'airi-default'))
  const feature = snapshot.features.find(item => item.feature === 'inner-voice-note')
  if (!model || !feature)
    return
  const minimumPoints = model.minimumSettlePoints * feature.multiplier
  const pointsPerTokenUnit = model.pointsPerTokenUnit * feature.multiplier
  return completeQuote({
    capability,
    display: { billingMode: 'model-usage', minimumPoints, modelId: model.id, multiplier: feature.multiplier, pointsPerTokenUnit, tokenUnit: model.tokenUnit },
    priceVector: [minimumPoints, pointsPerTokenUnit / model.tokenUnit],
    priceVersion: `${model.priceVersion}+${feature.priceVersion}`,
  })
}

/** Price reductions keep prior consent; increases or non-price term changes require it again. */
export function needsOfficialCapabilityConsent(
  accepted: OfficialCapabilityConsentAcceptance | undefined,
  current: OfficialCapabilityConsentQuote | undefined,
): boolean {
  if (!accepted || !current)
    return true
  if (accepted.quote.fingerprint === current.fingerprint)
    return false
  if (accepted.quote.capability !== current.capability || accepted.quote.display.billingMode !== current.display.billingMode)
    return true
  if (accepted.quote.priceVector.length !== current.priceVector.length)
    return true
  const acceptedDisplay = accepted.quote.display
  const currentDisplay = current.display
  if (acceptedDisplay.billingMode === 'model-usage' && currentDisplay.billingMode === 'model-usage'
    && (acceptedDisplay.modelId !== currentDisplay.modelId || acceptedDisplay.tokenUnit !== currentDisplay.tokenUnit || acceptedDisplay.multiplier !== currentDisplay.multiplier)) {
    return true
  }
  if (acceptedDisplay.billingMode === 'speech-duration' && currentDisplay.billingMode === 'speech-duration'
    && acceptedDisplay.channel !== currentDisplay.channel) {
    return true
  }
  return current.priceVector.some((price, index) => price > accepted.quote.priceVector[index])
}

function isQuote(value: unknown): value is OfficialCapabilityConsentQuote {
  if (!value || typeof value !== 'object')
    return false
  const quote = value as Partial<OfficialCapabilityConsentQuote>
  return typeof quote.fingerprint === 'string'
    && typeof quote.priceVersion === 'string'
    && Array.isArray(quote.priceVector)
    && quote.priceVector.every(price => typeof price === 'number' && Number.isFinite(price) && price >= 0)
    && !!quote.display && typeof quote.display === 'object'
    && ['web-search', 'embedding', 'transcription', 'inner-voice-note', 'speech'].includes(quote.capability ?? '')
}

function acceptanceKey(scopeId: string, capability: OfficialPaidCapability): string {
  return JSON.stringify([scopeId.trim(), capability])
}

function parseAcceptanceKey(key: string): [string, OfficialPaidCapability] | undefined {
  try {
    const value = JSON.parse(key) as unknown
    if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || !value[0].trim()
      || !['web-search', 'embedding', 'transcription', 'inner-voice-note', 'speech'].includes(String(value[1]))) {
      return
    }
    return [value[0].trim(), value[1] as OfficialPaidCapability]
  }
  catch {
    // Invalid storage keys are ignored with the rest of the damaged record.
  }
}

export function parseOfficialCapabilityConsentAcceptances(raw: string | null): OfficialCapabilityConsentAcceptances {
  if (!raw)
    return {}
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>
    return Object.fromEntries(Object.entries(parsed).filter(([key, value]) => {
      const acceptance = value as Partial<OfficialCapabilityConsentAcceptance> | undefined
      const scopedCapability = parseAcceptanceKey(key)?.[1]
      return !!scopedCapability
        && typeof acceptance?.acceptedAt === 'string'
        && isQuote(acceptance.quote)
        && acceptance.quote.capability === scopedCapability
        && acceptance.quote.fingerprint === createOfficialCapabilityConsentFingerprint(acceptance.quote)
    })) as OfficialCapabilityConsentAcceptances
  }
  catch {
    return {}
  }
}

function storage(): Storage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage
  }
  catch {
    return undefined
  }
}

export const useOfficialCapabilityConsentStore = defineStore('official-capability-consent', () => {
  const pricing = useOfficialPricingStore()
  const acceptances = ref(parseOfficialCapabilityConsentAcceptances(storage()?.getItem(STORAGE_KEY) ?? null))

  function persist() {
    storage()?.setItem(STORAGE_KEY, JSON.stringify(acceptances.value))
  }

  function getQuote(capability: OfficialPaidCapability, options?: OfficialCapabilityConsentQuoteOptions) {
    return createOfficialCapabilityConsentQuote(pricing.snapshot, capability, options)
  }

  function getAcceptance(scopeId: string | undefined, capability: OfficialPaidCapability) {
    if (!scopeId?.trim())
      return
    return acceptances.value[acceptanceKey(scopeId, capability)]
  }

  function needsConsent(scopeId: string | undefined, capability: OfficialPaidCapability, quote = getQuote(capability)) {
    if (!requiresOfficialCapabilityConsent(capability))
      return false
    return needsOfficialCapabilityConsent(getAcceptance(scopeId, capability), quote)
  }

  function accept(scopeId: string | undefined, capability: OfficialPaidCapability, quote = getQuote(capability)): boolean {
    if (!scopeId?.trim() || !quote || quote.capability !== capability)
      return false
    acceptances.value[acceptanceKey(scopeId, capability)] = { acceptedAt: new Date().toISOString(), quote }
    persist()
    return true
  }

  function revoke(scopeId: string | undefined, capability: OfficialPaidCapability) {
    if (!scopeId?.trim())
      return
    delete acceptances.value[acceptanceKey(scopeId, capability)]
    persist()
  }

  return { accept, acceptances, getAcceptance, getQuote, needsConsent, revoke }
})
