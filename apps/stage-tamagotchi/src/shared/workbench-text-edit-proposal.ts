import type {
  ElectronCommandExecutionPreviewTextEditProposalResult,
  ElectronWorkbenchAgentRuntimeGenerateTextEditProposalPayload,
  ElectronWorkbenchAgentRuntimeTextEditProposalChange,
  ElectronWorkbenchAgentRuntimeTextEditProposalDelete,
  ElectronWorkbenchAgentRuntimeTextEditProposalEdit,
} from './eventa'

export interface WorkbenchGeneratedTextEditBundle {
  edits: ElectronWorkbenchAgentRuntimeTextEditProposalChange[]
  summary?: string
  title?: string
}

export function buildWorkbenchRuntimeSummaryFromInput(input: string, maxLength = 160) {
  const summary = input.replace(/\s+/g, ' ').trim()
  return summary.length > maxLength ? `${summary.slice(0, maxLength - 1).trim()}...` : summary
}

function extractJsonObjectFromText(text: string) {
  const trimmed = text.trim()
  const openingFence = trimmed.match(/^```(?:json)?[^\S\r\n]*(?:\r?\n)?/i)
  const candidate = openingFence
    ? trimmed.slice(openingFence[0].length).replace(/[^\S\r\n]*```$/, '').trim()
    : trimmed
  const objectStart = candidate.indexOf('{')
  const arrayStart = candidate.indexOf('[')
  const useArray = arrayStart >= 0 && (objectStart < 0 || arrayStart < objectStart)
  const start = useArray ? arrayStart : objectStart
  const end = useArray ? candidate.lastIndexOf(']') : candidate.lastIndexOf('}')
  return start >= 0 && end > start ? candidate.slice(start, end + 1) : candidate
}

function normalizeGeneratedTextEdit(value: unknown): ElectronWorkbenchAgentRuntimeTextEditProposalChange | undefined {
  if (!value || typeof value !== 'object')
    return undefined

  const candidate = value as Partial<ElectronWorkbenchAgentRuntimeTextEditProposalChange>
  const path = typeof candidate.path === 'string' ? candidate.path.trim() : ''
  if (!path)
    return undefined

  if (candidate.operation === 'delete-file') {
    return { operation: 'delete-file', path } satisfies ElectronWorkbenchAgentRuntimeTextEditProposalDelete
  }

  const writeCandidate = candidate as Partial<ElectronWorkbenchAgentRuntimeTextEditProposalEdit>
  const content = typeof writeCandidate.content === 'string' ? writeCandidate.content : ''
  return { content, operation: 'write-text', path }
}

export function parseWorkbenchGeneratedTextEditBundle(text: string): WorkbenchGeneratedTextEditBundle {
  const parsed = JSON.parse(extractJsonObjectFromText(text)) as unknown

  if (Array.isArray(parsed)) {
    const edits = parsed.map(normalizeGeneratedTextEdit).filter((edit): edit is ElectronWorkbenchAgentRuntimeTextEditProposalChange => Boolean(edit)).slice(0, 5)
    if (edits.length === 0)
      throw new Error('模型没有返回可用的文件修改。')

    return { edits }
  }

  if (!parsed || typeof parsed !== 'object')
    throw new Error('模型没有返回可用的文件修改。')

  const candidate = parsed as Partial<{
    edits: unknown[]
    summary: string
    title: string
  } & ElectronWorkbenchAgentRuntimeTextEditProposalEdit>
  const directEdit = normalizeGeneratedTextEdit(candidate)
  const edits = directEdit
    ? [directEdit]
    : Array.isArray(candidate.edits)
      ? candidate.edits.map(normalizeGeneratedTextEdit).filter((edit): edit is ElectronWorkbenchAgentRuntimeTextEditProposalChange => Boolean(edit)).slice(0, 5)
      : []

  if (edits.length === 0)
    throw new Error('模型没有返回可用的文件修改。')

  return {
    edits,
    summary: typeof candidate.summary === 'string' ? buildWorkbenchRuntimeSummaryFromInput(candidate.summary) : undefined,
    title: typeof candidate.title === 'string' ? buildWorkbenchRuntimeSummaryFromInput(candidate.title, 80) : undefined,
  }
}

