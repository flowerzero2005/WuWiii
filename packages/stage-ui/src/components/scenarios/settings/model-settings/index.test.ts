import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./index.vue', import.meta.url), 'utf8')
const live2dSource = readFileSync(new URL('./live2d.vue', import.meta.url), 'utf8')

describe('model settings preview lifecycle', () => {
  it('pauses the loaded Live2D preview instead of rebuilding it after a chooser closes', () => {
    expect(source).toContain('useDisplayModelFilePickerActive')
    expect(source).toContain('modelSelectorOpen.value || displayModelFilePickerActive.value')
    expect(source).toContain('v-model:show="modelSelectorOpen"')
    expect(source).toContain('v-if="stageModelRenderer === \'live2d\'"')
    expect(source).toContain('v-show="!settingsPreviewHidden"')
    expect(source).toContain(':paused="settingsPreviewPaused"')
    expect(source).not.toContain('v-if="stageModelRenderer === \'live2d\' && !settingsPreviewPaused"')
  })

  it('unmounts previews without a pausable renderer while a chooser is open', () => {
    expect(source).toContain('v-if="stageModelRenderer === \'picture-oc\' && !settingsPreviewHidden"')
    expect(source).toContain('v-if="stageModelRenderer === \'vrm\' && !settingsPreviewHidden"')
  })

  it('keeps full preview quality while isolating stage-only behavior', () => {
    expect(source).toContain('runtime-mode="preview"')
    expect(source).toContain(':preview-action="previewLive2DAction"')
    expect(source).toContain(':live2d-max-fps="live2dMaxFps"')
    expect(source).toContain(':live2d-shadow-enabled="live2dShadowEnabled"')
    expect(source).not.toContain(':resolution="1"')
    expect(source).not.toContain('LIVE2D_SETTINGS_PREVIEW_MAX_FPS')
  })

  it('routes composite action previews through the local preview renderer', () => {
    expect(source).toContain(':preview-action="previewLive2DAction"')
    expect(live2dSource).toContain('previewAction?:')
    expect(live2dSource).toContain('if (props.previewAction)')
    expect(live2dSource).toContain('await props.previewAction({')
  })

  it('freezes the loaded high-quality preview after idle and resumes it on demand', () => {
    expect(source).toContain('const live2dPreviewActive = ref(true)')
    expect(source).toContain('const settingsPreviewPaused = computed(() => settingsPreviewHidden.value || !live2dPreviewActive.value)')
    expect(source).toContain('const live2dPreviewFocusAt = computed(() => live2dPreviewActive.value')
    expect(source).toContain(':focus-at="live2dPreviewFocusAt"')
    expect(source).not.toContain(':focus-at="{ x: positionCursor.x.value, y: positionCursor.y.value }"')
    expect(source).toContain('!live2dPreviewActive.value')
    expect(source).toContain('function resumeLive2DPreview(')
    expect(source).toContain('live2dPreviewActive.value = false')
    expect(source).toContain('resumeLive2DPreview(LIVE2D_PREVIEW_MOTION_ACTIVE_MS)')
    expect(source).toContain('(durationMs ?? LIVE2D_PREVIEW_IDLE_DELAY_MS) + 500')
    expect(source).toContain('watch([modelSelectorOpen, displayModelFilePickerActive]')
    expect(source).toContain('window.clearTimeout(live2dPreviewIdleTimer)')
    expect(source).toContain('@input.capture="resumeLive2DPreview()"')
    expect(source).toContain('@change.capture="resumeLive2DPreview()"')
  })
})
