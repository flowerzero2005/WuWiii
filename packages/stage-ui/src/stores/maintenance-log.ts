import { defineStore } from 'pinia'
import { ref } from 'vue'

export interface MaintenanceLogEntry {
  id: string
  timestamp: number
  type: 'auto' | 'manual'
  action: 'deduplication' | 'archive' | 'cleanup' | 'merge'
  details: string
  affectedCount: number
  success: boolean
  error?: string
}

export const useMaintenanceLogStore = defineStore('maintenance-log', () => {
  const logs = ref<MaintenanceLogEntry[]>([])
  const maxLogs = 100 // 最多保留100条日志

  function addLog(entry: Omit<MaintenanceLogEntry, 'id' | 'timestamp'>) {
    const log: MaintenanceLogEntry = {
      ...entry,
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: Date.now(),
    }

    logs.value.unshift(log)

    // 限制日志数量
    if (logs.value.length > maxLogs) {
      logs.value = logs.value.slice(0, maxLogs)
    }

    // 保存到 localStorage
    saveToStorage()
  }

  function clearLogs() {
    logs.value = []
    saveToStorage()
  }

  function saveToStorage() {
    try {
      localStorage.setItem('airi-maintenance-logs', JSON.stringify(logs.value))
    }
    catch (error) {
      console.error('[MaintenanceLog] Failed to save logs:', error)
    }
  }

  function loadFromStorage() {
    try {
      const stored = localStorage.getItem('airi-maintenance-logs')
      if (stored) {
        logs.value = JSON.parse(stored)
      }
    }
    catch (error) {
      console.error('[MaintenanceLog] Failed to load logs:', error)
    }
  }

  // 立即加载
  loadFromStorage()

  return {
    logs,
    addLog,
    clearLogs,
    loadFromStorage,
  }
})
