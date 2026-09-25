/**
 * 完整的记忆系统测试验证方案
 * 测试范围：
 * 1. 记忆提取（规则匹配）
 * 2. 记忆保存（IndexedDB）
 * 3. 记忆加载（从数据库）
 * 4. 记忆检索（相关性搜索）
 * 5. 记忆去重
 * 6. UI显示
 */

import { useCharacterNotebookStore } from '../stores/character/notebook'
import { calculateSimilarity, findDuplicates } from '../stores/chat/memory-deduplication'
import { analyzeMessageImportance } from '../stores/chat/memory-heuristics'
import { useMemoryManager } from '../stores/chat/memory-manager'
import { notebookRepo } from './repos/notebook.repo'

// 测试结果统计
interface TestResult {
  name: string
  passed: boolean
  message: string
  details?: any
}

const testResults: TestResult[] = []

function logTest(name: string, passed: boolean, message: string, details?: any) {
  const result = { name, passed, message, details }
  testResults.push(result)

  const icon = passed ? '✅' : '❌'
  console.info(`${icon} [Test ${testResults.length}] ${name}`)
  console.info(`   ${message}`)
  if (details) {
    console.info('   详情:', details)
  }
  console.info('')
}

/**
 * 测试 1: 规则匹配 - 高优先级
 */
function testHeuristicHighPriority() {
  console.info('=== 测试 1: 规则匹配（高优先级）===')

  const testCases = [
    { message: '我叫张三', expectedImportance: 'high', expectedTags: ['个人信息', '姓名'] },
    { message: '我喜欢打游戏', expectedImportance: 'high', expectedTags: ['偏好', '兴趣'] },
    { message: '记住我的生日是3月15日', expectedImportance: 'high', expectedTags: ['明确要求'] },
  ]

  let passed = 0
  for (const testCase of testCases) {
    const result = analyzeMessageImportance(testCase.message)
    if (result.importance === testCase.expectedImportance && result.shouldRemember) {
      passed++
      logTest(
        `规则匹配: "${testCase.message}"`,
        true,
        `正确识别为 ${testCase.expectedImportance} 优先级`,
        { tags: result.tags, matchedRules: result.matchedRules.map(r => r.description) },
      )
    }
    else {
      logTest(
        `规则匹配: "${testCase.message}"`,
        false,
        `期望 ${testCase.expectedImportance}，实际 ${result.importance}`,
        result,
      )
    }
  }

  return passed === testCases.length
}

/**
 * 测试 2: 规则匹配 - 中优先级
 */
function testHeuristicMediumPriority() {
  console.info('=== 测试 2: 规则匹配（中优先级）===')

  const testCases = [
    { message: '我住在北京市', expectedImportance: 'medium' },
    { message: '我在互联网公司工作', expectedImportance: 'medium' },
    { message: '明天要开会', expectedImportance: 'medium' },
  ]

  let passed = 0
  for (const testCase of testCases) {
    const result = analyzeMessageImportance(testCase.message)
    if (result.importance === testCase.expectedImportance && result.shouldRemember) {
      passed++
      logTest(
        `规则匹配: "${testCase.message}"`,
        true,
        `正确识别为 ${testCase.expectedImportance} 优先级`,
        { tags: result.tags },
      )
    }
    else {
      logTest(
        `规则匹配: "${testCase.message}"`,
        false,
        `期望 ${testCase.expectedImportance}，实际 ${result.importance}`,
        result,
      )
    }
  }

  return passed === testCases.length
}

/**
 * 测试 3: 规则匹配 - 不应记住
 */
function testHeuristicNoMatch() {
  console.info('=== 测试 3: 规则匹配（不应记住）===')

  const testCases = [
    '你好',
    '今天天气不错',
    '哈哈哈',
  ]

  let passed = 0
  for (const message of testCases) {
    const result = analyzeMessageImportance(message)
    if (!result.shouldRemember) {
      passed++
      logTest(
        `规则匹配: "${message}"`,
        true,
        '正确判断为不需要记住',
        { importance: result.importance },
      )
    }
    else {
      logTest(
        `规则匹配: "${message}"`,
        false,
        '错误判断为需要记住',
        result,
      )
    }
  }

  return passed === testCases.length
}

/**
 * 测试 4: 记忆保存到 IndexedDB
 */
async function testMemorySave() {
  console.info('=== 测试 4: 记忆保存到 IndexedDB ===')

  const notebookStore = useCharacterNotebookStore()

  // 等待 store 加载完成
  await new Promise(resolve => setTimeout(resolve, 500))

  const initialCount = notebookStore.entries.length
  console.info(`   初始记忆数量: ${initialCount}`)

  // 添加测试记忆
  notebookStore.addNote('测试记忆：用户喜欢吃川菜', {
    tags: ['测试', '偏好', '美食'],
    metadata: { importance: 'high', test: true, testId: 'save-test-1' },
  })

  notebookStore.addFocusEntry('测试焦点：用户名叫李四', {
    tags: ['测试', '个人信息', '姓名'],
    metadata: { importance: 'high', test: true, testId: 'save-test-2' },
  })

  // 等待自动保存
  await new Promise(resolve => setTimeout(resolve, 1000))

  const newCount = notebookStore.entries.length
  const saved = newCount === initialCount + 2

  logTest(
    '记忆保存',
    saved,
    saved ? `成功保存 2 条记忆，当前总数: ${newCount}` : `保存失败，期望 ${initialCount + 2}，实际 ${newCount}`,
    { initialCount, newCount },
  )

  return saved
}

