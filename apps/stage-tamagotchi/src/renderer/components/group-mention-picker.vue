<script setup lang="ts">
import { PopoverContent, PopoverPortal, PopoverRoot, PopoverTrigger } from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

interface MentionParticipant {
  characterId: string
  displayName: string
}

const props = withDefaults(defineProps<{
  participants: MentionParticipant[]
  selectedIds: string[]
  disabled?: boolean
  placement?: 'top-start' | 'top-end' | 'bottom-start' | 'bottom-end'
  open?: boolean
}>(), {
  disabled: false,
  placement: 'top-start',
  open: false,
})

const emit = defineEmits<{
  (event: 'update:open', value: boolean): void
  (event: 'update:selectedIds', value: string[]): void
  (event: 'confirm', selectedIds: string[]): void
}>()

const { t } = useI18n()
const side = computed(() => props.placement.startsWith('bottom') ? 'bottom' : 'top')
const align = computed(() => props.placement.endsWith('end') ? 'end' : 'start')
const selectionAtOpen = ref<string[]>([...props.selectedIds])
// Keep picker edits local until the user confirms. This prevents an outside
// click/escape from mutating the parent selection without inserting mentions.
const draftSelectedIds = ref<string[]>([...props.selectedIds])

watch(() => props.open, (open) => {
  if (open) {
    selectionAtOpen.value = [...props.selectedIds]
    draftSelectedIds.value = [...props.selectedIds]
  }
})

function toggleParticipant(characterId: string) {
  const selected = !draftSelectedIds.value.includes(characterId)
  draftSelectedIds.value = !selected
    ? draftSelectedIds.value.filter(id => id !== characterId)
    : [...draftSelectedIds.value, characterId]
}

function confirmSelection() {
  const initial = new Set(selectionAtOpen.value)
  const selectedIds = [...draftSelectedIds.value]
  // Return only newly selected members. The parent can safely insert their
  // names without duplicating mentions when the picker is reopened later.
  emit('update:selectedIds', selectedIds)
  emit('confirm', selectedIds.filter(id => !initial.has(id)))
  emit('update:open', false)
}
</script>

<template>
  <PopoverRoot :open="open" @update:open="emit('update:open', $event)">
    <PopoverTrigger as-child>
      <button
        type="button"
        :title="t('stage.chat.group.mention-members')"
        :aria-label="t('stage.chat.group.mention-members')"
        :aria-expanded="open"
        :disabled="disabled"
        :class="[
          '[-webkit-app-region:no-drag] h-9 min-w-9 flex items-center justify-center gap-1 rounded-lg px-2 text-sm outline-none transition-colors active:scale-95',
          open ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted opacity-75',
        ]"
      >
        <span :class="['i-lucide:at-sign size-5 shrink-0']" aria-hidden="true" />
      </button>
    </PopoverTrigger>

    <PopoverPortal>
      <PopoverContent
        :side="side"
        :align="align"
        :side-offset="8"
        :class="[
          'z-40 w-56 rounded-xl border border-[var(--airi-border-subtle)] p-2 shadow-xl outline-none',
          'airi-overlay-glass',
        ]"
      >
        <div :class="['mb-1.5 px-1 text-[11px] text-[var(--airi-text-soft)]']">
          {{ t('stage.chat.group.mention-hint') }}
        </div>
        <button
          v-for="participant in participants"
          :key="participant.characterId"
          type="button"
          :aria-pressed="draftSelectedIds.includes(participant.characterId)"
          :class="[
            'w-full flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors',
            draftSelectedIds.includes(participant.characterId) ? 'airi-overlay-control-primary' : 'hover:bg-[var(--airi-surface-control-muted)]',
          ]"
          @click="toggleParticipant(participant.characterId)"
        >
          <span :class="['truncate']">{{ participant.displayName }}</span>
          <span v-if="draftSelectedIds.includes(participant.characterId)" :class="['i-lucide:check size-3 shrink-0']" />
        </button>
        <button
          type="button"
          :disabled="draftSelectedIds.length === 0"
          :class="[
            'mt-1.5 w-full rounded-md px-2 py-1.5 text-xs font-medium transition-colors',
            draftSelectedIds.length ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted opacity-60',
          ]"
          @click="confirmSelection"
        >
          {{ t('stage.chat.group.mention-confirm') }}
        </button>
      </PopoverContent>
    </PopoverPortal>
  </PopoverRoot>
</template>
