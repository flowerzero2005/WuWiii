<script setup lang="ts">
import type { OfficialVoiceCatalogView, OfficialVoiceChannel } from '@proj-airi/stage-ui/stores/settings/official-voice-catalog'

import { useSpeechStore } from '@proj-airi/stage-ui/stores/modules/speech'
import { useOfficialPricingStore } from '@proj-airi/stage-ui/stores/official-pricing'
import { filterOfficialVoices, useOfficialVoiceCatalogStore } from '@proj-airi/stage-ui/stores/settings/official-voice-catalog'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

const { t } = useI18n()
const speechStore = useSpeechStore()
const pricingStore = useOfficialPricingStore()
const catalogStore = useOfficialVoiceCatalogStore()
const { activeSpeechVoiceId, availableVoices, isLoadingSpeechProviderVoices, speechProviderError } = storeToRefs(speechStore)
const { favoriteIds, recentIds } = storeToRefs(catalogStore)
const query = ref('')
const language = ref('')
const view = ref<OfficialVoiceCatalogView>('recommended')
const channel = ref<OfficialVoiceChannel>('primary')
const selectingId = ref('')
const previewingId = ref('')
const visibleCount = ref(12)
let previewAudio: HTMLAudioElement | undefined
let catalogRefreshTimer: ReturnType<typeof setInterval> | undefined

const voices = computed(() => availableVoices.value['official-cloud-speech'] ?? [])
const languageOptions = computed(() => [...new Set(voices.value.flatMap(voice => voice.languages.map(item => item.code)))])
const filteredVoices = computed(() => filterOfficialVoices(voices.value, {
  channel: channel.value,
  favoriteIds: favoriteIds.value,
  language: language.value,
  query: query.value,
  recentIds: recentIds.value,
  view: view.value,
}))
const visibleVoices = computed(() => filteredVoices.value.slice(0, visibleCount.value))
const currentVoice = computed(() => voices.value.find(voice => voice.id === activeSpeechVoiceId.value))
const tabs: OfficialVoiceCatalogView[] = ['recommended', 'all', 'favorites', 'recent']
const channels: OfficialVoiceChannel[] = ['primary', 'secondary']

function chainPricing(channel: OfficialVoiceChannel) {
  return pricingStore.getCapability('speech')?.chains.find(item => item.channel === channel)
}

function voiceChannel(voice: { officialChannel?: OfficialVoiceChannel }) {
  return voice.officialChannel ?? 'primary'
}

function voicePointsPerMinute(voice: { officialChannel?: OfficialVoiceChannel, pointsPerMinute?: number }) {
  return chainPricing(voiceChannel(voice))?.pointsPerMinute ?? voice.pointsPerMinute
}

function voiceMinimumBasePoints(voice: { minimumBasePoints?: number, officialChannel?: OfficialVoiceChannel }) {
  return chainPricing(voiceChannel(voice))?.minimumBasePoints ?? voice.minimumBasePoints
}

function voiceChannelStatus(voice: { officialChannel?: OfficialVoiceChannel, officialChannelStatus?: string }) {
  return chainPricing(voiceChannel(voice))?.state ?? voice.officialChannelStatus
}

async function refreshCatalog() {
  await speechStore.loadVoicesForProvider('official-cloud-speech', { background: true })
}

const onWindowFocus = () => void refreshCatalog()
function onVisibilityChange() {
  if (document.visibilityState === 'visible')
    void refreshCatalog()
}

onMounted(() => {
  pricingStore.start()
  void refreshCatalog()
  catalogRefreshTimer = setInterval(() => void refreshCatalog(), 60_000)
  window.addEventListener('focus', onWindowFocus)
  document.addEventListener('visibilitychange', onVisibilityChange)
})
onBeforeUnmount(() => {
  pricingStore.stop()
  previewAudio?.pause()
  if (catalogRefreshTimer)
    clearInterval(catalogRefreshTimer)
  window.removeEventListener('focus', onWindowFocus)
  document.removeEventListener('visibilitychange', onVisibilityChange)
})
watch([channel, view, language, query], () => visibleCount.value = 12)

async function previewVoice(voiceId: string, previewURL?: string) {
  if (!previewURL)
    return
  previewAudio?.pause()
  previewAudio = new Audio(previewURL)
  previewingId.value = voiceId
  previewAudio.onended = () => previewingId.value = ''
  previewAudio.onerror = () => {
    previewingId.value = ''
    toast.error(t('tamagotchi.settings.pages.official-voices.preview-error'), { duration: 1500 })
  }
  try {
    await previewAudio.play()
  }
  catch {
    previewingId.value = ''
  }
}