/**
 * 测试 5: 记忆加载
 */
async function testMemoryLoad() {
  console.info('=== 测试 5: 记忆加载 ===')

  const notebookStore = useCharacterNotebookStore()

  // 直接从数据库加载
  const data = await notebookRepo.load(notebookStore.characterId)

  if (!data) {
    logTest('记忆加载', false, '数据库中没有数据')
    return false
  }

  const hasTestData = data.entries.some(e => e.metadata?.test === true)

  logTest(
    '记忆加载',
    hasTestData,
    hasTestData ? `成功从数据库加载 ${data.entries.length} 条记忆` : '数据库中没有测试数据',
    { entriesCount: data.entries.length, version: data.version },
  )

  return hasTestData
}

/**
 * 测试 6: 记忆去重 - 相似度计算
 */
function testSimilarityCalculation() {
  console.info('=== 测试 6: 记忆去重 - 相似度计算 ===')

  const testCases = [
    {
      entry1: { id: '1', kind: 'note' as const, text: '用户喜欢打游戏', createdAt: Date.now(), tags: ['偏好'] },
      entry2: { id: '2', kind: 'note' as const, text: '用户爱好打游戏', createdAt: Date.now(), tags: ['偏好'] },
      expectedSimilarity: 0.8, // 应该很相似
      description: '相似文本',
    },
    {
      entry1: { id: '3', kind: 'note' as const, text: '用户喜欢吃川菜', createdAt: Date.now(), tags: ['偏好', '美食'] },
      entry2: { id: '4', kind: 'note' as const, text: '用户住在北京', createdAt: Date.now(), tags: ['地理位置'] },
      expectedSimilarity: 0.3, // 应该不相似
      description: '不相似文本',
    },
  ]

  let passed = 0
  for (const testCase of testCases) {
    const similarity = calculateSimilarity(testCase.entry1, testCase.entry2)
    const isCorrect = testCase.expectedSimilarity > 0.7
      ? similarity >= 0.7
      : similarity < 0.7

    if (isCorrect) {
      passed++
    }

    logTest(
      `相似度计算: ${testCase.description}`,
      isCorrect,
      `相似度: ${(similarity * 100).toFixed(1)}%`,
      { text1: testCase.entry1.text, text2: testCase.entry2.text, similarity },
    )
  }

  return passed === testCases.length
}

/**
 * 测试 7: 记忆去重 - 查找重复
 */
function testFindDuplicates() {
  console.info('=== 测试 7: 记忆去重 - 查找重复 ===')

  const entries = [
    { id: '1', kind: 'note' as const, text: '用户喜欢打游戏', createdAt: Date.now(), tags: ['偏好'] },
    { id: '2', kind: 'note' as const, text: '用户爱好打游戏', createdAt: Date.now(), tags: ['偏好'] },
    { id: '3', kind: 'note' as const, text: '用户喜欢吃川菜', createdAt: Date.now(), tags: ['偏好', '美食'] },
    { id: '4', kind: 'note' as const, text: '用户住在北京', createdAt: Date.now(), tags: ['地理位置'] },
  ]

  const duplicates = findDuplicates(entries, 0.7)

  // 应该找到 1 组重复（id 1 和 2）
  const foundCorrectDuplicates = duplicates.length === 1 && duplicates[0].duplicates.length === 1

  logTest(
    '查找重复记忆',
    foundCorrectDuplicates,
    foundCorrectDuplicates ? `正确找到 ${duplicates.length} 组重复` : `期望 1 组，实际 ${duplicates.length} 组`,
    { duplicateGroups: duplicates.map(g => ({ main: g.entry.text, duplicates: g.duplicates.map(d => d.text) })) },
  )

  return foundCorrectDuplicates
}

/**
 * 测试 8: 记忆检索
 */
async function testMemorySearch() {
  console.info('=== 测试 8: 记忆检索 ===')

  const memoryManager = useMemoryManager()
  const notebookStore = useCharacterNotebookStore()

  // 确保有测试数据
  if (notebookStore.entries.length === 0) {
    notebookStore.addNote('用户喜欢打游戏', { tags: ['偏好', '游戏'] })
    notebookStore.addNote('用户住在北京市', { tags: ['地理位置'] })
    await new Promise(resolve => setTimeout(resolve, 500))
  }

  // 搜索相关记忆
  const results = memoryManager.searchRelevantMemories('游戏', 5)

  const foundRelevant = results.some(e => e.text.includes('游戏'))

  logTest(
    '记忆检索',
    foundRelevant,
    foundRelevant ? `找到 ${results.length} 条相关记忆` : '未找到相关记忆',
    { query: '游戏', results: results.map(r => r.text) },
  )

  return foundRelevant
}

