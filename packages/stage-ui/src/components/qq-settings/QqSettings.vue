<script setup lang="ts">
import type { MemorySyncConflict } from '@proj-airi/stage-ui/libs/shared-memory-sync'

import { notebookRepo } from '@proj-airi/stage-ui/database/repos/notebook.repo'
import { getOfficialApiFetch, SERVER_URL } from '@proj-airi/stage-ui/libs/auth'
import { resolveLocalMemoryCardId, setLocalMemoryCardId } from '@proj-airi/stage-ui/libs/shared-memory-card-map'
import { ACCOUNT_MEMORY_SETTING_ID, getMemorySyncConflicts, listSharedMemorySettings, resolveMemorySyncConflict, syncCharacterMemory } from '@proj-airi/stage-ui/libs/shared-memory-sync'
import { useAuthStore } from '@proj-airi/stage-ui/stores/auth'
import { useCharacterNotebookStore } from '@proj-airi/stage-ui/stores/character/notebook'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import QqCharacterPicker from './QqCharacterPicker.vue'
import QqLoginQr from './QqLoginQr.vue'

type GroupMode = 'mention' | 'keyword' | 'always' | 'off'
const QQ_ID_PATTERN = /^\d{4,15}$/
const KEYWORD_SEPARATOR = /[,，\n]/
const EMOTION_TAG_SEPARATOR = /[,，、\s]+/
interface CharacterItem { id: string, avatarUrl?: string | null, coverUrl?: string | null, i18n?: Array<{ name: string }> }
interface GroupPolicy { groupId: string, mode: GroupMode, keywords: string[] }
interface Binding {
  id: string
  selfId: string
  characterId: string
  personaName?: string | null
  status: 'pending' | 'active'
  online: boolean
  connectionState: 'unknown' | 'connected' | 'reconnecting' | 'authorization_required'
  connectionUpdatedAt?: string | null
  loginQrUrl?: string | null
  defaultGroupMode: Exclude<GroupMode, 'keyword'>
  autoStickerSearch: boolean
  webSearchEnabled: boolean
  stickerFrequency: number
  voiceMode: 'off' | 'auto'
  voiceInputEnabled: boolean
  voiceFrequency: number
  voiceId?: string | null
  realReplyEnabled: boolean
  nativeCallEnabled: boolean
  nativeCallCapability?: 'ready' | 'no-answer' | 'no-dial' | 'not-configured' | 'unavailable' | null
  nativeCallCapabilityUpdatedAt?: string | null
  realReplyMaxDelaySeconds: number
  typingStatusEnabled: boolean
  contextTurnLimit: number
  diaryEnabled: boolean
  proactiveEnabled: boolean
  proactiveIntervalHours: number
  proactiveStartHour: number
  proactiveEndHour: number
  proactiveTimezoneOffset: number
  stickerImportStatus: 'idle' | 'pending' | 'complete' | 'failed'
  stickerImportCount: number
  stickerImportSkipped: number
  groups: GroupPolicy[]
}
interface ConnectRequest {
  id: string
  status: 'queued' | 'waiting_for_authorization' | 'connected' | 'failed' | 'cancelled'
  qrcode?: string | null
  createdAt: string
}
interface StickerAsset { id: string, imageData: string, description: string, emotionTags: string[], searchQuery: string, sourceUrl: string, useCount: number, seriesTag: string, favorite: boolean, analysisFailed?: boolean }
interface OfficialVoice { voiceId: string, nameZh: string, chainStatus?: string }
interface QqDiary { id: string, text: string, metadata: Record<string, unknown>, recordedAt: string }

const auth = useAuthStore()
const cardStore = useAiriCardStore()
const bindings = ref<Binding[]>([])
const memoryEnabledIds = ref<string[]>([])
const memoryCardIds = ref<Record<string, string>>({})
const memoryConflicts = ref<Record<string, Array<MemorySyncConflict & { localText: string | null }>>>({})
const connectRequests = ref<ConnectRequest[]>([])
const autoConnectAvailable = ref(true)
const characters = computed<CharacterItem[]>(() => Array.from(cardStore.cards.entries()).map(([id, card]) => ({
  id: `local:${id}`,
  avatarUrl: cardStore.getCardRuntime(id)?.avatarUrl,
  i18n: [{ name: card.name || '未命名人格' }],
})))
const characterId = ref('')
const groupId = ref('')
const groupMode = ref<GroupMode>('mention')
const keywords = ref('')
const selectedBindingId = ref('')
const editingCharacterBindingId = ref('')
const removeConfirmId = ref('')
const busy = ref(false)
const loading = ref(false)
const error = ref('')
const accountError = ref('')
const memoryError = ref('')
const notice = ref('')
const stickerBindingId = ref('')
const stickerAssets = ref<StickerAsset[]>([])
const stickerAutoAnalyze = ref(false)
const officialVoices = ref<OfficialVoice[]>([])
const qqDiaries = ref<QqDiary[]>([])

const selectedBinding = computed(() => bindings.value.find(item => item.id === selectedBindingId.value))

function callAvailability(binding: Binding) {
  if (!binding.nativeCallEnabled)
    return '电话功能已关闭。'
  if (!binding.realReplyEnabled)
    return '需要开启真实回复。'
  if (!binding.voiceInputEnabled)
    return '需要开启“听懂收到的 QQ 语音”。'
  if (!binding.voiceId)
    return '需要选择声线。'
  if (!binding.online || binding.connectionState !== 'connected')
    return 'QQ 小号当前未连接。'
  if (!binding.nativeCallCapabilityUpdatedAt || Date.now() - new Date(binding.nativeCallCapabilityUpdatedAt).getTime() > 150_000)
    return '尚未收到接入器的最新电话能力状态。'
  if (binding.nativeCallCapability === 'ready')
    return '拨号与接听能力已就绪；实际通话仍取决于 QQ 端连接。'
  if (binding.nativeCallCapability === 'no-answer')
    return '接入器不支持接听 QQ 来电。'
  if (binding.nativeCallCapability === 'no-dial')
    return '接入器不支持 QQ 拨号。'
  if (binding.nativeCallCapability === 'not-configured')
    return 'QQ 接入器尚未配置原生电话服务。'
  return '原生电话服务当前无法连接或账号不匹配。'
}

function nameFor(id: string, fallback?: string | null) {
  return characters.value.find(item => item.id === id)?.i18n?.[0]?.name || fallback || '云端角色卡'
}

