import type { ElectronCommandExecutionReadResult } from '../../shared/eventa'

import { describe, expect, it } from 'vitest'

import {
  buildWorkbenchFileEditorState,
  createWorkbenchFileContentSha256,
  getWorkbenchBrowserPreviewKind,
  getWorkbenchFileEditorLanguage,
  isWorkbenchBrowserPreviewableFile,
  isWorkbenchFileEditorUnsupported,
} from './workbench-file-editor'

function preview(overrides: Partial<ElectronCommandExecutionReadResult> = {}): ElectronCommandExecutionReadResult {
  const content = overrides.content ?? 'const value = 1\n'

  return {
    byteLength: new TextEncoder().encode(content).byteLength,
    content,
    path: 'src/example.ts',
    transactionId: 'transaction-1',
    truncated: false,
    workspaceRoot: 'D:/workspace',
    ...overrides,
  }
}

it('routes browser-native media formats to the secured static preview', () => {
  expect(isWorkbenchBrowserPreviewableFile('assets/photo.png')).toBe(true)
  expect(isWorkbenchBrowserPreviewableFile('audio/voice.mp3')).toBe(true)
  expect(isWorkbenchBrowserPreviewableFile('notes/readme.md')).toBe(false)
})

it('selects native media renderers while leaving pages to the iframe preview', () => {
  expect(getWorkbenchBrowserPreviewKind('http://127.0.0.1:5000/assets/photo.png')).toBe('image')
  expect(getWorkbenchBrowserPreviewKind('http://127.0.0.1:5000/audio/voice.mp3')).toBe('audio')
  expect(getWorkbenchBrowserPreviewKind('http://127.0.0.1:5000/video/demo.mp4')).toBe('video')
  expect(getWorkbenchBrowserPreviewKind('http://127.0.0.1:5000/docs/manual.pdf')).toBe('document')
  expect(getWorkbenchBrowserPreviewKind('http://127.0.0.1:5000/index.html')).toBeUndefined()
})

describe('workbench file editor', () => {
  it('detects dirty editable text files', () => {
    const state = buildWorkbenchFileEditorState({
      draftContent: 'const value = 2\n',
      preview: preview(),
    })

    expect(state).toMatchObject({
      dirty: true,
      editable: true,
      language: 'typescript',
      lineCount: 2,
    })
  })

  it('keeps truncated files read-only', () => {
    const state = buildWorkbenchFileEditorState({
      preview: preview({
        truncated: true,
      }),
    })

    expect(state.editable).toBe(false)
    expect(state.readOnlyReason).toBe('truncated')
  })

  it('keeps oversized files read-only', () => {
    const state = buildWorkbenchFileEditorState({
      maxEditableBytes: 10,
      preview: preview({
        byteLength: 11,
      }),
    })

    expect(state.editable).toBe(false)
    expect(state.readOnlyReason).toBe('large-file')
  })

  it('treats binary-like file types as unsupported even if a preview exists', () => {
    expect(isWorkbenchFileEditorUnsupported('assets/logo.png')).toBe(true)

    const state = buildWorkbenchFileEditorState({
      preview: preview({
        path: 'assets/logo.png',
      }),
    })

    expect(state.editable).toBe(false)
    expect(state.readOnlyReason).toBe('unsupported-file-type')
  })

  it('maps common file names and extensions to syntax languages', () => {
    expect(getWorkbenchFileEditorLanguage('Dockerfile')).toBe('dockerfile')
    expect(getWorkbenchFileEditorLanguage('src/App.vue')).toBe('vue')
    expect(getWorkbenchFileEditorLanguage('README.md')).toBe('markdown')
    expect(getWorkbenchFileEditorLanguage('pnpm-workspace.yaml')).toBe('yaml')
    expect(getWorkbenchFileEditorLanguage('unknown')).toBe('text')
  })

  it('hashes content with the same sha256 format used by guarded writes', async () => {
    await expect(createWorkbenchFileContentSha256('hello')).resolves.toBe(
      '2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824',
    )
  })
})
