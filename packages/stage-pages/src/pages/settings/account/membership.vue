<script setup lang="ts">
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useCommerceStore } from '@proj-airi/stage-ui/stores/commerce'
import { storeToRefs } from 'pinia'
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'

import CommerceRecharge from './commerce-recharge.vue'

const { t } = useI18n()
const authStore = useAuthStore()
const commerceStore = useCommerceStore()
const { isAuthenticated } = storeToRefs(authStore)
const { activeEntitlements, activePlan, availablePoints, checkInState } = storeToRefs(commerceStore)
const entitlement = computed(() => activeEntitlements.value[0])
const identity = computed(() => t(`settings.pages.account.membership-identities.${activePlan.value === 'custom' ? 'creator' : activePlan.value}`))
const identityTone = computed(() => ({
  creator: 'border-amber-400/50 bg-[linear-gradient(145deg,rgba(245,158,11,0.13),rgba(139,92,246,0.08))] text-amber-700 dark:text-amber-300',
  custom: 'border-amber-400/50 bg-[linear-gradient(145deg,rgba(245,158,11,0.13),rgba(139,92,246,0.08))] text-amber-700 dark:text-amber-300',
  free: 'border-zinc-400/35 bg-zinc-500/7 text-zinc-700 dark:text-zinc-300',
  lite: 'border-emerald-400/40 bg-emerald-500/8 text-emerald-700 dark:text-emerald-300',
  pro: 'border-blue-400/45 bg-blue-500/8 text-blue-700 dark:text-blue-300',
}[activePlan.value]))
const formatNumber = (value = 0) => new Intl.NumberFormat().format(value)
const formatDate = (value?: string | null) => value ? new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value)) : t('settings.pages.account.common.never')

onMounted(() => {
  if (isAuthenticated.value)
    void commerceStore.fetchAccountState()
})
</script>

<template>
  <div :class="['mx-auto flex w-full max-w-6xl flex-col gap-5 px-4 pb-16 sm:px-6']">
    <section :class="['grid overflow-hidden rounded-lg border bg-[var(--airi-surface-field)] shadow-[0_18px_44px_rgba(30,35,45,0.10)] backdrop-blur-xl md:grid-cols-[1fr_auto]', identityTone]">
      <div :class="['p-5 sm:p-6']">
        <div :class="['flex items-center gap-3']">
          <span :class="['grid size-11 place-items-center rounded-md bg-white/55 shadow-sm dark:bg-black/15']"><span :class="['i-ph:crown-duotone size-6']" /></span>
          <div>
            <div :class="['text-xs font-semibold opacity-80']">
              {{ t('settings.pages.account.membership.current') }}
            </div>
            <h1 :class="['text-2xl font-semibold airi-text']">
              {{ identity }}
            </h1>
          </div>
        </div>
        <p :class="['mt-3 text-sm airi-text-muted']">
          {{ t('settings.pages.account.membership.description') }}
        </p>
      </div>
      <dl :class="['grid min-w-72 grid-cols-3 gap-4 border-t border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card)] p-5 md:border-l md:border-t-0']">
        <div>
          <dt :class="['text-xs airi-text-muted']">
            {{ t('settings.pages.account.membership.points') }}
          </dt><dd :class="['mt-1 font-semibold tabular-nums text-sky-700 dark:text-sky-300']">
            {{ formatNumber(availablePoints) }}
          </dd>
        </div>
        <div>
          <dt :class="['text-xs airi-text-muted']">
            {{ t('settings.pages.account.membership.daily') }}
          </dt><dd :class="['mt-1 font-semibold tabular-nums text-emerald-700 dark:text-emerald-300']">
            {{ formatNumber(checkInState?.dailyRewardPoints) }}
          </dd>
        </div>
        <div>
          <dt :class="['text-xs airi-text-muted']">
            {{ t('settings.pages.account.membership.expires') }}
          </dt><dd :class="['mt-1 whitespace-nowrap text-sm font-semibold airi-text']">
            {{ formatDate(entitlement?.validUntil) }}
          </dd>
        </div>
      </dl>
    </section>
    <section :class="['grid gap-3 rounded-lg border border-pink-400/35 bg-pink-500/9 px-4 py-5 shadow-[0_10px_30px_rgba(236,72,153,0.10)] sm:grid-cols-[auto_minmax(0,1fr)] sm:items-start sm:px-5']">
      <span :class="['i-solar:heart-shine-bold-duotone mt-0.5 size-6 text-pink-600 dark:text-pink-300']" />
      <div>
        <h2 :class="['text-base font-semibold airi-text']">
          {{ t('settings.pages.account.membership.support-title') }}
        </h2>
        <p :class="['mt-1 max-w-3xl text-sm leading-6 airi-text-muted']">
          {{ t('settings.pages.account.membership.support-description') }}
        </p>
        <p :class="['mt-2 max-w-3xl text-xs leading-5 text-pink-800 dark:text-pink-200']">
          {{ t('settings.pages.account.membership.spend-responsibly') }}
        </p>
      </div>
    </section>
    <CommerceRecharge :is-authenticated="isAuthenticated" />
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.account.membership.title
  subtitleKey: settings.pages.account.title
</route>
