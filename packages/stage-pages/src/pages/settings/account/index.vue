<script setup lang="ts">
import type { PublicUsageHistoryEntry } from '@proj-airi/stage-ui/stores/commerce'
import type { UsageHistoryDisplayItem } from '@proj-airi/stage-ui/stores/commerce-usage-history-display'

import type { DisplayLedgerEntry } from './ledger-display'

import { bindEmail, changeAccountPassword, fetchAuthVerificationCapabilities, isSupportedPhoneNumber, registerWithPhone, sendEmailBindingCode, sendEmailSignInCode, sendPhoneRegistrationCode, sendPhoneSignInCode, signInWithEmailCode, signInWithPassword, signInWithPhoneCode, signOut, VerificationCodeRateLimitError } from '@proj-airi/stage-ui/libs/auth'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useCommerceStore } from '@proj-airi/stage-ui/stores/commerce'
import { buildUsageHistoryDisplay } from '@proj-airi/stage-ui/stores/commerce-usage-history-display'
import { useOfficialPricingStore } from '@proj-airi/stage-ui/stores/official-pricing'
import { useProfileStore } from '@proj-airi/stage-ui/stores/profile'
import { BasicTextarea, Button, Input, SelectTab } from '@proj-airi/ui'
import { useEventListener, useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { DialogContent, DialogOverlay, DialogPortal, DialogRoot, DialogTitle } from 'reka-ui'
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'
import { toast } from 'vue-sonner'

import { buildDisplayLedger } from './ledger-display'

const { locale, t } = useI18n()
const router = useRouter()
const authStore = useAuthStore()
const commerceStore = useCommerceStore()
const officialPricingStore = useOfficialPricingStore()
const profileStore = useProfileStore()

const { isAuthenticated, user } = storeToRefs(authStore)
const { account, accountError, activeEntitlements, activePlan, availablePoints, balance, checkInState, isClaimingCheckIn, isLoading, isLoadingMoreLedger, isLoadingMoreRequestHistory, isLoadingRequestHistory, isRedeeming, ledgerCursor, recentLedger, requestHistory, requestHistoryAvailable, requestHistoryCursor, requestHistoryError, requestHistoryServerNow } = storeToRefs(commerceStore)
const { isSaving: isProfileSaving, profile } = storeToRefs(profileStore)

const activationCode = ref('')
const emailAuthMode = ref<'sign-in' | 'sign-up'>('sign-in')
const emailAuthEmail = ref('')
const emailAuthName = ref('')
const emailAuthPassword = ref('')
const authMethod = ref<'code' | 'password'>('password')
const authVerificationCode = ref('')
const authConfirmPassword = ref('')
const authVerificationCapabilities = ref({ emailOtp: false, phoneOtp: false, registration: false })
const isEmailAuthSubmitting = ref(false)
const isSendingVerificationCode = ref(false)
const verificationCodeCooldown = ref(0)
const isSigningOut = ref(false)
const bindingEmail = ref('')
const bindingEmailCode = ref('')
const isSendingBindingEmailCode = ref(false)
const bindingEmailCodeCooldown = ref(0)
const isBindingEmail = ref(false)
const currentPassword = ref('')
const newPassword = ref('')
const confirmNewPassword = ref('')
const isChangingPassword = ref(false)
const showPasswordForm = ref(false)
const isEditingProfile = ref(false)
const avatarLoadFailed = ref(false)
const avatarInput = ref<HTMLInputElement>()
const avatarPreviewFailed = ref(false)
const isProcessingAvatar = ref(false)
const profileHandle = ref('')
const profileDisplayName = ref('')
const profileRemoteAvatarUrl = ref('')
const profileAvatarDataUrl = ref('')
const profileBio = ref('')
const accountActivityTab = ref<'usage' | 'balance'>('usage')

const AVATAR_OUTPUT_SIZE = 256
const MAX_AVATAR_SOURCE_BYTES = 8 * 1024 * 1024
const MAX_AVATAR_DATA_URL_LENGTH = 512 * 1024
const SUPPORTED_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])
const ACTIVATION_CODE_WHITESPACE_RE = /\s+/g
const PROFILE_HANDLE_RE = /^[a-z0-9](?:[a-z0-9_]*[a-z0-9])?$/
const SIX_DIGIT_CODE_RE = /^\d{6}$/
const GROUP_REFERENCE_PREFIX_RE = /^group:/

const normalizedEmailAuthName = computed(() => emailAuthName.value.trim())
const normalizedAuthIdentity = computed(() => emailAuthEmail.value.trim())
const identityIsPhone = computed(() => isSupportedPhoneNumber(normalizedAuthIdentity.value))
const normalizedAuthVerificationCode = computed(() => authVerificationCode.value.trim())
const usesVerificationCode = computed(() => authMethod.value === 'code' || emailAuthMode.value === 'sign-up')
const canSendVerificationCode = computed(() => verificationCodeCooldown.value === 0 && !isSendingVerificationCode.value
  && (emailAuthMode.value === 'sign-up'
    ? authVerificationCapabilities.value.registration && identityIsPhone.value
    : identityIsPhone.value
      ? authVerificationCapabilities.value.phoneOtp
      : authVerificationCapabilities.value.emailOtp && normalizedAuthIdentity.value.includes('@')))
const normalizedActivationCode = computed(() => activationCode.value.trim().replace(ACTIVATION_CODE_WHITESPACE_RE, '').toUpperCase())
const canSubmitEmailAuth = computed(() => {
  if (isEmailAuthSubmitting.value)
    return false

  if (usesVerificationCode.value) {
    const hasValidAccount = identityIsPhone.value || normalizedAuthIdentity.value.includes('@')
    if (emailAuthMode.value === 'sign-up')
      return authVerificationCapabilities.value.registration && identityIsPhone.value && normalizedEmailAuthName.value.length > 0 && emailAuthPassword.value.length >= 8 && emailAuthPassword.value === authConfirmPassword.value && SIX_DIGIT_CODE_RE.test(normalizedAuthVerificationCode.value)
    return hasValidAccount && SIX_DIGIT_CODE_RE.test(normalizedAuthVerificationCode.value)
  }

  if (normalizedAuthIdentity.value.length === 0 || emailAuthPassword.value.length < 8)
    return false
  return true
})
const canRedeem = computed(() => isAuthenticated.value && normalizedActivationCode.value.length > 0 && !isRedeeming.value)
const canClaimCheckIn = computed(() => isAuthenticated.value && !!checkInState.value?.canClaim && !isClaimingCheckIn.value)
function formatPlanLabel(plan: string) {
  const labels: Record<string, string> = {
    free: t('settings.pages.account.plans.free'),
    lite: t('settings.pages.account.plans.lite'),
    pro: t('settings.pages.account.plans.pro'),
    creator: t('settings.pages.account.plans.creator'),
    custom: t('settings.pages.account.plans.custom'),
  }
  return labels[plan] ?? plan
}
const checkInDescription = computed(() => checkInState.value?.plan === 'free'
  ? t('settings.pages.account.sections.check-in.description-free', {
      cap: formatNumber(checkInState.value.storageCapPoints),
      points: formatNumber(checkInState.value.dailyRewardPoints),
    })
  : t('settings.pages.account.sections.check-in.description-member', {
      cap: formatNumber(checkInState.value?.storageCapPoints ?? 0),
      plan: formatPlanLabel(checkInState.value?.plan ?? activePlan.value),
      points: formatNumber(checkInState.value?.dailyRewardPoints ?? 0),
    }))
const currentEntitlement = computed(() => activeEntitlements.value[0])
const displayLedger = computed(() => buildDisplayLedger(recentLedger.value))
const usageHistoryDisplay = computed(() => buildUsageHistoryDisplay(requestHistory.value, {
  hasMore: !!requestHistoryCursor.value,
}))
const hasProcessingUsage = computed(() => requestHistory.value.some(entry => entry.billingStatus === 'processing'))
const accountActivityTabOptions = computed(() => [
  { icon: 'i-solar:bill-list-bold-duotone', label: t('settings.pages.account.sections.account-activity.tabs.usage'), value: 'usage' },
  { icon: 'i-solar:wallet-money-bold-duotone', label: t('settings.pages.account.sections.account-activity.tabs.balance'), value: 'balance' },
])
const localTimeZoneLabel = computed(() => {
  const referenceDate = requestHistoryServerNow.value ? new Date(requestHistoryServerNow.value) : new Date()
  const offset = new Intl.DateTimeFormat(locale.value, { timeZoneName: 'shortOffset' })
    .formatToParts(referenceDate)
    .find(part => part.type === 'timeZoneName')
    ?.value
  return offset || Intl.DateTimeFormat().resolvedOptions().timeZone
})
const officialPriceSummary = computed(() => officialPricingStore.snapshot)
const officialChatMultiplier = computed(() => officialPricingStore.getFeature('official-chat')?.multiplier ?? 1)
const featurePricingTranslationKeys: Record<string, string> = {
  'official-chat': 'official-chat',
  'inner-voice-note': 'inner-voice-note',
  'workbench': 'workbench',
  'entertainment.turtle_soup.host': 'turtle-soup-host',
  'entertainment.turtle_soup.hint': 'turtle-soup-hint',
  'entertainment.turtle_soup.review': 'turtle-soup-review',
  'entertainment.turtle_soup.generate': 'turtle-soup-generate',
}
function featurePricingLabel(feature: string) {
  const key = featurePricingTranslationKeys[feature]
  return key ? t(`settings.pages.account.sections.pricing.features.${key}`) : feature
}
function modelDisplayPoints(model: { id: string, pointsPerTokenUnit: number }) {
  return model.pointsPerTokenUnit * officialChatMultiplier.value
}
function featureMinimumPoints(feature: string, multiplier: number) {
  if (feature === 'official-chat' || feature === 'workbench')
    return
  const defaultModel = officialPricingStore.getModel('airi-default')
  return defaultModel ? defaultModel.minimumSettlePoints * multiplier : undefined
}
const membershipIdentity = computed(() => ({
  creator: t('settings.pages.account.membership-identities.creator'),
  custom: t('settings.pages.account.membership-identities.creator'),
  free: t('settings.pages.account.membership-identities.free'),
  lite: t('settings.pages.account.membership-identities.lite'),
  pro: t('settings.pages.account.membership-identities.pro'),
}[activePlan.value] ?? t('settings.pages.account.membership-identities.free')))
const availablePointsTone = computed(() => availablePoints.value >= 150_000
  ? 'text-[var(--airi-accent-strong)]'
  : availablePoints.value >= 50_000
    ? 'text-[var(--airi-text)]'
    : 'text-[var(--airi-text-muted)]')
