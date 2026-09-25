<script setup lang="ts">
import type { ChatProvider } from '@xsai-ext/providers/utils'

import type { ButlerReminderDeliveryAttempt, ButlerTask } from '../../stores/butler-tasks'

import { useElectronEventaInvoke } from '@proj-airi/electron-vueuse'
import { getStageProductEdition } from '@proj-airi/stage-shared'
import { useChatOrchestratorStore } from '@proj-airi/stage-ui/stores/chat'
import { useChatContextStore } from '@proj-airi/stage-ui/stores/chat/context-store'
import { useChatSessionStore } from '@proj-airi/stage-ui/stores/chat/session-store'
import { useConsciousnessStore } from '@proj-airi/stage-ui/stores/modules/consciousness'
import { useProvidersStore } from '@proj-airi/stage-ui/stores/providers'
import { useIntervalFn } from '@vueuse/core'
import { storeToRefs } from 'pinia'
import { computed, onUnmounted, ref, watch } from 'vue'

import { createDesktopFeatureManifest } from '../../../shared/desktop-feature-manifest'
import { electronOpenWorkbench } from '../../../shared/eventa'
import { createButlerProactiveReplyRequest, ingestButlerProactiveReplyCapabilityContext } from '../../modules/butler-proactive-reply'
import { postQuickChatPresentEvent } from '../../modules/quick-chat-present'
import { createButlerTaskId, useButlerTasksStore } from '../../stores/butler-tasks'

const taskStore = useButlerTasksStore()
const workbenchEnabled = createDesktopFeatureManifest(getStageProductEdition()).features.workbench
const providersStore = useProvidersStore()
const consciousnessStore = useConsciousnessStore()
const chatStore = useChatOrchestratorStore()
const chatContext = useChatContextStore()
const chatSession = useChatSessionStore()
const openWorkbench = useElectronEventaInvoke(electronOpenWorkbench)

const { openTasks, nextTask, composerOpen, composerDraft, hasVisibleTasks, panelExpanded } = storeToRefs(taskStore)
const { activeProvider: activeChatProvider, activeModel: activeChatModel } = storeToRefs(consciousnessStore)

const now = ref(Date.now())
const expanded = panelExpanded
const newlyAddedTaskId = ref<string>()
const titleInput = ref('')
const noteInput = ref('')
const dueInput = ref(toLocalDatetimeInputValue(Date.now() + 30 * 60 * 1000))
const editingTaskId = ref<string>()
const editTitleInput = ref('')
const editNoteInput = ref('')
const editDueInput = ref(toLocalDatetimeInputValue(Date.now() + 30 * 60 * 1000))
const reminderSendingTaskIds = ref<Set<string>>(new Set())
const reminderFailedTaskIds = ref<Set<string>>(new Set())
let knownOpenTaskIds = new Set<string>()
let taskSnapshotInitialized = false
let clearNewlyAddedTaskTimer: ReturnType<typeof setTimeout> | undefined
let lastCleanupAt = 0
let taskCreateRequest: { id: string, inputKey: string } | undefined
const proactivePresentationTurns = new Map<string, string>()
const stopProactivePresentationHook = chatStore.onChatTurnComplete(async (chat, context) => {
  if (context.internal?.sourceSurface !== 'butler-task-reminder')
    return
  const taskId = context.internal.runtimeSignal?.taskId
  const turnId = taskId ? proactivePresentationTurns.get(taskId) : undefined
  if (!turnId)
    return
  proactivePresentationTurns.delete(taskId!)
  if (chat.outputText.trim()) {
    const assistantMessageId = `${turnId}:assistant`
    postQuickChatPresentEvent({
      assistantMessageId,
      assistantTurnId: turnId,
      mode: 'collapsed-quick-chat',
      segmentId: assistantMessageId,
      segmentIndex: 0,
      siblingAssistantMessageIds: [assistantMessageId],
      text: chat.outputText,
      turnId,
      type: 'quick-chat-turn-segment',
    })
  }
  postQuickChatPresentEvent({ mode: 'collapsed-quick-chat', turnId, type: 'quick-chat-turn-complete' })
})

