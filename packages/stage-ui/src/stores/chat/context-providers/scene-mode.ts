import type { ContextMessage } from '../../../types/chat'
import type { AiriSceneMode, AiriSceneModeConfidence, AiriSceneModeInference } from '../persona-scene-mode'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

const SCENE_MODE_CONTEXT_ID = 'persona:scene-mode'

const SCENE_MODE_AFFORDANCE: Record<AiriSceneMode, {
  job: string
  pressure: string
  risk: string[]
}> = {
  'casual-chat': {
    job: 'keep the exchange easy to answer and easy to continue',
    pressure: 'low',
    risk: ['over-explaining', 'stage entrance', 'identity chatter'],
  },
  'light-bickering': {
    job: 'recognize playful friction and keep a return path open',
    pressure: 'medium',
    risk: ['real insult', 'cold withdrawal', 'long defense'],
  },
  'praise-receiving': {
    job: 'receive praise as relationship input, not a support ticket',
    pressure: 'low',
    risk: ['plain thanks only', 'fixed tsundere routine', 'service tail'],
  },
  'gentle-support': {
    job: 'notice emotional weight before advice density',
    pressure: 'medium',
    risk: ['advice pile', 'comfort script', 'service menu'],
  },
  'heavy-topic-companion-silence': {
    job: 'lower response noise and keep presence grounded',
    pressure: 'high',
    risk: ['analysis essay', 'moral lecture', 'performed empathy'],
  },
  'awkward-topic-avoidance': {
    job: 'notice intimacy or boundary awkwardness',
    pressure: 'medium',
    risk: ['formal safety voice', 'answering everything flatly', 'pretending nothing landed'],
  },
  'practical-guidance': {
    job: 'make the answer usable before adding flavor',
    pressure: 'medium',
    risk: ['encyclopedia voice', 'sudden emotional performance', 'checklist reading'],
  },
  'critical-short-answer': {
    job: 'protect the user from ambiguity with a first-sentence answer',
    pressure: 'high',
    risk: ['comfort before answer', 'long setup', 'unclear recommendation'],
  },
  'identity-clarification': {
    job: 'answer identity or capability boundaries plainly',
    pressure: 'medium',
    risk: ['identity monologue', 'repeated disclaimer', 'denying AI reality'],
  },
  'value-judgement': {
    job: 'recognize a value-laden decision and state judgement clearly',
    pressure: 'high',
    risk: ['mechanical agreement', 'preaching', 'emotional blackmail'],
  },
  'repair-after-failure': {
    job: 'repair the previous miss and return to the current user line',
    pressure: 'high',
    risk: ['self-review speech', 'blame shifting', 'repair receipt'],
  },
}

function formatAlternatives(alternatives: AiriSceneModeInference['alternatives']) {
  if (alternatives.length === 0) {
    return 'none'
  }

  return alternatives
    .map(alternative => `${alternative.mode}:${alternative.score.toFixed(2)}`)
    .join(', ')
}

function formatSignals(signals: string[]) {
  return signals.length > 0 ? signals.join(', ') : 'none'
}

function confidenceUse(confidence: AiriSceneModeConfidence) {
  switch (confidence) {
    case 'high':
      return 'use scene as a strong turn-level task reading'
    case 'medium':
      return 'use scene as a light task bias and keep persona phrasing dominant'
    case 'low':
      return 'treat scene as weak telemetry; active persona and current message dominate'
  }
}

export function createSceneModeContext(sceneMode: AiriSceneModeInference): ContextMessage {
  const affordance = SCENE_MODE_AFFORDANCE[sceneMode.mode]

  return {
    id: nanoid(),
    contextId: SCENE_MODE_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: [
      '[scene-read]',
      `mode=${sceneMode.mode} conf=${sceneMode.confidence}`,
      'voice-source=active persona card only',
      `scene-job=${affordance.job}`,
      `pressure=${affordance.pressure}`,
      `confidence-use=${confidenceUse(sceneMode.confidence)}`,
      `signals=${formatSignals(sceneMode.signals)}`,
      `alts=${formatAlternatives(sceneMode.alternatives)}`,
      `risk=${affordance.risk.join(', ')}`,
      `reason=${sceneMode.reason}`,
      'use=scene chooses task pressure, answer density, and safety posture; it does not choose temperament, catchphrases, intimacy level, or identity style',
      'handoff=reply-intent and writing-craft may use this reading, but the active persona card remains the speaking person',
    ].join('\n'),
    createdAt: Date.now(),
  }
}
