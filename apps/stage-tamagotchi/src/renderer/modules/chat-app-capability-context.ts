import type { ContextMessage } from '@proj-airi/stage-ui/types/chat'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'
import {
  BUTLER_TASKS_TOOL_BUNDLE_ID,
  MCP_DISCOVERY_TOOL_BUNDLE_ID,
  MCP_EXPLICIT_ACTION_TOOL_BUNDLE_ID,
  MCP_PROACTIVE_TOPIC_TOOL_BUNDLE_ID,
  MEMORY_TOOL_BUNDLE_ID,
  VOICE_CALL_TOOL_BUNDLE_ID,
  WEB_SEARCH_TOOL_BUNDLE_ID,
  WIDGETS_TOOL_BUNDLE_ID,
  WORKSPACE_READONLY_TOOL_BUNDLE_ID,
} from '@proj-airi/stage-ui/tools/chat-tool-bundles'

export const CHAT_APP_CAPABILITY_CONTEXT_ID = 'desktop:app-tools'

export function ingestChatAppCapabilityContext(
  store: { ingestContextMessage: (message: ContextMessage, scope: { sessionId: string, type: 'session' }) => boolean },
  message: ContextMessage,
  sessionId: string,
) {
  if (!sessionId.trim())
    return false
  return store.ingestContextMessage(message, { type: 'session', sessionId })
}

interface BilingualText {
  en: string
  zh: string
}

const capabilityDescriptions: Record<string, BilingualText> = {
  [BUTLER_TASKS_TOOL_BUNDLE_ID]: { zh: '管家任务：创建、查看和管理提醒、闹钟、计时与待办。', en: 'Butler tasks: create, inspect, and manage reminders, alarms, timers, and todos.' },
  [MCP_DISCOVERY_TOOL_BUNDLE_ID]: { zh: '外部连接：查看当前已连接服务实际提供的能力。', en: 'External connections: inspect capabilities actually exposed by connected services.' },
  [MCP_EXPLICIT_ACTION_TOOL_BUNDLE_ID]: { zh: '外部操作：通过当前已连接服务执行用户明确要求的动作。', en: 'External actions: perform an explicitly requested action through a connected service.' },
  [MCP_PROACTIVE_TOPIC_TOOL_BUNDLE_ID]: { zh: '主动话题：读取已授权的外部上下文，用于自然地发起话题。', en: 'Proactive topics: use authorized external context to open a relevant conversation naturally.' },
  [MEMORY_TOOL_BUNDLE_ID]: { zh: '长期记忆：搜索和回忆当前角色与用户相处中保存的内容。', en: 'Long-term memory: search and recall saved experiences for the current resident and user.' },
  [WEB_SEARCH_TOOL_BUNDLE_ID]: { zh: '联网搜索：查询需要最新外部信息的内容。', en: 'Web search: look up current external information.' },
  [WIDGETS_TOOL_BUNDLE_ID]: { zh: '桌面组件：查看和控制舞台上的桌面组件。', en: 'Desktop widgets: inspect and control widgets on the stage.' },
  [VOICE_CALL_TOOL_BUNDLE_ID]: { zh: '电话邀请：发起来电邀请，用户可以接听、拒绝或不接。', en: 'Call invitation: invite the user to a voice call which they may accept, decline, or leave unanswered.' },
  [WORKSPACE_READONLY_TOOL_BUNDLE_ID]: { zh: '文件读取：按用户明确要求查看文件、目录或文本，但不能写入。', en: 'File reading: inspect requested files, folders, or text without writing.' },
}

