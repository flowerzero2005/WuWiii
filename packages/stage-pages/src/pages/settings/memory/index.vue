<script setup lang="ts">
import { CharacterAvatarImage } from '@proj-airi/stage-ui/components/chat'
import { useCharacterNotebookStore } from '@proj-airi/stage-ui/stores/character/notebook'
import { mergeDuplicates } from '@proj-airi/stage-ui/stores/chat/memory-deduplication'
import { useDisplayModelsStore } from '@proj-airi/stage-ui/stores/display-models'
import { useMaintenanceLogStore } from '@proj-airi/stage-ui/stores/maintenance-log'
import { useAiriCardStore } from '@proj-airi/stage-ui/stores/modules/airi-card'
import { useMemorySettingsStore } from '@proj-airi/stage-ui/stores/settings/memory'
import { useSettingsStageModel } from '@proj-airi/stage-ui/stores/settings/stage-model'
import { storeToRefs } from 'pinia'
import {
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogOverlay,
  AlertDialogPortal,
  AlertDialogRoot,
  AlertDialogTitle,
} from 'reka-ui'
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { useRouter } from 'vue-router'

const { locale, t } = useI18n()
const router = useRouter()
const notebookStore = useCharacterNotebookStore()
const memorySettings = useMemorySettingsStore()
const maintenanceLog = useMaintenanceLogStore()
const airiCardStore = useAiriCardStore()
const { displayModels } = storeToRefs(useDisplayModelsStore())
const { stageModelSelected, stageModelSelectedDisplayModel } = storeToRefs(useSettingsStageModel())
const searchQuery = ref('')
const selectedEntries = ref<Set<string>>(new Set())
const isSelectionMode = ref(false)
const activeTab = ref<'config' | 'keywords' | 'manage' | 'merge' | 'maintenance' | 'stats' | 'logs'>('manage')
const isAddingKeyword = ref(false)
const editingKeywordId = ref<string | null>(null)
const keywordForm = ref({
  keyword: '',
  importance: 'medium' as 'low' | 'medium' | 'high',
  tags: '',
  description: '',
  enabled: true,
})
const mergeThreshold = ref(0.30)
const duplicateGroups = ref<Array<{ entry: any, duplicates: any[], similarity: number }>>([])
const isScanning = ref(false)
const hasScanned = ref(false)
const isMergingAll = ref(false)
const mergeBatchResult = ref<{ message: string, tone: 'error' | 'success' | 'warning' } | null>(null)
const confirmationRequest = ref<{
  action: () => Promise<void> | void
  message: string
} | null>(null)
const confirmationBusy = ref(false)
const maintenanceResult = ref<{ message: string, tone: 'error' | 'success' } | null>(null)

function requestConfirmation(message: string, action: () => Promise<void> | void) {
  confirmationRequest.value = { action, message }
}

async function confirmRequestedAction() {
  const request = confirmationRequest.value
  if (!request || confirmationBusy.value)
    return

  confirmationBusy.value = true
  try {
    await request.action()
    confirmationRequest.value = null
  }
  finally {
    confirmationBusy.value = false
  }
}

const activeMemoryPersona = computed(() => airiCardStore.getCardRuntime(notebookStore.activePersonaCardId))
const activeMemoryPersonaName = computed(() => activeMemoryPersona.value?.displayName || t('settings.pages.memory.scope.default-persona'))
const activeMemoryPersonaUsesCurrentModel = computed(() => notebookStore.activePersonaCardId === airiCardStore.activeCardId)
const activeMemoryPersonaAvatarModelId = computed(() => activeMemoryPersonaUsesCurrentModel.value
  ? stageModelSelected.value || activeMemoryPersona.value?.displayModelId
  : activeMemoryPersona.value?.displayModelId)
const activeMemoryPersonaAvatarUrl = computed(() => {
  const boundModelPreview = activeMemoryPersona.value?.displayModelId
    ? displayModels.value.find(model => model.id === activeMemoryPersona.value?.displayModelId)?.previewImage
    : undefined
  return (activeMemoryPersonaUsesCurrentModel.value ? stageModelSelectedDisplayModel.value?.previewImage : undefined)
    ?? boundModelPreview
    ?? activeMemoryPersona.value?.avatarUrl
})

function getMemoryScopeLabel(entry: { metadata?: Record<string, unknown> }) {
  if (entry.metadata?.memoryScope === 'shared-by-user')
    return t('settings.pages.memory.scope.shared-user')
  if (entry.metadata?.memoryScope === 'global-system')
    return t('settings.pages.memory.scope.system')
  return t('settings.pages.memory.scope.private-persona')
}

// 编辑记忆状态
const editingEntryId = ref<string | null>(null)
const entryForm = ref({
  text: '',
  tags: '',
  kind: 'note' as 'note' | 'focus' | 'diary',
})

// 加载数据
if (!notebookStore.isLoaded) {
  notebookStore.loadFromStorage()
}

// 筛选记忆
const filteredEntries = computed(() => {
  const entries = notebookStore.entries || []
  if (!searchQuery.value)
    return entries

  const query = searchQuery.value.trim().toLowerCase()
  return entries.filter((entry) => {
    const searchableText = [
      entry.text,
      ...(entry.tags ?? []),
      typeof entry.metadata?.memoryContext === 'string' ? entry.metadata.memoryContext : '',
      typeof entry.metadata?.memoryType === 'string' ? entry.metadata.memoryType : '',
      typeof entry.metadata?.timeExpression === 'string' ? entry.metadata.timeExpression : '',
    ].join('\n').toLowerCase()
    return searchableText.includes(query)
  })
})

// 统计
const stats = computed(() => ({
  total: notebookStore.entries?.length || 0,
  high: notebookStore.entries?.filter(e => e.metadata?.importance === 'high').length || 0,
  medium: notebookStore.entries?.filter(e => e.metadata?.importance === 'medium').length || 0,
  focus: notebookStore.entries?.filter(e => e.kind === 'focus').length || 0,
  note: notebookStore.entries?.filter(e => e.kind === 'note').length || 0,
}))

// 格式化时间
function formatTime(timestamp: number) {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (days === 0)
    return t('settings.pages.memory.time.today')
  if (days === 1)
    return t('settings.pages.memory.time.yesterday')
  if (days < 7)
    return t('settings.pages.memory.time.days-ago', { count: days })
  return date.toLocaleDateString(locale.value)
}

function formatDateTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(locale.value, {
    dateStyle: 'medium',
    timeStyle: 'short',
  })
}

function getMemoryEventTime(entry: { createdAt: number, metadata?: Record<string, unknown> }) {
  const sourceCreatedAt = entry.metadata?.sourceCreatedAt
  return typeof sourceCreatedAt === 'number' && Number.isFinite(sourceCreatedAt)
    ? sourceCreatedAt
    : entry.createdAt
}

function getMetadataString(entry: { metadata?: Record<string, unknown> }, key: string) {
  const value = entry.metadata?.[key]
  return typeof value === 'string' && value.trim() ? value : undefined
}

function getMetadataNumber(entry: { metadata?: Record<string, unknown> }, key: string) {
  const value = entry.metadata?.[key]
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function getMemoryTypeLabel(entry: { metadata?: Record<string, unknown> }) {
  const type = getMetadataString(entry, 'memoryType')
  const supportedTypes = ['boundary', 'communication', 'event', 'identity', 'other', 'plan', 'preference', 'relationship']
  return type && supportedTypes.includes(type)
    ? t(`settings.pages.memory.memory-types.${type}`)
    : undefined
}

function getCertaintyLabel(entry: { metadata?: Record<string, unknown> }) {
  const certainty = getMetadataString(entry, 'certainty')
  const supportedCertainties = ['confirmed', 'inferred', 'stated']
  return certainty && supportedCertainties.includes(certainty)
    ? t(`settings.pages.memory.certainty.${certainty}`)
    : undefined
}

// 重要性颜色
function getImportanceColor(importance?: string) {
  if (importance === 'high')
    return 'airi-status-danger'
  if (importance === 'medium')
    return 'airi-status-warning'
  return 'airi-status-neutral'
}

// 删除单条记忆
function deleteEntry(id: string) {
  requestConfirmation(t('settings.pages.memory.confirm.delete-entry'), () => {
    notebookStore.removeEntry(id)
  })
}

// 打开编辑记忆表单
function openEditEntry(entry: any) {
  editingEntryId.value = entry.id
  entryForm.value = {
    text: entry.text,
    tags: entry.tags?.join(', ') || '',
    kind: entry.kind,
  }
}

// 保存编辑的记忆
function saveEntry() {
  if (!editingEntryId.value || !entryForm.value.text.trim())
    return

  const entry = notebookStore.entries.find(e => e.id === editingEntryId.value)
  if (!entry)
    return

  // 更新记忆内容
  entry.text = entryForm.value.text.trim()
  entry.kind = entryForm.value.kind
  entry.tags = entryForm.value.tags
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0)
  entry.metadata = {
    ...entry.metadata,
    certainty: 'confirmed',
    updatedAt: Date.now(),
  }

  // 触发保存
  notebookStore.saveToStorage()

  // 关闭编辑表单
  editingEntryId.value = null
}

// 取消编辑
function cancelEditEntry() {
  editingEntryId.value = null
}

