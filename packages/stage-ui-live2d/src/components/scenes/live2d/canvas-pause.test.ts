import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./Canvas.vue', import.meta.url), 'utf8')
const modelSource = readFileSync(new URL('./Model.vue', import.meta.url), 'utf8')
const sceneSource = readFileSync(new URL('../Live2D.vue', import.meta.url), 'utf8')

describe('live2D preview pause', () => {
  it('stops and resumes the Pixi ticker without rebuilding the model', () => {
    expect(source).toContain('paused?: boolean')
    expect(source).toContain('autoStart: !props.paused')
    expect(source).toContain('watch(() => props.paused, syncPixiTickerState, { immediate: true })')
    expect(source).toContain('pixiApp.value.ticker.stop()')
    expect(source).toContain('pixiApp.value.ticker.start()')
  })

  it('defers context restore rendering until the preview resumes', () => {
    expect(source).toMatch(/function restorePixiStageWithoutRebuild\(\)[\s\S]*if \(props\.paused\) \{[\s\S]*ticker\.stop\(\)[\s\S]*return[\s\S]*handleResize\(\)[\s\S]*pixiApp\.value\.render\(\)/)
  })

  it('owns model updates from the pausable application ticker', () => {
    expect(modelSource).toMatch(/new Live2DModel<PixiLive2DInternalModel>\(\{\s*autoInteract: false,\s*autoUpdate: false,?\s*\}\)/)
    expect(modelSource).toContain('{ autoInteract: false, autoUpdate: false }')
    expect(modelSource).toContain('app.ticker.add(updateModel, undefined, UPDATE_PRIORITY.HIGH)')
    expect(modelSource).toContain('app.ticker.remove(updateModel)')
    expect(modelSource).not.toContain('live2DModel.autoUpdate =')
    expect(modelSource).toContain('dynamic && shadowEnabled && !isPaused')
    expect(modelSource).not.toContain('value ? app?.stop() : app?.start()')
  })

  it('releases model and WebGL resources when the scene unmounts', () => {
    expect(modelSource).toMatch(/onUnmounted\(\(\) => \{[\s\S]*destroyCurrentModel\(\)/)
    expect(modelSource).toContain('currentModel.destroy({ texture: true, baseTexture: true })')
    expect(modelSource).toContain('live2DModel.destroy({ texture: true, baseTexture: true })')
    expect(source).toContain('app.destroy(true, { children: false, texture: false, baseTexture: false })')
  })

  it('reports model load failures instead of treating a canvas as a ready character', () => {
    expect(modelSource).toContain('(e: \'modelError\'')
    expect(modelSource).toContain('modelId: props.modelId')
    expect(modelSource).toContain('modelSrc: requestedModelSrc')
    expect(modelSource).toContain('stage: props.runtimeMode')
    expect(modelSource).toContain('componentState.value = \'pending\'')
    expect(sceneSource).toContain('componentStateCanvas.value !== \'mounted\' || componentStateModel.value !== \'mounted\'')
    expect(sceneSource).toContain('@model-error="handleModelError"')
    expect(sceneSource).not.toContain('componentStateCanvas.value === \'mounted\' ? \'mounted\' : \'loading\'')
    expect(modelSource).not.toContain('live2dStore.onShouldUpdateView')
  })

  it('keeps preview controls while excluding stage-only semantic work', () => {
    expect(modelSource).toContain('runtimeMode?: \'stage\' | \'preview\'')
    expect(modelSource).toContain('return props.runtimeMode === \'stage\'')
    expect(modelSource).toContain('if (!shouldRunAutomaticMotionTakeover() || !request || !model.value)')
    expect(modelSource).toContain('if (transition.completed)')
    expect(modelSource).toContain('activeEmotionTransition.completed = true')
  })

  it('returns motion previews to the pose visible before playback without requiring an idle motion', () => {
    expect(modelSource).toContain('return playback.owner === \'preview\' || playback.owner === \'action\'')
    expect(modelSource).toContain('lastRenderedCoreState = snapshotCoreState(internalModel.coreModel)')
    expect(modelSource).toMatch(/baselineState: owner === 'preview'[\s\S]*\? lastRenderedCoreState \?\? snapshotCoreState\(\)/)
    expect(modelSource).toContain('from: lastRenderedCoreState ?? snapshotCoreState(coreModel)')
    expect(modelSource).not.toContain('getParameterDefaultValue(index)')
    expect(modelSource).not.toContain('setMotion(idleGroup, 0, MotionPriority.IDLE)')
    expect(modelSource).toMatch(/clearActiveMotionPlayback\(status, !restoreBaseline\)[\s\S]*playback\.owner === 'preview'[\s\S]*stopAllMotions\(\)/)
    expect(modelSource).toMatch(/function resetExpression\(\)[\s\S]*activeMotionPlayback\?\.owner === 'preview'[\s\S]*finishMotionPlayback/)
  })

  it('keeps a subtle procedural sway when no authored motion is playing', () => {
    expect(modelSource).toContain('motionOwner.value !== \'stopped\'')
    expect(modelSource).toContain('[\'ParamAngleZ\'')
    expect(modelSource).toContain('[\'ParamBodyAngleZ\'')
    expect(modelSource).toContain('baseline + offset * strength')
    expect(modelSource).toContain('applyProceduralIdleSway(internalModel)')
  })

  it('eases the return-to-baseline handoff instead of snapping the tracked focus pose back in one frame', () => {
    // 回正时长与 sway 恢复同量级，读作一段连续缓动而非快速抽直。
    expect(modelSource).toContain('const MOTION_BASELINE_RESTORE_DURATION_MS = 800')
    // 基准恢复完成时捕获"无 focus 加成"快照作为 sway 恢复起点。
    expect(modelSource).toContain('beginNaturalIdleResume(performance.now(), snapshotCoreState(internalModel.coreModel))')
    expect(modelSource).toContain('naturalIdleResumeFromState?.parameterValues[parameterIndex]')
    expect(modelSource).toContain('startValue * (1 - resumeBlend) + targetValue * resumeBlend')
    // 其余恢复路径（idle 动作结束/停播/换模型）不携带旧快照，避免把姿态拉回过时基准。
    expect(modelSource).toContain('beginNaturalIdleResume(performance.now())')
    expect(modelSource).toContain('beginNaturalIdleResume(0)')
    expect(modelSource).toContain('naturalIdleResumeFromState = undefined')
    // 已核实 focus() 第三参语义（instant）：保持 false 平滑路径，禁止瞬时置零。
    expect(modelSource).toContain('internalModel.focusController.focus(0, 0, false)')
    expect(modelSource).not.toContain('focusController.focus(0, 0, true)')
  })
})
