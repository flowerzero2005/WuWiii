<script setup lang="ts">
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { PageHeader } from '@proj-airi/stage-ui/components/layouts'
import { useModulesList } from '@proj-airi/stage-ui/composables/use-modules-list'
import { getSettingsSurfaceStyle, useSettingsTheme } from '@proj-airi/stage-ui/stores/settings/theme'
import { useTheme } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterLink, RouterView, useRoute } from 'vue-router'

import WindowTitleBar from '../components/Window/TitleBar.vue'

import { useRestoreScroll } from '../composables/use-restore-scroll'

const route = useRoute()
const { t } = useI18n()
const { modulesList } = useModulesList()
const { isDark } = useTheme()
const { settingsSurfacePreset } = storeToRefs(useSettingsTheme())
const scrollContainer = ref<HTMLElement>()
useRestoreScroll(scrollContainer)

const routeMeta = computed(() => route.meta as {
  titleKey?: string
  subtitleKey?: string
  title?: string
  subtitle?: string
})

const providerTitle = ref<string>()
let providerTitleRequestId = 0

function resolveProviderId(path: string) {
  if (!path.startsWith('/settings/providers/'))
    return undefined

  const segments = path.split('/').filter(Boolean)
  return segments[3]
}

watch(() => route.path, async (path) => {
  const requestId = ++providerTitleRequestId
  const providerId = resolveProviderId(path)
  providerTitle.value = undefined

  if (!providerId)
    return

  try {
    // NOTICE: the providers store imports validators and provider SDK adapters.
    // Load it only on provider detail routes, not for the settings home window.
    const { useProvidersStore } = await import('@proj-airi/stage-ui/stores/providers')
    if (requestId !== providerTitleRequestId)
      return

    const metadata = useProvidersStore().getProviderMetadata(providerId)
    providerTitle.value = t(metadata.nameKey)
  }
  catch {
    providerTitle.value = undefined
  }
}, { immediate: true })

// const activeSettingsTutorial = ref('default')
const routeHeaderMetadata = computed(() => {
  const { titleKey, subtitleKey, title, subtitle } = routeMeta.value
  const resolvedTitle = titleKey ? t(titleKey) : title
  const resolvedSubtitle = subtitleKey ? t(subtitleKey) : subtitle

  if (resolvedTitle || resolvedSubtitle) {
    return {
      title: resolvedTitle,
      subtitle: resolvedSubtitle,
    }
  }

  if (providerTitle.value) {
    return {
      title: providerTitle.value,
      subtitle: t('settings.title'),
    }
  }

  return undefined
})

const moduleShortcuts = computed(() => [
  { icon: 'i-solar:layers-bold-duotone', label: t('settings.pages.modules.title'), to: '/settings/modules' },
  ...modulesList.value.map(module => ({
    icon: module.icon || module.iconColor || 'i-solar:widget-2-bold-duotone',
    label: module.name,
    to: module.to,
  })),
])
const showModuleShortcuts = computed(() => route.path === '/settings/modules' || route.path.startsWith('/settings/modules/'))
const settingsSurfaceStyle = computed(() => getSettingsSurfaceStyle(settingsSurfacePreset.value, isDark.value))
</script>

<template>
  <div
    :class="['h-full w-full flex flex-col font-sans backdrop-blur-md', 'airi-surface-page']"
    :style="settingsSurfaceStyle"
  >
    <WindowTitleBar :title="routeHeaderMetadata?.title ?? ''" icon="i-solar:settings-bold" />
    <div
      :style="{
        paddingTop: `44px`,
        paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        paddingRight: 'env(safe-area-inset-right, 0px)',
        paddingLeft: 'env(safe-area-inset-left, 0px)',
      }"

      min-h-0 flex-1
    >
      <div ref="scrollContainer" relative h-full w-full overflow-y-auto scrollbar-none>
        <div flex="~ col" mx-auto h-full max-w-screen-xl>
          <PageHeader
            :title="routeHeaderMetadata?.title ?? ''"
            :subtitle="routeHeaderMetadata?.subtitle ?? ''"
            :disable-back-button="isStageTamagotchi() && route.path === '/settings'"
            px-4
          />
          <nav
            v-if="showModuleShortcuts"
            :aria-label="t('settings.pages.modules.title')"
            :class="[
              'sticky top-0 z-30 mb-3 overflow-x-auto px-4 py-2 scrollbar-none',
              'backdrop-blur-xl',
            ]"
            :style="{ background: 'var(--airi-surface-panel)' }"
          >
            <div :class="['flex min-w-max items-center gap-1']">
              <RouterLink
                v-for="shortcut in moduleShortcuts"
                :key="shortcut.to"
                :to="shortcut.to"
                :class="[
                  'h-8 flex items-center gap-1.5 rounded-md px-2.5 text-xs font-medium transition-colors',
                  route.path === shortcut.to
                    ? 'bg-[var(--airi-accent-surface)] text-[var(--airi-accent-strong)]'
                    : 'airi-overlay-control-muted',
                ]"
              >
                <span :class="[shortcut.icon, 'size-4 shrink-0']" />
                <span>{{ shortcut.label }}</span>
              </RouterLink>
            </div>
          </nav>
          <div min-h-0 flex-1 px-4>
            <RouterView />
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
