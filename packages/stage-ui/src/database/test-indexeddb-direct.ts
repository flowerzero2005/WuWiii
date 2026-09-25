import localforage from 'localforage'

// 创建专门的 notebook store
const notebookStore = localforage.createInstance({
  name: 'airi-notebook',
  storeName: 'notebooks',
  driver: [localforage.INDEXEDDB, localforage.WEBSQL, localforage.LOCALSTORAGE],
  description: 'Wuwiii Notebook Storage',
})

async function testIndexedDB() {
  console.error('========== 开始 IndexedDB 直接测试 ==========')

  try {
    // 1. 测试写入
    const testKey = 'notebook-test-direct'
    const testData = {
      entries: [
        {
          id: 'test-1',
          kind: 'note',
          text: '这是一个测试记忆',
          createdAt: Date.now(),
          tags: ['测试'],
        },
      ],
      tasks: [],
      version: 1,
      lastSyncedAt: Date.now(),
    }

    console.error('[Test] 准备写入数据:', testData)
    await notebookStore.setItem(testKey, testData)
    console.error('[Test] ========== 写入成功 ==========')

    // 2. 测试读取
    console.error('[Test] 准备读取数据...')
    const readData = await notebookStore.getItem(testKey)
    console.error('[Test] ========== 读取成功 ==========')
    console.error('[Test] 读取到的数据:', readData)

    // 3. 验证数据
    if (JSON.stringify(readData) === JSON.stringify(testData)) {
      console.error('[Test] ========== 数据验证成功！写入和读取一致 ==========')
    }
    else {
      console.error('[Test] ========== 数据验证失败！写入和读取不一致 ==========')
      console.error('[Test] 期望:', testData)
      console.error('[Test] 实际:', readData)
    }

    // 4. 清理测试数据
    await notebookStore.removeItem(testKey)
    console.error('[Test] 测试数据已清理')

    // 5. 检查实际的 notebook 数据
    console.error('[Test] 检查实际的 notebook-default 数据...')
    const actualData = await notebookStore.getItem('notebook-default')
    console.error('[Test] notebook-default 数据:', actualData)

    // 6. 列出所有键
    console.error('[Test] 列出所有存储的键...')
    const keys = await notebookStore.keys()
    console.error('[Test] 所有键:', keys)
  }
  catch (error) {
    console.error('[Test] ========== 测试失败 ==========')
    console.error('[Test] 错误:', error)
  }
}

// 导出测试函数，可以在浏览器控制台调用
if (typeof window !== 'undefined') {
  (window as any).testIndexedDB = testIndexedDB
  console.error('========== IndexedDB 测试函数已加载 ==========')
  console.error('在控制台运行: window.testIndexedDB()')
}

export { testIndexedDB }