async function selectVoice(voiceId: string) {
  selectingId.value = voiceId
  try {
    if (!await speechStore.selectOfficialVoice(voiceId, language.value || undefined)) {
      toast.error(t('tamagotchi.settings.pages.official-voices.unavailable'), { duration: 1500 })
      return
    }
    catalogStore.remember(voiceId)
    toast.success(t('tamagotchi.settings.pages.official-voices.selected'), { duration: 1500 })
  }
  finally {
    selectingId.value = ''
  }
}

function formatPoints(points: number | undefined) {
  return Number.isSafeInteger(points) ? String(points) : '—'
}
</script>

<template>
  <div :class="['mx-auto flex w-full max-w-5xl flex-col gap-4 pb-12']">
    <div :class="['flex flex-col gap-3 border-b pb-4 airi-border-subtle']">
      <div :class="['inline-flex w-fit gap-1 rounded-md p-1 airi-surface-muted']">
        <button
          v-for="item in channels"
          :key="item"
          type="button"
          :class="['h-8 rounded px-3 text-sm', channel === item ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted']"
          @click="channel = item"
        >
          {{ t(`tamagotchi.settings.pages.official-voices.channels.${item}`) }}
        </button>
      </div>
      <div v-if="currentVoice" :class="['flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs airi-border-subtle airi-surface-panel']">
        <span :class="['font-medium airi-text']">{{ t('tamagotchi.settings.pages.official-voices.current') }}</span>
        <span>{{ currentVoice.name }}</span>
        <span :class="['rounded px-1.5 py-0.5 airi-surface-muted']">
          {{ t(`tamagotchi.settings.pages.official-voices.channels.${currentVoice.officialChannel ?? 'primary'}`) }}
        </span>
        <span :class="['rounded px-1.5 py-0.5 airi-status-info']">
          {{ t('tamagotchi.settings.pages.official-voices.billing-rule', {
            points: formatPoints(voicePointsPerMinute(currentVoice)),
            minimum: formatPoints(voiceMinimumBasePoints(currentVoice)),
            surcharge: formatPoints(currentVoice.pointSurcharge),
          }) }}
        </span>
      </div>
      <div :class="['flex flex-wrap items-center gap-2']">
        <button
          v-for="tab in tabs"
          :key="tab"
          type="button"
          :class="[
            'h-8 rounded-md px-3 text-sm transition-colors',
            view === tab ? 'airi-overlay-control-primary' : 'airi-overlay-control-muted',
          ]"
          @click="view = tab"
        >
          {{ t(`tamagotchi.settings.pages.official-voices.views.${tab}`) }}
        </button>
      </div>
      <div :class="['grid gap-2 sm:grid-cols-[minmax(0,1fr)_12rem]']">
        <label :class="['relative']">
          <span :class="['i-solar:magnifer-outline pointer-events-none absolute left-3 top-2.5 size-4 airi-text-muted']" />
          <input v-model="query" type="search" :placeholder="t('tamagotchi.settings.pages.official-voices.search')" :class="['h-9 w-full rounded-md border bg-transparent pl-9 pr-3 text-sm airi-border-subtle']">
        </label>
        <select v-model="language" :class="['h-9 rounded-md border bg-transparent px-3 text-sm airi-border-subtle']">
          <option value="">
            {{ t('tamagotchi.settings.pages.official-voices.all-languages') }}
          </option>
          <option v-for="code in languageOptions" :key="code" :value="code">
            {{ code }}
          </option>
        </select>
      </div>
    </div>

    <p v-if="isLoadingSpeechProviderVoices" role="status" :class="['py-8 text-center text-sm airi-text-muted']">
      {{ t('tamagotchi.settings.pages.official-voices.loading') }}
    </p>
    <div v-else-if="speechProviderError" role="alert" :class="['rounded-md border p-3 text-sm airi-status-warning']">
      {{ t('tamagotchi.settings.pages.official-voices.load-error') }}
    </div>
    <p v-else-if="filteredVoices.length === 0" :class="['py-8 text-center text-sm airi-text-muted']">
      {{ t('tamagotchi.settings.pages.official-voices.empty') }}
    </p>
    <div v-else :class="['grid gap-2 md:grid-cols-2']">
      <article v-for="voice in visibleVoices" :key="`${voice.officialChannel}:${voice.id}`" :class="['flex min-h-36 flex-col justify-between gap-3 rounded-md border p-4 airi-border-subtle airi-surface-panel']">
        <div>
          <div :class="['flex items-start justify-between gap-3']">
            <div>
              <div :class="['flex flex-wrap items-center gap-1.5']">
                <h3 :class="['text-sm font-semibold']">
                  {{ voice.name }}
                </h3>
                <span :class="['rounded px-1.5 py-0.5 text-xs airi-surface-muted']">
                  {{ t(`tamagotchi.settings.pages.official-voices.channels.${voice.officialChannel ?? 'primary'}`) }}
                </span>
              </div>
              <p :class="['mt-1 text-xs airi-text-muted']">
                {{ voice.description }}
              </p>
            </div>
            <button type="button" :title="t('tamagotchi.settings.pages.official-voices.favorite')" :aria-pressed="favoriteIds.includes(voice.id)" :class="['size-8 grid shrink-0 place-items-center rounded-md airi-overlay-control-muted']" @click="catalogStore.toggleFavorite(voice.id)">
              <span :class="[favoriteIds.includes(voice.id) ? 'i-solar:star-bold' : 'i-solar:star-outline', 'size-4']" />
            </button>
          </div>
          <div :class="['mt-2 flex flex-wrap gap-1']">
            <span v-for="item in voice.languages" :key="item.code" :class="['rounded px-1.5 py-0.5 text-xs airi-surface-muted']">{{ item.code }}</span>
            <span v-if="voiceChannelStatus(voice)" :class="['rounded px-1.5 py-0.5 text-xs airi-surface-muted']">
              {{ t(`tamagotchi.settings.pages.official-voices.statuses.${voiceChannelStatus(voice)}`) }}
            </span>
          </div>
          <div :class="['mt-3 grid gap-1 rounded-md px-2.5 py-2 text-xs airi-surface-muted']">
            <div :class="['flex items-center justify-between gap-3']">
              <span :class="['airi-text-muted']">{{ t('tamagotchi.settings.pages.official-voices.per-minute') }}</span>
              <span :class="['font-medium airi-text']">{{ t('tamagotchi.settings.pages.official-voices.points-per-minute', { points: formatPoints(voicePointsPerMinute(voice)) }) }}</span>
            </div>
            <div :class="['flex items-center justify-between gap-3 airi-text-muted']">
              <span>{{ t('tamagotchi.settings.pages.official-voices.minimum-base') }}</span>
              <span>{{ t('tamagotchi.settings.pages.official-voices.points-value', { points: formatPoints(voiceMinimumBasePoints(voice)) }) }}</span>
            </div>
            <div :class="['flex items-center justify-between gap-3 airi-text-muted']">
              <span>{{ t('tamagotchi.settings.pages.official-voices.per-use-surcharge') }}</span>
              <span>{{ t('tamagotchi.settings.pages.official-voices.points-per-use', { points: formatPoints(voice.pointSurcharge) }) }}</span>
            </div>
          </div>
        </div>
        <div :class="['grid gap-2', voice.previewURL ? 'grid-cols-[auto_minmax(0,1fr)]' : 'grid-cols-1']">
          <button v-if="voice.previewURL" type="button" :title="t('tamagotchi.settings.pages.official-voices.preview')" :class="['size-8 grid place-items-center rounded-md airi-overlay-control-muted']" @click="previewVoice(voice.id, voice.previewURL)">
            <span :class="[previewingId === voice.id ? 'i-solar:pause-outline' : 'i-solar:play-outline', 'size-4']" />
          </button>
          <button type="button" :disabled="selectingId === voice.id || activeSpeechVoiceId === voice.id" :class="['h-8 rounded-md px-3 text-sm airi-overlay-control-primary disabled:opacity-50']" @click="selectVoice(voice.id)">
            {{ activeSpeechVoiceId === voice.id ? t('tamagotchi.settings.pages.official-voices.in-use') : t('tamagotchi.settings.pages.official-voices.use') }}
          </button>
        </div>
      </article>
    </div>
    <button v-if="visibleVoices.length < filteredVoices.length" type="button" :class="['mx-auto h-9 rounded-md px-4 text-sm airi-overlay-control-muted']" @click="visibleCount += 12">
      {{ t('tamagotchi.settings.pages.official-voices.load-more') }}
    </button>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: tamagotchi.settings.pages.official-voices.title
  descriptionKey: tamagotchi.settings.pages.official-voices.description
  subtitleKey: tamagotchi.settings.pages.speech.title
  icon: i-solar:music-library-2-bold-duotone
  stageTransition:
    name: slide
</route>
