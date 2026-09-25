import type { BackgroundOption } from '@proj-airi/stage-ui/components'
import type { Ref, ShallowRef } from 'vue'

import localforage from 'localforage'

import { useChatAppearanceSettingsStore } from '@proj-airi/stage-ui/stores/settings/chat-appearance'
import { useTheme } from '@proj-airi/ui'
import { useLocalStorage, useObjectUrl } from '@vueuse/core'
import { defineStore } from 'pinia'
import { computed, markRaw, onScopeDispose, ref, shallowRef, watch } from 'vue'

import airiCompanionStudioDark from '../assets/backgrounds/airi-companion-studio-dark.jpg'
import airiCompanionStudioLight from '../assets/backgrounds/airi-companion-studio-light.jpg'
import airiMessageDark from '../assets/backgrounds/airi-message-dark.jpg'
import airiMessageLight from '../assets/backgrounds/airi-message-light.jpg'
import userMessageDark from '../assets/backgrounds/user-message-dark.jpg'
import userMessageLight from '../assets/backgrounds/user-message-light.jpg'

export enum BackgroundKind {
  Wave = 'wave',
  Image = 'image',
}

export interface BackgroundItem extends BackgroundOption {
  kind: BackgroundKind
  importedAt?: number
}

type PersistedBackgroundItem = Omit<BackgroundItem, 'file'> & {
  file?: Blob
}

type BackgroundPreferenceRecord = Record<string, Pick<BackgroundOption, 'id' | 'blur'>>

