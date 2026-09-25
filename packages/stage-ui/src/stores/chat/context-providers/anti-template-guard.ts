import type { ContextMessage } from '../../../types/chat'
import type { AiriAntiTemplateGuard } from '../anti-template-guard'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'

export const ANTI_TEMPLATE_GUARD_CONTEXT_ID = 'persona:anti-template-guard'

function formatValues(values: string[]) {
  return values.length > 0 ? values.join(', ') : 'none'
}

function buildAvoidTags(guard: AiriAntiTemplateGuard) {
  const tags: string[] = []

  if (guard.repeatedOpenings.length > 0) {
    tags.push('same-opening')
  }

  if (guard.repeatedEndings.length > 0) {
    tags.push('same-ending')
  }

  if (guard.repeatedSelfReferences.length > 0) {
    tags.push('self-reference-loop')
  }

  if (guard.repeatedPragmaticPatterns.includes('comfort-opening')) {
    tags.push('comfort-routine')
  }

  if (guard.repeatedPragmaticPatterns.includes('follow-up-tail')) {
    tags.push('follow-up-hook')
  }

  if (guard.repeatedPragmaticPatterns.includes('repair-routine')) {
    tags.push('repair-script')
  }

  if (guard.repeatedPragmaticPatterns.includes('service-menu-tail')) {
    tags.push('service-tail')
  }

  if (guard.repeatedPragmaticPatterns.includes('presence-tail')) {
    tags.push('im-here-tail')
  }

  if (guard.repeatedPragmaticPatterns.includes('tilde-tail')) {
    tags.push('tilde-tail')
  }

  if (guard.repeatedPragmaticPatterns.includes('ellipsis-overuse')) {
    tags.push('ellipsis-overuse')
  }

  if (guard.repeatedPragmaticPatterns.includes('stage-narration')) {
    tags.push('stage-narration')
  }

  if (guard.repeatedPragmaticPatterns.includes('cheap-emotion-marker')) {
    tags.push('cheap-emotion-marker')
  }

  return tags.length > 0 ? tags.join(', ') : 'none'
}

export function createAntiTemplateGuardContext(guard: AiriAntiTemplateGuard): ContextMessage {
  return {
    id: nanoid(),
    contextId: ANTI_TEMPLATE_GUARD_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: [
      '[anti-template]',
      `openings=${formatValues(guard.repeatedOpenings)}`,
      `endings=${formatValues(guard.repeatedEndings)}`,
      `self-ref=${formatValues(guard.repeatedSelfReferences)}`,
      `pragmatic=${formatValues(guard.repeatedPragmaticPatterns)}`,
      `stale-habits=${buildAvoidTags(guard)}`,
      'use=notice the repeated habit, then answer from the current persona and moment',
      'note=do not announce variation; just let cadence, wording, and stopping point change naturally; stop cleanly instead of replacing one routine closer with another',
    ].join('\n'),
    createdAt: Date.now(),
  }
}