const newlyAddedTask = computed(() => {
  return newlyAddedTaskId.value
    ? openTasks.value.find(task => task.id === newlyAddedTaskId.value)
    : undefined
})
const visibleTasks = computed(() => {
  const baseTasks = expanded.value ? openTasks.value.slice(0, 4) : openTasks.value.slice(0, 1)
  const freshTask = newlyAddedTask.value
  if (!freshTask || baseTasks.some(task => task.id === freshTask.id))
    return baseTasks

  return expanded.value
    ? [freshTask, ...baseTasks].slice(0, 4)
    : [freshTask]
})
const dueTasks = computed(() => openTasks.value.filter(task => task.dueAt <= now.value))
const unremindedDueTasks = computed(() => dueTasks.value.filter(task => !task.remindedAt))
const hasDueTask = computed(() => dueTasks.value.length > 0)
const headerSubtitle = computed(() => {
  if (newlyAddedTask.value)
    return `已添加 · ${formatRelativeDue(newlyAddedTask.value.dueAt)}`

  if (reminderSendingTaskIds.value.size > 0)
    return '正在主动提醒'

  if (reminderFailedTaskIds.value.size > 0)
    return '提醒未发出 · 检查模型设置'

  if (hasDueTask.value) {
    return unremindedDueTasks.value.length > 0
      ? `${unremindedDueTasks.value.length} 项到时间了`
      : `${dueTasks.value.length} 项已提醒`
  }

  if (nextTask.value)
    return `${openTasks.value.length} 项任务 · ${formatRelativeDue(nextTask.value.dueAt)}`

  return '新建一个提醒'
})

function padTimePart(value: number) {
  return String(value).padStart(2, '0')
}

function toLocalDatetimeInputValue(timestamp: number) {
  const date = new Date(timestamp)
  return [
    date.getFullYear(),
    '-',
    padTimePart(date.getMonth() + 1),
    '-',
    padTimePart(date.getDate()),
    'T',
    padTimePart(date.getHours()),
    ':',
    padTimePart(date.getMinutes()),
  ].join('')
}

function formatTime(timestamp: number) {
  return new Intl.DateTimeFormat(undefined, {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)
}

function isSameDay(left: Date, right: Date) {
  return left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate()
}

function formatRelativeDue(timestamp: number) {
  const diff = timestamp - now.value
  if (diff <= 0)
    return '现在'

  if (diff < 60 * 60 * 1000)
    return `${Math.ceil(diff / 60 / 1000)} 分钟后`

  const date = new Date(timestamp)
  const today = new Date(now.value)
  const tomorrow = new Date(today)
  tomorrow.setDate(today.getDate() + 1)

  const time = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  }).format(timestamp)

  if (isSameDay(date, today))
    return `今天 ${time}`

  if (isSameDay(date, tomorrow))
    return `明天 ${time}`

  return formatTime(timestamp)
}

function resetComposer(defaultDueAt = Date.now() + 30 * 60 * 1000) {
  taskCreateRequest = undefined
  titleInput.value = ''
  noteInput.value = ''
  dueInput.value = toLocalDatetimeInputValue(defaultDueAt)
}

function applyComposerDraft() {
  const draft = composerDraft.value
  titleInput.value = draft.title ?? ''
  noteInput.value = draft.note ?? ''
  dueInput.value = toLocalDatetimeInputValue(draft.dueAt ?? Date.now() + 30 * 60 * 1000)
}

function setQuickDue(minutes: number) {
  dueInput.value = toLocalDatetimeInputValue(Date.now() + minutes * 60 * 1000)
}

function openTaskEditor(task: ButlerTask) {
  expanded.value = true
  editingTaskId.value = task.id
  editTitleInput.value = task.title
  editNoteInput.value = task.note ?? ''
  editDueInput.value = toLocalDatetimeInputValue(task.dueAt)
  taskStore.closeComposer()
}

function closeTaskEditor() {
  editingTaskId.value = undefined
  editTitleInput.value = ''
  editNoteInput.value = ''
  editDueInput.value = toLocalDatetimeInputValue(Date.now() + 30 * 60 * 1000)
}

function clearNewlyAddedTask() {
  if (clearNewlyAddedTaskTimer) {
    clearTimeout(clearNewlyAddedTaskTimer)
    clearNewlyAddedTaskTimer = undefined
  }
  newlyAddedTaskId.value = undefined
}

