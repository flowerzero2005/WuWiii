import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createWorkbenchStaticPreviewService } from './index'

async function createWorkspace() {
  const root = await mkdtemp(join(tmpdir(), 'airi-static-preview-'))
  await writeFile(join(root, 'index.html'), '<!doctype html><title>AIRI</title><h1>Hello</h1>')
  return root
}

describe('createWorkbenchStaticPreviewService', () => {
  let roots: string[] = []

  beforeEach(() => {
    roots = []
  })

  afterEach(async () => {
    await Promise.all(roots.map(root => rm(root, { force: true, recursive: true })))
  })

  it('rejects workspace root outside allowed workspaces', async () => {
    const allowed = await createWorkspace()
    const outside = await createWorkspace()
    roots.push(allowed, outside)
    const service = createWorkbenchStaticPreviewService({
      getAllowedWorkspaceRoots: () => [allowed],
    })

    await expect(service.start({ entryPath: 'index.html', workspaceRoot: outside }))
      .rejects
      .toThrow(/outside allowed workspace/i)
  })

  it('rejects absolute entryPath', async () => {
    const root = await createWorkspace()
    roots.push(root)
    const service = createWorkbenchStaticPreviewService({
      getAllowedWorkspaceRoots: () => [root],
    })

    await expect(service.start({ entryPath: resolve(root, 'index.html'), workspaceRoot: root }))
      .rejects
      .toThrow(/relative/i)
  })

  it('rejects entryPath traversal', async () => {
    const root = await createWorkspace()
    roots.push(root)
    const service = createWorkbenchStaticPreviewService({
      getAllowedWorkspaceRoots: () => [root],
    })

    await expect(service.start({ entryPath: '../index.html', workspaceRoot: root }))
      .rejects
      .toThrow(/escapes workspace/i)
  })

  it('rejects entryPath that resolves through a link outside workspace', async () => {
    const root = await createWorkspace()
    const outside = await createWorkspace()
    roots.push(root, outside)
    await symlink(outside, join(root, 'linked'), 'junction')
    const service = createWorkbenchStaticPreviewService({
      getAllowedWorkspaceRoots: () => [root],
    })

    await expect(service.start({ entryPath: 'linked/index.html', workspaceRoot: root }))
      .rejects
      .toThrow(/escapes workspace/i)
  })

  it('serves index.html with text/html', async () => {
    const root = await createWorkspace()
    roots.push(root)
    const service = createWorkbenchStaticPreviewService({
      getAllowedWorkspaceRoots: () => [root],
    })

    const preview = await service.start({ entryPath: 'index.html', workspaceRoot: root })
    const response = await fetch(preview.url)

    await service.stop({ previewId: preview.previewId })

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/html')
    await expect(response.text()).resolves.toContain('<h1>Hello</h1>')
  })

  it('serves audio with a browser-playable content type', async () => {
    const root = await createWorkspace()
    roots.push(root)
    await writeFile(join(root, 'voice.mp3'), new Uint8Array([0x49, 0x44, 0x33]))
    const service = createWorkbenchStaticPreviewService({
      getAllowedWorkspaceRoots: () => [root],
    })

    const preview = await service.start({ entryPath: 'voice.mp3', workspaceRoot: root })
    const response = await fetch(preview.url)
    await service.stop({ previewId: preview.previewId })

    expect(response.headers.get('content-type')).toBe('audio/mpeg')
  })

  it('stop closes server', async () => {
    const root = await createWorkspace()
    roots.push(root)
    const service = createWorkbenchStaticPreviewService({
      getAllowedWorkspaceRoots: () => [root],
    })
    const preview = await service.start({ entryPath: 'index.html', workspaceRoot: root })

    await service.stop({ previewId: preview.previewId })

    await expect(fetch(preview.url)).rejects.toThrow()
  })
})
