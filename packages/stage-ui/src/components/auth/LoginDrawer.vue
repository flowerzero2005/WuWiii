<script setup lang="ts">
import { Button, Input } from '@proj-airi/ui'
import { useResizeObserver, useScreenSafeArea } from '@vueuse/core'
import { DrawerContent, DrawerHandle, DrawerOverlay, DrawerPortal, DrawerRoot } from 'vaul-vue'
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { toast } from 'vue-sonner'

import { fetchAuthVerificationCapabilities, isSupportedPhoneNumber, sendEmailSignInCode, sendPhoneSignInCode, signInWithEmailCode, signInWithPassword, signInWithPhoneCode, VerificationCodeRateLimitError } from '../../libs/auth'

const open = defineModel<boolean>('open', { required: true })
const { t } = useI18n()
const screenSafeArea = useScreenSafeArea()
useResizeObserver(document.documentElement, () => screenSafeArea.update())

const method = ref<'code' | 'password'>('password')
const identity = ref('')
const password = ref('')
const code = ref('')
const capabilities = ref({ emailOtp: false, phoneOtp: false, registration: false })
const submitting = ref(false)
const sending = ref(false)
const cooldown = ref(0)

const normalizedIdentity = computed(() => identity.value.trim())
const phoneIdentity = computed(() => isSupportedPhoneNumber(normalizedIdentity.value))
const codeAvailable = computed(() => phoneIdentity.value ? capabilities.value.phoneOtp : capabilities.value.emailOtp)
const canSend = computed(() => method.value === 'code' && codeAvailable.value && normalizedIdentity.value.length > 0 && !sending.value && cooldown.value === 0)
const canSubmit = computed(() => !submitting.value && normalizedIdentity.value.length > 0 && (method.value === 'password' ? password.value.length >= 8 : codeAvailable.value && /^\d{6}$/.test(code.value.trim())))

async function sendCode() {
  if (!canSend.value)
    return
  sending.value = true
  try {
    if (phoneIdentity.value)
      await sendPhoneSignInCode(normalizedIdentity.value)
    else
      await sendEmailSignInCode(normalizedIdentity.value)
    cooldown.value = 60
    toast.success(t('settings.pages.account.status.verification-code-sent'))
  }
  catch (error) {
    if (error instanceof VerificationCodeRateLimitError) {
      cooldown.value = Math.max(1, error.retryAfterSeconds)
      toast.error(t('settings.pages.account.status.verification-code-rate-limited', { seconds: error.retryAfterSeconds }))
    }
    else {
      toast.error(error instanceof Error ? error.message : t('settings.pages.account.status.verification-auth-failed'))
    }
  }
  finally {
    sending.value = false
  }
}

async function submit() {
  if (!canSubmit.value)
    return
  submitting.value = true
  try {
    if (method.value === 'password')
      await signInWithPassword(normalizedIdentity.value, password.value)
    else if (phoneIdentity.value)
      await signInWithPhoneCode({ code: code.value, phoneNumber: normalizedIdentity.value })
    else
      await signInWithEmailCode({ code: code.value, email: normalizedIdentity.value })
    password.value = ''
    code.value = ''
    open.value = false
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.account.login-drawer.sign-in-failed'))
  }
  finally {
    submitting.value = false
  }
}

onMounted(() => void fetchAuthVerificationCapabilities().then(value => capabilities.value = value).catch(() => {}))
const cooldownTimer = window.setInterval(() => cooldown.value = Math.max(0, cooldown.value - 1), 1_000)
onBeforeUnmount(() => window.clearInterval(cooldownTimer))
</script>

