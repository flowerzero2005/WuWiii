import childProcess from 'node:child_process'
import dgram from 'node:dgram'
import dns from 'node:dns'
import http from 'node:http'
import http2 from 'node:http2'
import https from 'node:https'
import net from 'node:net'
import tls from 'node:tls'

import { realpathSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { createElectronLaunchContract } from '../../scripts/desktop-regression-network-guard.mjs'

describe('desktop regression external network guard', () => {
  it('blocks fetch requests outside loopback', async () => {
    await expect(
      fetch('https://example.invalid/provider'),
    ).rejects.toMatchObject({ code: 'AIRI_DESKTOP_REGRESSION_NETWORK_BLOCKED' })
  })

  it('blocks direct TCP and TLS connections outside loopback', () => {
    expect(() => net.connect(443, 'example.invalid'))
      .toThrow(/External network access blocked/)
    expect(() => net.createConnection({ host: 'example.invalid', port: 443 }))
      .toThrow(/External network access blocked/)
    expect(() => new net.Socket().connect(443, 'example.invalid'))
      .toThrow(/External network access blocked/)
    expect(() => tls.connect(443, 'example.invalid'))
      .toThrow(/External network access blocked/)
  })

  it('blocks Node HTTP and HTTPS requests outside loopback', () => {
    expect(() => http.request('http://example.invalid/provider'))
      .toThrow(/External network access blocked/)
    expect(() => https.request('https://example.invalid/provider'))
      .toThrow(/External network access blocked/)
    expect(() => http2.connect('https://example.invalid/provider'))
      .toThrow(/External network access blocked/)
  })

  it('blocks connected and connectionless UDP outside loopback', () => {
    const socket = dgram.createSocket('udp4')
    expect(() => socket.connect(53, '8.8.8.8'))
      .toThrow(/External network access blocked/)
    expect(() => socket.send('probe', 53, '8.8.8.8'))
      .toThrow(/External network access blocked/)
  })

  it('blocks callback, promise, and Resolver DNS calls outside loopback', async () => {
    expect(() => dns.lookup('example.invalid', () => undefined))
      .toThrow(/External network access blocked/)
    expect(() => dns.resolve('example.invalid', () => undefined))
      .toThrow(/External network access blocked/)
    expect(() => dns.reverse('8.8.8.8', () => undefined))
      .toThrow(/External network access blocked/)
    await expect(
      Promise.resolve().then(() => dns.promises.lookup('example.invalid')),
    ).rejects.toThrow(/External network access blocked/)
    expect(() => new dns.Resolver().resolve('example.invalid', () => undefined))
      .toThrow(/External network access blocked/)
  })

  it('blocks child process launch APIs inside the test process', () => {
    expect(() => childProcess.exec('node --version'))
      .toThrow(/Child process launch blocked/)
    expect(() => childProcess.execSync('node --version'))
      .toThrow(/Child process launch blocked/)
    expect(() => childProcess.execFile(process.execPath, ['--version']))
      .toThrow(/Child process launch blocked/)
    expect(() => childProcess.execFileSync(process.execPath, ['--version']))
      .toThrow(/Child process launch blocked/)
    expect(() => childProcess.spawn(process.execPath, ['--version']))
      .toThrow(/Child process launch blocked/)
    expect(() => childProcess.spawnSync(process.execPath, ['--version']))
      .toThrow(/Child process launch blocked/)
    expect(() => childProcess.fork('never-launched.mjs'))
      .toThrow(/Child process launch blocked/)
  })

  it.runIf(process.platform === 'win32')('emulates Vite mapped-drive probing without launching a shell', async () => {
    const error = await new Promise<Error>((resolve) => {
      childProcess.exec('net use', probeError => resolve(probeError as Error))
    })
    expect(error).toMatchObject({ code: 'AIRI_DESKTOP_REGRESSION_PROBE_DISABLED' })
  })

  it('accepts only one exact Electron spawn without shell or custom environment', () => {
    const executable = realpathSync.native(process.execPath)
    const argv = ['.', '--user-data-dir=C:/tmp/profile', '--proxy-server=http://127.0.0.1:9876']
    const exactLaunch = [executable, argv, { stdio: 'inherit' }]

    const wrongArgv = createElectronLaunchContract({ executable, argv })
    expect(wrongArgv.accepts('spawn', [executable, [...argv, '--extra'], { stdio: 'inherit' }])).toBe(false)

    const customEnvironment = createElectronLaunchContract({ executable, argv })
    expect(customEnvironment.accepts('spawn', [executable, argv, { env: {}, stdio: 'inherit' }])).toBe(false)

    const customShell = createElectronLaunchContract({ executable, argv })
    expect(customShell.accepts('spawn', [executable, argv, { shell: false, stdio: 'inherit' }])).toBe(false)

    const oneShot = createElectronLaunchContract({ executable, argv })
    expect(oneShot.accepts('spawn', exactLaunch)).toBe(true)
    expect(oneShot.accepts('spawn', exactLaunch)).toBe(false)
  })

  it.runIf(typeof WebSocket !== 'undefined')('blocks WebSocket connections outside loopback', () => {
    expect(() => new WebSocket('wss://example.invalid/provider'))
      .toThrow(/External network access blocked/)
  })
})
