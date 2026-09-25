import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type {
  ElectronWorkbenchStaticPreviewSnapshot,
  ElectronWorkbenchStaticPreviewStartPayload,
  ElectronWorkbenchStaticPreviewStopPayload,
} from '../../../../shared/eventa'

import { randomUUID } from 'node:crypto'
import { readFile, realpath, stat } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, isAbsolute, relative, resolve } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'

import {
  electronWorkbenchStaticPreviewStart,
  electronWorkbenchStaticPreviewStop,
} from '../../../../shared/eventa'

export interface WorkbenchStaticPreviewService {
  start: (payload: ElectronWorkbenchStaticPreviewStartPayload) => Promise<ElectronWorkbenchStaticPreviewSnapshot>
  stop: (payload: ElectronWorkbenchStaticPreviewStopPayload) => Promise<void>
}

export interface WorkbenchStaticPreviewServiceOptions {
  getAllowedWorkspaceRoots: () => string[]
}

type WorkbenchStaticPreviewEventContext = ReturnType<typeof createContext>['context']

const CONTENT_TYPES: Record<string, string> = {
  '.avif': 'image/avif',
  '.bmp': 'image/bmp',
  '.css': 'text/css; charset=utf-8',
  '.gif': 'image/gif',
  '.html': 'text/html; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.m4a': 'audio/mp4',
  '.mov': 'video/quicktime',
  '.mp3': 'audio/mpeg',
  '.mp4': 'video/mp4',
  '.ogg': 'audio/ogg',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.webm': 'video/webm',
  '.webp': 'image/webp',
}

interface StaticPreviewController {
  root: string
  server: ReturnType<typeof createServer>
  snapshot: ElectronWorkbenchStaticPreviewSnapshot
}

function normalizePath(path: string) {
  return resolve(path)
}

function normalizeRelativePath(path: string) {
  return path.replace(/\\/g, '/').replace(/^\/+/, '')
}

function encodeUrlPath(path: string) {
  const normalized = normalizeRelativePath(path)
  return `/${normalized.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`
}

function assertAllowedWorkspaceRoot(workspaceRoot: string, allowedRoots: string[]) {
  const normalizedRoot = normalizePath(workspaceRoot)
  const allowed = allowedRoots.some(root => normalizePath(root) === normalizedRoot)
  if (!allowed)
    throw new Error(`Static preview workspace root is outside allowed workspace: ${workspaceRoot}`)

  return normalizedRoot
}

function assertRelativeEntryPath(entryPath: string) {
  if (!entryPath.trim())
    throw new Error('Static preview entryPath is required.')
  if (isAbsolute(entryPath))
    throw new Error('Static preview entryPath must be relative to the workspace.')

  return normalizeRelativePath(entryPath)
}

function isPathInside(root: string, target: string) {
  const relativePath = relative(root, target)
  return relativePath === '' || (relativePath !== '' && !relativePath.startsWith('..') && !isAbsolute(relativePath))
}

function resolveWorkspacePath(root: string, relativePath: string) {
  const target = resolve(root, relativePath)
  if (!isPathInside(root, target))
    throw new Error(`Static preview path escapes workspace: ${relativePath}`)

  return target
}

async function assertRealWorkspacePath(root: string, target: string, relativePath: string) {
  const [realRoot, realTarget] = await Promise.all([realpath(root), realpath(target)])
  if (!isPathInside(realRoot, realTarget))
    throw new Error(`Static preview path escapes workspace: ${relativePath}`)
}

async function resolveServedFile(root: string, relativePath: string) {
  const target = resolveWorkspacePath(root, relativePath)
  const targetStat = await stat(target)
  await assertRealWorkspacePath(root, target, relativePath)
  if (!targetStat.isDirectory())
    return target

  const indexPath = resolveWorkspacePath(root, `${relativePath.replace(/[\\/]+$/, '')}/index.html`)
  const indexStat = await stat(indexPath)
  await assertRealWorkspacePath(root, indexPath, relativePath)
  if (!indexStat.isFile())
    throw new Error('Static preview directory has no index.html.')

  return indexPath
}

function writeError(response: ServerResponse, statusCode: number) {
  response.writeHead(statusCode, { 'content-type': 'text/plain; charset=utf-8' })
  response.end(statusCode === 404 ? 'Not found' : 'Forbidden')
}

async function serveFile(root: string, request: IncomingMessage, response: ServerResponse) {
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const relativePath = normalizeRelativePath(decodeURIComponent(url.pathname))
    const target = await resolveServedFile(root, relativePath)
    const content = await readFile(target)
    response.writeHead(200, {
      'content-type': CONTENT_TYPES[extname(target).toLowerCase()] ?? 'application/octet-stream',
    })
    response.end(content)
  }
  catch (error) {
    writeError(response, error instanceof Error && /escapes workspace/i.test(error.message) ? 403 : 404)
  }
}

export function createWorkbenchStaticPreviewService(options: WorkbenchStaticPreviewServiceOptions): WorkbenchStaticPreviewService {
  const previews = new Map<string, StaticPreviewController>()

  async function start(payload: ElectronWorkbenchStaticPreviewStartPayload): Promise<ElectronWorkbenchStaticPreviewSnapshot> {
    const root = assertAllowedWorkspaceRoot(payload.workspaceRoot, options.getAllowedWorkspaceRoots())
    const entryPath = assertRelativeEntryPath(payload.entryPath)
    await resolveServedFile(root, entryPath)

    const previewId = `workbench-static-preview-${randomUUID()}`
    const startedAt = Date.now()
    const server = createServer((request, response) => {
      void serveFile(root, request, response)
    })

    await new Promise<void>((resolveListen, rejectListen) => {
      server.once('error', rejectListen)
      server.listen(0, '127.0.0.1', () => {
        server.off('error', rejectListen)
        resolveListen()
      })
    })

    const address = server.address() as AddressInfo
    const snapshot: ElectronWorkbenchStaticPreviewSnapshot = {
      entryPath,
      previewId,
      root,
      startedAt,
      status: 'running',
      url: `http://127.0.0.1:${address.port}${encodeUrlPath(entryPath)}`,
    }
    previews.set(previewId, { root, server, snapshot })
    return { ...snapshot }
  }

  async function stop(payload: ElectronWorkbenchStaticPreviewStopPayload): Promise<void> {
    const controller = previews.get(payload.previewId)
    if (!controller)
      return

    previews.delete(payload.previewId)
    controller.snapshot = {
      ...controller.snapshot,
      status: 'stopped',
    }
    await new Promise<void>((resolveClose, rejectClose) => {
      controller.server.close(error => error ? rejectClose(error) : resolveClose())
    })
  }

  return { start, stop }
}

export function createWorkbenchStaticPreviewHandlers(params: {
  context: WorkbenchStaticPreviewEventContext
  service: WorkbenchStaticPreviewService
}) {
  defineInvokeHandler(params.context, electronWorkbenchStaticPreviewStart, async (payload) => {
    return await params.service.start(payload)
  })

  defineInvokeHandler(params.context, electronWorkbenchStaticPreviewStop, async (payload) => {
    await params.service.stop(payload)
  })
}

export async function setupWorkbenchStaticPreviewService(options: WorkbenchStaticPreviewServiceOptions) {
  const [{ createContext: createElectronContext }, electron] = await Promise.all([
    import('@moeru/eventa/adapters/electron/main'),
    import('electron'),
  ])
  const { context } = createElectronContext(electron.ipcMain)
  const service = createWorkbenchStaticPreviewService(options)
  createWorkbenchStaticPreviewHandlers({ context, service })
  return service
}
