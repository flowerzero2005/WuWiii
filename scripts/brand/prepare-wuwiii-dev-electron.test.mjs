import { expect, it } from 'vitest'

import { getBrandingPlan, getBrandingState, getDevRuntimeIdentity } from './prepare-wuwiii-dev-electron.mjs'

const state = {
  electronVersion: '40.6.1',
  baseHash: 'base',
  brandedHash: 'branded',
  iconHash: 'icon',
}

it('preserves a pristine binary on the first branding run', () => {
  expect(getBrandingPlan({
    currentHash: 'base',
    electronVersion: '40.6.1',
    iconHash: 'icon',
  })).toEqual({
    refreshBackup: true,
    shouldBrand: true,
  })
})

it('does not rewrite an unchanged branded Electron executable', () => {
  expect(getBrandingPlan({
    backupHash: 'base',
    currentHash: 'branded',
    electronVersion: '40.6.1',
    iconHash: 'icon',
    state,
  })).toEqual({
    refreshBackup: false,
    shouldBrand: false,
  })
})

it('accepts a restored pristine Electron executable after migration', () => {
  expect(getBrandingPlan({
    backupHash: 'base',
    currentHash: 'base',
    electronVersion: '40.6.1',
    iconHash: 'icon',
    state,
  })).toEqual({
    refreshBackup: false,
    shouldBrand: false,
  })
})

it('rebuilds from the pristine backup after an icon change', () => {
  expect(getBrandingPlan({
    backupHash: 'base',
    currentHash: 'branded',
    electronVersion: '40.6.1',
    iconHash: 'new-icon',
    state,
  })).toEqual({
    refreshBackup: false,
    shouldBrand: true,
  })
})

it('treats a replaced Electron executable as the new pristine binary', () => {
  expect(getBrandingPlan({
    backupHash: 'base',
    currentHash: 'new-electron',
    electronVersion: '41.0.0',
    iconHash: 'icon',
    state,
  })).toEqual({
    refreshBackup: true,
    shouldBrand: true,
  })
})

it('refreshes a stale pristine backup when Electron itself was replaced', () => {
  expect(getBrandingPlan({
    backupHash: 'stale-base',
    currentHash: 'new-electron',
    electronVersion: '41.0.0',
    iconHash: 'icon',
    state,
  })).toEqual({
    refreshBackup: true,
    shouldBrand: true,
  })
})

it('rejects an invalid pristine backup instead of branding an already branded binary', () => {
  expect(() => getBrandingPlan({
    backupHash: 'unexpected',
    currentHash: 'branded',
    electronVersion: '40.6.1',
    iconHash: 'icon',
    state,
  })).toThrow(/pristine Electron backup is missing or invalid/)
})

it('derives a stable, icon-versioned development runtime identity', () => {
  expect(getDevRuntimeIdentity({
    baseHash: '1234567890abcdef',
    electronVersion: '40.6.1',
    iconHash: 'abcdef1234567890',
  })).toBe('electron-v2-40.6.1-1234567890ab-abcdef123456')
})

it('persists the hashes that identify the prepared branded runtime', () => {
  expect(getBrandingState({
    electronVersion: '40.6.1',
    baseHash: 'base',
    brandedHash: 'branded-runtime',
    iconHash: 'icon',
  })).toEqual({
    electronVersion: '40.6.1',
    baseHash: 'base',
    brandedHash: 'branded-runtime',
    iconHash: 'icon',
  })
})

// Launcher checks require the internal launch scripts excluded from this mirror.
