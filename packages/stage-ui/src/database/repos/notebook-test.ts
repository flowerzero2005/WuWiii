// 测试脚本：验证 notebook 数据库保存功能
import { notebookRepo } from './notebook.repo'

async function testNotebookSave() {
  console.info('=== Notebook Database Save Test ===')

  try {
    // 1. 清除旧数据
    console.info('\n1. Clearing old data...')
    await notebookRepo.clear('test-character')

    // 2. 保存测试数据
    console.info('\n2. Saving test data...')
    const testData = {
      entries: [
        {
          id: 'test-1',
          kind: 'note' as const,
          text: '测试记忆：这是第一条测试数据',
          createdAt: Date.now(),
          tags: ['测试', '系统'],
          metadata: { importance: 'high', test: true },
        },
        {
          id: 'test-2',
          kind: 'focus' as const,
          text: '测试记忆：这是第二条测试数据',
          createdAt: Date.now(),
          tags: ['测试', '焦点'],
          metadata: { importance: 'high', test: true },
        },
      ],
      tasks: [],
      version: 0,
    }

    await notebookRepo.save('test-character', testData)
    console.info('✓ Save completed')

    // 3. 读取数据验证
    console.info('\n3. Loading data to verify...')
    const loaded = await notebookRepo.load('test-character')

    if (!loaded) {
      console.error('✗ Failed: No data loaded')
      return false
    }

    console.info('✓ Data loaded:', {
      entries: loaded.entries.length,
      tasks: loaded.tasks.length,
      version: loaded.version,
    })

    // 4. 验证数据内容
    console.info('\n4. Verifying data content...')
    if (loaded.entries.length !== 2) {
      console.error('✗ Failed: Expected 2 entries, got', loaded.entries.length)
      return false
    }

    console.info('✓ Entry 1:', loaded.entries[0].text)
    console.info('✓ Entry 2:', loaded.entries[1].text)

    console.info('\n=== Test PASSED ===')
    return true
  }
  catch (error) {
    console.error('\n=== Test FAILED ===')
    console.error('Error:', error)
    return false
  }
}

// 运行测试
testNotebookSave()
