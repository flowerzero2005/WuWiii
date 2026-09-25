import { describe, expect, it } from 'vitest'

import {
  buildGitDiffArgs,
  buildGitStatusArgs,
  buildTypecheckCommand,
  parseGitDiffChangedFiles,
  parseGitStatusOutput,
  parseLintDiagnostics,
  parseTypecheckDiagnostics,
} from './restricted-command-adapters'

describe('restricted command adapters', () => {
  it('parses git status porcelain output into structured entries', () => {
    const result = parseGitStatusOutput([
      '## main...origin/main [ahead 2, behind 1]',
      ' M apps/stage-tamagotchi/src/main.ts',
      'M  packages/stage-ui/src/stores/llm.ts',
      '?? docs/improvements/new-note.md',
    ].join('\n'))

    expect(result).toEqual({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 1,
      detached: false,
      clean: false,
      entries: [
        {
          path: 'apps/stage-tamagotchi/src/main.ts',
          indexStatus: ' ',
          workTreeStatus: 'M',
          staged: false,
          unstaged: true,
          untracked: false,
          renamed: false,
          originalPath: undefined,
        },
        {
          path: 'packages/stage-ui/src/stores/llm.ts',
          indexStatus: 'M',
          workTreeStatus: ' ',
          staged: true,
          unstaged: false,
          untracked: false,
          renamed: false,
          originalPath: undefined,
        },
        {
          path: 'docs/improvements/new-note.md',
          indexStatus: '?',
          workTreeStatus: '?',
          staged: false,
          unstaged: false,
          untracked: true,
          renamed: false,
          originalPath: undefined,
        },
      ],
    })
  })

  it('builds fixed git status and diff arguments without opening arbitrary shell input', () => {
    expect(buildGitStatusArgs()).toEqual([
      'status',
      '--short',
      '--branch',
      '--untracked-files=all',
      '--no-renames',
    ])

    expect(buildGitDiffArgs({
      staged: true,
      contextLines: 5,
      path: 'apps/stage-tamagotchi/src/main.ts',
    })).toEqual([
      'diff',
      '--no-color',
      '--no-ext-diff',
      '--unified=5',
      '--cached',
      '--',
      'apps/stage-tamagotchi/src/main.ts',
    ])
  })

  it('parses git diff output into structured file entries', () => {
    const result = parseGitDiffChangedFiles([
      'diff --git a/apps/stage-tamagotchi/src/old.ts b/apps/stage-tamagotchi/src/new.ts',
      'similarity index 98%',
      'rename from apps/stage-tamagotchi/src/old.ts',
      'rename to apps/stage-tamagotchi/src/new.ts',
      '--- a/apps/stage-tamagotchi/src/old.ts',
      '+++ b/apps/stage-tamagotchi/src/new.ts',
      '@@ -1 +1 @@',
      'diff --git a/docs/new-note.md b/docs/new-note.md',
      'new file mode 100644',
      '--- /dev/null',
      '+++ b/docs/new-note.md',
      '@@ -0,0 +1 @@',
      'diff --git a/docs/removed-note.md b/docs/removed-note.md',
      'deleted file mode 100644',
      '--- a/docs/removed-note.md',
      '+++ /dev/null',
      '@@ -1 +0,0 @@',
      'diff --git a/packages/ui/src/components/Button.vue b/packages/ui/src/components/Button.vue',
      '--- a/packages/ui/src/components/Button.vue',
      '+++ b/packages/ui/src/components/Button.vue',
      '@@ -1 +1 @@',
    ].join('\n'))

    expect(result).toEqual([
      {
        path: 'apps/stage-tamagotchi/src/new.ts',
        originalPath: 'apps/stage-tamagotchi/src/old.ts',
        added: false,
        deleted: false,
        renamed: true,
      },
      {
        path: 'docs/new-note.md',
        originalPath: undefined,
        added: true,
        deleted: false,
        renamed: false,
      },
      {
        path: 'docs/removed-note.md',
        originalPath: undefined,
        added: false,
        deleted: true,
        renamed: false,
      },
      {
        path: 'packages/ui/src/components/Button.vue',
        originalPath: undefined,
        added: false,
        deleted: false,
        renamed: false,
      },
    ])
  })

  it('builds a fixed pnpm typecheck command from a whitelist target', () => {
    const result = buildTypecheckCommand({
      target: 'stage-tamagotchi',
    })

    expect(result.packageName).toBe('@proj-airi/stage-tamagotchi')
    expect(result.packageRoot).toBe('apps/stage-tamagotchi')
    expect(result.args).toEqual([
      '-F',
      '@proj-airi/stage-tamagotchi',
      'run',
      'typecheck',
    ])
    expect(result.commandText).toContain('@proj-airi/stage-tamagotchi')
  })

  it('parses TypeScript and vue-tsc diagnostics into file summaries', () => {
    const result = parseTypecheckDiagnostics([
      'src/components/App.vue(12,7): error TS2322: Type "number" is not assignable to type "string".',
      'src/stores/user.ts:8:13 - error TS2339: Property "name" does not exist on type "{}".',
    ].join('\n'))

    expect(result.totalIssues).toBe(2)
    expect(result.errorCount).toBe(2)
    expect(result.warningCount).toBe(0)
    expect(result.fileCount).toBe(2)
    expect(result.files).toEqual([
      {
        path: 'src/components/App.vue',
        issueCount: 1,
        errorCount: 1,
        warningCount: 0,
      },
      {
        path: 'src/stores/user.ts',
        issueCount: 1,
        errorCount: 1,
        warningCount: 0,
      },
    ])
    expect(result.entries[0]).toMatchObject({
      path: 'src/components/App.vue',
      line: 12,
      column: 7,
      severity: 'error',
      code: 'TS2322',
    })
  })

  it('parses eslint stylish diagnostics into file summaries', () => {
    const result = parseLintDiagnostics([
      'src/pages/home.vue',
      '  12:5  error  Unexpected console statement  no-console',
      '  18:3  warning  Missing return type on function  @typescript-eslint/explicit-function-return-type',
      '',
      'src/stores/user.ts',
      '  4:9  error  \'name\' is assigned a value but never used  @typescript-eslint/no-unused-vars',
    ].join('\n'))

    expect(result.totalIssues).toBe(3)
    expect(result.errorCount).toBe(2)
    expect(result.warningCount).toBe(1)
    expect(result.fileCount).toBe(2)
    expect(result.files).toEqual([
      {
        path: 'src/pages/home.vue',
        issueCount: 2,
        errorCount: 1,
        warningCount: 1,
      },
      {
        path: 'src/stores/user.ts',
        issueCount: 1,
        errorCount: 1,
        warningCount: 0,
      },
    ])
    expect(result.entries[1]).toMatchObject({
      path: 'src/pages/home.vue',
      line: 18,
      column: 3,
      severity: 'warning',
      code: '@typescript-eslint/explicit-function-return-type',
    })
  })
})
