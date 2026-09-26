import process from 'node:process'

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pnpmEntry = process.env.npm_execpath
if (!pnpmEntry) {
  process.stderr.write('Run this command with pnpm build:source.\n')
  process.exit(1)
}

// Renderer chunk generation can exceed Node's default 2 GiB heap. This is a
// ceiling, not a reservation; an explicitly configured user limit takes priority.
const nodeOptions = process.env.NODE_OPTIONS ?? ''
const env = {
  ...process.env,
  NODE_OPTIONS: /--max[-_]old[-_]space[-_]size(?:=|\s)/.test(nodeOptions)
    ? nodeOptions
    : `${nodeOptions} --max-old-space-size=6144`.trim(),
}
function run(entry, args, cwd = root) {
  const result = spawnSync(process.execPath, [entry, ...args], { cwd, env, stdio: 'inherit' })
  if (result.error) {
    process.stderr.write(`${result.error.message}\n`)
    process.exit(1)
  }
  if (result.status !== 0)
    process.exit(result.status ?? 1)
}

run(pnpmEntry, ['run', 'build:packages'])
run(pnpmEntry, ['-F', '@proj-airi/stage-tamagotchi', 'typecheck'])
const appRoot = resolve(root, 'apps/stage-tamagotchi')
const require = createRequire(resolve(appRoot, 'package.json'))
const toolRoot = resolve(dirname(require.resolve('electron-vite')), '..')
const manifest = JSON.parse(readFileSync(resolve(toolRoot, 'package.json'), 'utf8'))
run(resolve(toolRoot, manifest.bin['electron-vite']), ['build'], appRoot)
