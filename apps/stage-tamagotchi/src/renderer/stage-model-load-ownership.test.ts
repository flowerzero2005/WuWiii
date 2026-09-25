import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const appSource = readFileSync(new URL('./App.vue', import.meta.url), 'utf8')
const cardSource = readFileSync(new URL('../../../../packages/stage-ui/src/stores/modules/airi-card.ts', import.meta.url), 'utf8')
const stageSource = readFileSync(new URL('../../../../packages/stage-ui/src/components/scenes/Stage.vue', import.meta.url), 'utf8')
const modelSource = readFileSync(new URL('../../../../packages/stage-ui-live2d/src/components/scenes/live2d/Model.vue', import.meta.url), 'utf8')

describe('stage model load ownership', () => {
  it('applies the active card model once during desktop startup', () => {
    expect(appSource).toContain('await initializeCardRuntime()')
    expect(appSource).not.toContain('initializeStageModelRuntime')
    expect(cardSource).toContain('await stageModelStore.applyPersonaDisplayModel(modelId)')
    expect(cardSource).not.toContain('await stageModelStore.refreshStageView()')
  })

  it('keeps Stage as the only owner of explicit Live2D refreshes', () => {
    expect(modelSource).not.toContain('live2dStore.onShouldUpdateView')
    expect(stageSource).toMatch(/live2dStore\.onShouldUpdateView[\s\S]*await settingsStore\.updateStageModel\(\)[\s\S]*stageViewKey\.value \+= 1/)
  })

  it('reports a localized timeout instead of silently accepting pending state', () => {
    expect(appSource).toContain('角色模型加载超时')
    expect(appSource).not.toContain('Character renderer startup timed out')
  })
})
