<script setup lang="ts">
import { useCharacterNotebookStore } from '@proj-airi/stage-ui/stores/character/notebook'
import { useMemoryManager } from '@proj-airi/stage-ui/stores/chat/memory-manager'
import { onMounted, ref } from 'vue'

const notebookStore = useCharacterNotebookStore()
const memoryManager = useMemoryManager()

const diagnostics = ref({
  notebookStoreLoaded: false,
  entriesCount: 0,
  tasksCount: 0,
  isSaving: false,
  characterId: '',
  lastCheck: '',
})

const logs = ref<string[]>([])

function addLog(message: string) {
  const timestamp = new Date().toLocaleTimeString()
  logs.value.unshift(`[${timestamp}] ${message}`)
  if (logs.value.length > 50) {
    logs.value.pop()
  }
}

function updateDiagnostics() {
  diagnostics.value = {
    notebookStoreLoaded: notebookStore.isLoaded,
    entriesCount: notebookStore.entries.length,
    tasksCount: notebookStore.tasks.length,
    isSaving: notebookStore.isSaving,
    characterId: notebookStore.characterId,
    lastCheck: new Date().toLocaleTimeString(),
  }
  addLog(`诊断更新: ${notebookStore.entries.length} 条记忆`)
}

async function testAddMemory() {
  addLog('开始测试添加记忆...')
  try {
    const testText = `测试记忆 ${Date.now()}`
    addLog(`添加测试记忆: ${testText}`)

    notebookStore.addNote(testText, {
      tags: ['测试'],
      metadata: { test: true },
    })

    addLog('记忆已添加到 store')

    // 等待一段时间让 watch 触发
    setTimeout(() => {
      updateDiagnostics()
      addLog('等待 1 秒后检查状态')
    }, 1000)
  }
  catch (error) {
    addLog(`错误: ${error}`)
  }
}

async function testProcessConversation() {
  addLog('开始测试对话处理...')
  try {
    const userMsg = '我喜欢吃苹果'
    const assistantMsg = '好的，我记住了你喜欢吃苹果'

    addLog(`用户消息: ${userMsg}`)
    addLog(`助手消息: ${assistantMsg}`)

    await memoryManager.processConversationTurn(userMsg, assistantMsg)

    addLog('对话处理完成')

    setTimeout(() => {
      updateDiagnostics()
      addLog('等待 2 秒后检查状态')
    }, 2000)
  }
  catch (error) {
    addLog(`错误: ${error}`)
  }
}

async function forceSave() {
  addLog('强制保存到 IndexedDB...')
  try {
    await notebookStore.saveToStorage()
    addLog('强制保存完成')
    updateDiagnostics()
  }
  catch (error) {
    addLog(`保存错误: ${error}`)
  }
}

async function forceLoad() {
  addLog('强制从 IndexedDB 加载...')
  try {
    await notebookStore.loadFromStorage()
    addLog('强制加载完成')
    updateDiagnostics()
  }
  catch (error) {
    addLog(`加载错误: ${error}`)
  }
}

function clearLogs() {
  logs.value = []
  addLog('日志已清空')
}

onMounted(() => {
  addLog('诊断页面已加载')
  updateDiagnostics()

  // 每 2 秒自动更新诊断信息
  setInterval(updateDiagnostics, 2000)
})
</script>

