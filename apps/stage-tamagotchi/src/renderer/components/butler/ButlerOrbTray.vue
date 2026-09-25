<script setup lang="ts">
import type { AvatarFramingSettings } from '@proj-airi/stage-ui/stores/settings/avatar-framing'
import type { CSSProperties } from 'vue'

import type {
  ElectronButlerReminderDeliveryAttempt,
  ElectronButlerReminderNotificationPolicy,
  ElectronButlerReminderTaskSnapshot,
  ElectronButlerTaskMutationPayload,
  ElectronButlerWindowEdge,
  ElectronButlerWindowMode,
  ElectronWindowShapeRect,
} from '../../../shared/eventa'
import type { ButlerReminderDeliveryAttempt, ButlerTask, ButlerTaskComposerDraft, ButlerTaskRepeat, ButlerTaskWeekday } from '../../stores/butler-tasks'
import type { ButlerNativeNotificationResult } from './butler-reminder-delivery'
import type { ButlerReminderSound } from './butler-reminder-sound'

import { useElectronEventaContext, useElectronEventaInvoke, useElectronWindowMove } from '@proj-airi/electron-vueuse'
import { useBackgroundStore } from '@proj-airi/stage-layouts/stores/background'
import { getStageProductEdition } from '@proj-airi/stage-shared'
import { createTurtleSoupLaunchUrl } from '@proj-airi/stage-ui/libs/auth'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { AVATAR_FRAMING_LIMITS as ORB_CROP_LIMITS, useAvatarFramingSettingsStore } from '@proj-airi/stage-ui/stores/settings/avatar-framing'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { getSettingsSurfaceStyle, useSettingsTheme } from '@proj-airi/stage-ui/stores/settings/theme'
import { useTheme } from '@proj-airi/ui'
import { useLocalStorage } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogOverlay, AlertDialogPortal, AlertDialogRoot, AlertDialogTitle } from 'reka-ui'
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import MouseInteractionModePicker from '../settings/mouse-interaction-mode-picker.vue'

import { createDesktopFeatureManifest } from '../../../shared/desktop-feature-manifest'
import {
  electron,
  electronAppQuit,
  electronButlerReminderDue,
  electronButlerRemindersSync,
  electronButlerTaskComposerRequested,
  electronButlerTasksGetAll,
  electronButlerTasksSync,
  electronButlerWindowModeChanged,
  electronButlerWindowSetActionsOpen,
  electronButlerWindowSetDragging,
  electronButlerWindowSetMode,
  electronButlerWindowSetScale,
  electronOpenChat,
  electronOpenSettings,
  electronOpenWorkbench,
  electronRendererStateSyncAll,
  electronWindowHide,
  electronWindowSetAlwaysOnTop,
  electronWindowSetShape,
  electronWindowSetVisibleOnAllWorkspaces,
  quickChatOpenWindow,
} from '../../../shared/eventa'
import { createButlerTaskId, useButlerTasksStore } from '../../stores/butler-tasks'
import { createButlerAgendaDays } from './butler-calendar'
import { createButlerOrbAnchorStyle, createButlerOrbWindowShape, createButlerRadialActionStyle, createButlerTrayWindowShape } from './butler-orb-layout'
import { BUTLER_ORB_CANVAS_RENDER_SCALE, BUTLER_ORB_CANVAS_TARGET_FPS, createButlerOrbDragBounds, disablePersistedButlerOrbLensSettings, shouldRenderButlerOrbFrame } from './butler-orb-rendering'
import { resolveReminderDeliveryAttemptStatus } from './butler-reminder-delivery'
import { BUTLER_REMINDER_SOUNDS, normalizeButlerReminderSound, normalizeButlerReminderSoundVolume, playButlerReminderSound, shouldPlayButlerReminderSound, shouldRepeatButlerAlertSound } from './butler-reminder-sound'
import { getButlerReminderDeliveryNotice } from './butler-reminder-status'
import { createButlerTaskSyncKey, createButlerTaskSyncTracker } from './butler-task-sync'

type ButlerTab = 'today' | 'tasks' | 'tools'
type ButlerTaskComposerMode = 'reminder' | 'alarm' | 'timer'
interface ButlerQuickAction {
  icon: string
  key: string
  label: string
  onClick: () => Promise<void> | void
  opensTray?: boolean
  tone?: 'danger' | 'primary'
}
type DuePreset = '10m' | '30m' | '1h' | 'today' | 'tomorrow' | 'custom'
type NotificationSuppressionReason = 'muted' | 'do-not-disturb' | 'quiet-hours'
interface ButlerOrbFrame {
  imageWidth: number
  offsetX: number
  offsetY: number
}

const BUTLER_TABS: ButlerTab[] = ['today', 'tasks', 'tools']
const BUTLER_TAB_ICONS: Record<ButlerTab, string> = {
  tasks: 'i-solar:checklist-minimalistic-outline',
  today: 'i-solar:stars-line-duotone',
  tools: 'i-solar:widget-5-outline',
}
const TASK_COMPOSER_MODES: ButlerTaskComposerMode[] = ['reminder', 'alarm', 'timer']
const TASK_REPEAT_OPTIONS: ButlerTaskRepeat[] = ['none', 'daily', 'weekly']
const ALARM_WEEKDAYS: ButlerTaskWeekday[] = [1, 2, 3, 4, 5, 6, 0]
const BUTLER_QUICK_ACTION_COUNT = 8
const TASK_KIND_ICONS: Record<ButlerTaskComposerMode, string> = {
  reminder: 'i-solar:bell-bing-outline',
  alarm: 'i-solar:alarm-bold-duotone',
  timer: 'i-solar:clock-circle-outline',
}
const DUE_PRESETS: DuePreset[] = ['10m', '30m', '1h', 'today', 'tomorrow', 'custom']
const TIMER_PRESETS = [5, 10, 25, 45, 60]
const SNOOZE_MINUTES = [5, 10, 30]
const DUE_PRESET_MS: Record<Exclude<DuePreset, 'today' | 'tomorrow' | 'custom'>, number> = {
  '10m': 10 * 60 * 1000,
  '30m': 30 * 60 * 1000,
  '1h': 60 * 60 * 1000,
}
const ORB_VIEW_SIZES = {
  large: 58,
  small: 44,
  settings: 72,
}
// ponytail: mirrors current Butler window base sizes; promote to shared only when another renderer needs them.
const BUTLER_WINDOW_BASE_SIZE = {
  orb: 260,
  trayHeight: 520,
  trayWidth: 392,
}
const BUTLER_WINDOW_SCALE_LIMITS = { min: 0.85, max: 1.25 }
const BUTLER_OPACITY_LIMITS = { min: 0.55, max: 1 }
const ORB_QUICK_ACTIONS_MOTION_DURATION_MS = 150
const ORB_IMAGE_BASE_WIDTH_RATIO = 132 / ORB_VIEW_SIZES.large
const hiyoriPreviewImage = new URL('../../../../../../packages/stage-ui/src/assets/live2d/models/hiyori/preview.png', import.meta.url).href

const { locale, t } = useI18n()
const workbenchEnabled = createDesktopFeatureManifest(getStageProductEdition()).features.workbench
const eventaContext = useElectronEventaContext()
const butlerTasksStore = useButlerTasksStore()
const displayModelsStore = useDisplayModelsStore()
const avatarFramingStore = useAvatarFramingSettingsStore()
const settingsStageModelStore = useSettingsStageModel()
const { isDark, toggleDark } = useTheme()
const settingsTheme = useSettingsTheme()
const { chatSurfaceOpacity, settingsSurfacePreset } = storeToRefs(settingsTheme)
const backgroundStore = useBackgroundStore()
const { selectedOption: selectedBackground } = storeToRefs(backgroundStore)
const { openTasks, nextTask } = storeToRefs(butlerTasksStore)
const { stageModelSelected, stageModelSelectedDisplayModel } = storeToRefs(settingsStageModelStore)

const setWindowMode = useElectronEventaInvoke(electronButlerWindowSetMode)
const getButlerTasks = useElectronEventaInvoke(electronButlerTasksGetAll)
const syncButlerTasks = useElectronEventaInvoke(electronButlerTasksSync)
const syncButlerReminders = useElectronEventaInvoke(electronButlerRemindersSync)
const getWindowBounds = useElectronEventaInvoke(electron.window.getBounds)
const setWindowBounds = useElectronEventaInvoke(electron.window.setBounds)
const setOrbActionsOpen = useElectronEventaInvoke(electronButlerWindowSetActionsOpen)
const setOrbDragging = useElectronEventaInvoke(electronButlerWindowSetDragging)
const { handleMoveStart, isWindowsPlatform } = useElectronWindowMove()
const setWindowScale = useElectronEventaInvoke(electronButlerWindowSetScale)
const openChat = useElectronEventaInvoke(electronOpenChat)
const openQuickChat = useElectronEventaInvoke(quickChatOpenWindow)
const openSettings = useElectronEventaInvoke(electronOpenSettings)
const openWorkbench = useElectronEventaInvoke(electronOpenWorkbench)
const reloadAllRendererWindows = useElectronEventaInvoke(electronRendererStateSyncAll)
const hideWindow = useElectronEventaInvoke(electronWindowHide)
const setWindowShape = useElectronEventaInvoke(electronWindowSetShape)
const quitApp = useElectronEventaInvoke(electronAppQuit)
const setAlwaysOnTop = useElectronEventaInvoke(electronWindowSetAlwaysOnTop)
const setVisibleOnAllWorkspaces = useElectronEventaInvoke(electronWindowSetVisibleOnAllWorkspaces)

type ButlerTransitionPhase = 'closing' | 'idle' | 'opening'

const mode = ref<ElectronButlerWindowMode>('orb')
const butlerWindowEdge = ref<ElectronButlerWindowEdge>('right')
const butlerTransitionPhase = ref<ButlerTransitionPhase>('idle')
const activeTab = ref<ButlerTab>('today')
const orbQuickActionsOpen = ref(false)
const orbQuickActionsNativeOpen = ref(false)
const orbQuickActionsNativeClosePending = ref(false)
const orbCharging = ref(false)
const orbSettingsOpen = ref(false)
const quitConfirmationOpen = ref(false)
const taskMode = ref<ButlerTaskComposerMode>('reminder')
const selectedCalendarDayKey = ref<string>()
const taskTitle = ref('')
const taskNote = ref('')
const duePreset = ref<DuePreset>('30m')
const defaultReminderAt = Date.now() + DUE_PRESET_MS['30m']
const defaultAlarmAt = Date.now() + 60 * 60 * 1000
const customReminderDate = ref(formatLocalDateInput(defaultReminderAt))
const customReminderTime = ref(formatLocalTimeInput(defaultReminderAt))
const alarmDate = ref(formatLocalDateInput(defaultAlarmAt))
const alarmTime = ref(formatLocalTimeInput(defaultAlarmAt))
const timerHours = ref(0)
const timerMinutes = ref(0)
const timerSeconds = ref(0)
const taskRepeat = ref<ButlerTaskRepeat>('none')
const alarmWeekdays = ref<ButlerTaskWeekday[]>([])
const nowMs = ref(Date.now())
const orbCropLensCleanupApplied = useLocalStorage('settings/butler/orb-crop-lens-cleanup-applied', false)
const taskNotificationsMuted = useLocalStorage('settings/butler/task-notifications-muted', false)
const taskNotificationSound = useLocalStorage<ButlerReminderSound>('settings/butler/task-notification-sound', 'soft-chime')
const taskNotificationSoundVolume = useLocalStorage('settings/butler/task-notification-sound-volume', 0.45)
const taskDoNotDisturbEnabled = useLocalStorage('settings/butler/task-do-not-disturb', false)
const taskQuietHoursEnabled = useLocalStorage('settings/butler/task-quiet-hours-enabled', false)
const taskQuietHoursStart = useLocalStorage('settings/butler/task-quiet-hours-start', '22:00')
const taskQuietHoursEnd = useLocalStorage('settings/butler/task-quiet-hours-end', '08:00')
const butlerAlwaysOnTop = useLocalStorage('settings/butler/always-on-top', true)
const butlerVisibleOnAllWorkspaces = useLocalStorage('settings/butler/visible-all-workspaces', true)
const butlerPositionLocked = useLocalStorage('settings/butler/position-locked', false)
const butlerOpacity = useLocalStorage('settings/butler/opacity', 1)
const butlerWindowScale = useLocalStorage('settings/butler/window-scale', 1)
const autoOpenedTaskIds = new Set<string>()
const nativeNotifiedTaskKeys = new Set<string>()
const reminderDeliveryMutationKeys = new Set<string>()
const editingTaskId = ref<string>()
const pendingTaskMutationIds = ref<Set<string>>(new Set())
const taskCreatePending = ref(false)
const taskMutationError = ref('')
let lastActiveAlertSoundAt: number | undefined
const nowTimer = setInterval(() => {
  nowMs.value = Date.now()
  triggerDueTaskReminders(nowMs.value)
  triggerActiveAlertSound(nowMs.value)
}, 1000)
if (!orbCropLensCleanupApplied.value) {
  avatarFramingStore.framingByModel = disablePersistedButlerOrbLensSettings(avatarFramingStore.framingByModel)
  orbCropLensCleanupApplied.value = true
}
let orbDragState: {
  bounds: { height: number, width: number, x: number, y: number }
  moved: boolean
  pointerId: number
  startCursor: { x: number, y: number }
} | undefined
let cancelledOrbPointerId: number | undefined
let suppressNextOrbClick = false
let stageModelPreviewInitialized = false
let stageModelPreviewInitializing = false
let largeOrbCanvasFrame: number | undefined
let largeOrbCanvasImage: HTMLImageElement | undefined
let largeOrbCanvasImageLoadId = 0
let largeOrbCanvasLastRenderAt = 0
let largeOrbLensCanvas: HTMLCanvasElement | undefined
let largeOrbSourceCanvas: HTMLCanvasElement | undefined
const butlerTaskSyncTracker = createButlerTaskSyncTracker()
async function applyMainTaskMutation(
  mutation: ElectronButlerTaskMutationPayload,
  fallback: () => void,
  logPrefix = 'ButlerOrbTray',
) {
  return await butlerTasksStore.applyMainTaskMutation(mutation, fallback, logPrefix, (mainTasks) => {
    butlerTaskSyncTracker.markPersistedIfCurrent(butlerTasksStore.tasks, mainTasks)
  })
}
let butlerTransitionTimer: ReturnType<typeof setTimeout> | undefined
let butlerTransitionToken = 0
let orbQuickActionsTransitionToken = 0
let orbChargeTimer: ReturnType<typeof setTimeout> | undefined
let butlerShapeFrame: number | undefined
let lastAppliedButlerWindowShapeKey = ''
let butlerTasksHydratedFromMain = false
let taskCreateRequest: { id: string, inputKey: string } | undefined
const largeOrbCanvas = ref<HTMLCanvasElement | null>(null)
const largeOrbCanvasReady = ref(false)

onMounted(() => {
  scheduleButlerWindowShapeSync()
  void initializeStageModelPreview()
  void hydrateButlerTasksFromMain()
  loadLargeOrbCanvasImage()
  if (mode.value === 'orb')
    startLargeOrbCanvasAnimation()
})

onBeforeUnmount(() => {
  orbQuickActionsTransitionToken += 1
  butlerTransitionToken += 1
  clearInterval(nowTimer)
  clearButlerTransitionTimer()
  clearOrbChargeTimer()
  clearButlerWindowShapeFrame()
  stopLargeOrbCanvasAnimation()
  if (orbDragState?.moved)
    void setOrbDragging({ dragging: false })
  orbDragState = undefined
  if (mode.value === 'orb') {
    void setOrbActionsOpen({ open: false })
      .then(() => applyButlerWindowShape(createCurrentOrbWindowShape(false)))
      .catch(error => console.warn('[ButlerOrbTray] Failed to close Butler quick action bounds:', error))
  }
})

function createButlerReminderTaskSnapshots(): ElectronButlerReminderTaskSnapshot[] {
  return butlerTasksStore.tasks
    .filter(task => task.status === 'open')
    .map(task => ({
      dueAt: task.dueAt,
      id: task.id,
      kind: task.kind,
      note: task.note,
      remindedAt: task.remindedAt,
      reminderDeliveryDueAt: task.reminderDeliveryDueAt,
      reminderDeliveryStatus: task.reminderDeliveryStatus,
      status: task.status,
      title: task.title,
      timerPausedAt: task.timerPausedAt,
    }))
}

function createButlerReminderNotificationPolicy(): ElectronButlerReminderNotificationPolicy {
  return {
    doNotDisturb: taskDoNotDisturbEnabled.value,
    muted: taskNotificationsMuted.value,
    quietHoursEnabled: taskQuietHoursEnabled.value,
    quietHoursEnd: taskQuietHoursEnd.value,
    quietHoursStart: taskQuietHoursStart.value,
  }
}

function createButlerReminderSyncKey() {
  const notificationPolicy = createButlerReminderNotificationPolicy()
  const taskKey = createButlerReminderTaskSnapshots()
    .map(task => [
      task.id,
      task.dueAt,
      task.status,
      task.title ?? '',
      task.note ?? '',
      task.remindedAt ?? '',
      task.reminderDeliveryDueAt ?? '',
      task.reminderDeliveryStatus ?? '',
      task.timerPausedAt ?? '',
    ].join(':'))
    .join('|')
  const policyKey = [
    notificationPolicy.doNotDisturb,
    notificationPolicy.muted,
    notificationPolicy.quietHoursEnabled,
    notificationPolicy.quietHoursEnd,
    notificationPolicy.quietHoursStart,
    locale.value,
  ].join(':')
  return `${taskKey}|${policyKey}`
}

function syncButlerRemindersWithMain() {
  if (!butlerTasksHydratedFromMain)
    return

  void syncButlerReminders({
    notificationPolicy: createButlerReminderNotificationPolicy(),
    notificationTitle: t('tamagotchi.stage.butler.tasks.notification-title'),
    tasks: createButlerReminderTaskSnapshots(),
  })
    .catch(error => console.warn('[ButlerOrbTray] Failed to sync Butler reminders with main process:', error))
}

function syncButlerTasksWithMain() {
  if (!butlerTasksHydratedFromMain)
    return

  // NOTICE: Keep full-list sync as the degraded bridge after local fallback writes.
  // Normal task changes go through main-owned mutations; this path prevents
  // localStorage-only task edits from staying stranded when mutation IPC recovers.
  const lastMainAppliedTaskSnapshot = butlerTasksStore.lastMainAppliedTaskSnapshot
  if (lastMainAppliedTaskSnapshot) {
    butlerTaskSyncTracker.markPersistedIfCurrent(
      butlerTasksStore.tasks,
      lastMainAppliedTaskSnapshot,
    )
  }

  const payload = butlerTaskSyncTracker.createSyncPayload(butlerTasksStore.tasks)
  if (!payload)
    return

  void syncButlerTasks({ tasks: payload.tasks })
    .then(() => butlerTaskSyncTracker.markPersistedKey(payload.key))
    .catch(error => console.warn('[ButlerOrbTray] Failed to persist Butler tasks with main process:', error))
}

async function hydrateButlerTasksFromMain() {
  try {
    const tasks = await getButlerTasks()
    const mainTasks = tasks ?? []
    butlerTasksStore.hydrateFromMainTasks(mainTasks)
    butlerTaskSyncTracker.markPersisted(mainTasks)
    butlerTasksHydratedFromMain = true
    syncButlerTasksWithMain()
    syncButlerRemindersWithMain()
    triggerDueTaskReminders(nowMs.value)
  }
  catch (error) {
    console.warn('[ButlerOrbTray] Failed to hydrate Butler tasks from main process:', error)
  }
}

eventaContext.value.on(electronButlerReminderDue, (event) => {
  const taskIds = event.body?.taskIds ?? []
  if (taskIds.length === 0)
    return

  triggerDueTaskReminders(
    event.body?.triggeredAt ?? Date.now(),
    new Set(taskIds),
    new Map((event.body?.deliveryAttempts ?? []).map(attempt => [attempt.taskId, attempt])),
  )
})

eventaContext.value.on(electronButlerTaskComposerRequested, (event) => {
  butlerTasksStore.openComposer(event.body)
  void showTray('tasks')
    .catch(error => console.warn('[ButlerOrbTray] Failed to open requested task composer:', error))
})

watch(createButlerReminderSyncKey, () => {
  syncButlerRemindersWithMain()
}, { immediate: true })

watch(taskNotificationSound, (sound) => {
  const normalizedSound = normalizeButlerReminderSound(sound)
  if (sound !== normalizedSound)
    taskNotificationSound.value = normalizedSound
}, { immediate: true })

function applyTaskComposerDraft(draft: ButlerTaskComposerDraft) {
  if (!draft.title && !draft.dueAt && !draft.kind && !draft.note)
    return

  editingTaskId.value = undefined
  taskMode.value = draft.kind ?? 'reminder'
  taskTitle.value = draft.title ?? ''
  taskNote.value = draft.note ?? ''
  taskRepeat.value = draft.repeat ?? 'none'
  alarmWeekdays.value = draft.alarmWeekdays ? [...draft.alarmWeekdays] : []
  duePreset.value = 'custom'

  if (taskMode.value === 'timer') {
    setTimerDurationFromMs(draft.timerDurationMs ?? Math.max(1000, (draft.dueAt ?? Date.now() + 1000) - Date.now()))
  }
  else if (taskMode.value === 'alarm') {
    setAlarmAt(draft.dueAt ?? Date.now() + 60 * 60 * 1000)
  }
  else {
    setCustomReminderAt(draft.dueAt ?? Date.now() + DUE_PRESET_MS['30m'])
  }

  activeTab.value = 'tasks'
}

watch(() => butlerTasksStore.composerDraft, applyTaskComposerDraft, { deep: true, immediate: true })

watch(() => createButlerTaskSyncKey(butlerTasksStore.tasks), () => {
  syncButlerTasksWithMain()
}, { immediate: true })