// 批量删除
function deleteSelected() {
  if (selectedEntries.value.size === 0)
    return
  requestConfirmation(t('settings.pages.memory.confirm.delete-selected', { count: selectedEntries.value.size }), () => {
    selectedEntries.value.forEach(id => notebookStore.removeEntry(id))
    selectedEntries.value.clear()
    isSelectionMode.value = false
  })
}

// 删除关键词
function deleteKeyword(id: string) {
  requestConfirmation(t('settings.pages.memory.confirm.delete-keyword'), () => {
    memorySettings.deleteKeyword(id)
  })
}

// 切换关键词启用状态
function toggleKeyword(id: string) {
  memorySettings.toggleKeyword(id)
}

// 打开添加关键词表单
function openAddKeyword() {
  keywordForm.value = {
    keyword: '',
    importance: 'medium',
    tags: '',
    description: '',
    enabled: true,
  }
  editingKeywordId.value = null
  isAddingKeyword.value = true
}

// 打开编辑关键词表单
function openEditKeyword(id: string) {
  const keyword = memorySettings.customKeywords.find(k => k.id === id)
  if (keyword) {
    keywordForm.value = {
      keyword: keyword.keyword,
      importance: keyword.importance,
      tags: keyword.tags.join(', '),
      description: keyword.description || '',
      enabled: keyword.enabled,
    }
    editingKeywordId.value = id
    isAddingKeyword.value = true
  }
}

// 保存关键词
function saveKeyword() {
  if (!keywordForm.value.keyword.trim())
    return

  const tags = keywordForm.value.tags
    .split(',')
    .map(t => t.trim())
    .filter(t => t.length > 0)

  if (editingKeywordId.value) {
    memorySettings.updateKeyword(editingKeywordId.value, {
      keyword: keywordForm.value.keyword.trim(),
      importance: keywordForm.value.importance,
      tags,
      description: keywordForm.value.description.trim(),
      enabled: keywordForm.value.enabled,
    })
  }
  else {
    memorySettings.addKeyword({
      keyword: keywordForm.value.keyword.trim(),
      importance: keywordForm.value.importance,
      tags,
      description: keywordForm.value.description.trim(),
      enabled: keywordForm.value.enabled,
    })
  }

  isAddingKeyword.value = false
}

// 取消编辑
function cancelKeywordEdit() {
  isAddingKeyword.value = false
  editingKeywordId.value = null
}

// 扫描重复记忆
function scanDuplicates() {
  isScanning.value = true
  duplicateGroups.value = []

  const entries = notebookStore.entries || []
  const processed = new Set<string>()

  for (let i = 0; i < entries.length; i++) {
    if (processed.has(entries[i].id))
      continue

    const duplicates = []
    for (let j = i + 1; j < entries.length; j++) {
      if (processed.has(entries[j].id))
        continue

      const similarity = calculateSimilarity(entries[i].text, entries[j].text)
      if (similarity >= mergeThreshold.value) {
        duplicates.push({ entry: entries[j], similarity })
        processed.add(entries[j].id)
      }
    }

    if (duplicates.length > 0) {
      duplicateGroups.value.push({
        entry: entries[i],
        duplicates: duplicates.map(d => d.entry),
        similarity: duplicates[0].similarity,
      })
      processed.add(entries[i].id)
    }
  }

  isScanning.value = false
  hasScanned.value = true
}

// 合并防囤积统计：总条目数、当前筛选下可合并组数、合并后预计减少的条数
const mergeStats = computed(() => {
  const groups = duplicateGroups.value
  const reducible = groups.reduce((sum, group) => sum + group.duplicates.length, 0)
  return {
    total: notebookStore.entries?.length || 0,
    groups: groups.length,
    reducible,
  }
})

// 首次进入合并标签页时自动扫描一次，减少手动步骤
watch(activeTab, (tab) => {
  if (tab === 'merge' && !hasScanned.value && !isScanning.value)
    scanDuplicates()
})

// 阈值调整后自动重新扫描（防抖），让“预计可合并 N 组”实时反映当前筛选
let rescanTimer: number | undefined
watch(mergeThreshold, () => {
  window.clearTimeout(rescanTimer)
  rescanTimer = window.setTimeout(() => {
    if (hasScanned.value && !isScanning.value && !isMergingAll.value)
      scanDuplicates()
  }, 400)
})

// 执行维护
function runMaintenance() {
  requestConfirmation(t('settings.pages.memory.confirm.run-maintenance'), executeMaintenance)
}

async function executeMaintenance() {
  maintenanceResult.value = null
  try {
    const reportLines = [t('settings.pages.memory.maintenance.report-title')]
    let totalAffected = 0

    // 1. 自动去重
    if (memorySettings.settings.autoDeduplication) {
      const threshold = memorySettings.settings.deduplicationThreshold
      scanDuplicates()
      const batch = await mergeGroupsBatch()

      if (batch.merged > 0) {
        reportLines.push(t('settings.pages.memory.maintenance.report-merged', { count: batch.merged }))
        if (batch.failed > 0)
          reportLines.push(t('settings.pages.memory.maintenance.report-merge-failed', { count: batch.failed }))
        totalAffected += batch.merged

        // 记录日志
        maintenanceLog.addLog({
          type: 'manual',
          action: 'deduplication',
          details: t('settings.pages.memory.logs.details.deduplicated', { count: batch.merged, threshold }),
          affectedCount: batch.merged,
          success: batch.failed === 0,
        })
      }
      else if (batch.failed > 0) {
        reportLines.push(t('settings.pages.memory.maintenance.report-merge-failed', { count: batch.failed }))
      }
      else {
        reportLines.push(t('settings.pages.memory.maintenance.report-no-duplicates'))
      }
    }

    // 2. 自动归档
    if (memorySettings.settings.autoArchive) {
      const cutoffDate = Date.now() - (memorySettings.settings.archiveAfterDays * 24 * 60 * 60 * 1000)
      let archivedCount = 0

      notebookStore.entries.forEach((entry) => {
        if (entry.createdAt < cutoffDate && entry.kind !== 'diary' && !entry.metadata?.archivedAt) {
          entry.metadata = { ...entry.metadata, archivedAt: Date.now() }
          archivedCount++
        }
      })

      if (archivedCount > 0) {
        notebookStore.saveToStorage()
        reportLines.push(t('settings.pages.memory.maintenance.report-archived', { count: archivedCount }))
        totalAffected += archivedCount

        // 记录日志
        maintenanceLog.addLog({
          type: 'manual',
          action: 'archive',
          details: t('settings.pages.memory.logs.details.archived', { count: archivedCount, days: memorySettings.settings.archiveAfterDays }),
          affectedCount: archivedCount,
          success: true,
        })
      }
      else {
        reportLines.push(t('settings.pages.memory.maintenance.report-no-archive'))
      }
    }

    // 3. 自动清理
    if (memorySettings.settings.autoCleanup) {
      const maxMemories = memorySettings.settings.maxMemories
      const memoryScope = notebookStore.resolveMemoryScope()
      const scopedEntries = notebookStore.entries.filter(entry => notebookStore.entryBelongsToMemoryScope(entry, memoryScope))
      const currentCount = scopedEntries.length

      if (currentCount > maxMemories) {
        const toDelete = currentCount - maxMemories

        // 按重要性和时间排序
        const sortedEntries = scopedEntries.filter(entry => entry.kind === 'note'
          && entry.metadata?.importance !== 'high'
          && typeof entry.metadata?.extractedAt === 'number')
          .sort((a, b) => {
            const importanceOrder = { high: 3, medium: 2, low: 1 }
            const aImportance = importanceOrder[a.metadata?.importance as keyof typeof importanceOrder] || 1
            const bImportance = importanceOrder[b.metadata?.importance as keyof typeof importanceOrder] || 1

            if (memorySettings.settings.cleanupLowImportance) {
              if (aImportance !== bImportance)
                return aImportance - bImportance
            }

            return a.createdAt - b.createdAt
          })

        // 删除最旧的低重要性记忆
        const removableCount = Math.min(toDelete, sortedEntries.length)
        for (let i = 0; i < removableCount; i++) {
          notebookStore.removeEntry(sortedEntries[i].id)
        }

        reportLines.push(t('settings.pages.memory.maintenance.report-cleaned', { count: removableCount }))
        if (removableCount < toDelete)
          reportLines.push(t('settings.pages.memory.maintenance.report-protected', { count: toDelete - removableCount }))
        totalAffected += removableCount

        // 记录日志
        maintenanceLog.addLog({
          type: 'manual',
          action: 'cleanup',
          details: t('settings.pages.memory.logs.details.cleaned', { count: removableCount, current: currentCount, limit: maxMemories }),
          affectedCount: removableCount,
          success: true,
        })
      }
      else {
        reportLines.push(t('settings.pages.memory.maintenance.report-no-cleanup'))
      }
    }

    reportLines.push(t('settings.pages.memory.maintenance.report-complete', { count: notebookStore.entries.length }))
    maintenanceResult.value = { message: reportLines.join('\n'), tone: 'success' }

    // 如果有操作，自动切换到日志标签页
    if (totalAffected > 0) {
      activeTab.value = 'logs'
    }
  }
  catch (error) {
    console.error('[Maintenance] Failed:', error)
    const errorMsg = error instanceof Error ? error.message : String(error)
    maintenanceResult.value = {
      message: t('settings.pages.memory.maintenance.report-failed', { error: errorMsg }),
      tone: 'error',
    }

    // 记录失败日志
    maintenanceLog.addLog({
      type: 'manual',
      action: 'cleanup',
      details: t('settings.pages.memory.logs.details.failed'),
      affectedCount: 0,
      success: false,
      error: errorMsg,
    })
  }
}