const profileInitial = computed(() => (profile.value?.displayName || user.value?.name || user.value?.email || '?').trim().charAt(0).toUpperCase())
const profileDraftInitial = computed(() => (profileDisplayName.value || profileHandle.value || '?').trim().charAt(0).toUpperCase())
const profileAvatarDraftUrl = computed(() => profileAvatarDataUrl.value || profileRemoteAvatarUrl.value.trim())
const visibleAccountEmail = computed(() => user.value?.email?.endsWith('@phone.wuwiii.local') ? t('settings.pages.account.sections.security.email-unbound') : user.value?.email)
const hasBoundEmail = computed(() => !!user.value?.email && !user.value.email.endsWith('@phone.wuwiii.local'))
const visibleAccountPhone = computed(() => (user.value as typeof user.value & { phoneNumber?: string })?.phoneNumber || t('settings.pages.account.sections.security.phone-unbound'))
const canChangePassword = computed(() => currentPassword.value.length >= 8 && newPassword.value.length >= 8 && newPassword.value === confirmNewPassword.value && !isChangingPassword.value)
const bindingEmailIsValid = computed(() => {
  const value = bindingEmail.value.trim()
  const at = value.indexOf('@')
  return at > 0 && at < value.length - 1 && value.slice(at + 1).includes('.')
})
const canSendBindingEmailCode = computed(() => authVerificationCapabilities.value.emailOtp && bindingEmailIsValid.value && bindingEmailCodeCooldown.value === 0 && !isSendingBindingEmailCode.value)
const verificationCodeButtonLabel = computed(() => verificationCodeCooldown.value > 0
  ? t('settings.pages.account.actions.resend-code-in', { seconds: verificationCodeCooldown.value })
  : t('settings.pages.account.actions.send-code'))
const bindingEmailCodeButtonLabel = computed(() => bindingEmailCodeCooldown.value > 0
  ? t('settings.pages.account.actions.resend-code-in', { seconds: bindingEmailCodeCooldown.value })
  : t('settings.pages.account.actions.send-code'))
const verificationCooldownTimer = window.setInterval(() => {
  verificationCodeCooldown.value = Math.max(0, verificationCodeCooldown.value - 1)
  bindingEmailCodeCooldown.value = Math.max(0, bindingEmailCodeCooldown.value - 1)
}, 1_000)
onBeforeUnmount(() => window.clearInterval(verificationCooldownTimer))
const canBindEmail = computed(() => bindingEmailIsValid.value && SIX_DIGIT_CODE_RE.test(bindingEmailCode.value.trim()) && !isBindingEmail.value)
const canSaveProfile = computed(() => {
  const handle = profileHandle.value.trim()
  const displayName = profileDisplayName.value.trim()
  const remoteAvatarUrl = profileRemoteAvatarUrl.value.trim()
  return !isProfileSaving.value
    && !isProcessingAvatar.value
    && PROFILE_HANDLE_RE.test(handle)
    && handle.length >= 3
    && handle.length <= 24
    && displayName.length >= 1
    && displayName.length <= 48
    && (profileAvatarDataUrl.value.length > 0 || !remoteAvatarUrl || normalizeExternalUrl(remoteAvatarUrl) !== undefined)
    && profileBio.value.trim().length <= 280
})

function syncProfileDraft() {
  const avatarUrl = profile.value?.avatarUrl ?? ''
  profileHandle.value = profile.value?.handle ?? ''
  profileDisplayName.value = profile.value?.displayName ?? ''
  profileAvatarDataUrl.value = avatarUrl.startsWith('data:image/') ? avatarUrl : ''
  profileRemoteAvatarUrl.value = avatarUrl.startsWith('data:image/') ? '' : avatarUrl
  profileBio.value = profile.value?.bio ?? ''
  avatarPreviewFailed.value = false
}

function startProfileEdit() {
  syncProfileDraft()
  isEditingProfile.value = true
}

function cancelProfileEdit() {
  syncProfileDraft()
  isEditingProfile.value = false
}

function handleProfileDialogOpenChange(open: boolean) {
  if (open)
    startProfileEdit()
  else
    cancelProfileEdit()
}

function openAvatarPicker() {
  avatarInput.value?.click()
}

function removeAvatarDraft() {
  profileAvatarDataUrl.value = ''
  profileRemoteAvatarUrl.value = ''
  avatarPreviewFailed.value = false
}

async function resizeAvatar(file: File) {
  if (!SUPPORTED_AVATAR_TYPES.has(file.type))
    throw new Error(t('settings.pages.account.status.avatar-invalid-type'))
  if (file.size > MAX_AVATAR_SOURCE_BYTES)
    throw new Error(t('settings.pages.account.status.avatar-too-large'))

  const image = await createImageBitmap(file)
  try {
    const side = Math.min(image.width, image.height)
    const sourceX = Math.floor((image.width - side) / 2)
    const sourceY = Math.floor((image.height - side) / 2)
    const canvas = document.createElement('canvas')
    canvas.width = AVATAR_OUTPUT_SIZE
    canvas.height = AVATAR_OUTPUT_SIZE
    const context = canvas.getContext('2d')
    if (!context)
      throw new Error(t('settings.pages.account.status.avatar-process-failed'))

    context.drawImage(image, sourceX, sourceY, side, side, 0, 0, AVATAR_OUTPUT_SIZE, AVATAR_OUTPUT_SIZE)
    const dataUrl = canvas.toDataURL('image/webp', 0.86)
    if (dataUrl.length > MAX_AVATAR_DATA_URL_LENGTH)
      throw new Error(t('settings.pages.account.status.avatar-process-failed'))
    return dataUrl
  }
  finally {
    image.close()
  }
}

async function handleAvatarFileChange(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file)
    return

  isProcessingAvatar.value = true
  try {
    profileAvatarDataUrl.value = await resizeAvatar(file)
    profileRemoteAvatarUrl.value = ''
    avatarPreviewFailed.value = false
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.account.status.avatar-process-failed'))
  }
  finally {
    isProcessingAvatar.value = false
  }
}

async function saveProfile() {
  if (!canSaveProfile.value)
    return

  try {
    await profileStore.updateProfile({
      avatarUrl: profileAvatarDraftUrl.value || null,
      bio: profileBio.value.trim(),
      displayName: profileDisplayName.value.trim(),
      handle: profileHandle.value.trim(),
      locale: locale.value,
    })
    avatarLoadFailed.value = false
    isEditingProfile.value = false
    toast.success(t('settings.pages.account.status.profile-updated'))
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.account.status.profile-update-failed'))
  }
}

async function copyUserId() {
  const userId = profile.value?.userId ?? user.value?.id
  if (!userId)
    return

  try {
    await navigator.clipboard.writeText(userId)
    toast.success(t('settings.pages.account.status.user-id-copied'))
  }
  catch {
    toast.error(t('settings.pages.account.status.user-id-copy-failed'))
  }
}

function normalizeExternalUrl(value: string | undefined) {
  const rawUrl = value?.trim()
  if (!rawUrl)
    return undefined

  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:')
      return undefined

    return url.toString()
  }
  catch {
    return undefined
  }
}

function formatDate(value: string | null | undefined) {
  if (!value)
    return t('settings.pages.account.common.never')

  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return t('settings.pages.account.common.unknown')

  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

function finiteNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value))
    return value
  if (typeof value === 'string') {
    const parsed = Number(value)
    if (Number.isFinite(parsed))
      return parsed
  }
  return 0
}

function formatNumber(value: unknown) {
  return new Intl.NumberFormat(locale.value).format(finiteNumber(value))
}

function formatLedgerType(type: string, note: string | null) {
  if (type === 'refund') {
    return note === 'reply-display-failure-refund'
      ? t('settings.pages.account.sections.ledger.types.refunded-in-full', type)
      : t('settings.pages.account.sections.ledger.types.not-charged', type)
  }
  return t(`settings.pages.account.sections.ledger.types.${type}`, type)
}

function formatLedgerNote(note: string | null) {
  if (!note)
    return ''
  return t(`settings.pages.account.sections.ledger.features.${note}`, note)
}

function formatLedgerUsageContext(entry: DisplayLedgerEntry) {
  const parts: string[] = []
  if (entry.characterName?.trim())
    parts.push(entry.characterName.trim())
  if (entry.roomName?.trim())
    parts.push(entry.roomName.trim())
  if (entry.sourceSurface)
    parts.push(t(`settings.pages.account.sections.ledger.source-surfaces.${entry.sourceSurface}`, entry.sourceSurface))
  if (entry.note)
    parts.push(formatLedgerNote(entry.note))
  if (entry.usagePurpose)
    parts.push(t(`settings.pages.account.sections.ledger.purposes.${entry.usagePurpose}`, entry.usagePurpose))
  return parts.join(' · ')
}

function formatLedgerRefund(entry: DisplayLedgerEntry) {
  if (entry.note === 'reply-display-failure-refund') {
    return t('settings.pages.account.sections.ledger.refunded-display-failure', {
      points: entry.refundedPoints,
    })
  }
  if (entry.usagePurpose === 'main-reply') {
    return t('settings.pages.account.sections.ledger.refunded-main-reply', {
      points: entry.refundedPoints,
    })
  }
  if (entry.usagePurpose && entry.usagePurpose !== 'unknown') {
    return t('settings.pages.account.sections.ledger.refunded-auxiliary', {
      points: entry.refundedPoints,
      purpose: t(`settings.pages.account.sections.ledger.purposes.${entry.usagePurpose}`, entry.usagePurpose),
    })
  }
  return t('settings.pages.account.sections.ledger.refunded-unknown', {
    points: entry.refundedPoints,
  })
}

function amountClass(amount: number) {
  if (amount > 0)
    return 'text-emerald-600 dark:text-emerald-300'
  if (amount < 0)
    return 'text-sky-700 dark:text-sky-300'
  return 'airi-text-muted'
}

function formatUsageKind(entry: PublicUsageHistoryEntry) {
  const surface = t(`settings.pages.account.sections.usage-history.surfaces.${entry.surface}`)
  const purpose = t(`settings.pages.account.sections.usage-history.purposes.${entry.purpose}`, entry.purpose)
  const room = entry.roomName?.trim()
  const speaker = entry.characterName?.trim()
  return `${room ? `${room} · ` : ''}${speaker ? `${speaker} · ` : ''}${surface} · ${purpose}`
}

