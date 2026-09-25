import type {
  TtsChunkItem,
  TtsInputChunk,
  TtsInputChunkOptions,
} from '@proj-airi/pipelines-audio'
import type { ReaderLike } from 'clustr'

import {
  chunkEmitter as chunkTtsEmitter,
  chunkTtsInput,
  TTS_FLUSH_INSTRUCTION,
  TTS_SPECIAL_TOKEN,
} from '@proj-airi/pipelines-audio'

export { TTS_FLUSH_INSTRUCTION, TTS_SPECIAL_TOKEN }

export type TTSInputChunk = TtsInputChunk
export type TTSInputChunkOptions = TtsInputChunkOptions

// Backward-compatible public shape for @proj-airi/stage-ui/utils/tts.
export interface TTSChunkItem {
  chunk: string
  special: string | null
}

export function chunkTTSInput(
  input: string | ReaderLike,
  options?: TTSInputChunkOptions,
): AsyncGenerator<TTSInputChunk, void, unknown> {
  return chunkTtsInput(input, options)
}

export async function chunkEmitter(
  reader: ReaderLike,
  pendingSpecials: string[],
  handler: (ttsSegment: TTSChunkItem) => Promise<void> | void,
) {
  await chunkTtsEmitter(reader, pendingSpecials, undefined, async (ttsSegment: TtsChunkItem) => {
    await handler({
      chunk: ttsSegment.chunk,
      special: ttsSegment.special,
    })
  })
}
