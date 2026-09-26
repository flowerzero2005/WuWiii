#!/usr/bin/env node

import childProcess from 'node:child_process'
import process from 'node:process'

import { syncBuiltinESMExports } from 'node:module'

// NOTICE: Vite 7 calls `exec('net use')` inside `optimizeSafeRealPathSync` on
// Windows while loading config. In this sandboxed environment that spawn fails
// with `EPERM`, which blocks root-level Vitest before tests even start.
// Verified in `node_modules/.pnpm/vite@7.3.1.../node_modules/vite/dist/node/chunks/config.js`
// near `optimizeSafeRealPathSync`.
if (process.platform === 'win32') {
  const originalExec = childProcess.exec

  childProcess.exec = function patchedExec(command, options, callback) {
    let normalizedOptions = options
    let normalizedCallback = callback

    if (typeof normalizedOptions === 'function') {
      normalizedCallback = normalizedOptions
      normalizedOptions = undefined
    }

    if (typeof command === 'string' && command.trim().toLowerCase() === 'net use') {
      queueMicrotask(() => {
        normalizedCallback?.(null, '', '')
      })

      return /** @type {import('node:child_process').ChildProcess} */ ({})
    }

    return originalExec.call(childProcess, command, normalizedOptions, normalizedCallback)
  }

  syncBuiltinESMExports()
}

// pnpm forwards the command separator to Node. Vitest treats it as the start
// of a positional argument list, so remove only that first separator.
const pnpmSeparatorIndex = process.argv.indexOf('--', 2)
if (pnpmSeparatorIndex !== -1) {
  process.argv.splice(pnpmSeparatorIndex, 1)
}

if (!process.argv.includes('--config')) {
  process.argv.splice(2, 0, '--config', 'vitest.config.mjs')
}

if (!process.argv.includes('--configLoader')) {
  process.argv.splice(2, 0, '--configLoader', 'native')
}

await import('../node_modules/vitest/vitest.mjs')
