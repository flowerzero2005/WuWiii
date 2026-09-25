import type { Extension } from '@codemirror/state'

// Maps the workbench editor's language string (see workbench-file-editor.ts's
// getWorkbenchFileEditorLanguage) to a CodeMirror language extension. Languages
// without a dedicated CodeMirror package fall back to legacy StreamLanguage modes,
// and unknown languages resolve to `null` (plain text — no syntax extension).
//
// Everything here is loaded lazily so opening a plain-text file never pulls in the
// full set of language grammars.

export async function resolveWorkbenchCodeMirrorLanguage(language: string): Promise<Extension | null> {
  switch (language) {
    case 'javascript':
    case 'jsx': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({ jsx: language === 'jsx' })
    }
    case 'typescript': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({ typescript: true })
    }
    case 'tsx': {
      const { javascript } = await import('@codemirror/lang-javascript')
      return javascript({ jsx: true, typescript: true })
    }
    case 'python': {
      const { python } = await import('@codemirror/lang-python')
      return python()
    }
    case 'html': {
      const { html } = await import('@codemirror/lang-html')
      return html()
    }
    case 'css':
    case 'less':
    case 'scss':
    case 'sass': {
      const { css } = await import('@codemirror/lang-css')
      return css()
    }
    case 'json':
    case 'jsonc': {
      const { json } = await import('@codemirror/lang-json')
      return json()
    }
    case 'markdown':
    case 'mdx': {
      const { markdown } = await import('@codemirror/lang-markdown')
      return markdown()
    }
    case 'vue': {
      const { vue } = await import('@codemirror/lang-vue')
      return vue()
    }
    case 'yaml': {
      const { yaml } = await import('@codemirror/lang-yaml')
      return yaml()
    }
    case 'rust': {
      const { rust } = await import('@codemirror/lang-rust')
      return rust()
    }
    case 'sql': {
      const { sql } = await import('@codemirror/lang-sql')
      return sql()
    }
    case 'c':
    case 'cpp': {
      const { cpp } = await import('@codemirror/lang-cpp')
      return cpp()
    }
    case 'java':
    case 'kotlin': {
      const { java } = await import('@codemirror/lang-java')
      return java()
    }
    case 'php': {
      const { php } = await import('@codemirror/lang-php')
      return php()
    }
    case 'go': {
      const { go } = await import('@codemirror/lang-go')
      return go()
    }
    case 'xml': {
      const { xml } = await import('@codemirror/lang-xml')
      return xml()
    }
    case 'bash': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { shell } = await import('@codemirror/legacy-modes/mode/shell')
      return StreamLanguage.define(shell)
    }
    case 'lua': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { lua } = await import('@codemirror/legacy-modes/mode/lua')
      return StreamLanguage.define(lua)
    }
    case 'toml': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { toml } = await import('@codemirror/legacy-modes/mode/toml')
      return StreamLanguage.define(toml)
    }
    case 'powershell': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { powerShell } = await import('@codemirror/legacy-modes/mode/powershell')
      return StreamLanguage.define(powerShell)
    }
    case 'csharp': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { csharp } = await import('@codemirror/legacy-modes/mode/clike')
      return StreamLanguage.define(csharp)
    }
    case 'dockerfile': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { dockerFile } = await import('@codemirror/legacy-modes/mode/dockerfile')
      return StreamLanguage.define(dockerFile)
    }
    case 'swift': {
      const { StreamLanguage } = await import('@codemirror/language')
      const { swift } = await import('@codemirror/legacy-modes/mode/swift')
      return StreamLanguage.define(swift)
    }
    default:
      return null
  }
}