// 显示维护日志
function showMaintenanceLog() {
  activeTab.value = 'logs'
}

// 中文友好的相似度计算：bigram + 关键特征匹配
function calculateSimilarity(text1: string, text2: string): number {
  // 提取 2-gram（连续2个字符）
  function getBigrams(text: string): Set<string> {
    const normalized = text.toLowerCase().replace(/\s+/g, '')
    const bigrams = new Set<string>()
    for (let i = 0; i < normalized.length - 1; i++) {
      bigrams.add(normalized.slice(i, i + 2))
    }
    return bigrams
  }

  // 提取关键特征（姓名、年龄、性别、地点等）
  function extractKeyFeatures(text: string): Set<string> {
    const features = new Set<string>()
    const lower = text.toLowerCase()

    // 姓名特征 - 更宽松的匹配
    const nameMatches = text.match(/秋医|疫医|[\u4E00-\u9FA5]{2,4}(?=[，。、是叫/])/g)
    if (nameMatches)
      nameMatches.forEach(m => features.add(`姓名:${m}`))

    // 年龄特征
    const ageMatches = text.match(/\d+岁|\d+歲/g)
    if (ageMatches)
      ageMatches.forEach(m => features.add(`年龄:${m}`))

    // 性别特征
    if (lower.includes('男'))
      features.add('性别:男')
    if (lower.includes('女'))
      features.add('性别:女')

    // 地点特征（城市名和省份）
    const cityMatches = text.match(/长沙|湖南|北京|上海|广州|深圳|成都|武汉|西安|杭州/g)
    if (cityMatches)
      cityMatches.forEach(m => features.add(`地点:${m}`))

    // 学校/机构特征
    if (text.includes('大学') || text.includes('学院')) {
      const schoolMatch = text.match(/[\u4E00-\u9FA5]+大学|[\u4E00-\u9FA5]+学院/g)
      if (schoolMatch)
        schoolMatch.forEach(m => features.add(`学校:${m}`))
    }

    return features
  }

  const bigrams1 = getBigrams(text1)
  const bigrams2 = getBigrams(text2)
  const features1 = extractKeyFeatures(text1)
  const features2 = extractKeyFeatures(text2)

  if (bigrams1.size === 0 || bigrams2.size === 0)
    return 0

  // Bigram 相似度
  const bigramIntersection = new Set([...bigrams1].filter(x => bigrams2.has(x)))
  const bigramUnion = new Set([...bigrams1, ...bigrams2])
  const jaccard = bigramIntersection.size / bigramUnion.size
  const containment1 = bigramIntersection.size / bigrams1.size
  const containment2 = bigramIntersection.size / bigrams2.size
  const maxContainment = Math.max(containment1, containment2)
  const bigramScore = Math.max(jaccard, maxContainment)

  // 关键特征匹配度
  const featureIntersection = new Set([...features1].filter(x => features2.has(x)))
  let featureBonus = 0
  if (features1.size > 0 && features2.size > 0) {
    const featureMatchRatio = featureIntersection.size / Math.min(features1.size, features2.size)
    // 如果有关键特征匹配，给予大幅加成
    featureBonus = featureMatchRatio * 0.7 // 最多加 70%
  }

  // 综合得分
  return Math.min(1.0, bigramScore + featureBonus)
}

// 提取文本中的特征（复用相似度计算中的逻辑）
function extractFeatures(text: string): string[] {
  const features: string[] = []

  // 姓名特征
  const nameMatches = text.match(/秋医|疫医|[\u4E00-\u9FA5]{2,4}(?=[，。、是叫/])/g)
  if (nameMatches)
    nameMatches.forEach(m => features.push(`姓名:${m}`))

  // 年龄特征
  const ageMatches = text.match(/\d+岁|\d+歲/g)
  if (ageMatches)
    ageMatches.forEach(m => features.push(`年龄:${m}`))

  // 性别特征
  if (text.includes('男'))
    features.push('性别:男')
  if (text.includes('女'))
    features.push('性别:女')

  // 地点特征
  const cityMatches = text.match(/长沙|湖南|北京|上海|广州|深圳|成都|武汉|西安|杭州/g)
  if (cityMatches)
    cityMatches.forEach(m => features.push(`地点:${m}`))

  // 学校特征
  const schoolMatch = text.match(/[\u4E00-\u9FA5]+大学|[\u4E00-\u9FA5]+学院/g)
  if (schoolMatch)
    schoolMatch.forEach(m => features.push(`学校:${m}`))

  // 爱好特征
  const hobbyMatches = text.match(/爱好[^，。、]+|喜欢[^，。、]+|爱玩[^，。、]+|爱吃[^，。、]+/g)
  if (hobbyMatches)
    hobbyMatches.forEach(m => features.push(`爱好:${m}`))

  // 游戏/活动节点（用户要求记住的主题）
  const gameMatches = text.match(/《[^》]+》|玩[^，。、]{2,8}(?=游戏|时|的)/g)
  if (gameMatches)
    gameMatches.forEach(m => features.push(`活动节点:${m}`))

  // 明确要求记住的内容
  if (/记住|别忘|一定要记得|帮我记录/.test(text)) {
    const rememberMatch = text.match(/(?:记住|别忘|一定要记得|帮我记录)[^，。、]{2,20}/g)
    if (rememberMatch)
      rememberMatch.forEach(m => features.push(`明确要求:${m}`))
  }

  // 特殊日期（生日、纪念日等）
  const dateMatches = text.match(/生日[是在]?\d+月\d+[日号]?|\d+月\d+[日号].*生日|纪念日/g)
  if (dateMatches)
    dateMatches.forEach(m => features.push(`特殊日期:${m}`))

  // 重要事件（发生了什么）
  const eventMatches = text.match(/完成了[^，。、]+|获得了[^，。、]+|抽到了[^，。、]+|通过了[^，。、]+/g)
  if (eventMatches)
    eventMatches.forEach(m => features.push(`事件:${m}`))

  return features
}

// 使用 AI 总结合并的记忆
async function summarizeMemories(texts: string[]): Promise<string> {
  try {
    const { useConsciousnessStore } = await import('@proj-airi/stage-ui/stores/modules/consciousness')
    const { useProvidersStore } = await import('@proj-airi/stage-ui/stores/providers')
    const { generateText } = await import('@xsai/generate-text')

    const consciousnessStore = useConsciousnessStore()
    const providersStore = useProvidersStore()

    const model = consciousnessStore.activeModel
    const providerName = consciousnessStore.activeProvider

    if (!model || !providerName) {
      console.warn('[MemorySummarize] No active model, using simple merge')
      return texts.join(' | ')
    }

    const providerConfig = providersStore.getProviderConfig(providerName)
    const provider = await providersStore.getProviderInstance(providerName)

    if (!('chat' in provider)) {
      console.warn('[MemorySummarize] Provider does not support chat, using simple merge')
      return texts.join(' | ')
    }

    const prompt = t('settings.pages.memory.merge.ai-prompt', {
      memories: texts.map((text, index) => `${index + 1}. ${text}`).join('\n'),
    })

    const chatConfig = provider.chat(model)
    const finalConfig = {
      ...chatConfig,
      ...providerConfig,
      messages: [{ role: 'user' as const, content: prompt }],
    }

    const response = await generateText(finalConfig)
    const summary = response.text?.trim() || texts.join(' | ')

    return summary
  }
  catch (error) {
    console.error('[MemorySummarize] Failed to summarize:', error)
    return texts.join(' | ')
  }
}

// 合并记忆组
function mergeGroup(group: any) {
  requestConfirmation(
    t('settings.pages.memory.confirm.merge-group', { count: group.duplicates.length + 1 }),
    () => mergeGroupNow(group),
  )
}

