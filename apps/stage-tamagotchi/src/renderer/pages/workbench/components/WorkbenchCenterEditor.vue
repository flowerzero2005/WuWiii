<script setup lang="ts">
import type { ElectronCommandExecutionReadResult } from '../../../../shared/eventa'
import type { WorkbenchFileEditorState } from '../../../modules/workbench-file-editor'

import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, foldGutter, foldKeymap, indentOnInput, indentUnit } from '@codemirror/language'
import { Compartment, EditorState } from '@codemirror/state'
import { oneDark } from '@codemirror/theme-one-dark'
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from '@codemirror/view'
import { codeToHtml } from 'shiki'
import { computed, onBeforeUnmount, ref, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { resolveWorkbenchCodeMirrorLanguage } from '../../../modules/workbench-codemirror-language'
import { WORKBENCH_CENTER_EDITOR_MAX_HIGHLIGHT_CHARS } from '../../../modules/workbench-file-editor'

const props = withDefaults(defineProps<{
  dirtyFilePaths?: string[]
  draftContent: string
  editorState: WorkbenchFileEditorState
  files: ElectronCommandExecutionReadResult[]
  fontPercent: string
  fontSize: string
  preview?: ElectronCommandExecutionReadResult
  // Whether the selected file maps to a directly runnable interpreter command.
  // When true, a Run button is shown that routes through the recipe risk flow.
  runnable?: boolean
  // Whether a run for this file is currently in flight (disables the Run button).
  running?: boolean
  saveError?: string
  saving?: boolean
}>(), {
  dirtyFilePaths: () => [],
  preview: undefined,
  runnable: false,
  running: false,
  saveError: undefined,
  saving: false,
})

const emit = defineEmits<{
  (event: 'adjustFontScale', delta: number): void
  (event: 'closeFile', path: string): void
  (event: 'reload'): void
  (event: 'revert'): void
  (event: 'run'): void
  (event: 'save'): void
  (event: 'selectFile', path: string): void
  (event: 'update:draftContent', value: string): void
}>()

const { t } = useI18n()

const highlightedHtml = ref('')
const highlightLoading = ref(false)

let highlightRequestId = 0

const dirtyFilePathSet = computed(() => new Set(props.dirtyFilePaths))
const editorBodyClass = computed(() => {
  return props.editorState.editable
    ? ['flex min-h-[48vh] flex-col']
    : ['min-h-[48vh]']
})

function escapeHtml(text: string) {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getFileTabLabel(path: string) {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

function isDirtyPath(path: string) {
  return dirtyFilePathSet.value.has(path)
}

function getReadOnlyReasonLabel(reason: WorkbenchFileEditorState['readOnlyReason']) {
  if (!reason)
    return ''

  return t(`tamagotchi.stage.workbench.file-editor.readonly.${reason}`)
}

function handleFilePreviewWheel(event: WheelEvent) {
  if (!event.ctrlKey)
    return

  event.preventDefault()
  emit('adjustFontScale', event.deltaY < 0 ? 0.05 : -0.05)
}

// ── Read-only preview (shiki) ────────────────────────────────────────────────
// The read-only view keeps shiki highlighting; only the editable path uses CodeMirror.
watch(
  () => [props.draftContent, props.editorState.language, props.preview?.path, props.editorState.editable] as const,
  async ([content, language, , editable]) => {
    const requestId = ++highlightRequestId
    if (!props.preview || editable) {
      highlightedHtml.value = ''
      return
    }

    highlightLoading.value = true

    try {
      if (content.length > WORKBENCH_CENTER_EDITOR_MAX_HIGHLIGHT_CHARS) {
        highlightedHtml.value = `<pre class="workbench-center-editor-fallback"><code>${escapeHtml(content)}</code></pre>`
        return
      }

      const html = await codeToHtml(content, {
        lang: language,
        themes: {
          dark: 'github-dark',
          light: 'github-light',
        },
      })

      if (requestId === highlightRequestId)
        highlightedHtml.value = html
    }
    catch {
      if (requestId === highlightRequestId) {
        highlightedHtml.value = `<pre class="workbench-center-editor-fallback"><code>${escapeHtml(content)}</code></pre>`
      }
    }
    finally {
      if (requestId === highlightRequestId)
        highlightLoading.value = false
    }
  },
  { immediate: true },
)

// ── Editable editor (CodeMirror 6) ───────────────────────────────────────────
const editorHost = ref<HTMLElement>()
const editorView = shallowRef<EditorView>()
const languageCompartment = new Compartment()
const themeCompartment = new Compartment()

// True when the document theme is dark. Kept reactive so CodeMirror can swap its
// theme without a full re-init.
const isDark = ref(typeof document !== 'undefined' && document.documentElement.classList.contains('dark'))
let themeObserver: MutationObserver | undefined
if (typeof document !== 'undefined' && typeof MutationObserver !== 'undefined') {
  themeObserver = new MutationObserver(() => {
    isDark.value = document.documentElement.classList.contains('dark')
  })
  themeObserver.observe(document.documentElement, { attributeFilter: ['class'] })
}

// Guards the CodeMirror -> prop sync so programmatic doc replacements don't echo back.
let applyingExternalContent = false
let languageRequestId = 0

function themeExtension() {
  return isDark.value ? oneDark : []
}

async function applyLanguage(language: string) {
  const requestId = ++languageRequestId
  const extension = await resolveWorkbenchCodeMirrorLanguage(language)
  if (requestId !== languageRequestId || !editorView.value)
    return

  editorView.value.dispatch({
    effects: languageCompartment.reconfigure(extension ?? []),
  })
}

function createEditor(host: HTMLElement, content: string) {
  const state = EditorState.create({
    doc: content,
    extensions: [
      lineNumbers(),
      foldGutter(),
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      indentOnInput(),
      indentUnit.of('  '),
      bracketMatching(),
      closeBrackets(),
      keymap.of([
        ...closeBracketsKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...foldKeymap,
        indentWithTab,
        {
          key: 'Mod-s',
          preventDefault: true,
          run: () => {
            emit('save')
            return true
          },
        },
      ]),
      EditorView.lineWrapping,
      languageCompartment.of([]),
      themeCompartment.of(themeExtension()),
      EditorView.updateListener.of((update) => {
        if (!update.docChanged || applyingExternalContent)
          return

        emit('update:draftContent', update.state.doc.toString())
      }),
    ],
  })

  editorView.value = new EditorView({ state, parent: host })
  void applyLanguage(props.editorState.language)
}

function destroyEditor() {
  editorView.value?.destroy()
  editorView.value = undefined
}

// Mount / unmount CodeMirror as the editable state toggles or the host appears.
watch(
  () => [editorHost.value, props.editorState.editable] as const,
  ([host, editable]) => {
    if (host && editable && !editorView.value) {
      createEditor(host, props.draftContent)
    }
    else if ((!host || !editable) && editorView.value) {
      destroyEditor()
    }
  },
  { flush: 'post' },
)

// Push external content changes (file switch, revert, reload) into CodeMirror
// without clobbering the user's cursor when the value already matches.
watch(
  () => props.draftContent,
  (content) => {
    const view = editorView.value
    if (!view || view.state.doc.toString() === content)
      return

    applyingExternalContent = true
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: content },
    })
    applyingExternalContent = false
  },
)

