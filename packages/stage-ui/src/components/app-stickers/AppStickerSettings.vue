<script setup lang="ts">
import type { AppSticker, AppStickerLibrary } from '../../stores/chat/app-stickers'

import { storeToRefs } from 'pinia'
import { computed, onMounted, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

import { getOfficialApiFetch, SERVER_URL } from '../../libs/auth'
import { addAppSticker, loadAppStickerLibrary, removeAppSticker, saveAppStickerLibrary, updateAppSticker } from '../../stores/chat/app-stickers'
import { useAiriCardStore } from '../../stores/modules/airi-card'

interface QqBinding {
  id: string
  selfId: string
  status: string
  online: boolean
  stickerImportStatus: 'idle' | 'pending' | 'complete' | 'failed'
}
interface QqSticker { imageData: string, description: string, emotionTags?: string[], seriesTag?: string, favorite?: boolean }

const { locale } = useI18n()
const label = (zh: string, en: string) => locale.value.startsWith('zh') ? zh : en
const cardStore = useAiriCardStore()
const { cards, activeCardId } = storeToRefs(cardStore)
const characterId = ref('')
const library = ref<AppStickerLibrary>({ stickers: [], stickerFrequency: 25 })
const bindings = ref<QqBinding[]>([])
const selectedBindingId = ref('')
const bindingLoadError = ref('')
const bindingLoading = ref(false)
const busy = ref(false)
const error = ref('')
const notice = ref('')
const picker = ref<HTMLInputElement>()
const characters = computed(() => [...cards.value.entries()].map(([id, card]) => ({ id, name: card.name || id })))

async function load() {
  if (!characterId.value)
    return
  library.value = await loadAppStickerLibrary(characterId.value)
}

async function run(task: () => Promise<void>) {
  if (busy.value)
    return
  busy.value = true
  error.value = ''
  notice.value = ''
  try {
    await task()
  }
  catch (cause) {
    error.value = cause instanceof Error ? cause.message : String(cause)
  }
  finally {
    busy.value = false
  }
}

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result || ''))
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

function importFiles(event: Event) {
  const input = event.target as HTMLInputElement
  const files = Array.from(input.files ?? [])
  input.value = ''
  void run(async () => {
    for (const file of files) {
      if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 2 * 1024 * 1024)
        throw new Error(label('请选择不超过 2 MB 的 PNG、JPEG、WebP 或 GIF 图片', 'Choose a PNG, JPEG, WebP or GIF image under 2 MB'))
      await addAppSticker(characterId.value, await readFile(file), file.name.replace(/\.[^.]+$/, ''))
    }
    await load()
    notice.value = label(`已导入 ${files.length} 张图片`, `Imported ${files.length} images`)
  })
}

function saveFrequency() {
  void run(async () => {
    library.value.stickerFrequency = Math.max(0, Math.min(100, Number(library.value.stickerFrequency)))
    await saveAppStickerLibrary(characterId.value, library.value)
  })
}

function saveSticker(sticker: AppSticker) {
  void run(async () => {
    await updateAppSticker(characterId.value, sticker.id, {
      description: sticker.description.trim().slice(0, 300),
      emotionTags: sticker.emotionTags.map(tag => tag.trim()).filter(Boolean).slice(0, 3),
      seriesTag: sticker.seriesTag.trim().slice(0, 60),
      favorite: sticker.favorite,
    })
    notice.value = label('已保存', 'Saved')
  })
}

function deleteSticker(sticker: AppSticker) {
  void run(async () => {
    await removeAppSticker(characterId.value, sticker.id)
    await load()
  })
}

function analyze(sticker: AppSticker) {
  void run(async () => {
    const response = await getOfficialApiFetch()(`${SERVER_URL}/api/qq/stickers/analyze`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ imageData: sticker.imageData }),
    })
    if (!response.ok)
      throw new Error(label('AI 描述暂不可用，请检查登录和视觉模型设置', 'AI description is unavailable; check sign-in and vision settings'))
    const result = await response.json() as { description: string, emotionTags: string[] }
    sticker.description = result.description
    sticker.emotionTags = result.emotionTags
    await updateAppSticker(characterId.value, sticker.id, result)
    notice.value = label('AI 描述已保存', 'AI description saved')
  })
}

async function loadBindings() {
  bindingLoading.value = true
  try {
    const response = await getOfficialApiFetch()(`${SERVER_URL}/api/qq/accounts`, {
      credentials: 'include',
      signal: AbortSignal.timeout(12_000),
    })
    if (!response.ok)
      throw new Error(label('QQ 账号读取失败，请检查登录状态后重试', 'Could not load QQ accounts; check sign-in and retry'))
    bindings.value = (await response.json() as QqBinding[]).filter(item => item.status === 'active')
    if (!bindings.value.some(item => item.id === selectedBindingId.value))
      selectedBindingId.value = bindings.value[0]?.id || ''
    bindingLoadError.value = ''
  }
  catch (cause) {
    bindingLoadError.value = cause instanceof Error ? cause.message : String(cause)
    throw cause
  }
  finally {
    bindingLoading.value = false
  }
}