// rescan=false 供批量合并使用：跳过逐组 O(n²) 重扫，批末统一重扫一次
async function mergeGroupNow(group: any, rescan = true) {
  // 收集所有记忆条目（按时间排序）
  const allEntries = [group.entry, ...group.duplicates].sort((a, b) => a.createdAt - b.createdAt)

  // 提取每条记忆的特征，记录首次提及时间
  const featureTimeline: Record<string, { firstMentioned: number, text: string }> = {}

  // 识别记忆节点（主题）
  const memoryNodes: Record<string, Array<{ time: number, event: string }>> = {}

  allEntries.forEach((entry) => {
    const features = extractFeatures(entry.text)
    features.forEach((feature) => {
      // 只记录首次提及的时间
      if (!featureTimeline[feature]) {
        featureTimeline[feature] = {
          firstMentioned: entry.createdAt,
          text: entry.text,
        }
      }

      // 如果是活动节点，收集相关事件
      if (feature.startsWith('活动节点:')) {
        const nodeName = feature.replace('活动节点:', '')
        if (!memoryNodes[nodeName]) {
          memoryNodes[nodeName] = []
        }

        // 提取该条记忆中的事件
        const events = features.filter(f => f.startsWith('事件:'))
        events.forEach((event) => {
          memoryNodes[nodeName].push({
            time: entry.createdAt,
            event: event.replace('事件:', ''),
          })
        })

        // 如果没有明确事件，记录整条文本
        if (events.length === 0) {
          memoryNodes[nodeName].push({
            time: entry.createdAt,
            event: entry.text,
          })
        }
      }
    })
  })

  // 生成节点概括
  const nodeSummaries: Record<string, string> = {}
  Object.entries(memoryNodes).forEach(([nodeName, events]) => {
    const eventList = events.map((e) => {
      const date = new Date(e.time).toLocaleDateString(locale.value)
      return `${date}: ${e.event}`
    }).join('; ')
    nodeSummaries[nodeName] = t('settings.pages.memory.merge.node-summary', {
      count: events.length,
      events: eventList,
    })
  })

  // 使用 AI 总结合并文本，去除重复信息
  const allTexts = allEntries.map(e => e.text)
  const mergedText = await summarizeMemories(allTexts)
  const mergedBase = mergeDuplicates(group.entry, group.duplicates)

  // 合并标签
  const allTags = new Set<string>()
  allEntries.forEach((entry) => {
    if (entry.tags)
      entry.tags.forEach((t: string) => allTags.add(t))
  })

  // 记录原始时间线
  const timeline = allEntries.map(e => ({ time: e.createdAt, text: e.text }))

  // Save first, then remove sources. A failed write must leave the originals intact.
  const kind = group.entry.kind === 'focus' ? 'focus' : 'note'
  let mergedEntry
  if (kind === 'focus') {
    mergedEntry = await notebookStore.addFocusEntry(mergedText, {
      tags: Array.from(allTags),
      metadata: {
        ...mergedBase.metadata,
        importance: group.entry.metadata?.importance || 'medium',
        merged: true,
        timeline,
        featureTimeline, // 特征时间线：记录每个特征首次提及的时间
        memoryNodes, // 记忆节点：按主题组织的事件
        nodeSummaries, // 节点概括
        mergedCount: allEntries.length,
        originalCreatedAt: allEntries[0].createdAt, // 保留最早的创建时间
      },
    })
  }
  else {
    mergedEntry = await notebookStore.addNote(mergedText, {
      tags: Array.from(allTags),
      metadata: {
        ...mergedBase.metadata,
        importance: group.entry.metadata?.importance || 'medium',
        merged: true,
        timeline,
        featureTimeline, // 特征时间线
        memoryNodes, // 记忆节点
        nodeSummaries, // 节点概括
        mergedCount: allEntries.length,
        originalCreatedAt: allEntries[0].createdAt,
      },
    })
  }
  if (!mergedEntry)
    throw new Error('Failed to save merged memory')
  notebookStore.removeEntry(group.entry.id)
  group.duplicates.forEach((d: any) => notebookStore.removeEntry(d.id))

  // 重新扫描
  if (rescan)
    scanDuplicates()
}

// 批量合并当前筛选出的全部重复组：单组失败不中断，结束后统一重扫并返回汇总
async function mergeGroupsBatch(): Promise<{ merged: number, failed: number, reduced: number }> {
  const groups = [...duplicateGroups.value]
  let merged = 0
  let failed = 0
  let reduced = 0

  for (const group of groups) {
    try {
      await mergeGroupNow(group, false)
      merged++
      reduced += group.duplicates.length
    }
    catch (error) {
      console.error('[MemoryMerge] Failed to merge group:', error)
      failed++
    }
  }

  if (groups.length > 0)
    scanDuplicates()

  return { merged, failed, reduced }
}

// 一键合并当前筛选结果
function mergeAllGroups() {
  if (duplicateGroups.value.length === 0)
    return
  requestConfirmation(
    t('settings.pages.memory.confirm.merge-all', { count: duplicateGroups.value.length }),
    executeMergeAll,
  )
}

async function executeMergeAll() {
  isMergingAll.value = true
  mergeBatchResult.value = null
  try {
    const { merged, failed, reduced } = await mergeGroupsBatch()
    mergeBatchResult.value = {
      message: failed > 0
        ? `${t('settings.pages.memory.merge.batch-summary', { success: merged, failed, reduced })}\n${t('settings.pages.memory.merge.batch-failed', { count: failed })}`
        : t('settings.pages.memory.merge.batch-summary', { success: merged, failed, reduced }),
      tone: failed > 0 ? 'warning' : 'success',
    }

    if (merged > 0) {
      maintenanceLog.addLog({
        type: 'manual',
        action: 'merge',
        details: t('settings.pages.memory.merge.batch-summary', { success: merged, failed, reduced }),
        affectedCount: reduced,
        success: failed === 0,
      })
    }
  }
  finally {
    isMergingAll.value = false
  }
}
</script>

