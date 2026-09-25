import { describe, expect, it } from 'vitest'

import {
  assertDesktopFeatureManifest,
  createDesktopFeatureManifest,
  DESKTOP_REQUIRED_FEATURES,
  DESKTOP_REQUIRED_ROUTES,
  isDesktopRouteEnabled,
} from './desktop-feature-manifest'

describe('desktop feature manifest', () => {
  it('keeps the complete consumer product surface while excluding internal routes', () => {
    const manifest = createDesktopFeatureManifest('consumer')

    expect(() => assertDesktopFeatureManifest(manifest)).not.toThrow()
    expect(DESKTOP_REQUIRED_FEATURES.every(feature => manifest.features[feature])).toBe(true)
    expect(manifest.features.workbench).toBe(true)
    expect(manifest.requiredRoutes).toEqual(DESKTOP_REQUIRED_ROUTES)
    expect(manifest.requiredRoutes).toContain('/dashboard')
    expect(manifest.requiredRoutes).toContain('/settings/system/general')
    expect(manifest.routeExcludes.shared).toEqual(['**/devtools/**', '**/v2/**'])
    expect(manifest.routeExcludes.desktop).toEqual(['**/devtools/**', '**/settings/system/developer.vue'])
    for (const route of manifest.requiredRoutes)
      expect(isDesktopRouteEnabled(route, 'consumer')).toBe(true)
    expect(isDesktopRouteEnabled('/workbench', 'consumer')).toBe(true)
    expect(isDesktopRouteEnabled('/workbench/project', 'consumer')).toBe(true)
    expect(isDesktopRouteEnabled('/settings/scene', 'consumer')).toBe(true)
    expect(isDesktopRouteEnabled('/dashboard', 'consumer')).toBe(true)
  })

  it('hides only internal routes from formal editions', () => {
    expect(isDesktopRouteEnabled('/devtools', 'consumer')).toBe(false)
    expect(isDesktopRouteEnabled('/v2', 'creator')).toBe(false)
    expect(isDesktopRouteEnabled('/settings/system/developer', 'consumer')).toBe(false)
    expect(isDesktopRouteEnabled('/settings/providers', 'consumer')).toBe(true)
    expect(isDesktopRouteEnabled('/settings/scene', 'creator')).toBe(true)
    const creatorManifest = createDesktopFeatureManifest('creator')
    expect(creatorManifest.features.workbench).toBe(true)
    expect(creatorManifest.requiredRoutes).toContain('/workbench')
    expect(isDesktopRouteEnabled('/workbench', 'creator')).toBe(true)
    expect(isDesktopRouteEnabled('/devtools', 'dev')).toBe(true)
    expect(isDesktopRouteEnabled('/settings/scene', 'dev')).toBe(true)
  })
})