eventaContext.value.on(electronButlerWindowModeChanged, (event) => {
  if (event.body?.mode)
    mode.value = event.body.mode
  if (event.body?.edge)
    butlerWindowEdge.value = event.body.edge
  if (typeof event.body?.scale === 'number')
    butlerWindowScale.value = normalizeButlerWindowScale(event.body.scale)
})

watch(stageModelSelected, () => {
  if (!stageModelPreviewInitialized)
    return

  void settingsStageModelStore.updateStageModel()
    .catch(error => console.warn('[ButlerOrbTray] Failed to update stage model preview:', error))
})

const openTaskCountLabel = computed(() => {
  return openTasks.value.length > 99 ? '99+' : String(openTasks.value.length)
})
const butlerPreviewImage = computed(() => stageModelSelectedDisplayModel.value?.previewImage || hiyoriPreviewImage)
const orbCropModelKey = computed(() => stageModelSelected.value || 'default')
const currentOrbCropSettings = computed(() => avatarFramingStore.getFraming(orbCropModelKey.value))
const orbCropX = computed({
  get: () => currentOrbCropSettings.value.x,
  set: x => updateCurrentOrbCropSettings({ x }),
})
const orbCropY = computed({
  get: () => currentOrbCropSettings.value.y,
  set: y => updateCurrentOrbCropSettings({ y }),
})
const orbCropScale = computed({
  get: () => currentOrbCropSettings.value.scale,
  set: scale => updateCurrentOrbCropScale(scale),
})
const orbLensEnabled = computed({
  get: () => currentOrbCropSettings.value.lens,
  set: lens => updateCurrentOrbCropSettings({ lens }),
})
const largeOrbPreviewImageStyle = computed<CSSProperties>(() => createOrbPreviewImageStyle(ORB_VIEW_SIZES.large, { lens: false }))
const smallOrbPreviewImageStyle = computed<CSSProperties>(() => createOrbPreviewImageStyle(ORB_VIEW_SIZES.small, { lens: false }))
const settingsOrbPreviewImageStyle = computed<CSSProperties>(() => createOrbPreviewImageStyle(ORB_VIEW_SIZES.settings, { lens: false }))
const orbCropModelName = computed(() => stageModelSelectedDisplayModel.value?.name || t('tamagotchi.stage.butler.settings.default-model'))
const overdueTasks = computed(() => butlerTasksStore.dueTaskQueue(nowMs.value))
const hasDueTask = computed(() => overdueTasks.value.length > 0)
const taskPlaceholder = computed(() => t(`tamagotchi.stage.butler.tasks.placeholders.${taskMode.value}`))
const taskSubmitPending = computed(() => taskCreatePending.value
  || (editingTaskId.value ? isTaskMutationPending(editingTaskId.value) : false))
const taskSubmitLabel = computed(() => {
  if (taskSubmitPending.value)
    return t('tamagotchi.stage.butler.tasks.saving')

  if (editingTaskId.value)
    return t('tamagotchi.stage.butler.tasks.save')

  return t(`tamagotchi.stage.butler.tasks.submit.${taskMode.value}`)
})
const taskSubmitDisabled = computed(() => taskSubmitPending.value
  || (taskMode.value === 'timer' && timerDurationInputMs() <= 0))
const notificationSuppressionReason = computed(() => getNotificationSuppressionReason(nowMs.value))
const notificationStatusLabel = computed(() => {
  const reason = notificationSuppressionReason.value
  if (reason)
    return t(`tamagotchi.stage.butler.settings.notification-status.${reason}`)

  return t('tamagotchi.stage.butler.settings.notification-status.enabled')
})
const normalizedTaskNotificationSound = computed<ButlerReminderSound>({
  get: () => normalizeButlerReminderSound(taskNotificationSound.value),
  set: sound => taskNotificationSound.value = normalizeButlerReminderSound(sound),
})
const notificationSoundVolumeLabel = computed(() => `${Math.round(normalizeButlerReminderSoundVolume(taskNotificationSoundVolume.value) * 100)}%`)
const normalizedButlerOpacity = computed(() => normalizeButlerOpacity(butlerOpacity.value))
const normalizedButlerWindowScale = computed(() => normalizeButlerWindowScale(butlerWindowScale.value))
const butlerOrbRootStyle = computed<CSSProperties>(() => ({
  ...createButlerOrbAnchorStyle(butlerWindowEdge.value, orbQuickActionsOpen.value),
  height: `${BUTLER_WINDOW_BASE_SIZE.orb}px`,
  opacity: String(normalizedButlerOpacity.value),
  width: `${BUTLER_WINDOW_BASE_SIZE.orb}px`,
  zoom: String(normalizedButlerWindowScale.value),
} as CSSProperties))
const butlerTrayRootStyle = computed<CSSProperties>(() => ({
  ...getSettingsSurfaceStyle(settingsSurfacePreset.value, isDark.value),
  '--butler-surface-strength': `${Math.round(chatSurfaceOpacity.value * 100)}%`,
  'backgroundImage': selectedBackground.value?.src ? `url(${JSON.stringify(selectedBackground.value.src)})` : undefined,
  'backgroundPosition': 'center',
  'backgroundSize': 'cover',
  'height': `${BUTLER_WINDOW_BASE_SIZE.trayHeight}px`,
  'width': `${BUTLER_WINDOW_BASE_SIZE.trayWidth}px`,
  'zoom': String(normalizedButlerWindowScale.value),
} as CSSProperties))
const orbMoodClass = computed(() => {
  if (hasDueTask.value)
    return 'butler-glass-orb--alert'
  if (openTasks.value.length > 0)
    return 'butler-glass-orb--busy'

  return 'butler-glass-orb--idle'
})
const primaryTask = computed(() => overdueTasks.value[0] ?? nextTask.value)
const trayStatusLabel = computed(() => {
  if (overdueTasks.value.length > 0)
    return t('tamagotchi.stage.butler.status.due', { count: overdueTasks.value.length })
  if (openTasks.value.length > 0)
    return t('tamagotchi.stage.butler.status.pending', { count: openTasks.value.length })

  return t('tamagotchi.stage.butler.status.idle')
})
const currentClockLabel = computed(() => formatClockTime(nowMs.value))
const currentDateLabel = computed(() => formatCalendarDate(nowMs.value))
const todayScheduleTasks = computed(() => openTasks.value.filter(task => !isTimerPaused(task) && task.dueAt > nowMs.value && isSameLocalDay(task.dueAt, nowMs.value)))
const upcomingScheduleTasks = computed(() => openTasks.value.filter(task => !isTimerPaused(task) && task.dueAt > nowMs.value && !isSameLocalDay(task.dueAt, nowMs.value)))
const activeTimerTask = computed(() => openTasks.value.find(task => isTimerTask(task) && (isTimerPaused(task) || task.dueAt > nowMs.value)))
const calendarPreviewDays = computed(() => createButlerAgendaDays({
  now: nowMs.value,
  tasks: openTasks.value.filter(task => !isTimerPaused(task)),
}))
const selectedCalendarDay = computed(() => {
  return calendarPreviewDays.value.find(day => day.key === selectedCalendarDayKey.value) ?? calendarPreviewDays.value[0]
})
const selectedCalendarDayTasks = computed(() => {
  const selectedDay = selectedCalendarDay.value
  if (!selectedDay)
    return []

  return openTasks.value
    .filter(task => !isTimerPaused(task) && isSameLocalDay(task.dueAt, selectedDay.timestamp))
    .slice(0, 2)
})
const agendaPreviewTasks = computed(() => {
  const seenTaskIds = new Set<string>()
  return [
    activeTimerTask.value,
    ...overdueTasks.value,
    ...todayScheduleTasks.value,
    ...upcomingScheduleTasks.value,
  ].filter((task): task is ButlerTask => {
    if (!task || seenTaskIds.has(task.id))
      return false

    seenTaskIds.add(task.id)
    return true
  }).slice(0, 3)
})
const agendaStats = computed(() => [
  { key: 'missed', count: overdueTasks.value.length, label: t('tamagotchi.stage.butler.overview.schedule.missed') },
  { key: 'today', count: todayScheduleTasks.value.length, label: t('tamagotchi.stage.butler.overview.schedule.today') },
  { key: 'upcoming', count: upcomingScheduleTasks.value.length, label: t('tamagotchi.stage.butler.overview.schedule.upcoming') },
])

watch(butlerPreviewImage, () => {
  loadLargeOrbCanvasImage()
})

watch(mode, (nextMode) => {
  if (nextMode === 'orb') {
    startLargeOrbCanvasAnimation()
  }
  else {
    stopLargeOrbCanvasAnimation()
  }
})

watch(butlerAlwaysOnTop, (enabled) => {
  void setAlwaysOnTop({
    enabled,
    level: 'screen-saver',
    relativeLevel: 1,
  }).catch(error => console.warn('[ButlerOrbTray] Failed to set always-on-top:', error))
}, { immediate: true })

watch(butlerVisibleOnAllWorkspaces, (enabled) => {
  void setVisibleOnAllWorkspaces(enabled)
    .catch(error => console.warn('[ButlerOrbTray] Failed to set visible-on-all-workspaces:', error))
}, { immediate: true })

watch(butlerWindowScale, (scale) => {
  const nextScale = normalizeButlerWindowScale(scale)
  if (nextScale !== scale) {
    butlerWindowScale.value = nextScale
    return
  }

  void setWindowScale({ scale: nextScale })
    .catch(error => console.warn('[ButlerOrbTray] Failed to set Butler window scale:', error))
}, { immediate: true })

function formatTaskTime(dueAt: number) {
  const date = new Date(dueAt)
  const now = new Date(nowMs.value)
  const sameDay = date.getFullYear() === now.getFullYear()
    && date.getMonth() === now.getMonth()
    && date.getDate() === now.getDate()
  const options: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
  }
  if (!sameDay) {
    options.month = '2-digit'
    options.day = '2-digit'
  }

  return new Intl.DateTimeFormat(undefined, options).format(date)
}

function formatClockTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function formatCalendarDate(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    weekday: 'short',
  }).format(timestamp)
}

