<script setup lang="ts">
import { isProductAudienceVisible } from '@proj-airi/stage-shared'
import { IconItem } from '@proj-airi/stage-ui/components/menu'
import { Button } from '@proj-airi/ui'
import { storeToRefs } from 'pinia'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

interface SettingsEntry {
  title: string
  description: string
  icon: string
  to: string
}

const router = useRouter()
const { t } = useI18n()
const accountIsAuthenticated = ref(false)
const accountUserEmail = ref<string>()
const accountActivePlan = ref('free')
const accountAvailablePoints = ref(0)
const accountIsLoading = ref(false)
let accountSummaryDisposed = false
const stopAccountSummaryWatches: Array<() => void> = []

const planLabels = computed<Record<string, string>>(() => ({
  creator: t('settings.pages.account.plans.creator'),
  custom: t('settings.pages.account.plans.custom'),
  free: t('settings.pages.account.plans.free'),
  lite: t('settings.pages.account.plans.lite'),
  pro: t('settings.pages.account.plans.pro'),
}))

const activePlanLabel = computed(() => planLabels.value[accountActivePlan.value] ?? accountActivePlan.value)
const accountSummary = computed(() => {
  if (accountIsAuthenticated.value) {
    return t('settings.pages.account.home.signed-in-summary', {
      plan: activePlanLabel.value,
      points: accountAvailablePoints.value,
    })
  }

  return t('settings.pages.account.home.signed-out-summary')
})

const hiddenHomeEntryPaths = new Set([
  '/settings/account',
])

const companionSettingPaths = new Set([
  '/settings/airi-card',
  '/settings/group-scenarios',
  '/settings/speech',
  '/settings/memory',
  '/settings/reply-feedback',
  '/settings/system/quick-chat',
])

const appSettingPaths = new Set([
  '/settings/data',
  '/settings/system',
])

const settings = computed(() => {
  return router
    .getRoutes()
    .filter(route => route.meta?.settingsEntry && !hiddenHomeEntryPaths.has(route.path) && isProductAudienceVisible(route.meta?.productAudience))
    .sort((a, b) => (Number(a.meta?.order ?? 0) - Number(b.meta?.order ?? 0)))
    .map(route => ({
      title: route.meta?.titleKey ? t(route.meta.titleKey as string) : (route.meta?.title as string | undefined) ?? '',
      description: route.meta?.descriptionKey ? t(route.meta.descriptionKey as string) : (route.meta?.description as string | undefined) || '',
      icon: (route.meta?.icon as string | undefined) ?? '',
      to: route.path,
    }))
})

const settingGroups = computed(() => {
  const groups: Array<{
    id: 'companion' | 'app' | 'advanced'
    title: string
    description: string
    icon?: string
    items: SettingsEntry[]
  }> = [
    {
      id: 'companion',
      title: t('settings.pages.home.groups.companion.title'),
      description: t('settings.pages.home.groups.companion.description'),
      items: [],
    },
    {
      id: 'app',
      title: t('settings.pages.home.groups.app.title'),
      description: t('settings.pages.home.groups.app.description'),
      items: [],
    },
    {
      id: 'advanced',
      title: t('settings.pages.home.groups.advanced.title'),
      description: t('settings.pages.home.groups.advanced.description'),
      icon: 'i-solar:settings-minimalistic-bold-duotone',
      items: [],
    },
  ]

  for (const setting of settings.value) {
    if (companionSettingPaths.has(setting.to)) {
      groups[0].items.push(setting)
    }
    else if (appSettingPaths.has(setting.to)) {
      groups[1].items.push(setting)
    }
    else {
      groups[2].items.push(setting)
    }
  }

  return groups.filter(group => group.items.length > 0)
})

function openAccountSettings() {
  void router.push('/settings/account')
}

function afterFirstPaint(callback: () => void) {
  if (typeof window === 'undefined') {
    callback()
    return
  }

  window.requestAnimationFrame(() => {
    const idleWindow = window as Window & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number
    }

    if (idleWindow.requestIdleCallback) {
      idleWindow.requestIdleCallback(callback, { timeout: 1000 })
      return
    }

    window.setTimeout(callback, 0)
  })
}

async function loadAccountSummary() {
  const [{ useAuthStore }, { useCommerceStore }] = await Promise.all([
    import('@proj-airi/stage-ui/stores/auth'),
    import('@proj-airi/stage-ui/stores/commerce'),
  ])

  if (accountSummaryDisposed)
    return

  const authStore = useAuthStore()
  const commerceStore = useCommerceStore()
  const { isAuthenticated, user } = storeToRefs(authStore)
  const { activePlan, availablePoints, isLoading } = storeToRefs(commerceStore)

  stopAccountSummaryWatches.push(watch(
    [isAuthenticated, () => user.value?.email, activePlan, availablePoints, isLoading],
    ([authenticated, email, plan, points, loading]) => {
      accountIsAuthenticated.value = authenticated
      accountUserEmail.value = email
      accountActivePlan.value = plan
      accountAvailablePoints.value = points
      accountIsLoading.value = loading
    },
    { immediate: true },
  ))

  stopAccountSummaryWatches.push(watch(isAuthenticated, (authenticated) => {
    if (!authenticated) {
      commerceStore.reset()
      return
    }

    void commerceStore.fetchAccountState().catch(() => {})
  }, { immediate: true }))
}

