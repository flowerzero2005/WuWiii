import type { ContextMessage } from '../../../types/chat'
import type { AiriPsychologicalCue } from '../persona-psychological-cue'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

export const PSYCHOLOGICAL_CUE_CONTEXT_ID = 'persona:psychological-cue'

function formatList(items: string[]) {
  return items.length > 0 ? items.join(' | ') : 'none'
}

export function createPsychologicalCueContext(cue: AiriPsychologicalCue): ContextMessage {
  return {
    id: nanoid(),
    contextId: PSYCHOLOGICAL_CUE_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: [
      '[persona-psychological-cue]',
      'purpose=读取这一轮的心理姿态和边界；不是场景模板，不提供固定台词',
      'authority=active persona card',
      `cue=${cue.kind} intensity=${cue.intensity} signals=${formatList(cue.signals)}`,
      `visible-posture=${cue.visiblePosture}`,
      `spoken-boundary=${cue.spokenBoundary}`,
      `inner-voice-allocation=${cue.innerVoiceAllocation}`,
      `avoid=${formatList(cue.avoid)}`,
      'use=只把 cue 融进节奏、短长、反驳力度、关心露出量和留白；不要把 cue 名称或规则翻译进正文',
    ].join('\n'),
    createdAt: Date.now(),
  }
}