function emphasizeNewTask(taskId: string) {
  expanded.value = true
  newlyAddedTaskId.value = taskId

  if (clearNewlyAddedTaskTimer)
    clearTimeout(clearNewlyAddedTaskTimer)

  clearNewlyAddedTaskTimer = setTimeout(() => {
    if (newlyAddedTaskId.value === taskId)
      newlyAddedTaskId.value = undefined
    clearNewlyAddedTaskTimer = undefined
  }, 8000)
}

function setTaskIdState(target: typeof reminderSendingTaskIds, taskId: string, active: boolean) {
  const nextTaskIds = new Set(target.value)
  if (active)
    nextTaskIds.add(taskId)
  else
    nextTaskIds.delete(taskId)

  target.value = nextTaskIds
}

function pruneTaskIdState(target: typeof reminderSendingTaskIds, openTaskIds: Set<string>) {
  const nextTaskIds = new Set([...target.value].filter(taskId => openTaskIds.has(taskId)))
  if (nextTaskIds.size !== target.value.size)
    target.value = nextTaskIds
}

function isTaskReminderSending(taskId: string) {
  return reminderSendingTaskIds.value.has(taskId)
}

function isTaskReminderFailed(taskId: string) {
  return reminderFailedTaskIds.value.has(taskId)
}

function clearTaskReminderState(taskId: string) {
  setTaskIdState(reminderSendingTaskIds, taskId, false)
  setTaskIdState(reminderFailedTaskIds, taskId, false)
}

async function handleSnoozeTask(taskId: string) {
  clearTaskReminderState(taskId)
  if (editingTaskId.value === taskId)
    closeTaskEditor()
  await taskStore.applyMainTaskMutation({
    id: taskId,
    type: 'snooze',
  }, () => taskStore.snoozeTask(taskId), 'ButlerTaskCard')
}

async function handleCompleteTask(taskId: string) {
  clearTaskReminderState(taskId)
  if (editingTaskId.value === taskId)
    closeTaskEditor()
  await taskStore.applyMainTaskMutation({
    id: taskId,
    type: 'complete',
  }, () => taskStore.completeTask(taskId), 'ButlerTaskCard')
}

async function handleDismissTask(taskId: string) {
  clearTaskReminderState(taskId)
  if (editingTaskId.value === taskId)
    closeTaskEditor()
  await taskStore.applyMainTaskMutation({
    id: taskId,
    type: 'dismiss',
  }, () => taskStore.dismissTask(taskId), 'ButlerTaskCard')
}

async function handleSaveTaskEdit(taskId: string) {
  const title = editTitleInput.value.trim()
  if (!title)
    return

  const patch = {
    title,
    note: editNoteInput.value,
    dueAt: new Date(editDueInput.value).getTime(),
  }
  await taskStore.applyMainTaskMutation({
    id: taskId,
    patch,
    type: 'update',
  }, () => taskStore.updateTask(taskId, patch), 'ButlerTaskCard')
  clearTaskReminderState(taskId)
  closeTaskEditor()
}

function getTaskStatusBadge(task: ButlerTask) {
  if (task.id === newlyAddedTaskId.value)
    return '刚添加'

  if (isTaskReminderSending(task.id))
    return '提醒中'

  if (isTaskReminderFailed(task.id))
    return '提醒失败'

  if (task.dueAt <= now.value && task.remindedAt)
    return '已提醒'

  if (task.dueAt <= now.value)
    return '到时间'

  return undefined
}

function getTaskStatusBadgeClass(task: ButlerTask) {
  if (task.id === newlyAddedTaskId.value)
    return 'butler-task-card__status-badge--fresh'

  if (isTaskReminderSending(task.id))
    return 'butler-task-card__status-badge--sending'

  if (isTaskReminderFailed(task.id))
    return 'butler-task-card__status-badge--failed'

  if (task.dueAt <= now.value && task.remindedAt)
    return 'butler-task-card__status-badge--reminded'

  if (task.dueAt <= now.value)
    return 'butler-task-card__status-badge--due'

  return ''
}

