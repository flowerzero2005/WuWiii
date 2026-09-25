<script setup lang="ts">
import type { TTSInputChunk } from '../../../utils/tts'

import { createQueue } from '@proj-airi/stream-kit'
import { Button } from '@proj-airi/ui'
import { animate } from 'animejs'
import { ref } from 'vue'

import { useAudioContext } from '../../../stores/audio'
import { chunkTTSInput } from '../../../utils/tts'

const props = defineProps<{
  text: string
  // Provider-specific handlers (provided from parent)
  generateSpeech: (input: string, voice: string, useSSML: boolean) => Promise<ArrayBuffer>
  voice: string
}>()

const { audioContext } = useAudioContext()
const nowSpeaking = ref(false)
const ttsInputChunks = ref<TTSInputChunk[]>([])
const speechGenerationIndex = ref(-1)

const audioQueue = createQueue<{ audioBuffer: AudioBuffer, text: string }>({
  handlers: [
    (ctx) => {
      return new Promise((resolve) => {
        const source = audioContext.createBufferSource()
        source.buffer = ctx.data.audioBuffer
        source.connect(audioContext.destination)

        nowSpeaking.value = true
        source.start(0)
        source.onended = () => {
          nowSpeaking.value = false
          resolve()
        }
      })
    },
  ],
})

async function handleSpeechGeneration(ctx: { data: string }) {
  speechGenerationIndex.value++

  try {
    const input = ctx.data

    const res = await props.generateSpeech(input, props.voice, false)

    const audioBuffer = await audioContext.decodeAudioData(res)
    audioQueue.enqueue({ audioBuffer, text: ctx.data })
  }
  catch (error) {
    console.error('Speech generation failed:', error)
  }
}

const ttsQueue = createQueue<string>({ handlers: [handleSpeechGeneration] })
const chunkCardClass = [
  'flex flex-row items-center gap-2 rounded-xl border border-solid px-2 py-1.5',
]

async function testStreaming() {
  speechGenerationIndex.value = -1
  for await (const chunk of chunkTTSInput(props.text, { boost: 1, minimumWords: 4, maximumWords: 12 })) {
    if (!chunk.text)
      continue
    ttsQueue.enqueue(chunk.text)
  }
}

async function testChunking() {
  const chunks: TTSInputChunk[] = []
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(props.text))
      controller.close()
    },
  })

  for await (const chunk of chunkTTSInput(stream.getReader(), { boost: 1, minimumWords: 4, maximumWords: 12 })) {
    chunks.push(chunk)
  }

  ttsInputChunks.value = chunks
}
</script>

<template>
  <div :class="['flex items-center gap-1 text-sm airi-text font-medium']">
    Streaming Playground
  </div>
  <div flex="~ row" gap-4>
    <Button @click="testChunking">
      <div flex="~ row" items-center gap-2>
        <div i-solar:round-double-alt-arrow-right-bold-duotone />
        <span>Test chunking</span>
      </div>
    </Button>

    <Button
      v-if="ttsInputChunks.length > 0"
      @click="testStreaming"
    >
      <div flex="~ row" items-center gap-2>
        <div i-solar:round-double-alt-arrow-right-bold-duotone />
        <span>Test streaming</span>
      </div>
    </Button>
  </div>

  <div flex="~ col gap-2 items-start" py-4>
    <div
      v-for="(chunk, i) in ttsInputChunks"
      :key="i"
      flex="~ row gap-2 items-center"
    >
      <div
        :class="[
          chunkCardClass,
          {
            'border-[var(--airi-border-subtle)] bg-[var(--airi-surface-control-muted)] airi-text-muted': speechGenerationIndex < i,
            'border-[var(--airi-border-accent)] bg-[var(--airi-accent-surface)] text-[var(--airi-accent-text)]': speechGenerationIndex >= i,
          },
        ]"
      >
        <span ml-1>{{ chunk.text }}</span>
        <span
          rounded-full px-2 py-.5 text-nowrap text-xs
          b="~ dashed"
          :class="{
            'b-green text-green': chunk.reason === 'boost',
            'b-orange text-orange': chunk.reason === 'limit',
            'b-red text-red': chunk.reason === 'hard',
            'b-purple text-purple': chunk.reason === 'flush',
          }"
        >
          {{ chunk.words }} words,
          {{ chunk.reason }}
        </span>
      </div>
      <Transition
        :css="false"
        @enter="(el) => animate(el, {
          opacity: [0, 1],
          translateX: [10, 0],
          duration: 200,
          ease: 'inOut',
        })"
      >
        <div
          v-if="speechGenerationIndex >= i"
          tag="div"
          :class="['flex flex-row items-center gap-1 text-sm text-[var(--airi-accent-strong)]']"
        >
          <div i-solar-check-circle-line-duotone />
          <div>Queued</div>
        </div>
      </Transition>
    </div>
  </div>
</template>
