import posthog from 'posthog-js'

import { DEFAULT_POSTHOG_CONFIG, POSTHOG_PROJECT_KEY_DESKTOP } from '../../../../../posthog.config'

export const ANALYTICS_CONSENT_STORAGE_KEY = 'airi.analytics.consent'

let initialized = false

function resolveStorage(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  if (storage)
    return storage
  if (typeof localStorage === 'undefined')
    return undefined
  return localStorage
}

function initializePosthog() {
  if (initialized || !POSTHOG_PROJECT_KEY_DESKTOP)
    return false

  posthog.init(POSTHOG_PROJECT_KEY_DESKTOP, {
    ...DEFAULT_POSTHOG_CONFIG,
    autocapture: false,
    capture_pageleave: false,
    capture_pageview: false,
    disable_session_recording: true,
    persistence: 'localStorage',
    // Project-specific config...
  })
  initialized = true
  return true
}

export function initializePosthogFromConsent(storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  const target = resolveStorage(storage)
  if (target?.getItem(ANALYTICS_CONSENT_STORAGE_KEY) !== 'true')
    return false

  return initializePosthog()
}

export function setAnalyticsConsent(consent: boolean, storage?: Pick<Storage, 'getItem' | 'setItem'>) {
  const target = resolveStorage(storage)
  target?.setItem(ANALYTICS_CONSENT_STORAGE_KEY, String(consent))

  if (consent) {
    if (initialized)
      posthog.opt_in_capturing()
    else
      initializePosthog()
    return
  }

  if (initialized)
    posthog.opt_out_capturing()
}

// Existing installations retain their prior opt-in; new installations stay
// silent until the user explicitly grants analytics consent.
void initializePosthogFromConsent()