watch(() => props.editorState.language, (language) => {
  if (editorView.value)
    void applyLanguage(language)
})

watch(isDark, () => {
  editorView.value?.dispatch({
    effects: themeCompartment.reconfigure(themeExtension()),
  })
})

onBeforeUnmount(() => {
  destroyEditor()
  themeObserver?.disconnect()
})
</script>

<template>
  <div
    v-if="preview"
    :class="[
      'mb-3 overflow-hidden rounded-md border border-neutral-200 bg-white shadow-sm',
      'dark:border-neutral-800 dark:bg-neutral-900',
    ]"
  >
    <div
      v-if="files.length > 1"
      :class="['flex gap-1 overflow-x-auto border-b border-neutral-200 bg-neutral-50 px-2 py-1.5 dark:border-neutral-800 dark:bg-neutral-950']"
    >
      <button
        v-for="file in files"
        :key="file.path"
        :class="[
          'h-7 max-w-48 shrink-0 rounded-md border px-2 text-xs',
          'inline-flex items-center gap-1.5',
          preview.path === file.path
            ? 'border-sky-300 bg-white text-sky-800 dark:border-sky-800 dark:bg-neutral-900 dark:text-sky-200'
            : 'border-transparent text-neutral-600 hover:bg-white dark:text-neutral-300 dark:hover:bg-neutral-900',
        ]"
        :title="file.path"
        @click="emit('selectFile', file.path)"
      >
        <span :class="['i-solar:file-text-bold-duotone size-3.5 shrink-0']" />
        <span :class="['truncate']">{{ getFileTabLabel(file.path) }}</span>
        <span
          v-if="isDirtyPath(file.path)"
          :class="['size-1.5 shrink-0 rounded-full bg-amber-400']"
          :title="t('tamagotchi.stage.workbench.file-editor.labels.unsaved')"
        />
        <span
          :class="[
            'grid size-4 shrink-0 place-items-center rounded text-neutral-400',
            'hover:bg-neutral-100 hover:text-red-600 dark:hover:bg-neutral-800 dark:hover:text-red-300',
          ]"
          role="button"
          tabindex="0"
          :title="t('tamagotchi.stage.workbench.actions.close-file-preview')"
          @click.stop="emit('closeFile', file.path)"
          @keydown.enter.stop.prevent="emit('closeFile', file.path)"
          @keydown.space.stop.prevent="emit('closeFile', file.path)"
        >
          <span :class="['i-solar:close-circle-bold size-3']" />
        </span>
      </button>
    </div>

    <div :class="['border-b border-neutral-200 px-3 py-2 dark:border-neutral-800']">
      <div :class="['flex min-w-0 flex-wrap items-center gap-2']">
        <div :class="['min-w-0 flex-1']">
          <div :class="['flex min-w-0 items-center gap-2']">
            <div :class="['truncate text-sm font-semibold']">
              {{ preview.path }}
            </div>
            <span
              v-if="editorState.dirty"
              :class="['shrink-0 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-950/60 dark:text-amber-200']"
            >
              {{ t('tamagotchi.stage.workbench.file-editor.labels.unsaved') }}
            </span>
            <span
              v-if="!editorState.editable"
              :class="['shrink-0 rounded bg-neutral-100 px-1.5 py-0.5 text-[10px] font-medium text-neutral-600 dark:bg-neutral-800 dark:text-neutral-300']"
            >
              {{ t('tamagotchi.stage.workbench.file-editor.labels.readonly') }}
            </span>
          </div>
          <div :class="['mt-0.5 text-[11px] text-neutral-500 dark:text-neutral-400']">
            {{ editorState.lineCount }} {{ t('tamagotchi.stage.workbench.values.lines') }}
            · {{ editorState.draftByteLength }} bytes
            · {{ editorState.language }}
            <template v-if="preview.truncated">
              · {{ t('tamagotchi.stage.workbench.command.values.truncated') }}
            </template>
          </div>
        </div>

        <div :class="['ml-auto flex shrink-0 items-center gap-1']">
          <button
            :class="[
              'grid size-7 place-items-center rounded-md text-neutral-500',
              'hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40',
              'dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50',
            ]"
            :title="t('tamagotchi.stage.workbench.actions.zoom-out-file')"
            :disabled="fontPercent === '85%'"
            @click="emit('adjustFontScale', -0.05)"
          >
            <span :class="['i-solar:magnifer-zoom-out-bold-duotone size-4']" />
          </button>
          <span :class="['w-10 text-center text-[11px] tabular-nums text-neutral-500 dark:text-neutral-400']">
            {{ fontPercent }}
          </span>
          <button
            :class="[
              'grid size-7 place-items-center rounded-md text-neutral-500',
              'hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40',
              'dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50',
            ]"
            :title="t('tamagotchi.stage.workbench.actions.zoom-in-file')"
            :disabled="fontPercent === '135%'"
            @click="emit('adjustFontScale', 0.05)"
          >
            <span :class="['i-solar:magnifer-zoom-in-bold-duotone size-4']" />
          </button>
          <button
            :class="[
              'grid size-7 place-items-center rounded-md text-neutral-500',
              'hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40',
              'dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50',
            ]"
            :title="t('tamagotchi.stage.workbench.actions.revert-file')"
            :disabled="!editorState.dirty || saving"
            @click="emit('revert')"
          >
            <span :class="['i-solar:undo-left-bold-duotone size-4']" />
          </button>
          <button
            :class="[
              'grid size-7 place-items-center rounded-md text-neutral-500',
              'hover:bg-neutral-100 hover:text-neutral-900 disabled:cursor-not-allowed disabled:opacity-40',
              'dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50',
            ]"
            :title="t('tamagotchi.stage.workbench.actions.reload-file')"
            :disabled="saving"
            @click="emit('reload')"
          >
            <span :class="['i-solar:refresh-bold-duotone size-4']" />
          </button>
          <button
            v-if="runnable"
            :class="[
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium',
              running
                ? 'cursor-not-allowed bg-emerald-100 text-emerald-400 dark:bg-emerald-950/50 dark:text-emerald-600'
                : 'bg-emerald-600 text-white hover:bg-emerald-500 dark:bg-emerald-600 dark:hover:bg-emerald-500',
            ]"
            :disabled="running"
            :title="t('tamagotchi.stage.workbench.actions.run-file')"
            @click="emit('run')"
          >
            <span
              :class="[
                running ? 'i-svg-spinners:90-ring-with-bg' : 'i-solar:play-bold',
                'size-3.5',
              ]"
            />
            <span>{{ running ? t('tamagotchi.stage.workbench.file-editor.labels.running') : t('tamagotchi.stage.workbench.actions.run') }}</span>
          </button>
          <button
            :class="[
              'inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium',
              editorState.editable && editorState.dirty && !saving
                ? 'bg-neutral-950 text-white hover:bg-neutral-800 dark:bg-neutral-100 dark:text-neutral-950 dark:hover:bg-white'
                : 'cursor-not-allowed bg-neutral-100 text-neutral-400 dark:bg-neutral-800 dark:text-neutral-500',
            ]"
            :disabled="!editorState.editable || !editorState.dirty || saving"
            :title="t('tamagotchi.stage.workbench.actions.save-file')"
            @click="emit('save')"
          >
            <span
              :class="[
                saving ? 'i-svg-spinners:90-ring-with-bg' : 'i-solar:diskette-bold-duotone',
                'size-3.5',
              ]"
            />
            <span>{{ saving ? t('tamagotchi.stage.workbench.file-editor.labels.saving') : t('tamagotchi.stage.workbench.actions.save') }}</span>
          </button>
          <button
            :class="[
              'grid size-7 shrink-0 place-items-center rounded-md text-neutral-500',
              'hover:bg-neutral-100 hover:text-neutral-900 dark:text-neutral-400 dark:hover:bg-neutral-800 dark:hover:text-neutral-50',
            ]"
            :title="t('tamagotchi.stage.workbench.actions.close-file-preview')"
            @click="emit('closeFile', preview.path)"
          >
            <span :class="['i-solar:close-circle-bold size-4']" />
          </button>
        </div>
      </div>
      <div
        v-if="saveError"
        :class="['mt-2 rounded-md border border-red-200 bg-red-50 px-2 py-1.5 text-xs leading-5 text-red-700 dark:border-red-900/70 dark:bg-red-950/30 dark:text-red-200']"
      >
        {{ saveError }}
      </div>
      <div
        v-else-if="editorState.readOnlyReason"
        :class="['mt-2 rounded-md border border-neutral-200 bg-neutral-50 px-2 py-1.5 text-xs leading-5 text-neutral-600 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-300']"
      >
        {{ getReadOnlyReasonLabel(editorState.readOnlyReason) }}
      </div>
    </div>

    <div
      :class="editorBodyClass"
      @wheel="handleFilePreviewWheel"
    >
      <div
        v-if="editorState.editable"
        :class="['min-h-0 flex flex-1 flex-col']"
      >
        <div :class="['border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-medium text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400']">
          {{ t('tamagotchi.stage.workbench.file-editor.labels.editor') }}
        </div>
        <div
          ref="editorHost"
          :class="['workbench-center-editor-cm min-h-0 flex-1 overflow-hidden bg-white dark:bg-neutral-900']"
          :style="{ fontSize }"
        />
      </div>

      <div v-else :class="['min-h-0 overflow-hidden']">
        <div :class="['flex items-center justify-between gap-2 border-b border-neutral-200 bg-neutral-50 px-3 py-1.5 text-[11px] font-medium text-neutral-500 dark:border-neutral-800 dark:bg-neutral-950 dark:text-neutral-400']">
          <span>{{ t('tamagotchi.stage.workbench.file-editor.labels.preview') }}</span>
          <span
            v-if="highlightLoading"
            :class="['inline-flex items-center gap-1']"
          >
            <span :class="['i-svg-spinners:90-ring-with-bg size-3']" />
            {{ t('tamagotchi.stage.workbench.values.loading') }}
          </span>
        </div>
        <div
          :class="['workbench-center-editor-highlight h-full max-h-[48vh] overflow-auto p-3 font-mono leading-6 text-neutral-800 dark:text-neutral-100']"
          :style="{ fontSize }"
          v-html="highlightedHtml"
        />
      </div>
    </div>
  </div>
</template>

<style scoped>
.workbench-center-editor-highlight :deep(.shiki),
.workbench-center-editor-highlight :deep(.workbench-center-editor-fallback) {
  background: transparent !important;
  margin: 0;
  min-height: 100%;
  overflow: visible;
}

.workbench-center-editor-highlight :deep(code) {
  display: block;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  white-space: pre;
}

.workbench-center-editor-cm {
  display: flex;
  min-height: 0;
}

.workbench-center-editor-cm :deep(.cm-editor) {
  flex: 1;
  min-height: 0;
  width: 100%;
  max-height: 48vh;
  background: transparent;
}

.workbench-center-editor-cm :deep(.cm-scroller) {
  overflow: auto;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;
  line-height: 1.5rem;
}

.workbench-center-editor-cm :deep(.cm-editor.cm-focused) {
  outline: none;
}
</style>
