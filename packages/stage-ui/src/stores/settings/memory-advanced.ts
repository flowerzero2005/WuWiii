import { defineStore } from 'pinia'
import { ref, watch } from 'vue'

export interface MemoryAdvancedSettings {
  // 阶段1: 记忆隔离
  enableMultiUser: boolean

  // 阶段2: 语义理解
  enableSemanticSearch: boolean
  enableOfficialCloudEmbedding: boolean
  enableSmartValueJudgment: boolean
  enableReplyFeedbackLearning: boolean

  // 阶段3: 自然对话
  enableConversationInit: boolean
  enableInnerVoiceNotePrewarm: boolean
  innerVoiceNoteRetentionDays: number
  enableNaturalOutput: boolean
  naturalOutputDelay: number // 句子间延迟(ms)
  enableSemanticSegmentation: boolean // 智能语义分段
  bubbleDelayMs: number // 气泡之间延迟时间(ms)
  enableAdaptiveBubbleDelay: boolean // 根据文字数量自动调整气泡延迟
  typingSpeed: number // 打字机速度(ms/字符)
  enableMessageMerging: boolean // 用户消息智能合并
  messageMergeDelay: number // 消息合并等待时间(ms)

  // 阶段4: 主动话题
  enableProactiveTopic: boolean
  proactiveCheckInterval: number // 检查间隔(分钟)
  proactiveRandomInterval: boolean // 启用随机间隔
  proactiveMinInterval: number // 最小间隔(分钟)
  proactiveMaxInterval: number // 最大间隔(分钟)
  proactiveTimeRange: { start: number, end: number } // 允许时间段
}

export const useMemoryAdvancedSettingsStore = defineStore('memory-advanced-settings', () => {
  const STORAGE_KEY = 'airi-memory-advanced-settings'
  const isLoaded = ref(false)

  // 默认配置：有用的功能默认开启，实验性功能需要用户主动开启
  const settings = ref<MemoryAdvancedSettings>({
    // 阶段1: 记忆隔离（默认关闭，需要用户主动开启）
    enableMultiUser: false,
    enableReplyFeedbackLearning: true,

    // 阶段2: 语义理解（默认开启，提升记忆系统效果）
    enableSemanticSearch: true, // 提高记忆召回率
    enableOfficialCloudEmbedding: false,
    enableSmartValueJudgment: true, // 减少无用记忆

    // 阶段3: 自然对话（默认关闭，会改变交互体验）
    enableConversationInit: false, // 需要用户主动开启
    enableInnerVoiceNotePrewarm: false, // 需要额外模型调用，默认关闭
    innerVoiceNoteRetentionDays: 30,
    enableNaturalOutput: false, // 会改变输出速度
    naturalOutputDelay: 300, // 默认300ms停顿
    enableSemanticSegmentation: false, // 暂时禁用，需要重新实现
    bubbleDelayMs: 2000, // 默认气泡之间延迟2秒
    enableAdaptiveBubbleDelay: false, // 默认关闭自动调整
    typingSpeed: 30, // 默认30ms/字符
    enableMessageMerging: false, // 改变交互方式
    messageMergeDelay: 2500, // 默认2.5秒等待时间

    // 阶段4: 主动话题（默认关闭，实验性功能）
    enableProactiveTopic: false,
    proactiveCheckInterval: 10, // 默认10分钟检查一次
    proactiveRandomInterval: false, // 默认关闭随机间隔
    proactiveMinInterval: 2, // 最小2分钟
    proactiveMaxInterval: 5, // 最大5分钟
    proactiveTimeRange: { start: 9, end: 22 }, // 默认9:00-22:00
  })

  // 从 localStorage 加载
  function loadFromStorage() {
    try {
      const stored = localStorage.getItem(STORAGE_KEY)
      if (stored) {
        const data = JSON.parse(stored)
        // 合并配置，确保新增字段有默认值
        settings.value = { ...settings.value, ...data }
      }
    }
    catch (error) {
      console.error('[Memory Advanced Settings] Failed to load from storage:', error)
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
      localStorage.setItem(STORAGE_KEY, JSON.stringify(settings.value))
    }
    catch (error) {
      console.error('[Memory Advanced Settings] Failed to save to storage:', error)
    }
  }

  // 监听变化并自动保存
  watch(settings, () => {
    if (isLoaded.value) {
      saveToStorage()
    }
  }, { deep: true })

  // 立即加载数据
  loadFromStorage()

  // 重置为默认值
  function resetToDefaults() {
    settings.value = {
      // 阶段1: 记忆隔离（默认关闭，需要用户主动开启）
      enableMultiUser: false,
      enableReplyFeedbackLearning: true,

      // 阶段2: 语义理解（默认开启，提升记忆系统效果）
      enableSemanticSearch: true, // 提高记忆召回率
      enableOfficialCloudEmbedding: false,
      enableSmartValueJudgment: true, // 减少无用记忆

      // 阶段3: 自然对话（默认关闭，会改变交互体验）
      enableConversationInit: false, // 需要用户主动开启
      enableInnerVoiceNotePrewarm: false, // 需要额外模型调用，默认关闭
      innerVoiceNoteRetentionDays: 30,
      enableNaturalOutput: false, // 会改变输出速度
      naturalOutputDelay: 300,
      enableSemanticSegmentation: false, // 新功能，需要测试
      bubbleDelayMs: 2000, // 默认气泡之间延迟2秒
      enableAdaptiveBubbleDelay: false, // 默认关闭自动调整
      typingSpeed: 30, // 默认30ms/字符
      enableMessageMerging: false, // 改变交互方式
      messageMergeDelay: 2500,

      // 阶段4: 主动话题（默认关闭，实验性功能）
      enableProactiveTopic: false,
      proactiveCheckInterval: 10,
      proactiveRandomInterval: false,
      proactiveMinInterval: 2,
      proactiveMaxInterval: 5,
      proactiveTimeRange: { start: 9, end: 22 },
    }
  }

  return {
    settings,
    isLoaded,
    loadFromStorage,
    saveToStorage,
    resetToDefaults,
  }
})
