import process from 'node:process'

import { spawnSync } from 'node:child_process'

import { ESLint } from 'eslint'

const args = process.argv.slice(2)
const fix = args.includes('--fix')
const paths = args.filter(arg => arg !== '--fix')
const targets = paths.length ? paths : ['.']

// Run both engines and preserve each failure; the old tinyexec pipe discarded
// ESLint's exit code and could report a successful release gate after errors.
const oxlint = spawnSync(process.execPath, [
  'node_modules/oxlint/bin/oxlint',
  '--ignore-pattern',
  '.archived/**',
  '--ignore-pattern',
  'user-chat-*.js',
  '--ignore-pattern',
  'user-quick-chat-*.js',
  '--ignore-pattern',
  '*-user.js',
  '--ignore-pattern',
  '.tmp-*',
  ...(fix ? ['--fix'] : []),
  ...targets,
], { stdio: 'inherit' })
if (oxlint.error)
  console.error(oxlint.error)

const eslint = new ESLint({ fix })
const results = await eslint.lintFiles(targets)
if (fix)
  await ESLint.outputFixes(results)

const formatter = await eslint.loadFormatter('stylish')
const output = formatter.format(results)
if (output)
  process.stdout.write(output)

const eslintFailed = results.some(result => result.errorCount > 0 || result.fatalErrorCount > 0)
process.exitCode = oxlint.error || oxlint.status !== 0 || eslintFailed ? 1 : 0