async function readQqStickers(bindingId: string) {
  const response = await getOfficialApiFetch()(`${SERVER_URL}/api/qq/accounts/${encodeURIComponent(bindingId)}/stickers?limit=48`, {
    credentials: 'include',
    signal: AbortSignal.timeout(30_000),
  })
  if (!response.ok)
    throw new Error(label('读取 QQ 表情包失败', 'Could not read QQ stickers'))
  return await response.json() as QqSticker[]
}

async function waitForQqSync(bindingId: string) {
  for (let attempt = 0; attempt < 60; attempt++) {
    await new Promise(resolve => setTimeout(resolve, 3_000))
    await loadBindings()
    const binding = bindings.value.find(item => item.id === bindingId)
    if (!binding)
      throw new Error(label('QQ 小号已解除绑定', 'This QQ account is no longer linked'))
    if (binding.stickerImportStatus === 'complete')
      return
    if (binding.stickerImportStatus === 'failed')
      throw new Error(label('QQ 收藏表情同步失败，请在 QQ 小号设置页重试', 'QQ favorites sync failed; retry in QQ account settings'))
  }
  throw new Error(label('QQ 仍在同步收藏表情，请稍后再点导入', 'QQ is still syncing favorites; try importing again later'))
}

function importFromQq() {
  void run(async () => {
    const bindingId = selectedBindingId.value
    const targetCharacterId = characterId.value
    await loadBindings()
    const binding = bindings.value.find(item => item.id === bindingId)
    if (!binding || !targetCharacterId)
      throw new Error(label('请先选择角色并接入 QQ 小号', 'Select a character and connect a QQ account first'))
    if (binding.online) {
      if (binding.stickerImportStatus !== 'pending') {
        const response = await getOfficialApiFetch()(`${SERVER_URL}/api/qq/accounts/${encodeURIComponent(bindingId)}/stickers/sync`, {
          method: 'POST',
          credentials: 'include',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ autoAnalyze: false }),
          signal: AbortSignal.timeout(15_000),
        })
        if (!response.ok)
          throw new Error(label('请求 QQ 收藏表情同步失败', 'Could not start QQ favorites sync'))
      }
      notice.value = label('正在从 QQ 同步收藏表情，完成后会自动导入…', 'Syncing QQ favorites; they will be imported when ready…')
      await waitForQqSync(bindingId)
    }
    const items = await readQqStickers(bindingId)
    if (!items.length)
      throw new Error(label(binding.online ? 'QQ 收藏表情为空，请先在 QQ 中收藏图片' : 'QQ 当前离线且没有已同步的表情，请先重新连接 QQ', binding.online ? 'No QQ favorites found; save an image in QQ first' : 'QQ is offline and has no synced favorites; reconnect QQ first'))
    const existing = await loadAppStickerLibrary(targetCharacterId)
    const images = new Set(existing.stickers.map(item => item.imageData))
    let imported = 0
    let skipped = 0
    for (const item of items) {
      if (!/^data:image\/(?:png|jpeg|webp|gif);base64,/.test(item.imageData) || images.has(item.imageData) || existing.stickers.length + imported >= 48) {
        skipped++
        continue
      }
      await addAppSticker(targetCharacterId, item.imageData, item.description, {
        emotionTags: item.emotionTags,
        seriesTag: item.seriesTag,
        favorite: item.favorite,
      })
      images.add(item.imageData)
      imported += 1
    }
    await load()
    notice.value = label(`已从 QQ 导入 ${imported} 张${skipped ? `，跳过 ${skipped} 张重复或超出容量的表情` : ''}`, `Imported ${imported} from QQ${skipped ? `; skipped ${skipped} duplicates or over-limit items` : ''}`)
  })
}

watch(characterId, () => { void load() })
watch([characters, activeCardId], () => {
  if (!characters.value.some(item => item.id === characterId.value))
    characterId.value = characters.value.find(item => item.id === activeCardId.value)?.id || characters.value[0]?.id || ''
}, { immediate: true })
onMounted(() => { void loadBindings().catch(() => undefined) })
</script>

