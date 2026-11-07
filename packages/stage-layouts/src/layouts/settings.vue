<script setup lang="ts">
import { PageHeader } from '@proj-airi/stage-ui/components'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { getSettingsSurfaceStyle, useSettingsTheme } from '@proj-airi/stage-ui/stores/settings/theme'
import { useTheme } from '@proj-airi/ui'
import { useMediaQuery } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, nextTick, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { RouterView, useRoute, useRouter } from 'vue-router'

import { themeColorFromValue, useThemeColor } from '../composables/theme-color'

const route = useRoute()
const router = useRouter()
const isMobile = useMediaQuery('(max-width: 767px)')
const { isDark: dark } = useTheme()
const { settingsSurfacePreset } = storeToRefs(useSettingsTheme())
const { t } = useI18n()
const providersStore = useProvidersStore()
const routeMeta = computed(() => route.meta as {
  titleKey?: string
  subtitleKey?: string
  title?: string
  subtitle?: string
})

const providerTitle = computed(() => {
  if (!route.path.startsWith('/settings/providers/'))
    return undefined

  const segments = route.path.split('/').filter(Boolean)
  const providerId = segments[3]

  if (!providerId)
    return undefined

  try {
    const metadata = providersStore.getProviderMetadata(providerId)
    return t(metadata.nameKey)
  }
  catch {
    return undefined
  }
})

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

const { updateThemeColor } = useThemeColor(themeColorFromValue({ light: 'rgb(255 255 255)', dark: 'rgb(18 18 18)' }))
const settingsSurfaceStyle = computed(() => getSettingsSurfaceStyle(settingsSurfacePreset.value, dark.value))
const scrollContainer = ref<HTMLElement>()
const showMemoryScrollbar = computed(() => route.path === '/settings/memory' || route.path === '/settings/modules/memory-long-term')
const settingsBackTo = computed(() => {
  if (route.path.startsWith('/devtools/'))
    return '/settings/system/developer'

  const segments = route.path.split('/').filter(Boolean)
  const routes = router.getRoutes()
  for (let index = segments.length - 1; index > 0; index--) {
    const parent = `/${segments.slice(0, index).join('/')}`
    if (routes.some(candidate => candidate.path === parent))
      return parent
  }
  return '/'
})
watch(dark, () => updateThemeColor(), { immediate: true })
watch(route, () => updateThemeColor(), { immediate: true })
watch(() => route.fullPath, async () => {
  await nextTick()
  scrollContainer.value?.scrollTo({ top: 0, behavior: 'auto' })
})
onMounted(() => updateThemeColor())
</script>

<template>
  <div
    :class="[
      'settings-layout h-full w-full font-sans',
      'airi-surface-page',
    ]"
    :style="{
      ...settingsSurfaceStyle,
      paddingBottom: 'var(--safe-area-inset-bottom, env(safe-area-inset-bottom, 0px))',
      paddingTop: 'var(--safe-area-inset-top, env(safe-area-inset-top, 0px))',
      paddingRight: 'var(--safe-area-inset-right, env(safe-area-inset-right, 0px))',
      paddingLeft: 'var(--safe-area-inset-left, env(safe-area-inset-left, 0px))',
    }"
  >
    <!-- Content -->
    <div class="px-3 py-0 2xl:max-w-screen-2xl xl:px-4" flex="~ col" mx-auto h-full min-h-0>
      <PageHeader
        class="settings-page-header"
        :title="routeHeaderMetadata?.title || ''"
        :subtitle="routeHeaderMetadata?.subtitle"
        :disable-back-button="route.path === '/settings' && !isMobile"
        :back-to="isMobile ? settingsBackTo : undefined"
      />
      <div ref="scrollContainer" relative min-h-0 flex-1 overflow-y-auto :class="showMemoryScrollbar ? 'settings-memory-scrollbar' : 'scrollbar-none'">
        <RouterView />
      </div>
    </div>
  </div>
</template>

<style scoped>
.settings-memory-scrollbar {
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--airi-text-muted) 65%, transparent) transparent;
}

.settings-memory-scrollbar::-webkit-scrollbar {
  width: 10px;
}

.settings-memory-scrollbar::-webkit-scrollbar-thumb {
  border: 2px solid transparent;
  border-radius: 999px;
  background: color-mix(in srgb, var(--airi-text-muted) 65%, transparent);
  background-clip: padding-box;
}
</style>
