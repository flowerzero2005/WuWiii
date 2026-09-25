export enum StageEnvironment {
  Web = 'web',
  Capacitor = 'capacitor',
  Tamagotchi = 'tamagotchi',
}

export type StageProductEdition = 'consumer' | 'creator' | 'dev'

export type StageProductAudience = 'consumer' | 'advanced' | 'developer'

export function getStageProductEdition(): StageProductEdition {
  const edition = import.meta.env.VITE_APP_EDITION

  if (edition === 'consumer' || edition === 'creator' || edition === 'dev') {
    return edition
  }

  return import.meta.env.PROD ? 'consumer' : 'dev'
}

export function isProductAudienceVisible(audience: unknown, edition: StageProductEdition = getStageProductEdition()): boolean {
  if (audience === 'developer') {
    return edition === 'dev'
  }

  return true
}

export function isStageWeb(): boolean {
  return !import.meta.env.RUNTIME_ENVIRONMENT || import.meta.env.RUNTIME_ENVIRONMENT === 'browser'
}

export function isStageCapacitor(): boolean {
  return import.meta.env.RUNTIME_ENVIRONMENT === 'capacitor'
}

export function isStageTamagotchi(): boolean {
  return import.meta.env.RUNTIME_ENVIRONMENT === 'electron'
}

export function isUrlMode(mode: 'file' | 'server'): boolean {
  if (!import.meta.env.URL_MODE) {
    return mode === 'server'
  }

  return import.meta.env.URL_MODE === mode
}