function isSameLocalDay(leftTimestamp: number, rightTimestamp: number) {
  const left = new Date(leftTimestamp)
  const right = new Date(rightTimestamp)
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

const BUTLER_HOLIDAY_LABELS = {
  en: {
    'christmas': 'Christmas',
    'christmas-eve': 'Christmas Eve',
    'childrens-day': 'Children',
    'double-ninth': 'Double Ninth',
    'dragon-boat': 'Dragon Boat',
    'halloween': 'Halloween',
    'labor-day': 'Labor Day',
    'lantern-festival': 'Lantern',
    'mid-autumn': 'Mid-Autumn',
    'national-day-cn': 'National Day',
    'new-year': 'New Year',
    'qixi': 'Qixi',
    'spring-festival': 'Lunar New Year',
    'valentine': 'Valentine',
    'womens-day': 'Women',
  },
  zh: {
    'christmas': '圣诞',
    'christmas-eve': '平安夜',
    'childrens-day': '儿童节',
    'double-ninth': '重阳',
    'dragon-boat': '端午',
    'halloween': '万圣夜',
    'labor-day': '劳动节',
    'lantern-festival': '元宵',
    'mid-autumn': '中秋',
    'national-day-cn': '国庆',
    'new-year': '元旦',
    'qixi': '七夕',
    'spring-festival': '春节',
    'valentine': '情人节',
    'womens-day': '妇女节',
  },
} as const

function holidayLabel(holidayId: string) {
  const language = locale.value.startsWith('zh') ? 'zh' : 'en'
  return BUTLER_HOLIDAY_LABELS[language][holidayId as keyof typeof BUTLER_HOLIDAY_LABELS.zh] ?? holidayId
}

function selectCalendarDay(dayKey: string) {
  selectedCalendarDayKey.value = dayKey
}

function calendarDaySummary(day: NonNullable<typeof selectedCalendarDay.value>) {
  if (selectedCalendarDayTasks.value.length > 0) {
    const firstTask = selectedCalendarDayTasks.value[0]
    return `${formatClockTime(firstTask.dueAt)} ${firstTask.title}`
  }

  if (day.holiday)
    return holidayLabel(day.holiday.id)

  return t('tamagotchi.stage.butler.overview.schedule.empty')
}

function calendarDayTaskDots(day: NonNullable<typeof selectedCalendarDay.value>) {
  return (['reminder', 'alarm', 'timer'] as const)
    .filter(kind => day.taskKindCounts[kind] > 0)
}

function agendaBadgeLabel(task: ButlerTask) {
  if (isTimerTask(task))
    return t('tamagotchi.stage.butler.overview.schedule.timer')
  if (task.dueAt <= nowMs.value)
    return t('tamagotchi.stage.butler.overview.schedule.missed')
  if (isSameLocalDay(task.dueAt, nowMs.value))
    return t('tamagotchi.stage.butler.overview.schedule.today')

  return t('tamagotchi.stage.butler.overview.schedule.upcoming')
}

function formatLocalDateInput(timestamp: number) {
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${padTimePart(date.getMonth() + 1)}-${padTimePart(date.getDate())}`
}

function formatLocalTimeInput(timestamp: number) {
  const date = new Date(timestamp)
  return `${padTimePart(date.getHours())}:${padTimePart(date.getMinutes())}`
}

function padTimePart(value: number) {
  return String(value).padStart(2, '0')
}

function formatTimerCountdown(deltaMs: number) {
  const totalSeconds = Math.max(0, Math.ceil(deltaMs / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const timeParts = hours > 0
    ? [hours, minutes, seconds]
    : [minutes, seconds]

  return timeParts
    .map((part, index) => index === 0 ? String(part) : String(part).padStart(2, '0'))
    .join(':')
}

function taskKind(task: Pick<ButlerTask, 'kind'>) {
  return task.kind ?? 'reminder'
}

function taskKindIcon(task: Pick<ButlerTask, 'kind'>) {
  return TASK_KIND_ICONS[taskKind(task)]
}

function taskKindLabel(task: Pick<ButlerTask, 'kind'>) {
  return t(`tamagotchi.stage.butler.tasks.modes.${taskKind(task)}`)
}

function taskRepeatValue(task: Pick<ButlerTask, 'repeat'>) {
  return task.repeat ?? 'none'
}

function isTimerTask(task: Pick<ButlerTask, 'kind'>) {
  return taskKind(task) === 'timer'
}

function isTimerPaused(task: Pick<ButlerTask, 'kind' | 'timerPausedAt' | 'timerRemainingMs'>) {
  return isTimerTask(task) && !!task.timerPausedAt && !!task.timerRemainingMs
}

function alarmWeekdayLabel(day: ButlerTaskWeekday) {
  return t(`tamagotchi.stage.butler.tasks.weekdays.${day}`)
}

function formatAlarmWeekdays(task: Pick<ButlerTask, 'alarmWeekdays'>) {
  if (!task.alarmWeekdays?.length)
    return ''

  return task.alarmWeekdays.map(day => alarmWeekdayLabel(day)).join(' ')
}

function formatTaskMeta(task: ButlerTask) {
  const kindLabel = taskKindLabel(task)
  if (isTimerPaused(task))
    return `${kindLabel} · ${t('tamagotchi.stage.butler.tasks.timer-paused', { time: formatTimerCountdown(task.timerRemainingMs ?? 0) })}`

  const deltaMs = task.dueAt - nowMs.value
  const repeat = taskRepeatValue(task)
  const weekdayText = formatAlarmWeekdays(task)
  let repeatText = ''
  if (weekdayText)
    repeatText = ` · ${weekdayText}`
  else if (repeat !== 'none')
    repeatText = ` · ${t(`tamagotchi.stage.butler.tasks.repeat.${repeat}`)}`

  if (taskKind(task) === 'timer' && deltaMs > 0)
    return `${kindLabel} · ${t('tamagotchi.stage.butler.tasks.timer-remaining', { time: formatTimerCountdown(deltaMs) })}${repeatText}`

  const absMinutes = Math.max(1, Math.round(Math.abs(deltaMs) / 60_000))
  if (deltaMs < 0)
    return `${kindLabel} · ${t('tamagotchi.stage.butler.tasks.overdue', { count: absMinutes })}${repeatText}`
  if (absMinutes < 60)
    return `${kindLabel} · ${t('tamagotchi.stage.butler.tasks.due-in-minutes', { count: absMinutes })}${repeatText}`

  return `${kindLabel} · ${t('tamagotchi.stage.butler.tasks.due-at', { time: formatTaskTime(task.dueAt) })}${repeatText}`
}

function reminderDeliveryNoticeLabel(task: ButlerTask) {
  const notice = getButlerReminderDeliveryNotice(task)
  return notice ? t(`tamagotchi.stage.butler.tasks.delivery.${notice}`) : ''
}

function reminderDeliveryNoticeClass(task: ButlerTask) {
  const notice = getButlerReminderDeliveryNotice(task)
  return notice ? `butler-reminder-notice--${notice}` : ''
}

function dueAtFromPreset(preset: DuePreset) {
  const now = new Date()
  if (preset === 'today') {
    const today = new Date(now)
    today.setHours(18, 0, 0, 0)
    if (today.getTime() <= now.getTime())
      today.setDate(today.getDate() + 1)

    return today.getTime()
  }
  if (preset === 'tomorrow') {
    const tomorrow = new Date(now)
    tomorrow.setDate(tomorrow.getDate() + 1)
    tomorrow.setHours(9, 0, 0, 0)

    return tomorrow.getTime()
  }
  if (preset === 'custom')
    return dueAtFromDateTimeInputs(customReminderDate.value, customReminderTime.value, 30 * 60 * 1000)

  return now.getTime() + DUE_PRESET_MS[preset]
}

function selectDuePreset(preset: DuePreset) {
  duePreset.value = preset
  if (preset !== 'custom')
    setCustomReminderAt(dueAtFromPreset(preset))
}

function toggleAlarmWeekday(day: ButlerTaskWeekday) {
  alarmWeekdays.value = alarmWeekdays.value.includes(day)
    ? alarmWeekdays.value.filter(value => value !== day)
    : [...alarmWeekdays.value, day].sort((a, b) => ALARM_WEEKDAYS.indexOf(a) - ALARM_WEEKDAYS.indexOf(b))
}

function dueAtFromDateTimeInputs(dateValue: string, timeValue: string, fallbackMs: number) {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue)
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue)
  if (dateMatch && timeMatch) {
    const year = Number(dateMatch[1])
    const month = Number(dateMatch[2]) - 1
    const day = Number(dateMatch[3])
    const hours = Number(timeMatch[1])
    const minutes = Number(timeMatch[2])
    const date = new Date(year, month, day, hours, minutes, 0, 0)
    const timestamp = date.getTime()
    const isSameInput = date.getFullYear() === year
      && date.getMonth() === month
      && date.getDate() === day
      && date.getHours() === hours
      && date.getMinutes() === minutes
    if (isSameInput && Number.isFinite(timestamp) && timestamp > Date.now())
      return timestamp
  }

  return Date.now() + fallbackMs
}

function setCustomReminderAt(timestamp: number) {
  customReminderDate.value = formatLocalDateInput(timestamp)
  customReminderTime.value = formatLocalTimeInput(timestamp)
}

function setAlarmAt(timestamp: number) {
  alarmDate.value = formatLocalDateInput(timestamp)
  alarmTime.value = formatLocalTimeInput(timestamp)
}

function dueAtFromReminderDateTime() {
  return dueAtFromDateTimeInputs(customReminderDate.value, customReminderTime.value, 30 * 60 * 1000)
}

function dueAtFromAlarmDateTime() {
  return dueAtFromDateTimeInputs(alarmDate.value, alarmTime.value, 60 * 60 * 1000)
}

function timerDurationInputMs() {
  const totalSeconds = clampTimerUnit(timerHours.value, 0, 24) * 3600
    + clampTimerUnit(timerMinutes.value, 0, 59) * 60
    + clampTimerUnit(timerSeconds.value, 0, 59)
  return totalSeconds * 1000
}

function clampTimerDurationMs(value: number) {
  if (!Number.isFinite(value) || value <= 0)
    return 1000

  return Math.min(24 * 60 * 60 * 1000, Math.max(1000, Math.round(value)))
}

function setTimerDurationFromMs(durationMs: number) {
  const totalSeconds = Math.floor(clampTimerDurationMs(durationMs) / 1000)
  timerHours.value = Math.floor(totalSeconds / 3600)
  timerMinutes.value = Math.floor((totalSeconds % 3600) / 60)
  timerSeconds.value = totalSeconds % 60
}

function setTimerDurationFromMinutes(minutes: number) {
  setTimerDurationFromMs(minutes * 60 * 1000)
}

function clampTimerUnit(value: number, min: number, max: number) {
  const unit = Math.round(Number(value))
  if (!Number.isFinite(unit))
    return min

  return Math.min(max, Math.max(min, unit))
}

function formatTimerDurationLabel(durationMs: number) {
  return formatTimerCountdown(clampTimerDurationMs(durationMs))
}

function normalizeTimerInputs() {
  timerHours.value = clampTimerUnit(timerHours.value, 0, 24)
  timerMinutes.value = clampTimerUnit(timerMinutes.value, 0, 59)
  timerSeconds.value = clampTimerUnit(timerSeconds.value, 0, 59)
}

function clockInputToMinutes(value: string) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value)
  if (!match)
    return undefined

  const hours = Number(match[1])
  const minutes = Number(match[2])
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59)
    return undefined

  return hours * 60 + minutes
}

function isTimestampInQuietHours(timestamp = Date.now()) {
  if (!taskQuietHoursEnabled.value)
    return false

  const start = clockInputToMinutes(taskQuietHoursStart.value) ?? 22 * 60
  const end = clockInputToMinutes(taskQuietHoursEnd.value) ?? 8 * 60
  if (start === end)
    return false

  const date = new Date(timestamp)
  const current = date.getHours() * 60 + date.getMinutes()
  return start < end
    ? current >= start && current < end
    : current >= start || current < end
}

function getNotificationSuppressionReason(now = Date.now()): NotificationSuppressionReason | undefined {
  if (taskNotificationsMuted.value)
    return 'muted'
  if (taskDoNotDisturbEnabled.value)
    return 'do-not-disturb'
  if (isTimestampInQuietHours(now))
    return 'quiet-hours'
}

function defaultTaskTitle() {
  if (taskMode.value === 'alarm')
    return t('tamagotchi.stage.butler.tasks.defaults.alarm')
  if (taskMode.value === 'timer') {
    const durationMs = timerDurationInputMs()
    return durationMs > 0
      ? t('tamagotchi.stage.butler.tasks.defaults.timer', { time: formatTimerDurationLabel(durationMs) })
      : t('tamagotchi.stage.butler.tasks.labels.timer')
  }

  return t('tamagotchi.stage.butler.tasks.defaults.reminder')
}

function taskDueAt() {
  if (taskMode.value === 'alarm')
    return dueAtFromAlarmDateTime()
  if (taskMode.value === 'timer')
    return Date.now() + taskTimerDurationMs()

  return dueAtFromReminderDateTime()
}

function taskTimerDurationMs() {
  return clampTimerDurationMs(timerDurationInputMs())
}

function clearButlerTransitionTimer() {
  if (!butlerTransitionTimer)
    return

  clearTimeout(butlerTransitionTimer)
  butlerTransitionTimer = undefined
}

function clearOrbChargeTimer() {
  if (!orbChargeTimer)
    return

  clearTimeout(orbChargeTimer)
  orbChargeTimer = undefined
}

function startOrbChargeAnimation() {
  clearOrbChargeTimer()
  orbCharging.value = true
  orbChargeTimer = setTimeout(() => {
    orbCharging.value = false
    orbChargeTimer = undefined
  }, 360)
}

function startButlerTransition(phase: ButlerTransitionPhase) {
  clearButlerTransitionTimer()
  butlerTransitionPhase.value = phase
  butlerTransitionToken += 1
  return butlerTransitionToken
}

function finishButlerTransitionLater(token: number, delayMs: number) {
  clearButlerTransitionTimer()
  butlerTransitionTimer = setTimeout(() => {
    butlerTransitionTimer = undefined
    if (token === butlerTransitionToken)
      butlerTransitionPhase.value = 'idle'
  }, delayMs)
}

function waitForButlerTransition(token: number, delayMs: number) {
  clearButlerTransitionTimer()
  return new Promise<boolean>((resolve) => {
    setTimeout(() => {
      resolve(token === butlerTransitionToken)
    }, delayMs)
  })
}

function applyWindowModeResult(result: Awaited<ReturnType<typeof setWindowMode>> | undefined) {
  if (result?.mode)
    mode.value = result.mode
  if (result?.edge)
    butlerWindowEdge.value = result.edge
  if (typeof result?.scale === 'number')
    butlerWindowScale.value = normalizeButlerWindowScale(result.scale)
}

async function setMode(nextMode: ElectronButlerWindowMode) {
  const result = await setWindowMode({ mode: nextMode })
  applyWindowModeResult(result)
}

function createCurrentOrbWindowShape(actionsOpen = orbQuickActionsNativeOpen.value) {
  return createButlerOrbWindowShape({
    actionsOpen,
    edge: butlerWindowEdge.value,
    scale: normalizedButlerWindowScale.value,
    totalActions: BUTLER_QUICK_ACTION_COUNT,
  })
}

async function applyButlerWindowShape(rects: ElectronWindowShapeRect[]) {
  const shapeKey = rects.map(rect => `${rect.x},${rect.y},${rect.width},${rect.height}`).join('|')
  if (shapeKey === lastAppliedButlerWindowShapeKey)
    return

  try {
    await setWindowShape(rects)
    lastAppliedButlerWindowShapeKey = shapeKey
  }
  catch (error) {
    console.warn('[ButlerOrbTray] Failed to sync native window shape:', error)
  }
}

async function showTray(tab: ButlerTab = 'today') {
  const token = startButlerTransition('opening')
  const openingFromQuickActions = mode.value === 'orb' && orbQuickActionsOpen.value
  if (!openingFromQuickActions)
    resetOrbQuickActionsState()
  orbSettingsOpen.value = false
  activeTab.value = tab
  try {
    await setMode('tray')
    await applyButlerWindowShape(createButlerTrayWindowShape(normalizedButlerWindowScale.value))
    resetOrbQuickActionsState()
    finishButlerTransitionLater(token, 170)
  }
  catch (error) {
    resetOrbQuickActionsState()
    if (openingFromQuickActions) {
      void setOrbActionsOpen({ open: false })
        .catch(closeError => console.warn('[ButlerOrbTray] Failed to close Butler quick action bounds:', closeError))
    }
    if (token === butlerTransitionToken)
      butlerTransitionPhase.value = 'idle'
    throw error
  }
}

async function showDueTasks(taskIds: string[]) {
  await showTray('tasks')
  await nextTick()
  const taskId = taskIds[0]
  if (!taskId)
    return
  document.querySelector<HTMLElement>(`[data-butler-task-id="${CSS.escape(taskId)}"]`)
    ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
}

async function openDesktopControls() {
  await showTray('tools')
}

async function collapseTray() {
  resetOrbQuickActionsState()
  void setOrbActionsOpen({ open: false })
    .catch(error => console.warn('[ButlerOrbTray] Failed to close Butler quick action bounds:', error))
  orbSettingsOpen.value = false
  if (mode.value !== 'tray') {
    await setMode('orb')
    await applyButlerWindowShape(createCurrentOrbWindowShape(false))
    return
  }

  const token = startButlerTransition('closing')
  const shouldContinue = await waitForButlerTransition(token, 120)
  if (!shouldContinue)
    return

  try {
    // NOTICE: Shrink the native hit region before resizing the transparent
    // panel so Windows does not recompose the full tray during collapse.
    await applyButlerWindowShape(createCurrentOrbWindowShape(false))
    await setMode('orb')
  }
  finally {
    if (token === butlerTransitionToken)
      butlerTransitionPhase.value = 'idle'
  }
}

function resetTaskComposerFields() {
  taskCreateRequest = undefined
  taskTitle.value = ''
  taskNote.value = ''
  duePreset.value = '30m'
  setCustomReminderAt(Date.now() + DUE_PRESET_MS['30m'])
  setAlarmAt(Date.now() + 60 * 60 * 1000)
  alarmWeekdays.value = []
  timerHours.value = 0
  timerMinutes.value = 0
  timerSeconds.value = 0
  taskRepeat.value = 'none'
}

async function handleOpenChat() {
  await openChat()
  await collapseTray()
}

async function handleOpenQuickChat() {
  await openQuickChat()
  await collapseTray()
}

async function handleOpenSettings() {
  await openSettings(undefined)
  await collapseTray()
}

async function handleRefreshRendererState() {
  await reloadAllRendererWindows()
}

function handleToggleTheme() {
  toggleDark()
}

async function handleOpenWorkbench() {
  await openWorkbench()
  await collapseTray()
}

async function handleOpenTurtleSoup() {
  window.open(await createTurtleSoupLaunchUrl(), '_blank', 'noopener,noreferrer')
  await collapseTray()
}

async function handleHideButler() {
  await hideWindow()
}

async function handleQuitAiri() {
  await quitApp()
}

function requestQuitAiri() {
  quitConfirmationOpen.value = true
}

function openTaskComposer(nextMode: ButlerTaskComposerMode = 'reminder') {
  orbSettingsOpen.value = false
  if (!editingTaskId.value)
    resetTaskComposerFields()
  taskMode.value = nextMode
  activeTab.value = 'tasks'
  butlerTasksStore.openComposer()
  if (mode.value !== 'tray') {
    void showTray('tasks')
      .catch(error => console.warn('[ButlerOrbTray] Failed to open task composer:', error))
  }
}

function selectTab(tab: ButlerTab) {
  orbSettingsOpen.value = false
  activeTab.value = tab
}

async function addTask() {
  if (taskCreatePending.value)
    return

  if (taskMode.value === 'timer') {
    normalizeTimerInputs()
    if (timerDurationInputMs() <= 0)
      return
  }

  taskMutationError.value = ''

  const title = taskTitle.value.trim() || defaultTaskTitle()
  if (!title)
    return

  const input = {
    title,
    kind: taskMode.value,
    note: taskNote.value,
    repeat: taskMode.value === 'reminder' ? taskRepeat.value : 'none',
    alarmWeekdays: taskMode.value === 'alarm' ? [...alarmWeekdays.value] : [],
    timerDurationMs: taskMode.value === 'timer' ? taskTimerDurationMs() : undefined,
    dueAt: taskDueAt(),
  } as const
  if (editingTaskId.value) {
    const taskId = editingTaskId.value
    const task = openTasks.value.find(candidate => candidate.id === taskId)
    if (!task || isTaskMutationPending(taskId))
      return

    setTaskMutationPending(taskId, true)
    let fallbackApplied = false
    try {
      const mainApplied = await applyMainTaskMutation({
        expectedUpdatedAt: task.updatedAt,
        id: taskId,
        patch: input,
        type: 'update',
      }, () => {
        butlerTasksStore.updateTask(taskId, input)
        fallbackApplied = true
      })
      if (!mainApplied && !fallbackApplied) {
        taskMutationError.value = t('tamagotchi.stage.butler.tasks.errors.save-failed')
        return
      }
    }
    finally {
      setTaskMutationPending(taskId, false)
    }
  }
  else {
    taskCreatePending.value = true
    const inputKey = JSON.stringify(input)
    if (taskCreateRequest?.inputKey !== inputKey)
      taskCreateRequest = { id: createButlerTaskId(), inputKey }

    try {
      const mainApplied = await applyMainTaskMutation({
        id: taskCreateRequest.id,
        input,
        type: 'create',
      }, () => {})
      if (!mainApplied) {
        taskMutationError.value = t('tamagotchi.stage.butler.tasks.errors.save-failed')
        return
      }
    }
    finally {
      taskCreatePending.value = false
    }
  }

  editingTaskId.value = undefined
  resetTaskComposerFields()
}

function editTask(task: ButlerTask) {
  editingTaskId.value = task.id
  taskMode.value = taskKind(task)
  taskTitle.value = task.title
  taskNote.value = task.note ?? ''
  taskRepeat.value = taskKind(task) === 'reminder' ? taskRepeatValue(task) : 'none'
  alarmWeekdays.value = task.alarmWeekdays ? [...task.alarmWeekdays] : []
  setCustomReminderAt(task.dueAt)
  duePreset.value = 'custom'
  setAlarmAt(task.dueAt)
  if (taskKind(task) === 'timer')
    setTimerDurationFromMs(task.timerDurationMs ?? task.dueAt - Date.now())
}

function cancelTaskEdit() {
  editingTaskId.value = undefined
  resetTaskComposerFields()
}

function cancelTaskEditIfCurrent(id: string) {
  if (editingTaskId.value === id)
    cancelTaskEdit()
}

function taskReminderKey(task: Pick<ButlerTask, 'dueAt' | 'id'>) {
  return `${task.id}:${task.dueAt}`
}

function forgetTaskReminderState(id: string) {
  for (const key of autoOpenedTaskIds) {
    if (key.startsWith(`${id}:`))
      autoOpenedTaskIds.delete(key)
  }
  for (const key of nativeNotifiedTaskKeys) {
    if (key.startsWith(`${id}:`))
      nativeNotifiedTaskKeys.delete(key)
  }
  for (const key of reminderDeliveryMutationKeys) {
    if (key.startsWith(`${id}:`))
      reminderDeliveryMutationKeys.delete(key)
  }
}

function setTaskMutationPending(id: string, pending: boolean) {
  const nextIds = new Set(pendingTaskMutationIds.value)
  if (pending)
    nextIds.add(id)
  else
    nextIds.delete(id)
  pendingTaskMutationIds.value = nextIds
}

function isTaskMutationPending(id: string) {
  return pendingTaskMutationIds.value.has(id)
}

function findOpenTask(id: string) {
  return openTasks.value.find(task => task.id === id)
}

async function runGuardedTaskMutation(
  task: ButlerTask,
  mutation: ElectronButlerTaskMutationPayload,
  fallback: () => void,
) {
  if (isTaskMutationPending(task.id))
    return false

  setTaskMutationPending(task.id, true)
  try {
    return await applyMainTaskMutation(mutation, fallback)
  }
  finally {
    setTaskMutationPending(task.id, false)
  }
}

async function completeTask(id: string) {
  const task = findOpenTask(id)
  if (!task)
    return

  cancelTaskEditIfCurrent(id)
  forgetTaskReminderState(id)
  await runGuardedTaskMutation(task, {
    expectedUpdatedAt: task.updatedAt,
    id,
    type: 'complete',
  }, () => butlerTasksStore.completeTask(id))
}

async function snoozeTask(id: string, minutes = 10) {
  const task = findOpenTask(id)
  if (!task)
    return

  cancelTaskEditIfCurrent(id)
  forgetTaskReminderState(id)
  const durationMs = minutes * 60 * 1000
  await runGuardedTaskMutation(task, {
    durationMs,
    expectedUpdatedAt: task.updatedAt,
    id,
    type: 'snooze',
  }, () => butlerTasksStore.snoozeTask(id, durationMs))
}

async function pauseOrResumeTimer(task: ButlerTask) {
  const currentTask = findOpenTask(task.id)
  if (!currentTask)
    return

  cancelTaskEditIfCurrent(currentTask.id)
  forgetTaskReminderState(currentTask.id)
  const paused = isTimerPaused(currentTask)
  await runGuardedTaskMutation(currentTask, {
    expectedUpdatedAt: currentTask.updatedAt,
    id: currentTask.id,
    type: paused ? 'resume-timer' : 'pause-timer',
  }, () => {
    if (paused)
      butlerTasksStore.resumeTimer(currentTask.id)
    else
      butlerTasksStore.pauseTimer(currentTask.id)
  })
}

async function resetTimer(id: string) {
  const task = findOpenTask(id)
  if (!task)
    return

  cancelTaskEditIfCurrent(id)
  forgetTaskReminderState(id)
  await runGuardedTaskMutation(task, {
    expectedUpdatedAt: task.updatedAt,
    id,
    type: 'reset-timer',
  }, () => butlerTasksStore.resetTimer(id))
}

async function cancelTask(id: string) {
  const task = findOpenTask(id)
  if (!task)
    return

  cancelTaskEditIfCurrent(id)
  forgetTaskReminderState(id)
  await runGuardedTaskMutation(task, {
    expectedUpdatedAt: task.updatedAt,
    id,
    type: 'dismiss',
  }, () => butlerTasksStore.dismissTask(id))
}

async function applyTaskReminderDeliveryAttempt(task: Pick<ButlerTask, 'dueAt' | 'id'>, attempt: ButlerReminderDeliveryAttempt) {
  const key = taskReminderKey(task)
  if (reminderDeliveryMutationKeys.has(key))
    return

  reminderDeliveryMutationKeys.add(key)
  try {
    await applyMainTaskMutation({
      attempt,
      id: task.id,
      type: 'record-reminder-delivery-attempt',
    }, () => {
      butlerTasksStore.recordReminderDeliveryAttempt(task.id, attempt)
    }, 'ButlerOrbTray')
  }
  finally {
    reminderDeliveryMutationKeys.delete(key)
  }
}

async function markTaskReminderDelivered(task: Pick<ButlerTask, 'dueAt' | 'id'>, attemptedAt = Date.now()) {
  await applyTaskReminderDeliveryAttempt(task, {
    attemptedAt,
    dueAt: task.dueAt,
    status: 'delivered',
  })
}

function triggerNativeTaskNotification(task: ButlerTask): ButlerNativeNotificationResult {
  const notificationKey = `${task.id}:${task.dueAt}`
  if (nativeNotifiedTaskKeys.has(notificationKey))
    return 'duplicate'

  if (getNotificationSuppressionReason())
    return 'suppressed'

  nativeNotifiedTaskKeys.add(notificationKey)
  if (!('Notification' in window))
    return 'unavailable'

  const showNotification = () => {
    return new Notification(t('tamagotchi.stage.butler.tasks.notification-title'), {
      body: task.note ? `${task.title}\n${task.note}` : task.title,
      tag: notificationKey,
    })
  }

  if (Notification.permission === 'granted') {
    showNotification()
    return 'shown'
  }
  else if (Notification.permission === 'default') {
    void Notification.requestPermission().then((permission) => {
      if (permission === 'granted')
        showNotification()
    })
    return 'requested'
  }

  return 'denied'
}

function triggerReminderSound(blockedByComfortSettings: boolean) {
  const sound = normalizedTaskNotificationSound.value
  if (!shouldPlayButlerReminderSound({
    blockedByComfortSettings,
    sound,
  })) {
    return
  }

  void playButlerReminderSound(sound, taskNotificationSoundVolume.value)
    .catch(error => console.warn('[ButlerOrbTray] Failed to play reminder sound:', error))
}

function triggerActiveAlertSound(now = Date.now()) {
  const activeAlerts = butlerTasksStore.activeAlertTasks(now)
  if (activeAlerts.length === 0) {
    lastActiveAlertSoundAt = undefined
    return
  }

  const hasNewAlert = activeAlerts.some(task => !autoOpenedTaskIds.has(taskReminderKey(task)))
  for (const task of activeAlerts)
    autoOpenedTaskIds.add(taskReminderKey(task))
  if (hasNewAlert)
    void showDueTasks(activeAlerts.map(task => task.id))

  if (!shouldRepeatButlerAlertSound({
    activeAlertCount: activeAlerts.length,
    lastPlayedAt: lastActiveAlertSoundAt,
    now,
  })) {
    return
  }

  lastActiveAlertSoundAt = now
  triggerReminderSound(!!getNotificationSuppressionReason(now))
}

function testReminderSound() {
  triggerReminderSound(false)
}

function triggerDueTaskReminders(
  now = Date.now(),
  taskIds?: Set<string>,
  mainDeliveryAttempts = new Map<string, ElectronButlerReminderDeliveryAttempt>(),
) {
  const dueTasks = butlerTasksStore
    .pendingTaskDeliveries(now)
    .filter(task => !taskIds || taskIds.has(task.id))
    .slice(0, 2)
  if (dueTasks.length === 0)
    return

  const hasNewDueTask = dueTasks.some(task => !autoOpenedTaskIds.has(taskReminderKey(task)))
  for (const task of dueTasks)
    autoOpenedTaskIds.add(taskReminderKey(task))
  if (hasNewDueTask)
    void showDueTasks(dueTasks.map(task => task.id))

  const blockedByComfortSettings = !!getNotificationSuppressionReason(now)
  if (hasNewDueTask && dueTasks.some(task => taskKind(task) === 'reminder'))
    triggerReminderSound(blockedByComfortSettings)

  for (const task of dueTasks) {
    const mainDeliveryAttempt = mainDeliveryAttempts.get(task.id)
    const nativeNotificationResult = mainDeliveryAttempt?.nativeNotificationResult ?? triggerNativeTaskNotification(task)
    const deliveryStatus = resolveReminderDeliveryAttemptStatus({
      aiReminderAvailable: false,
      nativeNotificationResult,
    })
    if (deliveryStatus === 'delivered') {
      void markTaskReminderDelivered(task, now)
    }
    else if (deliveryStatus === 'blocked' || deliveryStatus === 'failed') {
      void applyTaskReminderDeliveryAttempt(task, {
        attemptedAt: now,
        dueAt: task.dueAt,
        status: deliveryStatus,
      })
    }
  }
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value))
    return min

  return Math.min(max, Math.max(min, value))
}

function normalizeButlerOpacity(value: number) {
  return clampNumber(value, BUTLER_OPACITY_LIMITS.min, BUTLER_OPACITY_LIMITS.max)
}

function normalizeButlerWindowScale(value: number) {
  return clampNumber(value, BUTLER_WINDOW_SCALE_LIMITS.min, BUTLER_WINDOW_SCALE_LIMITS.max)
}

function updateCurrentOrbCropSettings(nextSettings: Partial<AvatarFramingSettings>) {
  avatarFramingStore.updateFraming(orbCropModelKey.value, nextSettings)
}

function updateCurrentOrbCropScale(scale: number) {
  avatarFramingStore.updateScale(orbCropModelKey.value, scale)
}

function resetCurrentOrbCropSettings() {
  avatarFramingStore.resetFraming(orbCropModelKey.value)
}

function toggleOrbSettings() {
  orbSettingsOpen.value = !orbSettingsOpen.value
}

function createOrbPreviewImageStyle(orbSize: number, options: { lens?: boolean } = {}): CSSProperties {
  const settings = currentOrbCropSettings.value
  const frame = createOrbFrame(orbSize)
  const lensEnabled = options.lens ?? settings.lens
  const lensCoreScale = lensEnabled ? 1.42 : 1
  const lensEdgeScale = lensEnabled ? 0.96 : 1

  return {
    '--butler-orb-image-width': `${frame.imageWidth.toFixed(1)}px`,
    '--butler-orb-image-x': `${frame.offsetX.toFixed(1)}px`,
    '--butler-orb-image-y': `${frame.offsetY.toFixed(1)}px`,
    '--butler-orb-lens-core-opacity': lensEnabled ? '1' : '0',
    '--butler-orb-lens-core-scale': lensCoreScale.toFixed(2),
    '--butler-orb-lens-edge-scale': lensEdgeScale.toFixed(2),
    '--butler-orb-lens-overlay-opacity': lensEnabled ? '1' : '0',
  } as CSSProperties
}

function createOrbFrame(orbSize: number, renderScale = 1): ButlerOrbFrame {
  const settings = currentOrbCropSettings.value

  return {
    imageWidth: orbSize * ORB_IMAGE_BASE_WIDTH_RATIO * settings.scale * renderScale,
    offsetX: settings.x / 100 * orbSize * renderScale,
    offsetY: settings.y / 100 * orbSize * renderScale,
  }
}

function smoothStep(edge0: number, edge1: number, value: number) {
  const x = clampNumber((value - edge0) / (edge1 - edge0), 0, 1)

  return x * x * (3 - 2 * x)
}

function sampleBilinear(source: Uint8ClampedArray, size: number, x: number, y: number, target: Uint8ClampedArray, targetIndex: number) {
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(size - 1, x0 + 1)
  const y1 = Math.min(size - 1, y0 + 1)
  const dx = x - x0
  const dy = y - y0
  const topLeft = (y0 * size + x0) * 4
  const topRight = (y0 * size + x1) * 4
  const bottomLeft = (y1 * size + x0) * 4
  const bottomRight = (y1 * size + x1) * 4

  for (let channel = 0; channel < 4; channel++) {
    const top = source[topLeft + channel] * (1 - dx) + source[topRight + channel] * dx
    const bottom = source[bottomLeft + channel] * (1 - dx) + source[bottomRight + channel] * dx
    target[targetIndex + channel] = top * (1 - dy) + bottom * dy
  }
}

function applyRadialLensDistortion(sourceData: ImageData, targetData: ImageData, size: number) {
  const source = sourceData.data
  const target = targetData.data
  const centerX = size * 0.5
  const centerY = size * 0.45
  const radius = size * 0.43
  const magnification = 1.72

  target.set(source)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x + 0.5 - centerX
      const dy = y + 0.5 - centerY
      const distance = Math.sqrt(dx * dx + dy * dy)
      if (distance > radius)
        continue

      const normalizedDistance = distance / radius
      const edgeFalloff = smoothStep(0, 1, normalizedDistance)
      const sampleFactor = (1 / magnification) + (1 - 1 / magnification) * edgeFalloff
      const sampleX = centerX + dx * sampleFactor
      const sampleY = centerY + dy * sampleFactor
      if (sampleX < 0 || sampleX >= size - 1 || sampleY < 0 || sampleY >= size - 1)
        continue

      sampleBilinear(source, size, sampleX, sampleY, target, (y * size + x) * 4)
    }
  }
}

function drawRadialLensGlass(context: CanvasRenderingContext2D, size: number) {
  const centerX = size * 0.5
  const centerY = size * 0.45
  const radius = size * 0.43
  const edgeGradient = context.createRadialGradient(centerX, centerY, radius * 0.08, centerX, centerY, radius)
  edgeGradient.addColorStop(0, 'rgba(255, 255, 255, 0.035)')
  edgeGradient.addColorStop(0.66, 'rgba(255, 255, 255, 0.02)')
  edgeGradient.addColorStop(1, 'rgba(12, 18, 28, 0.06)')

  context.save()
  context.beginPath()
  context.arc(centerX, centerY, radius, 0, Math.PI * 2)
  context.clip()
  context.fillStyle = edgeGradient
  context.fillRect(centerX - radius, centerY - radius, radius * 2, radius * 2)
  context.restore()
}

function loadLargeOrbCanvasImage() {
  const loadId = ++largeOrbCanvasImageLoadId
  const image = new Image()

  largeOrbCanvasReady.value = false
  image.onload = () => {
    if (loadId !== largeOrbCanvasImageLoadId)
      return

    largeOrbCanvasImage = image
  }
  image.onerror = () => {
    if (loadId !== largeOrbCanvasImageLoadId)
      return

    largeOrbCanvasImage = undefined
    largeOrbCanvasReady.value = false
  }
  image.src = butlerPreviewImage.value
}

function startLargeOrbCanvasAnimation() {
  if (largeOrbCanvasFrame)
    return

  largeOrbCanvasLastRenderAt = 0
  const render = (timestamp: number) => {
    if (shouldRenderButlerOrbFrame(timestamp, largeOrbCanvasLastRenderAt, BUTLER_ORB_CANVAS_TARGET_FPS)) {
      drawLargeOrbCanvas(timestamp)
      largeOrbCanvasLastRenderAt = timestamp
    }
    largeOrbCanvasFrame = requestAnimationFrame(render)
  }

  largeOrbCanvasFrame = requestAnimationFrame(render)
}

function stopLargeOrbCanvasAnimation() {
  if (!largeOrbCanvasFrame)
    return

  cancelAnimationFrame(largeOrbCanvasFrame)
  largeOrbCanvasFrame = undefined
  largeOrbCanvasLastRenderAt = 0
}

function drawLargeOrbCanvas(timestamp: number) {
  const canvas = largeOrbCanvas.value
  const image = largeOrbCanvasImage
  if (!canvas || !image || !image.naturalWidth || mode.value !== 'orb')
    return

  const renderScale = BUTLER_ORB_CANVAS_RENDER_SCALE
  const canvasSize = Math.round(ORB_VIEW_SIZES.large * renderScale)
  if (canvas.width !== canvasSize || canvas.height !== canvasSize) {
    canvas.width = canvasSize
    canvas.height = canvasSize
  }

  const context = canvas.getContext('2d')
  if (!context)
    return

  largeOrbSourceCanvas ||= document.createElement('canvas')
  largeOrbLensCanvas ||= document.createElement('canvas')
  if (largeOrbSourceCanvas.width !== canvasSize || largeOrbSourceCanvas.height !== canvasSize) {
    largeOrbSourceCanvas.width = canvasSize
    largeOrbSourceCanvas.height = canvasSize
    largeOrbLensCanvas.width = canvasSize
    largeOrbLensCanvas.height = canvasSize
  }

  const sourceContext = largeOrbSourceCanvas.getContext('2d')
  const lensContext = largeOrbLensCanvas.getContext('2d')
  if (!sourceContext || !lensContext)
    return

  const time = timestamp / 1000
  const driftX = Math.sin(time * Math.PI * 2 / 5.8) * 4.8
  const driftY = Math.sin(time * Math.PI * 2 / 6.4 + 0.7) * 3.8
  const center = canvasSize / 2
  const frame = createOrbFrame(ORB_VIEW_SIZES.large, renderScale)
  const imageWidth = Math.round(frame.imageWidth)
  const imageHeight = Math.round(imageWidth * image.naturalHeight / image.naturalWidth)
  const drawX = center - imageWidth / 2 + frame.offsetX + driftX * renderScale
  const drawY = center - imageHeight * 0.45 + frame.offsetY + driftY * renderScale

  sourceContext.clearRect(0, 0, canvasSize, canvasSize)
  sourceContext.imageSmoothingEnabled = true
  sourceContext.imageSmoothingQuality = 'high'
  sourceContext.drawImage(image, drawX, drawY, imageWidth, imageHeight)

  context.clearRect(0, 0, canvasSize, canvasSize)
  context.save()
  context.beginPath()
  context.arc(center, center, center, 0, Math.PI * 2)
  context.clip()

  if (currentOrbCropSettings.value.lens) {
    const sourceData = sourceContext.getImageData(0, 0, canvasSize, canvasSize)
    const targetData = lensContext.createImageData(canvasSize, canvasSize)
    applyRadialLensDistortion(sourceData, targetData, canvasSize)
    lensContext.putImageData(targetData, 0, 0)
    context.drawImage(largeOrbLensCanvas, 0, 0)
    drawRadialLensGlass(context, canvasSize)
  }
  else {
    context.drawImage(largeOrbSourceCanvas, 0, 0)
  }

  context.restore()
  if (!largeOrbCanvasReady.value)
    largeOrbCanvasReady.value = true
}

async function initializeStageModelPreview() {
  if (stageModelPreviewInitialized || stageModelPreviewInitializing)
    return

  stageModelPreviewInitializing = true

  try {
    await displayModelsStore.loadDisplayModelsFromIndexedDB()
    await settingsStageModelStore.initializeStageModel()
    stageModelPreviewInitialized = true
  }
  catch (error) {
    stageModelPreviewInitialized = false
    console.warn('[ButlerOrbTray] Failed to initialize stage model preview:', error)
  }
  finally {
    stageModelPreviewInitializing = false
  }
}

async function handleOrbPointerDown(event: PointerEvent) {
  if (mode.value !== 'orb' || event.button !== 0 || butlerPositionLocked.value)
    return

  const target = event.currentTarget as HTMLElement | null
  target?.setPointerCapture?.(event.pointerId)
  cancelledOrbPointerId = undefined
  const bounds = await getWindowBounds()
  if (cancelledOrbPointerId === event.pointerId) {
    cancelledOrbPointerId = undefined
    return
  }
  orbDragState = {
    bounds,
    moved: false,
    pointerId: event.pointerId,
    startCursor: { x: event.screenX, y: event.screenY },
  }
}

async function handleOrbPointerMove(event: PointerEvent) {
  const state = orbDragState
  if (!state || state.pointerId !== event.pointerId || !(event.buttons & 1))
    return

  const nextBounds = createButlerOrbDragBounds(state.bounds, state.startCursor, {
    x: event.screenX,
    y: event.screenY,
  })
  if (!nextBounds)
    return

  if (!state.moved) {
    void setOrbDragging({ dragging: true })
      .catch(error => console.warn('[ButlerOrbTray] Failed to set Butler drag state:', error))
  }
  state.moved = true
  void setWindowBounds([nextBounds])
    .catch(error => console.warn('[ButlerOrbTray] Failed to move Butler orb:', error))
}

async function finishOrbPointerDrag(event: PointerEvent) {
  const state = orbDragState
  if (!state || state.pointerId !== event.pointerId) {
    cancelledOrbPointerId = event.pointerId
    return
  }

  const target = event.currentTarget as HTMLElement | null
  target?.releasePointerCapture?.(event.pointerId)
  orbDragState = undefined
  if (!state.moved)
    return

  suppressNextOrbClick = true
  await setOrbDragging({ dragging: false })
  window.setTimeout(() => {
    suppressNextOrbClick = false
  }, 0)
}

async function handleOrbClick() {
  if (suppressNextOrbClick) {
    suppressNextOrbClick = false
    return
  }

  startOrbChargeAnimation()
  if (!orbQuickActionsOpen.value) {
    await openOrbQuickActions()
    return
  }

  await closeOrbQuickActions()
}

function resetOrbQuickActionsState() {
  orbQuickActionsTransitionToken += 1
  orbQuickActionsOpen.value = false
  orbQuickActionsNativeOpen.value = false
  orbQuickActionsNativeClosePending.value = false
}

async function openOrbQuickActions() {
  const token = ++orbQuickActionsTransitionToken

  if (orbQuickActionsNativeOpen.value && !orbQuickActionsNativeClosePending.value) {
    orbQuickActionsOpen.value = true
    return
  }

  try {
    await setOrbActionsOpen({ open: true })
    if (token !== orbQuickActionsTransitionToken)
      return

    orbQuickActionsNativeClosePending.value = false
    orbQuickActionsNativeOpen.value = true
    await applyButlerWindowShape(createCurrentOrbWindowShape(true))
    if (token === orbQuickActionsTransitionToken)
      orbQuickActionsOpen.value = true
  }
  catch (error) {
    if (token === orbQuickActionsTransitionToken) {
      resetOrbQuickActionsState()
      void setOrbActionsOpen({ open: false })
        .catch(closeError => console.warn('[ButlerOrbTray] Failed to roll back Butler quick action bounds:', closeError))
    }
    console.warn('[ButlerOrbTray] Failed to open Butler quick action bounds:', error)
  }
}

const quickActions = computed<ButlerQuickAction[]>(() => [
  {
    key: 'alarm',
    icon: 'i-solar:alarm-bold-duotone',
    label: t('tamagotchi.stage.butler.actions.alarm'),
    onClick: () => openTaskComposer('alarm'),
    opensTray: true,
  },
  {
    key: 'tools',
    icon: 'i-solar:widget-5-outline',
    label: t('tamagotchi.stage.butler.actions.more'),
    onClick: () => showTray('tools'),
    opensTray: true,
  },
  {
    key: 'theme',
    icon: isDark.value ? 'i-solar:sun-2-outline' : 'i-solar:moon-outline',
    label: isDark.value ? t('tamagotchi.stage.butler.actions.light') : t('tamagotchi.stage.butler.actions.dark'),
    onClick: handleToggleTheme,
  },
  {
    key: 'refresh',
    icon: 'i-solar:refresh-outline',
    label: t('tamagotchi.stage.butler.actions.refresh'),
    onClick: handleRefreshRendererState,
  },
  {
    key: 'quit',
    icon: 'i-solar:power-bold-duotone',
    label: t('tamagotchi.stage.butler.settings.quit-airi'),
    onClick: handleQuitAiri,
    tone: 'danger',
  },
  {
    key: 'settings',
    icon: 'i-solar:settings-minimalistic-outline',
    label: t('tamagotchi.stage.butler.actions.settings'),
    onClick: handleOpenSettings,
  },
  {
    key: 'turtle-soup',
    icon: 'i-solar:gamepad-minimalistic-outline',
    label: t('tamagotchi.stage.butler.actions.turtle-soup'),
    onClick: handleOpenTurtleSoup,
  },
  {
    key: 'chat',
    icon: 'i-solar:chat-line-line-duotone',
    label: t('tamagotchi.stage.butler.actions.chat'),
    onClick: handleOpenChat,
    tone: 'primary',
  },
])

const todayQuickActions = computed(() => quickActions.value.filter(action => action.key !== 'tools'))

function clearButlerWindowShapeFrame() {
  if (!butlerShapeFrame)
    return

  cancelAnimationFrame(butlerShapeFrame)
  butlerShapeFrame = undefined
}

function scheduleButlerWindowShapeSync() {
  clearButlerWindowShapeFrame()
  butlerShapeFrame = requestAnimationFrame(() => {
    butlerShapeFrame = undefined
    void syncButlerWindowShape()
  })
}

async function syncButlerWindowShape() {
  await nextTick()

  const rects: ElectronWindowShapeRect[] = mode.value === 'orb'
    ? createCurrentOrbWindowShape()
    : createButlerTrayWindowShape(normalizedButlerWindowScale.value)

  await applyButlerWindowShape(rects)
}

const radialQuickActionStyles = computed(() => {
  return quickActions.value.map((_, index) => createButlerRadialActionStyle(index, quickActions.value.length, butlerWindowEdge.value))
})

function handleQuickActionClick(action: ButlerQuickAction) {
  if (!action.opensTray)
    void closeOrbQuickActions()

  void Promise.resolve()
    .then(() => action.onClick())
    .catch(error => console.warn('[ButlerOrbTray] Failed to run quick action:', error))
}

async function closeOrbQuickActions() {
  if (!orbQuickActionsOpen.value && !orbQuickActionsNativeOpen.value)
    return

  const token = ++orbQuickActionsTransitionToken
  orbQuickActionsOpen.value = false

  if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, ORB_QUICK_ACTIONS_MOTION_DURATION_MS)
    })
  }

  if (token !== orbQuickActionsTransitionToken)
    return

  try {
    orbQuickActionsNativeClosePending.value = true
    await setOrbActionsOpen({ open: false })
    orbQuickActionsNativeClosePending.value = false
    if (token !== orbQuickActionsTransitionToken)
      return

    orbQuickActionsNativeOpen.value = false
    await nextTick()
    await applyButlerWindowShape(createCurrentOrbWindowShape(false))
  }
  catch (error) {
    orbQuickActionsNativeClosePending.value = false
    console.warn('[ButlerOrbTray] Failed to close Butler quick action bounds:', error)
  }
}

watch([mode, orbQuickActionsNativeOpen, butlerWindowEdge, normalizedButlerWindowScale], () => {
  scheduleButlerWindowShapeSync()
}, { flush: 'post' })

const todayTitle = computed(() => {
  if (overdueTasks.value.length > 0)
    return t('tamagotchi.stage.butler.overview.due-title')
  if (primaryTask.value)
    return primaryTask.value.title

  return t('tamagotchi.stage.butler.overview.idle-title')
})
const todayDescription = computed(() => {
  if (primaryTask.value)
    return `${formatTaskTime(primaryTask.value.dueAt)} - ${formatTaskMeta(primaryTask.value)}`

  return t('tamagotchi.stage.butler.overview.idle-description')
})
const previewLine = computed(() => {
  if (primaryTask.value) {
    return t('tamagotchi.stage.butler.overview.next-preview', {
      time: formatTaskTime(primaryTask.value.dueAt),
      title: primaryTask.value.title,
    })
  }

  return t('tamagotchi.stage.butler.overview.quiet-preview')
})
const taskSummaryLabel = computed(() => {
  if (overdueTasks.value.length > 0)
    return t('tamagotchi.stage.butler.overview.due-summary', { count: overdueTasks.value.length })
  if (openTasks.value.length > 0)
    return t('tamagotchi.stage.butler.overview.tasks-summary', { count: openTasks.value.length })

  return t('tamagotchi.stage.butler.overview.no-tasks-summary')
})
const toolGroups = computed(() => [
  {
    key: 'tasks',
    title: t('tamagotchi.stage.butler.tools.tasks'),
    actions: [
      { key: 'reminder', icon: TASK_KIND_ICONS.reminder, label: t('tamagotchi.stage.butler.actions.reminder'), onClick: () => openTaskComposer('reminder') },
      { key: 'alarm', icon: TASK_KIND_ICONS.alarm, label: t('tamagotchi.stage.butler.actions.alarm'), onClick: () => openTaskComposer('alarm') },
      { key: 'timer', icon: TASK_KIND_ICONS.timer, label: t('tamagotchi.stage.butler.actions.timer'), onClick: () => openTaskComposer('timer') },
      { key: 'task-list', icon: 'i-solar:checklist-minimalistic-outline', label: t('tamagotchi.stage.butler.actions.tasks'), onClick: () => selectTab('tasks') },
    ],
  },
  {
    key: 'notifications',
    title: t('tamagotchi.stage.butler.tools.notifications'),
    actions: [
      {
        key: 'mute',
        icon: taskNotificationsMuted.value ? 'i-solar:bell-bing-bold-duotone' : 'i-solar:bell-off-outline',
        label: taskNotificationsMuted.value ? t('tamagotchi.stage.butler.actions.unmute-reminders') : t('tamagotchi.stage.butler.actions.mute-reminders'),
        onClick: () => {
          taskNotificationsMuted.value = !taskNotificationsMuted.value
        },
      },
      {
        key: 'dnd',
        icon: taskDoNotDisturbEnabled.value ? 'i-solar:moon-sleep-bold-duotone' : 'i-solar:moon-sleep-outline',
        label: taskDoNotDisturbEnabled.value ? t('tamagotchi.stage.butler.actions.disable-do-not-disturb') : t('tamagotchi.stage.butler.actions.enable-do-not-disturb'),
        onClick: () => {
          taskDoNotDisturbEnabled.value = !taskDoNotDisturbEnabled.value
        },
      },
      { key: 'test-sound', icon: 'i-solar:music-note-2-outline', label: t('tamagotchi.stage.butler.settings.test-reminder-sound'), onClick: testReminderSound },
    ],
  },
  {
    key: 'communication',
    title: t('tamagotchi.stage.butler.tools.communication'),
    actions: [
      { key: 'chat', icon: 'i-solar:chat-line-line-duotone', label: t('tamagotchi.stage.butler.actions.chat'), onClick: handleOpenChat },
      { key: 'quick-chat', icon: 'i-solar:chat-round-dots-line-duotone', label: t('tamagotchi.stage.butler.actions.quick-chat'), onClick: handleOpenQuickChat },
      { key: 'turtle-soup', icon: 'i-solar:gamepad-minimalistic-outline', label: t('tamagotchi.stage.butler.actions.turtle-soup'), onClick: handleOpenTurtleSoup },
    ],
  },
  {
    key: 'desktop',
    title: t('tamagotchi.stage.butler.tools.desktop'),
    actions: [
      { key: 'settings', icon: 'i-solar:settings-minimalistic-outline', label: t('tamagotchi.stage.butler.actions.settings'), onClick: handleOpenSettings },
      { key: 'theme', icon: isDark.value ? 'i-solar:sun-2-outline' : 'i-solar:moon-outline', label: isDark.value ? t('tamagotchi.stage.butler.actions.light') : t('tamagotchi.stage.butler.actions.dark'), onClick: handleToggleTheme },
      {
        key: 'lock-position',
        icon: butlerPositionLocked.value ? 'i-solar:lock-keyhole-unlocked-outline' : 'i-solar:lock-keyhole-outline',
        label: butlerPositionLocked.value ? t('tamagotchi.stage.butler.actions.unlock-position') : t('tamagotchi.stage.butler.actions.lock-position'),
        onClick: () => {
          butlerPositionLocked.value = !butlerPositionLocked.value
        },
      },
      { key: 'hide', icon: 'i-solar:eye-closed-outline', label: t('tamagotchi.stage.butler.settings.hide-butler'), onClick: handleHideButler },
      ...(!workbenchEnabled
        ? [{ key: 'quit', icon: 'i-solar:power-bold-duotone', label: t('tamagotchi.stage.butler.settings.quit-airi'), onClick: requestQuitAiri, tone: 'danger' as const }]
        : []),
    ],
  },
  ...(workbenchEnabled
    ? [{
        key: 'advanced',
        title: t('tamagotchi.stage.butler.tools.advanced'),
        actions: [
          { key: 'workbench', icon: 'i-solar:programming-outline', label: t('tamagotchi.stage.butler.actions.workbench'), onClick: handleOpenWorkbench },
          { key: 'quit', icon: 'i-solar:power-bold-duotone', label: t('tamagotchi.stage.butler.settings.quit-airi'), onClick: requestQuitAiri },
        ],
      }]
    : []),
])
</script>

<template>
  <div
    v-if="mode === 'orb'"
    :class="[
      'butler-orb-root',
      'font-cute',
      `butler-orb-root--edge-${butlerWindowEdge}`,
      isDark ? 'butler-orb-root--dark' : 'butler-orb-root--light',
      orbQuickActionsOpen ? 'butler-orb-root--actions-open' : '',
      'relative h-[184px] w-[184px] overflow-visible',
      'select-none',
    ]"
    :style="butlerOrbRootStyle"
    @contextmenu.prevent="openDesktopControls"
    @keydown.esc.stop="closeOrbQuickActions"
  >
    <Transition name="butler-radial-aura">
      <div v-if="orbQuickActionsOpen" class="butler-radial-aura" aria-hidden="true" />
    </Transition>
    <Transition name="butler-radial-actions">
      <div
        v-if="orbQuickActionsOpen"
        class="butler-radial-actions"
        :aria-label="t('tamagotchi.stage.butler.actions.more')"
        role="menu"
      >
        <button
          v-for="(action, index) in quickActions"
          :key="action.key"
          type="button"
          :class="[
            'butler-radial-action [-webkit-app-region:no-drag]',
            `butler-radial-action--${action.key}`,
            action.tone ? `butler-radial-action--${action.tone}` : '',
          ]"
          :style="radialQuickActionStyles[index]"
          :aria-label="action.label"
          role="menuitem"
          :title="action.label"
          @click.stop="handleQuickActionClick(action)"
        >
          <span :class="[action.icon, 'size-5']" />
          <span class="butler-radial-action__label">{{ action.label }}</span>
        </button>
      </div>
    </Transition>
    <button
      type="button"
      :class="[
        'butler-orb-button',
        orbQuickActionsOpen ? 'butler-orb-button--actions-open' : '',
        orbCharging ? 'butler-orb-button--charging' : '',
        'grid place-items-center rounded-full',
        'border-0 bg-transparent',
        butlerPositionLocked ? 'cursor-default' : 'cursor-grab active:cursor-grabbing',
        '[-webkit-app-region:no-drag]',
      ]"
      :aria-expanded="orbQuickActionsOpen"
      aria-haspopup="menu"
      :title="t('tamagotchi.stage.butler.orb.open')"
      @click="handleOrbClick()"
      @pointercancel="finishOrbPointerDrag"
      @pointerdown="handleOrbPointerDown"
      @pointermove="handleOrbPointerMove"
      @pointerup="finishOrbPointerDrag"
    >
      <span :class="['butler-glass-orb butler-glass-orb--large', orbMoodClass]" aria-hidden="true">
        <span class="butler-glass-orb__lens">
          <img class="butler-glass-orb__image butler-glass-orb__image--base" :src="butlerPreviewImage" :style="largeOrbPreviewImageStyle" alt="">
          <canvas v-show="largeOrbCanvasReady" ref="largeOrbCanvas" class="butler-glass-orb__canvas" />
        </span>
      </span>
      <span
        v-if="openTasks.length > 0"
        :class="[
          'absolute bottom-1 min-w-4 rounded-full px-1',
          butlerWindowEdge === 'right' ? 'left-1' : 'right-1',
          'border border-[var(--airi-border-accent)] bg-[var(--butler-rose)] text-center text-[9px] text-[var(--airi-surface-page)] font-800 leading-4',
        ]"
      >
        {{ openTaskCountLabel }}
      </span>
    </button>
  </div>

  <div
    v-else
    :class="[
      'butler-tray-root',
      'font-cute',
      `butler-tray-root--${butlerTransitionPhase}`,
      `butler-tray-root--edge-${butlerWindowEdge}`,
      isDark ? 'butler-tray-root--dark' : 'butler-tray-root--light',
      'flex h-full w-full flex-col overflow-hidden text-[var(--butler-text)]',
    ]"
    :style="butlerTrayRootStyle"
  >
    <header
      :class="[
        'butler-bubble-header',
        butlerPositionLocked
          ? '[-webkit-app-region:no-drag]'
          : isWindowsPlatform ? '' : '[-webkit-app-region:drag]',
      ]"
      @contextmenu.prevent="openDesktopControls"
      @pointerdown.self="event => !butlerPositionLocked && handleMoveStart(event)"
    >
      <button
        type="button"
        :class="[
          'butler-bubble-header__orb',
          orbSettingsOpen ? 'butler-bubble-header__orb--active' : '',
          '[-webkit-app-region:no-drag]',
        ]"
        :aria-pressed="orbSettingsOpen"
        :title="t('tamagotchi.stage.butler.actions.orb-settings')"
        @click="toggleOrbSettings"
      >
        <span :class="['butler-glass-orb butler-glass-orb--small', orbMoodClass]" aria-hidden="true">
          <span class="butler-glass-orb__lens">
            <img class="butler-glass-orb__image butler-glass-orb__image--base" :src="butlerPreviewImage" :style="smallOrbPreviewImageStyle" alt="">
            <img class="butler-glass-orb__image butler-glass-orb__image--core" :src="butlerPreviewImage" :style="smallOrbPreviewImageStyle" alt="">
          </span>
        </span>
      </button>
      <div class="min-w-0 flex-1">
        <div class="truncate text-sm font-850">
          {{ t('tamagotchi.stage.butler.title') }}
        </div>
        <div class="truncate text-[11px] text-[var(--butler-muted)]">
          {{ trayStatusLabel }}
        </div>
      </div>
      <button
        type="button"
        :class="[
          'butler-icon-button',
          '[-webkit-app-region:no-drag]',
        ]"
        :title="t('tamagotchi.stage.butler.actions.settings')"
        @click="handleOpenSettings"
      >
        <span i-solar:settings-minimalistic-outline size-4 />
      </button>
      <button
        type="button"
        :class="[
          'butler-icon-button',
          '[-webkit-app-region:no-drag]',
        ]"
        :title="t('tamagotchi.stage.butler.actions.collapse')"
        @click="collapseTray"
      >
        <span i-solar:minimize-square-minimalistic-outline size-4 />
      </button>
    </header>

    <main class="butler-bubble-main">
      <section v-if="orbSettingsOpen" class="min-h-0 flex-1 overflow-y-auto pb-2 pr-1 scrollbar-none">
        <div class="flex flex-col gap-3">
          <div class="butler-settings-panel">
            <div class="flex items-center gap-3">
              <span class="butler-glass-orb butler-glass-orb--settings" aria-hidden="true">
                <span class="butler-glass-orb__lens">
                  <img class="butler-glass-orb__image butler-glass-orb__image--base" :src="butlerPreviewImage" :style="settingsOrbPreviewImageStyle" alt="">
                  <img class="butler-glass-orb__image butler-glass-orb__image--core" :src="butlerPreviewImage" :style="settingsOrbPreviewImageStyle" alt="">
                </span>
              </span>
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm text-[var(--butler-text)] font-800">
                  {{ t('tamagotchi.stage.butler.settings.orb-title') }}
                </div>
                <div class="mt-0.5 truncate text-[11px] text-[var(--butler-muted)]">
                  {{ orbCropModelName }}
                </div>
              </div>
            </div>

            <div class="mt-3 text-xs text-[var(--butler-muted)] leading-4">
              {{ t('tamagotchi.stage.butler.settings.orb-description') }}
            </div>
          </div>

          <div class="butler-settings-panel flex flex-col gap-3">
            <label class="butler-range-row">
              <span>{{ t('tamagotchi.stage.butler.settings.crop-x') }}</span>
              <input v-model.number="orbCropX" type="range" :min="ORB_CROP_LIMITS.x.min" :max="ORB_CROP_LIMITS.x.max" step="5">
              <strong>{{ Math.round(orbCropX) }}</strong>
            </label>
            <label class="butler-range-row">
              <span>{{ t('tamagotchi.stage.butler.settings.crop-y') }}</span>
              <input v-model.number="orbCropY" type="range" :min="ORB_CROP_LIMITS.y.min" :max="ORB_CROP_LIMITS.y.max" step="5">
              <strong>{{ Math.round(orbCropY) }}</strong>
            </label>
            <label class="butler-range-row">
              <span>{{ t('tamagotchi.stage.butler.settings.crop-scale') }}</span>
              <input v-model.number="orbCropScale" type="range" :min="ORB_CROP_LIMITS.scale.min" :max="ORB_CROP_LIMITS.scale.max" step="0.05">
              <strong>{{ Math.round(orbCropScale * 100) }}%</strong>
            </label>
            <label class="butler-toggle-row">
              <span>{{ t('tamagotchi.stage.butler.settings.lens') }}</span>
              <input v-model="orbLensEnabled" type="checkbox">
            </label>
          </div>

          <button class="butler-soft-button w-full" type="button" @click="resetCurrentOrbCropSettings()">
            {{ t('tamagotchi.stage.butler.settings.reset-orb') }}
          </button>
        </div>
      </section>

      <section v-else-if="activeTab === 'today'" class="min-h-0 flex-1 overflow-y-auto pb-2 pr-1 scrollbar-none">
        <div class="min-h-full flex flex-col gap-2.5">
          <article
            :class="[
              'butler-now-card',
              hasDueTask ? 'butler-now-card--due' : '',
            ]"
          >
            <div class="flex items-start gap-3">
              <div class="butler-now-card__mark">
                <span :class="[primaryTask ? taskKindIcon(primaryTask) : 'i-solar:stars-line-duotone', 'size-5']" />
              </div>
              <div class="min-w-0 flex-1">
                <div class="butler-now-card__title truncate text-sm font-800">
                  {{ todayTitle }}
                </div>
                <div class="butler-now-card__description mt-1 text-xs leading-4">
                  {{ todayDescription }}
                </div>
                <div
                  v-if="primaryTask && reminderDeliveryNoticeLabel(primaryTask)"
                  :class="['butler-reminder-notice mt-2', reminderDeliveryNoticeClass(primaryTask)]"
                >
                  <span class="i-solar:bell-off-outline size-3.5" />
                  <span>{{ reminderDeliveryNoticeLabel(primaryTask) }}</span>
                </div>
              </div>
            </div>

            <div
              :class="[
                '[-webkit-app-region:no-drag] mt-3 gap-2',
                primaryTask ? (isTimerTask(primaryTask) ? 'grid grid-cols-4' : 'grid grid-cols-5') : 'flex',
              ]"
            >
              <template v-if="primaryTask">
                <button class="butler-primary-button flex-1" type="button" :disabled="isTaskMutationPending(primaryTask.id)" @click="completeTask(primaryTask.id)">
                  {{ t('tamagotchi.stage.butler.tasks.done') }}
                </button>
                <template v-if="isTimerTask(primaryTask)">
                  <button class="butler-soft-button flex-1" type="button" :disabled="isTaskMutationPending(primaryTask.id)" @click="pauseOrResumeTimer(primaryTask)">
                    {{ t(isTimerPaused(primaryTask) ? 'tamagotchi.stage.butler.tasks.resume' : 'tamagotchi.stage.butler.tasks.pause') }}
                  </button>
                  <button class="butler-soft-button flex-1" type="button" :disabled="isTaskMutationPending(primaryTask.id)" @click="resetTimer(primaryTask.id)">
                    {{ t('tamagotchi.stage.butler.tasks.reset') }}
                  </button>
                </template>
                <template v-else>
                  <button
                    v-for="minutes in SNOOZE_MINUTES"
                    :key="minutes"
                    class="butler-soft-button flex-1"
                    type="button"
                    :disabled="isTaskMutationPending(primaryTask.id)"
                    @click="snoozeTask(primaryTask.id, minutes)"
                  >
                    {{ t('tamagotchi.stage.butler.tasks.snooze-minutes', { count: minutes }) }}
                  </button>
                </template>
                <button class="butler-soft-button flex-1" type="button" :disabled="isTaskMutationPending(primaryTask.id)" @click="cancelTask(primaryTask.id)">
                  {{ t('tamagotchi.stage.butler.tasks.cancel') }}
                </button>
              </template>
              <template v-else>
                <button class="butler-primary-button flex-1" type="button" @click="handleOpenChat()">
                  {{ t('tamagotchi.stage.butler.overview.talk') }}
                </button>
                <button class="butler-soft-button flex-1" type="button" @click="activeTab = 'tasks'">
                  {{ t('tamagotchi.stage.butler.overview.open-tasks') }}
                </button>
              </template>
            </div>
          </article>

          <section v-if="overdueTasks.length > 1" class="butler-agenda-card">
            <div class="mb-2 text-xs text-[var(--butler-text)] font-750">
              {{ taskSummaryLabel }}
            </div>
            <div class="max-h-44 flex flex-col gap-1.5 overflow-y-auto pr-1 scrollbar-none">
              <article v-for="task in overdueTasks.slice(1)" :key="task.id" class="butler-agenda-row">
                <span :class="[taskKindIcon(task), 'size-4 shrink-0 text-[var(--butler-accent-strong)]']" />
                <div class="min-w-0 flex-1">
                  <div class="truncate text-xs font-700">
                    {{ task.title }}
                  </div>
                  <div class="truncate text-[11px] text-[var(--butler-muted)]">
                    {{ formatTaskMeta(task) }}
                  </div>
                </div>
                <div class="[-webkit-app-region:no-drag] flex shrink-0 gap-1">
                  <button class="butler-soft-button px-2 text-[11px]" type="button" :disabled="isTaskMutationPending(task.id)" @click="completeTask(task.id)">
                    {{ t('tamagotchi.stage.butler.tasks.done') }}
                  </button>
                  <button v-if="!isTimerTask(task)" class="butler-soft-button px-2 text-[11px]" type="button" :disabled="isTaskMutationPending(task.id)" @click="snoozeTask(task.id)">
                    {{ t('tamagotchi.stage.butler.tasks.snooze-short-minutes', { count: 10 }) }}
                  </button>
                </div>
              </article>
            </div>
          </section>

          <section class="butler-agenda-card">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="text-[11px] text-[var(--butler-muted)] font-750 uppercase">
                  {{ t('tamagotchi.stage.butler.overview.schedule.now') }}
                </div>
                <div class="mt-0.5 text-2xl text-[var(--butler-text)] font-850 leading-none tabular-nums">
                  {{ currentClockLabel }}
                </div>
                <div class="mt-1 truncate text-[11px] text-[var(--butler-muted)]">
                  {{ currentDateLabel }}
                </div>
              </div>

              <div class="grid grid-cols-3 shrink-0 gap-1">
                <div v-for="stat in agendaStats" :key="stat.key" class="butler-agenda-stat">
                  <strong>{{ stat.count }}</strong>
                  <span>{{ stat.label }}</span>
                </div>
              </div>
            </div>

            <div class="butler-calendar-strip" role="listbox" :aria-label="currentDateLabel">
              <button
                v-for="day in calendarPreviewDays"
                :key="day.key"
                type="button"
                :class="[
                  'butler-calendar-day',
                  day.isToday ? 'butler-calendar-day--today' : '',
                  day.holiday ? 'butler-calendar-day--holiday' : '',
                  day.holiday?.tone === 'major' ? 'butler-calendar-day--major-holiday' : '',
                  selectedCalendarDay?.key === day.key ? 'butler-calendar-day--selected' : '',
                ]"
                :title="day.holiday ? holidayLabel(day.holiday.id) : `${day.month} ${day.day}`"
                role="option"
                :aria-selected="selectedCalendarDay?.key === day.key"
                @click="selectCalendarDay(day.key)"
              >
                <span class="butler-calendar-day__weekday">{{ day.weekday }}</span>
                <strong>{{ day.day }}</strong>
                <small>{{ day.holiday ? holidayLabel(day.holiday.id) : day.month }}</small>
                <div class="butler-calendar-day__dots" aria-hidden="true">
                  <span
                    v-for="kind in calendarDayTaskDots(day)"
                    :key="kind"
                    :class="[
                      'butler-calendar-day__dot',
                      `butler-calendar-day__dot--${kind}`,
                    ]"
                  />
                </div>
              </button>
            </div>

            <div v-if="selectedCalendarDay" class="butler-calendar-focus">
              <div class="min-w-0">
                <div class="butler-calendar-focus__title">
                  {{ selectedCalendarDay.weekday }} - {{ selectedCalendarDay.month }} {{ selectedCalendarDay.day }}
                </div>
                <div class="butler-calendar-focus__line">
                  {{ calendarDaySummary(selectedCalendarDay) }}
                </div>
              </div>
              <div class="butler-calendar-focus__badges">
                <span
                  v-if="selectedCalendarDay.holiday"
                  :class="[
                    'butler-calendar-focus__holiday',
                    selectedCalendarDay.holiday.tone === 'major' ? 'butler-calendar-focus__holiday--major' : '',
                  ]"
                >
                  {{ holidayLabel(selectedCalendarDay.holiday.id) }}
                </span>
                <span v-if="selectedCalendarDay.taskCount > 0" class="butler-calendar-focus__count">
                  {{ t('tamagotchi.stage.butler.overview.schedule.day-count', { count: selectedCalendarDay.taskCount }) }}
                </span>
              </div>
            </div>

            <div class="mt-2 flex flex-col gap-1.5">
              <div v-if="agendaPreviewTasks.length === 0" class="butler-agenda-empty">
                {{ t('tamagotchi.stage.butler.overview.schedule.empty') }}
              </div>
              <template v-else>
                <article v-for="task in agendaPreviewTasks" :key="task.id" class="butler-agenda-row">
                  <span :class="[taskKindIcon(task), 'size-4 shrink-0 text-[var(--butler-accent-strong)]']" />
                  <div class="min-w-0 flex-1">
                    <div class="truncate text-xs text-[var(--butler-text)] font-750">
                      {{ task.title }}
                    </div>
                    <div class="truncate text-[11px] text-[var(--butler-muted)]">
                      {{ formatTaskMeta(task) }}
                    </div>
                  </div>
                  <span class="butler-agenda-badge">{{ agendaBadgeLabel(task) }}</span>
                </article>
              </template>
            </div>
          </section>

          <div class="grid grid-cols-3 gap-1.5">
            <button
              v-for="action in todayQuickActions"
              :key="action.key"
              type="button"
              :class="[
                'butler-dock-button',
                action.tone ? `butler-dock-button--${action.tone}` : '',
                '[-webkit-app-region:no-drag]',
              ]"
              @click="action.onClick()"
            >
              <span :class="[action.icon, 'size-5']" />
              <span class="max-w-full truncate">{{ action.label }}</span>
            </button>
          </div>

          <div class="butler-preview-strip">
            <span i-solar:bell-bing-outline class="size-4 shrink-0" />
            <div class="min-w-0 flex-1 truncate">
              {{ previewLine }}
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="activeTab === 'tasks'" class="[-webkit-app-region:no-drag] min-h-0 flex flex-1 flex-col gap-2 overflow-y-auto pr-1 scrollbar-none">
        <div class="flex items-center justify-between gap-2">
          <div>
            <div class="text-sm font-800">
              {{ taskSummaryLabel }}
            </div>
            <div class="text-[11px] text-[var(--butler-muted)]">
              {{ t('tamagotchi.stage.butler.overview.task-page-hint') }}
            </div>
          </div>
        </div>

        <div class="[-webkit-app-region:no-drag] grid grid-cols-3 gap-1.5">
          <button
            v-for="composerMode in TASK_COMPOSER_MODES"
            :key="composerMode"
            type="button"
            :class="[
              'butler-segment-button',
              taskMode === composerMode
                ? 'butler-segment-button--active'
                : '',
            ]"
            @click="taskMode = composerMode"
          >
            <span :class="[TASK_KIND_ICONS[composerMode], 'mr-1 inline-block size-3.5 align-[-2px]']" />
            {{ t(`tamagotchi.stage.butler.tasks.modes.${composerMode}`) }}
          </button>
        </div>

        <form class="[-webkit-app-region:no-drag] flex gap-2" @submit.prevent="addTask">
          <input
            v-model="taskTitle"
            :class="[
              'butler-task-input min-w-0 flex-1',
            ]"
            :placeholder="taskPlaceholder"
          >
          <button class="butler-primary-button shrink-0" type="submit" :disabled="taskSubmitDisabled" :aria-busy="taskSubmitPending">
            <span v-if="taskSubmitPending" :class="['i-svg-spinners:90-ring-with-bg mr-1 inline-block size-3.5 align-[-2px]']" />
            {{ taskSubmitLabel }}
          </button>
          <button v-if="editingTaskId" class="butler-soft-button shrink-0" type="button" @click="cancelTaskEdit()">
            {{ t('tamagotchi.stage.butler.tasks.cancel-edit') }}
          </button>
        </form>
        <p v-if="taskMutationError" class="text-xs text-red-600 dark:text-red-300" role="alert">
          {{ taskMutationError }}
        </p>
        <input
          v-model="taskNote"
          :class="[
            'butler-task-input [-webkit-app-region:no-drag] text-xs',
          ]"
          :placeholder="t('tamagotchi.stage.butler.tasks.note-placeholder')"
        >
        <div v-if="taskMode === 'reminder'" class="[-webkit-app-region:no-drag] grid grid-cols-3 gap-1.5">
          <button
            v-for="preset in DUE_PRESETS"
            :key="preset"
            type="button"
            :class="[
              'butler-segment-button',
              duePreset === preset
                ? 'butler-segment-button--active'
                : '',
            ]"
            @click="selectDuePreset(preset)"
          >
            {{ t(`tamagotchi.stage.butler.tasks.presets.${preset}`) }}
          </button>
        </div>
        <div v-if="taskMode === 'reminder'" class="butler-date-time-grid [-webkit-app-region:no-drag]">
          <label class="butler-time-field min-w-0">
            <span i-lucide:calendar-days class="size-4 shrink-0 text-[var(--butler-muted)]" />
            <input
              v-model="customReminderDate"
              type="date"
              class="butler-time-input"
              :aria-label="t('tamagotchi.stage.butler.tasks.date')"
            >
          </label>
          <label class="butler-time-field min-w-0">
            <span i-solar:clock-circle-outline class="size-4 shrink-0 text-[var(--butler-muted)]" />
            <input
              v-model="customReminderTime"
              type="time"
              class="butler-time-input"
              :aria-label="t('tamagotchi.stage.butler.tasks.time')"
            >
          </label>
        </div>
        <div v-else-if="taskMode === 'alarm'" class="butler-date-time-grid [-webkit-app-region:no-drag]">
          <label class="butler-time-field min-w-0">
            <span i-lucide:calendar-days class="size-4 shrink-0 text-[var(--butler-muted)]" />
            <input
              v-model="alarmDate"
              type="date"
              class="butler-time-input"
              :aria-label="t('tamagotchi.stage.butler.tasks.date')"
            >
          </label>
          <label class="butler-time-field min-w-0">
            <span i-solar:clock-circle-outline class="size-4 shrink-0 text-[var(--butler-muted)]" />
            <input
              v-model="alarmTime"
              type="time"
              class="butler-time-input"
              :aria-label="t('tamagotchi.stage.butler.tasks.time')"
            >
          </label>
        </div>
        <div v-if="taskMode === 'alarm'" class="[-webkit-app-region:no-drag] flex flex-col gap-1.5">
          <div class="text-[11px] text-[var(--butler-muted)] font-650">
            {{ t('tamagotchi.stage.butler.tasks.repeat-days') }}
          </div>
          <div class="grid grid-cols-7 gap-1">
            <button
              v-for="day in ALARM_WEEKDAYS"
              :key="day"
              type="button"
              :class="[
                'butler-segment-button px-1.5',
                alarmWeekdays.includes(day)
                  ? 'butler-segment-button--active'
                  : '',
              ]"
              @click="toggleAlarmWeekday(day)"
            >
              {{ alarmWeekdayLabel(day) }}
            </button>
          </div>
        </div>
        <div v-else-if="taskMode === 'timer'" class="[-webkit-app-region:no-drag] flex flex-col gap-1.5">
          <div class="butler-duration-grid">
            <label class="butler-duration-field">
              <span>{{ t('tamagotchi.stage.butler.tasks.timer-hours') }}</span>
              <input
                v-model.number="timerHours"
                type="number"
                min="0"
                max="24"
                step="1"
                inputmode="numeric"
                @blur="normalizeTimerInputs()"
              >
            </label>
            <label class="butler-duration-field">
              <span>{{ t('tamagotchi.stage.butler.tasks.timer-minutes') }}</span>
              <input
                v-model.number="timerMinutes"
                type="number"
                min="0"
                max="59"
                step="1"
                inputmode="numeric"
                @blur="normalizeTimerInputs()"
              >
            </label>
            <label class="butler-duration-field">
              <span>{{ t('tamagotchi.stage.butler.tasks.timer-seconds') }}</span>
              <input
                v-model.number="timerSeconds"
                type="number"
                min="0"
                max="59"
                step="1"
                inputmode="numeric"
                @blur="normalizeTimerInputs()"
              >
            </label>
          </div>
          <div class="grid grid-cols-5 gap-1">
            <button
              v-for="minutes in TIMER_PRESETS"
              :key="minutes"
              class="butler-soft-button px-2"
              type="button"
              @click="setTimerDurationFromMinutes(minutes)"
            >
              {{ t('tamagotchi.stage.butler.tasks.timer-preset', { count: minutes }) }}
            </button>
          </div>
        </div>
        <div v-if="taskMode === 'reminder'" class="[-webkit-app-region:no-drag] grid grid-cols-3 gap-1.5">
          <button
            v-for="repeat in TASK_REPEAT_OPTIONS"
            :key="repeat"
            type="button"
            :class="[
              'butler-segment-button',
              taskRepeat === repeat
                ? 'butler-segment-button--active'
                : '',
            ]"
            @click="taskRepeat = repeat"
          >
            {{ t(`tamagotchi.stage.butler.tasks.repeat.${repeat}`) }}
          </button>
        </div>
        <div>
          <div v-if="openTasks.length === 0" class="butler-empty-state">
            <div class="px-6 text-xs text-[var(--butler-muted)]">
              {{ t('tamagotchi.stage.butler.empty.tasks') }}
            </div>
          </div>
          <div v-else class="flex flex-col gap-1.5">
            <article
              v-for="task in openTasks"
              :key="task.id"
              :data-butler-task-id="task.id"
              :class="[
                'butler-task-card',
              ]"
            >
              <div class="flex flex-col gap-2">
                <div class="min-w-0 flex items-start gap-2">
                  <span :class="[taskKindIcon(task), 'mt-0.5 size-4 shrink-0 text-[var(--butler-accent-strong)]']" />
                  <div class="min-w-0">
                    <div class="truncate text-sm font-650">
                      {{ task.title }}
                    </div>
                    <div class="text-[11px] text-[var(--butler-muted)]">
                      {{ formatTaskMeta(task) }}
                    </div>
                    <div
                      v-if="reminderDeliveryNoticeLabel(task)"
                      :class="['butler-reminder-notice mt-1', reminderDeliveryNoticeClass(task)]"
                    >
                      <span class="i-solar:bell-off-outline size-3.5" />
                      <span>{{ reminderDeliveryNoticeLabel(task) }}</span>
                    </div>
                    <div v-if="task.note" class="line-clamp-2 mt-0.5 text-[11px] text-[var(--butler-muted)]">
                      {{ task.note }}
                    </div>
                  </div>
                </div>
                <div :class="[isTimerTask(task) ? 'grid-cols-5' : 'grid-cols-6', 'grid gap-1']">
                  <button class="butler-soft-button px-2 text-[11px]" type="button" :disabled="isTaskMutationPending(task.id)" @click="editTask(task)">
                    {{ t('tamagotchi.stage.butler.tasks.edit') }}
                  </button>
                  <button class="butler-soft-button px-2 text-[11px]" type="button" :disabled="isTaskMutationPending(task.id)" @click="completeTask(task.id)">
                    {{ t('tamagotchi.stage.butler.tasks.done') }}
                  </button>
                  <template v-if="isTimerTask(task)">
                    <button class="butler-soft-button px-2 text-[11px]" type="button" :disabled="isTaskMutationPending(task.id)" @click="pauseOrResumeTimer(task)">
                      {{ t(isTimerPaused(task) ? 'tamagotchi.stage.butler.tasks.resume' : 'tamagotchi.stage.butler.tasks.pause') }}
                    </button>
                    <button class="butler-soft-button px-2 text-[11px]" type="button" :disabled="isTaskMutationPending(task.id)" @click="resetTimer(task.id)">
                      {{ t('tamagotchi.stage.butler.tasks.reset') }}
                    </button>
                  </template>
                  <template v-else>
                    <button
                      v-for="minutes in SNOOZE_MINUTES"
                      :key="minutes"
                      class="butler-soft-button px-2 text-[11px]"
                      type="button"
                      :disabled="isTaskMutationPending(task.id)"
                      @click="snoozeTask(task.id, minutes)"
                    >
                      {{ t('tamagotchi.stage.butler.tasks.snooze-short-minutes', { count: minutes }) }}
                    </button>
                  </template>
                  <button class="butler-soft-button px-2 text-[11px]" type="button" :disabled="isTaskMutationPending(task.id)" @click="cancelTask(task.id)">
                    {{ t('tamagotchi.stage.butler.tasks.cancel') }}
                  </button>
                </div>
              </div>
            </article>
          </div>
        </div>
      </section>

      <section v-else class="min-h-0 overflow-y-auto pr-1 scrollbar-none">
        <div class="flex flex-col gap-3">
          <section class="butler-settings-panel flex flex-col gap-2">
            <div class="flex items-start justify-between gap-3">
              <div class="min-w-0">
                <div class="flex items-center gap-2 text-sm text-[var(--butler-text)] font-800">
                  <span i-solar:bell-bing-outline class="size-4 shrink-0 text-[var(--butler-accent-strong)]" />
                  <span class="truncate">{{ t('tamagotchi.stage.butler.settings.notifications-title') }}</span>
                </div>
              </div>
              <span class="butler-status-pill">
                {{ notificationStatusLabel }}
              </span>
            </div>

            <label class="butler-toggle-row">
              <span>{{ t('tamagotchi.stage.butler.settings.mute-reminders') }}</span>
              <input v-model="taskNotificationsMuted" type="checkbox">
            </label>
            <label class="butler-toggle-row">
              <span>{{ t('tamagotchi.stage.butler.settings.reminder-sound') }}</span>
              <select v-model="normalizedTaskNotificationSound" class="butler-compact-select">
                <option v-for="sound in BUTLER_REMINDER_SOUNDS" :key="sound" :value="sound">
                  {{ t(`tamagotchi.stage.butler.settings.sound.${sound}`) }}
                </option>
              </select>
            </label>
            <label v-if="normalizedTaskNotificationSound !== 'off'" class="butler-range-row">
              <span>{{ t('tamagotchi.stage.butler.settings.reminder-sound-volume') }}</span>
              <input
                v-model.number="taskNotificationSoundVolume"
                type="range"
                min="0"
                max="1"
                step="0.05"
              >
              <span class="min-w-10 text-right text-[11px] text-[var(--butler-muted)]">{{ notificationSoundVolumeLabel }}</span>
            </label>
            <button
              v-if="normalizedTaskNotificationSound !== 'off'"
              class="butler-soft-button self-end px-3 text-[11px]"
              type="button"
              @click="testReminderSound"
            >
              {{ t('tamagotchi.stage.butler.settings.test-reminder-sound') }}
            </button>
            <label class="butler-toggle-row">
              <span>{{ t('tamagotchi.stage.butler.settings.do-not-disturb') }}</span>
              <input v-model="taskDoNotDisturbEnabled" type="checkbox">
            </label>
            <label class="butler-toggle-row">
              <span>{{ t('tamagotchi.stage.butler.settings.quiet-hours') }}</span>
              <input v-model="taskQuietHoursEnabled" type="checkbox">
            </label>

            <div v-if="taskQuietHoursEnabled" class="grid grid-cols-2 gap-1.5">
              <label class="butler-time-field">
                <span class="shrink-0 font-650">{{ t('tamagotchi.stage.butler.settings.quiet-start') }}</span>
                <input
                  v-model="taskQuietHoursStart"
                  type="time"
                  class="min-w-0 flex-1 bg-transparent text-sm text-[var(--butler-text)] outline-none"
                >
              </label>
              <label class="butler-time-field">
                <span class="shrink-0 font-650">{{ t('tamagotchi.stage.butler.settings.quiet-end') }}</span>
                <input
                  v-model="taskQuietHoursEnd"
                  type="time"
                  class="min-w-0 flex-1 bg-transparent text-sm text-[var(--butler-text)] outline-none"
                >
              </label>
            </div>
          </section>

          <section class="butler-settings-panel flex flex-col gap-2">
            <div class="flex items-center gap-2 text-sm text-[var(--butler-text)] font-800">
              <span i-solar:monitor-smartphone-outline class="size-4 shrink-0 text-[var(--butler-accent-strong)]" />
              <span class="truncate">{{ t('tamagotchi.stage.butler.settings.desktop-title') }}</span>
            </div>

            <label class="butler-toggle-row">
              <span>{{ t('tamagotchi.stage.butler.settings.always-on-top') }}</span>
              <input v-model="butlerAlwaysOnTop" type="checkbox">
            </label>
            <label class="butler-toggle-row">
              <span>{{ t('tamagotchi.stage.butler.settings.visible-all-workspaces') }}</span>
              <input v-model="butlerVisibleOnAllWorkspaces" type="checkbox">
            </label>
            <label class="butler-toggle-row">
              <span>{{ t('tamagotchi.stage.butler.settings.lock-position') }}</span>
              <input v-model="butlerPositionLocked" type="checkbox">
            </label>
            <label class="butler-range-row">
              <span>{{ t('tamagotchi.stage.butler.settings.opacity') }}</span>
              <input
                v-model.number="butlerOpacity"
                type="range"
                :min="BUTLER_OPACITY_LIMITS.min"
                :max="BUTLER_OPACITY_LIMITS.max"
                step="0.05"
              >
              <strong>{{ Math.round(normalizedButlerOpacity * 100) }}%</strong>
            </label>
            <label class="butler-range-row">
              <span>{{ t('tamagotchi.stage.butler.settings.window-size') }}</span>
              <input
                v-model.number="butlerWindowScale"
                type="range"
                :min="BUTLER_WINDOW_SCALE_LIMITS.min"
                :max="BUTLER_WINDOW_SCALE_LIMITS.max"
                step="0.05"
              >
              <strong>{{ Math.round(normalizedButlerWindowScale * 100) }}%</strong>
            </label>

            <div class="grid grid-cols-3 gap-1.5">
              <button class="butler-soft-button" type="button" @click="collapseTray()">
                {{ t('tamagotchi.stage.butler.actions.collapse') }}
              </button>
              <button class="butler-soft-button" type="button" @click="handleHideButler()">
                {{ t('tamagotchi.stage.butler.settings.hide-butler') }}
              </button>
              <button class="butler-soft-button butler-soft-button--danger" type="button" @click="requestQuitAiri()">
                {{ t('tamagotchi.stage.butler.settings.quit-airi') }}
              </button>
            </div>
          </section>

          <section class="butler-settings-panel flex flex-col gap-2">
            <div class="flex items-center gap-2 text-sm text-[var(--butler-text)] font-800">
              <span i-lucide:mouse-pointer-2 class="size-4 shrink-0 text-[var(--butler-accent-strong)]" />
              <span class="truncate">{{ t('tamagotchi.stage.butler.settings.mouse-interaction-title') }}</span>
            </div>
            <p class="text-xs text-[var(--butler-subtle)] leading-4">
              {{ t('tamagotchi.stage.butler.settings.mouse-interaction-description') }}
            </p>
            <MouseInteractionModePicker />
          </section>

          <section v-for="group in toolGroups" :key="group.key" class="flex flex-col gap-1.5">
            <div class="px-1 text-[11px] text-[var(--butler-subtle)] font-750">
              {{ group.title }}
            </div>
            <button
              v-for="action in group.actions"
              :key="action.key"
              :class="[
                'butler-tool-row',
                action.key === 'quit' ? 'butler-tool-row--danger' : '',
              ]"
              type="button"
              @click="action.onClick()"
            >
              <span :class="[action.icon, 'size-5']" />
              <span class="min-w-0 flex-1 truncate text-left">{{ action.label }}</span>
              <span i-solar:alt-arrow-right-linear class="size-4 text-[var(--butler-subtle)]" />
            </button>
          </section>
        </div>
      </section>
    </main>

    <nav class="butler-bottom-dock [-webkit-app-region:no-drag]" :aria-label="t('tamagotchi.stage.butler.title')">
      <button
        v-for="tab in BUTLER_TABS"
        :key="tab"
        type="button"
        :class="[
          'butler-bottom-dock__button',
          activeTab === tab && !orbSettingsOpen ? 'butler-bottom-dock__button--active' : '',
        ]"
        @click="selectTab(tab)"
      >
        <span :class="[BUTLER_TAB_ICONS[tab], 'size-4']" />
        <span>{{ t(`tamagotchi.stage.butler.tabs.${tab}`) }}</span>
      </button>
    </nav>
  </div>

  <AlertDialogRoot v-model:open="quitConfirmationOpen">
    <AlertDialogPortal>
      <AlertDialogOverlay :class="['fixed inset-0 z-100 bg-black/40 backdrop-blur-sm']" />
      <AlertDialogContent
        :class="[
          'fixed left-1/2 top-1/2 z-101 w-[min(22rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
          'rounded-lg border border-[var(--airi-border-subtle)] bg-[var(--airi-surface-panel)] p-5 shadow-2xl outline-none',
        ]"
      >
        <AlertDialogTitle :class="['text-base text-[var(--airi-text)] font-semibold']">
          {{ t('tamagotchi.stage.butler.settings.quit-confirm-title') }}
        </AlertDialogTitle>
        <AlertDialogDescription :class="['mt-2 text-sm text-[var(--airi-text-muted)] leading-6']">
          {{ t('tamagotchi.stage.butler.settings.quit-confirm-description') }}
        </AlertDialogDescription>
        <div :class="['mt-5 flex justify-end gap-2']">
          <AlertDialogCancel :class="['h-9 rounded-md px-3 text-sm font-medium airi-overlay-control-muted']">
            {{ t('tamagotchi.stage.butler.settings.quit-confirm-cancel') }}
          </AlertDialogCancel>
          <AlertDialogAction
            :class="['h-9 rounded-md px-3 text-sm font-medium airi-overlay-control-primary']"
            @click.capture="handleQuitAiri"
          >
            {{ t('tamagotchi.stage.butler.settings.quit-confirm-action') }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<style scoped>
:global(html),
:global(body),
:global(#app) {
  width: 100%;
  height: 100%;
  overflow: hidden;
}

.butler-orb-root,
.butler-tray-root {
  will-change: opacity, transform;
}

.butler-orb-root {
  --butler-orb-anchor-x: 50%;
  --butler-orb-anchor-y: 50%;
  --butler-orb-button-scale: 1;
  --butler-orb-ring-border: color-mix(in srgb, var(--airi-border-accent) 38%, transparent);
  --butler-orb-ring-bg:
    radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--airi-surface-glass) 42%, transparent), transparent 47%),
    radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--airi-accent-surface) 42%, transparent), transparent 63%);
  --butler-orb-ring-shadow: none;
  --butler-rose: rgb(214, 88, 103);
  --butler-rose-soft: rgba(214, 88, 103, 0.12);
  --butler-amber: rgb(194, 124, 36);
  --butler-amber-soft: rgba(245, 158, 11, 0.16);

  position: fixed;
  inset: 0;
  margin: auto;
  animation: butler-orb-enter 150ms cubic-bezier(.2, .8, .2, 1) both;
}

.butler-orb-root--dark {
  --butler-orb-ring-border: color-mix(in srgb, var(--airi-border-accent) 44%, transparent);
  --butler-orb-ring-bg:
    radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--airi-surface-overlay) 74%, transparent), color-mix(in srgb, var(--airi-surface-overlay) 36%, transparent) 37%, transparent 60%),
    radial-gradient(circle at 50% 50%, color-mix(in srgb, var(--airi-accent-surface) 40%, transparent), transparent 66%);
  --butler-orb-ring-shadow:
    inset 0 0 24px rgba(2, 6, 23, 0.46),
    0 14px 30px rgba(0, 0, 0, 0.24);
  --butler-rose: rgb(251, 113, 133);
  --butler-rose-soft: rgba(251, 113, 133, 0.13);
  --butler-amber: rgb(252, 211, 77);
  --butler-amber-soft: rgba(252, 211, 77, 0.12);
}

.butler-orb-root--edge-left,
.butler-tray-root--edge-left {
  transform-origin: left center;
}

.butler-orb-root--edge-right,
.butler-tray-root--edge-right {
  transform-origin: right center;
}

.butler-orb-root--edge-top,
.butler-tray-root--edge-top {
  transform-origin: center top;
}

.butler-orb-root--edge-bottom,
.butler-tray-root--edge-bottom {
  transform-origin: center bottom;
}

.butler-orb-button,
.butler-radial-actions {
  position: absolute;
  z-index: 2;
  left: var(--butler-orb-anchor-x);
  top: var(--butler-orb-anchor-y);
  width: 72px;
  height: 72px;
  transform: translate(-50%, -50%) scale(var(--butler-orb-button-scale));
  transform-origin: center;
}

.butler-orb-button {
  padding: 7px;
  transition:
    left 150ms cubic-bezier(.16, 1, .3, 1),
    top 150ms cubic-bezier(.16, 1, .3, 1),
    transform 150ms cubic-bezier(.16, 1, .3, 1);
}

.butler-orb-button:hover {
  --butler-orb-button-scale: 1.04;
}

.butler-orb-button:active {
  --butler-orb-button-scale: 0.93;
}

.butler-orb-button--actions-open {
  --butler-orb-button-scale: 1.06;
}

.butler-orb-button--charging {
  animation: butler-orb-charge 360ms cubic-bezier(.16, 1, .3, 1) both;
}

.butler-radial-actions {
  z-index: 4;
  pointer-events: none;
  transition:
    left 150ms cubic-bezier(.16, 1, .3, 1),
    top 150ms cubic-bezier(.16, 1, .3, 1);
}

.butler-radial-aura {
  position: absolute;
  inset: 22px;
  z-index: 1;
  border: 1px solid var(--butler-orb-ring-border);
  border-radius: 999px;
  animation: butler-radial-aura-enter 160ms cubic-bezier(.16, 1, .3, 1) both;
  background: var(--butler-orb-ring-bg);
  box-shadow: var(--butler-orb-ring-shadow);
  mask: radial-gradient(circle, transparent 29%, black 30%, black 61%, transparent 62%);
  -webkit-mask: radial-gradient(circle, transparent 29%, black 30%, black 61%, transparent 62%);
  opacity: 0.62;
  pointer-events: none;
}

.butler-radial-aura-leave-active {
  transition:
    opacity 120ms ease-out,
    transform 150ms cubic-bezier(.16, 1, .3, 1);
}

.butler-radial-aura-leave-to {
  opacity: 0;
  transform: scale(0.82) rotate(8deg);
}

.butler-radial-actions-leave-active .butler-radial-action {
  animation: none;
  pointer-events: none;
  transition:
    opacity 110ms ease-out,
    transform 150ms cubic-bezier(.16, 1, .3, 1);
}

.butler-radial-actions-leave-to .butler-radial-action {
  opacity: 0;
  transform: translate(calc(-50% + var(--butler-radial-action-x, 0px)), calc(-50% + var(--butler-radial-action-y, 0px))) scale(0.76);
}

.butler-radial-action {
  --butler-radial-action-size: 50px;
  --butler-radial-action-accent: var(--airi-accent-strong);
  --butler-radial-action-text: var(--airi-text-muted);
  --butler-radial-action-hover-text: color-mix(in srgb, var(--butler-radial-action-accent) 72%, var(--airi-text));
  --butler-radial-action-border: var(--airi-border-subtle);
  --butler-radial-action-hover-border: color-mix(in srgb, var(--butler-radial-action-accent) 34%, var(--airi-border-subtle));
  --butler-radial-action-glow: rgba(35, 45, 58, 0.1);
  --butler-radial-action-hover-glow: color-mix(in srgb, var(--butler-radial-action-accent) 22%, transparent);
  --butler-radial-action-tint: color-mix(in srgb, var(--airi-surface-control-muted) 96%, transparent);
  --butler-radial-action-hover-tint: color-mix(in srgb, var(--butler-radial-action-accent) 8%, var(--airi-surface-control-hover));

  position: absolute;
  left: 50%;
  top: 50%;
  width: var(--butler-radial-action-size);
  height: var(--butler-radial-action-size);
  display: grid;
  place-items: center;
  border: 1px solid var(--butler-radial-action-border);
  border-radius: 999px;
  animation: butler-radial-action-enter 150ms cubic-bezier(.16, 1, .3, 1) both;
  animation-delay: var(--butler-radial-action-delay, 0ms);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--airi-surface-panel) 88%, transparent), var(--butler-radial-action-tint));
  box-shadow:
    0 8px 18px var(--butler-radial-action-glow),
    inset 0 1px 0 rgba(255, 255, 255, 0.66);
  color: var(--butler-radial-action-text);
  pointer-events: auto;
  transform: translate(calc(-50% + var(--butler-radial-action-x, 0px)), calc(-50% + var(--butler-radial-action-y, 0px))) scale(0.72);
  transition:
    background 160ms ease,
    border-color 160ms ease,
    box-shadow 160ms ease,
    color 160ms ease,
    transform 160ms cubic-bezier(.2, .8, .2, 1);
}

.butler-radial-action:hover,
.butler-radial-action:focus-visible {
  border-color: var(--butler-radial-action-hover-border);
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--airi-surface-panel) 92%, transparent), var(--butler-radial-action-hover-tint));
  box-shadow:
    0 10px 24px var(--butler-radial-action-hover-glow),
    0 3px 10px rgba(20, 34, 40, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.74);
  color: var(--butler-radial-action-hover-text);
  transform: translate(calc(-50% + var(--butler-radial-action-x, 0px)), calc(-50% + var(--butler-radial-action-y, 0px))) scale(1.04);
}

.butler-radial-action--alarm {
  --butler-radial-action-accent: var(--butler-amber);
}

.butler-radial-action--reminder,
.butler-radial-action--settings {
  --butler-radial-action-accent: var(--airi-accent-strong);
}

.butler-radial-action--timer,
.butler-radial-action--theme {
  --butler-radial-action-accent: var(--airi-accent-strong);
}

.butler-radial-action--tools {
  --butler-radial-action-accent: var(--airi-accent-strong);
}

.butler-radial-action--primary {
  --butler-radial-action-size: 52px;
  --butler-radial-action-accent: var(--airi-accent-strong);
  --butler-radial-action-hover-glow: color-mix(in srgb, var(--butler-radial-action-accent) 20%, transparent);
  --butler-radial-action-tint: color-mix(in srgb, var(--butler-radial-action-accent) 6%, var(--airi-surface-control-muted));
  --butler-radial-action-hover-tint: color-mix(in srgb, var(--butler-radial-action-accent) 9%, var(--airi-surface-control-hover));
  --butler-radial-action-text: color-mix(in srgb, var(--butler-radial-action-accent) 24%, var(--airi-text-muted));
  --butler-radial-action-hover-text: color-mix(in srgb, var(--butler-radial-action-accent) 46%, var(--airi-text));
  --butler-radial-action-hover-border: color-mix(in srgb, var(--butler-radial-action-accent) 32%, var(--airi-border-subtle));
}

.butler-radial-action--danger {
  --butler-radial-action-size: 50px;
  --butler-radial-action-accent: var(--butler-rose);
  --butler-radial-action-border: color-mix(in srgb, var(--butler-radial-action-accent) 32%, var(--airi-border-subtle));
  --butler-radial-action-hover-border: color-mix(in srgb, var(--butler-radial-action-accent) 44%, var(--airi-border-subtle));
  --butler-radial-action-hover-text: color-mix(in srgb, var(--butler-radial-action-accent) 92%, var(--airi-text));
  --butler-radial-action-hover-tint: color-mix(in srgb, var(--butler-radial-action-accent) 17%, var(--airi-surface-panel));
  --butler-radial-action-text: color-mix(in srgb, var(--butler-radial-action-accent) 82%, var(--airi-text));
  --butler-radial-action-tint: color-mix(in srgb, var(--butler-radial-action-accent) 11%, var(--airi-surface-card));
}

.butler-orb-root--dark .butler-radial-action {
  --butler-radial-action-border: var(--airi-border-subtle);
  --butler-radial-action-glow: rgba(0, 0, 0, 0.16);
  --butler-radial-action-hover-glow: color-mix(in srgb, var(--butler-radial-action-accent) 24%, rgba(0, 0, 0, 0.08));
  --butler-radial-action-text: var(--airi-text-muted);
  --butler-radial-action-hover-text: color-mix(in srgb, var(--butler-radial-action-accent) 62%, var(--airi-text));
  --butler-radial-action-hover-border: color-mix(in srgb, var(--butler-radial-action-accent) 30%, var(--airi-border-subtle));
  --butler-radial-action-tint: color-mix(in srgb, var(--airi-surface-control-muted) 94%, transparent);
  --butler-radial-action-hover-tint: color-mix(in srgb, var(--butler-radial-action-accent) 10%, var(--airi-surface-control-hover));

  background:
    linear-gradient(180deg, color-mix(in srgb, var(--airi-surface-glass) 92%, transparent), var(--butler-radial-action-tint));
  box-shadow:
    0 9px 22px var(--butler-radial-action-glow),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
}

.butler-orb-root--dark .butler-radial-action:hover,
.butler-orb-root--dark .butler-radial-action:focus-visible {
  background:
    linear-gradient(180deg, color-mix(in srgb, var(--airi-surface-control-hover) 94%, transparent), var(--butler-radial-action-hover-tint));
  box-shadow:
    0 12px 26px var(--butler-radial-action-hover-glow),
    inset 0 1px 0 rgba(255, 255, 255, 0.11);
}

.butler-orb-root--dark .butler-radial-action--primary {
  --butler-radial-action-accent: var(--airi-accent-strong);
  --butler-radial-action-hover-glow: color-mix(in srgb, var(--butler-radial-action-accent) 20%, rgba(0, 0, 0, 0.08));
  --butler-radial-action-tint: color-mix(in srgb, var(--butler-radial-action-accent) 8%, var(--airi-surface-control-muted));
  --butler-radial-action-hover-tint: color-mix(in srgb, var(--butler-radial-action-accent) 12%, var(--airi-surface-control-hover));
  --butler-radial-action-text: color-mix(in srgb, var(--butler-radial-action-accent) 28%, var(--airi-text-muted));
  --butler-radial-action-hover-text: color-mix(in srgb, var(--butler-radial-action-accent) 46%, var(--airi-text));
  --butler-radial-action-hover-border: color-mix(in srgb, var(--butler-radial-action-accent) 34%, var(--airi-border-subtle));
}

.butler-orb-root--dark .butler-radial-action--danger {
  --butler-radial-action-border: color-mix(in srgb, var(--butler-rose) 28%, var(--airi-border-subtle));
  --butler-radial-action-hover-border: color-mix(in srgb, var(--butler-rose) 40%, var(--airi-border-subtle));
  --butler-radial-action-hover-text: color-mix(in srgb, var(--butler-rose) 82%, var(--airi-text));
  --butler-radial-action-hover-tint: color-mix(in srgb, var(--butler-rose) 13%, var(--airi-surface-control-hover));
  --butler-radial-action-text: color-mix(in srgb, var(--butler-rose) 74%, var(--airi-text));
  --butler-radial-action-tint: color-mix(in srgb, var(--butler-rose) 9%, var(--airi-surface-control-muted));
}

.butler-radial-action::after {
  position: absolute;
  top: var(--butler-radial-label-top, auto);
  bottom: var(--butler-radial-label-bottom, -21px);
  left: 50%;
  max-width: 78px;
  overflow: hidden;
  border: 1px solid var(--butler-radial-action-border);
  border-radius: 999px;
  background: color-mix(in srgb, var(--airi-surface-panel) 94%, transparent);
  box-shadow: 0 6px 14px rgba(20, 34, 40, 0.08);
  color: var(--butler-radial-action-text);
  content: attr(aria-label);
  font-size: 9px;
  font-weight: 800;
  line-height: 1;
  opacity: 0;
  padding: 4px 7px;
  pointer-events: none;
  text-overflow: ellipsis;
  transform: translateX(-50%) translateY(-2px) scale(0.94);
  transition:
    opacity 130ms ease,
    transform 130ms ease;
  white-space: nowrap;
}

.butler-orb-root--dark .butler-radial-action::after {
  border-color: var(--butler-radial-action-border);
  background: color-mix(in srgb, var(--airi-surface-panel) 96%, transparent);
  box-shadow: 0 8px 18px rgba(0, 0, 0, 0.24);
  color: var(--butler-radial-action-text);
}

.butler-radial-action:hover::after,
.butler-radial-action:focus-visible::after {
  opacity: 1;
  transform: translateX(-50%) translateY(0) scale(1);
}

.butler-radial-action:active {
  transform: translate(calc(-50% + var(--butler-radial-action-x, 0px)), calc(-50% + var(--butler-radial-action-y, 0px))) scale(0.96);
}

.butler-radial-action__label {
  position: absolute;
  width: 1px;
  height: 1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  clip-path: inset(50%);
  white-space: nowrap;
}

.butler-tray-root,
.butler-tray-root--light {
  --butler-surface: color-mix(in srgb, var(--airi-surface-panel) 90%, transparent);
  --butler-surface-strong: color-mix(in srgb, var(--airi-surface-panel) 88%, white);
  --butler-surface-soft: color-mix(in srgb, var(--airi-surface-control-muted) 86%, transparent);
  --butler-surface-panel: color-mix(in srgb, var(--airi-surface-card) var(--butler-surface-strength, 68%), transparent);
  --butler-surface-hover: var(--airi-surface-control-hover);
  --butler-surface-focus: var(--airi-surface-field-focus);
  --butler-border: var(--airi-border-subtle);
  --butler-border-strong: var(--airi-border-accent);
  --butler-text: var(--airi-text);
  --butler-muted: var(--airi-text-muted);
  --butler-subtle: var(--airi-text-soft);
  --butler-accent: var(--airi-accent-strong);
  --butler-accent-strong: var(--airi-accent-text);
  --butler-accent-soft: var(--airi-accent-surface);
  --butler-accent-fill-text: white;
  --butler-focus-ring: var(--airi-accent-focus);
  --butler-rose: rgb(214, 88, 103);
  --butler-rose-soft: rgba(214, 88, 103, 0.12);
  --butler-amber: rgb(194, 124, 36);
  --butler-amber-soft: rgba(245, 158, 11, 0.16);
  --butler-tray-border: var(--airi-border-subtle);
  --butler-tray-bg:
    linear-gradient(160deg, color-mix(in srgb, var(--airi-surface-glass) 94%, white 6%), color-mix(in srgb, var(--airi-surface-panel) 94%, var(--airi-accent-soft) 6%) 42%, color-mix(in srgb, var(--airi-surface-card) 94%, var(--airi-accent-surface) 6%)),
    var(--butler-surface);
  --butler-tray-shadow:
    0 14px 32px rgba(35, 45, 58, 0.08),
    inset 0 1px 0 rgba(255, 255, 255, 0.62);
  --butler-tray-wash:
    linear-gradient(90deg, color-mix(in srgb, var(--airi-accent-surface) 18%, transparent), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--airi-accent-soft) 12%, transparent), transparent 26%);
  --butler-edge-tab-bg:
    radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--airi-surface-panel) 82%, transparent), transparent 42%),
    linear-gradient(135deg, color-mix(in srgb, var(--butler-accent-soft) 48%, var(--airi-surface-control-muted)), color-mix(in srgb, var(--airi-accent-muted) 12%, transparent));
  --butler-edge-tab-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.34);
  --butler-header-bg: linear-gradient(180deg, var(--butler-surface-strong), color-mix(in srgb, var(--airi-surface-glass) 58%, transparent));
  --butler-dock-bg: color-mix(in srgb, var(--airi-surface-overlay) 66%, transparent);
  --butler-control-switch-bg: color-mix(in srgb, var(--airi-text-soft) 14%, transparent);
  --butler-control-knob-bg: var(--airi-surface-panel);
}

.butler-tray-root--dark {
  --butler-surface: color-mix(in srgb, var(--airi-surface-panel) 92%, transparent);
  --butler-surface-strong: color-mix(in srgb, var(--airi-surface-card) 86%, transparent);
  --butler-surface-soft: color-mix(in srgb, var(--airi-surface-control-muted) 88%, transparent);
  --butler-surface-panel: color-mix(in srgb, var(--airi-surface-card) 82%, transparent);
  --butler-surface-hover: var(--airi-surface-control-hover);
  --butler-surface-focus: var(--airi-surface-field-focus);
  --butler-border: var(--airi-border-subtle);
  --butler-border-strong: var(--airi-border-accent);
  --butler-text: var(--airi-text);
  --butler-muted: var(--airi-text-muted);
  --butler-subtle: var(--airi-text-soft);
  --butler-accent: var(--airi-accent-strong);
  --butler-accent-strong: var(--airi-accent-text);
  --butler-accent-soft: var(--airi-accent-surface);
  --butler-accent-fill-text: var(--airi-surface-page);
  --butler-focus-ring: var(--airi-accent-focus);
  --butler-rose: rgb(251, 113, 133);
  --butler-rose-soft: rgba(251, 113, 133, 0.13);
  --butler-amber: rgb(252, 211, 77);
  --butler-amber-soft: rgba(252, 211, 77, 0.12);
  --butler-tray-border: var(--airi-border-subtle);
  --butler-tray-bg:
    linear-gradient(160deg, color-mix(in srgb, var(--airi-surface-glass) 94%, white 3%), color-mix(in srgb, var(--airi-surface-panel) 94%, var(--airi-accent-surface) 6%) 46%, color-mix(in srgb, var(--airi-surface-page) 82%, var(--airi-surface-panel) 18%)),
    var(--butler-surface);
  --butler-tray-shadow:
    0 16px 34px rgba(0, 0, 0, 0.3),
    inset 0 1px 0 rgba(255, 255, 255, 0.07);
  --butler-tray-wash:
    linear-gradient(90deg, color-mix(in srgb, var(--airi-accent-surface) 16%, transparent), transparent 34%),
    linear-gradient(180deg, color-mix(in srgb, var(--airi-accent-soft) 10%, transparent), transparent 28%);
  --butler-edge-tab-bg:
    radial-gradient(circle at 50% 45%, color-mix(in srgb, var(--airi-text-soft) 10%, transparent), transparent 44%),
    linear-gradient(135deg, color-mix(in srgb, var(--butler-accent-soft) 48%, var(--airi-surface-control-muted)), color-mix(in srgb, var(--airi-accent-muted) 10%, transparent));
  --butler-edge-tab-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.08);
  --butler-header-bg: linear-gradient(180deg, color-mix(in srgb, var(--airi-surface-panel) 88%, transparent), color-mix(in srgb, var(--airi-surface-overlay) 70%, transparent));
  --butler-dock-bg: color-mix(in srgb, var(--airi-surface-overlay) 72%, transparent);
  --butler-control-switch-bg: color-mix(in srgb, var(--airi-text-soft) 13%, transparent);
  --butler-control-knob-bg: var(--airi-text-muted);
}

.butler-tray-root {
  position: relative;
  border: 1px solid var(--butler-tray-border);
  border-radius: 24px;
  background: var(--butler-tray-bg);
  box-shadow: var(--butler-tray-shadow);
  color: var(--butler-text);
}

.butler-tray-root::before {
  position: absolute;
  inset: 0;
  border-radius: inherit;
  background: var(--butler-tray-wash);
  content: "";
  pointer-events: none;
}

.butler-tray-root::after {
  position: absolute;
  z-index: 0;
  width: 52px;
  height: 26px;
  border: 1px solid var(--butler-border);
  border-radius: 999px;
  background: var(--butler-edge-tab-bg);
  box-shadow: var(--butler-edge-tab-shadow);
  content: "";
  pointer-events: none;
}

.butler-tray-root--edge-left::after {
  left: -18px;
  top: 78px;
  transform: rotate(90deg);
}

.butler-tray-root--edge-right::after {
  right: -18px;
  top: 78px;
  transform: rotate(90deg);
}

.butler-tray-root--edge-top::after {
  left: 72px;
  top: -12px;
}

.butler-tray-root--edge-bottom::after {
  bottom: -12px;
  left: 72px;
}

.butler-tray-root--opening {
  animation: butler-tray-enter 190ms cubic-bezier(.2, .8, .2, 1) both;
}

.butler-tray-root--closing {
  animation: butler-tray-leave 130ms cubic-bezier(.4, 0, .2, 1) both;
  pointer-events: none;
}

.butler-bubble-header,
.butler-bubble-main,
.butler-bottom-dock {
  position: relative;
  z-index: 1;
}

.butler-bubble-header {
  min-height: 68px;
  display: flex;
  align-items: center;
  gap: 12px;
  flex: 0 0 auto;
  border-bottom: 1px solid var(--butler-border);
  background: var(--butler-header-bg);
  padding: 11px 12px 10px;
}

.butler-bubble-header__orb {
  position: relative;
  width: 50px;
  height: 50px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border: 0;
  border-radius: 999px;
  background: var(--butler-accent-soft);
  color: inherit;
  cursor: pointer;
  padding: 0;
  transition:
    background 150ms ease,
    transform 150ms ease;
}

.butler-bubble-header__orb::after {
  position: absolute;
  inset: 4px;
  border: 1px solid rgba(255, 255, 255, 0.5);
  border-radius: inherit;
  content: "";
  pointer-events: none;
}

.butler-bubble-header__orb:hover,
.butler-bubble-header__orb--active {
  background: var(--butler-surface-soft);
}

.butler-bubble-header__orb:active {
  transform: scale(0.96);
}

.butler-icon-button {
  width: 32px;
  height: 32px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border: 1px solid transparent;
  border-radius: 999px;
  color: var(--butler-muted);
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease,
    transform 150ms ease;
}

.butler-icon-button:hover,
.butler-icon-button--active {
  border-color: var(--butler-border);
  background: var(--butler-surface-soft);
  color: var(--butler-accent-strong);
}

.butler-icon-button:active {
  transform: scale(0.94);
}

.butler-bubble-main {
  min-height: 0;
  display: flex;
  flex: 1 1 auto;
  flex-direction: column;
  overflow: hidden;
  padding: 10px 12px 8px;
}

.butler-bottom-dock {
  min-height: 52px;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 4px;
  margin: 0 12px 12px;
  border: 1px solid var(--butler-border);
  border-radius: 999px;
  background: var(--butler-dock-bg);
  padding: 4px;
}

.butler-bottom-dock__button {
  min-width: 0;
  height: 42px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
  border-radius: 999px;
  color: var(--butler-muted);
  font-size: 11px;
  font-weight: 800;
  transition:
    background 150ms ease,
    color 150ms ease,
    transform 150ms ease;
}

.butler-bottom-dock__button span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.butler-bottom-dock__button:hover {
  background: var(--butler-surface-soft);
  color: var(--butler-text);
}

.butler-bottom-dock__button--active {
  background: var(--butler-accent);
  box-shadow: 0 8px 18px color-mix(in srgb, var(--butler-accent) 20%, transparent);
  color: var(--butler-accent-fill-text);
}

.butler-bottom-dock__button:active {
  transform: scale(0.96);
}

.butler-glass-orb {
  position: relative;
  display: block;
  width: 58px;
  height: 58px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, 0.72);
  border-radius: 999px;
  background:
    radial-gradient(circle at 36% 22%, rgba(255, 255, 255, 0.72), rgba(255, 255, 255, 0) 29%),
    linear-gradient(145deg, rgba(255, 255, 255, 0.28), rgba(103, 232, 215, 0.1));
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.66),
    inset 0 -10px 18px rgba(13, 35, 42, 0.16);
  transition: transform 180ms cubic-bezier(.2, .8, .2, 1);
}

.butler-glass-orb::before {
  position: absolute;
  inset: 0;
  z-index: 3;
  border-radius: inherit;
  background:
    radial-gradient(circle at 34% 22%, rgba(255, 255, 255, 0.25), rgba(255, 255, 255, 0) 30%),
    radial-gradient(circle at 50% 78%, rgba(6, 14, 22, 0.12), rgba(6, 14, 22, 0) 44%);
  content: "";
  pointer-events: none;
}

.butler-glass-orb::after {
  position: absolute;
  left: 9px;
  top: 8px;
  z-index: 4;
  width: 17px;
  height: 9px;
  border-radius: 999px;
  animation: butler-orb-glint 4.8s ease-in-out infinite;
  background: rgba(255, 255, 255, 0.38);
  content: "";
  pointer-events: none;
  transform: rotate(-22deg);
}

.butler-glass-orb--large {
  width: 58px;
  height: 58px;
}

.butler-glass-orb--small {
  width: 44px;
  height: 44px;
}

.butler-glass-orb--settings {
  width: 72px;
  height: 72px;
  flex: 0 0 auto;
}

.butler-glass-orb--small::after {
  left: 7px;
  top: 6px;
  width: 13px;
  height: 7px;
}

.butler-glass-orb__lens {
  position: absolute;
  inset: 0;
  overflow: hidden;
  border-radius: inherit;
  transform: scale(var(--butler-orb-lens-edge-scale, 1));
}

.butler-glass-orb__lens::after {
  position: absolute;
  inset: 0;
  z-index: 2;
  border-radius: inherit;
  background:
    radial-gradient(circle at 50% 42%, rgba(255, 255, 255, 0) 0 34%, rgba(255, 255, 255, 0.18) 53%, rgba(12, 18, 28, 0.16) 100%),
    radial-gradient(circle at 50% 48%, rgba(255, 255, 255, 0.08) 0 42%, rgba(255, 255, 255, 0) 62%);
  content: "";
  opacity: var(--butler-orb-lens-overlay-opacity, 0);
  pointer-events: none;
}

.butler-glass-orb__canvas {
  position: absolute;
  inset: 0;
  z-index: 1;
  width: 100%;
  height: 100%;
  border-radius: inherit;
}

.butler-glass-orb__image {
  position: absolute;
  left: 50%;
  top: 50%;
  z-index: 1;
  max-width: none;
  width: var(--butler-orb-image-width, 132px);
  height: auto;
  border-radius: inherit;
  transform: translate(calc(-50% + var(--butler-orb-image-x, 0px)), calc(-45% + var(--butler-orb-image-y, 0px))) scale(var(--butler-orb-active-lens-scale, 1));
  transform-origin: 50% 45%;
  user-select: none;
  -webkit-user-drag: none;
}

.butler-glass-orb__image--base {
  --butler-orb-active-lens-scale: 1;
}

.butler-glass-orb__image--core {
  --butler-orb-active-lens-scale: var(--butler-orb-lens-core-scale, 1.42);

  z-index: 2;
  clip-path: circle(34% at 50% 45%);
  opacity: var(--butler-orb-lens-core-opacity, 0);
}

.butler-glass-orb--alert {
  border-color: color-mix(in srgb, var(--butler-rose) 72%, transparent);
  animation: butler-soft-pulse 1.3s ease-in-out infinite;
}

.butler-glass-orb--busy {
  border-color: color-mix(in srgb, var(--airi-accent-strong) 72%, transparent);
}

.butler-now-card,
.butler-agenda-card,
.butler-settings-panel,
.butler-task-card {
  border: 1px solid var(--butler-border);
  border-radius: 8px;
  background: var(--butler-surface-strong);
}

.butler-now-card {
  padding: 12px;
}

.butler-now-card--due {
  border-color: color-mix(in srgb, var(--butler-rose) 30%, transparent);
  background: linear-gradient(135deg, var(--butler-rose-soft), var(--butler-surface-strong) 58%);
}

.butler-now-card__mark {
  width: 36px;
  height: 36px;
  display: grid;
  place-items: center;
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--butler-accent-soft);
  color: var(--butler-accent-strong);
}

.butler-now-card__title {
  color: var(--butler-text);
}

.butler-now-card__description {
  color: var(--butler-muted);
}

.butler-reminder-notice {
  width: fit-content;
  max-width: 100%;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  border: 1px solid color-mix(in srgb, var(--butler-amber) 28%, transparent);
  border-radius: 999px;
  background: var(--butler-amber-soft);
  padding: 2px 7px;
  color: var(--butler-amber);
  font-size: 10px;
  font-weight: 800;
  line-height: 1.2;
}

.butler-reminder-notice--failed {
  border-color: color-mix(in srgb, var(--butler-rose) 28%, transparent);
  background: var(--butler-rose-soft);
  color: var(--butler-rose);
}

.butler-reminder-notice--blocked {
  border-color: color-mix(in srgb, var(--butler-amber) 28%, transparent);
  background: var(--butler-amber-soft);
  color: var(--butler-amber);
}

.butler-reminder-notice span:last-child {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.butler-agenda-card {
  padding: 10px;
}

.butler-agenda-stat {
  min-width: 48px;
  display: grid;
  place-items: center;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--butler-surface-soft);
  padding: 5px 6px;
  color: var(--butler-muted);
  line-height: 1;
}

.butler-agenda-stat strong {
  color: var(--butler-text);
  font-size: 13px;
  font-weight: 850;
}

.butler-agenda-stat span {
  margin-top: 3px;
  font-size: 9px;
  font-weight: 750;
}

.butler-agenda-empty,
.butler-agenda-row {
  -webkit-app-region: no-drag;
  border-radius: 8px;
  background: var(--butler-surface-soft);
}

.butler-agenda-empty {
  padding: 9px 10px;
  color: var(--butler-muted);
  font-size: 11px;
}

.butler-agenda-row {
  min-height: 38px;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
}

.butler-agenda-badge {
  flex: 0 0 auto;
  border-radius: 999px;
  background: rgba(19, 43, 50, 0.08);
  padding: 3px 7px;
  color: var(--butler-muted);
  font-size: 10px;
  font-weight: 800;
}

.butler-calendar-strip {
  -webkit-app-region: no-drag;
  margin: 8px -8px 0 0;
  display: flex;
  gap: 5px;
  overflow-x: auto;
  padding: 2px 10px 3px 0;
  scroll-padding-inline: 0 10px;
  scrollbar-width: none;
}

.butler-calendar-strip::-webkit-scrollbar {
  display: none;
}

.butler-calendar-day {
  position: relative;
  min-width: 42px;
  min-height: 54px;
  display: grid;
  grid-template-rows: 12px 18px 12px 5px;
  align-items: center;
  justify-items: center;
  flex: 0 0 auto;
  border: 1px solid var(--butler-border);
  border-radius: 999px;
  background: var(--butler-surface-soft);
  padding: 5px 5px 4px;
  color: var(--butler-muted);
  transition:
    background 160ms ease,
    border-color 160ms ease,
    color 160ms ease,
    flex-basis 160ms cubic-bezier(.2, .8, .2, 1),
    min-width 160ms cubic-bezier(.2, .8, .2, 1),
    transform 160ms cubic-bezier(.2, .8, .2, 1);
}

.butler-calendar-day--today {
  border-color: var(--butler-border-strong);
  background: var(--butler-accent-soft);
  color: var(--butler-accent-strong);
}

.butler-calendar-day--holiday {
  border-color: rgba(245, 158, 11, 0.28);
  background:
    linear-gradient(180deg, var(--butler-amber-soft), transparent 62%),
    var(--butler-surface-soft);
}

.butler-calendar-day--major-holiday {
  border-color: rgba(245, 158, 11, 0.44);
}

.butler-calendar-day--selected {
  min-width: 58px;
  border-color: var(--butler-border-strong);
  background:
    linear-gradient(180deg, var(--butler-accent-soft), transparent 60%),
    var(--butler-surface-strong);
  color: var(--butler-text);
  transform: translateY(-1px);
}

.butler-calendar-day__weekday,
.butler-calendar-day small {
  max-width: 100%;
  overflow: hidden;
  font-size: 9px;
  font-weight: 750;
  line-height: 1;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.butler-calendar-day strong {
  color: var(--butler-text);
  font-size: 15px;
  font-weight: 850;
  line-height: 1.15;
}

.butler-calendar-day small {
  width: 100%;
  color: var(--butler-subtle);
  font-size: 8px;
}

.butler-calendar-day--holiday small,
.butler-calendar-day--major-holiday small {
  color: var(--butler-amber);
}

.butler-calendar-day__dots {
  min-height: 4px;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 2px;
}

.butler-calendar-day__dot {
  width: 4px;
  height: 4px;
  border-radius: 999px;
  background: var(--butler-accent);
}

.butler-calendar-day__dot--alarm {
  background: var(--butler-amber);
}

.butler-calendar-day__dot--timer {
  background: rgb(56, 189, 248);
}

.butler-calendar-day__dot--reminder {
  background: var(--butler-accent);
}

.butler-calendar-focus {
  min-height: 42px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-top: 7px;
  border: 1px solid var(--butler-border);
  border-radius: 8px;
  background:
    linear-gradient(90deg, var(--butler-accent-soft), transparent 40%),
    var(--butler-surface-soft);
  padding: 7px 8px;
}

.butler-calendar-focus__title {
  overflow: hidden;
  color: var(--butler-subtle);
  font-size: 10px;
  font-weight: 780;
  line-height: 1.15;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.butler-calendar-focus__line {
  overflow: hidden;
  margin-top: 2px;
  color: var(--butler-text);
  font-size: 11px;
  font-weight: 800;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.butler-calendar-focus__badges {
  min-width: max-content;
  display: flex;
  flex: 0 0 auto;
  flex-direction: column;
  align-items: flex-end;
  gap: 4px;
}

.butler-calendar-focus__holiday,
.butler-calendar-focus__count {
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--butler-surface-strong);
  padding: 3px 7px;
  color: var(--butler-accent-strong);
  font-size: 9px;
  font-weight: 850;
  white-space: nowrap;
}

.butler-calendar-focus__holiday--major {
  background: var(--butler-amber-soft);
  color: var(--butler-amber);
}

.butler-settings-panel {
  border-color: transparent;
  background:
    linear-gradient(90deg, var(--butler-accent-soft), transparent 3px),
    var(--butler-surface-panel, rgba(255, 255, 255, 0.42));
  padding: 12px;
}

.butler-date-time-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(112px, 0.72fr);
  gap: 6px;
}

.butler-task-input,
.butler-time-field,
.butler-duration-field {
  -webkit-app-region: no-drag;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--butler-surface-soft);
  color: var(--butler-text);
  outline: none;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    box-shadow 150ms ease;
}

.butler-task-input {
  padding: 8px 10px;
  font-size: 14px;
}

.butler-task-input::placeholder {
  color: var(--butler-subtle);
}

.butler-task-input:focus,
.butler-time-field:focus-within,
.butler-duration-field:focus-within {
  border-color: var(--butler-border-strong);
  background: var(--butler-surface-focus, rgba(255, 255, 255, 0.68));
  box-shadow: 0 0 0 3px var(--butler-focus-ring);
}

.butler-time-field {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 8px;
  color: var(--butler-muted);
  cursor: pointer;
  font-size: 12px;
}

.butler-time-input {
  min-width: 0;
  width: 100%;
  height: 24px;
  cursor: pointer;
  background: transparent;
  color: var(--butler-text);
  color-scheme: light;
  font-size: 13px;
  outline: none;
}

.butler-duration-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
}

.butler-duration-field {
  min-width: 0;
  display: grid;
  grid-template-columns: 22px minmax(0, 1fr);
  align-items: center;
  gap: 6px;
  padding: 7px 8px;
  color: var(--butler-muted);
  font-size: 11px;
  font-weight: 750;
}

.butler-duration-field input {
  min-width: 0;
  width: 100%;
  background: transparent;
  color: var(--butler-text);
  font-size: 14px;
  font-weight: 800;
  outline: none;
  text-align: right;
}

.butler-segment-button {
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--butler-surface-soft);
  padding: 6px 8px;
  color: var(--butler-muted);
  font-size: 11px;
  font-weight: 700;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease,
    transform 150ms ease;
}

.butler-segment-button:hover {
  border-color: var(--butler-border);
  background: var(--butler-surface-hover, rgba(255, 255, 255, 0.66));
  color: var(--butler-text);
}

.butler-segment-button--active {
  border-color: var(--butler-border-strong);
  background: var(--butler-accent-soft);
  color: var(--butler-accent-strong);
}

.butler-segment-button:active {
  transform: scale(0.97);
}

.butler-empty-state {
  min-height: 100%;
  display: grid;
  place-items: center;
  border: 1px dashed var(--butler-border);
  border-radius: 8px;
  background: color-mix(in srgb, var(--butler-surface-soft) 72%, transparent);
  text-align: center;
}

.butler-task-card {
  border-color: transparent;
  background:
    linear-gradient(90deg, rgba(245, 158, 11, 0.22), transparent 3px),
    var(--butler-surface-soft);
  padding: 8px;
}

.butler-preview-strip {
  min-height: 44px;
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 0 auto;
  margin-top: auto;
  border: 1px solid var(--butler-border);
  border-radius: 8px;
  background: linear-gradient(90deg, var(--butler-accent-soft), var(--butler-surface-panel, rgba(255, 255, 255, 0.46)));
  padding: 0 12px;
  color: var(--butler-muted);
  font-size: 12px;
}

.butler-preview-strip > span:first-child {
  color: var(--butler-accent-strong);
}

.butler-status-pill {
  flex: 0 0 auto;
  border-radius: 999px;
  background: var(--butler-accent-soft);
  padding: 2px 8px;
  color: var(--butler-accent-strong);
  font-size: 10px;
  font-weight: 800;
}

.butler-range-row {
  -webkit-app-region: no-drag;
  display: grid;
  grid-template-columns: 56px minmax(0, 1fr) 42px;
  align-items: center;
  gap: 10px;
  color: var(--butler-muted);
  font-size: 12px;
  font-weight: 700;
}

.butler-toggle-row {
  -webkit-app-region: no-drag;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  color: var(--butler-muted);
  font-size: 12px;
  font-weight: 700;
}

.butler-toggle-row input {
  position: relative;
  width: 34px;
  height: 20px;
  flex: 0 0 auto;
  appearance: none;
  border: 1px solid var(--butler-border);
  border-radius: 999px;
  background: var(--butler-control-switch-bg);
  transition:
    background 150ms ease,
    border-color 150ms ease;
}

.butler-toggle-row input::before {
  position: absolute;
  left: 2px;
  top: 2px;
  width: 14px;
  height: 14px;
  border-radius: 999px;
  background: var(--butler-control-knob-bg);
  box-shadow: 0 1px 4px rgba(20, 32, 38, 0.2);
  content: "";
  transition: transform 150ms cubic-bezier(.2, .8, .2, 1);
}

.butler-toggle-row input:checked {
  border-color: var(--butler-border-strong);
  background: var(--butler-accent);
}

.butler-toggle-row input:checked::before {
  transform: translateX(14px);
}

.butler-range-row input {
  width: 100%;
  accent-color: var(--butler-accent);
}

.butler-range-row strong {
  color: var(--butler-text);
  font-size: 11px;
  font-weight: 800;
  text-align: right;
}

.butler-dock-button {
  min-height: 48px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--butler-surface-soft);
  color: var(--butler-accent-strong);
  font-size: 10px;
  font-weight: 750;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    transform 150ms ease;
}

.butler-dock-button:hover {
  border-color: var(--butler-border-strong);
  background: var(--butler-accent-soft);
}

.butler-dock-button--danger {
  border-color: color-mix(in srgb, var(--butler-rose) 28%, transparent);
  background: color-mix(in srgb, var(--butler-rose) 10%, var(--butler-surface-strong));
  color: color-mix(in srgb, var(--butler-rose) 86%, var(--butler-text));
}

.butler-dock-button--danger:hover {
  border-color: color-mix(in srgb, var(--butler-rose) 48%, var(--butler-border-strong));
  background: color-mix(in srgb, var(--butler-rose) 16%, var(--butler-surface-focus));
  color: color-mix(in srgb, var(--butler-rose) 94%, var(--butler-text));
}

.butler-dock-button:active {
  transform: scale(0.96);
}

.butler-tool-row {
  -webkit-app-region: no-drag;
  min-height: 42px;
  display: flex;
  align-items: center;
  gap: 10px;
  border: 1px solid transparent;
  border-radius: 8px;
  background: var(--butler-surface-soft);
  padding: 0 10px;
  color: var(--butler-muted);
  font-size: 12px;
  font-weight: 750;
  transition:
    background 150ms ease,
    border-color 150ms ease,
    color 150ms ease,
    transform 150ms ease;
}

.butler-tool-row:hover {
  border-color: var(--butler-border-strong);
  background: var(--butler-surface-hover, rgba(255, 255, 255, 0.68));
  color: var(--butler-text);
}

.butler-tool-row--danger {
  border-color: color-mix(in srgb, var(--butler-rose) 24%, transparent);
  background: color-mix(in srgb, var(--butler-rose) 9%, var(--butler-surface-strong));
  color: color-mix(in srgb, var(--butler-rose) 82%, var(--butler-text));
}

.butler-tool-row--danger:hover {
  border-color: color-mix(in srgb, var(--butler-rose) 46%, var(--butler-border-strong));
  background: color-mix(in srgb, var(--butler-rose) 15%, var(--butler-surface-focus));
  color: color-mix(in srgb, var(--butler-rose) 94%, var(--butler-text));
}

.butler-tool-row:active {
  transform: scale(0.98);
}

.butler-soft-button,
.butler-primary-button {
  -webkit-app-region: no-drag;
  min-width: 0;
  overflow: hidden;
  border-radius: 8px;
  cursor: pointer;
  font-size: 11px;
  font-weight: 800;
  text-overflow: ellipsis;
  transition:
    background 150ms ease,
    color 150ms ease,
    opacity 150ms ease,
    transform 150ms ease;
  white-space: nowrap;
}

.butler-soft-button {
  padding: 6px 10px;
  background: var(--butler-surface-soft);
  color: var(--butler-muted);
}

.butler-soft-button:hover {
  background: var(--butler-accent-soft);
  color: var(--butler-accent-strong);
}

.butler-soft-button--danger {
  background: color-mix(in srgb, var(--butler-rose) 9%, var(--butler-surface-strong));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--butler-rose) 24%, transparent);
  color: color-mix(in srgb, var(--butler-rose) 84%, var(--butler-text));
}

.butler-soft-button--danger:hover {
  background: color-mix(in srgb, var(--butler-rose) 15%, var(--butler-surface-focus));
  box-shadow: inset 0 0 0 1px color-mix(in srgb, var(--butler-rose) 42%, transparent);
  color: color-mix(in srgb, var(--butler-rose) 94%, var(--butler-text));
}

.butler-primary-button {
  padding: 6px 10px;
  background: var(--butler-accent);
  color: var(--butler-accent-fill-text);
}

.butler-primary-button:hover {
  background: var(--butler-accent-strong);
}

.butler-soft-button:active,
.butler-primary-button:active {
  transform: scale(0.97);
}

.butler-primary-button:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  transform: none;
}

.butler-tray-root button,
.butler-tray-root input[type="checkbox"],
.butler-tray-root input[type="range"],
.butler-tray-root input[type="date"],
.butler-tray-root input[type="time"],
.butler-tray-root input[type="number"] {
  cursor: pointer;
}

.butler-tray-root button:focus-visible,
.butler-tray-root input:focus-visible,
.butler-radial-action:focus-visible,
.butler-bubble-header__orb:focus-visible,
.butler-orb-button:focus-visible {
  outline: 2px solid var(--butler-focus-ring, var(--airi-accent-focus));
  outline-offset: 2px;
}

.butler-orb-root--dark .butler-glass-orb,
.butler-tray-root--dark .butler-glass-orb {
  border-color: rgba(255, 255, 255, 0.22);
  background:
    radial-gradient(circle at 36% 22%, rgba(255, 255, 255, 0.2), rgba(255, 255, 255, 0) 31%),
    linear-gradient(145deg, color-mix(in srgb, var(--airi-text-soft) 16%, transparent), color-mix(in srgb, var(--airi-accent-surface) 18%, transparent));
}

.butler-tray-root--dark .butler-task-input,
.butler-tray-root--dark .butler-time-field,
.butler-tray-root--dark .butler-duration-field,
.butler-tray-root--dark .butler-segment-button,
.butler-tray-root--dark .butler-dock-button,
.butler-tray-root--dark .butler-tool-row {
  background: var(--butler-surface-soft);
}

.butler-tray-root--dark .butler-settings-panel {
  background:
    linear-gradient(90deg, var(--butler-accent-soft), transparent 3px),
    var(--butler-surface-panel);
}

.butler-tray-root--dark .butler-task-card {
  background:
    linear-gradient(90deg, rgba(251, 191, 36, 0.14), transparent 3px),
    var(--butler-surface-soft);
}

.butler-tray-root--dark .butler-preview-strip {
  background: linear-gradient(90deg, var(--butler-accent-soft), var(--butler-surface-panel));
}

.butler-tray-root--dark .butler-task-input:focus,
.butler-tray-root--dark .butler-time-field:focus-within,
.butler-tray-root--dark .butler-duration-field:focus-within {
  background: var(--butler-surface-focus);
}

.butler-tray-root--dark .butler-time-input {
  color: var(--butler-text);
  color-scheme: dark;
}

@keyframes butler-soft-pulse {
  0%,
  100% {
    border-color: color-mix(in srgb, var(--butler-rose) 52%, transparent);
  }
  50% {
    border-color: color-mix(in srgb, var(--butler-rose) 90%, transparent);
  }
}

@keyframes butler-orb-enter {
  from {
    opacity: 0.72;
    transform: scale(0.94);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes butler-orb-charge {
  0% {
    transform: translate(-50%, -50%) scale(1);
  }
  36% {
    transform: translate(-50%, -50%) scale(0.86);
  }
  72% {
    transform: translate(-50%, -50%) scale(1.16);
  }
  100% {
    transform: translate(-50%, -50%) scale(var(--butler-orb-button-scale));
  }
}

@keyframes butler-radial-aura-enter {
  from {
    opacity: 0;
    transform: scale(0.72) rotate(-16deg);
  }
  to {
    opacity: 0.86;
    transform: scale(1) rotate(0deg);
  }
}

@keyframes butler-radial-action-enter {
  from {
    opacity: 0;
    transform: translate(-50%, -50%) scale(0.72);
  }
  to {
    opacity: 1;
    transform: translate(calc(-50% + var(--butler-radial-action-x, 0px)), calc(-50% + var(--butler-radial-action-y, 0px))) scale(1);
  }
}

@keyframes butler-tray-enter {
  from {
    opacity: 0;
    transform: scale(0.96) translateY(4px);
  }
  to {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
}

@keyframes butler-tray-leave {
  from {
    opacity: 1;
    transform: scale(1) translateY(0);
  }
  to {
    opacity: 0;
    transform: scale(0.96) translateY(4px);
  }
}

@keyframes butler-orb-glint {
  0%,
  100% {
    opacity: 0.32;
    transform: translate(0, 0) rotate(-22deg);
  }
  42% {
    opacity: 0.52;
    transform: translate(2px, -1px) rotate(-22deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .butler-orb-root,
  .butler-orb-button--charging,
  .butler-radial-aura,
  .butler-radial-action,
  .butler-tray-root--opening,
  .butler-tray-root--closing,
  .butler-glass-orb--alert,
  .butler-glass-orb::after {
    animation: none;
  }

  .butler-orb-button,
  .butler-radial-action,
  .butler-radial-aura-leave-active,
  .butler-radial-actions-leave-active .butler-radial-action,
  .butler-bottom-dock__button,
  .butler-soft-button,
  .butler-primary-button {
    transition: none;
  }
}
</style>