<template>
  <div class="memory-diagnostics" p-4>
    <h1 mb-4 text-2xl font-bold>
      记忆系统诊断
    </h1>

    <!-- 诊断信息 -->
    <div class="diagnostics-panel" mb-4 rounded bg-gray-100 p-4 dark:bg-gray-800>
      <h2 mb-2 text-xl font-semibold>
        系统状态
      </h2>
      <div grid grid-cols-2 gap-2>
        <div>Notebook Store 已加载:</div>
        <div :class="diagnostics.notebookStoreLoaded ? 'text-green-600' : 'text-red-600'">
          {{ diagnostics.notebookStoreLoaded ? '是' : '否' }}
        </div>

        <div>记忆条目数:</div>
        <div>{{ diagnostics.entriesCount }}</div>

        <div>任务数:</div>
        <div>{{ diagnostics.tasksCount }}</div>

        <div>正在保存:</div>
        <div :class="diagnostics.isSaving ? 'text-yellow-700 dark:text-yellow-300' : 'airi-text-muted'">
          {{ diagnostics.isSaving ? '是' : '否' }}
        </div>

        <div>角色 ID:</div>
        <div>{{ diagnostics.characterId }}</div>

        <div>最后检查:</div>
        <div>{{ diagnostics.lastCheck }}</div>
      </div>
    </div>

    <!-- 操作按钮 -->
    <div class="actions" mb-4 flex flex-wrap gap-2>
      <button
        rounded bg-blue-500 px-4 py-2 text-white hover:bg-blue-600
        @click="testAddMemory"
      >
        测试添加记忆
      </button>

      <button
        rounded bg-green-500 px-4 py-2 text-white hover:bg-green-600
        @click="testProcessConversation"
      >
        测试对话处理
      </button>

      <button
        rounded bg-purple-500 px-4 py-2 text-white hover:bg-purple-600
        @click="forceSave"
      >
        强制保存
      </button>

      <button
        rounded bg-orange-500 px-4 py-2 text-white hover:bg-orange-600
        @click="forceLoad"
      >
        强制加载
      </button>

      <button
        rounded bg-yellow-500 px-4 py-2 text-white hover:bg-yellow-600
        @click="updateDiagnostics"
      >
        刷新状态
      </button>

      <button
        rounded bg-gray-500 px-4 py-2 text-white hover:bg-gray-600
        @click="clearLogs"
      >
        清空日志
      </button>
    </div>

    <!-- 记忆列表 -->
    <div class="memories-panel" mb-4 rounded bg-gray-100 p-4 dark:bg-gray-800>
      <h2 mb-2 text-xl font-semibold>
        当前记忆 ({{ notebookStore.entries.length }})
      </h2>
      <div v-if="notebookStore.entries.length === 0" class="airi-text-muted">
        暂无记忆
      </div>
      <div v-else class="memories-list" space-y-2>
        <div
          v-for="entry in notebookStore.entries"
          :key="entry.id"
          class="memory-item"
          rounded bg-white p-3 dark:bg-gray-700
        >
          <div flex items-start justify-between>
            <div flex-1>
              <div class="text-sm airi-text-muted">
                {{ entry.kind }} - {{ new Date(entry.createdAt).toLocaleString() }}
              </div>
              <div mt-1>
                {{ entry.text }}
              </div>
              <div v-if="entry.tags && entry.tags.length > 0" mt-1 flex gap-1>
                <span
                  v-for="tag in entry.tags"
                  :key="tag"
                  rounded bg-blue-100 px-2 py-1 text-xs dark:bg-blue-900
                >
                  {{ tag }}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 日志面板 -->
    <div class="logs-panel" rounded bg-gray-100 p-4 dark:bg-gray-800>
      <h2 mb-2 text-xl font-semibold>
        操作日志
      </h2>
      <div class="logs-list" max-h-96 overflow-y-auto text-sm font-mono space-y-1>
        <div v-for="(log, index) in logs" :key="index" text-gray-700 dark:text-gray-300>
          {{ log }}
        </div>
      </div>
    </div>

    <!-- 控制台提示 -->
    <div class="console-hint" mt-4 rounded bg-yellow-100 p-4 dark:bg-yellow-900>
      <h3 mb-2 font-semibold>
        控制台调试
      </h3>
      <p text-sm>
        打开浏览器控制台（F12），查看以 <code bg-gray-200 px-1 dark:bg-gray-700>[Notebook]</code>、
        <code bg-gray-200 px-1 dark:bg-gray-700>[MemoryManager]</code>、
        <code bg-gray-200 px-1 dark:bg-gray-700>[NotebookRepo]</code> 开头的日志。
      </p>
      <p mt-2 text-sm>
        所有关键步骤都使用 <code bg-gray-200 px-1 dark:bg-gray-700>console.error</code> 输出，
        确保在控制台中可见。
      </p>
    </div>
  </div>
</template>

<style scoped>
.memory-diagnostics {
  max-width: 1200px;
  margin: 0 auto;
}
</style>
