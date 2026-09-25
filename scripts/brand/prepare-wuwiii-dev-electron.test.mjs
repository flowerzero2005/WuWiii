import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, it } from 'vitest'

import { getBrandingPlan, getBrandingState, getDevRuntimeIdentity } from './prepare-wuwiii-dev-electron.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
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

it('launchers make electron-vite spawn electron.exe from the icon-versioned runtime cache', () => {
  const batchLauncher = readFileSync(join(repoRoot, '.internal-start-desktop.cmd'), 'utf8')
  const powershellLauncher = readFileSync(join(repoRoot, 'start-desktop.ps1'), 'utf8')
  const hiddenLauncher = readFileSync(join(repoRoot, 'start-wuwiii.vbs'), 'utf8')
  const brandingScript = readFileSync(join(repoRoot, 'scripts', 'brand', 'prepare-wuwiii-dev-electron.mjs'), 'utf8')

  for (const source of [batchLauncher, powershellLauncher, hiddenLauncher, brandingScript])
    expect(source).not.toMatch(/wuwiii-electron\.exe/i)

  expect(brandingScript).toContain('\'.cache\', \'wuwiii-dev-electron\', runtimeIdentity')
  expect(brandingScript).toContain('DEV_RUNTIME_CACHE_VERSION = 2')
  expect(brandingScript).toContain('const runtimeExecutable = join(runtimeDist, \'electron.exe\')')
  expect(brandingScript).toMatch(/writeFileSync\(electronPathFile, 'electron\.exe'\)/)
  expect(brandingScript).toContain('writeFileSync(statePath, `${JSON.stringify(getBrandingState({')
  expect(hiddenLauncher).toContain('start-desktop.ps1')
  expect(hiddenLauncher).not.toContain('.internal-start-desktop.cmd')
  expect(hiddenLauncher).not.toContain('prepare-wuwiii-dev-electron.mjs')
  expect(hiddenLauncher).not.toContain('AIRI_PRELAUNCH_TARGET_EXE')
  expect(powershellLauncher.match(/prepare-wuwiii-dev-electron\.mjs/g)).toHaveLength(1)
  expect(powershellLauncher).toContain('$env:ELECTRON_OVERRIDE_DIST_PATH')
  expect(powershellLauncher).toContain('$env:ELECTRON_EXEC_PATH = Join-Path $env:ELECTRON_OVERRIDE_DIST_PATH \'electron.exe\'')
  expect(powershellLauncher).toContain('$env:AIRI_PRELAUNCH_TARGET_EXE = $env:ELECTRON_EXEC_PATH')
  expect(batchLauncher).toContain('set "ELECTRON_EXEC_PATH=%ELECTRON_OVERRIDE_DIST_PATH%\\electron.exe"')
  expect(powershellLauncher.indexOf('AIRI_PRELAUNCH_TARGET_EXE')).toBeGreaterThan(
    powershellLauncher.indexOf('ELECTRON_EXEC_PATH'),
  )
  expect(powershellLauncher.indexOf('.internal-starting.ps1')).toBeGreaterThan(
    powershellLauncher.indexOf('AIRI_PRELAUNCH_TARGET_EXE'),
  )
  expect(powershellLauncher.indexOf('pnpm.cmd run dev:tamagotchi')).toBeGreaterThan(
    powershellLauncher.indexOf('AIRI_PRELAUNCH_TARGET_EXE'),
  )

  for (const launcher of [batchLauncher, powershellLauncher]) {
    const prepareIndex = launcher.indexOf('prepare-wuwiii-dev-electron.mjs')
    const electronExecIndex = launcher.indexOf('ELECTRON_EXEC_PATH')
    expect(prepareIndex).toBeGreaterThan(launcher.indexOf('5173'))
    expect(prepareIndex).toBeGreaterThan(launcher.indexOf('6121'))
    expect(electronExecIndex).toBeGreaterThan(prepareIndex)
    expect(launcher.indexOf('pnpm.cmd run dev:tamagotchi')).toBeGreaterThan(electronExecIndex)
  }
})
