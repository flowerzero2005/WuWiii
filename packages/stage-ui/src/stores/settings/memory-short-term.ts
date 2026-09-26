import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface MemoryShortTermSettings {
  // 是否开启"短期记忆消息数量达到上限自动清理"
  autoCleanupEnabled: boolean
  // 触发自动清理的消息数量上限（含系统提示与问候消息），范围 1..400
  autoCleanupLimit: number
}

// 上限范围与默认值。默认 200：既能覆盖常见的较长会话，又不会轻易触发清空。
export const AUTO_CLEANUP_LIMIT_MIN = 1
export const AUTO_CLEANUP_LIMIT_MAX = 400
export const AUTO_CLEANUP_LIMIT_DEFAULT = 200

/**
 * 将任意输入收敛到合法上限：非有限数回落到默认值，小数四舍五入，超出范围双向截断。
 * 供设置存储加载、setter 与首页 UI 复用，保证持久化与运行时的 limit 永远落在 [1, 400]。
 */
export function clampAutoCleanupLimit(value: number): number {
  if (!Number.isFinite(value))
    return AUTO_CLEANUP_LIMIT_DEFAULT

  return Math.min(AUTO_CLEANUP_LIMIT_MAX, Math.max(AUTO_CLEANUP_LIMIT_MIN, Math.round(value)))
}

export const useMemoryShortTermSettingsStore = defineStore('memory-short-term-settings', () => {
  const STORAGE_KEY = 'airi-memory-short-term-settings'
  const isLoaded = ref(false)

  const settings = ref<MemoryShortTermSettings>({
    autoCleanupEnabled: false,
    autoCleanupLimit: AUTO_CLEANUP_LIMIT_DEFAULT,
  })

  function loadFromStorage() {
    // NOTICE: vitest 默认跑在 node 环境（无 localStorage），做存在性守卫避免模块加载即抛错，
    // 也让本 store 可被单测安全地 import。浏览器运行时该守卫恒为假、直接走正常流程。
    if (typeof localStorage === 'undefined') {
      isLoaded.value = true
      return
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const data = JSON.parse(stored) as Partial<MemoryShortTermSettings> | null
        settings.value = {
          autoCleanupEnabled: data?.autoCleanupEnabled === true,
          autoCleanupLimit: clampAutoCleanupLimit(Number(data?.autoCleanupLimit)),
        }
      }
    }
    catch (error) {
      console.error('[Memory Short-term Settings] Failed to load from storage:', error)
    }
    finally {
      isLoaded.value = true
    }
  }

  function saveToStorage() {
    if (!isLoaded.value)
      return

    if (typeof localStorage === 'undefined')
      return

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value))
    }
    catch (error) {
      console.error('[Memory Short-term Settings] Failed to save to storage:', error)
    }
  }

  // 上限统一经过 clamp，避免 UI 或存储直接写入越界/非法值。
  function setAutoCleanupLimit(value: number) {
    settings.value.autoCleanupLimit = clampAutoCleanupLimit(value)
  }

  watch(settings, () => {
    if (isLoaded.value)
      saveToStorage()
  }, { deep: true })

  loadFromStorage()

  return {
    settings,
    isLoaded,
    loadFromStorage,
    saveToStorage,
    setAutoCleanupLimit,
  }
})
