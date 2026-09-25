import type { NotebookEntry } from '../character/notebook'

/**
 * 计算两个字符串的 Jaccard 相似度
 */
function jaccardSimilarity(str1: string, str2: string): number {
  const words1 = new Set(str1.toLowerCase().split(/\s+/))
  const words2 = new Set(str2.toLowerCase().split(/\s+/))

  const intersection = new Set([...words1].filter(x => words2.has(x)))
  const union = new Set([...words1, ...words2])

  return union.size === 0 ? 0 : intersection.size / union.size
}

/**
 * 计算 Levenshtein 距离（编辑距离）
 */
function levenshteinDistance(str1: string, str2: string): number {
  const len1 = str1.length
  const len2 = str2.length
  const dp: number[][] = Array.from({ length: len1 + 1 }, () => Array.from({ length: len2 + 1 }, () => 0))

  for (let i = 0; i <= len1; i++)
    dp[i][0] = i
  for (let j = 0; j <= len2; j++)
    dp[0][j] = j

  for (let i = 1; i <= len1; i++) {
    for (let j = 1; j <= len2; j++) {
      if (str1[i - 1] === str2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1]
      }
      else {
        dp[i][j] = Math.min(
          dp[i - 1][j] + 1, // 删除
          dp[i][j - 1] + 1, // 插入
          dp[i - 1][j - 1] + 1, // 替换
        )
      }
    }
  }

  return dp[len1][len2]
}

/**
 * 计算归一化的编辑距离相似度（0-1，1表示完全相同）
 */
function normalizedLevenshteinSimilarity(str1: string, str2: string): number {
  const maxLen = Math.max(str1.length, str2.length)
  if (maxLen === 0)
    return 1
  const distance = levenshteinDistance(str1, str2)
  return 1 - distance / maxLen
}

/**
 * 提取实体（人名、地名、数字等）
 */
function extractEntities(text: string): Set<string> {
  const entities = new Set<string>()

  // 提取中文人名模式（姓+名）
  const chineseNames = text.match(/[\u4E00-\u9FA5]{2,4}(?=[说是叫的])/g)
  if (chineseNames) {
    chineseNames.forEach(name => entities.add(name.toLowerCase()))
  }

  // 提取数字
  const numbers = text.match(/\d+/g)
  if (numbers) {
    numbers.forEach(num => entities.add(num))
  }

  // 提取英文单词（可能是名字或专有名词）
  const englishWords = text.match(/[A-Z][a-z]+/g)
  if (englishWords) {
    englishWords.forEach(word => entities.add(word.toLowerCase()))
  }

  return entities
}

/**
 * 计算实体重叠度
 */
function entityOverlap(str1: string, str2: string): number {
  const entities1 = extractEntities(str1)
  const entities2 = extractEntities(str2)

  if (entities1.size === 0 && entities2.size === 0)
    return 0

  const intersection = new Set([...entities1].filter(x => entities2.has(x)))
  const union = new Set([...entities1, ...entities2])

  return union.size === 0 ? 0 : intersection.size / union.size
}

/**
 * 综合相似度计算
 */