<template>
  <div class="mx-auto max-w-3xl min-w-0 w-full space-y-4 pb-8">
    <p class="text-sm opacity-70">
      {{ label('应用聊天使用独立的角色表情包库。模型会根据描述和语境决定是否发送，并选择放在回复前、段落之间或回复后。', 'App chat uses its own character sticker library. The model chooses whether to send one and can place it before, between paragraphs, or after a reply.') }}
    </p>
    <label class="block rounded-xl bg-[var(--airi-surface-card)] p-3 text-sm font-medium">
      {{ label('角色', 'Character') }}
      <select v-model="characterId" class="mt-2 w-full rounded-lg border border-neutral-300 bg-[var(--airi-surface-control)] p-2 text-[var(--airi-text)] dark:border-neutral-600" :disabled="busy">
        <option v-for="item in characters" :key="item.id" :value="item.id">{{ item.name }}</option>
      </select>
    </label>
    <label class="block text-sm font-medium">
      {{ label('模型发送频率', 'Model sticker frequency') }}：{{ library.stickerFrequency }}%
      <input v-model.number="library.stickerFrequency" type="range" min="0" max="100" step="5" class="mt-2 w-full" @change="saveFrequency">
    </label>
    <div class="flex flex-wrap items-center gap-2">
      <input ref="picker" type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden @change="importFiles">
      <button type="button" class="rounded-lg bg-sky-600 px-3 py-2 text-sm text-white disabled:opacity-50" :disabled="busy || !characterId" @click="picker?.click()">{{ label('导入图片', 'Import images') }}</button>
      <template v-if="bindings.length">
        <select v-model="selectedBindingId" class="max-w-full rounded-lg border border-neutral-300 bg-[var(--airi-surface-control)] p-2 text-sm text-[var(--airi-text)] dark:border-neutral-600" :disabled="busy">
          <option v-for="item in bindings" :key="item.id" :value="item.id">QQ {{ item.selfId }}</option>
        </select>
      </template>
      <button type="button" class="rounded-lg border border-sky-400 px-3 py-2 text-sm text-sky-700 disabled:opacity-50 dark:text-sky-300" :disabled="busy || bindingLoading || !selectedBindingId || !characterId" @click="importFromQq">{{ label('从 QQ 导入收藏表情', 'Import QQ favorites') }}</button>
      <span class="text-xs opacity-60">{{ library.stickers.length }}/48</span>
    </div>
    <p v-if="bindingLoadError" role="alert" class="text-sm text-red-600">{{ bindingLoadError }} <button type="button" class="underline" :disabled="bindingLoading" @click="loadBindings().catch(() => undefined)">{{ label('重试', 'Retry') }}</button></p>
    <p v-else-if="!bindingLoading && !bindings.length" class="text-sm opacity-70">{{ label('还没有已接入的 QQ 小号。', 'No QQ account is connected yet.') }} <RouterLink to="/settings/system/qq" class="text-sky-700 underline dark:text-sky-300">{{ label('前往 QQ 小号设置', 'Open QQ account settings') }}</RouterLink></p>
    <p v-if="error" role="alert" class="text-sm text-red-600">{{ error }}</p>
    <p v-if="notice" role="status" class="text-sm text-emerald-600">{{ notice }}</p>
    <div class="grid min-w-0 grid-cols-1 gap-3 md:grid-cols-2">
      <article v-for="sticker in library.stickers" :key="sticker.id" class="min-w-0 rounded-xl border border-neutral-200 bg-white/60 p-3 space-y-2 dark:border-neutral-700 dark:bg-black/20">
        <img :src="sticker.imageData" :alt="sticker.description" class="mx-auto h-28 max-w-full object-contain">
        <input v-model="sticker.description" maxlength="300" :aria-label="label('作用描述', 'Description')" :placeholder="label('作用描述与适用场景', 'Description and use case')" class="w-full rounded-lg border border-neutral-200 bg-transparent p-2 text-sm dark:border-neutral-700">
        <input :value="sticker.emotionTags.join(', ')" :aria-label="label('情绪标签', 'Emotion tags')" :placeholder="label('情绪标签，逗号分隔', 'Emotion tags, comma separated')" class="w-full rounded-lg border border-neutral-200 bg-transparent p-2 text-sm dark:border-neutral-700" @input="sticker.emotionTags = ($event.target as HTMLInputElement).value.split(/[,，]/).map(item => item.trim()).filter(Boolean)">
        <input v-model="sticker.seriesTag" maxlength="60" :aria-label="label('系列标签', 'Series tag')" :placeholder="label('系列标签', 'Series tag')" class="w-full rounded-lg border border-neutral-200 bg-transparent p-2 text-sm dark:border-neutral-700">
        <label class="flex items-center gap-2 text-xs"><input v-model="sticker.favorite" type="checkbox">{{ label('偏爱', 'Favorite') }}</label>
        <div class="flex flex-wrap gap-2">
          <button type="button" class="rounded-lg border px-2 py-1 text-xs" :disabled="busy" @click="saveSticker(sticker)">{{ label('保存', 'Save') }}</button>
          <button type="button" class="rounded-lg border px-2 py-1 text-xs" :disabled="busy" @click="analyze(sticker)">{{ label('AI 生成描述', 'AI describe') }}</button>
          <button type="button" class="rounded-lg border border-red-300 px-2 py-1 text-xs text-red-600" :disabled="busy" @click="deleteSticker(sticker)">{{ label('删除', 'Delete') }}</button>
        </div>
      </article>
    </div>
  </div>
</template>
