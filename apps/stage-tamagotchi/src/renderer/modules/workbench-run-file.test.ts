import { describe, expect, it } from 'vitest'

import {
  buildWorkbenchRunFilePlan,
  getWorkbenchRunFileExtension,
  isWorkbenchRunnableFile,
} from './workbench-run-file'

describe('getWorkbenchRunFileExtension', () => {
  it('extracts the lowercase extension', () => {
    expect(getWorkbenchRunFileExtension('main.PY')).toBe('py')
    expect(getWorkbenchRunFileExtension('src/app.ts')).toBe('ts')
    expect(getWorkbenchRunFileExtension('C:\\work\\script.JS')).toBe('js')
  })

  it('returns empty string for dotfiles and extensionless files', () => {
    expect(getWorkbenchRunFileExtension('.env')).toBe('')
    expect(getWorkbenchRunFileExtension('Makefile')).toBe('')
    expect(getWorkbenchRunFileExtension('dir.with.dot/file')).toBe('')
  })

  it('uses only the final segment for the extension', () => {
    expect(getWorkbenchRunFileExtension('archive.tar.gz')).toBe('gz')
  })
})

describe('isWorkbenchRunnableFile', () => {
  it('recognizes supported interpreted languages', () => {
    expect(isWorkbenchRunnableFile('a.py')).toBe(true)
    expect(isWorkbenchRunnableFile('a.ts')).toBe(true)
    expect(isWorkbenchRunnableFile('a.sh')).toBe(true)
  })

  it('rejects unsupported or compiled files', () => {
    expect(isWorkbenchRunnableFile('a.rs')).toBe(false)
    expect(isWorkbenchRunnableFile('a.go')).toBe(false)
    expect(isWorkbenchRunnableFile('README.md')).toBe(false)
  })
})

describe('buildWorkbenchRunFilePlan', () => {
  it('builds a python plan with the file path as the final arg', () => {
    const plan = buildWorkbenchRunFilePlan('scripts/hello.py')
    expect(plan).toMatchObject({
      command: 'python',
      args: ['scripts/hello.py'],
      kind: 'custom',
      riskLevel: 'medium',
      recipeIdHint: 'run-file-py',
    })
    expect(plan?.label).toContain('hello.py')
  })

  it('uses tsx for TypeScript', () => {
    expect(buildWorkbenchRunFilePlan('a.ts')?.command).toBe('tsx')
  })

  it('marks shell scripts as high risk', () => {
    expect(buildWorkbenchRunFilePlan('deploy.sh')?.riskLevel).toBe('high')
  })

  it('never proposes low risk (interpreters run arbitrary code)', () => {
    for (const path of ['a.py', 'a.js', 'a.ts', 'a.rb', 'a.php', 'a.lua']) {
      const plan = buildWorkbenchRunFilePlan(path)
      expect(plan?.riskLevel).not.toBe('low')
    }
  })

  it('returns null for non-runnable files', () => {
    expect(buildWorkbenchRunFilePlan('main.rs')).toBeNull()
    expect(buildWorkbenchRunFilePlan('notes.md')).toBeNull()
  })

  it('derives a stable recipe id hint per extension for reuse', () => {
    expect(buildWorkbenchRunFilePlan('one.py')?.recipeIdHint)
      .toBe(buildWorkbenchRunFilePlan('two.py')?.recipeIdHint)
  })
})
