<script setup lang="ts">
import QRCode from 'qrcode'

import { ref, watch } from 'vue'

const props = defineProps<{ value: string }>()
const imageUrl = ref('')

watch(() => props.value, async (value) => {
  imageUrl.value = value ? await QRCode.toDataURL(value, { width: 224, margin: 2, errorCorrectionLevel: 'M' }) : ''
}, { immediate: true })
</script>

<template>
  <div class="border border-amber-200/70 rounded-2xl bg-amber-50/75 p-4 text-center dark:border-amber-300/20 dark:bg-amber-300/5">
    <p class="text-sm text-amber-900 font-semibold dark:text-amber-200">
      请用这个小号的 QQ 扫码并确认登录
    </p>
    <img v-if="imageUrl" :src="imageUrl" alt="QQ 登录二维码" class="mx-auto mt-3 h-56 w-56 rounded-xl bg-white p-2 shadow-sm">
    <p v-else class="mt-3 text-xs text-neutral-500">
      正在生成登录二维码…
    </p>
    <p class="mt-3 text-xs text-neutral-600 leading-5 dark:text-neutral-300">
      二维码过期后可点击下方的「重新获取二维码」。若在同一部手机操作，可截图后尝试从 QQ 扫一扫的相册中识别。
    </p>
  </div>
</template>
