<script setup lang="ts">
import { SERVER_URL } from '@proj-airi/stage-ui/libs/auth'
import { ref } from 'vue'

interface CharacterOption {
  id: string
  avatarUrl?: string | null
  coverUrl?: string | null
  i18n?: Array<{ name: string }>
}

defineProps<{
  characters: CharacterOption[]
  selectedId: string
  disabled?: boolean
}>()

const emit = defineEmits<{
  select: [id: string]
}>()

const failedImages = ref<string[]>([])

function imageFor(character: CharacterOption) {
  const source = character.avatarUrl || character.coverUrl
  if (!source || failedImages.value.includes(character.id))
    return ''
  try {
    return new URL(source, SERVER_URL).toString()
  }
  catch {
    return ''
  }
}

function nameFor(character: CharacterOption) {
  return character.i18n?.[0]?.name || '未命名人格'
}
</script>

<template>
  <div v-if="characters.length" class="flex gap-2 overflow-x-auto pb-1" role="group" aria-label="选择角色卡">
    <button
      v-for="character in characters"
      :key="character.id"
      type="button"
      :disabled="disabled"
      :aria-pressed="selectedId === character.id"
      :aria-label="`${nameFor(character)}${selectedId === character.id ? '，已选中' : ''}`"
      class="max-w-48 min-w-38 flex flex-1 items-center gap-2.5 border rounded-2xl p-2 text-left transition-colors disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-sky-500"
      :class="selectedId === character.id ? 'border-sky-500 bg-sky-50 text-sky-950 shadow-sm dark:border-sky-400 dark:bg-sky-400/15 dark:text-white' : 'border-neutral-200 bg-white/60 hover:border-neutral-300 hover:bg-white dark:border-white/10 dark:bg-white/5 dark:hover:border-white/25'"
      @click="emit('select', character.id)"
    >
      <img
        v-if="imageFor(character)"
        :src="imageFor(character)"
        alt=""
        class="size-11 shrink-0 rounded-xl object-cover"
        @error="failedImages.push(character.id)"
      >
      <span v-else class="size-11 flex shrink-0 items-center justify-center rounded-xl bg-neutral-100 text-lg text-neutral-500 font-semibold dark:bg-white/10 dark:text-neutral-300">
        {{ nameFor(character).slice(0, 1) }}
      </span>
      <span class="min-w-0 flex-1">
        <span class="block truncate text-sm font-semibold">{{ nameFor(character) }}</span>
        <span class="block text-xs opacity-65">{{ selectedId === character.id ? '当前选择' : '选择此角色' }}</span>
      </span>
      <span v-if="selectedId === character.id" class="i-solar:check-circle-bold size-4 shrink-0 text-sky-600 dark:text-sky-300" aria-hidden="true" />
    </button>
  </div>
  <p v-else class="rounded-xl bg-neutral-100 px-3 py-3 text-xs text-neutral-600 dark:bg-white/5 dark:text-neutral-300">
    暂无可用角色卡。请先创建角色，再绑定 QQ 小号。
  </p>
</template>
