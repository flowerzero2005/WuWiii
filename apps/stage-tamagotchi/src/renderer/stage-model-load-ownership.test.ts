import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
const cardSource = readFileSync(new URL('../../../../packages/stage-ui/src/stores/modules/airi-card.ts', import.meta.url), 'utf8')
const stageSource = readFileSync(new URL('../../../../packages/stage-ui/src/components/scenes/Stage.vue', import.meta.url), 'utf8')
const modelSource = readFileSync(new URL('../../../../packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue', import.meta.url), 'utf8')
const EXPLICIT_STAGE_REFRESH_RE = /live2dStore\.onShouldUpdateView[\s\S]*showStage\.value = false[\s\S]*await settingsStore\.updateStageModel\(\)[\s\S]*showStage\.value = true/
const LOCALIZED_TIMEOUT_RE = /timeout = window\.setTimeout[\s\S]*reject\(new Error\(i18n\.t\('tamagotchi\.stage\.bootstrap\.failed-detail'\)\)\)/

describe('stage model load ownership', () => {
  it('applies the active card model once during desktop startup', () => {
    expect(appSource).toContain('await initializeCardRuntime()')
    expect(appSource).not.toContain('initializeStageModelRuntime')
    expect(cardSource).toContain('await stageModelStore.applyPersonaDisplayModel(modelId)')
    expect(cardSource).not.toContain('await stageModelStore.refreshStageView()')
  })

  it('keeps Stage as the only owner of explicit Live2D refreshes', () => {
    expect(modelSource).not.toContain('live2dStore.onShouldUpdateView')
    expect(stageSource).toMatch(EXPLICIT_STAGE_REFRESH_RE)
    expect(stageSource).toContain('v-if="stageModelRenderer === \'live2d\' && showStage"')
  })

  it('reports a localized timeout instead of silently accepting pending state', () => {
    expect(appSource).toMatch(LOCALIZED_TIMEOUT_RE)
    expect(appSource).not.toContain('The character renderer did not become ready in time.')
    expect(appSource).not.toContain('The character renderer failed to initialize.')
  })
})
