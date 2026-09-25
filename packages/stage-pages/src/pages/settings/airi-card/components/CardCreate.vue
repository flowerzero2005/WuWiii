<script setup lang="ts">
import { useI18n } from 'vue-i18n'

const { t } = useI18n()
</script>

<template>
  <!-- Style from ui/InputFile component, may be centralized later -->
  <div
    relative
    :class="[
      'airi-card airi-card-hover',
      'min-h-[120px] flex flex-col cursor-pointer items-center justify-center p-6 opacity-95',
      'transition-all duration-300 hover:scale-100 hover:opacity-100',
    ]"
  >
    <div i-solar:add-square-line-duotone :class="['airi-text-muted', 'mb-4 text-5xl']" />
    <p :class="['airi-text', 'font-medium']">
      {{ t('settings.pages.card.create_card') }}
    </p>
  </div>
</template>
