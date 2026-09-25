import childProcess from 'node:child_process'
import dgram from 'node:dgram'
import dns from 'node:dns'
import http from 'node:http'
import http2 from 'node:http2'
import https from 'node:https'
import net from 'node:net'
import process from 'node:process'
import tls from 'node:tls'

import { realpathSync } from 'node:fs'
import { syncBuiltinESMExports } from 'node:module'
import { delimiter, isAbsolute, normalize } from 'node:path'

const originalFetch = globalThis.fetch?.bind(globalThis)
const OriginalWebSocket = globalThis.WebSocket
const originalHttpRequest = http.request
const originalHttpGet = http.get
const originalHttp2Connect = http2.connect
const originalHttpsRequest = https.request
const originalHttpsGet = https.get
const originalNetConnect = net.connect
const originalNetCreateConnection = net.createConnection
const originalSocketConnect = net.Socket.prototype.connect
const originalTlsConnect = tls.connect
const originalExecFile = childProcess.execFile
const originalExecFileSync = childProcess.execFileSync
const originalSpawn = childProcess.spawn
const originalSpawnSync = childProcess.spawnSync
const originalDgramConnect = dgram.Socket.prototype.connect
const originalDgramSend = dgram.Socket.prototype.send
const IP_LITERAL_BRACKETS_REGEX = /^\[|\]$/g
const EXECUTABLE_ALLOWLIST_ENV = 'AIRI_DESKTOP_REGRESSION_ALLOWED_EXECUTABLES'
const ELECTRON_EXECUTABLE_ENV = 'AIRI_DESKTOP_REGRESSION_ELECTRON_EXECUTABLE'
const ELECTRON_ARGV_ENV = 'AIRI_DESKTOP_REGRESSION_ELECTRON_ARGV'
const GUARDED_DNS_METHODS = [
  'lookup',
  'lookupService',
  'resolve',
  'resolve4',
  'resolve6',
  'resolveAny',
  'resolveCaa',
  'resolveCname',
  'resolveMx',
  'resolveNaptr',
  'resolveNs',
  'resolvePtr',
  'resolveSoa',
  'resolveSrv',
  'resolveTxt',
  'reverse',
]

function canonicalExecutablePath(input) {
  if (typeof input !== 'string' || !isAbsolute(input))
    return null

  try {
    const canonical = normalize(realpathSync.native(input))
    return process.platform === 'win32' ? canonical.toLowerCase() : canonical
  }
  catch {
    return null
  }
}

export function createElectronLaunchContract({ executable, argv }) {
  const expectedExecutable = canonicalExecutablePath(executable)
  if (!expectedExecutable || !Array.isArray(argv) || argv.some(argument => typeof argument !== 'string'))
    throw new Error('Invalid desktop regression Electron launch contract')

  const expectedArgv = [...argv]
  let consumed = false
  return {
    diagnose(api, args) {
      const [command, actualArgv, options] = args
      const executableMatched = canonicalExecutablePath(command) === expectedExecutable
      if (!executableMatched)
        return undefined

      const firstArgumentMismatchIndex = Array.isArray(actualArgv)
        ? actualArgv.findIndex((argument, index) => argument !== expectedArgv[index])
        : -1
      return {
        actualArgvCount: Array.isArray(actualArgv) ? actualArgv.length : null,
        api,
        consumed,
        executableMatched,
        expectedArgvCount: expectedArgv.length,
        firstArgumentMismatchIndex,
        optionKeys: options && typeof options === 'object' && !Array.isArray(options)
          ? Object.keys(options).sort()
          : [],
        stdio: options?.stdio,
      }
    },
    accepts(api, args) {
      if (api !== 'spawn' || consumed)
        return false

      const [command, actualArgv, options] = args
      const actualExecutable = canonicalExecutablePath(command)
      if (actualExecutable !== expectedExecutable
        || !Array.isArray(actualArgv)
        || actualArgv.length !== expectedArgv.length
        || actualArgv.some((argument, index) => argument !== expectedArgv[index])) {
        return false
      }

      if (!options
        || typeof options !== 'object'
        || Array.isArray(options)
        || Object.keys(options).length !== 1
        || options.stdio !== 'inherit'
        || 'shell' in options
        || 'env' in options) {
        return false
      }

      consumed = true
      return true
    },
  }
}

