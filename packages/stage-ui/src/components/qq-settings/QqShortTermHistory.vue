<script setup lang="ts">
import { getOfficialApiFetch, SERVER_URL } from '@proj-airi/stage-ui/libs/auth'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { onMounted, ref, watch } from 'vue'

interface QqTurn {
  id: string
  conversationKey: string
  characterId: string
  senderId: string
  userContent: string
  replyContent: string | null
  messageTime: string | null
  createdAt: string
  status: string
}
interface QqConversation { conversationKey: string, createdAt: string, resetAt: string | null }

const auth = useAuthStore()
const turns = ref<QqTurn[]>([])
const conversations = ref<QqConversation[]>([])
const confirmKey = ref('')
const clearingKey = ref('')
const loading = ref(false)
const hasMore = ref(true)
const error = ref('')

async function load(more = false) {
  if (!auth.isAuthenticated)
    return
  loading.value = true
  error.value = ''
  try {
    const before = more && turns.value.length ? `?before=${encodeURIComponent(turns.value.at(-1)!.createdAt)}` : ''
    const response = await getOfficialApiFetch()(`${SERVER_URL}/api/qq/history${before}`, { credentials: 'include' })
    if (!response.ok)
      throw new Error(`HTTP ${response.status}`)
    const page = await response.json() as QqTurn[]
    turns.value = more ? [...turns.value, ...page] : page
    hasMore.value = page.length === 50
    if (!more) {
      const contexts = await getOfficialApiFetch()(`${SERVER_URL}/api/qq/context/conversations`, { credentials: 'include' })
      if (contexts.ok)
        conversations.value = await contexts.json() as QqConversation[]
    }
  }
  catch {
    error.value = 'QQ 对话记录暂时无法加载'
  }
  finally {
    loading.value = false
  }
}

async function clearContext(key: string) {
  if (confirmKey.value !== key) {
    confirmKey.value = key
    return
  }
  clearingKey.value = key
  error.value = ''
  try {
    const response = await getOfficialApiFetch()(`${SERVER_URL}/api/qq/context/clear`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conversationKey: key }),
    })
    if (!response.ok || !(await response.json() as { cleared: boolean }).cleared)
      throw new Error('clear failed')
    confirmKey.value = ''
    await load()
  }
  catch {
    error.value = '清除 QQ 短期上下文失败，请重试'
  }
  finally {
    clearingKey.value = ''
  }
}

function label(key: string) {
  const [, selfId, type, ...targetParts] = key.split(':')
  const targetId = targetParts.at(-1)
  return type === 'group' ? `QQ ${selfId} · 群 ${targetId}` : `QQ ${selfId} · 私聊 ${targetId}`
}

onMounted(() => void load())
watch(() => auth.isAuthenticated, enabled => enabled && void load())
</script>

<template>
  <section class="airi-surface-panel rounded-xl p-4 space-y-3">
    <div v-if="conversations.length" class="space-y-2">
      <p class="text-xs text-[var(--airi-text-muted)]">
        按私聊或群聊清除模型近期上下文。下方保留原始对话记录，长期记忆请在“长期记忆与日记”中逐条删除。
      </p>
      <div v-for="item in conversations" :key="item.conversationKey" class="flex items-center justify-between gap-3 airi-card rounded-lg p-3">
        <span class="min-w-0 break-all text-sm">{{ label(item.conversationKey) }}<small v-if="item.resetAt" class="block text-xs airi-text-muted">已于 {{ new Date(item.resetAt).toLocaleString() }} 清空此前上下文</small></span>
        <button type="button" class="shrink-0 airi-control px-3 py-1.5 text-xs" :disabled="!!clearingKey" @click="clearContext(item.conversationKey)">
          {{ confirmKey === item.conversationKey ? '再点一次确认清除' : '清除近期上下文' }}
        </button>
      </div>
    </div>
    <div class="flex items-center justify-between gap-3">
      <div>
        <h3 class="text-base font-semibold">
          QQ 短期记忆
        </h3>
        <p class="text-xs text-[var(--airi-text-muted)]">
          QQ 原始对话记录，包含已从模型近期上下文清除的内容；这里只供核对历史，不代表模型仍能读取。
        </p>
      </div>
      <button type="button" class="shrink-0 airi-control px-3 py-1.5 text-xs" :disabled="loading" @click="load()">
        刷新
      </button>
    </div>
    <p v-if="error" role="alert" class="text-sm text-rose-600">
      {{ error }}
    </p>
    <p v-else-if="!loading && turns.length === 0" class="text-sm text-[var(--airi-text-muted)]">
      暂无 QQ 对话记录
    </p>
    <div v-for="turn in turns" :key="turn.id" class="airi-card rounded-lg p-3 space-y-2">
      <div class="flex flex-wrap items-center justify-between gap-1 text-xs text-[var(--airi-text-muted)]">
        <span>{{ label(turn.conversationKey) }} · 发言人 {{ turn.senderId }}</span>
        <time :datetime="turn.messageTime || turn.createdAt">{{ new Date(turn.messageTime || turn.createdAt).toLocaleString() }}</time>
      </div>
      <p v-if="turn.userContent" class="break-words text-sm">
        {{ turn.userContent }}
      </p>
      <p v-if="turn.replyContent" class="break-words rounded-lg bg-[var(--airi-surface-control-muted)] p-2 text-sm">
        {{ turn.replyContent }}
      </p>
      <span v-if="turn.status !== 'delivered'" class="text-xs text-[var(--airi-text-soft)]">{{ turn.status === 'failed' ? '发送失败' : '处理中' }}</span>
    </div>
    <button v-if="hasMore && turns.length" type="button" class="w-full airi-control px-3 py-2 text-xs" :disabled="loading" @click="load(true)">
      加载更早的 QQ 对话
    </button>
  </section>
</template>
