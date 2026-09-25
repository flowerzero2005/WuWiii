<script setup lang="ts">
import { useElectronEventaInvoke, useElectronMouseInElement, useElectronWindowMove } from '@proj-airi/electron-vueuse'
import { isProductAudienceVisible } from '@proj-airi/stage-shared'
import { createTurtleSoupLaunchUrl } from '@proj-airi/stage-ui/libs/auth'
import { useSettingsAudioDevice } from '@proj-airi/stage-ui/stores/settings/audio-device'
import { useSettingsControlsIsland } from '@proj-airi/stage-ui/stores/settings/controls-island'
import { useTheme } from '@proj-airi/ui'
import { refDebounced, useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import ControlButtonTooltip from './control-button-tooltip.vue'
import ControlButton from './control-button.vue'
import ControlsIslandFadeOnHover from './controls-island-fade-on-hover.vue'
import ControlsIslandHearingConfig from './controls-island-hearing-config.vue'
import ControlsIslandMouseMode from './controls-island-mouse-mode.vue'
import IndicatorMicVolume from './indicator-mic-volume.vue'

import {
  butlerOpenWindow,
  electronOpenChat,
  electronOpenSettings,
  electronWindowClose,
  quickChatOpenWindow,
} from '../../../../shared/eventa'
import { useButlerTasksStore } from '../../../stores/butler-tasks'

const { isDark, toggleDark } = useTheme()
const { t } = useI18n()

const settingsAudioDeviceStore = useSettingsAudioDevice()
const settingsControlsIslandStore = useSettingsControlsIsland()
const butlerTasksStore = useButlerTasksStore()
const { enabled } = storeToRefs(settingsAudioDeviceStore)
const { controlsIslandIconSize } = storeToRefs(settingsControlsIslandStore)
const { openTasks } = storeToRefs(butlerTasksStore)
const openSettings = useElectronEventaInvoke(electronOpenSettings)
const openChat = useElectronEventaInvoke(electronOpenChat)
const openQuickChatWindow = useElectronEventaInvoke(quickChatOpenWindow)
const openButlerWindow = useElectronEventaInvoke(butlerOpenWindow)
const closeWindow = useElectronEventaInvoke(electronWindowClose)
const { handleMoveStart, isWindowsPlatform } = useElectronWindowMove()
const shouldShowAdvancedControls = computed(() => isProductAudienceVisible('advanced'))
const butlerTaskCountLabel = computed(() => {
  return openTasks.value.length > 99 ? '99+' : String(openTasks.value.length)
})
const controlIconClass = 'text-[var(--airi-text-muted)]'

const expanded = ref(false)
const islandRef = ref<HTMLElement>()

const { isOutside } = useElectronMouseInElement(islandRef)
const isOutsideAfter2seconds = refDebounced(isOutside, 1500)

watch(isOutsideAfter2seconds, (outside) => {
  if (outside && expanded.value) {
    expanded.value = false
  }
})

useIntervalFn(() => {
  if (expanded.value && isOutside.value) {
    expanded.value = false
  }
}, 1500)

// Grouped classes for icon / border / padding and combined style class
const adjustStyleClasses = computed(() => {
  let isLarge: boolean

  // Determine size based on setting
  switch (controlsIslandIconSize.value) {
    case 'large':
      isLarge = true
      break
    case 'small':
      isLarge = false
      break
    case 'auto':
    default:
      // Fixed to large for better visibility in the new layout,
      // can be changed to windowHeight based check if absolutely needed.
      isLarge = true
      break
  }

  const icon = isLarge ? 'size-5' : 'size-3'
  const border = isLarge ? 'border-2' : 'border-0'
  const padding = isLarge ? 'p-2' : 'p-0.5'
  return { icon, border, padding, button: `${border} ${padding}` }
})

// Expose whether hearing dialog is open so parent can disable click-through
const hearingDialogOpen = ref(false)
const shouldShowDockControls = computed(() => expanded.value || hearingDialogOpen.value || !isOutside.value)
// Expose expanded state so parent can disable click-through when menu is open
defineExpose({ hearingDialogOpen, expanded })

function refreshWindow() {
  window.location.reload()
}

async function handleOpenTurtleSoup() {
  expanded.value = false
  window.open(await createTurtleSoupLaunchUrl(), '_blank', 'noopener,noreferrer')
}

async function handleOpenSettings() {
  try {
    expanded.value = false
    await openSettings(undefined)
  }
  catch (error) {
    console.warn('[ControlsIsland] Failed to open settings window:', error)
  }
}

async function handleOpenChat() {
  try {
    expanded.value = false
    await openChat()
  }
  catch (error) {
    console.warn('[ControlsIsland] Failed to open chat window:', error)
  }
}

async function handleOpenQuickChat() {
  try {
    expanded.value = false
    await openQuickChatWindow()
  }
  catch (error) {
    console.warn('[ControlsIsland] Failed to open quick chat window:', error)
  }
}

async function handleOpenButlerTasks() {
  try {
    expanded.value = false
    await openButlerWindow()
  }
  catch (error) {
    console.warn('[ControlsIsland] Failed to open butler window:', error)
  }
}
</script>

<template>
  <div
    ref="islandRef"
    :class="[
      'fixed bottom-2 right-2',
      'transition-all duration-200 ease-out',
      shouldShowDockControls ? 'opacity-100 scale-100' : 'opacity-0 scale-95',
      'focus-within:opacity-100 focus-within:scale-100',
    ]"
  >
    <div flex flex-col items-end gap-1>
      <!-- iOS Style Drawer Panel -->
      <Transition
        enter-active-class="transition-all duration-500 cubic-bezier(0.32, 0.72, 0, 1)"
        leave-active-class="transition-all duration-400 cubic-bezier(0.32, 0.72, 0, 1)"
        enter-from-class="opacity-0 translate-y-8 scale-90 blur-sm"
        leave-to-class="opacity-0 translate-y-8 scale-90 blur-sm"
      >
        <div
          v-if="expanded"
          :class="[
            'mb-2 flex flex-col gap-1 rounded-2xl p-2 backdrop-blur-xl',
            'airi-overlay-glass shadow-2xl shadow-black/10 dark:shadow-none',
          ]"
        >
          <div grid grid-cols-3 gap-2>
            <ControlButtonTooltip>
              <ControlButton :button-style="adjustStyleClasses.button" @click="handleOpenButlerTasks">
                <div class="relative">
                  <div i-solar:clipboard-check-outline :class="[adjustStyleClasses.icon, controlIconClass]" />
                  <span
                    v-if="openTasks.length > 0"
                    class="pointer-events-none absolute min-w-4 border border-[var(--airi-border-accent)] rounded-full bg-[var(--airi-accent-strong)] px-1 text-center text-[10px] text-[var(--airi-surface-page)] font-600 leading-4 shadow-black/10 shadow-sm -right-1 -top-1 dark:shadow-none"
                  >
                    {{ butlerTaskCountLabel }}
                  </span>
                </div>
              </ControlButton>
              <template #tooltip>
                {{ t('tamagotchi.stage.controls-island.open-butler-tasks') }}
              </template>
            </ControlButtonTooltip>

            <ControlButtonTooltip>
              <ControlButton :button-style="adjustStyleClasses.button" @click="handleOpenChat">
                <div i-solar:chat-line-line-duotone :class="[adjustStyleClasses.icon, controlIconClass]" />
              </ControlButton>
              <template #tooltip>
                {{ t('tamagotchi.stage.controls-island.open-chat') }}
              </template>
            </ControlButtonTooltip>

            <ControlButtonTooltip v-if="shouldShowAdvancedControls">
              <ControlButton :button-style="adjustStyleClasses.button" @click="handleOpenQuickChat">
                <div i-ph:chat-centered-dots :class="[adjustStyleClasses.icon, controlIconClass]" />
              </ControlButton>
              <template #tooltip>
                {{ t('tamagotchi.stage.controls-island.open-quick-chat') }}
              </template>
            </ControlButtonTooltip>

            <ControlButtonTooltip>
              <ControlButton :button-style="adjustStyleClasses.button" @click="handleOpenSettings">
                <div i-solar:settings-minimalistic-outline :class="[adjustStyleClasses.icon, controlIconClass]" />
              </ControlButton>
              <template #tooltip>
                {{ t('tamagotchi.stage.controls-island.open-settings') }}
              </template>
            </ControlButtonTooltip>

            <ControlButtonTooltip>
              <ControlButton :button-style="adjustStyleClasses.button" @click="handleOpenTurtleSoup">
                <div i-solar:gamepad-minimalistic-outline :class="[adjustStyleClasses.icon, controlIconClass]" />
              </ControlButton>
              <template #tooltip>
                {{ t('tamagotchi.stage.controls-island.open-turtle-soup') }}
              </template>
            </ControlButtonTooltip>

            <ControlButtonTooltip v-if="shouldShowAdvancedControls">
              <ControlButton :button-style="adjustStyleClasses.button" @click="refreshWindow">
                <div i-solar:refresh-linear :class="[adjustStyleClasses.icon, controlIconClass]" />
              </ControlButton>
              <template #tooltip>
                {{ t('tamagotchi.stage.controls-island.refresh') }}
              </template>
            </ControlButtonTooltip>

            <ControlButtonTooltip>
              <ControlButton :button-style="adjustStyleClasses.button" @click="toggleDark()">
                <Transition name="fade" mode="out-in">
                  <div v-if="isDark" i-solar:moon-outline :class="[adjustStyleClasses.icon, controlIconClass]" />
                  <div v-else i-solar:sun-2-outline :class="[adjustStyleClasses.icon, controlIconClass]" />
                </Transition>
              </ControlButton>
              <template #tooltip>
                {{ isDark ? t('tamagotchi.stage.controls-island.switch-to-light-mode') : t('tamagotchi.stage.controls-island.switch-to-dark-mode') }}
              </template>
            </ControlButtonTooltip>

            <ControlButtonTooltip>
              <ControlsIslandHearingConfig v-model:show="hearingDialogOpen">
                <div class="relative">
                  <ControlButton :button-style="adjustStyleClasses.button">
                    <Transition name="fade" mode="out-in">
                      <IndicatorMicVolume v-if="enabled" :class="adjustStyleClasses.icon" />
                      <div v-else i-ph:microphone-slash :class="[adjustStyleClasses.icon, controlIconClass]" />
                    </Transition>
                  </ControlButton>
                </div>
              </ControlsIslandHearingConfig>
              <template #tooltip>
                {{ t('tamagotchi.stage.controls-island.open-hearing-controls') }}
              </template>
            </ControlButtonTooltip>

            <ControlsIslandFadeOnHover :icon-class="adjustStyleClasses.icon" :button-style="adjustStyleClasses.button" />

            <ControlsIslandMouseMode :icon-class="adjustStyleClasses.icon" :button-style="adjustStyleClasses.button" />

            <ControlButtonTooltip>
              <ControlButton :button-style="adjustStyleClasses.button" class="airi-overlay-control-danger" @click="closeWindow()">
                <div i-solar:close-circle-outline :class="adjustStyleClasses.icon" />
              </ControlButton>
              <template #tooltip>
                {{ t('tamagotchi.stage.controls-island.close') }}
              </template>
            </ControlButtonTooltip>
          </div>
        </div>
      </Transition>

      <!-- Main Controls -->
      <div flex flex-col gap-1>
        <ControlButtonTooltip side="left">
          <ControlButton :button-style="adjustStyleClasses.button" @click="expanded = !expanded">
            <div
              :class="[adjustStyleClasses.icon, expanded ? 'rotate-180' : 'rotate-0']"
              i-solar:alt-arrow-up-line-duotone scale-110 transition-all duration-300
              class="text-[var(--airi-text-muted)]"
            />
          </ControlButton>
          <template #tooltip>
            {{ expanded ? t('tamagotchi.stage.controls-island.collapse') : t('tamagotchi.stage.controls-island.expand') }}
          </template>
        </ControlButtonTooltip>

        <ControlButtonTooltip side="left">
          <ControlButton
            :button-style="adjustStyleClasses.button"
            :class="isWindowsPlatform ? '' : 'drag-region'"
            cursor-move
            @pointerdown="handleMoveStart"
          >
            <div i-ph:arrows-out-cardinal :class="[adjustStyleClasses.icon, controlIconClass]" />
          </ControlButton>
          <template #tooltip>
            {{ t('tamagotchi.stage.controls-island.drag-to-move-window') }}
          </template>
        </ControlButtonTooltip>
      </div>
    </div>
  </div>
</template>