function personaFor(id: string) {
  const runtime = id.startsWith('local:') ? cardStore.getCardRuntime(id.slice(6)) : null
  if (!runtime?.systemPrompt)
    throw new Error('所选本机角色卡没有可用的人格设定，请重新选择。')
  if (runtime.systemPrompt.length > 30_000)
    throw new Error('角色卡设定超过 30000 字，请精简后再绑定 QQ。')
  return { name: runtime.displayName, prompt: runtime.systemPrompt }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await getOfficialApiFetch()(`${SERVER_URL}/api/qq${path}`, {
      credentials: 'include',
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    })
  }
  catch {
    throw new Error('无法连接服务端，请检查网络后重试。QQ 接入器的在线状态需在账号添加成功后查看。')
  }
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { error?: string }
    if (response.status === 401)
      throw new Error('请先登录 Wuwiii 账号。')
    if (response.status === 402)
      throw new Error('视觉识别积分不足。可以手动填写表情描述和情绪标签。')
    if (response.status === 409)
      throw new Error(path === '/connect' ? '已有一个 QQ 接入正在进行，请先完成或取消。' : path.includes('/stickers') ? '表情素材库已满，最多可保存 48 张。' : '这个 QQ 小号已被绑定。')
    if (response.status === 403)
      throw new Error('所选角色卡不属于当前账号，请检查后重试。')
    if (response.status === 404)
      throw new Error('当前服务端没有 QQ 管理接口，或该小号已不存在。请更新服务端后重试。')
    if (response.status >= 500)
      throw new Error(`QQ 管理接口返回服务器错误（HTTP ${response.status}${body.error ? `，${body.error}` : ''}）。请检查服务端 QQ 数据库迁移与运行日志。`)
    throw new Error('QQ 设置未能保存，请检查 QQ 号和角色卡后重试。')
  }
  return response.status === 204 ? undefined as T : await response.json() as T
}

async function loadMemory() {
  if (!auth.user?.id)
    return
  try {
    memoryCardIds.value = Object.fromEntries(bindings.value
      .filter(item => item.characterId.startsWith('local:'))
      .map((item) => {
        const personaId = item.characterId.slice(6)
        return [personaId, resolveLocalMemoryCardId(auth.user!.id, personaId, cardStore.cards.keys()) ?? '']
      }))
    const settings = await listSharedMemorySettings()
    const accountEnabled = settings.find(item => item.personaCardId === ACCOUNT_MEMORY_SETTING_ID)?.enabled !== 0
    const disabled = new Set(settings.filter(item => !item.enabled).map(item => item.personaCardId))
    memoryEnabledIds.value = accountEnabled
      ? bindings.value.filter(item => item.characterId.startsWith('local:')).map(item => item.characterId.slice(6)).filter(id => !disabled.has(id))
      : []
    const notebook = useCharacterNotebookStore()
    memoryConflicts.value = Object.fromEntries(await Promise.all(bindings.value
      .filter(item => item.characterId.startsWith('local:') && memoryCardIds.value[item.characterId.slice(6)])
      .map(async (item) => {
        const personaId = item.characterId.slice(6)
        const scope = notebook.resolveMemoryScope({ personaCardId: memoryCardIds.value[personaId] })
        const localEntries = (await notebookRepo.load(scope.characterId))?.entries ?? []
        const localById = new Map(localEntries.map(entry => [entry.id, entry.text]))
        const conflicts = (await getMemorySyncConflicts(personaId)).map(conflict => ({ ...conflict, localText: localById.get(conflict.id) ?? null }))
        return [personaId, conflicts] as const
      })))
    memoryError.value = ''
  }
  catch (cause) {
    console.warn('[QQ settings] Failed to load local memory status:', cause)
    memoryError.value = '本机记忆状态暂时无法读取，QQ 账号与连接状态仍可正常管理。'
  }
}

async function load() {
  if (!auth.isAuthenticated)
    return
  if (loading.value)
    return
  loading.value = true
  try {
    const previous = bindings.value.find(item => item.id === stickerBindingId.value)
    bindings.value = await request<Binding[]>('/accounts')
    try {
      qqDiaries.value = await request<QqDiary[]>('/diaries?limit=5')
    }
    catch (cause) {
      console.warn('[QQ diary] Failed to load entries:', cause)
    }
    const current = bindings.value.find(item => item.id === stickerBindingId.value)
    if (current && previous?.stickerImportStatus === 'pending' && current.stickerImportStatus !== 'pending')
      stickerAssets.value = await request<StickerAsset[]>(`/accounts/${current.id}/stickers`)
    accountError.value = ''
    try {
      connectRequests.value = await request<ConnectRequest[]>('/connect')
      autoConnectAvailable.value = true
    }
    catch (cause) {
      autoConnectAvailable.value = false
      connectRequests.value = []
      accountError.value = cause instanceof Error ? cause.message : 'QQ 接入服务暂不可用，请稍后重试。'
    }
    if (!selectedBindingId.value && bindings.value[0])
      selectedBindingId.value = bindings.value[0].id
  }
  catch (cause) {
    accountError.value = cause instanceof Error ? cause.message : 'QQ 账号加载失败，请重试。'
  }
  if (!characterId.value && characters.value[0])
    characterId.value = characters.value[0].id
  loading.value = false
}

async function loadVoices() {
  try {
    const response = await getOfficialApiFetch()(`${SERVER_URL}/api/model-gateway/v1/voices`)
    if (response.ok)
      officialVoices.value = (await response.json() as { voices: OfficialVoice[] }).voices
  }
  catch { /* Voice stays optional when the catalog is unavailable. */ }
}

async function run(action: () => Promise<void>) {
  if (busy.value)
    return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await action()
    await load()
    await loadMemory()
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : '操作失败，请稍后重试。'
  }
  finally {
    busy.value = false
  }
}

function selectMemoryCard(binding: Binding, localCardId: string) {
  const personaId = binding.characterId.slice(6)
  if (!auth.user?.id || !cardStore.cards.has(localCardId))
    return
  void run(async () => {
    setLocalMemoryCardId(auth.user!.id, personaId, localCardId)
    memoryCardIds.value = { ...memoryCardIds.value, [personaId]: localCardId }
    if (memoryEnabledIds.value.includes(personaId))
      await syncCharacterMemory(personaId)
    notice.value = '已将 QQ 人格对应到这台设备的角色卡，记忆会同步到该角色。'
  })
}

function resolveMemoryConflict(binding: Binding, id: string, choice: 'local' | 'remote') {
  void run(async () => {
    const resolved = await resolveMemorySyncConflict(binding.characterId.slice(6), id, choice)
    if (!resolved)
      throw new Error('这条记忆已发生变化，请先同步并刷新后重试。')
    notice.value = choice === 'local' ? '已保留本机版本并同步到云端。' : '已采用云端版本并更新本机记忆。'
  })
}

function connectQq() {
  void run(async () => {
    if (!characterId.value || !characters.value.some(item => item.id === characterId.value))
      throw new Error('请先选择角色卡。')
    await request('/connect', { method: 'POST', body: JSON.stringify({ characterId: characterId.value, persona: personaFor(characterId.value) }) })
    notice.value = '正在准备 QQ 登录，二维码出现后请用小号扫码确认。'
  })
}

function cancelConnect(id: string) {
  void run(async () => {
    await request(`/connect/${id}`, { method: 'DELETE' })
    notice.value = '已结束这次 QQ 接入。'
  })
}

function refreshConnectQr(id: string) {
  void run(async () => {
    await request(`/connect/${id}/refresh`, { method: 'POST' })
    notice.value = '已请求重新获取登录二维码，请稍候。'
  })
}

