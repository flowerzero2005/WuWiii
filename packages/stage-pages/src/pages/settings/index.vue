<script setup lang="ts">
import { isProductAudienceVisible } from '@proj-airi/stage-shared'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useCommerceStore } from '@proj-airi/stage-ui/stores/commerce'
import { computed, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const router = useRouter()
const { t } = useI18n()
const auth = useAuthStore()
const commerce = useCommerceStore()
const planLabel = computed(() => t(`settings.pages.account.plans.${commerce.activePlan}`))
const companionPaths = new Set(['/settings/airi-card', '/settings/modules', '/settings/group-scenarios', '/settings/speech', '/settings/memory', '/settings/reply-feedback'])
const appPaths = new Set(['/settings/data', '/settings/system'])

const settings = computed(() => router.getRoutes()
  .filter(route => route.meta?.settingsEntry && route.path !== '/settings/account' && isProductAudienceVisible(route.meta?.productAudience))
  .sort((a, b) => Number(a.meta?.order ?? 0) - Number(b.meta?.order ?? 0))
  .map(route => ({
    title: route.meta?.titleKey ? t(route.meta.titleKey as string) : (route.meta?.title as string | undefined) ?? '',
    description: route.meta?.descriptionKey ? t(route.meta.descriptionKey as string) : (route.meta?.description as string | undefined) ?? '',
    icon: (route.meta?.icon as string | undefined) ?? 'i-solar:settings-minimalistic-bold-duotone',
    to: route.path,
  })))

const groups = computed(() => {
  const result = [
    { id: 'companion', title: t('settings.pages.home.groups.companion.title'), description: t('settings.pages.home.groups.companion.description'), items: [] as typeof settings.value },
    { id: 'app', title: t('settings.pages.home.groups.app.title'), description: t('settings.pages.home.groups.app.description'), items: [] as typeof settings.value },
    { id: 'advanced', title: t('settings.pages.home.groups.advanced.title'), description: t('settings.pages.home.groups.advanced.description'), items: [] as typeof settings.value },
  ]
  for (const item of settings.value)
    (companionPaths.has(item.to) ? result[0] : appPaths.has(item.to) ? result[1] : result[2]).items.push(item)
  return result.filter(group => group.items.length)
})

watch(() => auth.isAuthenticated, (signedIn) => {
  if (signedIn)
    void commerce.fetchAccountState().catch(() => undefined)
}, { immediate: true })
</script>

<template>
  <main class="mobile-settings-home" data-airi-runtime-route="/settings">
    <RouterLink to="/settings/account" class="account-card" :aria-label="t('settings.pages.account.home.title')">
      <span class="account-orbit" aria-hidden="true" />
      <span class="account-topline">
        <span class="account-mark"><span class="i-solar:user-rounded-bold-duotone size-6" /></span>
        <span class="account-name">{{ t('settings.pages.account.home.title') }}</span>
        <span class="account-arrow i-solar:arrow-right-up-linear size-5" aria-hidden="true" />
      </span>
      <span class="account-identity">{{ auth.isAuthenticated ? auth.user?.email || auth.user?.name : t('settings.pages.account.home.signed-out-summary') }}</span>
      <span class="account-bottomline">
        <span class="account-pill">{{ auth.isAuthenticated ? planLabel : t('settings.pages.account.home.login-action') }}</span>
        <span v-if="auth.isAuthenticated" class="account-points">{{ t('settings.pages.account.sections.points.title') }} · {{ commerce.availablePoints }}</span>
      </span>
    </RouterLink>

    <section v-for="group in groups" :key="group.id" class="settings-group">
      <header class="group-heading">
        <div><h2>{{ group.title }}</h2><p>{{ group.description }}</p></div>
        <span class="group-count">{{ group.items.length }}</span>
      </header>
      <div class="settings-list">
        <RouterLink v-for="item in group.items" :key="item.to" :to="item.to" class="settings-row">
          <span class="row-icon"><span :class="item.icon" class="size-5" aria-hidden="true" /></span>
          <span class="row-copy"><strong>{{ item.title }}</strong><small>{{ item.description }}</small></span>
          <span class="i-solar:alt-arrow-right-linear row-chevron size-4" aria-hidden="true" />
        </RouterLink>
      </div>
    </section>
  </main>
</template>

<style scoped>
.mobile-settings-home { display: grid; gap: 22px; max-width: 640px; margin: 0 auto; padding: 4px 2px 44px; }
.account-card { position: relative; display: grid; gap: 14px; overflow: hidden; padding: 20px; border: 1px solid color-mix(in srgb, var(--airi-accent-strong) 20%, transparent); border-radius: 24px; background: linear-gradient(126deg, color-mix(in srgb, var(--airi-accent-strong) 13%, var(--airi-surface-card)), var(--airi-surface-card) 66%); color: var(--airi-text); box-shadow: 0 14px 34px rgb(18 35 50 / 8%); text-decoration: none; }
.account-orbit { position: absolute; top: -82px; right: -46px; width: 190px; height: 190px; border: 1px solid color-mix(in srgb, var(--airi-accent-strong) 24%, transparent); border-radius: 50%; box-shadow: 0 0 0 29px color-mix(in srgb, var(--airi-accent-strong) 4%, transparent), 0 0 0 58px color-mix(in srgb, var(--airi-accent-strong) 3%, transparent); pointer-events: none; }
.account-topline, .account-bottomline { position: relative; display: flex; align-items: center; gap: 10px; }
.account-mark { display: grid; width: 38px; height: 38px; place-items: center; border-radius: 13px; background: color-mix(in srgb, var(--airi-accent-strong) 17%, transparent); color: var(--airi-accent-strong); }
.account-name { font-size: 15px; font-weight: 700; letter-spacing: .01em; }
.account-arrow { margin-left: auto; opacity: .64; }
.account-identity { position: relative; overflow: hidden; color: var(--airi-text-muted); font-size: 12px; text-overflow: ellipsis; white-space: nowrap; }
.account-pill { border-radius: 999px; padding: 5px 10px; background: color-mix(in srgb, var(--airi-accent-strong) 15%, transparent); color: var(--airi-accent-strong); font-size: 11px; font-weight: 700; }
.account-points { color: var(--airi-text-muted); font-size: 11px; }
.settings-group { display: grid; gap: 10px; }
.group-heading { display: flex; align-items: center; justify-content: space-between; padding: 0 3px; }
.group-heading h2 { margin: 0; color: var(--airi-text); font-size: 14px; font-weight: 700; }
.group-heading p { margin: 3px 0 0; color: var(--airi-text-muted); font-size: 11px; line-height: 1.5; }
.group-count { color: var(--airi-text-muted); font-size: 11px; }
.settings-list { overflow: hidden; border: 1px solid var(--airi-border-subtle); border-radius: 20px; background: var(--airi-surface-card); }
.settings-row { display: flex; min-height: 68px; align-items: center; gap: 12px; padding: 11px 14px; color: var(--airi-text); text-decoration: none; transition: background 160ms ease, transform 160ms ease; }
.settings-row + .settings-row { border-top: 1px solid var(--airi-border-subtle); }
.settings-row:active { transform: scale(.99); background: var(--airi-surface-control-hover); }
.row-icon { display: grid; width: 39px; height: 39px; flex: none; place-items: center; border-radius: 13px; background: color-mix(in srgb, var(--airi-accent-strong) 10%, var(--airi-surface-control)); color: var(--airi-accent-strong); }
.row-copy { display: grid; min-width: 0; gap: 3px; }
.row-copy strong { overflow: hidden; font-size: 13px; font-weight: 650; text-overflow: ellipsis; white-space: nowrap; }
.row-copy small { overflow: hidden; color: var(--airi-text-muted); font-size: 11px; text-overflow: ellipsis; white-space: nowrap; }
.row-chevron { margin-left: auto; flex: none; color: var(--airi-text-muted); }
</style>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.title
  stageTransition:
    name: slide
</route>