export function buildWorkbenchTextEditProposalEventSummary(edits: ElectronWorkbenchAgentRuntimeTextEditProposalChange[], summary?: string) {
  if (summary)
    return summary

  const paths = edits.map(edit => edit.path)
  const visiblePaths = paths.slice(0, 3).join(', ')
  const suffix = paths.length > 3 ? ' 等' : ''
  return visiblePaths
    ? `已生成 ${edits.length} 个文件修改：${visiblePaths}${suffix}`
    : `已生成 ${edits.length} 个文件修改`
}

export function buildWorkbenchTextEditProposalPreviewEventSummary(previews: ElectronCommandExecutionPreviewTextEditProposalResult[]) {
  const paths = previews.map(preview => preview.path)
  const visiblePaths = paths.slice(0, 3).join(', ')
  const suffix = paths.length > 3 ? ' 等' : ''
  return visiblePaths
    ? `已创建 ${previews.length} 个可审查修改：${visiblePaths}${suffix}`
    : `已创建 ${previews.length} 个可审查修改`
}

export function buildWorkbenchTextEditProposalApprovalSummary(previews: ElectronCommandExecutionPreviewTextEditProposalResult[]) {
  if (previews.length === 1)
    return `等待确认 ${previews[0].path} 的文件修改。`

  return `等待确认 ${previews.length} 个文件修改。`
}

export function inferWorkbenchBrowserDemoRequest(input: string): boolean {
  const normalized = input.toLowerCase()
  return [
    '坦克大战',
    '小游戏',
    'game',
    'browser demo',
    'canvas',
  ].some(keyword => normalized.includes(keyword))
}

export function buildWorkbenchTextEditGenerationPrompt(payload: ElectronWorkbenchAgentRuntimeGenerateTextEditProposalPayload, compact = false) {
  const visibleFiles = (payload.visibleFiles ?? [])
    .slice(0, compact ? 12 : 30)
    .map(entry => `${entry.type === 'directory' ? 'dir' : 'file'}: ${entry.name}`)
  const taskContext = (payload.taskContextLines ?? []).slice(compact ? -6 : -14)
  const browserDemoRules = inferWorkbenchBrowserDemoRequest(payload.input)
    ? [
        'For a browser game/demo request, create one self-contained index.html file as a single self-contained HTML file with inline CSS and JS.',
        'Use Canvas or ordinary DOM only; use no external network assets.',
        'Do not reference external scripts, fonts, images, CDNs, or network assets.',
        'Include visible controls, keyboard controls, a restart button, and a short in-game status area.',
        'Keep the code small enough for first preview.',
      ]
    : []

  return [
    'Generate safe text file changes for the Wuwiii Workbench.',
    'Return JSON only, with this shape: {"title":"short task title","summary":"one sentence","edits":[{"operation":"write-text","path":"relative/path.ext","content":"full file content"}]}.',
    'For deletion requests, return {"operation":"delete-file","path":"relative/path.ext"} for each file to delete. Do not create a note, explanation, or delete-preview file to represent deletion.',
    'The title and summary must describe the artifact or change. Do not use conversational acknowledgements like "OK", "I will create", or "好的".',
    'For a simple document, note, or reflection request, prefer a .txt file and infer a short sensible filename from the topic when the user did not provide one.',
    'If the user explicitly asked for an empty file, set content to an empty string.',
    compact
      ? 'Return exactly 1 edit. Each path must be relative to the selected workspace. Do not use absolute paths. Do not include markdown.'
      : 'You may return 1 to 3 edits. Each path must be relative to the selected workspace. Do not use absolute paths. Do not include markdown.',
    'Prefer a small, runnable, self-contained first step when the workspace has no obvious app structure.',
    'If creating a browser demo or simple game, prefer index.html unless the existing file list clearly suggests another entry.',
    ...browserDemoRules,
    '',
    `Workspace root: ${payload.workspaceRoot ?? 'none'}`,
    `Task title: ${payload.taskTitle ?? 'none'}`,
    'Recent task context:',
    taskContext.length > 0 ? taskContext.join('\n') : '- none',
    '',
    'Visible workspace files:',
    visibleFiles.length > 0 ? visibleFiles.join('\n') : '- none',
    '',
    'Latest user input:',
    payload.input,
  ].join('\n')
}
