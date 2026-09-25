<script setup lang="ts">
import type { AboutBuildInfo, AboutLink } from './types'

import { computed } from 'vue'

const props = withDefaults(defineProps<{
  title?: string
  highlight?: string
  subtitle?: string
  buildInfo?: AboutBuildInfo
  links?: AboutLink[]
}>(), {
  title: '',
  highlight: 'Wuwiii',
  subtitle: '',
  links: () => ([
    { label: 'Wuwiii Home', href: 'https://www.wuwiii.cn/', icon: 'i-solar:home-smile-outline' },
    { label: 'Project AIRI source', href: 'https://github.com/moeru-ai/airi', icon: 'i-simple-icons:github' },
  ]),
})

const hasBuildInfo = computed(() => {
  const info = props.buildInfo
  if (!info)
    return false

  return Boolean(info.branch || info.commit || info.builtOn || info.version)
})
</script>

<template>
  <div :class="['max-w-[min(960px,calc(100%-2rem))]', 'mx-auto', 'h-full', 'flex', 'flex-col', 'pt-14']">
    <div class="mb-14 text-center font-sans-rounded">
      <div class="text-5xl">
        <span v-if="title" class="text-[var(--airi-text-muted)]">{{ title }}&nbsp;</span>
        <span class="text-[var(--airi-accent-strong)]">{{ highlight }}</span>
      </div>
      <div v-if="subtitle" class="mt-2 text-base airi-text-muted">
        {{ subtitle }}
      </div>
    </div>

    <div v-if="hasBuildInfo" :class="['flex-1']">
      <div :class="['airi-text-muted']">
        Application build information
      </div>
      <div :class="['mt-4', 'grid grid-cols-[120px_1fr]', 'gap-2', 'text-sm']">
        <template v-if="buildInfo?.version">
          <div :class="['airi-text-muted']">
            Version
          </div>
          <div :class="['font-mono']">
            {{ buildInfo.version }}
          </div>
        </template>
        <template v-if="buildInfo?.branch">
          <div :class="['airi-text-muted']">
            Branch
          </div>
          <div :class="['font-mono']">
            {{ buildInfo.branch }}
          </div>
        </template>
        <template v-if="buildInfo?.commit">
          <div :class="['airi-text-muted']">
            Commit
          </div>
          <div :class="['font-mono']">
            {{ buildInfo.commit }}
          </div>
        </template>
        <template v-if="buildInfo?.builtOn">
          <div :class="['airi-text-muted']">
            Built on
          </div>
          <div :class="['font-mono']">
            {{ buildInfo.builtOn }}
          </div>
        </template>
      </div>
    </div>

    <div :class="['my-10']">
      <div :class="['airi-text-muted']">
        About
      </div>
      <div :class="['mt-4 flex flex-col gap-2']">
        <a
          v-for="link in links"
          :key="link.href"
          :class="[
            'block',
            'flex items-center gap-2',
            'rounded-xl',
            'px-3 py-2',
            'lg:px-5 lg:py-3',
            'outline-none',
            'backdrop-blur-md',
            'active:scale-98',
            'airi-focus',
            'text-nowrap',
            'text-sm md:text-base',
            'text-[var(--airi-text)]',
            'bg-[var(--airi-surface-control-muted)]',
            'transition-colors transition-transform duration-200 ease-in-out',
            'hover:bg-[var(--airi-surface-control-hover)]',
          ]"
          :href="link.href"
          target="_blank"
        >
          <div :class="link.icon" />
          <div>{{ link.label }}</div>
        </a>
      </div>
    </div>
  </div>
</template>
