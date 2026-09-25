import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it } from 'vitest'

import {
  buildWorkbenchScenePromptSection,
  DEFAULT_WORKBENCH_SCENE_DESCRIPTION,
  getWorkbenchWorkStylePreset,
  useWorkbenchSceneSettingsStore,
  WORKBENCH_SCENE_HARD_RULES,
  WORKBENCH_SCENE_PROMPT_VERSION,
  WORKBENCH_WORK_STYLE_PRESETS,
} from './workbench'

describe('workbench settings prompt', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear()
    setActivePinia(createPinia())
  })

  it('keeps the first-open risk notice pending until the user acknowledges it', () => {
    const store = useWorkbenchSceneSettingsStore()

    expect(store.riskNoticeAcknowledged).toBe(false)

    store.acknowledgeRiskNotice()

    expect(store.riskNoticeAcknowledged).toBe(true)
  })

  it('builds a work style prompt with risk-based autonomy rules', () => {
    const prompt = buildWorkbenchScenePromptSection({
      companionWarmth: 0.55,
      conciseReports: true,
      foldInternalDetails: true,
      sceneDescription: '',
    })

    expect(prompt).toContain('# Workbench Work Style')
    expect(prompt).toContain(`Version: ${WORKBENCH_SCENE_PROMPT_VERSION}`)
    expect(prompt).toContain('User-editable work style:')
    expect(prompt).toContain(DEFAULT_WORKBENCH_SCENE_DESCRIPTION)
    expect(prompt).toContain('Use preview-first file editing')
    expect(prompt).toContain('Low-risk auxiliary checks can run')
    expect(prompt).toContain('Short confirmations like ok')
    expect(prompt).not.toContain('Confirm before file writes')
    expect(prompt).not.toContain('free shell commands')
  })

  it('defines the MVP-1 work style presets in the expected order', () => {
    expect(WORKBENCH_WORK_STYLE_PRESETS.map(preset => preset.id)).toEqual([
      'balanced',
      'concise',
      'warmer-companion',
      'professional-focus',
    ])

    expect(getWorkbenchWorkStylePreset('balanced')).toMatchObject({
      sceneDescription: DEFAULT_WORKBENCH_SCENE_DESCRIPTION,
      conciseReports: true,
      foldInternalDetails: true,
      companionWarmth: 0.55,
    })
    expect(getWorkbenchWorkStylePreset('concise').companionWarmth)
      .toBeLessThan(getWorkbenchWorkStylePreset('balanced').companionWarmth)
    expect(getWorkbenchWorkStylePreset('warmer-companion').companionWarmth)
      .toBeGreaterThan(getWorkbenchWorkStylePreset('balanced').companionWarmth)
    expect(getWorkbenchWorkStylePreset('professional-focus')).toMatchObject({
      conciseReports: false,
      foldInternalDetails: false,
    })
  })

  it('keeps protected rules aligned with preview-first and guarded-risk policy', () => {
    const hardRules = WORKBENCH_SCENE_HARD_RULES.join('\n')

    expect(hardRules).toContain('applying writes requires an explicit UI action')
    expect(hardRules).toContain('Low-risk auxiliary checks can run')
    expect(hardRules).toContain('cross-workspace actions stay guarded')
    expect(hardRules).toContain('not consent to write, apply, or run')
    expect(hardRules).not.toContain('network access, free shell commands')
  })
})
