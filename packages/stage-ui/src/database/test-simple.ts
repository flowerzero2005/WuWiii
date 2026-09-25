/**
 * 简化版测试脚本 - 用于在实际应用中快速验证记忆系统
 *
 * 使用方法（在浏览器控制台）：
 *
 * import { quickCheck } from '@proj-rin/stage-ui/database/test-simple'
 * await quickCheck()
 */

import { useCharacterNotebookStore } from '../stores/character/notebook'
import { analyzeMessageImportance } from '../stores/chat/memory-heuristics'
import { useMemoryManager } from '../stores/chat/memory-manager'

/**
 * 快速检查记忆系统是否正常工作
 */
export async function quickCheck() {
  console.info('🔍 快速检查记忆系统...\n')

  const checks = []

  // 1. 检查规则匹配
  console.info('1️⃣ 检查规则匹配...')
  const testMessage = '我叫测试用户，喜欢打游戏'
  const heuristicResult = analyzeMessageImportance(testMessage)
  const ruleCheck = heuristicResult.shouldRemember && heuristicResult.importance === 'high'
  console.info(ruleCheck ? '✅ 规则匹配正常' : '❌ 规则匹配异常')
  checks.push(ruleCheck)

  // 2. 检查 Store 初始化
  console.info('\n2️⃣ 检查 Store 初始化...')
  const notebookStore = useCharacterNotebookStore()
  await new Promise(resolve => setTimeout(resolve, 500))
  const storeCheck = notebookStore.isLoaded
  console.info(storeCheck ? '✅ Store 已加载' : '❌ Store 未加载')
  console.info(`   当前记忆数量: ${notebookStore.entries.length}`)
  checks.push(storeCheck)

  // 3. 检查数据库读写
  console.info('\n3️⃣ 检查数据库读写...')
  const beforeCount = notebookStore.entries.length
  notebookStore.addNote('快速检查测试', {
    tags: ['测试'],
    metadata: { test: true, quickCheck: true, timestamp: Date.now() },
  })
  await new Promise(resolve => setTimeout(resolve, 1000))
  const afterCount = notebookStore.entries.length
  const dbCheck = afterCount === beforeCount + 1
  console.info(dbCheck ? '✅ 数据库读写正常' : '❌ 数据库读写异常')
  checks.push(dbCheck)

  // 4. 检查记忆检索
  console.info('\n4️⃣ 检查记忆检索...')
  const memoryManager = useMemoryManager()
  const searchResults = memoryManager.searchRelevantMemories('测试', 5)
  const searchCheck = searchResults.length > 0
  console.info(searchCheck ? '✅ 记忆检索正常' : '⚠️  记忆检索无结果（可能是数据库为空）')
  console.info(`   找到 ${searchResults.length} 条相关记忆`)
  checks.push(searchCheck)

  // 清理测试数据
  const testEntry = notebookStore.entries.find(e => e.metadata?.quickCheck === true)
  if (testEntry) {
    notebookStore.removeEntry(testEntry.id)
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  // 总结
  const passedCount = checks.filter(c => c).length
  const totalCount = checks.length
  console.info(`\n${'='.repeat(50)}`)
  console.info(`检查完成: ${passedCount}/${totalCount} 通过`)

  if (passedCount === totalCount) {
    console.info('🎉 记忆系统运行正常！')
  }
  else {
    console.info('⚠️  部分功能异常，请检查详情')
  }

  return { passed: passedCount, total: totalCount, allPassed: passedCount === totalCount }
}

/**
 * 测试记忆提取（不调用 LLM）
 */
export function testExtraction(message: string) {
  console.info(`📝 测试消息: "${message}"\n`)

  const result = analyzeMessageImportance(message)

  if (!result.shouldRemember) {
    console.info('❌ 不需要记住')
    return result
  }

  console.info('✅ 需要记住')
  console.info(`   优先级: ${result.importance}`)
  console.info(`   标签: ${result.tags.join(', ')}`)
  console.info(`   匹配规则: ${result.matchedRules.map(r => r.description).join(', ')}`)
  console.info(`   摘要: ${result.summary}`)

  return result
}

/**
 * 查看当前所有记忆
 */
export function listMemories() {
  const notebookStore = useCharacterNotebookStore()

  console.info(`📚 当前记忆总数: ${notebookStore.entries.length}\n`)

  if (notebookStore.entries.length === 0) {
    console.info('暂无记忆')
    return []
  }

  notebookStore.entries.forEach((entry, index) => {
    console.info(`${index + 1}. [${entry.kind}] ${entry.text}`)
    if (entry.tags && entry.tags.length > 0) {
      console.info(`   标签: ${entry.tags.join(', ')}`)
    }
    console.info(`   创建时间: ${new Date(entry.createdAt).toLocaleString()}`)
    console.info('')
  })

  return notebookStore.entries
}

/**
 * 搜索记忆
 */
export function searchMemories(query: string, limit = 5) {
  const memoryManager = useMemoryManager()
  const results = memoryManager.searchRelevantMemories(query, limit)

  console.info(`🔍 搜索: "${query}"`)
  console.info(`找到 ${results.length} 条相关记忆\n`)

  results.forEach((entry, index) => {
    console.info(`${index + 1}. ${entry.text}`)
    if (entry.tags && entry.tags.length > 0) {
      console.info(`   标签: ${entry.tags.join(', ')}`)
    }
    console.info('')
  })

  return results
}

/**
 * 清空所有记忆（危险操作）
 */
export async function clearAllMemories(options?: { force?: boolean }) {
  const notebookStore = useCharacterNotebookStore()
  const count = notebookStore.entries.length

  if (count === 0) {
    console.info('没有记忆需要清空')
    return 0
  }

  if (!options?.force) {
    console.info(`检测到 ${count} 条记忆。若确认清空，请使用 clearAllMemories({ force: true })。`)
    return 0
  }

  const entriesToDelete = [...notebookStore.entries]
  entriesToDelete.forEach((entry) => {
    notebookStore.removeEntry(entry.id)
  })

  await new Promise(resolve => setTimeout(resolve, 500))

  console.info(`✅ 已删除 ${count} 条记忆`)
  return count
}

/**
 * 添加测试记忆
 */
export async function addTestMemory() {
  const notebookStore = useCharacterNotebookStore()

  const testMemories = [
    { text: '用户喜欢打游戏', tags: ['偏好', '游戏'], importance: 'high' },
    { text: '用户住在北京市', tags: ['地理位置'], importance: 'medium' },
    { text: '用户是程序员', tags: ['职业'], importance: 'medium' },
  ]

  console.info(`添加 ${testMemories.length} 条测试记忆...\n`)

  for (const memory of testMemories) {
    if (memory.importance === 'high') {
      notebookStore.addFocusEntry(memory.text, {
        tags: memory.tags,
        metadata: { test: true, importance: memory.importance },
      })
    }
    else {
      notebookStore.addNote(memory.text, {
        tags: memory.tags,
        metadata: { test: true, importance: memory.importance },
      })
    }
    console.info(`✅ ${memory.text}`)
  }

  await new Promise(resolve => setTimeout(resolve, 1000))

  console.info(`\n完成！当前记忆总数: ${notebookStore.entries.length}`)
}

/**
 * 删除测试记忆
 */
export async function removeTestMemories() {
  const notebookStore = useCharacterNotebookStore()

  const testEntries = notebookStore.entries.filter(e => e.metadata?.test === true)

  if (testEntries.length === 0) {
    console.info('没有测试记忆需要删除')
    return 0
  }

  console.info(`删除 ${testEntries.length} 条测试记忆...\n`)

  testEntries.forEach((entry) => {
    notebookStore.removeEntry(entry.id)
    console.info(`✅ ${entry.text}`)
  })

  await new Promise(resolve => setTimeout(resolve, 500))

  console.info(`\n完成！当前记忆总数: ${notebookStore.entries.length}`)
  return testEntries.length
}

/**
 * 显示帮助信息
 */
export function help() {
  console.info(`
📖 记忆系统简化测试工具

可用函数：

1. quickCheck()
   快速检查记忆系统是否正常工作

2. testExtraction(message)
   测试消息是否会被提取为记忆
   示例: testExtraction('我叫张三')

3. listMemories()
   查看当前所有记忆

4. searchMemories(query, limit)
   搜索记忆
   示例: searchMemories('游戏', 5)

5. addTestMemory()
   添加一些测试记忆

6. removeTestMemories()
   删除所有测试记忆

7. clearAllMemories()
   清空所有记忆（危险操作）

8. help()
   显示此帮助信息

使用示例：
  import * as test from '@proj-rin/stage-ui/database/test-simple'
  await test.quickCheck()
  test.testExtraction('我喜欢打游戏')
  test.listMemories()
  `)
}

// 默认导出所有函数
export default {
  quickCheck,
  testExtraction,
  listMemories,
  searchMemories,
  clearAllMemories,
  addTestMemory,
  removeTestMemories,
  help,
}