function updateAccount(id: string, input: { characterId?: string, defaultGroupMode?: Binding['defaultGroupMode'], autoStickerSearch?: boolean, webSearchEnabled?: boolean, stickerFrequency?: number, voiceMode?: 'off' | 'auto', voiceInputEnabled?: boolean, voiceFrequency?: number, voiceId?: string | null, realReplyEnabled?: boolean, nativeCallEnabled?: boolean, realReplyMaxDelaySeconds?: number, typingStatusEnabled?: boolean, contextTurnLimit?: number, diaryEnabled?: boolean, proactiveEnabled?: boolean, proactiveIntervalHours?: number, proactiveStartHour?: number, proactiveEndHour?: number, proactiveTimezoneOffset?: number, persona?: { name: string, prompt: string } }) {
  void run(async () => {
    await request(`/accounts/${id}`, { method: 'PATCH', body: JSON.stringify(input) })
    notice.value = '已保存 QQ 回复设置。'
  })
}

function toggleStickerLibrary(bindingId: string) {
  if (stickerBindingId.value === bindingId) {
    stickerBindingId.value = ''
    stickerAssets.value = []
    return
  }
  void run(async () => {
    stickerAssets.value = await request<StickerAsset[]>(`/accounts/${bindingId}/stickers`)
    stickerBindingId.value = bindingId
  })
}

function removeSticker(bindingId: string, assetId: string) {
  void run(async () => {
    await request(`/accounts/${bindingId}/stickers/${assetId}`, { method: 'DELETE' })
    stickerAssets.value = await request<StickerAsset[]>(`/accounts/${bindingId}/stickers`)
    notice.value = '已删除这张表情。'
  })
}

function updateSticker(bindingId: string, assetId: string, input: { description?: string, emotionTags?: string[], seriesTag?: string, favorite?: boolean }) {
  void run(async () => {
    await request(`/accounts/${bindingId}/stickers/${assetId}`, { method: 'PATCH', body: JSON.stringify(input) })
    stickerAssets.value = await request<StickerAsset[]>(`/accounts/${bindingId}/stickers`)
  })
}

function analyzeSticker(bindingId: string, assetId: string) {
  void run(async () => {
    await request(`/accounts/${bindingId}/stickers/${assetId}/analyze`, { method: 'POST' })
    stickerAssets.value = await request<StickerAsset[]>(`/accounts/${bindingId}/stickers`)
    notice.value = '已更新表情描述与情绪标签。'
  })
}

function parseEmotionTags(value: string) {
  return [...new Set(value.split(EMOTION_TAG_SEPARATOR).map(tag => tag.trim()).filter(Boolean))].slice(0, 3)
}

function syncQqStickers(bindingId: string) {
  void run(async () => {
    await request(`/accounts/${bindingId}/stickers/sync`, { method: 'POST', body: JSON.stringify({ autoAnalyze: stickerAutoAnalyze.value }) })
    notice.value = stickerAutoAnalyze.value ? '已请求同步 QQ 表情；每张新表情会单独调用视觉识别并扣点。' : '已请求同步 QQ 表情；请在导入后手动补充描述，或按需点击 AI 重识别。'
  })
}

function selectBoundCharacter(binding: Binding, nextCharacterId: string) {
  if (nextCharacterId === binding.characterId) {
    editingCharacterBindingId.value = ''
    return
  }
  void run(async () => {
    await request(`/accounts/${binding.id}`, { method: 'PATCH', body: JSON.stringify({ characterId: nextCharacterId, persona: personaFor(nextCharacterId) }) })
    editingCharacterBindingId.value = ''
    notice.value = `QQ ${binding.selfId} 已切换为${nameFor(nextCharacterId)}。`
  })
}

function syncBoundCharacter(binding: Binding) {
  void run(async () => {
    const localCardId = memoryCardIds.value[binding.characterId.slice(6)]
    if (!localCardId)
      throw new Error('请先选择这台设备上的对应角色卡。')
    await request(`/accounts/${binding.id}`, { method: 'PATCH', body: JSON.stringify({ characterId: binding.characterId, persona: personaFor(`local:${localCardId}`) }) })
    notice.value = `QQ ${binding.selfId} 的人格设定已同步。`
  })
}

function removeAccount(binding: Binding) {
  if (removeConfirmId.value !== binding.id) {
    removeConfirmId.value = binding.id
    return
  }
  void run(async () => {
    await request(`/accounts/${binding.id}`, { method: 'DELETE' })
    characterId.value = binding.characterId
    if (selectedBindingId.value === binding.id)
      selectedBindingId.value = ''
    if (editingCharacterBindingId.value === binding.id)
      editingCharacterBindingId.value = ''
    removeConfirmId.value = ''
    notice.value = '旧 QQ 已解除绑定。请在上方申请接入，并用新 QQ 小号扫码。连接器释放可能需要约 1 分钟。'
  })
}

function requestReauth(binding: Binding) {
  void run(async () => {
    await request(`/accounts/${binding.id}/reauth`, { method: 'POST' })
    notice.value = `已请求 QQ ${binding.selfId} 重新获取授权二维码，请稍候。`
  })
}

function saveGroup() {
  if (!selectedBinding.value)
    return
  void run(async () => {
    const id = groupId.value.trim()
    if (!QQ_ID_PATTERN.test(id))
      throw new Error('请填写正确的群号。')
    const words = keywords.value.split(KEYWORD_SEPARATOR).map(value => value.trim()).filter(Boolean)
    if (groupMode.value === 'keyword' && words.length === 0)
      throw new Error('唤醒词模式需要至少一个唤醒词。')
    await request(`/accounts/${selectedBinding.value!.id}/groups/${id}`, { method: 'PUT', body: JSON.stringify({ mode: groupMode.value, keywords: groupMode.value === 'keyword' ? words : [] }) })
    groupId.value = ''
    keywords.value = ''
    notice.value = '已保存这个群的回复规则。'
  })
}

function removeGroup(bindingId: string, id: string) {
  void run(async () => {
    await request(`/accounts/${bindingId}/groups/${id}`, { method: 'DELETE' })
    notice.value = '已恢复为该 QQ 小号的默认规则。'
  })
}

let refreshTimer: ReturnType<typeof setInterval> | undefined
onMounted(() => {
  cardStore.initialize()
  void load().then(() => loadMemory())
  void loadVoices()
  refreshTimer = setInterval(() => {
    if (!busy.value && !loading.value)
      void load()
  }, 10_000)
})
onUnmounted(() => {
  if (refreshTimer)
    clearInterval(refreshTimer)
})
watch(() => auth.isAuthenticated, (authenticated) => {
  if (authenticated)
    void load().then(() => loadMemory())
})
</script>

