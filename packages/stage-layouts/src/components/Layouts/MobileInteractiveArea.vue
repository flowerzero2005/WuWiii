<script setup lang="ts">
import type { ChatHistoryItem } from '@proj-airi/stage-ui/types/chat'
import type { ChatProvider } from '@xsai-ext/providers/utils'

import ChatCleanupDialog from '@proj-airi/stage-ui/components/chat-cleanup-dialog'

import { ChatHistory, HearingConfigDialog } from '@proj-airi/stage-ui/components'
import { useAudioAnalyzer } from '@proj-airi/stage-ui/composables'
import { useAudioContext } from '@proj-airi/stage-ui/stores/audio'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatMaintenanceStore } from '@proj-airi/stage-ui/stores/chat/maintenance'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useChatStreamStore } from '@proj-airi/stage-ui/stores/chat/stream-store'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useWebSearchStore } from '@proj-airi/stage-ui/stores/modules/web-search'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useSettings, useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings'
import { getChatErrorMessage } from '@proj-airi/stage-ui/utils'
import { BasicTextarea, useTheme } from '@proj-airi/ui'
import { useResizeObserver, useScreenSafeArea } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onMounted, onUnmounted, ref, useTemplateRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink } from 'vue-router'

import IndicatorMicVolume from '../Widgets/IndicatorMicVolume.vue'
import ActionAbout from './InteractiveArea/Actions/About.vue'
import ActionViewControls from './InteractiveArea/Actions/ViewControls.vue'
import ViewControlInputs from './ViewControls/Inputs.vue'

import { buildWebSearchToolBundles } from '../../utils/chat-web-search-tool-bundles'
import { BackgroundDialogPicker } from '../Backgrounds'

const { isDark, toggleDark } = useTheme()
const hearingDialogOpen = ref(false)
const chatOrchestrator = useChatOrchestratorStore()
const chatSession = useChatSessionStore()
const chatStream = useChatStreamStore()
const { cleanupMessages, cleanupMessagesAndShortTermMemory } = useChatMaintenanceStore()
const { activeSessionId, messages } = storeToRefs(chatSession)
const { streamingMessage, interSegmentPlaceholder } = storeToRefs(chatStream)
const { responding, sending } = storeToRefs(chatOrchestrator)
const historyMessages = computed(() => messages.value as unknown as ChatHistoryItem[])
const canInterrupt = computed(() => sending.value || responding.value)

const viewControlsActiveMode = ref<'x' | 'y' | 'z' | 'scale'>('scale')
const viewControlsInputsRef = useTemplateRef<InstanceType<typeof ViewControlInputs>>('viewControlsInputs')

const messageInput = ref('')
const isComposing = ref(false)
const backgroundDialogOpen = ref(false)
const chatCleanupDialogOpen = ref(false)
const mobileOverlayButtonClass = [
  'w-fit flex items-center self-end justify-center rounded-xl p-2',
  'airi-overlay-glass airi-overlay-control',
]
const mobileOverlayIconClass = 'size-5 airi-text-muted'

const screenSafeArea = useScreenSafeArea()
const providersStore = useProvidersStore()
const { activeProvider, activeModel } = storeToRefs(useConsciousnessStore())
const { enabled: webSearchEnabled } = storeToRefs(useWebSearchStore())

useResizeObserver(document.documentElement, () => screenSafeArea.update())
const { themeColorsHueDynamic, stageViewControlsEnabled } = storeToRefs(useSettings())
const settingsAudioDevice = useSettingsAudioDevice()
const { enabled, selectedAudioInput, stream, audioInputs } = storeToRefs(settingsAudioDevice)
const { ingest, interruptActiveTurn, onAfterMessageComposed } = chatOrchestrator
const { t } = useI18n()
const { audioContext } = useAudioContext()
const { startAnalyzer, stopAnalyzer, volumeLevel } = useAudioAnalyzer()
let analyzerSource: MediaStreamAudioSourceNode | undefined

function isMobileDevice() {
  return /Mobi|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent)
}

async function handleSubmit() {
  if (!isMobileDevice()) {
    await handleSend()
  }
}