export const useBackgroundStore = defineStore('background', () => {
  // TODO: STORAGE_PREFIX used with multiple less maintainable `localforage` and `key.startsWith(...)` call that creates complexity.
  const STORAGE_PREFIX = 'background-'
  const SYNC_CHANNEL_NAME = 'airi-background-assets'
  const presets: BackgroundItem[] = [
    {
      id: 'airi-companion-studio-light',
      label: 'Wuwiii Starlight - Day',
      description: 'The default starlit background for light mode',
      kind: BackgroundKind.Image,
      src: airiCompanionStudioLight,
    },
    {
      id: 'airi-companion-studio-dark',
      label: 'Wuwiii Starlight - Night',
      description: 'The default starlit background for dark mode',
      kind: BackgroundKind.Image,
      src: airiCompanionStudioDark,
    },
    {
      id: 'airi-message-light',
      label: 'Wuwiii Message - Day',
      description: 'Cherry blossom and feather artwork for Wuwiii messages',
      kind: BackgroundKind.Image,
      src: airiMessageLight,
    },
    {
      id: 'airi-message-dark',
      label: 'Wuwiii Message - Night',
      description: 'Nighttime cherry blossom and feather artwork for Wuwiii messages',
      kind: BackgroundKind.Image,
      src: airiMessageDark,
    },
    {
      id: 'user-message-light',
      label: 'User Message - Day',
      description: 'A fresh anime-style pattern for user messages',
      kind: BackgroundKind.Image,
      src: userMessageLight,
    },
    {
      id: 'user-message-dark',
      label: 'User Message - Night',
      description: 'The matching nighttime pattern for user messages',
      kind: BackgroundKind.Image,
      src: userMessageDark,
    },
  ]

  const loading = ref(false)
  const galleryOptions = useLocalStorage<BackgroundPreferenceRecord>('settings/theme/background/gallery-options', {})
  const galleryId = useLocalStorage<string>('settings/theme/background/gallery-active', 'airi-companion-studio-light')
  const darkGalleryId = useLocalStorage<string>('settings/theme/background/gallery-dark-active', 'airi-companion-studio-dark')
  const { isDark } = useTheme()
  const chatAppearanceStore = useChatAppearanceSettingsStore()
  const storedOptions = ref<BackgroundItem[]>([])
  let reloadPending = false
  let syncChannel: BroadcastChannel | undefined

  const sampledColor = useLocalStorage<string>('settings/theme/background/sampled-color', '')
  const selectedId = computed({
    get: () => isDark.value && darkGalleryId.value ? darkGalleryId.value : galleryId.value,
    set: (value) => {
      if (isDark.value)
        darkGalleryId.value = value
      else
        galleryId.value = value
    },
  })
  const options = computed(() => {
    const merged = [...presets, ...storedOptions.value].map((option) => {
      const stored = galleryOptions.value[option.id]
      if (!stored || stored.blur === undefined || option.blur === stored.blur)
        return option

      return {
        ...option,
        blur: stored.blur,
      }
    })

    return [...merged].sort((a, b) => (b.importedAt ?? 0) - (a.importedAt ?? 0))
  })
  const darkSelectedOption = computed(() => options.value.find(option => option.id === darkGalleryId.value))
  const selectedOption = computed(() => options.value.find(option => option.id === selectedId.value) ?? options.value[0])
  const lightSelectedOption = computed(() => options.value.find(option => option.id === galleryId.value) ?? options.value[0])

  function resolveAsset(assetId?: string) {
    return assetId ? options.value.find(option => option.id === assetId) : undefined
  }

  function resolveAssetSrc(assetId?: string) {
    return resolveAsset(assetId)?.src
  }

  function syncChatBubbleBackgroundAssets() {
    if (typeof document === 'undefined')
      return

    for (const role of ['assistant', 'user'] as const) {
      for (const mode of ['light', 'dark'] as const) {
        const property = `--airi-chat-${role}-${mode}-background-image`
        const assetId = chatAppearanceStore.settings[role][mode].backgroundAssetId
        const src = options.value.find(option => option.id === assetId)?.src

        if (src)
          document.documentElement.style.setProperty(property, `url(${JSON.stringify(src)})`)
        else
          document.documentElement.style.removeProperty(property)
      }
    }
  }

  watch([options, () => chatAppearanceStore.settings], syncChatBubbleBackgroundAssets, { deep: true, immediate: true })

  const blobRefs = new Map<string, ShallowRef<Blob | undefined>>()
  const urlRefs = new Map<string, Readonly<Ref<string | undefined>>>()

  watch(options, (next) => {
    if (!next.some(option => option.id === selectedId.value))
      selectedId.value = next[0]?.id
    if (darkGalleryId.value && !next.some(option => option.id === darkGalleryId.value))
      darkGalleryId.value = ''
  })

  function ensureObjectUrl(id: string, blob: Blob) {
    let blobRef = blobRefs.get(id)
    let urlRef = urlRefs.get(id)

    if (!blobRef || !urlRef) {
      blobRef = shallowRef<Blob | undefined>(blob)
      blobRefs.set(id, blobRef)
      urlRef = useObjectUrl(blobRef)
      urlRefs.set(id, urlRef)
    }

    if (blobRef.value !== blob)
      blobRef.value = blob

    return urlRef!.value!
  }

  onScopeDispose(() => {
    syncChannel?.close()
    blobRefs.clear()
    urlRefs.clear()
  })

  function broadcastAssetChange() {
    try {
      syncChannel?.postMessage({ type: 'background-assets-changed' })
    }
    catch (error) {
      console.warn('Failed to broadcast background asset change', error)
    }
  }

  async function migrateDataUrlToBlob(key: string, val: PersistedBackgroundItem, dataUrl: string) {
    try {
      const blob = await (await fetch(dataUrl)).blob()
      const objectUrl = ensureObjectUrl(key, blob)

      const existingIndex = storedOptions.value.findIndex(o => o.id === key)
      if (existingIndex >= 0) {
        const existing = storedOptions.value[existingIndex]
        storedOptions.value.splice(existingIndex, 1, {
          ...existing,
          src: objectUrl,
          file: undefined,
        })
      }

      const payload: PersistedBackgroundItem = {
        ...val,
        src: undefined,
        file: blob,
      }

      await localforage.setItem<PersistedBackgroundItem>(key, payload)
      broadcastAssetChange()
    }
    catch (error) {
      console.error('Failed to migrate background data URL to Blob', error)
    }
  }

  function persistSelectionOptions(option: BackgroundItem) {
    const payload: Pick<BackgroundOption, 'id' | 'blur'> = {
      id: option.id,
      blur: option.blur ?? false,
    }

    galleryOptions.value = {
      ...galleryOptions.value,
      [option.id]: payload,
    }
  }

  function setSelection(option: BackgroundItem, color?: string) {
    selectedId.value = option.id
    if (color)
      sampledColor.value = color
  }

  function setLightSelection(option: BackgroundItem, color?: string) {
    persistSelectionOptions(option)
    galleryId.value = option.id
    if (color)
      sampledColor.value = color
  }

  function setDarkSelection(option: BackgroundItem) {
    persistSelectionOptions(option)
    darkGalleryId.value = option.id
  }

  function clearDarkSelection() {
    darkGalleryId.value = ''
  }

  async function applyPickerSelection(payload: { option: BackgroundOption, color?: string }) {
    const kind = payload.option.kind === BackgroundKind.Wave
      ? BackgroundKind.Wave
      : payload.option.kind === BackgroundKind.Image
        ? BackgroundKind.Image
        : BackgroundKind.Image

    const selection: BackgroundItem = {
      ...payload.option,
      kind,
    }

    persistSelectionOptions(selection)

    const saved = await addOption(selection)
    setSelection(saved, payload.color)

    return saved
  }

  async function applyDarkPickerSelection(payload: { option: BackgroundOption, color?: string }) {
    const selection: BackgroundItem = {
      ...payload.option,
      kind: payload.option.kind === BackgroundKind.Wave ? BackgroundKind.Wave : BackgroundKind.Image,
    }

    persistSelectionOptions(selection)
    const saved = await addOption(selection, false)
    setDarkSelection(saved)

    return saved
  }

  async function applyLightPickerSelection(payload: { option: BackgroundOption, color?: string }) {
    const selection: BackgroundItem = {
      ...payload.option,
      kind: payload.option.kind === BackgroundKind.Wave ? BackgroundKind.Wave : BackgroundKind.Image,
    }

    const saved = await addOption(selection, false)
    setLightSelection(saved, payload.color)

    return saved
  }

  async function loadFromIndexedDb() {
    if (loading.value) {
      reloadPending = true
      return
    }

    loading.value = true
    reloadPending = false

    const stored: BackgroundItem[] = []
    try {
      await localforage.iterate<PersistedBackgroundItem, void>((val, key) => {
        if (!key.startsWith(STORAGE_PREFIX))
          return

        const storedBlob = val.file instanceof Blob ? val.file : undefined
        const storedSrc = typeof val.src === 'string' && val.src.length > 0 ? val.src : undefined

        if (storedBlob) {
          const objectUrl = ensureObjectUrl(key, storedBlob)
          stored.push({
            ...val,
            id: key,
            kind: BackgroundKind.Image,
            src: objectUrl,
            file: undefined,
            component: undefined,
            removable: true,
          })
          return
        }

        if (storedSrc) {
          stored.push({
            ...val,
            id: key,
            kind: BackgroundKind.Image,
            src: storedSrc,
            file: undefined,
            component: undefined,
            removable: true,
          })

          if (storedSrc.startsWith('data:')) {
            setTimeout(() => {
              void migrateDataUrlToBlob(key, val, storedSrc)
            }, 0)
          }
        }
      })
    }
    catch (error) {
      console.error('Failed to load backgrounds from IndexedDB', error)
    }

    storedOptions.value = stored
    const storedIds = new Set(stored.map(option => option.id))
    for (const [id, blobRef] of blobRefs) {
      if (id.startsWith(STORAGE_PREFIX) && !storedIds.has(id)) {
        blobRef.value = undefined
        blobRefs.delete(id)
        urlRefs.delete(id)
      }
    }
    loading.value = false

    if (reloadPending)
      void loadFromIndexedDb()
  }

  if (typeof BroadcastChannel !== 'undefined') {
    syncChannel = new BroadcastChannel(SYNC_CHANNEL_NAME)
    syncChannel.onmessage = (event: MessageEvent<{ type?: string }>) => {
      if (event.data?.type === 'background-assets-changed')
        void loadFromIndexedDb()
    }
  }

  void loadFromIndexedDb()

  async function addOption(option: BackgroundItem, select = true): Promise<BackgroundItem> {
    const normalizedId = option.file ? (option.id.startsWith(STORAGE_PREFIX) ? option.id : `${STORAGE_PREFIX}${option.id}`) : option.id

    const hasUploadedFile = option.file instanceof Blob
    const storedBlob = hasUploadedFile ? option.file : undefined

    const src = storedBlob
      ? ensureObjectUrl(normalizedId, storedBlob)
      : option.src

    const normalizedOption: BackgroundItem = {
      ...option,
      id: normalizedId,
      kind: option.kind ?? BackgroundKind.Image,
      component: option.component ? markRaw(option.component) : option.component,
      src,
      importedAt: option.importedAt ?? Date.now(),
      blur: option.blur,
      file: undefined,
      removable: true,
    }

    const existingIndex = storedOptions.value.findIndex(o => o.id === normalizedId)
    if (existingIndex >= 0) {
      storedOptions.value.splice(existingIndex, 1, normalizedOption)
    }
    else if (normalizedId.startsWith(STORAGE_PREFIX)) {
      storedOptions.value = [...storedOptions.value, normalizedOption]
    }

    if (select)
      selectedId.value = normalizedId

    if (hasUploadedFile && storedBlob) {
      const payload: PersistedBackgroundItem = {
        ...normalizedOption,
        // ensure we store under prefix for consistency
        id: normalizedId.startsWith(STORAGE_PREFIX) ? normalizedId : `${STORAGE_PREFIX}${normalizedId}`,
        src: undefined,
        file: storedBlob,
        removable: true,
      }
      try {
        await localforage.setItem<PersistedBackgroundItem>(payload.id, payload)
        broadcastAssetChange()
      }
      catch (error) {
        console.error('Failed to persist background', error)
      }
    }

    return normalizedOption
  }

  async function removeOption(optionId: string) {
    const optionIndex = options.value.findIndex(o => o.id === optionId)
    if (optionIndex === -1)
      return

    const option = options.value[optionIndex]

    // Remove from localforage
    try {
      if (option.id.startsWith(STORAGE_PREFIX)) {
        await localforage.removeItem(option.id)
        broadcastAssetChange()
      }
    }
    catch (error) {
      console.error('Failed to remove background from storage', error)
    }

    const blobRef = blobRefs.get(optionId)
    if (blobRef)
      blobRef.value = undefined

    blobRefs.delete(optionId)
    urlRefs.delete(optionId)

    const storedIndex = storedOptions.value.findIndex(o => o.id === optionId)
    if (storedIndex >= 0)
      storedOptions.value.splice(storedIndex, 1)
    if (galleryOptions.value[optionId]) {
      const { [optionId]: _, ...rest } = galleryOptions.value
      galleryOptions.value = rest
    }

    // If selected, fallback to first available option
    if (selectedId.value === optionId)
      selectedId.value = options.value[0]?.id
  }

  function setSampledColor(color?: string) {
    if (color)
      sampledColor.value = color
  }

  return {
    options,
    selectedId,
    selectedOption,
    lightSelectedOption,
    darkSelectedOption,
    darkSelectedId: darkGalleryId,
    resolveAsset,
    resolveAssetSrc,
    sampledColor,
    loading,
    loadFromIndexedDb,
    addOption,
    removeOption,
    setSelection,
    setLightSelection,
    setDarkSelection,
    clearDarkSelection,
    applyPickerSelection,
    applyLightPickerSelection,
    applyDarkPickerSelection,
    setSampledColor,
  }
})