<template>
  <DrawerRoot v-model:open="open" should-scale-background>
    <DrawerPortal>
      <DrawerOverlay :class="['fixed inset-0 z-1000 bg-black/45 backdrop-blur-sm']" />
      <DrawerContent
        :class="['fixed bottom-0 left-0 right-0 z-1001 flex flex-col rounded-t-lg border-t border-[var(--airi-border-subtle)] bg-[var(--airi-surface-panel)] outline-none shadow-2xl']"
        :style="{ paddingBottom: `${Math.max(Number.parseFloat(screenSafeArea.bottom.value.replace('px', '')), 24)}px` }"
      >
        <div :class="['mx-auto w-full max-w-lg px-6 pt-2']">
          <DrawerHandle :class="['mb-5']" />
          <div :class="['mb-5 flex items-start gap-3']">
            <div :class="['grid size-10 shrink-0 place-items-center rounded-md bg-[var(--airi-accent-surface)] text-[var(--airi-accent-strong)]']">
              <span :class="['i-solar:key-minimalistic-square-3-bold-duotone size-5']" />
            </div>
            <div>
              <h2 :class="['text-xl font-semibold airi-text']">
                {{ t('settings.pages.account.login-drawer.title') }}
              </h2><p :class="['mt-1 text-sm airi-text-muted']">
                {{ t('settings.pages.account.login-drawer.description') }}
              </p>
            </div>
          </div>
          <form :class="['mb-5 flex flex-col gap-4']" @submit.prevent="submit">
            <div :class="['grid grid-cols-2 gap-1 rounded-md bg-[var(--airi-surface-control-muted)] p-1']">
              <Button type="button" size="sm" :variant="method === 'password' ? 'primary' : 'ghost'" @click="method = 'password'; code = ''">
                {{ t('settings.pages.account.actions.use-password') }}
              </Button>
              <Button type="button" size="sm" :variant="method === 'code' ? 'primary' : 'ghost'" :disabled="!capabilities.emailOtp && !capabilities.phoneOtp" @click="method = 'code'; password = ''">
                {{ t('settings.pages.account.login-drawer.code-sign-in') }}
              </Button>
            </div>
            <label :class="['flex flex-col gap-1.5']"><span :class="['text-sm font-medium airi-text']">{{ t('settings.pages.account.login-drawer.identity') }}</span><Input v-model="identity" autocomplete="username" :placeholder="t('settings.pages.account.login-drawer.identity-placeholder')" variant="primary-dimmed" /></label>
            <label v-if="method === 'password'" :class="['flex flex-col gap-1.5']"><span :class="['text-sm font-medium airi-text']">{{ t('settings.pages.account.login-drawer.password') }}</span><Input v-model="password" autocomplete="current-password" type="password" show-password-toggle :placeholder="t('settings.pages.account.login-drawer.password-placeholder')" variant="primary-dimmed" /></label>
            <label v-else :class="['flex flex-col gap-1.5']"><span :class="['text-sm font-medium airi-text']">{{ t('settings.pages.account.login-drawer.code') }}</span><span :class="['grid grid-cols-[minmax(0,1fr)_auto] gap-2']"><Input v-model="code" autocomplete="one-time-code" inputmode="numeric" maxlength="6" :placeholder="t('settings.pages.account.login-drawer.code-placeholder')" variant="primary-dimmed" /><Button type="button" variant="secondary" :disabled="!canSend" :loading="sending" @click="sendCode">{{ cooldown > 0 ? t('settings.pages.account.actions.resend-code-in', { seconds: cooldown }) : t('settings.pages.account.actions.send-code') }}</Button></span></label>
            <Button type="submit" :class="['h-11 w-full']" icon="i-solar:login-3-bold" :disabled="!canSubmit" :loading="submitting">
              {{ t('settings.pages.account.actions.sign-in-email') }}
            </Button>
            <a href="/account" :class="['text-center text-sm font-medium text-[var(--airi-accent-strong)] underline-offset-4 hover:underline']" @click="open = false">{{ t('settings.pages.account.login-drawer.manage-account') }}</a>
          </form>
          <p :class="['pb-2 text-center text-xs airi-text-muted']">
            {{ t('settings.pages.account.login-drawer.legal') }}
          </p>
        </div>
      </DrawerContent>
    </DrawerPortal>
  </DrawerRoot>
</template>