async function handleSend() {
  if (!messageInput.value.trim() || isComposing.value) {
    return
  }

  const textToSend = messageInput.value
  messageInput.value = ''

  try {
    const providerConfig = providersStore.getProviderConfig(activeProvider.value)

    const toolBundles = await buildWebSearchToolBundles(textToSend, webSearchEnabled.value)
    await ingest(textToSend, {
      chatProvider: await providersStore.getProviderInstance(activeProvider.value) as ChatProvider,
      model: activeModel.value,
      providerConfig,
      toolBundles,
    })
  }
  catch (error) {
    const errorMessage = getChatErrorMessage(error)

    messageInput.value = textToSend
    messages.value.pop()
    messages.value.push({
      role: 'error',
      content: errorMessage,
    })
  }
}

function handleInterrupt() {
  interruptActiveTurn()
}

function teardownAnalyzer() {
  try {
    analyzerSource?.disconnect()
  }
  catch {}
  analyzerSource = undefined
  stopAnalyzer()
}

async function setupAnalyzer() {
  teardownAnalyzer()
  if (!hearingDialogOpen.value || !enabled.value || !stream.value)
    return
  if (audioContext.state === 'suspended')
    await audioContext.resume()
  const analyser = startAnalyzer(audioContext)
  if (!analyser)
    return
  analyzerSource = audioContext.createMediaStreamSource(stream.value)
  analyzerSource.connect(analyser)
}

watch([hearingDialogOpen, enabled, stream], () => {
  setupAnalyzer()
}, { immediate: true })

watch(hearingDialogOpen, (value) => {
  if (value) {
    settingsAudioDevice.askPermission()
  }
})

onAfterMessageComposed(async () => {
})

onUnmounted(() => {
  teardownAnalyzer()
})

onMounted(() => {
  screenSafeArea.update()
})
</script>