async function handleAddTask() {
  const title = titleInput.value.trim()
  if (!title)
    return

  const dueAt = new Date(dueInput.value).getTime()
  const input = {
    title,
    note: noteInput.value,
    dueAt,
  }
  const inputKey = JSON.stringify(input)
  if (taskCreateRequest?.inputKey !== inputKey)
    taskCreateRequest = { id: createButlerTaskId(), inputKey }

  let localTask: ButlerTask | undefined
  const usedMain = await taskStore.applyMainTaskMutation({
    id: taskCreateRequest.id,
    input,
    type: 'create',
  }, () => {
    localTask = taskStore.addTask(input)
  }, 'ButlerTaskCard')

  if (!usedMain && !localTask)
    return

  resetComposer()
  taskStore.closeComposer()
  expanded.value = true
}

function handleOpenComposer() {
  closeTaskEditor()
  resetComposer()
  taskStore.openComposer()
}

async function handleOpenAdvancedWorkbench() {
  try {
    expanded.value = true
    await openWorkbench()
  }
  catch (error) {
    console.warn('[ButlerTaskCard] Failed to open workbench window:', error)
  }
}

watch([composerOpen, composerDraft], ([open]) => {
  if (open)
    applyComposerDraft()
})

watch(openTasks, (tasks) => {
  const nextTaskIds = new Set(tasks.map(task => task.id))

  if (newlyAddedTaskId.value && !nextTaskIds.has(newlyAddedTaskId.value))
    clearNewlyAddedTask()

  if (editingTaskId.value && !nextTaskIds.has(editingTaskId.value))
    closeTaskEditor()

  pruneTaskIdState(reminderSendingTaskIds, nextTaskIds)
  pruneTaskIdState(reminderFailedTaskIds, nextTaskIds)

  if (!taskSnapshotInitialized) {
    knownOpenTaskIds = nextTaskIds
    taskSnapshotInitialized = true
    return
  }

  const freshTask = tasks.find(task => !knownOpenTaskIds.has(task.id))
  knownOpenTaskIds = nextTaskIds

  if (freshTask)
    emphasizeNewTask(freshTask.id)
}, { immediate: true })

async function applyTaskReminderDeliveryAttempt(task: Pick<ButlerTask, 'dueAt' | 'id'>, attempt: ButlerReminderDeliveryAttempt) {
  await taskStore.applyMainTaskMutation({
    attempt,
    id: task.id,
    type: 'record-reminder-delivery-attempt',
  }, () => {
    taskStore.recordReminderDeliveryAttempt(task.id, attempt)
  }, 'ButlerTaskCard')
}

async function markTaskReminderDelivered(task: Pick<ButlerTask, 'dueAt' | 'id'>, attemptedAt = Date.now()) {
  await applyTaskReminderDeliveryAttempt(task, {
    attemptedAt,
    dueAt: task.dueAt,
    status: 'delivered',
  })
}

async function triggerAiReminder(task: ButlerTask) {
  if (isTaskReminderSending(task.id))
    return

  setTaskIdState(reminderSendingTaskIds, task.id, true)
  setTaskIdState(reminderFailedTaskIds, task.id, false)

  try {
    if (!activeChatProvider.value || !activeChatModel.value)
      return

    const provider = await providersStore.getProviderInstance<ChatProvider>(activeChatProvider.value)
    const triggeredAt = Date.now()
    const request = createButlerProactiveReplyRequest(task, {
      currentAt: triggeredAt,
      triggeredAt,
    })
    const targetSessionId = chatSession.activeSessionId
    ingestButlerProactiveReplyCapabilityContext(chatContext, request, targetSessionId)
    const presentationTurnId = `butler-reminder-${task.id}-${triggeredAt}`
    proactivePresentationTurns.set(task.id, presentationTurnId)
    postQuickChatPresentEvent({ mode: 'collapsed-quick-chat', turnId: presentationTurnId, type: 'quick-chat-turn-start' })
    await chatStore.ingest(request.prompt, {
      model: activeChatModel.value,
      chatProvider: provider,
      hiddenUserMessage: true,
      memoryUserMessage: request.memoryUserMessage,
      proactiveTopic: true,
      runtimeSignal: request.runtimeSignal,
      sourceSurface: request.sourceSurface,
    }, targetSessionId)
    await markTaskReminderDelivered(task)
  }
  catch (error) {
    const presentationTurnId = proactivePresentationTurns.get(task.id)
    proactivePresentationTurns.delete(task.id)
    if (presentationTurnId) {
      postQuickChatPresentEvent({
        mode: 'collapsed-quick-chat',
        text: error instanceof Error ? error.message : String(error),
        turnId: presentationTurnId,
        type: 'quick-chat-turn-error',
      })
    }
    setTaskIdState(reminderFailedTaskIds, task.id, true)
    await applyTaskReminderDeliveryAttempt(task, {
      attemptedAt: Date.now(),
      dueAt: task.dueAt,
      status: 'failed',
    })
    console.warn('[ButlerTaskCard] Failed to trigger AI reminder:', error)
  }
  finally {
    setTaskIdState(reminderSendingTaskIds, task.id, false)
  }
}