/**
 * 测试 9: 完整流程 - 对话处理
 */
async function testFullConversationFlow() {
  console.info('=== 测试 9: 完整流程 - 对话处理 ===')

  const memoryManager = useMemoryManager()
  const notebookStore = useCharacterNotebookStore()

  const initialCount = notebookStore.entries.length

  // 模拟对话（使用规则匹配，不调用 LLM）
  const userMessage = '我叫王五，今年25岁'
  const assistantMessage = '你好王五！很高兴认识你。'

  console.info(`   用户: ${userMessage}`)
  console.info(`   助手: ${assistantMessage}`)

  try {
    // 注意：这会尝试调用 LLM，如果失败会降级到规则匹配
    await memoryManager.processConversationTurn(userMessage, assistantMessage)

    // 等待处理完成
    await new Promise(resolve => setTimeout(resolve, 2000))

    const newCount = notebookStore.entries.length
    const processed = newCount > initialCount

    logTest(
      '完整对话流程',
      processed,
      processed ? `成功处理对话并保存记忆，新增 ${newCount - initialCount} 条` : '未能保存记忆',
      { initialCount, newCount, userMessage },
    )

    return processed
  }
  catch (error) {
    logTest(
      '完整对话流程',
      false,
      `处理失败: ${error}`,
      { error: String(error) },
    )
    return false
  }
}

/**
 * 测试 10: 清理测试数据
 */
async function cleanupTestData() {
  console.info('=== 测试 10: 清理测试数据 ===')

  const notebookStore = useCharacterNotebookStore()

  // 删除所有标记为测试的记忆
  const testEntries = notebookStore.entries.filter(e => e.metadata?.test === true)

  for (const entry of testEntries) {
    notebookStore.removeEntry(entry.id)
  }

  await new Promise(resolve => setTimeout(resolve, 500))

  logTest(
    '清理测试数据',
    true,
    `已删除 ${testEntries.length} 条测试记忆`,
    { deletedCount: testEntries.length },
  )

  return true
}

/**
 * 主测试函数
 */
export async function runAllTests(options?: { cleanup?: boolean }) {
  console.info('╔════════════════════════════════════════════════════════════╗')
  console.info('║          记忆系统完整测试验证方案                          ║')
  console.info('╚════════════════════════════════════════════════════════════╝')
  console.info('')

  testResults.length = 0

  try {
    // 同步测试
    testHeuristicHighPriority()
    testHeuristicMediumPriority()
    testHeuristicNoMatch()
    testSimilarityCalculation()
    testFindDuplicates()

    // 异步测试
    await testMemorySave()
    await testMemoryLoad()
    await testMemorySearch()
    await testFullConversationFlow()

    // 可选：清理测试数据
    if (options?.cleanup !== false) {
      await cleanupTestData()
    }

    // 输出测试报告
    console.info('')
    console.info('╔════════════════════════════════════════════════════════════╗')
    console.info('║                      测试报告                              ║')
    console.info('╚════════════════════════════════════════════════════════════╝')
    console.info('')

    const passed = testResults.filter(r => r.passed).length
    const total = testResults.length
    const passRate = ((passed / total) * 100).toFixed(1)

    console.info(`总测试数: ${total}`)
    console.info(`通过: ${passed}`)
    console.info(`失败: ${total - passed}`)
    console.info(`通过率: ${passRate}%`)
    console.info('')

    if (passed === total) {
      console.info('🎉 所有测试通过！')
    }
    else {
      console.info('⚠️  部分测试失败，请检查详情')
      console.info('')
      console.info('失败的测试:')
      testResults.filter(r => !r.passed).forEach((r, i) => {
        console.info(`${i + 1}. ${r.name}: ${r.message}`)
      })
    }

    console.info('')
    console.info('提示: 可以在浏览器开发者工具中查看 IndexedDB (airi-notebook)')

    return { passed, total, passRate: Number.parseFloat(passRate), results: testResults }
  }
  catch (error) {
    console.error('测试执行出错:', error)
    throw error
  }
}

/**
 * 快速测试（仅规则匹配，不涉及数据库）
 */
export function runQuickTests() {
  console.info('╔════════════════════════════════════════════════════════════╗')
  console.info('║              记忆系统快速测试（仅规则匹配）                ║')
  console.info('╚════════════════════════════════════════════════════════════╝')
  console.info('')

  testResults.length = 0

  testHeuristicHighPriority()
  testHeuristicMediumPriority()
  testHeuristicNoMatch()
  testSimilarityCalculation()
  testFindDuplicates()

  const passed = testResults.filter(r => r.passed).length
  const total = testResults.length

  console.info('')
  console.info(`测试结果: ${passed}/${total} 通过`)

  return { passed, total, results: testResults }
}

// 导出单个测试函数，方便单独调试
export {
  cleanupTestData,
  testFindDuplicates,
  testFullConversationFlow,
  testHeuristicHighPriority,
  testHeuristicMediumPriority,
  testHeuristicNoMatch,
  testMemoryLoad,
  testMemorySave,
  testMemorySearch,
  testSimilarityCalculation,
}
