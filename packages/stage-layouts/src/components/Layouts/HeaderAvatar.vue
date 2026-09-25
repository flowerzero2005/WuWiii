<script setup lang="ts">
import { listSessions, signOut } from '@proj-airi/stage-ui/libs/auth'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { onClickOutside, useMediaQuery } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { toast } from 'vue-sonner'

const authStore = useAuthStore()
const { isAuthenticated, user } = storeToRefs(authStore)

const isMobile = useMediaQuery('(max-width: 768px)')

const userName = computed(() => user.value?.name)
const userAvatar = computed(() => user.value?.image)
const showDropdown = ref(false)
const dropdownRef = ref(null)
const headerActionButtonClass = [
  'w-fit flex items-center justify-center rounded-xl p-2 backdrop-blur-md',
  'airi-overlay-glass airi-overlay-control-muted',
]
const dropdownItemClass = [
  'group w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition',
  'text-[var(--airi-text)] hover:bg-[var(--airi-surface-control-hover)]',
]

onClickOutside(dropdownRef, () => {
  showDropdown.value = false
})

function handleLogout() {
  signOut()
}

async function handleListSessions() {
  try {
    const { data: sessions } = await listSessions()
    if (sessions) {
      toast.success(`You have ${sessions.length} active sessions.`)
    }
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : 'An unknown error occurred')
  }
}
</script>

<template>
  <div flex items-center gap-2>
    <!-- Non-authenticated: Settings & Login -->
    <!-- NOTICE: The avatar is stored in the localstorage, it will be shown at the first time of the page load, so we do not need the skeleton loading here -->
    <template v-if="!isAuthenticated">
      <RouterLink
        :class="headerActionButtonClass"
        title="Settings"
        to="/settings"
      >
        <div class="i-solar:settings-minimalistic-bold-duotone size-5 airi-text-muted" />
      </RouterLink>

      <template v-if="isMobile">
        <button
          :class="headerActionButtonClass"
          title="Login"
          type="button"
          @click="authStore.isLoginOpen = true"
        >
          <div i-solar:user-bold-duotone />
        </button>
      </template>
      <template v-else>
        <RouterLink
          :class="headerActionButtonClass"
          :title="isAuthenticated ? `Logged in as ${userName}` : 'Login'"
          to="/auth/login"
        >
          <div i-solar:user-bold-duotone />
        </RouterLink>
      </template>
    </template>

    <!-- Authenticated: Avatar Dropdown -->
    <div v-else ref="dropdownRef" class="relative">
      <button
        type="button"
        :class="[
          'flex items-center gap-2 rounded-full p-1 pl-1 pr-3 backdrop-blur-md transition',
          'airi-overlay-glass hover:bg-[var(--airi-surface-control-hover)]',
          showDropdown ? 'ring-2 ring-[var(--airi-accent-focus)]' : '',
        ]"
        aria-haspopup="true"
        :aria-expanded="showDropdown ? 'true' : 'false'"
        @click="showDropdown = !showDropdown"
      >
        <img
          v-if="userAvatar"
          :src="userAvatar"
          class="h-8 w-8 rounded-full object-cover ring-2 ring-[var(--airi-surface-page)]"
        >
        <div
          v-else
          class="h-8 w-8 flex items-center justify-center rounded-full bg-[var(--airi-surface-control-muted)] text-[var(--airi-text-muted)] ring-2 ring-[var(--airi-surface-page)]"
        >
          <div class="i-solar:user-bold-duotone text-lg" />
        </div>

        <span v-if="userName" class="max-w-[100px] truncate text-sm text-[var(--airi-text)] font-medium hidden sm:block">
          {{ userName }}
        </span>
        <div
          class="i-solar:alt-arrow-down-linear airi-text-muted transition-transform duration-200"
          :class="{ 'rotate-180': showDropdown }"
        />
      </button>

      <transition
        enter-active-class="transition duration-200 ease-out"
        enter-from-class="translate-y-1 opacity-0"
        enter-to-class="translate-y-0 opacity-100"
        leave-active-class="transition duration-150 ease-in"
        leave-from-class="translate-y-0 opacity-100"
        leave-to-class="translate-y-1 opacity-0"
      >
        <div
          v-if="showDropdown"
          class="absolute right-0 top-full z-50 mt-2 w-60 origin-top-right airi-overlay-glass rounded-xl p-1 shadow-xl backdrop-blur-xl divide-y divide-[var(--airi-border-subtle)]"
        >
          <div class="px-3 py-2">
            <p class="text-xs airi-text-muted">
              Signed in as
            </p>
            <p class="truncate text-sm text-[var(--airi-text)] font-medium">
              {{ userName }}
            </p>
          </div>

          <div class="py-1">
            <button
              :class="dropdownItemClass"
              @click="handleListSessions"
            >
              <div class="i-solar:devices-bold-duotone text-lg airi-text-muted transition group-hover:text-[var(--airi-accent-text)]" />
              Active Sessions
            </button>

            <RouterLink
              to="/settings"
              :class="dropdownItemClass"
              @click="showDropdown = false"
            >
              <div class="i-solar:settings-minimalistic-bold-duotone text-lg airi-text-muted transition group-hover:text-[var(--airi-accent-text)]" />
              Settings
            </RouterLink>
          </div>

          <div class="py-1">
            <button
              class="group w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-red-600 transition hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/20"
              @click="handleLogout"
            >
              <div class="i-solar:logout-3-bold-duotone text-lg transition group-hover:text-red-600 dark:group-hover:text-red-400" />
              Logout
            </button>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>