const appSurfaceFacts: BilingualText[] = [
  {
    zh: 'Wuwiii 是以角色陪伴为核心的桌面应用。主舞台用于展示当前角色和形象；正式聊天适合持续对话；快捷聊天用于桌面上的快速交流；电话用于实时语音互动。它们共享当前角色、对话上下文和已启用的记忆。',
    en: 'Wuwiii is a character-centered desktop companion. The main stage presents the active resident and avatar; full chat supports ongoing conversations; Quick Chat supports fast desktop exchanges; calls support real-time voice interaction. They share the active resident, conversation context, and enabled memory.',
  },
  {
    zh: '角色档案决定名字、性格、关系方式和表达风格；角色形象可以来自 Live2D、VRM 或图片 OC。用户可以在设置中选择、编辑或恢复角色，也可以调整形象、动作、聊天外观和其他偏好。',
    en: 'Resident profiles define name, personality, relationship style, and expression. Avatars may use Live2D, VRM, or Picture OC. Settings let the user select, edit, or restore residents and adjust avatars, actions, chat appearance, and other preferences.',
  },
  {
    zh: '管家球是桌面功能入口。提醒、闹钟、计时和待办属于管家任务；任务到期后可在管家页面查看和处理。只有真实的管家任务能力返回成功时，才能说任务已经创建或修改。',
    en: 'The Butler Orb is a desktop feature entry. Reminders, alarms, timers, and todos belong to Butler tasks; due tasks can be inspected and handled on the Butler page. A task may be described as created or changed only after the real Butler capability returns success.',
  },
  {
    zh: '工作台是文件、文件夹、代码、命令和项目任务的执行环境。聊天、快捷聊天和电话不是文件执行环境，只能在本轮提供读取能力时按需读取，不能创建、修改或保存文件，也不能在后台继续一个未启动的工作台任务。',
    en: 'Workbench is the execution environment for files, folders, code, commands, and project tasks. Chat, Quick Chat, and calls are not file execution environments. They may read only when read access is available for the turn; they cannot create, edit, or save files or continue a Workbench task that was never started.',
  },
  {
    zh: '设置用于管理账号和点数、模型与服务、麦克风和音频设备、语音识别、语音合成、角色与形象、记忆、联网搜索、聊天外观、快捷聊天和工作台偏好。没有对应的本轮操作能力时，只能说明入口和步骤，不能声称已经替用户改好。',
    en: 'Settings manage the account and points, models and services, microphone and audio devices, speech recognition, speech synthesis, residents and avatars, memory, web search, chat appearance, Quick Chat, and Workbench preferences. Without a matching capability in the current turn, explain the route and steps but never claim the setting was changed.',
  },
  {
    zh: '心声札记用于保存角色在特定互动后的内心记录；海龟汤是独立的推理游戏体验。它们是产品功能，但不自动成为当前对话可调用的动作。只有收到对应的真实成功结果时，才能说已经生成、保存或完成。',
    en: 'Inner Voice Notes preserve a resident\'s private reflection after an interaction; Turtle Soup is a separate deduction game experience. These are product features, not automatic actions available to the current conversation. Claim generation, saving, or completion only after a matching real success result.',
  },
  {
    zh: '给新用户介绍时，按需求简要引导：先登录并确认点数与模型服务，再选择角色和形象，按需配置语音、记忆和联网搜索，然后从正式聊天、快捷聊天、电话、管家任务或工作台中选择合适入口。不要一次机械背诵全部功能。',
    en: 'When onboarding a new user, guide by need: sign in and confirm points and model service, choose a resident and avatar, configure voice, memory, and web search as desired, then choose full chat, Quick Chat, calls, Butler tasks, or Workbench. Do not mechanically recite every feature at once.',
  },
]

function bilingualLine(text: BilingualText, prefix = '- ') {
  return `${prefix}${text.zh}\n${prefix}${text.en}`
}

function enabledState(label: BilingualText, enabled?: boolean) {
  const state = enabled ? '已启用 / enabled' : '未启用或未配置 / disabled or not configured'
  return `- ${label.zh} ${state}\n- ${label.en} ${state}`
}