useIntervalFn(() => {
  now.value = Date.now()

  if (activeChatProvider.value && activeChatModel.value) {
    for (const task of taskStore.pendingTaskDeliveries(now.value).slice(0, 2))
      void triggerAiReminder(task)
  }

  if (now.value - lastCleanupAt > 60 * 60 * 1000) {
    lastCleanupAt = now.value
    taskStore.cleanupOldTasks(now.value)
  }
}, 1000)

onUnmounted(() => {
  stopProactivePresentationHook()
  if (clearNewlyAddedTaskTimer)
    clearTimeout(clearNewlyAddedTaskTimer)
})
</script>

<template>
  <div class="butler-task-card-host">
    <Transition
      enter-active-class="transition duration-180 ease-out"
      enter-from-class="op-0 -translate-y-2"
      enter-to-class="op-100 translate-y-0"
      leave-active-class="transition duration-160 ease-in"
      leave-from-class="op-100 translate-y-0"
      leave-to-class="op-0 -translate-y-2"
    >
      <section
        v-if="hasVisibleTasks"
        :class="[
          'butler-task-card',
          hasDueTask ? 'butler-task-card--due' : '',
          newlyAddedTask ? 'butler-task-card--fresh' : '',
        ]"
      >
        <header class="butler-task-card__header">
          <div class="butler-task-card__mark">
            <div v-if="hasDueTask" i-solar:alarm-bold-duotone class="size-4.5" />
            <div v-else i-solar:clipboard-check-bold-duotone class="size-4.5" />
          </div>

          <div class="butler-task-card__title-wrap">
            <div class="butler-task-card__title">
              管家任务
            </div>
            <div class="butler-task-card__subtitle">
              {{ headerSubtitle }}
            </div>
          </div>

          <button class="butler-task-card__icon-button" title="新建任务" type="button" @click="handleOpenComposer">
            <div i-solar:add-circle-outline class="size-4.5" />
          </button>

          <button
            v-if="expanded && workbenchEnabled"
            class="butler-task-card__icon-button"
            title="打开高级工作台"
            type="button"
            @click="handleOpenAdvancedWorkbench"
          >
            <div i-ph:terminal-window-duotone class="size-4.5" />
          </button>

          <button
            v-if="openTasks.length > 1"
            class="butler-task-card__icon-button"
            title="展开任务"
            type="button"
            @click="expanded = !expanded"
          >
            <div
              :class="[
                'size-4.5 transition-transform duration-160',
                expanded ? 'rotate-180' : 'rotate-0',
              ]"
              i-solar:alt-arrow-down-line-duotone
            />
          </button>

          <button
            v-if="composerOpen && openTasks.length === 0"
            class="butler-task-card__icon-button"
            title="关闭"
            type="button"
            @click="taskStore.closeComposer()"
          >
            <div i-solar:close-circle-outline class="size-4.5" />
          </button>
        </header>

        <form v-if="composerOpen" class="butler-task-card__composer" @submit.prevent="handleAddTask">
          <input
            v-model="titleInput"
            class="butler-task-card__input"
            maxlength="64"
            placeholder="要完成什么？"
            required
          >
          <div class="butler-task-card__due-row">
            <input
              v-model="dueInput"
              class="butler-task-card__input"
              type="datetime-local"
              required
            >
          </div>
          <textarea
            v-model="noteInput"
            class="butler-task-card__textarea"
            maxlength="160"
            placeholder="补充信息"
            rows="2"
          />
          <div class="butler-task-card__quick-row">
            <button type="button" @click="setQuickDue(10)">
              10 分钟
            </button>
            <button type="button" @click="setQuickDue(30)">
              30 分钟
            </button>
            <button type="button" @click="setQuickDue(120)">
              2 小时
            </button>
            <button class="butler-task-card__submit" type="submit">
              保存
            </button>
          </div>
        </form>

        <div v-if="openTasks.length > 0" class="butler-task-card__list">
          <article
            v-for="task in visibleTasks"
            :key="task.id"
            :class="[
              'butler-task-card__task',
              task.dueAt <= now ? 'butler-task-card__task--due' : '',
              task.id === newlyAddedTaskId ? 'butler-task-card__task--fresh' : '',
              isTaskReminderSending(task.id) ? 'butler-task-card__task--sending' : '',
              isTaskReminderFailed(task.id) ? 'butler-task-card__task--failed' : '',
            ]"
          >
            <div class="butler-task-card__task-main">
              <div class="butler-task-card__task-title">
                {{ task.title }}
              </div>
              <div class="butler-task-card__task-time">
                <span
                  v-if="getTaskStatusBadge(task)"
                  :class="[
                    'butler-task-card__status-badge',
                    getTaskStatusBadgeClass(task),
                  ]"
                >
                  {{ getTaskStatusBadge(task) }}
                </span>
                <span>{{ formatRelativeDue(task.dueAt) }}</span>
              </div>
              <div v-if="task.note" class="butler-task-card__task-note">
                {{ task.note }}
              </div>
            </div>
            <div class="butler-task-card__task-actions">
              <button :title="editingTaskId === task.id ? '取消编辑' : '编辑'" type="button" @click="editingTaskId === task.id ? closeTaskEditor() : openTaskEditor(task)">
                <div v-if="editingTaskId === task.id" i-solar:close-circle-outline class="size-4" />
                <div v-else i-solar:pen-new-square-outline class="size-4" />
              </button>
              <button title="稍后提醒" type="button" @click="handleSnoozeTask(task.id)">
                <div i-solar:clock-circle-outline class="size-4" />
              </button>
              <button title="完成" type="button" @click="handleCompleteTask(task.id)">
                <div i-solar:check-circle-bold-duotone class="size-4" />
              </button>
              <button title="忽略" type="button" @click="handleDismissTask(task.id)">
                <div i-solar:close-circle-outline class="size-4" />
              </button>
            </div>
            <form v-if="editingTaskId === task.id" class="butler-task-card__edit-form" @submit.prevent="handleSaveTaskEdit(task.id)">
              <input
                v-model="editTitleInput"
                class="butler-task-card__input"
                maxlength="64"
                placeholder="任务标题"
                required
              >
              <input
                v-model="editDueInput"
                class="butler-task-card__input"
                type="datetime-local"
                required
              >
              <textarea
                v-model="editNoteInput"
                class="butler-task-card__textarea"
                maxlength="160"
                placeholder="补充信息"
                rows="2"
              />
              <div class="butler-task-card__edit-actions">
                <button type="button" @click="closeTaskEditor">
                  取消
                </button>
                <button class="butler-task-card__edit-submit" type="submit">
                  保存
                </button>
              </div>
            </form>
          </article>
        </div>
      </section>
    </Transition>
  </div>
