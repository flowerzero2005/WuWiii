import type { ElectronCommandExecutionReadResult } from '../../shared/eventa'

export const WORKBENCH_CENTER_EDITOR_MAX_EDIT_BYTES = 256_000
export const WORKBENCH_CENTER_EDITOR_MAX_HIGHLIGHT_CHARS = 80_000

export type WorkbenchFileEditorReadOnlyReason
  = | 'no-file'
    | 'truncated'
    | 'large-file'
    | 'unsupported-file-type'

export interface WorkbenchFileEditorState {
  byteLength: number
  dirty: boolean
  draftByteLength: number
  editable: boolean
  language: string
  lineCount: number
  path?: string
  readOnlyReason?: WorkbenchFileEditorReadOnlyReason
}

const binaryExtensionSet = new Set([
  '7z',
  'a',
  'avif',
  'bin',
  'bmp',
  'class',
  'dll',
  'dmg',
  'eot',
  'exe',
  'gif',
  'gz',
  'ico',
  'icns',
  'iso',
  'jar',
  'jpeg',
  'jpg',
  'mov',
  'mp3',
  'mp4',
  'ogg',
  'otf',
  'pdf',
  'png',
  'rar',
  'so',
  'tar',
  'tgz',
  'ttf',
  'wasm',
  'wav',
  'webm',
  'webp',
  'woff',
  'woff2',
  'zip',
])

const browserPreviewExtensionSet = new Set([
  'avif',
  'bmp',
  'gif',
  'jpeg',
  'jpg',
  'png',
  'svg',
  'webp',
  'm4a',
  'mp3',
  'ogg',
  'wav',
  'mov',
  'mp4',
  'webm',
  'pdf',
])

export type WorkbenchBrowserPreviewKind = 'audio' | 'document' | 'image' | 'video'

export function getWorkbenchBrowserPreviewKind(pathOrUrl: string): WorkbenchBrowserPreviewKind | undefined {
  const path = pathOrUrl.split(/[?#]/, 1)[0] ?? pathOrUrl
  const extension = getFileExtension(path)
  if (!extension)
    return undefined
  if (['avif', 'bmp', 'gif', 'jpeg', 'jpg', 'png', 'svg', 'webp'].includes(extension))
    return 'image'
  if (['m4a', 'mp3', 'ogg', 'wav'].includes(extension))
    return 'audio'
  if (['mov', 'mp4', 'webm'].includes(extension))
    return 'video'
  if (extension === 'pdf')
    return 'document'
  return undefined
}

const fileNameLanguageMap = new Map([
  ['dockerfile', 'dockerfile'],
  ['makefile', 'make'],
])

const extensionLanguageMap = new Map([
  ['c', 'c'],
  ['cc', 'cpp'],
  ['cpp', 'cpp'],
  ['cs', 'csharp'],
  ['css', 'css'],
  ['go', 'go'],
  ['h', 'c'],
  ['hpp', 'cpp'],
  ['html', 'html'],
  ['java', 'java'],
  ['js', 'javascript'],
  ['jsx', 'jsx'],
  ['json', 'json'],
  ['jsonc', 'jsonc'],
  ['kt', 'kotlin'],
  ['kts', 'kotlin'],
  ['less', 'less'],
  ['lua', 'lua'],
  ['md', 'markdown'],
  ['mdx', 'mdx'],
  ['mjs', 'javascript'],
  ['mts', 'typescript'],
  ['php', 'php'],
  ['ps1', 'powershell'],
  ['py', 'python'],
  ['rs', 'rust'],
  ['sass', 'sass'],
  ['scss', 'scss'],
  ['sh', 'bash'],
  ['sql', 'sql'],
  ['svelte', 'svelte'],
  ['swift', 'swift'],
  ['toml', 'toml'],
  ['ts', 'typescript'],
  ['tsx', 'tsx'],
  ['txt', 'text'],
  ['vue', 'vue'],
  ['xml', 'xml'],
  ['yaml', 'yaml'],
  ['yml', 'yaml'],
])

function getFileName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
}

function getFileExtension(path: string) {
  const fileName = getFileName(path)
  const extension = fileName.includes('.') ? fileName.split('.').at(-1) : undefined
  return extension?.toLowerCase()
}

function getUtf8ByteLength(text: string) {
  return new TextEncoder().encode(text).byteLength
}

function countLines(text: string) {
  return text.length === 0 ? 1 : text.split(/\r?\n/).length
}

export function getWorkbenchFileEditorLanguage(path: string) {
  const fileName = getFileName(path).toLowerCase()
  const byFileName = fileNameLanguageMap.get(fileName)
  if (byFileName)
    return byFileName

  const extension = getFileExtension(path)
  return extension ? extensionLanguageMap.get(extension) ?? 'text' : 'text'
}

export function isWorkbenchFileEditorUnsupported(path: string) {
  const extension = getFileExtension(path)
  return extension ? binaryExtensionSet.has(extension) : false
}

export function isWorkbenchBrowserPreviewableFile(path: string) {
  const extension = getFileExtension(path)
  return extension ? browserPreviewExtensionSet.has(extension) : false
}

export function buildWorkbenchFileEditorState(input: {
  draftContent?: string
  maxEditableBytes?: number
  preview?: ElectronCommandExecutionReadResult
}): WorkbenchFileEditorState {
  const { preview } = input
  if (!preview) {
    return {
      byteLength: 0,
      dirty: false,
      draftByteLength: 0,
      editable: false,
      language: 'text',
      lineCount: 0,
      readOnlyReason: 'no-file',
    }
  }

  const draftContent = input.draftContent ?? preview.content
  const maxEditableBytes = input.maxEditableBytes ?? WORKBENCH_CENTER_EDITOR_MAX_EDIT_BYTES
  const readOnlyReason = (() => {
    if (preview.truncated)
      return 'truncated'
    if (preview.byteLength > maxEditableBytes)
      return 'large-file'
    if (isWorkbenchFileEditorUnsupported(preview.path))
      return 'unsupported-file-type'
    return undefined
  })()

  return {
    byteLength: preview.byteLength,
    dirty: draftContent !== preview.content,
    draftByteLength: getUtf8ByteLength(draftContent),
    editable: !readOnlyReason,
    language: getWorkbenchFileEditorLanguage(preview.path),
    lineCount: countLines(draftContent),
    path: preview.path,
    readOnlyReason,
  }
}

export async function createWorkbenchFileContentSha256(content: string) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(content),
  )

  return Array.from(new Uint8Array(digest))
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')
}