<template>
  <main class="mx-auto max-w-xl px-2 pb-14 text-neutral-900 space-y-5 dark:text-neutral-100">
    <header class="pt-2 space-y-1">
      <p class="text-xs text-sky-600 font-semibold tracking-widest dark:text-sky-300">
        QQ · 人格接入
      </p>
      <h1 class="text-xl font-semibold">
        QQ 小号与群聊
      </h1>
      <p class="text-sm text-neutral-500 leading-6 dark:text-neutral-400">
        每个小号可绑定一个人格。私聊直接回复，群聊默认被 @ 时回复。
      </p>
      <p class="text-xs text-neutral-500 leading-5 dark:text-neutral-400">
        选好人格后在这里接入小号。登录二维码、连接状态和重新授权会在手机与桌面同步。
      </p>
      <button type="button" :disabled="loading" class="text-xs text-sky-700 dark:text-sky-300 disabled:opacity-50" @click="load">
        {{ loading ? '正在刷新…' : '刷新账号与连接状态' }}
      </button>
    </header>

    <p v-if="!auth.isAuthenticated" class="rounded-2xl bg-amber-50 p-4 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
      登录后即可管理你的 QQ 小号。
    </p>
    <template v-else>
      <p v-if="error" role="alert" class="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
        {{ error }}
      </p>
      <p v-if="accountError" role="alert" class="rounded-2xl bg-rose-50 p-3 text-sm text-rose-700 dark:bg-rose-950/40 dark:text-rose-200">
        {{ accountError }}
      </p>
      <p v-if="memoryError" role="status" class="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/40 dark:text-amber-200">
        {{ memoryError }}
      </p>
      <p v-if="notice" role="status" class="rounded-2xl bg-sky-50 p-3 text-sm text-sky-700 dark:bg-sky-950/40 dark:text-sky-200">
        {{ notice }}
      </p>

      <section v-if="qqDiaries.length" class="border border-neutral-200 rounded-3xl bg-white/80 p-4 shadow-sm space-y-3 dark:border-white/10 dark:bg-white/5">
        <div class="flex items-center justify-between gap-3">
          <h2 class="text-sm font-semibold">
            QQ 角色日记
          </h2>
          <RouterLink to="/settings/memory/diary" class="text-xs text-sky-700 dark:text-sky-300">
            前往日记
          </RouterLink>
        </div>
        <details v-for="entry in qqDiaries.slice(0, 5)" :key="entry.id" class="border border-neutral-200/80 rounded-2xl p-3 dark:border-white/10">
          <summary class="cursor-pointer text-sm font-medium">
            {{ String(entry.metadata.diaryTitle || '未命名日记') }} <span class="ml-2 text-xs text-neutral-500">{{ new Date(entry.recordedAt).toLocaleDateString() }}</span>
          </summary>
          <p class="mt-3 whitespace-pre-wrap text-sm text-neutral-600 leading-6 dark:text-neutral-300">
            {{ entry.text }}
          </p>
        </details>
      </section>

      <section class="border border-neutral-200 rounded-3xl bg-white/80 p-4 shadow-sm space-y-3 dark:border-white/10 dark:bg-white/5">
        <h2 class="font-semibold">
          接入 QQ 小号
        </h2>
        <div class="space-y-2">
          <p class="text-xs text-neutral-500 dark:text-neutral-400">
            选择这个 QQ 号使用的本机角色卡
          </p>
          <QqCharacterPicker :characters="characters" :selected-id="characterId" :disabled="busy" @select="characterId = $event" />
        </div>
        <button :disabled="busy || loading || !autoConnectAvailable" class="w-full rounded-xl bg-sky-600 px-4 py-3 text-sm text-white font-semibold disabled:opacity-50" @click="connectQq">
          {{ autoConnectAvailable ? '申请接入 QQ 小号' : '接入暂不可用' }}
        </button>
        <p class="text-xs text-neutral-500 leading-5 dark:text-neutral-400">
          系统会自动分配连接并识别登录的 QQ 号。你只需在 QQ 中扫码确认。
        </p>
      </section>

      <section v-for="item in connectRequests" :key="item.id" class="border border-neutral-200 rounded-3xl bg-white/80 p-4 shadow-sm space-y-3 dark:border-white/10 dark:bg-white/5">
        <h2 class="font-semibold">
          正在接入 QQ
        </h2>
        <p v-if="item.status === 'queued'" class="text-sm text-neutral-600 dark:text-neutral-300">
          正在等待空闲连接器。资源准备好后会自动出现二维码，离开此页也不会取消申请。
        </p>
        <p v-if="item.status === 'queued' && Date.now() - new Date(item.createdAt).getTime() > 60_000" class="text-xs text-amber-700 leading-5 dark:text-amber-300">
          等待已超过 1 分钟，当前可能没有可用连接器。你可以继续等待或取消申请；重新申请不会加快分配。
        </p>
        <p v-else-if="item.status === 'waiting_for_authorization'" class="text-sm text-neutral-600 dark:text-neutral-300">
          请使用你要接入的小号扫码，并在 QQ 中确认登录。
        </p>
        <p v-else-if="item.status === 'failed'" class="text-sm text-rose-700 dark:text-rose-300">
          这个 QQ 号已被其他账号绑定。本次接入未生效，请更换小号后重试。
        </p>
        <QqLoginQr v-if="item.qrcode && item.status === 'waiting_for_authorization'" :value="item.qrcode" />
        <div class="flex flex-wrap gap-3">
          <button v-if="item.status === 'waiting_for_authorization'" type="button" :disabled="busy" class="text-xs text-sky-700 dark:text-sky-300 disabled:opacity-50" @click="refreshConnectQr(item.id)">
            重新获取二维码
          </button>
          <button type="button" :disabled="busy" class="text-xs text-neutral-500 disabled:opacity-50" @click="cancelConnect(item.id)">
            {{ item.status === 'failed' ? '移除此提示' : '取消接入' }}
          </button>
        </div>
      </section>

      <p v-if="!bindings.length" class="text-xs text-neutral-500 leading-5 dark:text-neutral-400">
        接入成功后，这里会显示每个 QQ 小号的三端记忆同步、表情素材库、主动语音和群聊设置。手机普通聊天的记忆与语音设置无需接入 QQ。
      </p>

      <section v-for="binding in bindings" :key="binding.id" class="border border-neutral-200 rounded-3xl bg-white/80 p-4 shadow-sm space-y-3 dark:border-white/10 dark:bg-white/5">
        <div class="flex items-start justify-between gap-3">
          <div>
            <h2 class="font-semibold">
              QQ {{ binding.selfId }}
            </h2>
            <p class="text-xs text-neutral-500">
              {{ nameFor(binding.characterId, binding.personaName) }}
            </p>
          </div>
          <span class="rounded-full px-2.5 py-1 text-xs" :class="binding.status === 'active' ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300'">{{ binding.status === 'active' ? '已接入' : '等待扫码接入' }}</span>
        </div>
        <p class="text-xs" :class="binding.online ? 'text-emerald-600 dark:text-emerald-300' : binding.connectionState === 'authorization_required' ? 'text-amber-700 dark:text-amber-300' : 'text-neutral-500'">
          {{ binding.online ? '● QQ 在线' : binding.connectionState === 'authorization_required' ? '● QQ 需要扫码授权，自动回复已暂停' : binding.connectionState === 'reconnecting' ? '○ 连接中断，正在尝试恢复' : '○ 尚未收到接入器状态' }}
        </p>
        <p v-if="!binding.online" class="text-xs text-amber-700 leading-5 dark:text-amber-300">
          同一个 QQ 小号断线后直接扫码重连，原有回复设置和收藏表情会保留。
        </p>
        <QqLoginQr v-if="binding.loginQrUrl && binding.connectionState === 'authorization_required'" :value="binding.loginQrUrl" />
        <div class="flex flex-wrap gap-2">
          <button type="button" :disabled="loading" class="border border-neutral-200 rounded-xl px-3 py-2 text-xs dark:border-white/15 disabled:opacity-50" @click="load">
            检查连接
          </button>
          <button v-if="!binding.online && binding.connectionUpdatedAt" type="button" :disabled="busy" class="border border-amber-200 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:border-amber-300/20 dark:bg-amber-300/10 dark:text-amber-200 disabled:opacity-50" @click="requestReauth(binding)">
            重新获取二维码
          </button>
        </div>
        <div class="border border-neutral-200/80 rounded-xl bg-neutral-50/70 p-3 space-y-2 dark:border-white/10 dark:bg-white/5">
          <p class="text-xs text-neutral-500 leading-5 dark:text-neutral-400">
            仅换成另一个 QQ 号时才解除绑定；解除会删除这个小号的回复设置和表情标注。
          </p>
          <div class="flex flex-wrap items-center gap-3">
            <button type="button" :disabled="busy" class="text-xs text-rose-600 font-medium dark:text-rose-300 disabled:opacity-50" @click="removeAccount(binding)">
              {{ removeConfirmId === binding.id ? '确认解除并更换' : '更换 QQ 小号' }}
            </button>
            <button v-if="removeConfirmId === binding.id" type="button" class="text-xs text-neutral-500" @click="removeConfirmId = ''">
              取消
            </button>
          </div>
        </div>
        <div v-if="binding.status === 'pending'" class="rounded-2xl bg-sky-50/80 p-3 space-y-2 dark:bg-sky-300/10">
          <p class="text-xs text-sky-900 leading-5 dark:text-sky-100">
            这是旧版尚未完成的接入记录。按上方所选角色卡申请扫码接入；登录同一个 QQ 小号后会自动完成绑定，无需配对码。
          </p>
          <button type="button" :disabled="busy || !autoConnectAvailable" class="rounded-xl bg-sky-600 px-3 py-2 text-xs text-white font-semibold disabled:opacity-50" @click="connectQq">
            {{ autoConnectAvailable ? '申请扫码接入' : '扫码接入暂不可用' }}
          </button>
        </div>
        <div class="space-y-2">
          <button
            type="button"
            class="w-full flex items-center justify-between border border-neutral-200 rounded-xl px-3 py-2 text-left dark:border-white/15"
            :aria-expanded="editingCharacterBindingId === binding.id"
            @click="editingCharacterBindingId = editingCharacterBindingId === binding.id ? '' : binding.id"
          >
            <span class="text-xs text-neutral-500 dark:text-neutral-400">角色卡 <strong class="ml-1 text-sm text-neutral-900 dark:text-white">{{ nameFor(binding.characterId, binding.personaName) }}</strong></span>
            <span class="text-xs text-sky-700 dark:text-sky-300">{{ editingCharacterBindingId === binding.id ? '收起' : '更换' }}</span>
          </button>
          <QqCharacterPicker
            v-if="editingCharacterBindingId === binding.id"
            :characters="characters"
            :selected-id="binding.characterId"
            :disabled="busy"
            @select="selectBoundCharacter(binding, $event)"
          />
          <label v-if="binding.characterId.startsWith('local:')" class="block border border-neutral-200 rounded-xl px-3 py-3 space-y-2 dark:border-white/15">
            <span class="block text-sm font-medium">这台设备对应的角色卡</span>
            <span class="block text-xs text-neutral-500 dark:text-neutral-400">若手机和电脑分别导入了同一角色，请在每台设备各选一次。此处只关联本机记忆，不会更换 QQ 人格。</span>
            <select
              :value="memoryCardIds[binding.characterId.slice(6)] || ''"
              :disabled="busy"
              class="w-full border border-neutral-200 rounded-xl bg-transparent px-3 py-2 text-sm text-neutral-900 dark:border-white/15 dark:text-white"
              @change="selectMemoryCard(binding, ($event.target as HTMLSelectElement).value)"
            >
              <option value="" disabled>请选择本机角色卡</option>
              <option v-for="card in characters" :key="card.id" :value="card.id.slice(6)">{{ card.i18n?.[0]?.name || '未命名人格' }}</option>
            </select>
          </label>
          <div v-if="memoryConflicts[binding.characterId.slice(6)]?.length" class="border border-amber-300/70 rounded-xl bg-amber-50/70 p-3 space-y-3 dark:border-amber-400/30 dark:bg-amber-300/10">
            <p class="text-sm text-amber-900 font-medium dark:text-amber-100">
              有 {{ memoryConflicts[binding.characterId.slice(6)].length }} 条记忆需要选择版本
            </p>
            <div v-for="conflict in memoryConflicts[binding.characterId.slice(6)]" :key="conflict.id" class="rounded-lg bg-white/80 p-3 space-y-2 dark:bg-neutral-900/60">
              <p class="text-xs text-neutral-500">
                本机版本
              </p>
              <p class="max-h-24 overflow-auto whitespace-pre-wrap text-sm">
                {{ conflict.localText ?? '已删除' }}
              </p>
              <p class="text-xs text-neutral-500">
                云端版本
              </p>
              <p class="max-h-24 overflow-auto whitespace-pre-wrap text-sm">
                {{ conflict.remote.deletedAt ? '已删除' : conflict.remote.text }}
              </p>
              <div class="flex flex-wrap gap-2 pt-1">
                <button type="button" :disabled="busy || !memoryEnabledIds.includes(binding.characterId.slice(6))" class="border border-neutral-300 rounded-lg px-3 py-1.5 text-xs dark:border-white/20 disabled:opacity-50" @click="resolveMemoryConflict(binding, conflict.id, 'local')">
                  保留本机
                </button>
                <button type="button" :disabled="busy || !memoryEnabledIds.includes(binding.characterId.slice(6))" class="rounded-lg bg-sky-600 px-3 py-1.5 text-xs text-white disabled:opacity-50" @click="resolveMemoryConflict(binding, conflict.id, 'remote')">
                  采用云端
                </button>
              </div>
            </div>
          </div>
          <div v-if="binding.characterId.startsWith('local:')" class="flex items-center justify-between gap-3 border border-neutral-200 rounded-xl px-3 py-3 dark:border-white/15">
            <span class="space-y-1">
              <span class="block text-sm font-medium">三端记忆同步</span>
              <span class="block text-xs text-neutral-500 dark:text-neutral-400">{{ memoryEnabledIds.includes(binding.characterId.slice(6)) ? '已开启' : '已暂停' }}。{{ memoryCardIds[binding.characterId.slice(6)] ? '此设备角色卡已关联。' : '此设备尚未关联角色卡，本机记忆不会同步到 QQ。' }}在记忆界面逐条选择可供 QQ 使用的内容；私人记忆不会自动公开。</span>
            </span>
            <RouterLink to="/settings/modules/memory-long-term" class="shrink-0 text-xs text-sky-700 dark:text-sky-300">
              记忆设置
            </RouterLink>
          </div>
          <RouterLink to="/settings/system/qq-memory" class="block border border-sky-300/60 rounded-xl p-3 text-sm text-sky-700 font-medium dark:text-sky-300">
            管理 QQ 记忆、日记与近期上下文 →
          </RouterLink>
          <button v-if="binding.characterId.startsWith('local:')" type="button" :disabled="busy || !memoryCardIds[binding.characterId.slice(6)]" class="text-xs text-sky-700 dark:text-sky-300 disabled:opacity-50" @click="syncBoundCharacter(binding)">
            同步本机角色卡的最新设定
          </button>
        </div>
        <label class="block text-xs text-neutral-500 space-y-1">群聊默认规则
          <select :value="binding.defaultGroupMode" class="w-full border border-neutral-200 rounded-xl bg-transparent px-3 py-2 text-sm text-neutral-900 dark:border-white/15 dark:text-white" @change="updateAccount(binding.id, { defaultGroupMode: ($event.target as HTMLSelectElement).value as Binding['defaultGroupMode'] })">
            <option value="mention">仅被 @ 时回复（推荐）</option>
            <option value="always">每条消息都回复</option>
            <option value="off">不在群聊回复</option>
          </select>
        </label>
        <label class="flex items-center justify-between gap-3 border border-neutral-200 rounded-xl px-3 py-3 dark:border-white/15">
          <span class="space-y-1">
            <span class="block text-sm font-medium">QQ 短期上下文</span>
            <span class="block text-xs text-neutral-500 dark:text-neutral-400">每个私聊和群聊分别计算；此设置不影响应用内聊天。内容过长时会按字数上限收缩，长度越高可能增加模型费用。</span>
          </span>
          <select :value="binding.contextTurnLimit" :disabled="busy" class="shrink-0 border border-neutral-200 rounded-lg bg-transparent px-2 py-1.5 text-sm dark:border-white/15" @change="updateAccount(binding.id, { contextTurnLimit: Number(($event.target as HTMLSelectElement).value) })">
            <option v-for="count in [12, 24, 40, 60, 80]" :key="count" :value="count">{{ count }} 条</option>
          </select>
        </label>
        <label class="flex items-center justify-between gap-3 border border-neutral-200 rounded-xl px-3 py-3 dark:border-white/15">
          <span class="space-y-1">
            <span class="block text-sm font-medium">QQ 自动日记</span>
            <span class="block text-xs text-neutral-500 dark:text-neutral-400">同一私聊或群聊当天有足够互动时最多生成一篇。单独使用聊天模型并按实际用量扣点；未生成有效日记会返还该次模型费用。</span>
          </span>
          <input type="checkbox" :checked="binding.diaryEnabled" :disabled="busy" class="size-5 shrink-0 accent-sky-600" @change="updateAccount(binding.id, { diaryEnabled: ($event.target as HTMLInputElement).checked })">
        </label>
        <label class="flex items-center justify-between gap-3 border border-neutral-200 rounded-xl px-3 py-3 dark:border-white/15">
          <span class="space-y-1">
            <span class="block text-sm font-medium">QQ 联网搜索</span>
            <span class="block text-xs text-neutral-500 dark:text-neutral-400">默认关闭。需要实时资料时，角色最多搜索一次并依据结果回复；搜索和后续模型回复会分别计费。</span>
          </span>
          <input type="checkbox" :checked="binding.webSearchEnabled" :disabled="busy" class="size-5 shrink-0 accent-sky-600" @change="updateAccount(binding.id, { webSearchEnabled: ($event.target as HTMLInputElement).checked })">
        </label>
        <p class="text-xs text-neutral-500 dark:text-neutral-400">
          从 QQ 同步收藏表情后，可在下方填写描述和情绪标签，供同一角色在 QQ、桌面和手机上选择使用。
        </p>
        <label class="flex items-center justify-between gap-3 border border-neutral-200 rounded-xl px-3 py-3 text-sm dark:border-white/15">
          <span>
            <span class="block font-medium">表情包使用倾向</span>
            <span class="block text-xs text-neutral-500">0% 为关闭；其他数值作为角色偏好，不随机拦截每轮能力</span>
          </span>
          <select :value="binding.stickerFrequency" :disabled="busy" class="border border-neutral-200 rounded-lg bg-transparent px-2 py-1 text-sm dark:border-white/15" @change="updateAccount(binding.id, { stickerFrequency: Number(($event.target as HTMLSelectElement).value) })">
            <option v-for="frequency in [0, 10, 25, 50, 75, 100]" :key="frequency" :value="frequency">{{ frequency }}%</option>
          </select>
        </label>
        <div class="border border-neutral-200 rounded-2xl p-3 space-y-3 dark:border-white/15">
          <label class="flex items-center justify-between gap-3">
            <span>
              <span class="block text-sm font-medium">听懂收到的 QQ 语音</span>
              <span class="block text-xs text-neutral-500 dark:text-neutral-400">开启后收到语音会先转写，再交给角色回复；语音识别按时长计费，可随时关闭。</span>
            </span>
            <input type="checkbox" :checked="binding.voiceInputEnabled" :disabled="busy" class="size-5 shrink-0 accent-sky-600" @change="updateAccount(binding.id, { voiceInputEnabled: ($event.target as HTMLInputElement).checked })">
          </label>
          <div class="border-t border-neutral-200 dark:border-white/15" />
          <label class="flex items-center justify-between gap-3">
            <span>
              <span class="block text-sm font-medium">QQ 主动语音</span>
              <span class="block text-xs text-neutral-500">默认关闭。开启后仅在角色认为适合时合成语音，按当前语音价格计费。</span>
            </span>
            <input type="checkbox" :checked="binding.voiceMode === 'auto'" :disabled="busy" class="size-5 shrink-0 accent-sky-600" @change="updateAccount(binding.id, { voiceMode: ($event.target as HTMLInputElement).checked ? 'auto' : 'off' })">
          </label>
          <div class="grid grid-cols-2 gap-2">
            <label class="text-xs text-neutral-500 space-y-1">声线
              <select :value="binding.voiceId || ''" :disabled="busy" class="w-full border border-neutral-200 rounded-lg bg-transparent px-2 py-2 text-sm text-neutral-900 dark:border-white/15 dark:text-white" @change="updateAccount(binding.id, { voiceId: ($event.target as HTMLSelectElement).value || null })">
                <option value="">未选择</option>
                <option v-for="voice in officialVoices" :key="voice.voiceId" :value="voice.voiceId">{{ voice.nameZh }}</option>
              </select>
            </label>
            <label class="text-xs text-neutral-500 space-y-1">使用倾向
              <select :value="binding.voiceFrequency" :disabled="busy" class="w-full border border-neutral-200 rounded-lg bg-transparent px-2 py-2 text-sm text-neutral-900 dark:border-white/15 dark:text-white" @change="updateAccount(binding.id, { voiceFrequency: Number(($event.target as HTMLSelectElement).value) })">
                <option v-for="frequency in [0, 10, 25, 50, 75, 100]" :key="frequency" :value="frequency">{{ frequency }}%</option>
              </select>
            </label>
          </div>
          <p v-if="binding.voiceMode === 'auto' && !binding.voiceId" class="text-xs text-amber-700 dark:text-amber-300">
            选择声线后才能发送 QQ 语音。
          </p>
        </div>
        <div class="border border-neutral-200 rounded-2xl p-3 space-y-3 dark:border-white/15">
          <label class="flex items-center justify-between gap-3">
            <span>
              <span class="block text-sm font-medium">真实回复</span>
              <span class="block text-xs text-neutral-500 dark:text-neutral-400">由角色按情境决定立即回复、稍后回复或跳过，默认关闭。跳过的回合返还本轮 QQ 回复及关联识别点数。</span>
            </span>
            <input type="checkbox" :checked="binding.realReplyEnabled" :disabled="busy" class="size-5 shrink-0 accent-sky-600" @change="updateAccount(binding.id, { realReplyEnabled: ($event.target as HTMLInputElement).checked })">
          </label>
          <template v-if="binding.realReplyEnabled">
            <label class="flex items-center justify-between gap-3 text-sm">
              <span>最长等待</span>
              <select :value="binding.realReplyMaxDelaySeconds" :disabled="busy" class="border border-neutral-200 rounded-lg bg-transparent px-2 py-1.5 dark:border-white/15" @change="updateAccount(binding.id, { realReplyMaxDelaySeconds: Number(($event.target as HTMLSelectElement).value) })">
                <option v-for="seconds in [30, 120, 300, 900, 3600, 86400]" :key="seconds" :value="seconds">{{ seconds < 60 ? `${seconds} 秒` : seconds < 3600 ? `${seconds / 60} 分钟` : `${seconds / 3600} 小时` }}</option>
              </select>
            </label>
            <label class="flex items-center justify-between gap-3 text-sm">
              <span>好友看到“正在输入中”</span>
              <input type="checkbox" :checked="binding.typingStatusEnabled" :disabled="busy" class="size-5 shrink-0 accent-sky-600" @change="updateAccount(binding.id, { typingStatusEnabled: ($event.target as HTMLInputElement).checked })">
            </label>
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              仅在准备发送私聊回复时尝试显示；实际能否出现取决于 QQ 接入器和好友客户端。长时间等待或决定不回时不会显示。
            </p>
          </template>
          <label class="flex items-center justify-between gap-3 border-t border-neutral-200 pt-3 dark:border-white/15">
            <span>
              <span class="block text-sm font-medium">QQ 原生语音电话</span>
              <span class="block text-xs text-neutral-500 leading-5 dark:text-neutral-400">测试能力，默认关闭。需同时开启真实回复并选择声线，接入器支持原生电话时角色才可在私聊中谨慎主动拨号，接通后可说话、停顿和挂断。每位联系人至少间隔 1 小时；模型、语音识别与合成会按实际调用计费。</span>
            </span>
            <input type="checkbox" :checked="binding.nativeCallEnabled" :disabled="busy || !binding.realReplyEnabled || !binding.voiceId" class="size-5 shrink-0 accent-sky-600" @change="updateAccount(binding.id, { nativeCallEnabled: ($event.target as HTMLInputElement).checked })">
          </label>
          <p class="text-xs leading-5" :class="binding.nativeCallCapability === 'ready' && binding.nativeCallEnabled ? 'text-emerald-700 dark:text-emerald-300' : 'text-amber-700 dark:text-amber-300'">
            电话状态：{{ callAvailability(binding) }}
          </p>
          <p class="text-xs text-neutral-500 leading-5 dark:text-neutral-400">
            立即回复或稍后成功发送，按实际使用的回复、图片识别、联网搜索和语音分别计费；等待期间不重复生成。选择不回复，或整条回复发送失败，会返还该回合已结算的回复及关联能力点数。若语音发送失败但文字发出，仅返还语音点数。单独导入表情时的 AI 识别属于独立请求。
          </p>
        </div>
        <div class="border border-neutral-200 rounded-2xl p-3 space-y-3 dark:border-white/15">
          <label class="flex items-center justify-between gap-3">
            <span>
              <span class="block text-sm font-medium">QQ 主动话题</span>
              <span class="block text-xs text-neutral-500 leading-5 dark:text-neutral-400">默认关闭。只向最近 30 天聊过的私聊联系人发起话题，群聊不会主动发。每次生成按普通 QQ 回复计费。</span>
            </span>
            <input type="checkbox" :checked="binding.proactiveEnabled" :disabled="busy" class="size-5 shrink-0 accent-sky-600" @change="updateAccount(binding.id, { proactiveEnabled: ($event.target as HTMLInputElement).checked, proactiveTimezoneOffset: -new Date().getTimezoneOffset() })">
          </label>
          <div v-if="binding.proactiveEnabled" class="grid grid-cols-2 gap-2">
            <label class="text-xs text-neutral-500 space-y-1">最短间隔
              <select :value="binding.proactiveIntervalHours" :disabled="busy" class="w-full border border-neutral-200 rounded-lg bg-transparent px-2 py-2 text-sm text-neutral-900 dark:border-white/15 dark:text-white" @change="updateAccount(binding.id, { proactiveIntervalHours: Number(($event.target as HTMLSelectElement).value) })">
                <option v-for="hours in [1, 3, 6, 12, 24]" :key="hours" :value="hours">{{ hours }} 小时</option>
              </select>
            </label>
            <label class="text-xs text-neutral-500 space-y-1">允许时段
              <span class="flex items-center gap-1">
                <select :value="binding.proactiveStartHour" :disabled="busy" aria-label="主动话题开始时间" class="min-w-0 w-full border border-neutral-200 rounded-lg bg-transparent px-1 py-2 text-sm text-neutral-900 dark:border-white/15 dark:text-white" @change="updateAccount(binding.id, { proactiveStartHour: Number(($event.target as HTMLSelectElement).value), proactiveTimezoneOffset: -new Date().getTimezoneOffset() })">
                  <option v-for="hour in 24" :key="hour" :value="hour - 1">{{ String(hour - 1).padStart(2, '0') }}:00</option>
                </select>
                <span>至</span>
                <select :value="binding.proactiveEndHour" :disabled="busy" aria-label="主动话题结束时间" class="min-w-0 w-full border border-neutral-200 rounded-lg bg-transparent px-1 py-2 text-sm text-neutral-900 dark:border-white/15 dark:text-white" @change="updateAccount(binding.id, { proactiveEndHour: Number(($event.target as HTMLSelectElement).value), proactiveTimezoneOffset: -new Date().getTimezoneOffset() })">
                  <option v-for="hour in 24" :key="hour" :value="hour - 1">{{ String(hour - 1).padStart(2, '0') }}:00</option>
                </select>
              </span>
            </label>
          </div>
          <p v-if="binding.proactiveEnabled" class="text-xs text-neutral-500 leading-5 dark:text-neutral-400">
            按当前设备时区执行。仅在对方一段时间没有发消息、QQ 在线时尝试；每个小号最多按所选间隔发起一次。
          </p>
        </div>
        <div class="border border-neutral-200 rounded-2xl p-3 space-y-3 dark:border-white/15">
          <button type="button" class="w-full flex items-center justify-between text-sm font-medium" :aria-expanded="stickerBindingId === binding.id" @click="toggleStickerLibrary(binding.id)">
            <span>表情素材库</span>
            <span class="text-xs text-sky-700 dark:text-sky-300">{{ stickerBindingId === binding.id ? '收起' : '查看与管理' }}</span>
          </button>
          <template v-if="stickerBindingId === binding.id">
            <p class="text-xs text-neutral-500 dark:text-neutral-400">
              图片沿用 QQ 收藏，只同步链接、描述和标签。填写描述后模型才能选用；手动填写免费，AI 识别按当前视觉识别价格逐张扣点。每个小号最多 48 张。
            </p>
            <label class="flex items-center gap-2 text-xs text-neutral-600 dark:text-neutral-300">
              <input v-model="stickerAutoAnalyze" type="checkbox" class="size-4 accent-sky-600">
              从 QQ 同步时自动识别描述和情绪标签（默认关闭，逐张扣点）
            </label>
            <div class="rounded-xl bg-neutral-100/70 p-2 text-xs space-y-2 dark:bg-white/5">
              <p>可从当前 QQ 小号同步已有自定义表情。关闭上方选项时不扣识别点数，但需要手动补充描述；开启时每张新表情单独计费，失败后仍可手动填写。</p>
              <button type="button" :disabled="busy || binding.stickerImportStatus === 'pending'" class="rounded-lg bg-neutral-800 px-3 py-2 text-white dark:bg-white dark:text-neutral-900 disabled:opacity-50" @click="syncQqStickers(binding.id)">
                从 QQ 同步
              </button>
              <p v-if="binding.stickerImportStatus === 'pending'" class="text-sky-700 dark:text-sky-300">
                正在等待在线小号同步，完成后这里会显示结果。
              </p>
              <p v-else-if="binding.stickerImportStatus === 'complete'">
                上次同步：导入 {{ binding.stickerImportCount }} 张，跳过 {{ binding.stickerImportSkipped }} 张。
              </p>
              <p v-else-if="binding.stickerImportStatus === 'failed'" class="text-rose-600">
                同步失败。请检查 QQ 是否在线或稍后重试。
              </p>
            </div>
            <p v-if="!stickerAssets.length" class="text-xs text-neutral-500">
              还没有同步 QQ 收藏表情。请先在 QQ 里收藏，再点“从 QQ 同步”。
            </p>
            <div v-for="asset in stickerAssets" :key="asset.id" class="flex flex-wrap items-center gap-3 rounded-xl bg-neutral-100/70 p-2 dark:bg-white/5">
              <img :src="asset.imageData" :alt="asset.description" class="size-14 shrink-0 rounded-lg object-contain">
              <div class="min-w-0 flex-1">
                <input :value="asset.description" maxlength="300" aria-label="表情描述" class="w-full border border-neutral-200 rounded-lg bg-transparent px-2 py-1 text-xs font-medium dark:border-white/15" @change="updateSticker(binding.id, asset.id, { description: ($event.target as HTMLInputElement).value })">
                <input :value="asset.emotionTags?.join('、') || ''" maxlength="40" aria-label="情绪标签" placeholder="情绪标签，如 开心、庆祝（最多 3 个）" class="mt-1 w-full border border-neutral-200 rounded-lg bg-transparent px-2 py-1 text-xs dark:border-white/15" @change="updateSticker(binding.id, asset.id, { emotionTags: parseEmotionTags(($event.target as HTMLInputElement).value) })">
                <p class="text-xs text-neutral-500">
                  已使用 {{ asset.useCount }} 次 · QQ 收藏
                </p>
                <input :value="asset.seriesTag" maxlength="60" placeholder="系列名称（选填）" class="mt-1 w-full border border-neutral-200 rounded-lg bg-transparent px-2 py-1 text-xs dark:border-white/15" @change="updateSticker(binding.id, asset.id, { seriesTag: ($event.target as HTMLInputElement).value })">
              </div>
              <div class="w-full flex justify-end gap-3">
                <button type="button" :disabled="busy" class="shrink-0 text-xs text-sky-700 dark:text-sky-300 disabled:opacity-50" @click="analyzeSticker(binding.id, asset.id)">
                  AI 重识别
                </button>
                <button type="button" :disabled="busy" class="shrink-0 text-xs text-amber-600 disabled:opacity-50" @click="updateSticker(binding.id, asset.id, { favorite: !asset.favorite })">
                  {{ asset.favorite ? '★ 已设偏爱' : '☆ 设为偏爱' }}
                </button>
                <button type="button" :disabled="busy" class="shrink-0 text-xs text-rose-600 disabled:opacity-50" @click="removeSticker(binding.id, asset.id)">
                  删除
                </button>
              </div>
            </div>
          </template>
        </div>
        <button class="text-xs text-sky-700 dark:text-sky-300" @click="selectedBindingId = binding.id">
          {{ selectedBindingId === binding.id ? '正在编辑此账号的群规则' : '编辑此账号的群规则' }}
        </button>
      </section>

      <section v-if="selectedBinding" class="border border-neutral-200 rounded-3xl bg-white/80 p-4 shadow-sm space-y-3 dark:border-white/10 dark:bg-white/5">
        <h2 class="font-semibold">
          QQ群单独设置 · {{ selectedBinding.selfId }}
        </h2>
        <p class="text-xs text-neutral-500">
          仅影响这个 QQ 小号所在的群。
        </p>
        <div v-for="policy in selectedBinding.groups" :key="policy.groupId" class="flex items-center justify-between rounded-xl bg-neutral-100/80 px-3 py-2 text-sm dark:bg-white/5">
          <span>{{ policy.groupId }} · {{ { mention: '被 @', keyword: '唤醒词', always: '每条消息', off: '不回复' }[policy.mode] }}</span>
          <button class="text-xs text-neutral-500" @click="removeGroup(selectedBinding.id, policy.groupId)">
            恢复默认
          </button>
        </div>
        <input v-model="groupId" inputmode="numeric" placeholder="群号" class="w-full border border-neutral-200 rounded-xl bg-transparent px-3 py-3 text-sm dark:border-white/15">
        <select v-model="groupMode" class="w-full border border-neutral-200 rounded-xl bg-transparent px-3 py-3 text-sm dark:border-white/15">
          <option value="mention">
            仅被 @ 时回复
          </option>
          <option value="keyword">
            唤醒词触发
          </option>
          <option value="always">
            每条消息都回复
          </option>
          <option value="off">
            不回复
          </option>
        </select>
        <input v-if="groupMode === 'keyword'" v-model="keywords" placeholder="唤醒词，多个用逗号分隔" class="w-full border border-neutral-200 rounded-xl bg-transparent px-3 py-3 text-sm dark:border-white/15">
        <button :disabled="busy" class="w-full rounded-xl bg-sky-600 px-4 py-3 text-sm text-white font-semibold disabled:opacity-50" @click="saveGroup">
          保存群规则
        </button>
      </section>
    </template>
  </main>
</template>
