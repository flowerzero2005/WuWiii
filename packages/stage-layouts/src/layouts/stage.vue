<script setup lang="ts">
import { isStageTamagotchi } from '@proj-airi/stage-shared'
import { LoginDrawer } from '@proj-airi/stage-ui/components/auth/index'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { storeToRefs } from 'pinia'
import { watch } from 'vue'
import { RouterView } from 'vue-router'

const authStore = useAuthStore()
const { isLoginOpen, isAuthenticated } = storeToRefs(authStore)
watch(isAuthenticated, (auth) => {
  if (isStageTamagotchi()) {
    isLoginOpen.value = false
    return
  }

  if (auth)
    isLoginOpen.value = false
})
</script>

<template>
  <main :class="['h-full font-cute airi-text']">
    <RouterView />
    <LoginDrawer v-if="!isStageTamagotchi()" v-model:open="isLoginOpen" />
  </main>
</template>
