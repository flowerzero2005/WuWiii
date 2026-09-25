import { defineStore } from 'pinia'
import { ref } from 'vue'

import { notebookRepo } from '../database/repos/notebook.repo'
import { useMemoryAdvancedSettingsStore } from './settings/memory-advanced'

/**
 * 生成设备指纹
 * 基于浏览器和设备特征生成稳定的唯一标识
 */
function getDeviceFingerprint(): string {
  try {
    const components = [
      navigator.userAgent,
      navigator.language,
      screen.width,
      screen.height,
      screen.colorDepth,
      new Date().getTimezoneOffset(),
      navigator.hardwareConcurrency || 'unknown',
      navigator.platform,
    ]

    // 简单哈希函数
    const str = components.join('|')
    let hash = 0
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash // Convert to 32bit integer
    }

    return `device_${Math.abs(hash).toString(36)}`
  }
  catch (error) {
    console.error('[UserIdentity] Failed to generate device fingerprint:', error)
    return `device_${Date.now().toString(36)}`
  }
}

/**
 * 数据迁移：将 default 用户的数据复制到新用户
 * 安全策略：只复制不删除，保留原数据作为备份
 */
async function migrateOldDataToNewUser(newUserId: string): Promise<void> {
  try {
    // 读取 default 用户的数据
    const defaultData = await notebookRepo.load('default')

    if (!defaultData || (defaultData.entries.length === 0 && defaultData.tasks.length === 0)) {
      return
    }

    // 检查新用户是否已有数据
    const existingData = await notebookRepo.load(newUserId)
    if (existingData && (existingData.entries.length > 0 || existingData.tasks.length > 0)) {
      return
    }

    // 复制数据到新用户（不删除原数据）
    await notebookRepo.save(newUserId, {
      entries: defaultData.entries,
      tasks: defaultData.tasks,
      version: 1,
    })
  }
  catch (error) {
    console.error('[UserIdentity] Data migration failed:', error)
    // 迁移失败不影响功能，只记录错误
  }
}

export const useUserIdentityStore = defineStore('user-identity', () => {
  const STORAGE_KEY = 'airi-user-identity'
  const currentUserId = ref<string>('default')
  const isIdentified = ref(false)

  /**
   * 识别用户身份
   * 根据 enableMultiUser 配置决定是否启用多用户识别
   */
  async function identifyUser(): Promise<string> {
    if (isIdentified.value) {
      return currentUserId.value
    }

    try {
      const advancedSettings = useMemoryAdvancedSettingsStore()

      // 等待配置加载完成
      if (!advancedSettings.isLoaded) {
        await new Promise<void>((resolve) => {
          const unwatch = advancedSettings.$subscribe(() => {
            if (advancedSettings.isLoaded) {
              unwatch()
              resolve()
            }
          })
        })
      }

      // 如果未启用多用户功能，使用默认用户
      if (!advancedSettings.settings.enableMultiUser) {
        currentUserId.value = 'default'
        isIdentified.value = true
        return 'default'
      }

      // 尝试从 localStorage 读取已保存的用户 ID
      const storedUserId = localStorage.getItem(STORAGE_KEY)
      if (storedUserId) {
        currentUserId.value = storedUserId
        isIdentified.value = true
        return storedUserId
      }

      // 生成新的设备指纹作为用户 ID
      const deviceId = getDeviceFingerprint()

      // 保存到 localStorage
      localStorage.setItem(STORAGE_KEY, deviceId)

      // 执行数据迁移（首次启用多用户功能时）
      await migrateOldDataToNewUser(deviceId)

      currentUserId.value = deviceId
      isIdentified.value = true
      return deviceId
    }
    catch (error) {
      console.error('[UserIdentity] Failed to identify user:', error)
      // 出错时使用默认用户，确保功能可用
      currentUserId.value = 'default'
      isIdentified.value = true
      return 'default'
    }
  }

  /**
   * 重置用户识别状态
   * 用于测试或切换用户场景
   */
  function resetIdentity() {
    currentUserId.value = 'default'
    isIdentified.value = false
    localStorage.removeItem(STORAGE_KEY)
  }

  return {
    currentUserId,
    isIdentified,
    identifyUser,
    resetIdentity,
  }
})
