import type { ComposerDetach, ComposerDraft, ComposerSnapshot, ComposerVersion } from './detached-composer'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export const composerDetach = defineInvokeEventa<ComposerSnapshot, ComposerDetach>('eventa:invoke:composer:detach')
export const composerRead = defineInvokeEventa<ComposerSnapshot | undefined>('eventa:invoke:composer:read')
export const composerRecovery = defineInvokeEventa<{ exists: boolean, uncertain: boolean }, { userScope: string, sessionId: string, surface: 'page' | 'widget' }>('eventa:invoke:composer:recovery')
export const composerViewRecovery = defineInvokeEventa<void, { userScope: string, sessionId: string, surface: 'page' | 'widget' }>('eventa:invoke:composer:view-recovery')
export const composerEdit = defineInvokeEventa<ComposerSnapshot, ComposerVersion & { draft: ComposerDraft }>('eventa:invoke:composer:edit')
export const composerSubmit = defineInvokeEventa<ComposerSnapshot, ComposerVersion & { commandId: string }>('eventa:invoke:composer:submit')
export const composerSettle = defineInvokeEventa<ComposerSnapshot, ComposerVersion & { commandId: string, consumed: boolean, draft: ComposerDraft }>('eventa:invoke:composer:settle')
export const composerInvalidate = defineInvokeEventa<void, { sourceGeneration: string }>('eventa:invoke:composer:invalidate')
export const composerRequestReturn = defineInvokeEventa<void, ComposerVersion>('eventa:invoke:composer:request-return')
export const composerRelease = defineInvokeEventa<ComposerSnapshot, ComposerVersion>('eventa:invoke:composer:release')
export const composerChanged = defineEventa<ComposerSnapshot>('eventa:event:composer:changed')
export const composerExecute = defineEventa<ComposerSnapshot>('eventa:event:composer:execute')
export const composerFlushAndClose = defineEventa<ComposerSnapshot>('eventa:event:composer:flush-close')
