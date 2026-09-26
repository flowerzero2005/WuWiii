<script setup lang="ts">
import type {
  CommercePaymentMethod,
  CommercePaymentOrder,
  CommerceProduct,
} from '@proj-airi/stage-ui/stores/commerce'

import {
  COMMERCE_PAYMENT_ERROR_I18N_KEYS,
  CommerceApiError,
  useCommerceStore,
} from '@proj-airi/stage-ui/stores/commerce'
import { Button } from '@proj-airi/ui'
import { useNow } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { toDataURL } from 'qrcode'
import { DialogContent, DialogDescription, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps<{
  isAuthenticated: boolean
}>()

const { locale, t } = useI18n()
const commerceStore = useCommerceStore()
const {
  activePaymentCheckout,
  activePaymentOrder,
  isCreatingPaymentOrder,
  isLoadingPaymentOrders,
  isLoadingPaymentProducts,
  isPollingPaymentOrder,
  paymentCheckoutError,
  paymentOrdersError,
  paymentProductsError,
  paymentMethods,
  paymentOrders,
  paymentProducts,
} = storeToRefs(commerceStore)

const selectedSku = ref('')
const selectedKind = ref<'membership' | 'points'>('membership')
const paymentMethod = ref<CommercePaymentMethod>('wechat')
const clientRequestId = ref(createClientRequestId())
const checkoutOpen = ref(false)
const checkoutPanel = ref<HTMLElement>()
const qrCodeDataUrl = ref<string>()
const qrCodeError = ref<unknown>()
const now = useNow({ interval: 1_000 })
const showAllOrders = ref(false)

const visibleProducts = computed(() => paymentProducts.value.filter(product => product.kind === selectedKind.value))
const selectedProduct = computed(() => visibleProducts.value.find(product => product.sku === selectedSku.value))
const paymentMethodOptions = computed(() => [
  { available: paymentMethods.value.find(item => item.paymentMethod === 'wechat')?.available ?? false, color: 'text-[#07c160]', icon: 'i-simple-icons:wechat', label: t('settings.pages.account.sections.recharge.methods.wechat'), selectedClass: 'border-[#07c160] bg-[#07c160]/10 text-[#067a3f] dark:text-[#55e69a]', value: 'wechat' as const },
  { available: paymentMethods.value.find(item => item.paymentMethod === 'alipay')?.available ?? false, color: 'text-[#1677ff]', icon: 'i-simple-icons:alipay', label: t('settings.pages.account.sections.recharge.methods.alipay'), selectedClass: 'border-[#1677ff] bg-[#1677ff]/10 text-[#1264c4] dark:text-[#72adff]', value: 'alipay' as const },
])
const selectedPaymentMethodAvailable = computed(() => paymentMethodOptions.value.some(method => method.value === paymentMethod.value && method.available))
function errorMessage(error: unknown) {
  if (!(error instanceof Error))
    return undefined
  if (error instanceof CommerceApiError && error.code && error.code in COMMERCE_PAYMENT_ERROR_I18N_KEYS) {
    const key = COMMERCE_PAYMENT_ERROR_I18N_KEYS[error.code as keyof typeof COMMERCE_PAYMENT_ERROR_I18N_KEYS]
    return t(key)
  }
  return error.message
}
const productErrorMessage = computed(() => errorMessage(paymentProductsError.value))
const ordersErrorMessage = computed(() => errorMessage(paymentOrdersError.value))
const checkoutErrorMessage = computed(() => errorMessage(paymentCheckoutError.value))
const checkoutSecondsRemaining = computed(() => {
  const expiresAt = activePaymentCheckout.value?.expiresAt ?? activePaymentOrder.value?.expiresAt
  if (!expiresAt)
    return 0
  return Math.max(0, Math.floor((new Date(expiresAt).getTime() - now.value.getTime()) / 1_000))
})
const checkoutCountdown = computed(() => {
  const minutes = Math.floor(checkoutSecondsRemaining.value / 60).toString().padStart(2, '0')
  const seconds = (checkoutSecondsRemaining.value % 60).toString().padStart(2, '0')
  return `${minutes}:${seconds}`
})
const activeCheckoutUrl = computed(() => normalizeCheckoutUrl(activePaymentCheckout.value?.value))
const activeCheckoutImage = computed(() => normalizeHttpUrl(activePaymentCheckout.value?.value) ?? normalizeDataImage(activePaymentCheckout.value?.value))
const projectedMembershipPoints = computed(() => selectedProduct.value?.kind === 'membership'
  ? selectedProduct.value.basePoints + selectedProduct.value.giftPoints + selectedProduct.value.dailyRewardPoints * selectedProduct.value.validDays
  : 0)
const visibleOrders = computed(() => showAllOrders.value ? paymentOrders.value : paymentOrders.value.slice(0, 5))
const checkoutChannelClass = computed(() => activePaymentOrder.value?.paymentMethod === 'wechat'
  ? 'border-[#07c160]/45 shadow-[0_22px_70px_rgba(7,193,96,0.16)]'
  : 'border-[#1677ff]/45 shadow-[0_22px_70px_rgba(22,119,255,0.16)]')

function productSelectionClass(product: CommerceProduct) {
  if (product.kind === 'points')
    return 'border-sky-500 bg-sky-500/9 shadow-[0_10px_28px_rgba(14,165,233,0.14)] -translate-y-0.5'
  if (product.plan === 'lite')
    return 'border-emerald-500 bg-emerald-500/9 shadow-[0_10px_28px_rgba(16,185,129,0.14)] -translate-y-0.5'
  if (product.plan === 'pro')
    return 'border-blue-500 bg-blue-500/9 shadow-[0_10px_28px_rgba(59,130,246,0.15)] -translate-y-0.5'
  return 'border-amber-500 bg-[linear-gradient(145deg,rgba(245,158,11,0.12),rgba(139,92,246,0.08))] shadow-[0_12px_32px_rgba(180,120,35,0.18)] -translate-y-0.5'
}

function productBadgeClass(product: CommerceProduct) {
  if (product.kind === 'points')
    return 'bg-sky-600 text-white'
  if (product.plan === 'lite')
    return 'bg-emerald-600 text-white'
  if (product.plan === 'pro')
    return 'bg-blue-600 text-white'
  return 'bg-amber-500 text-[#2b1b05]'
}

function createClientRequestId() {
  return globalThis.crypto?.randomUUID?.() ?? `airi-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function normalizeHttpUrl(value: string | undefined) {
  if (!value)
    return undefined
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : undefined
  }
  catch {
    return undefined
  }
}

function normalizeCheckoutUrl(value: string | undefined) {
  if (!value)
    return undefined
  try {
    const url = new URL(value)
    return ['http:', 'https:', 'weixin:', 'alipays:'].includes(url.protocol) ? url.toString() : undefined
  }
  catch {
    return undefined
  }
}

function normalizeDataImage(value: string | undefined) {
  return value && /^data:image\/(?:png|jpeg|webp);base64,[a-z0-9+/=\s]+$/i.test(value) ? value : undefined
}

function formatCurrency(amountCents: number, currency: string) {
  return new Intl.NumberFormat(locale.value, {
    currency,
    style: 'currency',
  }).format(amountCents / 100)
}

function formatNumber(value: number) {
  return new Intl.NumberFormat(locale.value).format(value)
}

function totalPoints(product: CommerceProduct) {
  return product.basePoints + product.giftPoints
}

function pointValue(product: CommerceProduct) {
  return Math.round(totalPoints(product) / (product.amountCents / 100))
}

function pointTone(product: CommerceProduct) {
  const value = totalPoints(product)
  if (value >= 150_000)
    return 'text-amber-700 dark:text-amber-300 bg-amber-500/10'
  if (value >= 50_000)
    return 'text-sky-700 dark:text-sky-300 bg-sky-500/10'
  return 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/10'
}

function formatDate(value: string | null | undefined) {
  if (!value)
    return t('settings.pages.account.common.unknown')
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return t('settings.pages.account.common.unknown')
  return new Intl.DateTimeFormat(locale.value, { dateStyle: 'medium', timeStyle: 'short' }).format(date)
}

function planLabel(product: CommerceProduct) {
  return locale.value.startsWith('zh') ? product.nameZh : product.nameEn
}

function methodLabel(method: CommercePaymentOrder['paymentMethod']) {
  return t(`settings.pages.account.sections.recharge.methods.${method}`)
}

function statusLabel(status: CommercePaymentOrder['status']) {
  return t(`settings.pages.account.sections.recharge.statuses.${status}`)
}

function statusClass(status: CommercePaymentOrder['status']) {
  if (status === 'paid')
    return 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
  if (status === 'refunded')
    return 'bg-sky-500/12 text-sky-700 dark:text-sky-300'
  if (status === 'closed')
    return 'bg-[var(--airi-surface-control-muted)] airi-text-muted'
  return 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
}

function selectProduct(sku: string) {
  selectedSku.value = sku
}

async function loadPayments() {
  const tasks: Promise<unknown>[] = [commerceStore.fetchPaymentProducts()]
  if (props.isAuthenticated)
    tasks.push(commerceStore.fetchPaymentOrders())
  await Promise.allSettled(tasks)
}

async function createOrder() {
  if (!selectedProduct.value || !props.isAuthenticated || isCreatingPaymentOrder.value)
    return

  const requestId = clientRequestId.value
  clientRequestId.value = createClientRequestId()
  try {
    const result = await commerceStore.createPaymentOrder({
      clientRequestId: requestId,
      paymentMethod: paymentMethod.value,
      sku: selectedProduct.value.sku,
    })
    checkoutOpen.value = true
    void pollOrder(result.order.id)
  }
  catch {
    if (activePaymentOrder.value?.status === 'failed')
      checkoutOpen.value = true
    // The store exposes the provider error inline; the next attempt uses a fresh order key.
  }
}

async function pollOrder(orderId: string) {
  try {
    const order = await commerceStore.pollPaymentOrder(orderId)
    if (order?.status === 'paid' || order?.status === 'refunded')
      await commerceStore.fetchAccountState()
  }
  catch {
    // Polling errors remain visible beside the checkout and can be retried manually.
  }
}

async function openOrder(orderId: string) {
  try {
    await commerceStore.fetchPaymentOrder(orderId)
  }
  catch {
    // The store provides the actionable error message.
  }
}

async function refreshActiveOrder() {
  if (!activePaymentOrder.value)
    return
  await openOrder(activePaymentOrder.value.id)
}

watch(paymentProducts, (products) => {
  const productsForKind = products.filter(product => product.kind === selectedKind.value)
  if (!productsForKind.some(product => product.sku === selectedSku.value))
    selectedSku.value = productsForKind[0]?.sku ?? ''
}, { immediate: true })

watch(selectedKind, () => {
  selectedSku.value = visibleProducts.value[0]?.sku ?? ''
})

watch(() => activePaymentCheckout.value?.value, async (value) => {
  qrCodeDataUrl.value = undefined
  qrCodeError.value = undefined
  if (!value || activePaymentCheckout.value?.kind === 'image' || activePaymentCheckout.value?.kind === 'mock')
    return
  try {
    qrCodeDataUrl.value = await toDataURL(value, {
      color: { dark: '#17251f', light: '#ffffff' },
      errorCorrectionLevel: 'M',
      margin: 2,
      width: 288,
    })
  }
  catch (error) {
    qrCodeError.value = error
  }
})

watch(checkoutOpen, async (open) => {
  if (!open)
    return
  await nextTick()
  checkoutPanel.value?.scrollIntoView({ behavior: 'smooth', block: 'center' })
})

watch(paymentMethodOptions, (methods) => {
  if (!methods.find(method => method.value === paymentMethod.value)?.available)
    paymentMethod.value = methods.find(method => method.available)?.value ?? paymentMethod.value
}, { immediate: true })

watch(() => props.isAuthenticated, (authenticated) => {
  if (authenticated)
    void commerceStore.fetchPaymentOrders().catch(() => undefined)
  else
    commerceStore.stopPaymentPolling()
})

onMounted(() => void loadPayments())
onBeforeUnmount(() => commerceStore.stopPaymentPolling())
</script>

<template>
  <section :class="['overflow-hidden rounded-lg border border-[var(--airi-border-accent)]', 'bg-[var(--airi-surface-panel)] shadow-[0_18px_50px_rgba(20,45,35,0.10)]']">
    <div class="wuwiii-checkout-ribbon" aria-hidden="true">
      <span /><span /><span /><span />
    </div>
    <div :class="['flex flex-wrap items-start justify-between gap-4 px-5 py-5', 'border-b border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card)]']">
      <div :class="['min-w-0']">
        <div :class="['flex items-center gap-2']">
          <div :class="['grid size-9 place-items-center rounded-md bg-[var(--airi-accent-surface)] text-[var(--airi-accent-strong)]']">
            <span :class="['i-solar:crown-star-bold-duotone size-5']" />
          </div>
          <h2 :class="['text-xl font-semibold airi-text']">
            {{ t('settings.pages.account.sections.recharge.title') }}
          </h2>
        </div>
        <p :class="['mt-2 max-w-2xl text-sm leading-6 airi-text-muted']">
          {{ t('settings.pages.account.sections.recharge.description') }}
        </p>
      </div>
      <div :class="['flex flex-wrap items-center gap-x-4 gap-y-2 text-xs airi-text-muted']">
        <span :class="['inline-flex items-center gap-1.5']"><span :class="['i-solar:shield-check-bold text-emerald-600 size-4']" /> {{ t('settings.pages.account.sections.recharge.trust.official') }}</span>
        <span :class="['inline-flex items-center gap-1.5']"><span :class="['i-solar:bolt-bold text-amber-500 size-4']" /> {{ t('settings.pages.account.sections.recharge.trust.automatic') }}</span>
        <span :class="['inline-flex items-center gap-1.5']"><span :class="['i-solar:document-text-bold text-sky-600 size-4']" /> {{ t('settings.pages.account.sections.recharge.trust.traceable') }}</span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        :icon="isLoadingPaymentProducts || isLoadingPaymentOrders ? undefined : 'i-solar:refresh-bold'"
        :loading="isLoadingPaymentProducts || isLoadingPaymentOrders"
        :title="t('settings.pages.account.sections.recharge.actions.refresh')"
        :aria-label="t('settings.pages.account.sections.recharge.actions.refresh')"
        :disabled="isLoadingPaymentProducts || isLoadingPaymentOrders"
        :class="[
          'size-9! shrink-0 p-0!',
          'border border-[var(--airi-border-subtle)]',
        ]"
        @click="loadPayments"
      />
    </div>

    <div v-if="isLoadingPaymentProducts && paymentProducts.length === 0" :class="['grid gap-2 p-4']">
      <div v-for="index in 3" :key="index" :class="['h-20 animate-pulse rounded-md bg-[var(--airi-surface-control-muted)]']" />
    </div>

    <div v-else-if="productErrorMessage && paymentProducts.length === 0" :class="['p-4']">
      <div :class="['flex items-start gap-3 rounded-md px-3 py-3', 'airi-status-error']">
        <span :class="['i-solar:danger-triangle-bold-duotone mt-0.5 size-5 shrink-0']" />
        <div :class="['min-w-0']">
          <div :class="['text-sm font-medium']">
            {{ t('settings.pages.account.sections.recharge.channel-unavailable') }}
          </div>
          <div :class="['mt-1 break-words text-xs opacity-80']">
            {{ productErrorMessage }}
          </div>
        </div>
      </div>
    </div>

    <div v-else-if="paymentProducts.length === 0" :class="['p-6 text-center text-sm airi-text-muted']">
      {{ t('settings.pages.account.sections.recharge.empty-products') }}
    </div>

    <div v-else :class="['grid bg-[var(--airi-surface-field)] backdrop-blur-xl lg:grid-cols-[minmax(0,1.35fr)_minmax(20rem,0.65fr)]']">
      <div :class="['min-w-0 p-5', 'border-b border-[var(--airi-border-subtle)]', 'lg:border-b-0 lg:border-r']">
        <div :class="['mb-5 grid grid-cols-2 rounded-md bg-[var(--airi-surface-control-muted)] p-1']" role="tablist">
          <button
            v-for="kind in (['membership', 'points'] as const)"
            :key="kind"
            type="button"
            role="tab"
            :aria-selected="selectedKind === kind"
            :class="[
              'min-h-10 rounded px-3 text-sm font-semibold outline-none transition-colors',
              selectedKind === kind
                ? kind === 'membership'
                  ? 'bg-amber-50 text-amber-800 shadow-sm dark:bg-amber-950/55 dark:text-amber-200'
                  : 'bg-sky-50 text-sky-800 shadow-sm dark:bg-sky-950/55 dark:text-sky-200'
                : 'airi-text-muted hover:airi-text',
            ]"
            @click="selectedKind = kind"
          >
            <span :class="[kind === 'membership' ? 'i-solar:crown-star-bold-duotone' : 'i-solar:wallet-money-bold-duotone', 'mr-2 inline-block size-4 align-text-bottom']" />
            {{ t(`settings.pages.account.sections.recharge.kinds.${kind}`) }}
          </button>
        </div>
        <div :class="['mb-3 flex items-center justify-between gap-3']">
          <span :class="['text-sm font-semibold airi-text']">
            {{ t('settings.pages.account.sections.recharge.choose-plan') }}
          </span>
          <span :class="['text-xs airi-text-muted']">{{ t('settings.pages.account.sections.recharge.package.value-hint') }}</span>
        </div>
        <div role="radiogroup" :aria-label="t('settings.pages.account.sections.recharge.choose-plan')" :class="['grid gap-3', selectedKind === 'membership' ? 'md:grid-cols-3' : 'sm:grid-cols-2 xl:grid-cols-3']">
          <button
            v-for="product in visibleProducts"
            :key="product.sku"
            type="button"
            role="radio"
            :aria-checked="selectedSku === product.sku"
            :class="[
              'relative flex min-h-48 w-full flex-col items-stretch gap-3 overflow-hidden px-4 py-4 text-left',
              'rounded-md border-2 outline-none transition-[border-color,background-color,transform,box-shadow]',
              'focus-visible:ring-2 focus-visible:ring-[var(--airi-border-accent)]',
              selectedSku === product.sku
                ? productSelectionClass(product)
                : 'border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card)] hover:border-[var(--airi-border-accent)]',
            ]"
            @click="selectProduct(product.sku)"
          >
            <span :class="['flex items-center justify-between gap-2']">
              <span :class="['text-sm font-semibold airi-text']">{{ planLabel(product) }}</span>
              <span v-if="selectedSku === product.sku" :class="['rounded px-2 py-0.5 text-[11px] font-medium', productBadgeClass(product)]">{{ t('settings.pages.account.sections.recharge.package.selected') }}</span>
            </span>
            <span :class="['flex items-center gap-2']">
              <span :class="['grid size-8 shrink-0 place-items-center rounded-md', pointTone(product)]"><span :class="['i-solar:bolt-circle-bold-duotone size-5']" /></span>
              <span :class="['block text-3xl font-semibold tabular-nums', pointTone(product).split(' ').slice(0, 2)]">{{ formatNumber(totalPoints(product)) }}</span>
            </span>
            <span :class="['-mt-2 text-xs font-medium airi-text-muted']">{{ t(product.kind === 'membership' ? 'settings.pages.account.sections.recharge.package.included' : 'settings.pages.account.sections.recharge.package.total') }}</span>
            <span :class="['grid gap-1 text-xs airi-text-muted']">
              <template v-if="product.kind === 'membership'">
                <span :class="['font-medium text-emerald-700 dark:text-emerald-300']">{{ t('settings.pages.account.sections.recharge.package.daily', { points: formatNumber(product.dailyRewardPoints) }) }}</span>
                <span>{{ t('settings.pages.account.sections.recharge.package.cap', { points: formatNumber(product.storageCapPoints) }) }}</span>
                <span>{{ t('settings.pages.account.sections.recharge.package.period', { days: product.validDays }) }}</span>
              </template>
              <template v-else>
                <span>{{ t('settings.pages.account.sections.recharge.package.base', { points: formatNumber(product.basePoints) }) }}</span>
                <span v-if="product.giftPoints" :class="['font-medium text-emerald-700 dark:text-emerald-300']">{{ t('settings.pages.account.sections.recharge.package.gift', { points: formatNumber(product.giftPoints) }) }}</span>
                <span>{{ t('settings.pages.account.sections.recharge.package.value', { days: product.validDays, points: pointValue(product) }) }}</span>
              </template>
            </span>
            <span :class="['mt-auto border-t border-[var(--airi-border-subtle)] pt-3 text-lg font-semibold tabular-nums airi-text']">
              {{ formatCurrency(product.amountCents, product.currency) }}
            </span>
          </button>
        </div>

        <div :class="['mt-5 border-t border-[var(--airi-border-subtle)] pt-5']">
          <div :class="['mb-3 text-sm font-semibold airi-text']">
            {{ t('settings.pages.account.sections.recharge.choose-method') }}
          </div>
          <div role="radiogroup" :aria-label="t('settings.pages.account.sections.recharge.choose-method')" :class="['grid grid-cols-2 gap-3']">
            <button
              v-for="method in paymentMethodOptions"
              :key="method.value"
              type="button"
              role="radio"
              :aria-checked="method.available && paymentMethod === method.value"
              :disabled="!method.available"
              :class="[
                'inline-flex min-h-14 min-w-0 items-center justify-center gap-3',
                'rounded-md border-2 px-3 text-sm font-semibold outline-none transition-colors',
                'focus-visible:ring-2 focus-visible:ring-[var(--airi-border-accent)]',
                !method.available ? 'cursor-not-allowed opacity-45' : '',
                method.available && paymentMethod === method.value ? `${method.selectedClass} shadow-sm` : 'border-[var(--airi-border-subtle)] bg-[var(--airi-surface-control-muted)] airi-text hover:border-[var(--airi-border-accent)]',
              ]"
              @click="paymentMethod = method.value"
            >
              <span :class="[method.icon, method.color, 'size-6 shrink-0']" />
              <span class="truncate">{{ method.label }}</span>
            </button>
          </div>
          <div v-if="paymentMethods.length > 0" :class="['mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs airi-text-muted']">
            <span v-for="method in paymentMethodOptions" :key="`${method.value}-status`" :class="['inline-flex items-center gap-1.5']">
              <span :class="[method.available ? 'i-solar:check-circle-bold text-emerald-600' : 'i-solar:close-circle-bold text-rose-500', 'size-3.5']" />
              {{ method.label }} · {{ t(method.available ? 'settings.pages.account.sections.recharge.availability.available' : 'settings.pages.account.sections.recharge.availability.unavailable') }}
            </span>
          </div>
        </div>
      </div>

      <div :class="['flex min-w-0 flex-col bg-[var(--airi-surface-card)] p-5']">
        <template v-if="selectedProduct">
          <div :class="['flex items-center gap-2 text-sm font-semibold airi-text']">
            <span :class="['i-solar:bill-check-bold-duotone size-5 text-[var(--airi-accent-strong)]']" />
            {{ t('settings.pages.account.sections.recharge.confirmation.title') }}
          </div>
          <dl :class="['mt-3 grid grid-cols-[minmax(7rem,1fr)_minmax(0,1.3fr)]', 'gap-x-4 gap-y-2 text-sm']">
            <dt class="airi-text-muted">
              {{ t('settings.pages.account.sections.recharge.package.label') }}
            </dt>
            <dd :class="['min-w-0 break-all text-right font-medium airi-text']">
              {{ planLabel(selectedProduct) }}
            </dd>
            <dt class="airi-text-muted">
              {{ t('settings.pages.account.sections.recharge.confirmation.base') }}
            </dt>
            <dd :class="['text-right tabular-nums airi-text']">
              {{ formatNumber(selectedProduct.basePoints) }}
            </dd>
            <dt class="airi-text-muted">
              {{ t('settings.pages.account.sections.recharge.confirmation.gift') }}
            </dt>
            <dd :class="['text-right tabular-nums text-emerald-700 dark:text-emerald-300']">
              +{{ formatNumber(selectedProduct.giftPoints) }}
            </dd>
            <template v-if="selectedProduct.kind === 'membership'">
              <dt class="airi-text-muted">
                {{ t('settings.pages.account.sections.recharge.confirmation.daily') }}
              </dt>
              <dd :class="['text-right tabular-nums airi-text']">
                {{ formatNumber(selectedProduct.dailyRewardPoints) }}
              </dd>
              <dt class="airi-text-muted">
                {{ t('settings.pages.account.sections.recharge.confirmation.maximum') }}
              </dt>
              <dd :class="['text-right tabular-nums airi-text']">
                {{ formatNumber(projectedMembershipPoints) }}
              </dd>
            </template>
            <dt class="airi-text-muted">
              {{ t('settings.pages.account.sections.recharge.confirmation.method') }}
            </dt>
            <dd :class="['text-right airi-text']">
              {{ selectedPaymentMethodAvailable ? methodLabel(paymentMethod) : t('settings.pages.account.sections.recharge.availability.none') }}
            </dd>
            <dt class="airi-text-muted">
              {{ t('settings.pages.account.sections.recharge.confirmation.expires') }}
            </dt>
            <dd :class="['text-right airi-text']">
              {{ t('settings.pages.account.sections.recharge.valid-days', { days: selectedProduct.validDays }) }}
            </dd>
            <dt :class="['border-t border-[var(--airi-border-subtle)] pt-2 font-medium airi-text']">
              {{ t('settings.pages.account.sections.recharge.confirmation.amount') }}
            </dt>
            <dd :class="['border-t border-[var(--airi-border-subtle)] pt-2', 'text-right text-2xl font-semibold tabular-nums', 'airi-text']">
              {{ formatCurrency(selectedProduct.amountCents, selectedProduct.currency) }}
            </dd>
          </dl>

          <div v-if="!isAuthenticated" :class="['mt-4 rounded-md px-3 py-2.5 text-sm', 'airi-status-info']">
            {{ t('settings.pages.account.sections.recharge.sign-in-required') }}
          </div>
          <div v-else-if="checkoutErrorMessage" :class="['mt-4 rounded-md px-3 py-2.5 text-sm', 'airi-status-error']">
            <div class="font-medium">
              {{ t('settings.pages.account.sections.recharge.channel-unavailable') }}
            </div>
            <div class="mt-1 break-words text-xs opacity-80">
              {{ checkoutErrorMessage }}
            </div>
          </div>

          <div :class="['mt-auto pt-5']">
            <Button
              :class="['h-12 w-full text-base font-semibold']"
              icon="i-solar:card-send-bold-duotone"
              :loading="isCreatingPaymentOrder"
              :disabled="!isAuthenticated || isCreatingPaymentOrder || !selectedPaymentMethodAvailable"
              @click="createOrder"
            >
              {{ t('settings.pages.account.sections.recharge.secure-create') }}
            </Button>
            <p :class="['mt-2 text-center text-[11px] leading-5 airi-text-muted']">
              {{ t('settings.pages.account.sections.recharge.charge-notice') }}
            </p>
          </div>
        </template>
      </div>
    </div>

    <DialogRoot :open="checkoutOpen && Boolean(activePaymentOrder)" @update:open="checkoutOpen = $event">
      <DialogPortal>
        <DialogOverlay :class="['fixed inset-0 z-100 bg-black/50 backdrop-blur-sm']" />
        <DialogContent
          v-if="activePaymentOrder"
          ref="checkoutPanel"
          :class="[
            'fixed left-1/2 top-1/2 z-101 max-h-[min(92vh,760px)] w-[min(94vw,720px)] overflow-y-auto',
            'rounded-lg border bg-[var(--airi-surface-panel)] p-5 outline-none',
            checkoutChannelClass,
            '-translate-x-1/2 -translate-y-1/2',
          ]"
        >
          <div :class="['flex flex-wrap items-center justify-between gap-3']">
            <div :class="['min-w-0']">
              <div :class="['flex flex-wrap items-center gap-2']">
                <DialogTitle :class="['text-lg font-semibold airi-text']">
                  {{ t('settings.pages.account.sections.recharge.checkout.title') }}
                </DialogTitle>
                <span :class="['text-xs airi-text-muted']">{{ methodLabel(activePaymentOrder.paymentMethod) }}</span>
                <span :class="['rounded px-2 py-0.5', 'text-xs font-medium', statusClass(activePaymentOrder.status)]">{{ statusLabel(activePaymentOrder.status) }}</span>
              </div>
              <DialogDescription :class="['mt-1 text-xs airi-text-muted']">
                {{ t('settings.pages.account.sections.recharge.checkout.description') }}
              </DialogDescription>
              <div :class="['mt-1 break-all font-mono text-xs airi-text-muted']">
                {{ activePaymentOrder.id }}
              </div>
            </div>
            <div :class="['flex items-center gap-2']">
              <span v-if="activePaymentOrder.status === 'pending'" :class="['font-mono text-sm tabular-nums airi-text']">{{ checkoutCountdown }}</span>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                icon="i-solar:refresh-bold"
                :loading="isPollingPaymentOrder"
                :title="t('settings.pages.account.sections.recharge.actions.refresh-order')"
                :aria-label="t('settings.pages.account.sections.recharge.actions.refresh-order')"
                :disabled="isPollingPaymentOrder"
                :class="['size-9! p-0!', 'border border-[var(--airi-border-subtle)]']"
                @click="refreshActiveOrder"
              />
            </div>
          </div>

          <dl :class="['mt-4 grid gap-x-6 gap-y-2 border-y border-[var(--airi-border-subtle)] py-3 text-xs sm:grid-cols-2']">
            <div :class="['flex items-center justify-between gap-3']">
              <dt class="airi-text-muted">
                {{ t('settings.pages.account.sections.recharge.order.amount') }}
              </dt><dd :class="['font-semibold tabular-nums airi-text']">
                {{ formatCurrency(activePaymentOrder.amountCents, activePaymentOrder.currency) }}
              </dd>
            </div>
            <div :class="['flex items-center justify-between gap-3']">
              <dt class="airi-text-muted">
                {{ t('settings.pages.account.sections.recharge.order.points') }}
              </dt><dd :class="['font-semibold tabular-nums airi-text']">
                {{ formatNumber(activePaymentOrder.basePoints + activePaymentOrder.giftPoints) }}
              </dd>
            </div>
            <div :class="['flex items-center justify-between gap-3']">
              <dt class="airi-text-muted">
                {{ t('settings.pages.account.sections.recharge.order.created') }}
              </dt><dd class="airi-text">
                {{ formatDate(activePaymentOrder.createdAt) }}
              </dd>
            </div>
            <div :class="['flex items-center justify-between gap-3']">
              <dt class="airi-text-muted">
                {{ t('settings.pages.account.sections.recharge.order.expires') }}
              </dt><dd class="airi-text">
                {{ formatDate(activePaymentOrder.expiresAt) }}
              </dd>
            </div>
          </dl>

          <div v-if="activePaymentOrder.status === 'paid'" :class="['mt-4 flex items-start gap-3 rounded-lg border border-pink-400/35 bg-pink-500/9 px-4 py-3 shadow-[0_8px_26px_rgba(236,72,153,0.10)]']">
            <span :class="['i-solar:heart-shine-bold-duotone mt-0.5 size-5 shrink-0 text-pink-600 dark:text-pink-300']" />
            <div>
              <div class="wuwiii-thank-you text-sm font-semibold">
                {{ t('settings.pages.account.sections.recharge.thanks.title') }}
              </div>
              <p :class="['mt-1 text-xs leading-5 airi-text-muted']">
                {{ t('settings.pages.account.sections.recharge.thanks.description') }}
              </p>
            </div>
          </div>

          <div v-if="activePaymentOrder.status === 'failed'" :class="['mt-4 rounded-md px-4 py-3 text-sm airi-status-error']">
            <div class="font-semibold">
              {{ t('settings.pages.account.sections.recharge.checkout.failed-title') }}
            </div>
            <p class="mt-1 text-xs opacity-80">
              {{ t('settings.pages.account.sections.recharge.checkout.failed-description') }}
            </p>
          </div>

          <div v-if="activePaymentOrder.status === 'pending' && activePaymentCheckout" :class="['mt-4 rounded-md border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card)] p-4']">
            <div v-if="activePaymentCheckout.kind === 'mock'" :class="['rounded-md border border-dashed border-amber-500/40', 'bg-amber-500/8 p-3']">
              <div :class="['flex items-center gap-2 text-sm font-medium text-amber-800 dark:text-amber-200']">
                <span class="i-solar:test-tube-bold-duotone size-5" />
                {{ t('settings.pages.account.sections.recharge.checkout.mock-title') }}
              </div>
              <p :class="['mt-1 text-xs leading-5 text-amber-800/80 dark:text-amber-100/70']">
                {{ t('settings.pages.account.sections.recharge.checkout.mock-description') }}
              </p>
              <code :class="['mt-2 block break-all rounded bg-black/5 px-2 py-1.5 text-xs dark:bg-white/8']">{{ activePaymentCheckout.value }}</code>
            </div>
            <img
              v-else-if="activePaymentCheckout.kind === 'image' && activeCheckoutImage"
              :src="activeCheckoutImage"
              :alt="t('settings.pages.account.sections.recharge.checkout.image-alt')"
              :class="['mx-auto size-48 object-contain', 'rounded-md border border-[var(--airi-border-subtle)]']"
            >
            <div v-else-if="qrCodeDataUrl" :class="['grid items-center gap-5 sm:grid-cols-[18rem_minmax(0,1fr)]']">
              <img :src="qrCodeDataUrl" :alt="t('settings.pages.account.sections.recharge.checkout.image-alt')" :class="['mx-auto size-72 max-w-full rounded-md border border-[var(--airi-border-subtle)] bg-white object-contain p-2']">
              <div :class="['min-w-0']">
                <div :class="['flex items-center gap-2 text-base font-semibold airi-text']">
                  <span :class="[activePaymentOrder.paymentMethod === 'wechat' ? 'i-simple-icons:wechat text-[#07c160]' : 'i-simple-icons:alipay text-[#1677ff]', 'size-6']" />
                  {{ t(`settings.pages.account.sections.recharge.checkout.scan-${activePaymentOrder.paymentMethod}`) }}
                </div>
                <p :class="['mt-2 text-sm leading-6 airi-text-muted']">
                  {{ t('settings.pages.account.sections.recharge.checkout.scan-description') }}
                </p>
                <a
                  v-if="activePaymentOrder.paymentMethod === 'alipay' && activeCheckoutUrl"
                  :href="activeCheckoutUrl"
                  target="_blank"
                  rel="noopener noreferrer"
                  :class="['mt-4 inline-flex h-11 items-center gap-2 rounded-md bg-[#1677ff] px-4 text-sm font-semibold text-white outline-none', 'focus-visible:ring-2 focus-visible:ring-[#1677ff] focus-visible:ring-offset-2']"
                >
                  <span class="i-solar:arrow-right-up-linear size-4" />
                  {{ t('settings.pages.account.sections.recharge.checkout.open-alipay') }}
                </a>
              </div>
            </div>
            <div v-else-if="qrCodeError" :class="['rounded-md px-3 py-2.5 text-sm airi-status-error']">
              {{ t('settings.pages.account.sections.recharge.checkout.qr-failed') }}
            </div>
            <div v-else :class="['rounded-md px-3 py-2.5 text-sm airi-status-info']">
              {{ t('settings.pages.account.sections.recharge.checkout.waiting') }}
            </div>
          </div>
        </DialogContent>
      </DialogPortal>
    </DialogRoot>

    <div v-if="isAuthenticated" :class="['border-t border-[var(--airi-border-subtle)] p-4']">
      <div :class="['mb-2 flex items-center justify-between gap-3']">
        <div :class="['text-sm font-medium airi-text']">
          {{ t('settings.pages.account.sections.recharge.history.title') }}
        </div>
        <span :class="['flex items-center gap-3 text-xs airi-text-muted']"><a href="http://127.0.0.1:5173/help/refund" target="_blank" rel="noopener noreferrer" :class="['font-medium text-[var(--airi-accent-strong)] hover:underline']">{{ t('settings.pages.account.sections.recharge.history.refund-help') }}</a><span>{{ paymentOrders.length }}</span></span>
      </div>
      <div v-if="isLoadingPaymentOrders && paymentOrders.length === 0" :class="['h-16 animate-pulse rounded-md bg-[var(--airi-surface-control-muted)]']" />
      <div v-else-if="ordersErrorMessage && paymentOrders.length === 0" :class="['rounded-md px-3 py-2.5 text-sm airi-status-error']">
        {{ ordersErrorMessage }}
      </div>
      <div v-else-if="paymentOrders.length === 0" :class="['rounded-md py-5 text-center text-sm airi-text-muted']">
        {{ t('settings.pages.account.sections.recharge.history.empty') }}
      </div>
      <div v-else :class="['divide-y divide-[var(--airi-border-subtle)]']">
        <button
          v-for="order in visibleOrders"
          :key="order.id"
          type="button"
          :class="[
            'grid min-h-16 w-full grid-cols-[minmax(0,1fr)_auto] items-center',
            'gap-3 py-3 text-left outline-none',
            'hover:bg-[var(--airi-surface-control-muted)]',
            'focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--airi-border-accent)]',
          ]"
          @click="openOrder(order.id).then(() => checkoutOpen = true)"
        >
          <span :class="['min-w-0']">
            <span :class="['flex flex-wrap items-center gap-2']">
              <span :class="['truncate font-mono text-xs airi-text']">{{ order.id }}</span>
              <span :class="['rounded px-1.5 py-0.5 text-[11px] font-medium', statusClass(order.status)]">{{ statusLabel(order.status) }}</span>
            </span>
            <span :class="['mt-1 flex flex-wrap gap-x-2 gap-y-1 text-xs airi-text-muted']">
              <span>{{ formatDate(order.createdAt) }}</span>
              <span>{{ methodLabel(order.paymentMethod) }}</span>
              <span>{{ t('settings.pages.account.sections.recharge.history.points', { base: formatNumber(order.basePoints), gift: formatNumber(order.giftPoints) }) }}</span>
              <span v-if="order.status === 'refunded'" class="text-sky-700 dark:text-sky-300">{{ t('settings.pages.account.sections.recharge.history.refunded') }}</span>
            </span>
          </span>
          <span :class="['text-right text-sm font-semibold tabular-nums airi-text']">{{ formatCurrency(order.amountCents, order.currency) }}</span>
        </button>
      </div>
      <button
        v-if="paymentOrders.length > 5"
        type="button"
        :class="['mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[var(--airi-accent-strong)] hover:underline']"
        @click="showAllOrders = !showAllOrders"
      >
        {{ showAllOrders ? t('settings.pages.account.sections.recharge.history.show-recent') : t('settings.pages.account.sections.recharge.history.show-all') }}
        <span :class="[showAllOrders ? 'i-solar:alt-arrow-up-linear' : 'i-solar:alt-arrow-down-linear', 'size-4']" />
      </button>
    </div>
  </section>
</template>

<style scoped>
.wuwiii-checkout-ribbon {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  height: 3px;
}

.wuwiii-checkout-ribbon span:nth-child(1) { background: #38a169; }
.wuwiii-checkout-ribbon span:nth-child(2) { background: #1687d9; }
.wuwiii-checkout-ribbon span:nth-child(3) { background: #d89b25; }
.wuwiii-checkout-ribbon span:nth-child(4) { background: #cf6684; }

.wuwiii-thank-you {
  animation: wuwiii-thank-you-color 8s steps(1, end) infinite;
  color: #287957;
}

:global(.dark) .wuwiii-thank-you {
  animation-name: wuwiii-thank-you-color-dark;
  color: #72d6ad;
}

@keyframes wuwiii-thank-you-color {
  0%, 100% { color: #287957; }
  25% { color: #2676a8; }
  50% { color: #9b6b18; }
  75% { color: #a84f6a; }
}

@keyframes wuwiii-thank-you-color-dark {
  0%, 100% { color: #72d6ad; }
  25% { color: #78c7f2; }
  50% { color: #e4bd67; }
  75% { color: #e697ad; }
}

@media (prefers-reduced-motion: reduce) {
  .wuwiii-thank-you { animation: none; }
}
</style>