<template>
  <ChatCleanupDialog
    v-model="chatCleanupDialogOpen"
    @clear-messages="cleanupMessages()"
    @clear-messages-and-memory="cleanupMessagesAndShortTermMemory()"
  />
  <div fixed bottom-0 w-full flex flex-col>
    <BackgroundDialogPicker v-model="backgroundDialogOpen" />
    <KeepAlive>
      <Transition name="fade">
        <ChatHistory
          v-if="!stageViewControlsEnabled"
          variant="mobile"
          :messages="historyMessages"
          :sending="sending"
          :inter-segment-placeholder="interSegmentPlaceholder"
          :streaming-message="streamingMessage"
          :session-id="activeSessionId"
          message-deletion-enabled
          max-w="[calc(100%-3.5rem)]"
          w-full self-start pb-3 pl-3
          class="chat-history"
          :class="[
            'relative z-20',
          ]"
        />
      </Transition>
    </KeepAlive>
    <div relative w-full self-end>
      <div top="50%" translate-y="[-50%]" fixed z-15 px-3>
        <ViewControlInputs ref="viewControlsInputs" :mode="viewControlsActiveMode" />
      </div>
      <div translate-y="[-100%]" absolute right-0 w-full px-3 pb-3 font-sans>
        <div flex="~ col" w-full gap-1>
          <ActionAbout />
          <HearingConfigDialog
            v-model:show="hearingDialogOpen"
            v-model:enabled="enabled"
            v-model:selected-audio-input="selectedAudioInput"
            :audio-inputs="audioInputs"
            :volume-level="volumeLevel"
            :granted="true"
          >
            <button
              :class="mobileOverlayButtonClass"
              title="Hearing"
            >
              <Transition name="fade" mode="out-in">
                <IndicatorMicVolume v-if="enabled" size-5 color-class="airi-text-muted" />
                <div v-else :class="['i-solar:microphone-3-outline', mobileOverlayIconClass]" />
              </Transition>
            </button>
          </HearingConfigDialog>
          <button :class="mobileOverlayButtonClass" title="Theme" @click="toggleDark()">
            <Transition name="fade" mode="out-in">
              <div v-if="isDark" :class="['i-solar:moon-outline', mobileOverlayIconClass]" />
              <div v-else :class="['i-solar:sun-2-outline', mobileOverlayIconClass]" />
            </Transition>
          </button>
          <button :class="mobileOverlayButtonClass" title="Background" @click="backgroundDialogOpen = true">
            <div :class="['i-solar:gallery-wide-bold-duotone', mobileOverlayIconClass]" />
          </button>
          <!-- <button :class="mobileOverlayButtonClass" title="Language">
            <div :class="['i-solar:earth-outline', mobileOverlayIconClass]" />
          </button> -->
          <RouterLink to="/settings" :class="mobileOverlayButtonClass" title="Settings">
            <div :class="['i-solar:settings-outline', mobileOverlayIconClass]" />
          </RouterLink>
          <!-- <button :class="mobileOverlayButtonClass" title="Model">
            <div :class="['i-solar:face-scan-circle-outline', mobileOverlayIconClass]" />
          </button> -->
          <ActionViewControls v-model="viewControlsActiveMode" @reset="() => viewControlsInputsRef?.resetOnMode()" />
          <button
            :class="mobileOverlayButtonClass"
            title="Cleanup Messages"
            @click="chatCleanupDialogOpen = true"
          >
            <div :class="['i-solar:trash-bin-2-bold-duotone', mobileOverlayIconClass]" />
          </button>
        </div>
      </div>
      <div
        :class="[
          'max-h-100dvh max-w-100dvw w-full flex gap-1 overflow-auto px-3 pt-2',
          'airi-overlay-glass rounded-t-2xl',
        ]"
        :style="{ paddingBottom: `${Math.max(Number.parseFloat(screenSafeArea.bottom.value.replace('px', '')), 12)}px` }"
      >
        <BasicTextarea
          v-model="messageInput"
          :placeholder="t('stage.message')"
          :class="[
            'max-h-[10lh] min-h-[calc(1lh+4px+4px)] w-full resize-none overflow-y-scroll rounded-[1lh] px-4 py-0.5 font-medium scrollbar-none',
            'airi-overlay-input',
            themeColorsHueDynamic ? 'transition-colors-none placeholder:transition-colors-none' : '',
          ]"
          default-height="1lh"
          @submit="handleSubmit"
          @compositionstart="isComposing = true"
          @compositionend="isComposing = false"
        />
        <button
          v-if="canInterrupt"
          :title="t('stage.actions.interrupt')"
          :aria-label="t('stage.actions.interrupt')"
          :class="[
            'h-[calc(1lh+4px+4px)] w-[calc(1lh+4px+4px)] aspect-square flex items-center self-end justify-center rounded-full backdrop-blur-md transition-transform active:scale-95',
            'airi-overlay-control-danger',
          ]"
          @click="handleInterrupt"
        >
          <div class="i-solar:stop-circle-line-duotone size-4" />
        </button>
        <button
          v-if="messageInput.trim() || isComposing"
          :title="t('stage.actions.send')"
          :aria-label="t('stage.actions.send')"
          :class="[
            'h-[calc(1lh+4px+4px)] w-[calc(1lh+4px+4px)] aspect-square flex items-center self-end justify-center rounded-full backdrop-blur-md transition-transform active:scale-95',
            'airi-overlay-control-primary',
          ]"
          @click="handleSend"
        >
          <div class="i-solar:arrow-up-outline size-4" />
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
@keyframes scan {
  0% {
    transform: translateX(-100%);
  }
  100% {
    transform: translateX(400%);
  }
}

.animate-scan {
  animation: scan 2s infinite linear;
}

/*
DO NOT ATTEMPT TO USE backdrop-filter TOGETHER WITH mask-image.

html - Why doesn't blur backdrop-filter work together with mask-image? - Stack Overflow
https://stackoverflow.com/questions/72780266/why-doesnt-blur-backdrop-filter-work-together-with-mask-image
*/
.chat-history {
  --gradient: linear-gradient(to bottom, rgba(0,0,0,0) 0%, rgba(0,0,0,1) 20%);
  -webkit-mask-image: var(--gradient);
  mask-image: var(--gradient);
  -webkit-mask-size: 100% 100%;
  mask-size: 100% 100%;
  -webkit-mask-repeat: no-repeat;
  mask-repeat: no-repeat;
  -webkit-mask-position: bottom;
  mask-position: bottom;
  max-height: 35dvh;
}
</style>
