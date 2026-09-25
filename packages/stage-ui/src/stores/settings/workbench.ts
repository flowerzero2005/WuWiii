import { useLocalStorageManualReset } from '@proj-airi/stage-shared/composables'
import { defineStore } from 'pinia'
import { computed } from 'vue'

export const WORKBENCH_SCENE_PROMPT_VERSION = '2026-06-14.1'

export const DEFAULT_WORKBENCH_SCENE_DESCRIPTION = [
  'The current resident is working with the user inside Wuwiii Workbench.',
  'She should feel like a familiar companion who is serious about getting the task done: concise, calm, a little warm, and focused on progress.',
  'The visible reply should read like a teammate reporting work, not like a support script, a shell log, or casual chat.',
].join('\n')

export const WORKBENCH_SCENE_HARD_RULES = [
  'Use this Workbench work style only for Workbench tasks. It supplements the active character card and must not replace it.',
  'Give the useful result first. Keep visible replies short unless the user asks for details.',
  'Let the active persona show through lightly in wording, but do not perform roleplay or idle banter during work.',
  'Keep internal plans, raw tool details, prompt mechanics, safety boundary wording, and command logs out of the main reply when the UI can fold them.',
  'Use preview-first file editing: proposing changes is allowed, but applying writes requires an explicit UI action or clear apply/write language.',
  'Low-risk auxiliary checks can run when workspace policy allows; installs, deletes, elevated actions, unapproved external access, and cross-workspace actions stay guarded. Short confirmations like ok, 继续, 好, or yes are not consent to write, apply, or run.',
]

export type WorkbenchSceneSource = 'default' | 'custom'

export const WORKBENCH_WORK_STYLE_PRESET_IDS = [
  'balanced',
  'concise',
  'warmer-companion',
  'professional-focus',
] as const

export type WorkbenchWorkStylePresetId = typeof WORKBENCH_WORK_STYLE_PRESET_IDS[number]

export interface WorkbenchWorkStylePreset {
  id: WorkbenchWorkStylePresetId
  sceneDescription: string
  conciseReports: boolean
  foldInternalDetails: boolean
  companionWarmth: number
}

export const WORKBENCH_WORK_STYLE_PRESETS: readonly WorkbenchWorkStylePreset[] = [
  {
    id: 'balanced',
    sceneDescription: DEFAULT_WORKBENCH_SCENE_DESCRIPTION,
    conciseReports: true,
    foldInternalDetails: true,
    companionWarmth: 0.55,
  },
  {
    id: 'concise',
    sceneDescription: [
      'The current resident is working with the user inside Wuwiii Workbench.',
      'She should stay direct, practical, and brief: lead with the result, report only the next useful detail, and avoid filler.',
      'The visible reply should feel like a focused teammate keeping momentum high.',
    ].join('\n'),
    conciseReports: true,
    foldInternalDetails: true,
    companionWarmth: 0.3,
  },
  {
    id: 'warmer-companion',
    sceneDescription: [
      'The current resident is working with the user inside Wuwiii Workbench.',
      'She should feel like a familiar companion who keeps the task moving while leaving a little more warmth in acknowledgements and progress reports.',
      'The visible reply should stay work-first, but it can sound closer and more human when the task context allows.',
    ].join('\n'),
    conciseReports: false,
    foldInternalDetails: true,
    companionWarmth: 0.85,
  },
  {
    id: 'professional-focus',
    sceneDescription: [
      'The current resident is working with the user inside Wuwiii Workbench.',
      'She should use a calm professional tone: specific, structured, and careful with risk, assumptions, and verification status.',
      'The visible reply should prioritize reproducible work reports over companion-like color.',
    ].join('\n'),
    conciseReports: false,
    foldInternalDetails: false,
    companionWarmth: 0.2,
  },
]

export function getWorkbenchWorkStylePreset(presetId: WorkbenchWorkStylePresetId) {
  return WORKBENCH_WORK_STYLE_PRESETS.find(preset => preset.id === presetId) ?? WORKBENCH_WORK_STYLE_PRESETS[0]!
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max)
}

function normalizeSceneDescription(value: string) {
  const trimmed = value.trim()
  return trimmed || DEFAULT_WORKBENCH_SCENE_DESCRIPTION
}

function getWarmthLabel(value: number) {
  if (value < 0.35)
    return 'low: mostly direct work reports'
  if (value > 0.75)
    return 'high: warmer teammate tone while staying concise'
  return 'balanced: familiar but still work-first'
}

