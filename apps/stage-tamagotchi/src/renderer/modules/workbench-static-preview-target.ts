import type { ElectronWorkbenchStaticPreviewStartPayload } from '../../shared/eventa'

export interface WorkbenchStaticPreviewTargetInput {
  operation?: 'write-text' | 'delete-file'
  path: string
  workspaceRoot?: string
}

export function resolveWorkbenchStaticPreviewTarget(input: WorkbenchStaticPreviewTargetInput): ElectronWorkbenchStaticPreviewStartPayload | undefined {
  if (!input.workspaceRoot || input.operation === 'delete-file')
    return undefined

  if (!input.path.toLowerCase().endsWith('.html'))
    return undefined

  return {
    entryPath: input.path,
    workspaceRoot: input.workspaceRoot,
  }
}

function isIndexHtmlPath(path: string) {
  return path.replace(/\\/g, '/').toLowerCase().endsWith('/index.html')
    || path.toLowerCase() === 'index.html'
}

export function resolveWorkbenchStaticPreviewTargetFromResults(results: WorkbenchStaticPreviewTargetInput[]): ElectronWorkbenchStaticPreviewStartPayload | undefined {
  const targets = results
    .map(result => resolveWorkbenchStaticPreviewTarget(result))
    .filter((target): target is ElectronWorkbenchStaticPreviewStartPayload => Boolean(target))

  return targets.find(target => isIndexHtmlPath(target.entryPath)) ?? targets[0]
}