function formatUsageTitle(item: UsageHistoryDisplayItem) {
  if (item.kind === 'group') {
    const roomName = item.roomName
    if (!item.groupTurnId) {
      const characterName = item.characterName
      const title = t('settings.pages.account.sections.usage-history.groups.direct-title')
      return characterName ? `${characterName} · ${title}` : title
    }
    const title = t('settings.pages.account.sections.usage-history.groups.title', {
      count: item.children.length,
    })
    return roomName ? `${roomName} · ${title}` : title
  }
  return formatUsageKind(item.children[0]!)
}

function usageStatusClass(status: UsageHistoryDisplayItem['billingStatus']) {
  if (status === 'refunded')
    return 'text-emerald-600 dark:text-emerald-300'
  if (status === 'charged' || status === 'processing')
    return 'text-sky-600 dark:text-sky-300'
  if (status === 'review_pending')
    return 'text-amber-600 dark:text-amber-300'
  return 'airi-text-muted'
}

function formatUsagePoints(item: UsageHistoryDisplayItem) {
  if (item.billingStatus === 'processing') {
    if (item.netPoints > 0) {
      return t('settings.pages.account.sections.usage-history.points.charged-processing', {
        held: formatNumber(item.processingReservedPoints),
        points: formatNumber(item.netPoints),
      })
    }
    return t('settings.pages.account.sections.usage-history.points.processing', {
      points: formatNumber(item.processingReservedPoints),
    })
  }
  if (item.billingStatus === 'review_pending') {
    return t('settings.pages.account.sections.usage-history.points.review-pending', {
      points: formatNumber(item.netPoints),
    })
  }
  if (item.billingStatus === 'refunded') {
    return t('settings.pages.account.sections.usage-history.points.refunded', {
      points: formatNumber(item.refundedPoints),
    })
  }
  if (item.netPoints > 0) {
    return t('settings.pages.account.sections.usage-history.points.charged', {
      points: formatNumber(item.netPoints),
    })
  }
  return t('settings.pages.account.sections.usage-history.points.not-charged')
}

function formatUsageFailure(entry: PublicUsageHistoryEntry) {
  if (!entry.failureCategory)
    return ''
  return t(`settings.pages.account.sections.usage-history.failures.${entry.failureCategory}`)
}

function formatUsageRequestStatus(status: unknown) {
  const knownStatuses = new Set(['pending', 'succeeded', 'failed', 'cancelled'])
  const normalized = typeof status === 'string' && knownStatuses.has(status) ? status : 'unknown'
  return t(`settings.pages.account.sections.usage-history.request-statuses.${normalized}`)
}

function formatUsageBillingStatus(status: unknown) {
  const knownStatuses = new Set(['processing', 'not_charged', 'charged', 'refunded', 'review_pending'])
  const normalized = typeof status === 'string' && knownStatuses.has(status) ? status : 'unknown'
  return t(`settings.pages.account.sections.usage-history.statuses.${normalized}`)
}