export function buildWorkbenchScenePromptSection(input: {
  companionWarmth: number
  conciseReports: boolean
  foldInternalDetails: boolean
  sceneDescription: string
}) {
  const sceneDescription = normalizeSceneDescription(input.sceneDescription)
  const companionWarmth = clamp(input.companionWarmth, 0, 1)

  return [
    '# Workbench Work Style',
    `Version: ${WORKBENCH_SCENE_PROMPT_VERSION}`,
    '',
    'User-editable work style:',
    sceneDescription,
    '',
    'Hard rules:',
    ...WORKBENCH_SCENE_HARD_RULES.map(rule => `- ${rule}`),
    '',
    'Current preferences:',
    `- Report length: ${input.conciseReports ? 'concise work reports by default' : 'allow slightly fuller explanations when helpful'}.`,
    `- Internal detail handling: ${input.foldInternalDetails ? 'fold internal details by default' : 'show more process detail when useful'}.`,
    `- Companion warmth: ${getWarmthLabel(companionWarmth)}.`,
  ].join('\n')
}

function matchesWorkbenchWorkStylePreset(
  preset: WorkbenchWorkStylePreset,
  input: {
    companionWarmth: number
    conciseReports: boolean
    foldInternalDetails: boolean
    sceneDescription: string
  },
) {
  return normalizeSceneDescription(input.sceneDescription) === preset.sceneDescription
    && input.conciseReports === preset.conciseReports
    && input.foldInternalDetails === preset.foldInternalDetails
    && clamp(input.companionWarmth, 0, 1) === preset.companionWarmth
}

export const useWorkbenchSceneSettingsStore = defineStore('settings-workbench-scene', () => {
  const sceneDescription = useLocalStorageManualReset<string>(
    'settings/workbench/scene-description',
    DEFAULT_WORKBENCH_SCENE_DESCRIPTION,
  )
  const conciseReports = useLocalStorageManualReset<boolean>('settings/workbench/concise-reports', true)
  const foldInternalDetails = useLocalStorageManualReset<boolean>('settings/workbench/fold-internal-details', true)
  const companionWarmth = useLocalStorageManualReset<number>('settings/workbench/companion-warmth', 0.55)
  const riskNoticeAcknowledged = useLocalStorageManualReset<boolean>('settings/workbench/risk-notice-acknowledged', false)

  const normalizedCompanionWarmth = computed(() => clamp(companionWarmth.value, 0, 1))
  const normalizedSceneDescription = computed(() => normalizeSceneDescription(sceneDescription.value))
  const activeWorkStylePresetId = computed<WorkbenchWorkStylePresetId | undefined>(() => {
    return WORKBENCH_WORK_STYLE_PRESETS.find(preset => matchesWorkbenchWorkStylePreset(preset, {
      companionWarmth: normalizedCompanionWarmth.value,
      conciseReports: conciseReports.value,
      foldInternalDetails: foldInternalDetails.value,
      sceneDescription: normalizedSceneDescription.value,
    }))?.id
  })
  const sceneSource = computed<WorkbenchSceneSource>(() => {
    return normalizedSceneDescription.value === DEFAULT_WORKBENCH_SCENE_DESCRIPTION
      ? 'default'
      : 'custom'
  })
  const promptSection = computed(() => buildWorkbenchScenePromptSection({
    companionWarmth: normalizedCompanionWarmth.value,
    conciseReports: conciseReports.value,
    foldInternalDetails: foldInternalDetails.value,
    sceneDescription: normalizedSceneDescription.value,
  }))
  const isDefaultScene = computed(() => {
    return sceneSource.value === 'default'
      && conciseReports.value === true
      && foldInternalDetails.value === true
      && normalizedCompanionWarmth.value === 0.55
  })

  function resetSceneDescription() {
    sceneDescription.value = DEFAULT_WORKBENCH_SCENE_DESCRIPTION
  }

  function acknowledgeRiskNotice() {
    riskNoticeAcknowledged.value = true
  }

  function resetState() {
    sceneDescription.reset()
    conciseReports.reset()
    foldInternalDetails.reset()
    companionWarmth.reset()
  }

  function applyWorkStylePreset(presetId: WorkbenchWorkStylePresetId) {
    const preset = getWorkbenchWorkStylePreset(presetId)

    sceneDescription.value = preset.sceneDescription
    conciseReports.value = preset.conciseReports
    foldInternalDetails.value = preset.foldInternalDetails
    companionWarmth.value = preset.companionWarmth
  }

  return {
    activeWorkStylePresetId,
    companionWarmth,
    conciseReports,
    foldInternalDetails,
    hardRules: WORKBENCH_SCENE_HARD_RULES,
    isDefaultScene,
    normalizedCompanionWarmth,
    normalizedSceneDescription,
    promptSection,
    promptVersion: WORKBENCH_SCENE_PROMPT_VERSION,
    riskNoticeAcknowledged,
    sceneDescription,
    sceneSource,
    acknowledgeRiskNotice,
    applyWorkStylePreset,
    resetSceneDescription,
    resetState,
  }
})