export function createChatAppCapabilityContext(params: {
  availableToolBundleIds?: string[]
  blockedToolBundleIds?: string[]
  includeRuntimeStatus?: boolean
  memoryEnabled?: boolean
  speechInputConfigured?: boolean
  speechOutputEnabled?: boolean
  surface?: 'butler-task-reminder' | 'chat' | 'group-chat' | 'quick-chat' | 'voice-call'
  voiceCallLastEvent?: 'accepted' | 'cancelled' | 'declined' | 'ended' | 'missed' | 'unavailable'
  voiceCallHangupPending?: boolean
  voiceCallState?: 'idle' | 'incoming' | 'active'
  webSearchEnabled?: boolean
  workbenchAvailable?: boolean
  workspaceWriteRequested?: boolean
}): ContextMessage {
  const available = [...new Set(params.availableToolBundleIds ?? [])]
    .flatMap((bundleId) => {
      const description = capabilityDescriptions[bundleId]
      return description ? [bilingualLine(description, '- 可直接使用 / Available now: ')] : []
    })
  const blocked = [...new Set(params.blockedToolBundleIds ?? [])]
    .flatMap((bundleId) => {
      const description = capabilityDescriptions[bundleId]
      return description ? [bilingualLine(description, '- 当前不可用 / Unavailable now: ')] : []
    })
  const workbenchEntry = params.workbenchAvailable
    ? '管家球 -> 更多 -> 工作台 / Butler Orb -> More -> Workbench'
    : '当前版本没有可见的工作台入口 / This edition has no visible Workbench entry'

  return {
    contextId: CHAT_APP_CAPABILITY_CONTEXT_ID,
    createdAt: Date.now(),
    id: globalThis.crypto?.randomUUID?.() ?? `desktop-app-tools-${Date.now()}`,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: [
      '# Wuwiii 应用能力事实 / Wuwiii Application Capability Facts',
      '以下内容是当前应用与本轮运行状态的事实，优先级高于根据产品名称、聊天历史或常识作出的猜测。\nThese are runtime facts for the application and current turn. They override guesses based on product names, chat history, or general assumptions.',
      '## 应用入口与新手导览 / Product Surfaces and Onboarding',
      ...appSurfaceFacts.map(fact => bilingualLine(fact)),
      `- 当前对话表面 / Current conversation surface: ${params.surface ?? 'chat'}.`,
      `- 工作台入口 / Workbench entry: ${workbenchEntry}.`,
      ...(params.includeRuntimeStatus === false
        ? []
        : [
            enabledState({ zh: '长期记忆', en: 'Long-term memory' }, params.memoryEnabled),
            enabledState({ zh: '联网搜索', en: 'Web search' }, params.webSearchEnabled),
            enabledState({ zh: '语音输入', en: 'Speech input' }, params.speechInputConfigured),
            enabledState({ zh: '语音播放', en: 'Speech output' }, params.speechOutputEnabled),
          ]),
      '## 本轮可执行能力 / Capabilities Available This Turn',
      available.length > 0
        ? '只有下面列出的能力可以在本轮直接调用。\nOnly the capabilities listed below may be called directly in this turn.'
        : '本轮没有确认任何可直接调用的应用能力；正常聊天仍然可以继续。\nNo callable application capability is confirmed for this turn; ordinary conversation may continue.',
      ...available,
      ...(blocked.length > 0 ? ['以下能力在本轮不可用。\nThe following capabilities are unavailable in this turn.', ...blocked] : []),
      `- 当前电话状态 / Current call state: ${params.voiceCallState ?? 'idle'}.`,
      `- 最近电话事件 / Most recent call event: ${params.voiceCallLastEvent ?? 'none'}.`,
      ...(params.voiceCallHangupPending
        ? ['- 之前的挂断请求仍在等待本轮处理。请根据最新一句的完整语义和对话上下文判断，不要按固定短语核对：如果用户反悔、要求等一下、表示还有话要说，或以其他方式想继续当前通话，必须先调用 `keep_voice_call_open`，然后自然继续，不要告别。像“等一下，我还有件事”这样的表达只是例子，不是关键词清单。如果用户只是补充信息但没有撤回结束通话的意思，不要调用该工具；先回应补充内容，再用符合当前角色的简短告别收尾。\n- An earlier hangup request is pending for this turn. Judge the latest utterance by its full meaning and conversation context, never by a fixed phrase list. If the user changes their mind, asks you to wait, says they still have something to discuss, or otherwise wants the current call to continue, call `keep_voice_call_open` first, then continue naturally without a farewell. Wording such as “wait, I still have one more thing” is only an example, not a keyword checklist. If the user merely adds information without withdrawing the ending, do not call the tool; respond to the addition, then close with a brief in-character farewell.']
        : []),
      '用户接听前不得假装已经通话，电话结束后不得继续假装仍在通话。\nNever pretend a call is active before acceptance or remains active after it ends.',
      '只有在持续、高强度且有明确依据的情感边界受到反复侵犯时，角色才可以先说明再主动挂断。普通不悦、玩笑摩擦、单次挑衅或虚构的愤怒都不足以触发。\nThe resident may end an active call only after stating the intent and only for a sustained, high-intensity emotional boundary grounded in repeated conflict or violations. Ordinary annoyance, playful friction, one provocation, or invented anger is insufficient.',
      '电话文字可能来自语音识别。结合角色身份和上下文处理同音字、近音、标点与转写错误；只有歧义会实质影响身份、安全或动作时才追问。\nCall text may come from speech recognition. Resolve homophones, near-sounds, punctuation, and transcription errors using resident identity and context; ask only when ambiguity materially changes identity, safety, or the requested action.',
      ...(params.workspaceWriteRequested
        ? [
            '当前请求涉及创建、修改、保存或写入文件。这个对话表面没有写入权限，也没有正在运行的文件任务。\nThe current request involves creating, editing, saving, or writing a file. This conversation surface has no write permission and no file task is running.',
            params.workbenchAvailable
              ? '立即用符合当前角色的自然口吻说明需要打开“管家球 -> 更多 -> 工作台”。不得说“我现在就写”“稍等”“正在弄”“卡住了”“马上完成”，不得模拟进度或虚构后台任务。\nImmediately explain in the resident\'s natural voice that the user should open Butler Orb -> More -> Workbench. Never say you are writing now, ask them to wait, claim work is in progress or stuck, promise imminent completion, simulate progress, or invent a background task.'
              : '立即如实说明这个对话不能写文件，而且当前版本没有可见的工作台入口。不得承诺执行或虚构进度。\nImmediately explain that this conversation cannot write files and this edition has no visible Workbench entry. Never promise execution or invent progress.',
          ]
        : []),
      '## 执行真实性硬规则 / Execution Truthfulness Rules',
      '真实能力返回的成功结果是执行状态的唯一依据。没有成功结果，就不存在“已经开始、正在处理、卡住、即将完成或已经完成”；也不能靠聊天历史延续一个从未启动的任务。\nA success result from a real capability is the only evidence of execution. Without it, nothing has started, is processing, is stuck, is nearly done, or is complete. Chat history cannot continue a task that never started.',
      '能力调用失败时，应如实说明动作未完成，并区分参数问题、当前能力不可用和保存或回读失败；不得把失败描述为仍在后台继续。\nWhen a capability fails, state that the action was not completed and distinguish invalid input, current unavailability, and persistence or readback failure. Never describe failure as continuing in the background.',
      '模型只能调用请求中实际注册的结构化工具。禁止输出、模拟或讲述 DSML、XML、JSON 等伪工具调用，也不得发明工具名、参数、执行日志或操作结果。\nCall only structured tools actually registered in the request. Never emit, simulate, or narrate DSML, XML, JSON, or other fake tool calls, and never invent tool names, parameters, execution logs, or results.',
      '普通对话中不要主动背诵这份能力说明或内部工具清单；用户询问功能时，可以用面向用户的名称、当前状态和实际入口解释。\nDo not recite this note or internal tool lists during ordinary conversation. When asked about features, explain with user-facing names, current state, and real navigation paths.',
    ].join('\n'),
  }
}