</template>

<style scoped>
.butler-task-card-host {
  position: absolute;
  top: 12px;
  left: 12px;
  z-index: 70;
  width: min(320px, calc(100vw - 24px));
  max-height: calc(100vh - 24px);
  pointer-events: none;
}

.butler-task-card {
  --butler-accent-soft: var(--airi-accent-soft);
  --butler-accent-strong: var(--airi-accent-strong);
  --butler-warning-soft: rgb(245 158 11 / 0.14);
  --butler-warning-border: rgb(245 158 11 / 0.42);
  --butler-warning-text: rgb(180 83 9);
  --butler-success-soft: rgb(34 197 94 / 0.14);
  --butler-success-text: rgb(22 163 74);
  --butler-danger-soft: rgb(239 68 68 / 0.12);
  --butler-danger-border: rgb(239 68 68 / 0.42);
  --butler-danger-text: rgb(220 38 38);
  width: 100%;
  max-height: calc(100vh - 24px);
  overflow: hidden;
  border: 1px solid var(--airi-border-subtle);
  border-radius: 8px;
  background: var(--airi-surface-glass);
  box-shadow: 0 16px 40px rgb(15 23 42 / 0.14);
  color: var(--airi-text);
  pointer-events: auto;
}

.butler-task-card--due {
  border-color: var(--butler-warning-border);
  box-shadow:
    0 16px 42px rgb(15 23 42 / 0.16),
    0 0 0 1px rgb(245 158 11 / 0.16) inset;
}