function loadElectronLaunchContract() {
  const executable = process.env[ELECTRON_EXECUTABLE_ENV]
  const argvJson = process.env[ELECTRON_ARGV_ENV]
  delete process.env[ELECTRON_EXECUTABLE_ENV]
  delete process.env[ELECTRON_ARGV_ENV]

  if (!executable && !argvJson)
    return undefined
  if (!executable || !argvJson)
    throw new Error('Incomplete desktop regression Electron launch contract')

  let argv
  try {
    argv = JSON.parse(argvJson)
  }
  catch {
    throw new Error('Invalid desktop regression Electron argv contract')
  }
  return createElectronLaunchContract({ executable, argv })
}

const configuredElectronLaunchContract = loadElectronLaunchContract()

const configuredExecutableAllowlist = new Set(
  (process.env[EXECUTABLE_ALLOWLIST_ENV] || '')
    .split(delimiter)
    .map(canonicalExecutablePath)
    .filter(Boolean),
)

function extractUrl(input, defaultProtocol) {
  if (input instanceof URL)
    return input

  if (typeof input === 'string')
    return new URL(input)

  if (input && typeof input === 'object' && typeof input.url === 'string')
    return new URL(input.url)

  const protocol = input?.protocol || defaultProtocol
  const hostname = input?.hostname || input?.host || 'localhost'
  const port = input?.port ? `:${input.port}` : ''
  const path = input?.path || '/'
  return new URL(`${protocol}//${hostname}${port}${path}`)
}

function assertLoopback(input, defaultProtocol) {
  const url = extractUrl(input, defaultProtocol)
  assertLoopbackHostname(url.hostname, url.origin)
}

function assertLoopbackHostname(input, description) {
  const hostname = input.replace(IP_LITERAL_BRACKETS_REGEX, '').toLowerCase()
  const allowed = hostname === 'localhost'
    || hostname === '::1'
    || hostname === '0.0.0.0'
    || hostname.startsWith('127.')

  if (!allowed) {
    const error = new Error(`External network access blocked by desktop regression guard: ${description}`)
    error.code = 'AIRI_DESKTOP_REGRESSION_NETWORK_BLOCKED'
    throw error
  }
}

function assertLoopbackSocket(args) {
  const first = args[0]
  if (typeof first === 'string')
    return

  if (typeof first === 'number') {
    const hostname = typeof args[1] === 'string' ? args[1] : 'localhost'
    assertLoopbackHostname(hostname, `${hostname}:${first}`)
    return
  }

  if (first?.path)
    return

  const hostname = first?.host || first?.hostname || 'localhost'
  assertLoopbackHostname(hostname, `${hostname}:${first?.port || ''}`)
}

function assertLoopbackDgramConnect(args) {
  const first = args[0]
  const hostname = typeof first === 'object'
    ? first.address || 'localhost'
    : typeof args[1] === 'string' ? args[1] : 'localhost'
  assertLoopbackHostname(hostname, hostname)
}

function assertLoopbackDgramSend(args) {
  const destination = args[1]
  if (destination && typeof destination === 'object') {
    assertLoopbackHostname(destination.address || 'localhost', destination.address || 'localhost')
    return
  }

  const legacyAddress = typeof args[4] === 'string'
    ? args[4]
    : typeof args[2] === 'string' ? args[2] : null
  if (legacyAddress)
    assertLoopbackHostname(legacyAddress, legacyAddress)
}

function guardDnsMethods(target, methods) {
  for (const method of methods) {
    const original = target?.[method]
    if (typeof original !== 'function')
      continue

    target[method] = function guardedDnsMethod(hostname, ...args) {
      assertLoopbackHostname(hostname, hostname)
      return original.call(this, hostname, ...args)
    }
  }
}

function blockChildProcessLaunch(api) {
  const error = new Error(`Child process launch blocked by desktop regression guard: ${api}`)
  error.code = 'AIRI_DESKTOP_REGRESSION_CHILD_PROCESS_BLOCKED'
  throw error
}

function emulateBlockedViteWindowsNetworkMapProbe(args) {
  if (process.platform !== 'win32'
    || args.length !== 2
    || args[0] !== 'net use'
    || typeof args[1] !== 'function') {
    return false
  }

  // NOTICE: Vite probes mapped Windows drives once before resolving assets.
  // Report the probe as unavailable without launching cmd.exe; Vite then uses
  // fs.realpathSync.native, while every other exec call remains denied.
  const error = new Error('Windows network-map probing is disabled by the desktop regression guard')
  error.code = 'AIRI_DESKTOP_REGRESSION_PROBE_DISABLED'
  queueMicrotask(() => args[1](error, '', ''))
  return true
}

