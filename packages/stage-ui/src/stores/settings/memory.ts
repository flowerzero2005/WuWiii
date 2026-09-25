import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface MemoryKeyword {
  id: string
  keyword: string
  importance: 'low' | 'medium' | 'high'
  tags: string[]
  enabled: boolean
  description?: string
}

export interface MemorySettings {
  enabled: boolean
  autoExtract: boolean
  minImportance: 'low' | 'medium' | 'high'
  useLLMForHighPriority: boolean
  deduplicationEnabled: boolean
  syncInterval: number // 每 N 条记忆同步一次

  // 维护选项
  autoDeduplication: boolean // 自动去重
  deduplicationThreshold: number // 去重阈值
  autoArchive: boolean // 自动归档
  archiveAfterDays: number // 多少天后归档
  autoCleanup: boolean // 自动清理
  cleanupLowImportance: boolean // 清理低重要性记忆
  maxMemories: number // 最大记忆数量
}

export const useMemorySettingsStore = defineStore('memory-settings', () => {
  const STORAGE_KEY = 'airi-memory-settings'
  const isLoaded = ref(false)

  // 记忆提取设置
  const settings = ref<MemorySettings>({
    enabled: true,
    autoExtract: true,
    minImportance: 'medium',
    useLLMForHighPriority: true,
    deduplicationEnabled: true,
    syncInterval: 10,

    // 维护选项默认值
    autoDeduplication: true,
    deduplicationThreshold: 0.85,
    autoArchive: false,
    archiveAfterDays: 90,
    autoCleanup: false,
    cleanupLowImportance: false,
    maxMemories: 1000,
  })

  // 自定义关键词规则
  const customKeywords = ref<MemoryKeyword[]>([
    {
      id: '1',
      keyword: '我叫|我是|我的名字',
      importance: 'high',
      tags: ['个人信息', '姓名'],
      enabled: true,
      description: '用户姓名',
    },
    {
      id: '2',
      keyword: '我喜欢|我爱|我最爱',
      importance: 'high',
      tags: ['偏好', '兴趣'],
      enabled: true,
      description: '用户偏好',
    },
    {
      id: '3',
      keyword: '记住|别忘了|一定要记得',
      importance: 'high',
      tags: ['明确要求'],
      enabled: true,
      description: '明确要求记住',
    },
    {
      id: '4',
      keyword: '生日|年龄|岁',
      importance: 'high',
      tags: ['个人信息', '生日'],
      enabled: true,
      description: '生日年龄',
    },
    {
      id: '5',
      keyword: '我住在|我在|我来自',
      importance: 'medium',
      tags: ['个人信息', '地理位置'],
      enabled: true,
      description: '居住地',
    },
    {
      id: '6',
      keyword: '我的工作|我从事|我是.*工程师',
      importance: 'medium',
      tags: ['个人信息', '职业'],
      enabled: true,
      description: '职业信息',
    },
    {
      id: '7',
      keyword: '明天|下周|计划|打算',
      importance: 'medium',
      tags: ['计划', '未来事件'],
      enabled: true,
      description: '未来计划',
    },
    {
      id: '8',
      keyword: '今天|现在|刚才',
      importance: 'low',
      tags: ['临时状态'],
      enabled: false,
      description: '临时状态（默认不记录）',
    },
  ])

  // 从 localStorage 加载
  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const data = JSON.parse(stored)
        if (data.settings && typeof data.settings === 'object' && !Array.isArray(data.settings)) {
          const {
            autoMaintenance: _autoMaintenance,
            maintenanceInterval: _maintenanceInterval,
            ...rest
          } = data.settings as Record<string, unknown>
          settings.value = { ...settings.value, ...(rest as Partial<MemorySettings>) }
        }
        if (data.customKeywords) {
          customKeywords.value = data.customKeywords
        }
      }
    }
    catch (error) {
      console.error('[Memory Settings] Failed to load from storage:', error)
    }
    finally {
      isLoaded.value = true
    }
  }

  // 保存到 localStorage
  function saveToStorage() {
    if (!isLoaded.value)
      return

    try {
      const data = {
        settings: settings.value,
        customKeywords: customKeywords.value,
      }
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
    }
    catch (error) {
      console.error('[Memory Settings] Failed to save to storage:', error)
    }
  }

  // 监听变化并自动保存
  watch([settings, customKeywords], () => {
    if (isLoaded.value) {
      saveToStorage()
    }
  }, { deep: true })

  // 立即加载数据
  loadFromStorage()

  function addKeyword(keyword: Omit<MemoryKeyword, 'id'>) {
    const id = Date.now().toString()
    customKeywords.value.push({ ...keyword, id })
    return id
  }

  function updateKeyword(id: string, updates: Partial<MemoryKeyword>) {
    const index = customKeywords.value.findIndex(k => k.id === id)
    if (index !== -1) {
      customKeywords.value[index] = { ...customKeywords.value[index], ...updates }
    }
  }

  function deleteKeyword(id: string) {
    const index = customKeywords.value.findIndex(k => k.id === id)
    if (index !== -1) {
      customKeywords.value.splice(index, 1)
    }
  }

  function toggleKeyword(id: string) {
    const keyword = customKeywords.value.find(k => k.id === id)
    if (keyword) {
      keyword.enabled = !keyword.enabled
    }
  }

  return {
    settings,
    customKeywords,
    isLoaded,
    loadFromStorage,
    saveToStorage,
    addKeyword,
    updateKeyword,
    deleteKeyword,
    toggleKeyword,
  }
})