.butler-task-card--fresh {
  animation: butler-task-card-fresh 680ms ease-out;
}

.butler-task-card__header {
  display: flex;
  min-height: 52px;
  align-items: center;
  gap: 8px;
  padding: 10px;
}

.butler-task-card__mark {
  display: grid;
  width: 30px;
  height: 30px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 8px;
  background: var(--butler-accent-soft);
  color: var(--butler-accent-strong);
}

.butler-task-card--due .butler-task-card__mark {
  background: var(--butler-warning-soft);
  color: var(--butler-warning-text);
}

.butler-task-card__title-wrap {
  min-width: 0;
  flex: 1;
}

.butler-task-card__title {
  overflow: hidden;
  font-size: 13px;
  font-weight: 650;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.butler-task-card__subtitle {
  overflow: hidden;
  margin-top: 3px;
  color: var(--airi-text-muted);
  font-size: 11px;
  line-height: 1.2;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.butler-task-card__icon-button,
.butler-task-card__task-actions button,
.butler-task-card__quick-row button,
.butler-task-card__edit-actions button {
  display: grid;
  place-items: center;
  border: 1px solid var(--airi-border-control);
  border-radius: 8px;
  background: color-mix(in srgb, var(--airi-surface-card) 74%, transparent);
  color: inherit;
  transition:
    background 160ms ease,
    border-color 160ms ease,
    transform 160ms ease;
}

.butler-task-card__icon-button {
  width: 28px;
  height: 28px;
  flex: 0 0 auto;
}

.butler-task-card__icon-button:hover,
.butler-task-card__task-actions button:hover,
.butler-task-card__quick-row button:hover,
.butler-task-card__edit-actions button:hover {
  border-color: color-mix(in srgb, var(--butler-accent-strong) 28%, var(--airi-border-control));
  background: var(--butler-accent-soft);
}

.butler-task-card__icon-button:active,
.butler-task-card__task-actions button:active,
.butler-task-card__quick-row button:active,
.butler-task-card__edit-actions button:active {
  transform: translateY(1px);
}

.butler-task-card__composer {
  display: grid;
  gap: 8px;
  padding: 0 10px 10px;
}

.butler-task-card__input,
.butler-task-card__textarea {
  width: 100%;
  border: 1px solid var(--airi-border-control);
  border-radius: 8px;
  background: color-mix(in srgb, var(--airi-surface-card) 78%, transparent);
  color: inherit;
  font-size: 12px;
  line-height: 1.35;
  outline: none;
}

.butler-task-card__input {
  height: 32px;
  padding: 0 9px;
}

.butler-task-card__textarea {
  min-height: 52px;
  resize: none;
  padding: 7px 9px;
}

.butler-task-card__input:focus,
.butler-task-card__textarea:focus {
  border-color: color-mix(in srgb, var(--butler-accent-strong) 45%, var(--airi-border-control));
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--butler-accent-soft) 64%, transparent);
}

.butler-task-card__due-row {
  min-width: 0;
}

.butler-task-card__quick-row {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 6px;
}

.butler-task-card__quick-row button {
  min-height: 28px;
  padding: 0 6px;
  font-size: 11px;
  white-space: nowrap;
}

.butler-task-card__quick-row .butler-task-card__submit {
  border-color: color-mix(in srgb, var(--butler-accent-strong) 36%, var(--airi-border-control));
  background: var(--butler-accent-soft);
  color: var(--butler-accent-strong);
  font-weight: 650;
}

