<script setup lang="ts">
import { getOfficialApiFetch, SERVER_URL } from '@proj-airi/stage-ui/libs/auth'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { computed, onMounted, ref, watch } from 'vue'

import QqShortTermHistory from './QqShortTermHistory.vue'

interface QqMemory {
  id: string
  personaCardId: string
  scope: string
  kind: string
  text: string
  metadata: Record<string, unknown>
  recordedAt: string
}

const auth = useAuthStore()
const tab = ref<'long' | 'recent'>('long')
const entries = ref<QqMemory[]>([])
const query = ref('')
const category = ref('all')
const confirming = ref('')
const busy = ref(false)
const error = ref('')
const notice = ref('')

function categoryOf(entry: QqMemory) {
  if (entry.kind === 'diary')
    return 'diary'
  if (entry.scope.startsWith('qq-group-member:'))
    return 'member'
  if (entry.scope.startsWith('qq-group:'))
    return 'group'
  return 'private'
}

function scopeLabel(entry: QqMemory) {
  const parts = entry.scope.split(':')
  if (entry.kind === 'diary')
    return `QQ 日记 · ${String(entry.metadata.sourceSessionId || '会话未知')}`
  if (parts[0] === 'qq-private')
    return `小号 ${parts[1]} · 私聊 ${parts[2]}`
  if (parts[0] === 'qq-group-member')
    return `小号 ${parts[1]} · 群 ${parts[2]} · 成员 ${parts[3]}`
  if (parts[0] === 'qq-group')
    return `小号 ${parts[1]} · 群 ${parts[2]}`
  return 'QQ 记忆'
}

const visible = computed(() => entries.value.filter((entry) => {
  if (category.value !== 'all' && categoryOf(entry) !== category.value)
    return false
  const needle = query.value.trim().toLocaleLowerCase()
  return !needle || `${entry.text} ${scopeLabel(entry)} ${entry.metadata.diaryTitle || ''}`.toLocaleLowerCase().includes(needle)
}))

async function load() {
  if (!auth.isAuthenticated)
    return
  busy.value = true
  error.value = ''
  try {
    const response = await getOfficialApiFetch()(`${SERVER_URL}/api/shared-memory/qq`, { credentials: 'include' })
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`)
    entries.value = await response.json() as QqMemory[]
  }
  catch {
    error.value = 'QQ 长期记忆加载失败，请稍后重试。'
  }
  finally {
    busy.value = false
  }
}

async function remove(entry: QqMemory) {
  if (confirming.value !== entry.id) {
    confirming.value = entry.id
    return
  }
  busy.value = true
  error.value = ''
  try {
    const response = await getOfficialApiFetch()(`${SERVER_URL}/api/shared-memory/qq/${encodeURIComponent(entry.personaCardId)}/${encodeURIComponent(entry.id)}`, { method: 'DELETE', credentials: 'include' })
    if (!response.ok || !(await response.json() as { deleted: boolean }).deleted)
      throw new Error('delete failed')
    entries.value = entries.value.filter(item => item.id !== entry.id || item.personaCardId !== entry.personaCardId)
    confirming.value = ''
    notice.value = '已删除这条 QQ 记忆，后续对话不再读取。'
  }
  catch {
    error.value = '删除失败，请刷新后重试。'
  }
  finally {
    busy.value = false
  }
}

onMounted(() => void load())
watch(() => auth.isAuthenticated, enabled => enabled && void load())
</script>

<template>
  <div class="mx-auto max-w-5xl w-full p-4 space-y-5 sm:p-6">
    <header class="space-y-1">
      <h1 class="text-xl font-semibold">
        QQ 记忆管理
      </h1>
      <p class="text-sm airi-text-muted">
        查看 QQ 各私聊与群聊的记忆来源，并管理模型今后能够使用的内容。
      </p>
    </header>
    <div class="flex gap-2">
      <button type="button" class="airi-control px-4 py-2 text-sm" :class="tab === 'long' ? 'font-semibold' : 'opacity-70'" @click="tab = 'long'">
        长期记忆与日记
      </button>
      <button type="button" class="airi-control px-4 py-2 text-sm" :class="tab === 'recent' ? 'font-semibold' : 'opacity-70'" @click="tab = 'recent'">
        近期上下文
      </button>
    </div>
    <QqShortTermHistory v-if="tab === 'recent'" />
    <section v-else class="space-y-4">
      <p class="text-sm airi-text-muted">
        共 {{ entries.length }} 条 QQ 长期记忆与日记。删除后不会影响 QQ 原始聊天记录；本机已同步的副本会在下次同步时更新。
      </p>
      <div class="flex flex-wrap gap-2">
        <input v-model="query" type="search" aria-label="搜索 QQ 记忆" placeholder="搜索内容、小号或联系人" class="airi-input min-w-0 flex-1 px-3 py-2 text-sm">
        <select v-model="category" aria-label="筛选 QQ 记忆类型" class="airi-input px-3 py-2 text-sm">
          <option value="all">
            全部范围
          </option>
          <option value="private">
            私聊
          </option>
          <option value="group">
            群聊
          </option>
          <option value="member">
            群成员
          </option>
          <option value="diary">
            日记
          </option>
        </select>
        <button type="button" class="airi-control px-3 py-2 text-sm" :disabled="busy" @click="load">
          刷新
        </button>
      </div>
      <p v-if="error" role="alert" class="text-sm text-rose-600">
        {{ error }}
      </p>
      <p v-if="notice" role="status" class="text-sm text-emerald-600">
        {{ notice }}
      </p>
      <p v-if="!busy && !visible.length" class="airi-surface-panel rounded-xl p-6 text-sm airi-text-muted">
        没有符合条件的 QQ 记忆。
      </p>
      <article v-for="entry in visible" :key="`${entry.personaCardId}:${entry.id}`" class="airi-surface-panel rounded-xl p-4 space-y-3">
        <div class="flex flex-wrap items-start justify-between gap-2 text-xs airi-text-muted">
          <div>
            <strong class="airi-text">{{ scopeLabel(entry) }}</strong>
            <span v-if="entry.metadata.diaryTitle"> · {{ entry.metadata.diaryTitle }}</span>
            <span> · 角色 {{ entry.personaCardId }}</span>
          </div>
          <time :datetime="entry.recordedAt">{{ new Date(entry.recordedAt).toLocaleString() }}</time>
        </div>
        <p class="whitespace-pre-wrap break-words text-sm">
          {{ entry.text }}
        </p>
        <div class="flex items-center justify-between gap-2">
          <span class="text-xs airi-text-muted">来源：QQ · {{ entry.kind === 'diary' ? '日记' : '对话提取' }}</span>
          <button type="button" class="airi-status-danger rounded-lg px-3 py-1.5 text-xs" :disabled="busy" @click="remove(entry)">
            {{ confirming === entry.id ? '再点一次确认删除' : '删除记忆' }}
          </button>
        </div>
      </article>
    </section>
  </div>
</template>
