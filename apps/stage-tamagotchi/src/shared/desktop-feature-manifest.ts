export type DesktopProductEdition = 'consumer' | 'creator' | 'dev'

export const DESKTOP_REQUIRED_FEATURES = [
  'account',
  'connections',
  'data',
  'models',
  'modules',
  'providers',
  'scenes',
  'workbench',
] as const

export type DesktopRequiredFeature = typeof DESKTOP_REQUIRED_FEATURES[number]

export const DESKTOP_REQUIRED_ROUTES = [
  '/',
  '/butler',
  '/dashboard',
  '/quick-chat',
  '/settings',
  '/settings/account',
  '/settings/connection',
  '/settings/data',
  '/settings/group-scenarios',
  '/settings/models',
  '/settings/modules',
  '/settings/modules/vision',
  '/settings/providers',
  '/settings/scene',
  '/settings/system/general',
  '/workbench',
] as const

export const DESKTOP_INTERNAL_ROUTE_PREFIXES = [
  '/devtools',
  '/settings/system/developer',
  '/v2',
] as const

const nonDeveloperRouteExcludes = {
  desktop: [
    '**/devtools/**',
    '**/settings/system/developer.vue',
  ],
  shared: [
    '**/devtools/**',
    '**/v2/**',
  ],
} as const

export interface DesktopFeatureManifest {
  edition: DesktopProductEdition
  features: Record<DesktopRequiredFeature | 'developerTools', boolean>
  requiredRoutes: readonly string[]
  routeExcludes: {
    desktop: readonly string[]
    shared: readonly string[]
  }
  schemaVersion: 1
}

/** Defines the product surface that must ship for each desktop edition. */
export function createDesktopFeatureManifest(edition: DesktopProductEdition): DesktopFeatureManifest {
  return {
    edition,
    features: {
      account: true,
      connections: true,
      data: true,
      developerTools: edition === 'dev',
      models: true,
      modules: true,
      providers: true,
      scenes: true,
      workbench: true,
    },
    requiredRoutes: DESKTOP_REQUIRED_ROUTES,
    routeExcludes: edition === 'dev'
      ? { desktop: [], shared: [] }
      : nonDeveloperRouteExcludes,
    schemaVersion: 1,
  }
}

/** Fails packaging when a required formal-desktop feature is disabled. */
export function assertDesktopFeatureManifest(manifest: DesktopFeatureManifest) {
  const disabledFeatures = DESKTOP_REQUIRED_FEATURES.filter(feature => !manifest.features[feature])
  if (disabledFeatures.length > 0)
    throw new Error(`Desktop ${manifest.edition} manifest disables required features: ${disabledFeatures.join(', ')}`)
}

/** Keeps internal routes out of formal desktop editions. */
export function isDesktopRouteEnabled(path: string, edition: DesktopProductEdition) {
  if (edition === 'dev') {
    return true
  }

  return !DESKTOP_INTERNAL_ROUTE_PREFIXES.some(prefix => path.startsWith(prefix))
}