.butler-task-card__list {
  display: grid;
  max-height: min(320px, calc(100vh - 82px));
  gap: 6px;
  overflow-y: auto;
  padding: 0 10px 10px;
}

.butler-task-card__task {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  gap: 8px;
  align-items: center;
  border: 1px solid var(--airi-border-subtle);
  border-radius: 8px;
  background: color-mix(in srgb, var(--airi-surface-card) 62%, transparent);
  padding: 8px;
}

.butler-task-card__task--due {
  border-color: var(--butler-warning-border);
  background: var(--butler-warning-soft);
}

.butler-task-card__task--fresh {
  border-color: color-mix(in srgb, var(--butler-accent-strong) 42%, var(--airi-border-control));
  background: var(--butler-accent-soft);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--butler-accent-soft) 70%, transparent) inset;
}

.butler-task-card__task--sending {
  border-color: color-mix(in srgb, var(--butler-accent-strong) 36%, var(--airi-border-control));
  background: color-mix(in srgb, var(--butler-accent-soft) 86%, transparent);
}

.butler-task-card__task--failed {
  border-color: var(--butler-danger-border);
  background: var(--butler-danger-soft);
}

.butler-task-card__task-main {
  min-width: 0;
}

.butler-task-card__task-title {
  overflow-wrap: anywhere;
  font-size: 12px;
  font-weight: 650;
  line-height: 1.35;
}

.butler-task-card__task-time {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px;
  margin-top: 3px;
  color: var(--airi-text-muted);
  font-size: 11px;
}

.butler-task-card__status-badge {
  display: inline-flex;
  min-height: 16px;
  align-items: center;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 650;
  line-height: 1;
  padding: 0 6px;
}

.butler-task-card__status-badge--fresh,
.butler-task-card__status-badge--sending {
  background: var(--butler-accent-soft);
  color: var(--butler-accent-strong);
}

.butler-task-card__status-badge--due {
  background: var(--butler-warning-soft);
  color: var(--butler-warning-text);
}

.butler-task-card__status-badge--reminded {
  background: var(--butler-success-soft);
  color: var(--butler-success-text);
}

.butler-task-card__status-badge--failed {
  background: var(--butler-danger-soft);
  color: var(--butler-danger-text);
}

.butler-task-card__task-note {
  display: -webkit-box;
  overflow: hidden;
  margin-top: 5px;
  color: var(--airi-text-muted);
  font-size: 11px;
  line-height: 1.35;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

.butler-task-card__edit-form {
  display: grid;
  grid-column: 1 / -1;
  gap: 6px;
  padding-top: 2px;
}

.butler-task-card__edit-actions {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}

.butler-task-card__edit-actions button {
  min-height: 28px;
  font-size: 11px;
}

.butler-task-card__edit-actions .butler-task-card__edit-submit {
  border-color: color-mix(in srgb, var(--butler-accent-strong) 36%, var(--airi-border-control));
  background: var(--butler-accent-soft);
  color: var(--butler-accent-strong);
  font-weight: 650;
}

.butler-task-card__task-actions {
  display: grid;
  grid-template-columns: repeat(4, 24px);
  gap: 4px;
}

.butler-task-card__task-actions button {
  width: 24px;
  height: 24px;
}

:global(.dark) .butler-task-card {
  --butler-warning-soft: rgb(245 158 11 / 0.22);
  --butler-warning-border: rgb(245 158 11 / 0.38);
  --butler-warning-text: rgb(251 191 36);
  --butler-success-soft: rgb(34 197 94 / 0.2);
  --butler-success-text: rgb(134 239 172);
  --butler-danger-soft: rgb(239 68 68 / 0.16);
  --butler-danger-border: rgb(248 113 113 / 0.38);
  --butler-danger-text: rgb(252 165 165);
  box-shadow: 0 16px 40px rgb(0 0 0 / 0.3);
}

@keyframes butler-task-card-fresh {
  0% {
    transform: translateY(-3px) scale(0.985);
    box-shadow: 0 10px 28px color-mix(in srgb, var(--butler-accent-soft) 70%, transparent);
  }

  100% {
    transform: translateY(0) scale(1);
  }
}
</style>
