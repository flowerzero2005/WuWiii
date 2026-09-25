import { describe, expect, it } from 'vitest'

import {
  resolveWorkbenchStaticPreviewTarget,
  resolveWorkbenchStaticPreviewTargetFromResults,
} from './workbench-static-preview-target'

describe('workbench static preview target', () => {
  it('uses applied html writes as static preview targets', () => {
    expect(resolveWorkbenchStaticPreviewTarget({
      operation: 'write-text',
      path: 'index.html',
      workspaceRoot: 'D:/demo',
    })).toEqual({
      entryPath: 'index.html',
      workspaceRoot: 'D:/demo',
    })
  })

  it('ignores deleted files and non-html writes', () => {
    expect(resolveWorkbenchStaticPreviewTarget({
      operation: 'delete-file',
      path: 'index.html',
      workspaceRoot: 'D:/demo',
    })).toBeUndefined()

    expect(resolveWorkbenchStaticPreviewTarget({
      operation: 'write-text',
      path: 'src/main.ts',
      workspaceRoot: 'D:/demo',
    })).toBeUndefined()
  })

  it('prefers index.html from applied results', () => {
    expect(resolveWorkbenchStaticPreviewTargetFromResults([
      {
        operation: 'write-text',
        path: 'about.html',
        workspaceRoot: 'D:/demo',
      },
      {
        operation: 'write-text',
        path: 'src/index.html',
        workspaceRoot: 'D:/demo',
      },
    ])).toEqual({
      entryPath: 'src/index.html',
      workspaceRoot: 'D:/demo',
    })
  })
})
