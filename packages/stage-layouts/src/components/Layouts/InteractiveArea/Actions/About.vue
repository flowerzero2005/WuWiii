<script setup lang="ts">
import { isStageCapacitor, isStageTamagotchi } from '@proj-airi/stage-shared'
import { AboutContent, AboutDialog } from '@proj-airi/stage-ui/components'
import { useBuildInfo } from '@proj-airi/stage-ui/composables'
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'

const { t } = useI18n()

const show = ref(false)
const buildInfo = useBuildInfo()

const aboutLinks = [
  { label: 'Wuwiii Home', href: 'http://127.0.0.1:5173/', icon: 'i-solar:home-smile-outline' },
  { label: 'Project AIRI source', href: 'https://github.com/moeru-ai/airi', icon: 'i-simple-icons:github' },
]

const edition = isStageTamagotchi()
  ? t('base.edition.desktop')
  : isStageCapacitor()
    ? t('base.edition.mobile')
    : t('base.edition.web')
</script>

<template>
  <button
    :class="[
      'w-fit flex items-center self-end justify-center rounded-xl p-2',
      'airi-overlay-glass airi-overlay-control',
    ]"
    title="About"
    @click="show = !show"
  >
    <div class="i-solar:info-circle-outline size-5 airi-text-muted" />
  </button>
  <AboutDialog v-model="show">
    <AboutContent :subtitle="edition" :build-info="buildInfo" :links="aboutLinks" />
  </AboutDialog>
</template>