export function calculateSimilarity(entry1: NotebookEntry, entry2: NotebookEntry): number {
  // 输入验证
  if (!entry1 || !entry2 || !entry1.text || !entry2.text) {
    return 0
  }

  const text1 = entry1.text
  const text2 = entry2.text

  // 空文本检查
  if (text1.trim().length === 0 || text2.trim().length === 0) {
    return 0
  }

  // 完全相同
  if (text1 === text2) {
    return 1.0
  }

  // 标准化文本：转小写，去除所有标点和空格
  const normalize = (text: string) => {
    return text
      .toLowerCase()
      .replace(/[，。、！？；："'（）【】《》\s]/g, '')
  }

  const text1Clean = normalize(text1)
  const text2Clean = normalize(text2)

  // 标准化后完全相同
  if (text1Clean === text2Clean) {
    return 1.0
  }

  // 空文本检查（标准化后）
  if (text1Clean.length === 0 || text2Clean.length === 0) {
    return 0
  }

  // 确定哪个是短文本，哪个是长文本
  const shorterText = text1Clean.length < text2Clean.length ? text1Clean : text2Clean
  const longerText = text1Clean.length < text2Clean.length ? text2Clean : text1Clean

  // 方法1: 完全包含检测
  if (longerText.includes(shorterText)) {
    return 0.95
  }

  // 方法2: 部分包含检测 - 检查短文本的主要部分是否在长文本中
  // 例如："爱打游戏" 应该匹配 "爱好打游戏"
  if (shorterText.length >= 3) {
    // 计算有多少字符能在长文本中按顺序找到
    let matchCount = 0
    let lastIndex = -1

    for (const char of shorterText) {
      const index = longerText.indexOf(char, lastIndex + 1)
      if (index > lastIndex) {
        matchCount++
        lastIndex = index
      }
    }

    const matchRatio = matchCount / shorterText.length

    // 如果80%以上的字符都能按顺序找到，认为是高度相似
    if (matchRatio >= 0.8) {
      return Math.max(0.85, matchRatio)
    }
  }

  // 1. Jaccard 相似度（词级别）
  const jaccardScore = jaccardSimilarity(text1, text2)

  // 2. 编辑距离相似度（字符级别）
  const levenshteinScore = normalizedLevenshteinSimilarity(text1, text2)

  // 3. 实体重叠度
  const entityScore = entityOverlap(text1, text2)

  // 4. 标签重叠度
  let tagScore = 0
  if (entry1.tags && entry2.tags && entry1.tags.length > 0 && entry2.tags.length > 0) {
    const tags1 = new Set(entry1.tags.map(t => t.toLowerCase()))
    const tags2 = new Set(entry2.tags.map(t => t.toLowerCase()))
    const tagIntersection = new Set([...tags1].filter(x => tags2.has(x)))
    const tagUnion = new Set([...tags1, ...tags2])
    tagScore = tagUnion.size === 0 ? 0 : tagIntersection.size / tagUnion.size
  }

  // 加权平均
  const similarity = (
    jaccardScore * 0.4
    + levenshteinScore * 0.2
    + entityScore * 0.3
    + tagScore * 0.1
  )

  return Math.max(0, Math.min(1, similarity)) // 确保在 0-1 范围内
}

/**
 * 查找重复的记忆条目
 */
export function findDuplicates(
  entries: NotebookEntry[],
  threshold = 0.7, // 相似度阈值，超过此值认为是重复
): Array<{ entry: NotebookEntry, duplicates: NotebookEntry[] }> {
  if (!Array.isArray(entries) || entries.length === 0) {
    return []
  }

  // 过滤无效条目
  const validEntries = entries.filter(e => e && e.id && e.text && e.text.trim().length > 0)

  if (validEntries.length < 2) {
    return []
  }

  const duplicateGroups: Array<{ entry: NotebookEntry, duplicates: NotebookEntry[] }> = []
  const processed = new Set<string>()

  for (let i = 0; i < validEntries.length; i++) {
    const entry1 = validEntries[i]

    // 跳过已处理的条目
    if (processed.has(entry1.id))
      continue

    const duplicates: NotebookEntry[] = []

    for (let j = i + 1; j < validEntries.length; j++) {
      const entry2 = validEntries[j]

      // 跳过已处理的条目
      if (processed.has(entry2.id))
        continue

      const similarity = calculateSimilarity(entry1, entry2)

      if (similarity >= threshold) {
        duplicates.push(entry2)
        processed.add(entry2.id)
      }
    }

    if (duplicates.length > 0) {
      duplicateGroups.push({ entry: entry1, duplicates })
      processed.add(entry1.id)
    }
  }

  return duplicateGroups
}

/**
 * 合并重复的记忆条目
 * 保留内容最完整的条目，使用最早的创建时间，记录所有信息片段的时间线
 */
export function mergeDuplicates(
  mainEntry: NotebookEntry,
  duplicates: NotebookEntry[],
): NotebookEntry {
  if (!mainEntry || !Array.isArray(duplicates) || duplicates.length === 0) {
    return mainEntry
  }

  const allEntries = [mainEntry, ...duplicates].filter(e => e && e.text)

  if (allEntries.length === 0) {
    return mainEntry
  }

  // 找到内容最长（最完整）的条目作为基础
  const mostCompleteEntry = allEntries.reduce((longest, current) =>
    current.text.length > longest.text.length ? current : longest,
  )

  // 找到最早的创建时间（这是第一次记录相关信息的时间）
  const earliestTime = Math.min(...allEntries.map(e => e.createdAt || Date.now()))

  // 找到最新的创建时间（最后一次更新信息的时间）
  const latestTime = Math.max(...allEntries.map(e => e.createdAt || Date.now()))

  // 合并所有标签
  const allTags = new Set<string>()
  allEntries.forEach((entry) => {
    if (entry.tags && Array.isArray(entry.tags)) {
      entry.tags.forEach((tag) => {
        if (tag && typeof tag === 'string') {
          allTags.add(tag)
        }
      })
    }
  })

  // 合并元数据 - 深度合并，避免覆盖
  const mergedMetadata: Record<string, any> = {}
  allEntries.forEach((entry) => {
    if (entry.metadata) {
      for (const [key, value] of Object.entries(entry.metadata)) {
        // 如果键已存在且都是对象，则合并；否则保留第一个值
        if (key in mergedMetadata && typeof mergedMetadata[key] === 'object' && typeof value === 'object') {
          mergedMetadata[key] = { ...mergedMetadata[key], ...value }
        }
        else if (!(key in mergedMetadata)) {
          mergedMetadata[key] = value
        }
      }
    }
  })

  // 记录合并信息和时间线
  mergedMetadata.mergedFrom = duplicates.map(d => d.id)
  mergedMetadata.mergedAt = Date.now()
  mergedMetadata.mergedCount = duplicates.length
  mergedMetadata.firstRecordedAt = earliestTime // 最早记录时间
  mergedMetadata.lastUpdatedAt = latestTime // 最后更新时间

  // 记录每个被合并条目的时间和内容，用于追溯
  mergedMetadata.timeline = allEntries
    .sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
    .map(e => ({
      sourceSessionId: e.metadata?.sourceSessionId,
      sourceUserMessageId: e.metadata?.sourceUserMessageId,
      time: e.createdAt,
      text: e.text,
      tags: e.tags,
    }))

  // 返回合并后的条目
  return {
    ...mostCompleteEntry,
    createdAt: earliestTime, // 使用最早的时间作为创建时间
    tags: Array.from(allTags),
    metadata: mergedMetadata,
  }
}
