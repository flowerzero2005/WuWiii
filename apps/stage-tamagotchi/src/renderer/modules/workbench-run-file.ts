import type { ElectronWorkbenchWorkspaceRecipeKind } from '../../shared/eventa'

// Maps a source file to a runnable command for the workbench "simple mode" Run button.
// The result is always routed through the existing recipe risk-classification and
// confirmation flow — this module only proposes the command + a conservative risk
// level, it never executes anything directly.

export interface WorkbenchRunFilePlan {
  // Recipe kind reused by the existing runner. "custom" keeps these one-off runs
  // out of the curated typecheck/lint/test/build set.
  kind: ElectronWorkbenchWorkspaceRecipeKind
  label: string
  command: string
  args: string[]
  // Conservative default risk level. Interpreters run arbitrary user code, so the
  // lowest we ever propose is "medium" — never "low", which would allow autonomous
  // execution without confirmation.
  riskLevel: 'medium' | 'high'
  // Stable id derived from the file extension, so re-running the same language
  // reuses one recipe instead of piling up duplicates.
  recipeIdHint: string
}

interface RunnableLanguage {
  command: string
  // Args placed before the file path (e.g. `node --experimental` … here just runner).
  args?: string[]
  kind: ElectronWorkbenchWorkspaceRecipeKind
  label: string
  riskLevel?: 'medium' | 'high'
}

// Extension (without dot, lowercase) -> how to run it.
// Only interpreted / script languages that run a single file are included. Compiled
// languages (needing a build step) are intentionally omitted — they belong to a real
// recipe, not a one-click "run this file".
const RUNNABLE_BY_EXTENSION: Record<string, RunnableLanguage> = {
  py: { command: 'python', kind: 'custom', label: 'Run Python file' },
  js: { command: 'node', kind: 'custom', label: 'Run JavaScript file' },
  mjs: { command: 'node', kind: 'custom', label: 'Run JavaScript file' },
  cjs: { command: 'node', kind: 'custom', label: 'Run JavaScript file' },
  ts: { command: 'tsx', kind: 'custom', label: 'Run TypeScript file' },
  mts: { command: 'tsx', kind: 'custom', label: 'Run TypeScript file' },
  sh: { command: 'bash', kind: 'custom', label: 'Run shell script', riskLevel: 'high' },
  bash: { command: 'bash', kind: 'custom', label: 'Run shell script', riskLevel: 'high' },
  rb: { command: 'ruby', kind: 'custom', label: 'Run Ruby file' },
  php: { command: 'php', kind: 'custom', label: 'Run PHP file' },
  lua: { command: 'lua', kind: 'custom', label: 'Run Lua file' },
}

export function getWorkbenchRunFileExtension(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const base = normalized.slice(normalized.lastIndexOf('/') + 1)
  const dotIndex = base.lastIndexOf('.')
  if (dotIndex <= 0)
    return ''

  return base.slice(dotIndex + 1).toLowerCase()
}

export function isWorkbenchRunnableFile(path: string): boolean {
  return getWorkbenchRunFileExtension(path) in RUNNABLE_BY_EXTENSION
}

// Returns the run plan for a file, or null when the extension is not directly runnable.
export function buildWorkbenchRunFilePlan(path: string): WorkbenchRunFilePlan | null {
  const extension = getWorkbenchRunFileExtension(path)
  const language = RUNNABLE_BY_EXTENSION[extension]
  if (!language)
    return null

  const normalized = path.replace(/\\/g, '/')
  const fileName = normalized.slice(normalized.lastIndexOf('/') + 1)

  return {
    kind: language.kind,
    label: `${language.label}: ${fileName}`,
    command: language.command,
    args: [...(language.args ?? []), path],
    riskLevel: language.riskLevel ?? 'medium',
    recipeIdHint: `run-file-${extension}`,
  }
}
