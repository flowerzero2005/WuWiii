import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import config from '../../../../electron-builder.config'

describe('isolated development package', () => {
  it('uses a separate identity and preserves data on uninstall', () => {
    expect(config.appId).toBe('cn.wuwiii.desktop.development')
    expect(config.productName).toBe('Wuwiii Dev')
    expect(config.win?.executableName).toBe('wuwiii-dev')
    expect(config.nsis?.deleteAppDataOnUninstall).toBe(false)
    expect(config.nsis?.include).toBeUndefined()
    expect(config.publish).toEqual([])
  })
  it('defaults local packaged bundles to the development edition', () => {
    const source = readFileSync(new URL('../../../../electron.vite.config.ts', import.meta.url), 'utf8')
    expect(source).toContain('return \'dev\'')
    expect(source).not.toContain('return process.env.NODE_ENV === \'production\' ? \'consumer\' : \'dev\'')
  })
  it('disables official update feeds and separates the renderer profile before locking', () => {
    const vite = readFileSync(new URL('../../../../electron.vite.config.ts', import.meta.url), 'utf8')
    const main = readFileSync(new URL('../../index.ts', import.meta.url), 'utf8')
    expect(vite).toContain('const desktopUpdatesEnabled = false')
    expect(vite).not.toContain('resolveDesktopUpdatePublishConfig(process.env)')
    expect(main).toContain('app.isPackaged ? \'cn.wuwiii.desktop.development\'')
    expect(main).not.toContain('disableRetiredWindowsLoginItems')
    expect(main.indexOf('configureDevelopmentProfile(app,')).toBeLessThan(main.indexOf('setupSingleInstance(app)'))
  })
})
