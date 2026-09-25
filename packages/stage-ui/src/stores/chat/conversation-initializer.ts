import type { ContextMessage } from '../../types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import { nanoid } from 'nanoid'
import { ref } from 'vue'

import { useMemoryAdvancedSettingsStore } from '../settings/memory-advanced'

const CONVERSATION_INIT_CONTEXT_ID = 'conversation-init'
const DEFAULT_CONVERSATION_INIT_SESSION_ID = '__default__'

/**
 * 对话初始化状态标志
 * 用于确保每个会话只初始化一次
 */
const conversationInitialized = ref(new Set<string>())

/**
 * 重置初始化状态
 * 在新会话开始时调用
 */
export function resetConversationInitialization(sessionId?: string) {
  if (!sessionId) {
    conversationInitialized.value.clear()
    return
  }

  conversationInitialized.value.delete(sessionId)
}

/**
 * 创建对话初始化上下文消息
 * 根据用户记忆生成个性化开场白提示
 *
 * 功能特点：
 * 1. 只在功能开启时生效（enableConversationInit）
 * 2. 每个会话只初始化一次，避免重复
 * 3. 通过 context 注入提示，不直接发送消息
 * 4. 防御性编程，失败不影响对话
 *
 * @returns ContextMessage - 包含初始化提示的上下文消息，如果不需要初始化则返回空上下文
 */
export async function createConversationInitContext(sessionId?: string): Promise<ContextMessage> {
  try {
    const resolvedSessionId = sessionId || DEFAULT_CONVERSATION_INIT_SESSION_ID

    // 检查是否已经初始化过
    if (conversationInitialized.value.has(resolvedSessionId)) {
      return createEmptyContext()
    }

    // 检查功能是否开启
    const memoryAdvancedSettings = useMemoryAdvancedSettingsStore()
    if (!memoryAdvancedSettings?.settings?.enableConversationInit) {
      return createEmptyContext()
    }

    // 确保 notebook store 已加载
    const { useCharacterNotebookStore } = await import('../character/notebook')
    const notebookStore = useCharacterNotebookStore()

    if (!notebookStore.isLoaded) {
      await notebookStore.loadFromStorage()
    }

    // 查找用户信息记忆
    // 明确区分：用户的信息 vs AI 自己的设定
    const userInfoMemory = notebookStore.entries
      .filter(notebookStore.entryBelongsToCurrentScope)
      .find((entry) => {
        const tags = entry.tags || []
        const text = entry.text.toLowerCase()

        // 排除 AI 自己的设定（包含这些关键词的记忆不是用户信息）
        const isAiSetting = text.includes('你是')
          || text.includes('你叫')
          || text.includes('你的名字')
          || text.includes('你应该')
          || text.includes('你需要')
          || text.includes('你要')
          || text.includes('你会')
          || text.includes('你可以')
          || text.includes('ai')
          || text.includes('助手')
          || text.includes('角色设定')
          || text.includes('性格')

        // 如果是 AI 设定，跳过
        if (isAiSetting) {
          return false
        }

        // 检查标签：明确标记为用户信息的
        const hasUserTag = tags.some(tag =>
          tag === '用户'
          || tag === '用户信息'
          || tag === '用户姓名'
          || tag === '我的信息'
          || tag.toLowerCase() === 'user'
          || tag.toLowerCase() === 'user info'
          || tag.toLowerCase() === 'my name',
        )

        // 检查文本：明确表示用户自己的信息
        const hasUserInfo = (text.includes('我叫')
          || text.includes('我的名字')
          || text.includes('我是')
          || text.includes('我的姓名')
          || text.includes('my name is')
          || text.includes('i am')
          || text.includes('i\'m')
          || text.includes('call me'))
        // 确保不是在描述 AI
        && !text.includes('你')
        && !text.includes('助手')

        return hasUserTag || hasUserInfo
      })

    // 构建初始化提示
    let initPrompt = ''

    // 如果有用户信息，添加用户身份部分
    if (userInfoMemory) {
      initPrompt += `【用户身份信息】
${userInfoMemory.text}

`
    }

    // 如果有任何信息，添加对话指引
    if (userInfoMemory) {
      // 标记为已初始化
      conversationInitialized.value.add(resolvedSessionId)

      // 添加对话指引
      initPrompt += `【对话指引】
这是一次新对话的开始。`

      if (userInfoMemory) {
        initPrompt += `
你已经认识这位用户。`
      }

      initPrompt += `

## 初始化原则

- 这份上下文只帮助你识别用户，以及判断哪些记忆值得在合适时机引用。
- 它不能重新定义你的身份、语气、节奏、工具能力或固定开场方式。
- 前几轮对话保持自然、简洁、留出呼吸空间，不要因为记忆存在就一次说太多。
- 如果要使用称呼，保持克制；不要顺手追加地点、偏好、计划或多层追问。
- 记忆应当跟随当前话题自然浮现，一次最多带出一个相关点。
- 不要把“我记得”“根据记忆”“我已经记住了”当固定句式。
- 如果长期记忆中的旧角色设定与当前系统提示词冲突，以当前系统提示词为准。`

      return {
        id: nanoid(),
        contextId: CONVERSATION_INIT_CONTEXT_ID,
        strategy: ContextUpdateStrategy.ReplaceSelf,
        text: initPrompt,
        createdAt: Date.now(),
      }
    }

    return createEmptyContext()
  }
  catch (error) {
    // 防御性编程：任何错误都不应影响对话
    console.error('[ConversationInit] 初始化失败，但不影响对话:', error)
    return createEmptyContext()
  }
}

/**
 * 创建空的上下文消息
 */
function createEmptyContext(): ContextMessage {
  return {
    id: nanoid(),
    contextId: CONVERSATION_INIT_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: '',
    createdAt: Date.now(),
  }
}