<template>
  <div class="flex flex-col gap-4 pb-4">
    <section :class="['border-b px-1 pb-4 airi-border-subtle']">
      <div :class="['flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between']">
        <div>
          <div :class="['mb-2 flex items-center gap-2']">
            <span :class="['i-solar:notebook-bold-duotone size-5 text-[var(--airi-accent-text)]']" />
            <h2 :class="['text-xl font-semibold']">
              {{ t('settings.pages.memory.workspace.title') }}
            </h2>
          </div>
          <p :class="['max-w-2xl text-sm airi-text-muted']">
            {{ t('settings.pages.memory.workspace.description', { count: stats.total }) }}
          </p>
        </div>

        <div :class="['flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center']">
          <button
            type="button"
            :class="[
              'airi-control-muted flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-3 text-sm font-medium',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent-focus)]',
            ]"
            @click="router.push('/settings/modules/memory-short-term')"
          >
            <span :class="['i-solar:history-outline size-4.5']" aria-hidden="true" />
            <span>{{ t('settings.pages.modules.memory-short-term.title') }}</span>
          </button>

          <div :class="['flex min-w-0 items-center gap-3 rounded-lg border px-3 py-2.5 airi-border-subtle airi-surface-panel lg:max-w-md']">
            <div :class="['size-10 shrink-0 overflow-hidden rounded-full airi-status-info']">
              <CharacterAvatarImage
                v-if="activeMemoryPersonaAvatarUrl"
                :src="activeMemoryPersonaAvatarUrl"
                :alt="activeMemoryPersonaName"
                :model-id="activeMemoryPersonaAvatarModelId"
                :class="['size-full']"
              />
              <span v-else :class="['i-solar:user-heart-bold-duotone m-2 size-6']" />
            </div>
            <div :class="['min-w-0 flex-1']">
              <div :class="['truncate text-sm font-medium']">
                {{ activeMemoryPersonaName }}
              </div>
              <div :class="['mt-0.5 text-xs airi-text-muted']">
                {{ t('settings.pages.memory.scope.current-persona') }}
              </div>
            </div>
            <span :class="['shrink-0 rounded-full px-2 py-1 text-xs airi-status-success']">
              {{ t('settings.pages.memory.scope.isolated') }}
            </span>
          </div>
        </div>
      </div>

      <div :class="['mt-4 grid gap-px overflow-hidden rounded-lg border airi-border-subtle airi-surface-panel md:grid-cols-3']">
        <div :class="['flex items-start gap-3 p-3']">
          <span :class="['i-solar:user-id-bold-duotone mt-0.5 size-4 shrink-0 text-[var(--airi-accent-text)]']" />
          <div>
            <div :class="['text-sm font-medium']">
              {{ t('settings.pages.memory.scope.private-title') }}
            </div>
            <p :class="['mt-0.5 text-xs airi-text-muted']">
              {{ t('settings.pages.memory.scope.private-description') }}
            </p>
          </div>
        </div>
        <div :class="['flex items-start gap-3 border-t p-3 airi-border-subtle md:border-l md:border-t-0']">
          <span :class="['i-solar:users-group-rounded-bold-duotone mt-0.5 size-4 shrink-0']" />
          <div>
            <div :class="['text-sm font-medium']">
              {{ t('settings.pages.memory.scope.room-title') }}
            </div>
            <p :class="['mt-0.5 text-xs airi-text-muted']">
              {{ t('settings.pages.memory.scope.room-description') }}
            </p>
          </div>
        </div>
        <div :class="['flex items-start gap-3 border-t p-3 airi-border-subtle md:border-l md:border-t-0']">
          <span :class="['i-solar:shield-check-bold-duotone mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-300']" />
          <div>
            <div :class="['text-sm font-medium']">
              {{ t('settings.pages.memory.scope.group-auto-title') }}
            </div>
            <p :class="['mt-0.5 text-xs airi-text-muted']">
              {{ t('settings.pages.memory.scope.group-auto-description') }}
            </p>
          </div>
        </div>
      </div>

      <!-- 标签页导航 -->
      <div :class="['mt-4 flex gap-1 overflow-x-auto border-b airi-border-subtle']" role="tablist">
        <button
          :class="activeTab === 'config' ? 'border-b-2 border-primary-500 text-primary-600 font-semibold dark:text-primary-400' : 'airi-text-muted'"
          class="px-4 py-2 transition-colors"
          @click="activeTab = 'config'"
        >
          {{ t('settings.pages.memory.tabs.config') }}
        </button>
        <button
          :class="activeTab === 'keywords' ? 'border-b-2 border-primary-500 text-primary-600 font-semibold dark:text-primary-400' : 'airi-text-muted'"
          class="px-4 py-2 transition-colors"
          @click="activeTab = 'keywords'"
        >
          {{ t('settings.pages.memory.tabs.keywords', { count: memorySettings.customKeywords.length }) }}
        </button>
        <button
          :class="activeTab === 'manage' ? 'border-b-2 border-primary-500 text-primary-600 font-semibold dark:text-primary-400' : 'airi-text-muted'"
          class="px-4 py-2 transition-colors"
          @click="activeTab = 'manage'"
        >
          {{ t('settings.pages.memory.tabs.manage', { count: stats.total }) }}
        </button>
        <button
          :class="activeTab === 'merge' ? 'border-b-2 border-primary-500 text-primary-600 font-semibold dark:text-primary-400' : 'airi-text-muted'"
          class="px-4 py-2 transition-colors"
          @click="activeTab = 'merge'"
        >
          {{ t('settings.pages.memory.tabs.merge') }}
        </button>
        <button
          :class="activeTab === 'maintenance' ? 'border-b-2 border-primary-500 text-primary-600 font-semibold dark:text-primary-400' : 'airi-text-muted'"
          class="px-4 py-2 transition-colors"
          @click="activeTab = 'maintenance'"
        >
          {{ t('settings.pages.memory.tabs.maintenance') }}
        </button>
        <button
          :class="activeTab === 'stats' ? 'border-b-2 border-primary-500 text-primary-600 font-semibold dark:text-primary-400' : 'airi-text-muted'"
          class="px-4 py-2 transition-colors"
          @click="activeTab = 'stats'"
        >
          {{ t('settings.pages.memory.tabs.stats') }}
        </button>
        <button
          :class="activeTab === 'logs' ? 'border-b-2 border-primary-500 text-primary-600 font-semibold dark:text-primary-400' : 'airi-text-muted'"
          class="px-4 py-2 transition-colors"
          @click="activeTab = 'logs'"
        >
          {{ t('settings.pages.memory.tabs.logs', { count: maintenanceLog.logs.length }) }}
        </button>
      </div>
    </section>

    <!-- 配置标签页 -->
    <div v-if="activeTab === 'config'" class="flex flex-col gap-4">
      <div :class="['airi-status-info rounded-xl p-4']">
        <div :class="['flex items-start gap-3']">
          <span :class="['i-solar:magic-stick-3-bold-duotone mt-0.5 size-5 shrink-0']" />
          <div>
            <div :class="['font-medium']">
              {{ t('settings.pages.memory.config.autonomy-title') }}
            </div>
            <p :class="['mt-1 text-sm opacity-80']">
              {{ t('settings.pages.memory.config.autonomy-description') }}
            </p>
          </div>
        </div>
      </div>

      <div class="airi-surface-panel rounded-xl p-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="font-medium">
              {{ t('settings.pages.memory.config.enabled-title') }}
            </div>
            <div class="text-sm airi-text-muted">
              {{ t('settings.pages.memory.config.enabled-description') }}
            </div>
          </div>
          <input
            v-model="memorySettings.settings.enabled"
            type="checkbox"
            class="h-5 w-5"
          >
        </div>
      </div>

      <div class="airi-surface-panel rounded-xl p-4">
        <div class="flex items-center justify-between">
          <div>
            <div class="font-medium">
              {{ t('settings.pages.memory.config.extract-title') }}
            </div>
            <div class="text-sm airi-text-muted">
              {{ t('settings.pages.memory.config.extract-description') }}
            </div>
          </div>
          <input
            v-model="memorySettings.settings.autoExtract"
            type="checkbox"
            class="h-5 w-5"
            :disabled="!memorySettings.settings.enabled"
          >
        </div>
      </div>
    </div>

    <!-- 关键词标签页 -->
    <div v-if="activeTab === 'keywords'" class="flex flex-col gap-4">
      <div class="airi-surface-panel rounded-xl p-4">
        <div class="flex items-center justify-between">
          <div>
            <h3 class="mb-1 text-lg font-semibold">
              {{ t('settings.pages.memory.keywords.title') }}
            </h3>
            <p class="text-sm airi-text-muted">
              {{ t('settings.pages.memory.keywords.description') }}
            </p>
          </div>
          <button
            class="airi-control-primary px-4 py-2"
            @click="openAddKeyword"
          >
            {{ t('settings.pages.memory.keywords.add') }}
          </button>
        </div>
      </div>

      <!-- 添加/编辑表单 -->
      <div v-if="isAddingKeyword" class="airi-status-info rounded-xl p-4">
        <h4 class="mb-4 font-semibold">
          {{ editingKeywordId ? t('settings.pages.memory.keywords.edit') : t('settings.pages.memory.keywords.add') }}
        </h4>

        <div class="space-y-3">
          <div>
            <label class="mb-1 block text-sm font-medium">{{ t('settings.pages.memory.keywords.pattern') }} *</label>
            <input
              v-model="keywordForm.keyword"
              type="text"
              :placeholder="t('settings.pages.memory.keywords.pattern-placeholder')"
              class="airi-input px-3 py-2"
            >
            <p class="mt-1 text-xs airi-text-muted">
              {{ t('settings.pages.memory.keywords.pattern-help') }}
            </p>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium">{{ t('settings.pages.memory.common.importance') }}</label>
            <select
              v-model="keywordForm.importance"
              class="airi-input px-3 py-2"
            >
              <option value="low">
                {{ t('settings.pages.memory.importance.low') }}
              </option>
              <option value="medium">
                {{ t('settings.pages.memory.importance.medium') }}
              </option>
              <option value="high">
                {{ t('settings.pages.memory.importance.high') }}
              </option>
            </select>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium">{{ t('settings.pages.memory.common.tags') }}</label>
            <input
              v-model="keywordForm.tags"
              type="text"
              :placeholder="t('settings.pages.memory.keywords.tags-placeholder')"
              class="airi-input px-3 py-2"
            >
            <p class="mt-1 text-xs airi-text-muted">
              {{ t('settings.pages.memory.common.tags-help') }}
            </p>
          </div>

          <div>
            <label class="mb-1 block text-sm font-medium">{{ t('settings.pages.memory.common.description') }}</label>
            <input
              v-model="keywordForm.description"
              type="text"
              :placeholder="t('settings.pages.memory.keywords.description-placeholder')"
              class="airi-input px-3 py-2"
            >
          </div>

          <div :class="['flex flex-wrap items-center gap-2']">
            <input
              v-model="keywordForm.enabled"
              type="checkbox"
              class="h-4 w-4"
            >
            <label class="text-sm">{{ t('settings.pages.memory.keywords.enable-rule') }}</label>
          </div>

          <div class="flex gap-2 pt-2">
            <button
              class="airi-control-primary px-4 py-2"
              @click="saveKeyword"
            >
              {{ t('settings.pages.memory.common.save') }}
            </button>
            <button
              class="airi-control-muted px-4 py-2"
              @click="cancelKeywordEdit"
            >
              {{ t('settings.pages.memory.common.cancel') }}
            </button>
          </div>
        </div>
      </div>

      <!-- 关键词列表 -->
      <div class="flex flex-col gap-3">
        <div
          v-for="keyword in memorySettings.customKeywords"
          :key="keyword.id"
          class="airi-surface-panel rounded-xl p-4"
          :class="{ 'opacity-50': !keyword.enabled }"
        >
          <div class="mb-2 flex items-start justify-between">
            <div class="flex-1">
              <div class="mb-2 flex items-center gap-2">
                <span
                  :class="getImportanceColor(keyword.importance)"
                  class="rounded px-2 py-1 text-xs font-medium"
                >
                  {{ t(`settings.pages.memory.importance.${keyword.importance}`) }}
                </span>
                <span class="text-sm font-mono">{{ keyword.keyword }}</span>
                <span
                  v-if="!keyword.enabled"
                  class="airi-status-neutral rounded px-2 py-1 text-xs"
                >
                  {{ t('settings.pages.memory.common.disabled') }}
                </span>
              </div>
              <p v-if="keyword.description" class="mb-2 text-sm airi-text-muted">
                {{ keyword.description }}
              </p>
              <div v-if="keyword.tags && keyword.tags.length > 0" class="flex flex-wrap gap-2">
                <span
                  v-for="tag in keyword.tags"
                  :key="tag"
                  class="airi-status-info rounded px-2 py-1 text-xs"
                >
                  #{{ tag }}
                </span>
              </div>
            </div>
            <div class="flex gap-2">
              <button
                class="text-sm text-primary-600 font-medium dark:text-primary-400 hover:text-primary-700"
                @click="toggleKeyword(keyword.id)"
              >
                {{ keyword.enabled ? t('settings.pages.memory.common.disable') : t('settings.pages.memory.common.enable') }}
              </button>
              <button
                class="airi-control-muted px-2 py-1 text-sm font-medium"
                @click="openEditKeyword(keyword.id)"
              >
                {{ t('settings.pages.memory.common.edit') }}
              </button>
              <button
                class="airi-status-danger rounded px-2 py-1 text-sm font-medium"
                @click="deleteKeyword(keyword.id)"
              >
                {{ t('settings.pages.memory.common.delete') }}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- 搜索 -->
    <div v-if="activeTab === 'manage'" class="airi-surface-panel rounded-xl p-4">
      <div class="flex gap-3">
        <input
          v-model="searchQuery"
          type="text"
          :placeholder="t('settings.pages.memory.manage.search-placeholder')"
          class="airi-input flex-1 px-4 py-2"
        >
        <button
          v-if="!isSelectionMode"
          class="airi-control-muted px-4 py-2"
          @click="isSelectionMode = true"
        >
          {{ t('settings.pages.memory.manage.select-multiple') }}
        </button>
        <template v-else>
          <button
            class="airi-status-danger rounded-lg px-4 py-2 disabled:opacity-50"
            :disabled="selectedEntries.size === 0"
            @click="deleteSelected"
          >
            {{ t('settings.pages.memory.manage.delete-selected', { count: selectedEntries.size }) }}
          </button>
          <button
            class="airi-control-muted px-4 py-2"
            @click="() => { isSelectionMode = false; selectedEntries.clear() }"
          >
            {{ t('settings.pages.memory.common.cancel') }}
          </button>
        </template>
      </div>
    </div>

    <!-- 记忆列表 -->
    <div v-if="activeTab === 'manage' && filteredEntries.length > 0" class="flex flex-col gap-3">
      <div
        v-for="entry in filteredEntries"
        :key="entry.id"
        class="airi-surface-panel rounded-xl p-4"
      >
        <div class="mb-3 flex items-start justify-between">
          <!-- 标签行 -->
          <div class="flex items-center gap-2">
            <input
              v-if="isSelectionMode"
              type="checkbox"
              :checked="selectedEntries.has(entry.id)"
              class="h-4 w-4"
              @change="(e) => {
                if ((e.target as HTMLInputElement).checked) {
                  selectedEntries.add(entry.id)
                }
                else {
                  selectedEntries.delete(entry.id)
                }
              }"
            >
            <span
              v-if="entry.metadata?.importance"
              :class="getImportanceColor(entry.metadata.importance as string)"
              class="rounded px-2 py-1 text-xs font-medium"
            >
              {{ t(`settings.pages.memory.importance.${entry.metadata.importance === 'high' ? 'high' : entry.metadata.importance === 'medium' ? 'medium' : 'normal'}`) }}
            </span>
            <span
              :class="entry.kind === 'focus' ? 'airi-status-info' : 'airi-status-neutral'"
              class="rounded px-2 py-1 text-xs font-medium"
            >
              {{ t(`settings.pages.memory.kind.${entry.kind}`) }}
            </span>
            <span :class="['rounded px-2 py-1 text-xs airi-status-neutral']">
              {{ getMemoryScopeLabel(entry) }}
            </span>
            <span
              v-if="getMemoryTypeLabel(entry)"
              :class="['rounded px-2 py-1 text-xs airi-status-info']"
            >
              {{ getMemoryTypeLabel(entry) }}
            </span>
            <span
              v-if="getCertaintyLabel(entry)"
              :class="['rounded px-2 py-1 text-xs airi-status-neutral']"
            >
              {{ getCertaintyLabel(entry) }}
              <template v-if="getMetadataNumber(entry, 'confidence') !== undefined">
                · {{ Math.round(getMetadataNumber(entry, 'confidence')! * 100) }}%
              </template>
            </span>
            <span class="text-xs airi-text-muted">
              {{ formatTime(getMemoryEventTime(entry)) }}
            </span>
          </div>
          <!-- 删除按钮 -->
          <div class="flex gap-2">
            <button
              v-if="!isSelectionMode && editingEntryId !== entry.id"
              class="text-sm text-primary-600 font-medium dark:text-primary-400 hover:text-primary-700"
              @click="openEditEntry(entry)"
            >
              {{ t('settings.pages.memory.common.edit') }}
            </button>
            <button
              v-if="!isSelectionMode && editingEntryId !== entry.id"
              class="airi-status-danger rounded px-2 py-1 text-sm font-medium"
              @click="deleteEntry(entry.id)"
            >
              {{ t('settings.pages.memory.common.delete') }}
            </button>
          </div>
        </div>

        <!-- 编辑表单 -->
        <div v-if="editingEntryId === entry.id" class="mt-3 airi-status-info rounded-lg p-3">
          <div class="space-y-3">
            <div>
              <label class="mb-1 block text-sm font-medium">{{ t('settings.pages.memory.common.content') }} *</label>
              <textarea
                v-model="entryForm.text"
                rows="3"
                class="airi-input resize-none px-3 py-2"
                :placeholder="t('settings.pages.memory.manage.content-placeholder')"
              />
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium">{{ t('settings.pages.memory.common.tags') }}</label>
              <input
                v-model="entryForm.tags"
                type="text"
                class="airi-input px-3 py-2"
                :placeholder="t('settings.pages.memory.manage.tags-placeholder')"
              >
            </div>
            <div>
              <label class="mb-1 block text-sm font-medium">{{ t('settings.pages.memory.common.type') }}</label>
              <select
                v-model="entryForm.kind"
                class="airi-input px-3 py-2"
              >
                <option value="note">
                  {{ t('settings.pages.memory.kind.note') }}
                </option>
                <option value="focus">
                  {{ t('settings.pages.memory.kind.focus') }}
                </option>
                <option value="diary">
                  {{ t('settings.pages.memory.kind.diary') }}
                </option>
              </select>
            </div>
            <div class="flex gap-2">
              <button
                class="airi-control-primary px-4 py-2"
                @click="saveEntry"
              >
                {{ t('settings.pages.memory.common.save') }}
              </button>
              <button
                class="airi-control-muted px-4 py-2"
                @click="cancelEditEntry"
              >
                {{ t('settings.pages.memory.common.cancel') }}
              </button>
            </div>
          </div>
        </div>

        <!-- 内容 -->
        <p v-if="editingEntryId !== entry.id" class="mb-2 airi-text">
          {{ entry.text }}
        </p>

        <div
          v-if="editingEntryId !== entry.id && getMetadataString(entry, 'memoryContext')"
          :class="['mb-3 flex items-start gap-2 border-l-2 px-3 py-2 airi-border-subtle']"
        >
          <span :class="['i-solar:link-circle-bold-duotone mt-0.5 size-4 shrink-0 airi-text-muted']" />
          <div>
            <div :class="['text-xs font-medium airi-text-muted']">
              {{ t('settings.pages.memory.manage.context') }}
            </div>
            <p :class="['mt-0.5 text-sm airi-text-muted']">
              {{ getMetadataString(entry, 'memoryContext') }}
            </p>
          </div>
        </div>

        <!-- 标签 -->
        <div v-if="entry.tags && entry.tags.length > 0" class="flex flex-wrap gap-2">
          <span
            v-for="tag in entry.tags"
            :key="tag"
            class="airi-status-info rounded px-2 py-1 text-xs"
          >
            #{{ tag }}
          </span>
        </div>

        <dl
          v-if="editingEntryId !== entry.id"
          :class="['mt-3 grid grid-cols-2 gap-x-4 gap-y-2 border-t pt-3 text-xs airi-border-subtle md:grid-cols-4']"
        >
          <div v-if="getMetadataNumber(entry, 'sourceCreatedAt') !== undefined">
            <dt :class="['airi-text-muted']">
              {{ t('settings.pages.memory.manage.source-time') }}
            </dt>
            <dd :class="['mt-0.5 font-medium airi-text']">
              {{ formatDateTime(getMetadataNumber(entry, 'sourceCreatedAt')!) }}
            </dd>
          </div>
          <div>
            <dt :class="['airi-text-muted']">
              {{ t('settings.pages.memory.manage.recorded-time') }}
            </dt>
            <dd :class="['mt-0.5 font-medium airi-text']">
              {{ formatDateTime(entry.createdAt) }}
            </dd>
          </div>
          <div v-if="getMetadataNumber(entry, 'updatedAt') !== undefined">
            <dt :class="['airi-text-muted']">
              {{ t('settings.pages.memory.manage.updated-time') }}
            </dt>
            <dd :class="['mt-0.5 font-medium airi-text']">
              {{ formatDateTime(getMetadataNumber(entry, 'updatedAt')!) }}
            </dd>
          </div>
          <div v-if="getMetadataNumber(entry, 'updateCount') !== undefined">
            <dt :class="['airi-text-muted']">
              {{ t('settings.pages.memory.manage.reinforced-count') }}
            </dt>
            <dd :class="['mt-0.5 font-medium airi-text']">
              {{ t('settings.pages.memory.manage.reinforced-count-value', { count: getMetadataNumber(entry, 'updateCount') }) }}
            </dd>
          </div>
          <div v-if="getMetadataNumber(entry, 'lastReferencedAt') !== undefined">
            <dt :class="['airi-text-muted']">
              {{ t('settings.pages.memory.manage.last-referenced') }}
            </dt>
            <dd :class="['mt-0.5 font-medium airi-text']">
              {{ formatDateTime(getMetadataNumber(entry, 'lastReferencedAt')!) }}
            </dd>
          </div>
          <div v-if="getMetadataString(entry, 'timeExpression')">
            <dt :class="['airi-text-muted']">
              {{ t('settings.pages.memory.manage.original-time-expression') }}
            </dt>
            <dd :class="['mt-0.5 font-medium airi-text']">
              {{ getMetadataString(entry, 'timeExpression') }}
            </dd>
          </div>
        </dl>
      </div>
    </div>

    <!-- 空状态 -->
    <div v-if="activeTab === 'manage' && filteredEntries.length === 0" class="airi-surface-panel rounded-xl p-12 text-center">
      <div class="i-solar:notebook-minimalistic-bold-duotone mx-auto mb-4 size-12 opacity-30" aria-hidden="true" />
      <p class="airi-text-muted">
        {{ searchQuery ? t('settings.pages.memory.manage.no-results') : t('settings.pages.memory.manage.empty') }}
      </p>
    </div>

    <!-- 合并标签页 -->
    <div v-if="activeTab === 'merge'" class="flex flex-col gap-4">
      <div class="airi-surface-panel rounded-xl p-4">
        <h3 class="mb-3 text-lg font-semibold">
          {{ t('settings.pages.memory.merge.title') }}
        </h3>
        <p class="mb-4 text-sm airi-text-muted">
          {{ t('settings.pages.memory.merge.description') }}
        </p>

        <!-- 防囤积统计：让长期记忆的冗余程度可见 -->
        <div :class="['mb-4 grid gap-px overflow-hidden rounded-lg border airi-border-subtle md:grid-cols-3']">
          <div :class="['flex items-center gap-3 p-3']">
            <span :class="['i-solar:notebook-minimalistic-bold-duotone size-5 shrink-0 text-[var(--airi-accent-text)]']" aria-hidden="true" />
            <div>
              <div :class="['text-lg font-semibold']">
                {{ mergeStats.total }}
              </div>
              <div :class="['text-xs airi-text-muted']">
                {{ t('settings.pages.memory.merge.stats-total') }}
              </div>
            </div>
          </div>
          <div :class="['flex items-center gap-3 border-t p-3 airi-border-subtle md:border-l md:border-t-0']">
            <span :class="['i-solar:copy-bold-duotone size-5 shrink-0']" aria-hidden="true" />
            <div>
              <div :class="['text-lg font-semibold']">
                {{ mergeStats.groups }}
              </div>
              <div :class="['text-xs airi-text-muted']">
                {{ t('settings.pages.memory.merge.stats-groups') }}
              </div>
            </div>
          </div>
          <div :class="['flex items-center gap-3 border-t p-3 airi-border-subtle md:border-l md:border-t-0']">
            <span :class="['i-solar:arrow-down-bold-duotone size-5 shrink-0']" aria-hidden="true" />
            <div>
              <div :class="['text-lg font-semibold']">
                {{ mergeStats.reducible }}
              </div>
              <div :class="['text-xs airi-text-muted']">
                {{ t('settings.pages.memory.merge.stats-reducible') }}
              </div>
            </div>
          </div>
        </div>

        <div class="mb-4">
          <label class="mb-2 block text-sm font-medium">{{ t('settings.pages.memory.merge.threshold', { value: Math.round(mergeThreshold * 100) }) }}</label>
          <input
            v-model.number="mergeThreshold"
            type="range"
            min="0.15"
            max="0.95"
            step="0.05"
            class="w-full"
          >
          <p class="mt-1 text-xs airi-text-muted">
            {{ t('settings.pages.memory.merge.threshold-help') }}
          </p>
          <p v-if="hasScanned" class="mt-1 text-xs airi-text-muted">
            {{ t('settings.pages.memory.merge.estimate', { groups: mergeStats.groups, count: mergeStats.reducible }) }}
          </p>
        </div>

        <div :class="['flex flex-wrap gap-2']">
          <button
            :class="[
              'airi-control-primary px-4 py-2 disabled:opacity-50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent-focus)]',
            ]"
            :disabled="isScanning || isMergingAll"
            @click="scanDuplicates"
          >
            {{ isScanning ? t('settings.pages.memory.merge.scanning') : t('settings.pages.memory.merge.scan') }}
          </button>
          <button
            :class="[
              'airi-status-success rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--airi-accent-focus)]',
            ]"
            :disabled="isScanning || isMergingAll || duplicateGroups.length === 0"
            @click="mergeAllGroups"
          >
            {{ isMergingAll ? t('settings.pages.memory.merge.merging-all') : t('settings.pages.memory.merge.merge-all') }}
          </button>
        </div>
      </div>

      <!-- 一键合并结果汇总 -->
      <div
        v-if="mergeBatchResult"
        role="status"
        :class="[
          'whitespace-pre-line rounded-xl p-4 text-sm',
          mergeBatchResult.tone === 'warning' ? 'airi-status-warning' : 'airi-status-success',
        ]"
      >
        {{ mergeBatchResult.message }}
      </div>

      <!-- 重复记忆组 -->
      <div v-if="duplicateGroups.length > 0" class="flex flex-col gap-3">
        <div
          v-for="(group, index) in duplicateGroups"
          :key="index"
          class="airi-status-warning rounded-xl p-4"
        >
          <div class="mb-3 flex items-center justify-between">
            <div class="font-semibold">
              {{ t('settings.pages.memory.merge.group-summary', { count: group.duplicates.length + 1, similarity: Math.round(group.similarity * 100) }) }}
            </div>
            <button
              class="airi-status-warning rounded-lg px-3 py-1 text-sm"
              @click="mergeGroup(group)"
            >
              {{ t('settings.pages.memory.tabs.merge') }}
            </button>
          </div>

          <div class="space-y-2">
            <div class="airi-surface-glass rounded-lg p-3">
              <div class="mb-1 text-xs airi-text-muted">
                {{ formatTime(group.entry.createdAt) }}
              </div>
              <p class="text-sm">
                {{ group.entry.text }}
              </p>
            </div>
            <div
              v-for="dup in group.duplicates"
              :key="dup.id"
              class="airi-surface-glass rounded-lg p-3"
            >
              <div class="mb-1 text-xs airi-text-muted">
                {{ formatTime(dup.createdAt) }}
              </div>
              <p class="text-sm">
                {{ dup.text }}
              </p>
            </div>
          </div>
        </div>
      </div>

      <!-- 无重复 -->
      <div v-else-if="!isScanning && hasScanned && duplicateGroups.length === 0" class="airi-surface-panel rounded-xl p-12 text-center">
        <div class="i-solar:check-circle-bold-duotone mx-auto mb-4 size-12 opacity-30" aria-hidden="true" />
        <p class="airi-text-muted">
          {{ t('settings.pages.memory.merge.none') }}
        </p>
      </div>
    </div>

    <!-- 维护标签页 -->
    <div v-if="activeTab === 'maintenance'" class="flex flex-col gap-4">
      <div class="airi-surface-panel rounded-xl p-4">
        <h3 class="mb-3 text-lg font-semibold">
          {{ t('settings.pages.memory.maintenance.title') }}
        </h3>
        <p class="mb-4 text-sm airi-text-muted">
          {{ t('settings.pages.memory.maintenance.description') }}
        </p>
      </div>

      <div class="airi-surface-panel rounded-xl p-4">
        <h3 class="mb-3 text-lg font-semibold">
          {{ t('settings.pages.memory.maintenance.deduplication-title') }}
        </h3>

        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium">
                {{ t('settings.pages.memory.maintenance.deduplication-enable') }}
              </div>
              <div class="text-sm airi-text-muted">
                {{ t('settings.pages.memory.maintenance.deduplication-description') }}
              </div>
            </div>
            <input
              v-model="memorySettings.settings.autoDeduplication"
              type="checkbox"
              class="h-5 w-5"
            >
          </div>

          <div v-if="memorySettings.settings.autoDeduplication">
            <label class="mb-2 block text-sm font-medium">{{ t('settings.pages.memory.maintenance.deduplication-threshold', { value: Math.round(memorySettings.settings.deduplicationThreshold * 100) }) }}</label>
            <input
              v-model.number="memorySettings.settings.deduplicationThreshold"
              type="range"
              min="0.5"
              max="0.95"
              step="0.05"
              class="w-full"
            >
            <p class="mt-1 text-xs airi-text-muted">
              {{ t('settings.pages.memory.maintenance.deduplication-help') }}
            </p>
          </div>
        </div>
      </div>

      <div class="airi-surface-panel rounded-xl p-4">
        <h3 class="mb-3 text-lg font-semibold">
          {{ t('settings.pages.memory.maintenance.archive-title') }}
        </h3>

        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium">
                {{ t('settings.pages.memory.maintenance.archive-enable') }}
              </div>
              <div class="text-sm airi-text-muted">
                {{ t('settings.pages.memory.maintenance.archive-description') }}
              </div>
            </div>
            <input
              v-model="memorySettings.settings.autoArchive"
              type="checkbox"
              class="h-5 w-5"
            >
          </div>

          <div v-if="memorySettings.settings.autoArchive">
            <label class="mb-2 block text-sm font-medium">{{ t('settings.pages.memory.maintenance.archive-days') }}</label>
            <input
              v-model.number="memorySettings.settings.archiveAfterDays"
              type="number"
              min="30"
              max="365"
              class="airi-input px-3 py-2"
            >
            <p class="mt-1 text-xs airi-text-muted">
              {{ t('settings.pages.memory.maintenance.archive-help') }}
            </p>
          </div>
        </div>
      </div>

      <div class="airi-surface-panel rounded-xl p-4">
        <h3 class="mb-3 text-lg font-semibold">
          {{ t('settings.pages.memory.maintenance.cleanup-title') }}
        </h3>

        <div class="space-y-4">
          <div class="flex items-center justify-between">
            <div>
              <div class="font-medium">
                {{ t('settings.pages.memory.maintenance.cleanup-enable') }}
              </div>
              <div class="text-sm airi-text-muted">
                {{ t('settings.pages.memory.maintenance.cleanup-description') }}
              </div>
            </div>
            <input
              v-model="memorySettings.settings.autoCleanup"
              type="checkbox"
              class="h-5 w-5"
            >
          </div>

          <div v-if="memorySettings.settings.autoCleanup">
            <label class="mb-2 block text-sm font-medium">{{ t('settings.pages.memory.maintenance.max-memories') }}</label>
            <input
              v-model.number="memorySettings.settings.maxMemories"
              type="number"
              min="100"
              max="10000"
              step="100"
              class="airi-input px-3 py-2"
            >
            <p class="mt-1 text-xs airi-text-muted">
              {{ t('settings.pages.memory.maintenance.max-memories-help') }}
            </p>

            <div class="mt-3 flex items-center gap-2">
              <input
                v-model="memorySettings.settings.cleanupLowImportance"
                type="checkbox"
                class="h-4 w-4"
              >
              <label class="text-sm">{{ t('settings.pages.memory.maintenance.low-importance-first') }}</label>
            </div>
          </div>
        </div>
      </div>

      <div class="airi-status-success rounded-xl p-4">
        <h3 class="mb-3 text-lg font-semibold">
          {{ t('settings.pages.memory.maintenance.manual-title') }}
        </h3>
        <p class="mb-4 text-sm opacity-80">
          {{ t('settings.pages.memory.maintenance.manual-description') }}
        </p>

        <div class="flex gap-2">
          <button
            class="airi-status-success rounded-lg px-4 py-2"
            @click="runMaintenance"
          >
            {{ t('settings.pages.memory.maintenance.run') }}
          </button>
          <button
            class="airi-control-muted px-4 py-2"
            @click="showMaintenanceLog"
          >
            {{ t('settings.pages.memory.maintenance.view-logs') }}
          </button>
        </div>
      </div>

      <div
        v-if="maintenanceResult"
        role="status"
        :class="[
          'whitespace-pre-line rounded-xl p-4 text-sm',
          maintenanceResult.tone === 'success' ? 'airi-status-success' : 'airi-status-danger',
        ]"
      >
        {{ maintenanceResult.message }}
      </div>
    </div>

    <!-- 统计标签页 -->
    <div v-if="activeTab === 'stats'" class="grid grid-cols-2 gap-4 md:grid-cols-3">
      <div class="airi-surface-panel rounded-xl p-6">
        <div class="mb-2 inline-flex airi-status-info rounded-lg px-2 py-1 text-3xl font-bold">
          {{ stats.total }}
        </div>
        <div class="text-sm airi-text-muted">
          {{ t('settings.pages.memory.stats.total') }}
        </div>
      </div>

      <div class="airi-surface-panel rounded-xl p-6">
        <div class="mb-2 inline-flex airi-status-danger rounded-lg px-2 py-1 text-3xl font-bold">
          {{ stats.high }}
        </div>
        <div class="text-sm airi-text-muted">
          {{ t('settings.pages.memory.stats.high') }}
        </div>
      </div>

      <div class="airi-surface-panel rounded-xl p-6">
        <div class="mb-2 inline-flex airi-status-warning rounded-lg px-2 py-1 text-3xl font-bold">
          {{ stats.medium }}
        </div>
        <div class="text-sm airi-text-muted">
          {{ t('settings.pages.memory.stats.medium') }}
        </div>
      </div>

      <div class="airi-surface-panel rounded-xl p-6">
        <div class="mb-2 inline-flex airi-status-info rounded-lg px-2 py-1 text-3xl font-bold">
          {{ stats.focus }}
        </div>
        <div class="text-sm airi-text-muted">
          {{ t('settings.pages.memory.stats.focus') }}
        </div>
      </div>

      <div class="airi-surface-panel rounded-xl p-6">
        <div class="mb-2 text-3xl airi-text-muted font-bold">
          {{ stats.note }}
        </div>
        <div class="text-sm airi-text-muted">
          {{ t('settings.pages.memory.stats.note') }}
        </div>
      </div>
    </div>

    <!-- 日志标签页 -->
    <div v-if="activeTab === 'logs'" class="flex flex-col gap-4">
      <div class="airi-surface-panel rounded-xl p-4">
        <div class="mb-4 flex items-center justify-between">
          <div>
            <h3 class="text-lg font-semibold">
              {{ t('settings.pages.memory.logs.title') }}
            </h3>
            <p class="text-sm airi-text-muted">
              {{ t('settings.pages.memory.logs.description') }}
            </p>
          </div>
          <button
            class="airi-status-danger rounded-lg px-4 py-2"
            @click="maintenanceLog.clearLogs()"
          >
            {{ t('settings.pages.memory.logs.clear') }}
          </button>
        </div>

        <!-- 日志列表 -->
        <div v-if="maintenanceLog.logs.length === 0" class="py-8 text-center airi-text-muted">
          {{ t('settings.pages.memory.logs.empty') }}
        </div>
        <div v-else class="space-y-2">
          <div
            v-for="log in maintenanceLog.logs"
            :key="log.id"
            class="rounded-lg p-4"
            :class="{
              'airi-status-success': log.success,
              'airi-status-danger': !log.success,
            }"
          >
            <div class="flex items-start justify-between">
              <div class="flex-1">
                <div class="mb-1 flex items-center gap-2">
                  <span
                    class="rounded px-2 py-0.5 text-xs"
                    :class="{
                      'airi-status-info': log.type === 'auto',
                      'airi-status-neutral': log.type === 'manual',
                    }"
                  >
                    {{ log.type === 'auto' ? t('settings.pages.memory.logs.auto') : t('settings.pages.memory.logs.manual') }}
                  </span>
                  <span
                    class="rounded px-2 py-0.5 text-xs"
                    :class="{
                      'airi-status-warning': log.action === 'deduplication' || log.action === 'archive',
                      'airi-status-success': log.action === 'merge',
                      'airi-status-danger': log.action === 'cleanup',
                    }"
                  >
                    {{
                      t(`settings.pages.memory.logs.actions.${log.action}`)
                    }}
                  </span>
                  <span class="text-xs airi-text-muted">
                    {{ new Date(log.timestamp).toLocaleString(locale) }}
                  </span>
                </div>
                <div class="mb-1 text-sm">
                  {{ log.details }}
                </div>
                <div class="text-xs airi-text-muted">
                  {{ t('settings.pages.memory.logs.affected', { count: log.affectedCount }) }}
                </div>
                <div v-if="!log.success && log.error" class="mt-1 airi-status-danger rounded px-2 py-1 text-xs">
                  {{ t('settings.pages.memory.logs.error', { error: log.error }) }}
                </div>
              </div>
              <div
                class="ml-4"
                :class="{
                  'airi-text': log.success,
                  'airi-text-muted': !log.success,
                }"
              >
                <div v-if="log.success" class="i-solar:check-circle-bold text-xl" />
                <div v-else class="i-solar:close-circle-bold text-xl" />
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>

  <AlertDialogRoot :open="Boolean(confirmationRequest)">
    <AlertDialogPortal>
      <AlertDialogOverlay :class="['fixed inset-0 z-100 bg-black/45 backdrop-blur-sm']" />
      <AlertDialogContent
        :class="[
          'airi-surface-panel fixed left-1/2 top-1/2 z-101 w-[min(28rem,calc(100vw-2rem))] -translate-x-1/2 -translate-y-1/2',
          'rounded-lg p-5 shadow-xl outline-none',
        ]"
      >
        <AlertDialogTitle :class="['text-base font-semibold airi-text']">
          {{ t('settings.pages.memory.confirm.title') }}
        </AlertDialogTitle>
        <AlertDialogDescription :class="['mt-2 text-sm airi-text-muted']">
          {{ confirmationRequest?.message }}
        </AlertDialogDescription>
        <div :class="['mt-5 flex justify-end gap-2']">
          <AlertDialogCancel
            :disabled="confirmationBusy"
            :class="['airi-control-muted rounded-md px-3 py-2 text-sm']"
            @click="confirmationRequest = null"
          >
            {{ t('settings.pages.memory.common.cancel') }}
          </AlertDialogCancel>
          <AlertDialogAction
            :disabled="confirmationBusy"
            :class="['airi-status-danger rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50']"
            @click="confirmRequestedAction"
          >
            {{ confirmationBusy ? t('settings.pages.memory.confirm.working') : t('settings.pages.memory.confirm.confirm') }}
          </AlertDialogAction>
        </div>
      </AlertDialogContent>
    </AlertDialogPortal>
  </AlertDialogRoot>
</template>

<route lang="yaml">
meta:
  layout: settings
  titleKey: settings.pages.memory.title
  subtitleKey: settings.title
  descriptionKey: settings.pages.memory.description
  icon: i-solar:notebook-bold-duotone
  settingsEntry: true
  order: 5
  stageTransition:
    name: slide
    pageSpecificAvailable: true
</route>
