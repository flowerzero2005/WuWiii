import process from 'node:process'

import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const issues = []
const [major, minor] = process.versions.node.split('.').map(Number)
if (major < 22 || (major === 22 && minor < 12))
  issues.push('Use Node.js 22.12 or newer; Node.js 22 LTS is the documented baseline.')

const directories = ['.', 'apps/stage-tamagotchi', ...readdirSync(resolve(root, 'packages'), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && existsSync(resolve(root, 'packages', entry.name, 'package.json')))
  .map(entry => `packages/${entry.name}`)]
const manifests = directories.map(directory => ({ directory, value: JSON.parse(readFileSync(resolve(root, directory, 'package.json'), 'utf8')) }))
const workspaceNames = new Set(manifests.map(item => item.value.name))
for (const { directory, value } of manifests) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, specifier] of Object.entries(value[field] ?? {})) {
      if (specifier.startsWith('workspace:') && !workspaceNames.has(name))
        issues.push(`${directory}: missing workspace ${name}`)
    }
  }
}

const probes = [
  ['package.json', ['eslint', 'typescript', 'turbo']],
  ['apps/stage-tamagotchi/package.json', ['electron/package.json', 'electron-vite', 'vite', 'vue']],
  ['packages/stage-ui/package.json', ['hono', '@proj-airi/server-shared/types']],
]
for (const [anchor, names] of probes) {
  const require = createRequire(resolve(root, anchor))
  for (const name of names) {
    try {
      const resolved = realpathSync(require.resolve(name))
      const within = relative(root, resolved)
      if (within === '..' || within.startsWith('../') || within.startsWith('..\\'))
        issues.push(`${name}: resolves outside this checkout; install its own dependencies`)
    }
    catch {
      issues.push(`${name}: not available; run pnpm install --frozen-lockfile and let shared packages build`)
    }
  }
}

const expected = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8')).packageManager
const userAgent = process.env.npm_config_user_agent
if (userAgent && !userAgent.startsWith(`${expected.replace('@', '/')} `))
  issues.push(`Run this check using the repository's ${expected}.`)

process.stdout.write(`Node ${process.versions.node} | ${process.platform}/${process.arch} | ${directories.length - 1} application/shared workspaces\n`)
for (const issue of issues)
  process.stderr.write(`- ${issue}\n`)
if (issues.length)
  process.exitCode = 1
else
  process.stdout.write('Workspace closure and local dependency resolution passed. No provider requests were sent.\n')