onMounted(() => {
  afterFirstPaint(() => {
    void loadAccountSummary()
  })
})

onBeforeUnmount(() => {
  accountSummaryDisposed = true
  for (const stop of stopAccountSummaryWatches)
    stop()
  stopAccountSummaryWatches.length = 0
})
</script>

<template>
  <div data-airi-runtime-route="/settings" flex="~ col gap-4" font-normal>
    <div />
    <div flex="~ col gap-4" pb-12>
      <section
        v-motion
        :initial="{ opacity: 0, y: 10 }"
        :enter="{ opacity: 1, y: 0 }"
        :duration="250"
        :class="[
          'overflow-hidden rounded-xl border border-primary-200/50 bg-primary-50/72 p-4 shadow-sm',
          'dark:border-primary-900/45 dark:bg-primary-950/24',
        ]"
      >
        <div :class="['grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_auto] md:items-center']">
          <div :class="['min-w-0']">
            <div :class="['mb-2 flex items-center gap-2']">
              <div :class="['i-solar:wallet-money-bold-duotone text-2xl text-primary-500']" />
              <div :class="['text-base font-medium text-neutral-950 dark:text-neutral-50']">
                {{ t('settings.pages.account.home.title') }}
              </div>
            </div>
            <p :class="['max-w-2xl text-sm leading-6 text-neutral-700 dark:text-neutral-300']">
              {{ accountSummary }}
            </p>
            <p v-if="accountIsAuthenticated && accountUserEmail" :class="['mt-1 text-xs text-neutral-500 dark:text-neutral-400']">
              {{ accountUserEmail }}
            </p>
          </div>

          <div :class="['flex flex-wrap items-center gap-2 md:justify-end']">
            <div :class="['rounded-lg border border-white/70 bg-white/75 px-3 py-2 dark:border-white/10 dark:bg-white/8']">
              <div :class="['text-[11px] text-neutral-500 dark:text-neutral-400']">
                {{ t('settings.pages.account.sections.plan.title') }}
              </div>
              <div :class="['text-sm font-semibold text-neutral-950 dark:text-neutral-50']">
                {{ activePlanLabel }}
              </div>
            </div>

            <div :class="['rounded-lg border border-white/70 bg-white/75 px-3 py-2 dark:border-white/10 dark:bg-white/8']">
              <div :class="['text-[11px] text-neutral-500 dark:text-neutral-400']">
                {{ t('settings.pages.account.sections.points.title') }}
              </div>
              <div :class="['text-sm font-semibold text-neutral-950 dark:text-neutral-50']">
                {{ accountAvailablePoints }}
              </div>
            </div>

            <Button
              size="sm"
              variant="primary"
              icon="i-solar:arrow-right-up-bold"
              :class="['shadow-sm shadow-black/5 dark:shadow-none']"
              :loading="accountIsLoading"
              @click="openAccountSettings"
            >
              {{ accountIsAuthenticated ? t('settings.pages.account.home.action') : t('settings.pages.account.home.login-action') }}
            </Button>
          </div>
        </div>
      </section>

      <section
        v-for="(group, groupIndex) in settingGroups"
        :key="group.id"
        :class="['flex flex-col gap-2']"
      >
        <div :class="['px-1']">
          <h2 :class="['flex items-center gap-1.5 text-sm font-medium text-neutral-950 dark:text-neutral-50']">
            <span
              v-if="group.id === 'advanced' && group.icon"
              :class="['i-solar:settings-minimalistic-bold-duotone size-4 text-primary-500']"
            />
            {{ group.title }}
          </h2>
          <p :class="['mt-0.5 text-xs leading-5 text-neutral-500 dark:text-neutral-400']">
            {{ group.description }}
          </p>
        </div>

        <IconItem
          v-for="(setting, index) in group.items"
          :key="setting.to"
          v-motion
          :initial="{ opacity: 0, y: 10 }"
          :enter="{ opacity: 1, y: 0 }"
          :duration="250"
          :style="{
            transitionDelay: `${(groupIndex + index) * 50}ms`, // delay between each item, unocss doesn't support dynamic generation of classes now
          }"
          :title="setting.title"
          :description="setting.description"
          :icon="setting.icon"
          :to="setting.to"
        />
      </section>
    </div>
    <div
      v-motion
      text="neutral-200/50 dark:neutral-600/20" pointer-events-none
      fixed top="[calc(100dvh-12rem)]" bottom-0 right--10 z--1
      :initial="{ scale: 0.9, opacity: 0, rotate: 180 }"
      :enter="{ scale: 1, opacity: 1, rotate: 0 }"
      :duration="500"
      size-60
      flex items-center justify-center
    >
      <div v-motion text="60" i-solar:settings-bold-duotone />
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.title
  stageTransition:
    name: slide
</route>
