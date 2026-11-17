<script setup lang="ts">
import { FieldCheckbox, FieldRange } from '@proj-airi/ui'
import { computed, ref, watch } from 'vue'

import { getOfficialApiFetch, SERVER_URL } from '@proj-airi/stage-ui/libs/auth'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useMemeWikiSettingsStore } from '@proj-airi/stage-ui/stores/settings/meme-wiki'

const auth = useAuthStore()
const memeWiki = useMemeWikiSettingsStore()
const wikiStatus = ref<{ available: boolean, count: number } | null>(null)

watch(() => auth.isAuthenticated, async (signedIn) => {
  wikiStatus.value = null
  if (!signedIn)
    return
  try {
    const response = await getOfficialApiFetch()(`${SERVER_URL}/api/meme-wiki/status`, { credentials: 'include' })
    if (response.ok)
      wikiStatus.value = await response.json() as { available: boolean, count: number }
  }
  catch {
    // The control still works for speaking style when the glossary is temporarily unavailable.
  }
}, { immediate: true })

const intensityBand = computed(() => {
  const intensity = memeWiki.settings.intensity
  if (intensity <= 20)
    return intensity === 0 ? '关闭' : '很低'
  if (intensity <= 45)
    return '偏低'
  if (intensity <= 70)
    return '中等'
  return '很高'
})

const intensityDescription = computed(() => {
  const intensity = memeWiki.settings.intensity
  if (intensity <= 20)
    return intensity === 0 ? '不主动使用网络梗、流行语或熟人式调侃。' : '只在语境非常明确时轻轻带过，不接黑称。'
  if (intensity <= 45)
    return '可以接明确的梗和轻微损操作，但不会把每句话都改成梗。'
  if (intensity <= 70)
    return '像熟悉社区的人一样自然使用网络梗；贴合语境时也可以主动带入。'
  return '更主动、更频繁地使用网络梗、流行语、梗句和熟人式调侃。'
})

function formatIntensity(value: number) {
  return `${Math.round(value)} · ${intensityBand.value}`
}
</script>

<template>
  <div class="mx-auto w-full max-w-3xl flex flex-col gap-6">
    <section class="airi-surface-panel rounded-2xl p-5 md:p-6">
      <div class="mb-5 flex items-start gap-4">
        <div class="flex size-11 shrink-0 items-center justify-center rounded-2xl bg-[var(--airi-accent-surface)] text-2xl text-[var(--airi-accent-text)]">
          <div i-solar:emoji-funny-square-bold-duotone />
        </div>
        <div>
          <h2 class="airi-text text-xl font-semibold">
            梗百科与玩梗
          </h2>
          <p class="airi-text-muted mt-1 text-sm leading-6">
            让应用聊天理解网络梗，也控制角色平时主动使用网络梗的程度。设置会保存在当前设备。
          </p>
        </div>
      </div>

      <FieldCheckbox
        v-model="memeWiki.settings.enabled"
        label="启用梗百科与玩梗"
        description="关闭后不会查询梗词条，也不会向模型注入主动玩梗风格。"
      />

      <p class="airi-text-muted mt-4 text-xs">
        <template v-if="!auth.isAuthenticated">
          登录后可查询云端梗词库；玩梗风格设置仍可用于当前应用聊天。
        </template>
        <template v-else-if="wikiStatus?.available">
          梗词库可用 · {{ wikiStatus.count }} 条词条
        </template>
        <template v-else>
          梗词库状态暂不可用，玩梗风格设置仍会生效。
        </template>
      </p>

      <div class="mt-6 border-t border-[var(--airi-border-subtle)] pt-5">
        <fieldset :disabled="!memeWiki.settings.enabled" :class="{ 'opacity-50': !memeWiki.settings.enabled }">
          <FieldRange
          v-model="memeWiki.settings.intensity"
          label="串子程度"
          description="应用聊天会按当前档位使用网络梗和流行语，不只在用户问梗时生效。"
          :min="0"
          :max="100"
          :step="5"
          :format-value="formatIntensity"
          />
        </fieldset>
        <div class="mt-3 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
          <div class="rounded-xl bg-[var(--airi-surface-control-muted)] px-3 py-2">
            <strong class="block airi-text">0</strong>
            <span class="airi-text-muted">关闭玩梗与查梗</span>
          </div>
          <div class="rounded-xl bg-[var(--airi-surface-control-muted)] px-3 py-2">
            <strong class="block airi-text">1–20</strong>
            <span class="airi-text-muted">很低 · 只接明确的梗</span>
          </div>
          <div class="rounded-xl bg-[var(--airi-surface-control-muted)] px-3 py-2">
            <strong class="block airi-text">21–45</strong>
            <span class="airi-text-muted">偏低 · 轻微接梗</span>
          </div>
          <div class="rounded-xl bg-[var(--airi-surface-control-muted)] px-3 py-2">
            <strong class="block airi-text">46–70</strong>
            <span class="airi-text-muted">中等 · 自然主动</span>
          </div>
          <div class="rounded-xl bg-[var(--airi-surface-control-muted)] px-3 py-2">
            <strong class="block airi-text">71–100</strong>
            <span class="airi-text-muted">很高 · 更频繁玩梗</span>
          </div>
        </div>
        <p class="airi-text-muted mt-3 rounded-xl bg-[var(--airi-surface-control-muted)] px-3 py-2 text-sm leading-6">
          当前档位：<strong class="airi-text">{{ intensityBand }}</strong>（{{ memeWiki.settings.intensity }}） · {{ intensityDescription }}
        </p>
      </div>
    </section>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  title: 梗百科与玩梗
  subtitleKey: settings.pages.modules.title
  description: 设置应用聊天的梗百科和主动玩梗程度
  icon: i-solar:emoji-funny-square-bold-duotone
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