function formatUsageTimestamp(value: string | null) {
  if (!value)
    return t('settings.pages.account.sections.usage-history.time.processing')
  const date = new Date(value)
  if (Number.isNaN(date.getTime()))
    return t('settings.pages.account.common.unknown')
  return new Intl.DateTimeFormat(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(date)
}

function shortReference(id: string) {
  return id.replace(GROUP_REFERENCE_PREFIX_RE, '').slice(0, 8)
}

function isModelUsageAudit(entry: DisplayLedgerEntry) {
  return entry.source === 'model_usage'
}

async function refreshAccountState() {
  if (!isAuthenticated.value)
    return

  try {
    await Promise.all([
      commerceStore.fetchAccountState(),
      commerceStore.fetchCheckInState(),
      commerceStore.fetchRequestHistory(),
      profileStore.fetchProfile(),
    ])
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.account.status.fetch-failed'))
  }
}

async function handleLoadMoreLedger() {
  try {
    await commerceStore.fetchMoreLedger()
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.account.sections.ledger.load-failed'))
  }
}

async function handleLoadMoreRequestHistory() {
  try {
    await commerceStore.fetchMoreRequestHistory()
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.account.sections.usage-history.load-failed'))
  }
}

async function handleRetryUsageHistory() {
  try {
    await Promise.all([
      commerceStore.fetchRequestHistory({ force: true }),
      commerceStore.fetchAccountState(),
    ])
  }
  catch {
    // The inline state remains actionable and avoids duplicating the same error in a toast.
  }
}

async function handleRetryAccount() {
  try {
    await commerceStore.fetchAccountState()
  }
  catch {
    // The inline state remains actionable and avoids duplicating the same error in a toast.
  }
}

async function handleSendVerificationCode() {
  if (!canSendVerificationCode.value)
    return

  isSendingVerificationCode.value = true
  try {
    if (emailAuthMode.value === 'sign-up')
      await sendPhoneRegistrationCode(normalizedAuthIdentity.value)
    else if (identityIsPhone.value)
      await sendPhoneSignInCode(normalizedAuthIdentity.value)
    else
      await sendEmailSignInCode(normalizedAuthIdentity.value)
    verificationCodeCooldown.value = 60
    toast.success(t('settings.pages.account.status.verification-code-sent'))
  }
  catch (error) {
    if (error instanceof VerificationCodeRateLimitError) {
      verificationCodeCooldown.value = Math.max(1, error.retryAfterSeconds)
      toast.error(t('settings.pages.account.status.verification-code-rate-limited', { seconds: error.retryAfterSeconds }))
    }
    else {
      toast.error(error instanceof Error ? error.message : t('settings.pages.account.status.verification-auth-failed'))
    }
  }
  finally {
    isSendingVerificationCode.value = false
  }
}

async function handleEmailAuth() {
  if (!canSubmitEmailAuth.value)
    return

  isEmailAuthSubmitting.value = true
  try {
    if (emailAuthMode.value === 'sign-up') {
      await registerWithPhone({
        code: normalizedAuthVerificationCode.value,
        confirmPassword: authConfirmPassword.value,
        name: normalizedEmailAuthName.value,
        password: emailAuthPassword.value,
        phoneNumber: normalizedAuthIdentity.value,
      })
      toast.success(t('settings.pages.account.status.signed-up'))
    }
    else if (authMethod.value === 'code' && identityIsPhone.value) {
      await signInWithPhoneCode({
        code: normalizedAuthVerificationCode.value,
        phoneNumber: normalizedAuthIdentity.value,
      })
      toast.success(t('settings.pages.account.status.signed-in'))
    }
    else if (authMethod.value === 'code') {
      await signInWithEmailCode({
        code: normalizedAuthVerificationCode.value,
        email: normalizedAuthIdentity.value,
      })
      toast.success(t('settings.pages.account.status.signed-in'))
    }
    else {
      await signInWithPassword(normalizedAuthIdentity.value, emailAuthPassword.value)
      toast.success(t('settings.pages.account.status.signed-in'))
    }

    emailAuthPassword.value = ''
    authConfirmPassword.value = ''
    authVerificationCode.value = ''
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.account.status.email-auth-failed'))
  }
  finally {
    isEmailAuthSubmitting.value = false
  }
}

onMounted(() => {
  officialPricingStore.start()
  void fetchAuthVerificationCapabilities()
    .then(capabilities => authVerificationCapabilities.value = capabilities)
    .catch(() => {})
})
onBeforeUnmount(() => officialPricingStore.stop())

async function handleSignOut() {
  isSigningOut.value = true
  try {
    await signOut()
    commerceStore.reset()
    profileStore.reset()
    toast.success(t('settings.pages.account.status.signed-out'))
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.account.status.sign-out-failed'))
  }
  finally {
    isSigningOut.value = false
  }
}

async function handleSendBindingEmailCode() {
  if (!canSendBindingEmailCode.value)
    return
  isSendingBindingEmailCode.value = true
  try {
    await sendEmailBindingCode(bindingEmail.value)
    bindingEmailCodeCooldown.value = 60
    toast.success(t('settings.pages.account.status.binding-code-sent'))
  }
  catch (error) {
    if (error instanceof VerificationCodeRateLimitError) {
      bindingEmailCodeCooldown.value = Math.max(1, error.retryAfterSeconds)
      toast.error(t('settings.pages.account.status.verification-code-rate-limited', { seconds: error.retryAfterSeconds }))
    }
    else {
      toast.error(error instanceof Error ? error.message : t('settings.pages.account.status.binding-code-failed'))
    }
  }
  finally {
    isSendingBindingEmailCode.value = false
  }
}

async function handleBindEmail() {
  if (!canBindEmail.value)
    return
  isBindingEmail.value = true
  try {
    await bindEmail({ code: bindingEmailCode.value, email: bindingEmail.value })
    bindingEmailCode.value = ''
    toast.success(t('settings.pages.account.status.email-bound'))
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.account.status.email-bind-failed'))
  }
  finally {
    isBindingEmail.value = false
  }
}

async function handleChangePassword() {
  if (!canChangePassword.value)
    return
  isChangingPassword.value = true
  try {
    await changeAccountPassword({ currentPassword: currentPassword.value, newPassword: newPassword.value })
    currentPassword.value = ''
    newPassword.value = ''
    confirmNewPassword.value = ''
    showPasswordForm.value = false
    toast.success(t('settings.pages.account.status.password-changed'))
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.account.status.password-change-failed'))
  }
  finally {
    isChangingPassword.value = false
  }
}

async function redeemCode() {
  if (!canRedeem.value)
    return

  try {
    await commerceStore.redeemActivationCode(normalizedActivationCode.value)
    activationCode.value = ''
    toast.success(t('settings.pages.account.status.redeemed'))
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.account.status.redeem-failed'))
  }
}

async function claimCheckIn() {
  if (!canClaimCheckIn.value)
    return

  try {
    const result = await commerceStore.claimDailyCheckIn()
    toast.success(t('settings.pages.account.status.check-in-claimed', {
      points: result.checkIn.rewardPoints,
    }))
  }
  catch (error) {
    toast.error(error instanceof Error ? error.message : t('settings.pages.account.status.check-in-failed'))
  }
}

watch(isAuthenticated, async (authenticated) => {
  if (authenticated) {
    await refreshAccountState()
    return
  }

  commerceStore.reset()
  profileStore.reset()
}, { immediate: true })

useEventListener('focus', () => void refreshAccountState())

const { pause: pauseUsagePolling, resume: resumeUsagePolling } = useIntervalFn(() => {
  if (!isAuthenticated.value || !hasProcessingUsage.value || isLoading.value || isLoadingRequestHistory.value)
    return
  void Promise.all([
    commerceStore.fetchRequestHistory(),
    commerceStore.fetchAccountState(),
  ]).catch(() => undefined)
}, 2000, { immediate: false })

watch([isAuthenticated, hasProcessingUsage], ([authenticated, processing]) => {
  if (authenticated && processing)
    resumeUsagePolling()
  else
    pauseUsagePolling()
}, { immediate: true })

onBeforeUnmount(pauseUsagePolling)

watch(profile, () => {
  avatarLoadFailed.value = false
  if (!isEditingProfile.value)
    syncProfileDraft()
})
</script>

<template>
  <div data-airi-runtime-route="/settings/account" :class="['mx-auto flex w-full max-w-[76rem] flex-col gap-6 pb-8']">
    <section
      :class="[
        'overflow-hidden rounded-lg border border-[var(--airi-border-subtle)]',
        'bg-[var(--airi-surface-card)]',
      ]"
    >
      <div
        :class="[
          'grid',
          'grid-cols-1',
          'items-start',
          'gap-5 px-5 py-5',
          'md:grid-cols-[minmax(0,1fr)_auto]',
        ]"
      >
        <div :class="['flex', 'min-w-0', 'flex-col', 'gap-2']">
          <div :class="['flex', 'items-center', 'gap-2']">
            <div :class="['grid size-10 place-items-center rounded-md bg-[var(--airi-accent-surface)] text-[var(--airi-accent-strong)]']">
              <span :class="['i-solar:home-smile-angle-bold-duotone size-5']" />
            </div>
            <div :class="['text-2xl font-semibold airi-text']">
              {{ t('settings.pages.account.sections.overview.title') }}
            </div>
          </div>
          <p :class="['max-w-2xl text-sm leading-6 airi-text-muted']">
            {{ t('settings.pages.account.sections.overview.description') }}
          </p>
        </div>

        <div :class="['flex', 'flex-wrap', 'gap-2', 'md:justify-end']">
          <Button
            v-if="isAuthenticated"
            variant="secondary-muted"
            icon="i-solar:refresh-bold"
            :loading="isLoading"
            @click="refreshAccountState"
          >
            {{ t('settings.pages.account.actions.refresh') }}
          </Button>
          <Button
            v-if="isAuthenticated"
            variant="danger"
            icon="i-solar:logout-2-bold"
            :loading="isSigningOut"
            @click="handleSignOut"
          >
            {{ t('settings.pages.account.actions.sign-out') }}
          </Button>
        </div>
      </div>
    </section>

    <section
      v-if="!isAuthenticated"
      id="account-sign-in-card"
      :class="[
        'rounded-lg',
        'airi-card',
        'p-4',
      ]"
    >
      <div :class="['grid grid-cols-1 gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_15rem]']">
        <form :class="['flex min-w-0 flex-col gap-4']" @submit.prevent="handleEmailAuth">
          <div :class="['text-xl font-semibold']">
            {{ t('settings.pages.account.sections.sign-in.title') }}
          </div>
          <p :class="['text-sm', 'airi-text-muted']">
            {{ t('settings.pages.account.sections.sign-in.description') }}
          </p>

          <div v-if="emailAuthMode === 'sign-in'" :class="['grid', 'w-full', 'grid-cols-2', 'gap-1', 'rounded-lg', 'bg-[var(--airi-surface-control-muted)]', 'p-1']">
            <Button
              type="button"
              size="sm"
              :variant="authMethod === 'password' ? 'primary' : 'ghost'"
              @click="authMethod = 'password'; authVerificationCode = ''"
            >
              {{ t('settings.pages.account.actions.use-password') }}
            </Button>
            <Button
              type="button"
              size="sm"
              :variant="authMethod === 'code' ? 'primary' : 'ghost'"
              :disabled="!authVerificationCapabilities.emailOtp && !authVerificationCapabilities.phoneOtp"
              @click="authMethod = 'code'; authVerificationCode = ''"
            >
              {{ t('settings.pages.account.actions.verify-code') }}
            </Button>
          </div>

          <div :class="['grid', 'grid-cols-1', 'gap-3', 'md:grid-cols-2']">
            <label
              v-if="emailAuthMode === 'sign-up'"
              :class="['flex', 'flex-col', 'gap-1.5', 'md:col-span-2']"
            >
              <span :class="['text-sm', 'font-medium']">
                {{ t('settings.pages.account.sections.sign-in.name-label') }}
              </span>
              <Input
                v-model="emailAuthName"
                autocomplete="name"
                :disabled="isEmailAuthSubmitting"
                :placeholder="t('settings.pages.account.sections.sign-in.name-placeholder')"
                variant="primary-dimmed"
              />
            </label>

            <label :class="['flex', 'min-w-0', 'flex-col', 'gap-1.5']">
              <span :class="['text-sm', 'font-medium']">
                {{ emailAuthMode === 'sign-up' ? t('settings.pages.account.sections.sign-in.phone-label') : t('settings.pages.account.sections.sign-in.identity-label') }}
              </span>
              <Input
                v-model="emailAuthEmail"
                :autocomplete="emailAuthMode === 'sign-up' ? 'tel' : 'username'"
                :disabled="isEmailAuthSubmitting"
                :placeholder="emailAuthMode === 'sign-up' ? t('settings.pages.account.sections.sign-in.phone-placeholder') : t('settings.pages.account.sections.sign-in.identity-placeholder')"
                variant="primary-dimmed"
              />
            </label>

            <label v-if="usesVerificationCode" :class="['flex', 'min-w-0', 'flex-col', 'gap-1.5']">
              <span :class="['text-sm', 'font-medium']">
                {{ t('settings.pages.account.sections.sign-in.verification-code-label') }}
              </span>
              <div :class="['grid', 'min-w-0', 'grid-cols-[minmax(0,1fr)_auto]', 'items-start', 'gap-2']">
                <Input
                  v-model="authVerificationCode"
                  autocomplete="one-time-code"
                  inputmode="numeric"
                  maxlength="6"
                  :disabled="isEmailAuthSubmitting"
                  :placeholder="t('settings.pages.account.sections.sign-in.verification-code-placeholder')"
                  variant="primary-dimmed"
                />
                <Button
                  :class="['shrink-0', 'whitespace-nowrap']"
                  type="button"
                  variant="secondary-muted"
                  :disabled="!canSendVerificationCode"
                  :loading="isSendingVerificationCode"
                  @click="handleSendVerificationCode"
                >
                  {{ verificationCodeButtonLabel }}
                </Button>
              </div>
            </label>

            <label v-if="authMethod === 'password' || emailAuthMode === 'sign-up'" :class="['flex', 'flex-col', 'gap-1.5']">
              <span :class="['text-sm', 'font-medium']">
                {{ t('settings.pages.account.sections.sign-in.password-label') }}
              </span>
              <Input
                v-model="emailAuthPassword"
                autocomplete="current-password"
                :disabled="isEmailAuthSubmitting"
                :placeholder="t('settings.pages.account.sections.sign-in.password-placeholder')"
                type="password"
                show-password-toggle
                variant="primary-dimmed"
              />
            </label>

            <label v-if="emailAuthMode === 'sign-up'" :class="['flex', 'flex-col', 'gap-1.5']">
              <span :class="['text-sm', 'font-medium']">{{ t('settings.pages.account.sections.sign-in.confirm-password-label') }}</span>
              <Input
                v-model="authConfirmPassword"
                autocomplete="new-password"
                :disabled="isEmailAuthSubmitting"
                :placeholder="t('settings.pages.account.sections.sign-in.confirm-password-placeholder')"
                type="password"
                show-password-toggle
                variant="primary-dimmed"
              />
            </label>
          </div>

          <div :class="['flex', 'flex-wrap', 'gap-2']">
            <Button
              type="submit"
              variant="primary"
              icon="i-solar:login-3-bold"
              :disabled="!canSubmitEmailAuth"
              :loading="isEmailAuthSubmitting"
            >
              {{ emailAuthMode === 'sign-up' ? t('settings.pages.account.actions.create-account') : authMethod === 'code' ? t('settings.pages.account.actions.verify-code') : t('settings.pages.account.actions.sign-in-email') }}
            </Button>
            <Button
              type="button"
              variant="secondary"
              icon="i-solar:restart-bold"
              :disabled="isEmailAuthSubmitting"
              @click="emailAuthMode = emailAuthMode === 'sign-in' ? 'sign-up' : 'sign-in'; authVerificationCode = ''; emailAuthPassword = ''; authConfirmPassword = ''"
            >
              {{ emailAuthMode === 'sign-in' ? t('settings.pages.account.actions.switch-to-sign-up') : t('settings.pages.account.actions.switch-to-sign-in') }}
            </Button>
          </div>
          <aside :class="['hidden border-l border-[var(--airi-border-subtle)] pl-5 lg:block']">
            <div :class="['text-sm font-semibold airi-text']">
              {{ t('settings.pages.account.sections.sign-in.connected-title') }}
            </div>
            <div :class="['mt-4 grid gap-3 text-xs leading-5 airi-text-muted']">
              <span :class="['flex gap-2']"><span :class="['i-solar:monitor-smartphone-bold-duotone mt-0.5 size-4 text-[var(--airi-accent-strong)]']" />{{ t('settings.pages.account.sections.sign-in.connected-desktop') }}</span>
              <span :class="['flex gap-2']"><span :class="['i-solar:gamepad-bold-duotone mt-0.5 size-4 text-[var(--airi-accent-strong)]']" />{{ t('settings.pages.account.sections.sign-in.connected-game') }}</span>
              <span :class="['flex gap-2']"><span :class="['i-solar:shield-check-bold-duotone mt-0.5 size-4 text-[var(--airi-text-muted)]']" />{{ t('settings.pages.account.sections.sign-in.connected-web') }}</span>
            </div>
          </aside>
        </form>
      </div>
    </section>

    <template v-else>
      <section :class="['relative grid grid-cols-1 overflow-hidden rounded-lg border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card)] shadow-[0_12px_36px_-28px_rgba(0,0,0,0.42)] lg:grid-cols-[minmax(0,1fr)_15rem_17rem]']">
        <div :class="['absolute inset-y-0 left-0 w-1 bg-[var(--airi-accent-strong)] opacity-80']" aria-hidden="true" />
        <div
          :class="[
            'p-4 pl-5 lg:border-r lg:border-[var(--airi-border-subtle)]',
          ]"
        >
          <div :class="['mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase text-[var(--airi-text-soft)]']">
            <span :class="['i-solar:home-angle-bold-duotone size-4 text-[var(--airi-accent-strong)]']" />
            {{ t('settings.pages.account.sections.profile.doorplate') }}
          </div>
          <div :class="['mb-3', 'flex', 'items-start', 'justify-between', 'gap-3']">
            <div :class="['flex', 'min-w-0', 'items-center', 'gap-3']">
              <div :class="['size-12 shrink-0 overflow-hidden rounded-full border-2 border-[var(--airi-border-accent)] bg-[var(--airi-surface-control-muted)] flex items-center justify-center text-lg font-semibold text-[var(--airi-accent-strong)]']">
                <img
                  v-if="profile?.avatarUrl && !avatarLoadFailed"
                  :src="profile.avatarUrl"
                  :alt="profile.displayName"
                  :class="['size-full', 'object-cover']"
                  @error="avatarLoadFailed = true"
                >
                <span v-else>{{ profileInitial }}</span>
              </div>
              <div :class="['min-w-0']">
                <div :class="['truncate text-lg font-semibold']">
                  {{ profile?.displayName || user?.name || user?.email || t('settings.pages.account.common.signed-in') }}
                </div>
                <div :class="['truncate', 'text-xs', 'airi-text-muted']">
                  {{ profile?.handle ? `@${profile.handle}` : visibleAccountEmail }}
                </div>
              </div>
            </div>
            <Button
              size="sm"
              variant="secondary-muted"
              icon="i-solar:pen-new-square-bold"
              :class="['size-9 !px-0 !py-0']"
              :aria-label="t('settings.pages.account.actions.edit-profile')"
              :title="t('settings.pages.account.actions.edit-profile')"
              @click="startProfileEdit"
            />
          </div>
          <div :class="['truncate', 'text-xs', 'airi-text-muted']">
            {{ visibleAccountEmail }}
          </div>
          <div :class="['mt-2', 'flex', 'min-w-0', 'items-center', 'gap-2']">
            <code :class="['min-w-0', 'truncate', 'text-xs', 'airi-text-muted']">
              {{ t('settings.pages.account.sections.profile.user-id', { id: profile?.userId || user?.id }) }}
            </code>
            <Button
              size="sm"
              variant="secondary-muted"
              icon="i-solar:copy-bold"
              :class="['size-9 !px-0 !py-0']"
              :aria-label="t('settings.pages.account.actions.copy-user-id')"
              :title="t('settings.pages.account.actions.copy-user-id')"
              @click="copyUserId"
            />
          </div>
        </div>

        <button
          type="button"
          :class="[
            'border-t border-amber-400/25 bg-amber-500/8 p-4 lg:border-r lg:border-t-0',
            'text-left outline-none transition-colors hover:bg-amber-500/13 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-amber-500/40',
          ]"
          @click="router.push('/settings/account/membership')"
        >
          <div :class="['mb-2 flex items-center gap-2 text-sm text-amber-700 dark:text-amber-300']">
            <div :class="['i-solar:crown-star-bold-duotone', 'text-lg']" />
            {{ t('settings.pages.account.sections.plan.title') }}
          </div>
          <div :class="['text-2xl font-semibold airi-text']">
            {{ membershipIdentity }}
          </div>
          <div :class="['mt-1 text-xs airi-text-muted']">
            {{ t('settings.pages.account.sections.plan.valid-until', { date: formatDate(currentEntitlement?.validUntil) }) }}
          </div>
          <div :class="['mt-2 inline-flex items-center gap-1 text-xs font-semibold text-amber-700 dark:text-amber-300']">
            {{ t('settings.pages.account.actions.manage-membership') }}
            <span :class="['i-solar:alt-arrow-right-linear size-4']" />
          </div>
        </button>

        <div
          :class="[
            'border-t border-sky-400/25 bg-sky-500/7 p-4 lg:border-t-0',
          ]"
        >
          <div :class="['mb-2 flex items-center gap-2 text-sm text-sky-700 dark:text-sky-300']">
            <div :class="['i-solar:bolt-bold-duotone', 'text-lg']" />
            {{ t('settings.pages.account.sections.points.title') }}
          </div>
          <div :class="['flex', 'items-center', 'gap-3']">
            <div :class="['text-3xl font-semibold tabular-nums', availablePointsTone]">
              {{ account ? formatNumber(availablePoints) : '—' }}
            </div>
            <Button
              size="sm"
              variant="secondary-muted"
              icon="i-solar:refresh-bold"
              :disabled="isLoading"
              :loading="isLoading"
              :aria-label="t('settings.pages.account.actions.refresh')"
              :title="t('settings.pages.account.actions.refresh')"
              @click="refreshAccountState"
            >
              {{ t('settings.pages.account.actions.refresh') }}
            </Button>
          </div>
          <div :class="['mt-1', 'text-xs', 'opacity-80']">
            {{ t('settings.pages.account.sections.points.available') }}
          </div>
        </div>
      </section>

      <section :class="['rounded-lg border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card)] p-5']">
        <div :class="['flex flex-wrap items-start justify-between gap-3']">
          <div>
            <h2 :class="['text-base font-semibold airi-text']">
              {{ t('settings.pages.account.sections.pricing.title') }}
            </h2>
            <p :class="['mt-1 text-xs airi-text-muted']">
              {{ t('settings.pages.account.sections.pricing.description') }}
            </p>
          </div>
          <span :class="['text-[11px] airi-text-muted']">{{ officialPriceSummary ? t('settings.pages.account.sections.pricing.live') : t('settings.pages.account.sections.pricing.loading') }}</span>
        </div>
        <div v-if="officialPriceSummary" :class="['mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3']">
          <div :class="['rounded-md border p-3 airi-border-subtle airi-surface-muted']">
            <div :class="['text-xs font-semibold airi-text']">
              {{ t('settings.pages.account.sections.pricing.chat') }}
            </div>
            <div v-for="model in officialPriceSummary.models" :key="model.id" :class="['mt-1 flex justify-between gap-2 text-xs airi-text-muted']">
              <span class="truncate">{{ locale === 'zh-Hans' ? model.nameZh || model.name : model.name }}</span>
              <span class="shrink-0 tabular-nums">{{ modelDisplayPoints(model) }} {{ t('settings.pages.account.sections.pricing.points-per-unit', { tokens: model.tokenUnit }) }}</span>
            </div>
            <p :class="['mt-2 border-t pt-2 text-[11px] leading-5 airi-border-subtle airi-text-muted']">
              {{ t('settings.pages.account.sections.pricing.chat-billing-explanation') }}
            </p>
          </div>
          <div :class="['rounded-md border p-3 airi-border-subtle airi-surface-muted']">
            <div :class="['text-xs font-semibold airi-text']">
              {{ t('settings.pages.account.sections.pricing.speech') }}
            </div>
            <div v-for="chain in officialPriceSummary.capabilities.speech.chains" :key="chain.channel" :class="['mt-1 flex justify-between gap-2 text-xs airi-text-muted']">
              <span>{{ t(`tamagotchi.settings.pages.official-voices.channels.${chain.channel}`) }}</span>
              <span class="shrink-0 tabular-nums">{{ chain.pointsPerMinute }} {{ t('settings.pages.account.sections.pricing.points-per-minute') }}</span>
            </div>
            <div :class="['mt-1 text-xs airi-text-muted']">
              {{ t('settings.pages.account.sections.pricing.voice-surcharge-note') }}
            </div>
          </div>
          <div :class="['rounded-md border p-3 airi-border-subtle airi-surface-muted']">
            <div :class="['text-xs font-semibold airi-text']">
              {{ t('settings.pages.account.sections.pricing.other') }}
            </div>
            <div :class="['mt-1 text-xs airi-text-muted']">
              {{ t('settings.pages.account.sections.pricing.asr', { first: officialPriceSummary.capabilities.transcription.firstMinutePoints, additional: officialPriceSummary.capabilities.transcription.additionalMinutePoints }) }}
            </div>
            <div :class="['mt-1 text-xs airi-text-muted']">
              {{ t('settings.pages.account.sections.pricing.request', { name: t('settings.pages.account.sections.pricing.embedding'), points: officialPriceSummary.capabilities.embedding.pointsPerRequest }) }}
            </div>
            <div :class="['mt-1 text-xs airi-text-muted']">
              {{ t('settings.pages.account.sections.pricing.request', { name: t('settings.pages.account.sections.pricing.web-search'), points: officialPriceSummary.capabilities.webSearch.pointsPerRequest }) }}
            </div>
            <div v-if="officialPriceSummary.capabilities.vision" :class="['mt-1 text-xs airi-text-muted']">
              {{ t('settings.pages.account.sections.pricing.request', { name: t('settings.pages.account.sections.pricing.vision'), points: officialPriceSummary.capabilities.vision.pointsPerRequest }) }}
            </div>
          </div>
          <div :class="['rounded-md border p-3 airi-border-subtle airi-surface-muted md:col-span-2 xl:col-span-3']">
            <div :class="['text-xs font-semibold airi-text']">
              {{ t('settings.pages.account.sections.pricing.feature-title') }}
            </div>
            <div :class="['mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs airi-text-muted']">
              <span v-for="feature in officialPriceSummary.features" :key="feature.feature">
                {{ featurePricingLabel(feature.feature) }} × {{ feature.multiplier }}<template v-if="featureMinimumPoints(feature.feature, feature.multiplier) !== undefined"> · {{ t('settings.pages.account.sections.pricing.minimum', { points: featureMinimumPoints(feature.feature, feature.multiplier) }) }}</template>
              </span>
            </div>
            <p :class="['mt-2 text-xs airi-text-muted']">
              {{ t('settings.pages.account.sections.pricing.no-official-charge') }}
            </p>
          </div>
        </div>
      </section>

      <section :class="['grid gap-4 rounded-lg border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card)] px-5 py-4 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:items-center']">
        <div :class="['flex items-start gap-3']">
          <div :class="['grid size-9 shrink-0 place-items-center rounded-md bg-[var(--airi-accent-surface)] text-[var(--airi-accent-strong)]']">
            <span :class="['i-solar:shield-user-bold-duotone size-5']" />
          </div>
          <div>
            <h2 :class="['text-base font-semibold airi-text']">
              {{ t('settings.pages.account.sections.security.title') }}
            </h2><p :class="['mt-1 text-xs leading-5 airi-text-muted']">
              {{ t('settings.pages.account.sections.security.description') }}
            </p>
          </div>
        </div>
        <div v-if="hasBoundEmail" :class="['flex min-w-0 items-center justify-between gap-3 rounded-md border border-emerald-500/20 bg-emerald-500/7 px-4 py-3']">
          <span :class="['min-w-0']"><span :class="['block text-xs airi-text-muted']">{{ t('settings.pages.account.sections.security.verified-email') }}</span><strong :class="['mt-0.5 block truncate text-sm airi-text']">{{ visibleAccountEmail }}</strong></span>
          <span :class="['inline-flex shrink-0 items-center gap-1 text-xs font-medium text-emerald-700 dark:text-emerald-300']"><span :class="['i-solar:verified-check-bold size-4']" />{{ t('settings.pages.account.sections.security.verified') }}</span>
        </div>
        <form v-else :class="['grid min-w-0 gap-2 sm:grid-cols-[minmax(0,1fr)_8rem_auto]']" @submit.prevent="handleBindEmail">
          <Input v-model="bindingEmail" autocomplete="email" type="email" :aria-label="t('settings.pages.account.sections.sign-in.email-label')" :placeholder="t('settings.pages.account.sections.security.email-placeholder')" variant="primary-dimmed" />
          <Input v-model="bindingEmailCode" autocomplete="one-time-code" inputmode="numeric" maxlength="6" :aria-label="t('settings.pages.account.sections.sign-in.verification-code-label')" :placeholder="t('settings.pages.account.sections.sign-in.verification-code-placeholder')" variant="primary-dimmed" />
          <div :class="['flex gap-2']">
            <Button type="button" variant="secondary" :disabled="!canSendBindingEmailCode" :loading="isSendingBindingEmailCode" @click="handleSendBindingEmailCode">
              {{ bindingEmailCodeButtonLabel }}
            </Button>
            <Button type="submit" :disabled="!canBindEmail" :loading="isBindingEmail">
              {{ t('settings.pages.account.sections.security.bind') }}
            </Button>
          </div>
        </form>
        <div :class="['grid gap-3 lg:col-span-2 sm:grid-cols-2']">
          <div :class="['flex items-center justify-between gap-3 rounded-md border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-control-muted)] px-4 py-3']">
            <span class="min-w-0"><span :class="['block text-xs airi-text-muted']">{{ t('settings.pages.account.sections.security.phone') }}</span><strong :class="['mt-0.5 block truncate text-sm airi-text']">{{ visibleAccountPhone }}</strong></span>
            <span :class="['i-solar:smartphone-2-bold-duotone size-5 text-[var(--airi-accent-strong)]']" />
          </div>
          <button type="button" :class="['flex items-center justify-between gap-3 rounded-md border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-control-muted)] px-4 py-3 text-left hover:border-[var(--airi-border-accent)]']" @click="showPasswordForm = !showPasswordForm">
            <span><span :class="['block text-xs airi-text-muted']">{{ t('settings.pages.account.sections.security.password') }}</span><strong :class="['mt-0.5 block text-sm airi-text']">{{ t('settings.pages.account.sections.security.change-password') }}</strong></span>
            <span :class="['i-solar:key-square-2-bold-duotone size-5 text-[var(--airi-accent-strong)]']" />
          </button>
        </div>
        <form v-if="showPasswordForm" :class="['grid gap-3 rounded-md border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-control-muted)] p-4 lg:col-span-2 sm:grid-cols-3']" @submit.prevent="handleChangePassword">
          <Input v-model="currentPassword" type="password" show-password-toggle autocomplete="current-password" :placeholder="t('settings.pages.account.sections.security.current-password')" variant="primary-dimmed" />
          <Input v-model="newPassword" type="password" show-password-toggle autocomplete="new-password" :placeholder="t('settings.pages.account.sections.security.new-password')" variant="primary-dimmed" />
          <Input v-model="confirmNewPassword" type="password" show-password-toggle autocomplete="new-password" :placeholder="t('settings.pages.account.sections.security.confirm-password')" variant="primary-dimmed" />
          <div :class="['flex justify-end gap-2 sm:col-span-3']">
            <Button type="button" variant="secondary" @click="showPasswordForm = false">
              {{ t('settings.pages.account.actions.cancel') }}
            </Button>
            <Button type="submit" :disabled="!canChangePassword" :loading="isChangingPassword">
              {{ t('settings.pages.account.sections.security.save-password') }}
            </Button>
          </div>
        </form>
      </section>

      <DialogRoot :open="isEditingProfile" @update:open="handleProfileDialogOpenChange">
        <DialogPortal>
          <DialogOverlay :class="['fixed inset-0 z-100 bg-black/45 backdrop-blur-sm']" />
          <DialogContent
            :class="[
              'fixed left-1/2 top-1/2 z-101 max-h-[min(90vh,680px)] w-[min(92vw,620px)] overflow-hidden rounded-lg',
              'border border-solid border-[var(--airi-border-subtle)] bg-[var(--airi-surface-panel)] shadow-2xl outline-none',
              '-translate-x-1/2 -translate-y-1/2',
            ]"
          >
            <form :class="['max-h-[min(90vh,680px)] flex flex-col']" @submit.prevent="saveProfile">
              <header :class="['flex shrink-0 items-start justify-between gap-4 border-b airi-border-subtle px-5 py-4']">
                <div class="min-w-0">
                  <DialogTitle :class="['text-lg font-semibold airi-text']">
                    {{ t('settings.pages.account.sections.profile.edit-title') }}
                  </DialogTitle>
                  <p :class="['mt-1 text-sm airi-text-muted']">
                    {{ t('settings.pages.account.sections.profile.edit-description') }}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  icon="i-solar:close-circle-bold"
                  :aria-label="t('settings.pages.account.actions.cancel')"
                  :title="t('settings.pages.account.actions.cancel')"
                  @click="cancelProfileEdit"
                />
              </header>

              <div :class="['min-h-0 flex-1 overflow-y-auto px-5 py-4']">
                <div :class="['mb-5 flex items-center gap-4']">
                  <div :class="['size-18 shrink-0 overflow-hidden rounded-full border airi-border-subtle bg-[var(--airi-surface-control-muted)] grid place-items-center text-xl font-semibold text-[var(--airi-accent-strong)]']">
                    <img
                      v-if="profileAvatarDraftUrl && !avatarPreviewFailed"
                      :src="profileAvatarDraftUrl"
                      alt=""
                      :class="['size-full object-cover']"
                      @error="avatarPreviewFailed = true"
                    >
                    <span v-else>{{ profileDraftInitial }}</span>
                  </div>
                  <div :class="['min-w-0 flex flex-1 flex-col gap-2']">
                    <input
                      ref="avatarInput"
                      class="sr-only"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      @change="handleAvatarFileChange"
                    >
                    <div :class="['flex flex-wrap gap-2']">
                      <Button type="button" variant="secondary" icon="i-solar:upload-bold" :loading="isProcessingAvatar" @click="openAvatarPicker">
                        {{ t('settings.pages.account.actions.upload-avatar') }}
                      </Button>
                      <Button v-if="profileAvatarDraftUrl" type="button" variant="secondary" icon="i-solar:trash-bin-2-bold" @click="removeAvatarDraft">
                        {{ t('settings.pages.account.actions.remove-avatar') }}
                      </Button>
                    </div>
                    <span :class="['text-xs airi-text-muted']">{{ t('settings.pages.account.sections.profile.avatar-upload-note') }}</span>
                  </div>
                </div>

                <div :class="['grid grid-cols-1 gap-4 md:grid-cols-2']">
                  <label :class="['flex min-w-0 flex-col gap-2']">
                    <span :class="['text-sm font-medium']">{{ t('settings.pages.account.sections.profile.display-name') }}</span>
                    <Input v-model="profileDisplayName" maxlength="48" variant="primary-dimmed" />
                  </label>
                  <label :class="['flex min-w-0 flex-col gap-2']">
                    <span :class="['text-sm font-medium']">{{ t('settings.pages.account.sections.profile.handle') }}</span>
                    <Input v-model="profileHandle" maxlength="24" variant="primary-dimmed" />
                  </label>
                  <label v-if="!profileAvatarDataUrl" :class="['flex min-w-0 flex-col gap-2 md:col-span-2']">
                    <span :class="['text-sm font-medium']">{{ t('settings.pages.account.sections.profile.avatar-url') }}</span>
                    <Input v-model="profileRemoteAvatarUrl" type="url" variant="primary-dimmed" />
                    <span :class="['text-xs airi-text-muted']">{{ t('settings.pages.account.sections.profile.avatar-note') }}</span>
                  </label>
                  <div v-else :class="['rounded-md bg-[var(--airi-surface-control-muted)] px-3 py-2 text-sm airi-text-muted md:col-span-2']">
                    {{ t('settings.pages.account.sections.profile.avatar-uploaded') }}
                  </div>
                  <label :class="['flex min-w-0 flex-col gap-2 md:col-span-2']">
                    <span :class="['text-sm font-medium']">{{ t('settings.pages.account.sections.profile.bio') }}</span>
                    <BasicTextarea v-model="profileBio" :maxlength="280" :rows="3" />
                    <span :class="['text-right text-xs airi-text-muted']">{{ profileBio.length }} / 280</span>
                  </label>
                </div>
              </div>

              <footer :class="['flex shrink-0 justify-end gap-2 border-t airi-border-subtle px-5 py-4']">
                <Button type="button" variant="secondary" @click="cancelProfileEdit">
                  {{ t('settings.pages.account.actions.cancel') }}
                </Button>
                <Button type="submit" icon="i-solar:diskette-bold" :disabled="!canSaveProfile" :loading="isProfileSaving">
                  {{ t('settings.pages.account.actions.save-profile') }}
                </Button>
              </footer>
            </form>
          </DialogContent>
        </DialogPortal>
      </DialogRoot>

      <section
        :class="[
          'grid',
          'grid-cols-1',
          'items-center',
          'gap-5 rounded-lg border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card)] px-5 py-5',
          'md:grid-cols-[minmax(0,1fr)_auto]',
        ]"
      >
        <div :class="['min-w-0']">
          <div :class="['mb-2', 'flex', 'items-center', 'gap-2']">
            <div :class="['i-solar:calendar-mark-bold-duotone', 'text-2xl', 'text-[var(--airi-accent-strong)]']" />
            <div :class="['text-lg', 'font-medium']">
              {{ t('settings.pages.account.sections.check-in.title') }}
            </div>
          </div>
          <p :class="['max-w-2xl', 'text-sm', 'airi-text-muted']">
            {{ checkInDescription }}
          </p>
          <div :class="['mt-3', 'flex', 'flex-wrap', 'gap-2']">
            <span :class="['rounded-lg', 'airi-surface-glass', 'px-3', 'py-1.5', 'text-sm', 'airi-text']">
              {{ t('settings.pages.account.sections.check-in.streak', { days: checkInState?.consecutiveDays ?? 0 }) }}
            </span>
            <span :class="['rounded-lg', 'airi-surface-glass', 'px-3', 'py-1.5', 'text-sm', 'airi-text']">
              {{ checkInState?.capReached
                ? t('settings.pages.account.sections.check-in.cap-reached')
                : t('settings.pages.account.sections.check-in.next-reward', { points: checkInState?.nextRewardPoints ?? 1000 }) }}
            </span>
            <span
              v-if="checkInState?.claimedToday"
              :class="['rounded-lg', 'bg-emerald-100', 'px-3', 'py-1.5', 'text-sm', 'text-emerald-700', 'dark:bg-emerald-900/40', 'dark:text-emerald-200']"
            >
              {{ t('settings.pages.account.sections.check-in.claimed') }}
            </span>
          </div>
        </div>

        <Button
          variant="primary"
          icon="i-solar:gift-bold"
          :disabled="!canClaimCheckIn"
          :loading="isClaimingCheckIn"
          @click="claimCheckIn"
        >
          {{ t(checkInState?.upgradeRefreshAvailable ? 'settings.pages.account.actions.claim-check-in-upgrade' : 'settings.pages.account.actions.claim-check-in') }}
        </Button>
      </section>

      <section
        :class="[
          'grid',
          'grid-cols-1',
          'gap-4',
          'lg:grid-cols-[minmax(20rem,0.7fr)_minmax(0,1.3fr)]',
        ]"
      >
        <form
          id="account-redeem-card"
          :class="[
            'rounded-lg border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card)] p-5',
          ]"
          @submit.prevent="redeemCode"
        >
          <div :class="['mb-4', 'flex', 'items-start', 'gap-2']">
            <div :class="['i-solar:ticket-sale-bold-duotone', 'mt-0.5', 'text-2xl', 'text-[var(--airi-accent-strong)]']" />
            <div>
              <div :class="['text-lg', 'font-medium']">
                {{ t('settings.pages.account.sections.redeem.title') }}
              </div>
              <p :class="['text-sm', 'airi-text-muted']">
                {{ t('settings.pages.account.sections.redeem.description') }}
              </p>
            </div>
          </div>

          <label :class="['flex', 'flex-col', 'gap-2']">
            <span :class="['text-sm', 'font-medium']">
              {{ t('settings.pages.account.sections.redeem.code-label') }}
            </span>
            <Input
              v-model="activationCode"
              :disabled="isRedeeming"
              :placeholder="t('settings.pages.account.sections.redeem.code-placeholder')"
              variant="primary-dimmed"
            />
          </label>

          <Button
            :class="['mt-4', 'w-full']"
            type="submit"
            icon="i-solar:check-circle-bold"
            :disabled="!canRedeem"
            :loading="isRedeeming"
          >
            {{ t('settings.pages.account.actions.redeem') }}
          </Button>
        </form>

        <section
          id="account-balance-card"
          :class="[
            'rounded-lg border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-card)] p-5',
          ]"
        >
          <header :class="['flex', 'items-center', 'gap-3']">
            <div :class="['flex', 'min-w-0', 'items-center', 'gap-2']">
              <div :class="['i-solar:history-bold-duotone', 'text-xl', 'airi-text-muted']" />
              <div :class="['min-w-0']">
                <div :class="['text-lg', 'font-medium']">
                  {{ t('settings.pages.account.sections.details.title') }}
                </div>
                <p :class="['text-sm', 'airi-text-muted']">
                  {{ t('settings.pages.account.sections.details.description') }}
                </p>
              </div>
            </div>
          </header>

          <div :class="['mt-4', 'flex', 'flex-col', 'gap-5']">
            <div>
              <div :class="['mb-2', 'text-sm', 'font-medium', 'airi-text']">
                {{ t('settings.pages.account.sections.balance.title') }}
              </div>
              <p :class="['mb-3', 'text-xs', 'leading-5', 'airi-text-muted']">
                {{ t('settings.pages.account.sections.balance.description') }}
              </p>

              <div v-if="accountError && !account" :class="['rounded-lg', 'border border-amber-300/45 bg-amber-50/55 p-4 dark:bg-amber-950/15']">
                <p :class="['text-sm text-amber-800 dark:text-amber-200']">
                  {{ t('settings.pages.account.sections.balance.error') }}
                </p>
                <Button :class="['mt-3']" variant="secondary-muted" size="sm" icon="i-solar:refresh-bold" @click="handleRetryAccount">
                  {{ t('settings.pages.account.sections.balance.retry') }}
                </Button>
              </div>
              <div v-else-if="!account" :class="['rounded-lg', 'airi-surface-glass', 'flex items-center gap-3 p-4 text-sm airi-text-muted']">
                <span :class="['i-svg-spinners:90-ring-with-bg size-4']" />
                {{ t('settings.pages.account.sections.balance.loading') }}
              </div>
              <div v-else :class="['grid', 'grid-cols-2', 'gap-3', 'sm:grid-cols-3', 'xl:grid-cols-5']">
                <div :class="['rounded-lg', 'airi-surface-glass', 'p-3']">
                  <div :class="['text-xs', 'airi-text-muted']">
                    {{ t('settings.pages.account.points.trial') }}
                  </div>
                  <div :class="['mt-1', 'text-right', 'text-xl', 'font-medium', 'tabular-nums']">
                    {{ formatNumber(balance?.trialPoints ?? 0) }}
                  </div>
                </div>
                <div :class="['rounded-lg', 'airi-surface-glass', 'p-3']">
                  <div :class="['text-xs', 'airi-text-muted']">
                    {{ t('settings.pages.account.points.grant') }}
                  </div>
                  <div :class="['mt-1', 'text-right', 'text-xl', 'font-medium', 'tabular-nums']">
                    {{ formatNumber(balance?.grantPoints ?? 0) }}
                  </div>
                </div>
                <div v-if="account?.membershipPoints" :class="['rounded-lg border border-[var(--airi-border-accent)] bg-[var(--airi-accent-surface)] p-3']">
                  <div :class="['text-xs', 'airi-text-muted']">
                    {{ t('settings.pages.account.sections.points.membership') }}
                  </div>
                  <div :class="['mt-1 text-right text-xl font-medium tabular-nums text-[var(--airi-accent-strong)]']">
                    {{ formatNumber(account.membershipPoints) }}
                  </div>
                </div>
                <div :class="['rounded-lg', 'airi-surface-glass', 'p-3']">
                  <div :class="['text-xs', 'airi-text-muted']">
                    {{ t('settings.pages.account.points.paid') }}
                  </div>
                  <div :class="['mt-1', 'text-right', 'text-xl', 'font-medium', 'tabular-nums']">
                    {{ formatNumber(balance?.paidPoints ?? 0) }}
                  </div>
                </div>
                <div :class="['rounded-lg', 'airi-surface-glass', 'p-3']">
                  <div :class="['text-xs', 'airi-text-muted']">
                    {{ t('settings.pages.account.points.reserved') }}
                  </div>
                  <div :class="['mt-1', 'text-right', 'text-xl', 'font-medium', 'tabular-nums']">
                    {{ formatNumber(balance?.reservedPoints ?? 0) }}
                  </div>
                </div>
              </div>
            </div>

            <SelectTab
              v-model="accountActivityTab"
              :options="accountActivityTabOptions"
              size="sm"
            />

            <div v-if="accountActivityTab === 'balance' && account">
              <div :class="['mb-2', 'flex', 'items-center', 'gap-2']">
                <div :class="['i-solar:bill-list-bold-duotone', 'text-lg', 'airi-text-muted']" />
                <div>
                  <div :class="['text-sm', 'font-medium', 'airi-text']">
                    {{ t('settings.pages.account.sections.ledger.title') }}
                  </div>
                  <p :class="['text-xs', 'airi-text-muted']">
                    {{ t('settings.pages.account.sections.ledger.description') }}
                  </p>
                </div>
              </div>

              <div v-if="displayLedger.length === 0" :class="['rounded-lg', 'airi-surface-glass', 'p-4', 'text-sm', 'airi-text-muted']">
                {{ t('settings.pages.account.sections.ledger.empty') }}
              </div>

              <div v-else :class="['flex', 'flex-col', 'divide-y', 'divide-[var(--airi-border-subtle)]']">
                <div
                  v-for="entry in displayLedger"
                  :key="entry.id"
                  :class="['grid', 'grid-cols-[minmax(0,1fr)_auto]', 'items-center', 'gap-3', 'py-3']"
                >
                  <div :class="['min-w-0']">
                    <div :class="['flex', 'min-w-0', 'items-center', 'gap-2']">
                      <span :class="['truncate', 'font-medium']">
                        {{ formatLedgerType(entry.displayType, entry.note) }}
                      </span>
                    </div>
                    <div :class="['mt-1', 'truncate', 'text-xs', 'airi-text-muted']">
                      {{ formatDate(entry.createdAt) }}
                      <span v-if="formatLedgerUsageContext(entry)"> / {{ formatLedgerUsageContext(entry) }}</span>
                    </div>
                    <div
                      v-if="entry.displayType === 'settle'"
                      :class="['mt-1', 'text-xs', 'airi-text-muted']"
                    >
                      {{ t('settings.pages.account.sections.ledger.settled-final', { points: formatNumber(Math.abs(finiteNumber(entry.displayAmount))) }) }}
                    </div>
                    <div
                      v-else-if="entry.displayType === 'refund'"
                      :class="['mt-1', 'text-xs', 'airi-text-muted']"
                    >
                      {{ formatLedgerRefund(entry) }}
                    </div>
                    <div :class="['mt-1', 'text-xs', 'airi-text-muted']">
                      {{ t('settings.pages.account.sections.ledger.balance-after', { points: formatNumber(entry.balanceAfter) }) }}
                    </div>
                    <div v-if="isModelUsageAudit(entry)" :class="['mt-1', 'text-xs', 'text-sky-700', 'dark:text-sky-300']">
                      {{ t('settings.pages.account.sections.ledger.related-usage') }}
                    </div>
                  </div>
                  <div :class="['text-right', 'tabular-nums']">
                    <div :class="['font-semibold', amountClass(entry.displayAmount)]">
                      {{ entry.displayAmount > 0 ? `+${formatNumber(entry.displayAmount)}` : formatNumber(entry.displayAmount) }}
                    </div>
                  </div>
                </div>
              </div>
              <div v-if="displayLedger.length > 0" :class="['mt-3', 'flex', 'justify-center']">
                <Button
                  v-if="ledgerCursor"
                  variant="secondary-muted"
                  :loading="isLoadingMoreLedger"
                  :disabled="isLoadingMoreLedger"
                  @click="handleLoadMoreLedger"
                >
                  {{ t('settings.pages.account.sections.ledger.load-more') }}
                </Button>
                <span v-else :class="['text-xs', 'airi-text-muted']">
                  {{ t('settings.pages.account.sections.ledger.all-loaded') }}
                </span>
              </div>
            </div>

            <div v-else-if="accountActivityTab === 'usage'">
              <div :class="['mb-2', 'flex', 'items-center', 'gap-2']">
                <div :class="['i-solar:history-bold-duotone', 'text-lg', 'airi-text-muted']" />
                <div>
                  <div :class="['text-sm', 'font-medium', 'airi-text']">
                    {{ t('settings.pages.account.sections.usage-history.title') }}
                  </div>
                  <p :class="['text-xs', 'airi-text-muted']">
                    {{ t('settings.pages.account.sections.usage-history.description') }}
                  </p>
                </div>
              </div>

              <div
                v-if="!requestHistoryAvailable"
                :class="['rounded-lg', 'airi-surface-glass', 'flex', 'items-center', 'justify-between', 'gap-3', 'p-4']"
              >
                <p :class="['text-sm', 'airi-text-muted']">
                  {{ t('settings.pages.account.sections.usage-history.unavailable') }}
                </p>
                <Button variant="secondary-muted" size="sm" icon="i-solar:refresh-bold" @click="handleRetryUsageHistory">
                  {{ t('settings.pages.account.sections.usage-history.retry') }}
                </Button>
              </div>
              <div
                v-else-if="requestHistoryError && requestHistory.length === 0"
                :class="['rounded-lg', 'border', 'border-amber-300/45', 'bg-amber-50/55', 'dark:bg-amber-950/15', 'flex', 'items-center', 'justify-between', 'gap-3', 'p-4']"
              >
                <p :class="['text-sm', 'text-amber-800', 'dark:text-amber-200']">
                  {{ t('settings.pages.account.sections.usage-history.error') }}
                </p>
                <Button variant="secondary-muted" size="sm" icon="i-solar:refresh-bold" @click="handleRetryUsageHistory">
                  {{ t('settings.pages.account.sections.usage-history.retry') }}
                </Button>
              </div>
              <div v-else-if="isLoadingRequestHistory && requestHistory.length === 0" :class="['rounded-lg', 'airi-surface-glass', 'flex', 'items-center', 'gap-3', 'p-4', 'text-sm', 'airi-text-muted']">
                <span :class="['i-svg-spinners:90-ring-with-bg', 'size-4']" />
                {{ t('settings.pages.account.sections.usage-history.loading') }}
              </div>
              <div v-else-if="usageHistoryDisplay.length === 0" :class="['rounded-lg', 'airi-surface-glass', 'p-4', 'text-sm', 'airi-text-muted']">
                {{ t('settings.pages.account.sections.usage-history.empty') }}
              </div>
              <div v-else :class="['flex', 'flex-col', 'gap-2']">
                <details
                  v-for="item in usageHistoryDisplay"
                  :key="item.id"
                  :class="[
                    'group rounded-lg border border-[var(--airi-border-subtle)] airi-surface-glass',
                    'transition-colors motion-reduce:transition-none',
                    'focus-within:border-[var(--airi-border-accent)]',
                  ]"
                >
                  <summary
                    :class="[
                      'grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-4 py-3',
                      'outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent-focus)]',
                    ]"
                  >
                    <div :class="['min-w-0']">
                      <div :class="['flex', 'min-w-0', 'items-center', 'gap-2']">
                        <span :class="['truncate', 'font-medium', 'airi-text']">
                          {{ formatUsageTitle(item) }}
                        </span>
                        <span v-if="item.isPartial" :class="['shrink-0 rounded-md bg-sky-100/70 px-1.5 py-0.5 text-[10px] text-sky-700 dark:bg-sky-950/35 dark:text-sky-200']">
                          {{ t('settings.pages.account.sections.usage-history.groups.partial') }}
                        </span>
                        <span :class="['i-solar:alt-arrow-down-linear', 'size-4', 'shrink-0', 'airi-text-muted', 'transition-transform', 'group-open:rotate-180', 'motion-reduce:transition-none']" />
                      </div>
                      <div :class="['mt-2', 'flex', 'flex-wrap', 'items-center', 'gap-2', 'text-xs', 'airi-text-muted']">
                        <span :class="['size-1.5', 'shrink-0', 'rounded-full', 'bg-sky-400/70']" />
                        <span>{{ t('settings.pages.account.sections.usage-history.time.started', { time: formatUsageTimestamp(item.createdAt) }) }}</span>
                        <span aria-hidden="true">→</span>
                        <span>{{ t('settings.pages.account.sections.usage-history.time.completed', { time: formatUsageTimestamp(item.completedAt) }) }}</span>
                      </div>
                      <div :class="['mt-1', 'text-[11px]', 'airi-text-muted']">
                        {{ t('settings.pages.account.sections.usage-history.time.local', { zone: localTimeZoneLabel }) }}
                      </div>
                    </div>
                    <div :class="['min-w-28', 'text-right', 'tabular-nums']">
                      <div :class="['font-medium', usageStatusClass(item.billingStatus)]">
                        {{ formatUsageBillingStatus(item.billingStatus) }}
                      </div>
                      <div :class="['mt-1', 'text-xs', 'airi-text-muted']">
                        {{ formatUsagePoints(item) }}
                      </div>
                    </div>
                  </summary>

                  <div :class="['border-t border-[var(--airi-border-subtle)] px-4 py-3']">
                    <dl :class="['grid grid-cols-2 gap-x-5 gap-y-3 text-xs sm:grid-cols-5']">
                      <div>
                        <dt :class="['airi-text-muted']">
                          {{ t('settings.pages.account.sections.usage-history.details.reserved') }}
                        </dt>
                        <dd :class="['mt-1 text-right font-medium tabular-nums airi-text']">
                          {{ formatNumber(item.reservedPoints) }}
                        </dd>
                      </div>
                      <div>
                        <dt :class="['airi-text-muted']">
                          {{ t('settings.pages.account.sections.usage-history.details.charged') }}
                        </dt>
                        <dd :class="['mt-1 text-right font-medium tabular-nums airi-text']">
                          {{ formatNumber(item.chargedPoints) }}
                        </dd>
                      </div>
                      <div>
                        <dt :class="['airi-text-muted']">
                          {{ t('settings.pages.account.sections.usage-history.details.refunded') }}
                        </dt>
                        <dd :class="['mt-1 text-right font-medium tabular-nums text-emerald-600 dark:text-emerald-300']">
                          {{ formatNumber(item.refundedPoints) }}
                        </dd>
                      </div>
                      <div>
                        <dt :class="['airi-text-muted']">
                          {{ t('settings.pages.account.sections.usage-history.details.net') }}
                        </dt>
                        <dd :class="['mt-1 text-right font-semibold tabular-nums text-sky-700 dark:text-sky-300']">
                          {{ formatNumber(item.netPoints) }}
                        </dd>
                      </div>
                      <div>
                        <dt :class="['airi-text-muted']">
                          {{ t('settings.pages.account.sections.usage-history.details.reference') }}
                        </dt>
                        <dd :class="['mt-1 text-right font-mono airi-text']">
                          {{ shortReference(item.id) }}
                        </dd>
                      </div>
                    </dl>

                    <div v-if="item.kind === 'group'" :class="['mt-4 border-t border-[var(--airi-border-subtle)] pt-3']">
                      <div :class="['mb-2 text-xs font-medium airi-text']">
                        {{ t('settings.pages.account.sections.usage-history.groups.items', { count: item.children.length }) }}
                      </div>
                      <div :class="['flex flex-col divide-y divide-[var(--airi-border-subtle)]']">
                        <div
                          v-for="child in item.children"
                          :key="child.id"
                          :class="['grid grid-cols-[minmax(0,1fr)_auto] gap-3 py-2 text-xs']"
                        >
                          <div :class="['min-w-0']">
                            <div :class="['truncate font-medium airi-text']">
                              {{ formatUsageKind(child) }}
                            </div>
                            <div :class="['mt-1 airi-text-muted']">
                              {{ t('settings.pages.account.sections.usage-history.details.request-outcome') }}:
                              {{ formatUsageRequestStatus(child.requestStatus) }}
                            </div>
                            <div v-if="formatUsageFailure(child)" :class="['mt-1 airi-text-muted']">
                              {{ formatUsageFailure(child) }}
                            </div>
                            <div :class="['mt-1 font-mono text-[11px] airi-text-muted']">
                              {{ shortReference(child.id) }}
                            </div>
                          </div>
                          <div :class="['text-right tabular-nums']">
                            <div :class="['font-medium', usageStatusClass(child.billingStatus)]">
                              {{ formatUsageBillingStatus(child.billingStatus) }}
                            </div>
                            <div :class="['mt-1 airi-text-muted']">
                              {{ formatNumber(child.netPoints) }}
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div v-else :class="['mt-3 text-xs airi-text-muted']">
                      <div>
                        {{ t('settings.pages.account.sections.usage-history.details.request-outcome') }}:
                        {{ formatUsageRequestStatus(item.children[0]!.requestStatus) }}
                      </div>
                      <div v-if="formatUsageFailure(item.children[0]!)" :class="['mt-1']">
                        {{ formatUsageFailure(item.children[0]!) }}
                      </div>
                    </div>
                  </div>
                </details>
              </div>
              <div v-if="usageHistoryDisplay.length > 0" :class="['mt-3', 'flex', 'justify-center']">
                <Button
                  v-if="requestHistoryCursor"
                  variant="secondary-muted"
                  :loading="isLoadingMoreRequestHistory"
                  :disabled="isLoadingMoreRequestHistory"
                  @click="handleLoadMoreRequestHistory"
                >
                  {{ t('settings.pages.account.sections.usage-history.load-more') }}
                </Button>
                <span v-else :class="['text-xs', 'airi-text-muted']">
                  {{ t('settings.pages.account.sections.usage-history.all-loaded') }}
                </span>
              </div>
            </div>
          </div>
        </section>
      </section>
    </template>

    <div
      v-motion
      class="text-[var(--airi-text-soft)] opacity-20 dark:opacity-15" pointer-events-none
      fixed top="[calc(100dvh-15rem)]" bottom-0 right--5 z--1
      :initial="{ scale: 0.9, opacity: 0, y: 20 }"
      :enter="{ scale: 1, opacity: 1, y: 0 }"
      :duration="500"
      size-60
      flex items-center justify-center
    >
      <div text="60" i-solar:wallet-money-bold-duotone />
    </div>
  </div>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.account.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.account.description
  icon: i-solar:wallet-money-bold-duotone
  settingsEntry: true
  order: 1
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