function isConfiguredExecutableLaunch(api, args) {
  if (!['execFile', 'execFileSync', 'spawn', 'spawnSync'].includes(api))
    return false

  const executable = canonicalExecutablePath(args[0])
  return executable !== null && configuredExecutableAllowlist.has(executable)
}

if (originalFetch) {
  globalThis.fetch = async function guardedFetch(input, init) {
    assertLoopback(input, 'http:')
    return originalFetch(input, init)
  }
}

http.request = function guardedHttpRequest(input, ...args) {
  assertLoopback(input, 'http:')
  return originalHttpRequest.call(http, input, ...args)
}
http.get = function guardedHttpGet(input, ...args) {
  assertLoopback(input, 'http:')
  return originalHttpGet.call(http, input, ...args)
}
http2.connect = function guardedHttp2Connect(authority, ...args) {
  assertLoopback(authority, 'https:')
  return originalHttp2Connect.call(http2, authority, ...args)
}
https.request = function guardedHttpsRequest(input, ...args) {
  assertLoopback(input, 'https:')
  return originalHttpsRequest.call(https, input, ...args)
}
https.get = function guardedHttpsGet(input, ...args) {
  assertLoopback(input, 'https:')
  return originalHttpsGet.call(https, input, ...args)
}
net.connect = function guardedNetConnect(...args) {
  assertLoopbackSocket(args)
  return originalNetConnect.apply(net, args)
}
net.createConnection = function guardedNetCreateConnection(...args) {
  assertLoopbackSocket(args)
  return originalNetCreateConnection.apply(net, args)
}
net.Socket.prototype.connect = function guardedSocketConnect(...args) {
  assertLoopbackSocket(args)
  return originalSocketConnect.apply(this, args)
}
tls.connect = function guardedTlsConnect(...args) {
  assertLoopbackSocket(args)
  return originalTlsConnect.apply(tls, args)
}
dgram.Socket.prototype.connect = function guardedDgramConnect(...args) {
  assertLoopbackDgramConnect(args)
  return originalDgramConnect.apply(this, args)
}
dgram.Socket.prototype.send = function guardedDgramSend(...args) {
  assertLoopbackDgramSend(args)
  return originalDgramSend.apply(this, args)
}
childProcess.exec = function guardedExec(...args) {
  if (emulateBlockedViteWindowsNetworkMapProbe(args))
    return undefined
  blockChildProcessLaunch('exec')
}
childProcess.execSync = function guardedExecSync() {
  blockChildProcessLaunch('execSync')
}
childProcess.execFile = function guardedExecFile(...args) {
  if (isConfiguredExecutableLaunch('execFile', args))
    return originalExecFile.apply(childProcess, args)
  blockChildProcessLaunch('execFile')
}
childProcess.execFileSync = function guardedExecFileSync(...args) {
  if (isConfiguredExecutableLaunch('execFileSync', args))
    return originalExecFileSync.apply(childProcess, args)
  blockChildProcessLaunch('execFileSync')
}
childProcess.spawn = function guardedSpawn(...args) {
  if (configuredElectronLaunchContract?.accepts('spawn', args))
    return originalSpawn.apply(childProcess, args)
  const electronRejection = configuredElectronLaunchContract?.diagnose('spawn', args)
  if (electronRejection)
    console.error('[desktop-regression-guard] Electron launch contract rejected:', electronRejection)
  if (isConfiguredExecutableLaunch('spawn', args))
    return originalSpawn.apply(childProcess, args)
  blockChildProcessLaunch('spawn')
}
childProcess.spawnSync = function guardedSpawnSync(...args) {
  if (isConfiguredExecutableLaunch('spawnSync', args))
    return originalSpawnSync.apply(childProcess, args)
  blockChildProcessLaunch('spawnSync')
}
childProcess.fork = function guardedFork() {
  blockChildProcessLaunch('fork')
}
guardDnsMethods(dns, GUARDED_DNS_METHODS)
guardDnsMethods(dns.promises, GUARDED_DNS_METHODS)
guardDnsMethods(dns.Resolver?.prototype, GUARDED_DNS_METHODS.filter(method => method !== 'lookup'))
guardDnsMethods(dns.promises.Resolver?.prototype, GUARDED_DNS_METHODS.filter(method => method !== 'lookup'))
syncBuiltinESMExports()

if (OriginalWebSocket) {
  globalThis.WebSocket = class GuardedWebSocket extends OriginalWebSocket {
    constructor(url, protocols) {
      assertLoopback(url, 'ws:')
      super(url, protocols)
    }
  }
}
