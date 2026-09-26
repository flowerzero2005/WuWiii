import type { ComposerDetach, ComposerDraft, ComposerSnapshot, ComposerSourceDraft, ComposerVersion } from './detached-composer'
import type { ComposerClientRegion, ComposerPoint } from './detached-composer-geometry'

import { defineEventa, defineInvokeEventa } from '@moeru/eventa'

export const composerDetach = defineInvokeEventa<ComposerSnapshot, ComposerDetach>('eventa:invoke:composer:detach')
export const composerRead = defineInvokeEventa<ComposerSnapshot | undefined>('eventa:invoke:composer:read')
export const composerRecovery = defineInvokeEventa<{ exists: boolean, uncertain: boolean, version: number, draft?: ComposerDraft }, { userScope: string, sessionId: string, surface: 'page' | 'widget' }>('eventa:invoke:composer:recovery')
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
export const composerSourceRead = defineInvokeEventa<{ version: number, draft?: ComposerDraft, uncertain: boolean }, Omit<ComposerDetach, 'draft' | 'recover'>>('eventa:invoke:composer:source-read')
export const composerSourceCheckpoint = defineInvokeEventa<{ version: number }, ComposerSourceDraft>('eventa:invoke:composer:source-checkpoint')
export const composerSourceRegion = defineInvokeEventa<void, { sourceGeneration: string, region: ComposerClientRegion }>('eventa:invoke:composer:source-region')
export const composerDragDetach = defineInvokeEventa<ComposerSnapshot, ComposerDetach & { point: ComposerPoint }>('eventa:invoke:composer:drag-detach')
export const composerDragMove = defineInvokeEventa<boolean, ComposerVersion & { origin: ComposerPoint, point: ComposerPoint }>('eventa:invoke:composer:drag-move')
export const composerDragReturn = defineInvokeEventa<boolean, ComposerVersion & { origin?: ComposerPoint, point: ComposerPoint }>('eventa:invoke:composer:drag-return')
export const composerDiscard = defineInvokeEventa<ComposerSnapshot, ComposerVersion>('eventa:invoke:composer:discard')
export const composerFlushSource = defineEventa<{ sourceGeneration: string }>('eventa:event:composer:flush-source')
export const composerSourceCloseAck = defineInvokeEventa<void, { sourceGeneration: string }>('eventa:invoke:composer:source-close-ack')
export const composerDraftDiscarded = defineEventa<{ userScope: string, sessionId: string, surface: 'page' | 'widget', version: number }>('eventa:event:composer:draft-discarded')
export const composerSourceSubmit = defineInvokeEventa<ComposerSnapshot, ComposerSourceDraft & { commandId: string }>('eventa:invoke:composer:source-submit')
