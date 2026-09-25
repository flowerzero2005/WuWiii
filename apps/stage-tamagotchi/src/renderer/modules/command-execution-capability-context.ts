import type { LLMToolRouteDiagnostic } from '@proj-airi/stage-ui/stores/llm'
import type { ContextMessage } from '@proj-airi/stage-ui/types/chat'

import type { ElectronCommandExecutionStatus } from '../../shared/eventa'
import type { ChatToolBlockedBundle, ChatToolBundleSupportSource } from './chat-tool-bundles'

import { ContextUpdateStrategy } from '@proj-airi/server-sdk'

const COMMAND_EXECUTION_CAPABILITY_CONTEXT_ID = 'desktop-workspace-tools'
const WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID = 'workspace-edit-preview'
const WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID = 'workspace-edit-apply'

function createCapabilityText(params: {
  status?: ElectronCommandExecutionStatus
  supportsTools?: boolean
  availableToolBundleIds?: string[]
  blockedToolBundleIds?: string[]
  blockedToolBundles?: ChatToolBlockedBundle[]
  bundleSupportSources?: Partial<Record<string, ChatToolBundleSupportSource>>
  lastToolRouteDiagnostic?: LLMToolRouteDiagnostic
}) {
  const { status, supportsTools } = params
  const availableToolBundleIds = new Set(params.availableToolBundleIds ?? [])
  const blockedToolBundleIds = new Set(params.blockedToolBundleIds ?? [])
  const blockedToolBundleReasons = new Map((params.blockedToolBundles ?? []).map(bundle => [bundle.bundleId, bundle.reason]))
  const supportedToolBundleSources = new Map(Object.entries(params.bundleSupportSources ?? {}))
  const blockedToolUnsupportedSources = new Map(
    (params.blockedToolBundles ?? []).map(bundle => [bundle.bundleId, bundle.unsupportedSource]),
  )
  const supportsWorkspaceEditPreview = availableToolBundleIds.has(WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID)
  const supportsWorkspaceEditApply = availableToolBundleIds.has(WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID)
  const blocksWorkspaceEditPreview = blockedToolBundleIds.has(WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID)
  const blocksWorkspaceEditApply = blockedToolBundleIds.has(WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID)
  const blocksWorkspaceEditPreviewBecauseKnownUnsupported = blockedToolBundleReasons.get(WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID) === 'bundle-known-unsupported'
  const blocksWorkspaceEditApplyBecauseKnownUnsupported = blockedToolBundleReasons.get(WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID) === 'bundle-known-unsupported'
  const previewSupportSource = supportedToolBundleSources.get(WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID)
  const applySupportSource = supportedToolBundleSources.get(WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID)
  const previewUnsupportedSource = blockedToolUnsupportedSources.get(WORKSPACE_EDIT_PREVIEW_TOOL_BUNDLE_ID)
  const applyUnsupportedSource = blockedToolUnsupportedSources.get(WORKSPACE_EDIT_APPLY_TOOL_BUNDLE_ID)

  function formatSupportedSourceText(source?: ChatToolBundleSupportSource) {
    if (source === 'direct-single-bundle-success') {
      return '已有单 bundle 直接成功记录'
    }

    if (source === 'multi-bundle-success') {
      return '来自多 bundle 成功记录'
    }

    return undefined
  }

  function formatUnsupportedSourceText(source?: string) {
    if (source === 'direct-single-bundle-failure') {
      return '已有直接失败记录'
    }

    if (source === 'fallback-inference') {
      return '已被 fallback 过程推断为不稳定'
    }

    return '已有不稳定记录'
  }

  function formatToolRouteReasonText(reason?: string) {
    switch (reason) {
      case 'provider-connection':
        return 'provider 连接失败'
      case 'compatibility-cache':
        return '工具兼容性缓存拦截'
      case 'no-tool-bundle-attempts':
        return '没有可尝试的工具 bundle'
      case 'tool-mode-failure':
        return 'provider tool-calling 通道失败'
      case 'unsupported':
        return '当前模型 / provider 不支持工具调用'
      case 'transient':
        return '上游临时错误'
      case 'unknown':
        return '未知错误'
      default:
        return undefined
    }
  }

  function formatLastToolRouteDiagnosticLine(diagnostic?: LLMToolRouteDiagnostic) {
    if (!diagnostic)
      return ''

    const reasonText = formatToolRouteReasonText(diagnostic.reason) ?? diagnostic.reason
    const baseURLText = diagnostic.providerBaseURL ? `（${diagnostic.providerBaseURL}）` : ''

    if (diagnostic.reason === 'provider-connection') {
      return `- 上一轮 LLM 请求失败原因是 provider 连接失败${baseURLText}；这不等于桌面工作区命令服务不可见，也不等于文件系统不可访问。用户询问文件或命令工具时，应说明 provider / 本地模型服务连接失败，而不是说自己看不到工作区。`
    }

    if (diagnostic.reason === 'compatibility-cache') {
      return `- 上一轮工具 bundle 被兼容性缓存跳过；这是当前模型 / provider 的工具调用记录，不是桌面命令服务失败。用户要求查看文件时，不要把缓存拦截说成工作区不存在。`
    }

    if (diagnostic.phase === 'fallback-without-tools') {
      return `- 上一轮已经降级为无工具回答${reasonText ? `，原因：${reasonText}` : ''}；这只表示 provider tool-calling 通道当前不可用，不要把它描述成命令执行工具本身失败。`
    }

    if (diagnostic.status === 'failure' && reasonText) {
      return `- 上一轮工具通道失败原因：${reasonText}；回答用户时要区分 provider 工具调用失败、provider 连接失败、以及桌面命令服务失败。`
    }

    return ''
  }

  function formatSupportedBundleLine(input: {
    previewSource?: ChatToolBundleSupportSource
    applySource?: ChatToolBundleSupportSource
  }) {
    const details: string[] = []

    if (input.previewSource) {
      details.push(`preview bundle ${formatSupportedSourceText(input.previewSource)}`)
    }

    if (input.applySource) {
      details.push(`apply bundle ${formatSupportedSourceText(input.applySource)}`)
    }

    if (details.length === 0) {
      return undefined
    }

    return `当前模型 / 提供商组合对 ${details.join('，对 ')}。`
  }

  const availableEditBundleLine = formatSupportedBundleLine({
    previewSource: previewSupportSource,
    applySource: applySupportSource,
  })
  const lastToolRouteDiagnosticLine = formatLastToolRouteDiagnosticLine(params.lastToolRouteDiagnostic)

  if (!status) {
    return `# 桌面工作区能力

当前桌面会话的工作区命令状态尚未确认。

- 不要主动声称自己已经查看过当前工作区或任何文件。
- 只有在相关工具调用成功后，才可以说自己已经看过文件或目录。
${lastToolRouteDiagnosticLine}`
  }

  if (supportsTools === false) {
    return `# 桌面工作区能力

桌面版应用已经接入工作区命令服务，但当前模型 / 提供商组合这一轮没有可用的工具调用能力。

- 不要假装自己已经读取过文件。
- 也不要笼统地说自己“始终看不了工作区”；这里只是当前模型路径暂时不能调用桌面工具。
- 如果用户要求你立即查看文件或目录，先简短说明当前轮工具不可用，再给出下一步建议。
${lastToolRouteDiagnosticLine}`
  }

  if (supportsTools === undefined) {
    return `# 桌面工作区能力

桌面版应用已经接入工作区命令服务。

- 如果用户只是在问你能不能读取、看到或访问工作区文件，先简短说明能力范围和当前权限，不要把问题改写成目录检查。
- 当用户明确要求你查看当前工作区、列出文件、寻找文件、读取代码或确认某个路径时，优先尝试调用工作区工具，不要先口头否认自己能看文件。
- 对明确执行请求，能直接调用工具时就直接调用，不要先发“我先看看”“我现在去列一下”之类的占位说明。
- 不要把原始工具调用标记、函数调用草稿、\`to=...\`、\`tool_input\`、JSON 参数块当成聊天正文发给用户。
- 工具调用成功后，先用自然语言简洁总结结果，再按需展开细节。
- 如果这一轮工具最终不可用，只在真实失败后再说明失败原因；不要在调用前先假设自己没有这项能力。
- 如果用户要求修改文件、创建文档或保存 txt/md，信息足够时直接调用 "workspace_preview_text_edit" 生成预览，不要只回复“我将准备”。
- 只有在用户明确确认应用修改后，才应该进入真正的写入步骤；确认后使用 preview 返回的 proposalId 调用 "workspace_apply_text_edit"。
${lastToolRouteDiagnosticLine}

当前桌面命令服务支持的动作：${status.supportedActions.join('、')}。`
  }

  if (supportsWorkspaceEditApply) {
    return `# 桌面工作区能力

你当前运行在桌面版，并且这一轮可以直接调用工作区工具查看当前呜异工作区。

- 如果用户只是在问你能不能读取、看到或访问工作区文件，先简短说明能力范围和当前权限，不要把问题改写成目录检查。
- 当用户明确要求你查看当前工作区、列出文件、寻找文件、读取代码或确认某个路径时，优先调用工具，不要口头说自己看不了文件。
- 对明确执行请求，能直接调用工具时就直接调用，不要先发“我先看看”“我现在去列一下”之类的占位说明。
- 不要把原始工具调用标记、函数调用草稿、\`to=...\`、\`tool_input\`、JSON 参数块当成聊天正文发给用户。
- 工具调用成功后，先用自然语言简洁总结结果，再按需展开细节。
- 使用 "workspace_list_directory" 查看目录和文件名。
- 使用 "workspace_search" 定位文件、路径片段或代码文本。
- 使用 "workspace_read_file" 读取具体文件内容，再基于读取结果回答。
- 当用户要求检查 TypeScript / Vue 类型错误时，使用 "workspace_typecheck" 对受限白名单 target 运行 typecheck。
- 当用户要求检查 ESLint / lint 结果时，使用 "workspace_lint" 对受限白名单 target 运行 lint。
- ${availableEditBundleLine ?? '当前模型 / 提供商组合已经给编辑类 bundle 放行，但是否有直接单 bundle 成功记录仍未确认。'}
- 这一轮用户已经显式授权你应用工作区文本修改；如果用户是在 preview 后说“确认 / 继续 / 保存 / 应用”，用 preview 返回的 proposalId 调用 "workspace_apply_text_edit"。
- 路径、影响范围或文件重要性不清楚时仍优先先做 preview。
- 真正 apply 时必须使用 preview 返回的 proposalId，不要重新发明一套写入参数。
- 如果 preview 结果和用户目标不一致，不要直接 apply，先说明偏差。
${lastToolRouteDiagnosticLine}

当前桌面命令服务支持的动作：${status.supportedActions.join('、')}。`
  }

  if (supportsWorkspaceEditPreview) {
    return `# 桌面工作区能力

你当前运行在桌面版，并且这一轮可以直接调用工作区工具查看当前呜异工作区。

- 如果用户只是在问你能不能读取、看到或访问工作区文件，先简短说明能力范围和当前权限，不要把问题改写成目录检查。
- 当用户明确要求你查看当前工作区、列出文件、寻找文件、读取代码或确认某个路径时，优先调用工具，不要口头说自己看不了文件。
- 对明确执行请求，能直接调用工具时就直接调用，不要先发“我先看看”“我现在去列一下”之类的占位说明。
- 不要把原始工具调用标记、函数调用草稿、\`to=...\`、\`tool_input\`、JSON 参数块当成聊天正文发给用户。
- 工具调用成功后，先用自然语言简洁总结结果，再按需展开细节。
- 使用 "workspace_list_directory" 查看目录和文件名。
- 使用 "workspace_search" 定位文件、路径片段或代码文本。
- 使用 "workspace_read_file" 读取具体文件内容，再基于读取结果回答。
- 当用户要求检查 TypeScript / Vue 类型错误时，使用 "workspace_typecheck" 对受限白名单 target 运行 typecheck。
- 当用户要求检查 ESLint / lint 结果时，使用 "workspace_lint" 对受限白名单 target 运行 lint。
- ${previewSupportSource ? `当前模型 / 提供商组合对 preview bundle ${formatSupportedSourceText(previewSupportSource)}。` : '当前模型 / 提供商组合已经给 preview bundle 放行，但是否有直接单 bundle 成功记录仍未确认。'}
- 如果用户要求修改文件、创建文档或保存 txt/md，这一轮只应先做 preview，不要直接 apply 写入；信息足够时直接调用 "workspace_preview_text_edit"，不要只回复“我将准备”。
- ${blocksWorkspaceEditApplyBecauseKnownUnsupported ? `当前模型 / 提供商组合对 apply bundle ${formatUnsupportedSourceText(applyUnsupportedSource)}；即使用户这轮想直接改，也先停留在 preview 和确认，不要硬闯 apply。` : '当前模型 / 提供商组合对 apply bundle 没有稳定兼容性记录时，即使用户这轮想直接改，也先停留在 preview 和确认，不要硬闯 apply。'}
- preview 后如果改动方向正确，再让用户明确确认一次；下一轮用户说“确认 / 继续 / 保存 / 应用”时，用 proposalId 调用 "workspace_apply_text_edit"。
- apply 阶段要引用 preview 返回的 proposalId，不要重新编造写入参数。
${lastToolRouteDiagnosticLine}

当前桌面命令服务支持的动作：${status.supportedActions.join('、')}。`
  }

  if (blocksWorkspaceEditPreview || blocksWorkspaceEditApply) {
    return `# 桌面工作区能力

你当前运行在桌面版，并且这一轮可以直接调用工作区工具查看当前呜异工作区。

- 如果用户只是在问你能不能读取、看到或访问工作区文件，先简短说明能力范围和当前权限，不要把问题改写成目录检查。
- 当用户明确要求你查看当前工作区、列出文件、寻找文件、读取代码或确认某个路径时，优先调用工具，不要口头说自己看不了文件。
- 对明确执行请求，能直接调用工具时就直接调用，不要先发“我先看看”“我现在去列一下”之类的占位说明。
- 不要把原始工具调用标记、函数调用草稿、\`to=...\`、\`tool_input\`、JSON 参数块当成聊天正文发给用户。
- 工具调用成功后，先用自然语言简洁总结结果，再按需展开细节。
- 使用 "workspace_list_directory" 查看目录和文件名。
- 使用 "workspace_search" 定位文件、路径片段或代码文本。
- 使用 "workspace_read_file" 读取具体文件内容，再基于读取结果回答。
- 当用户要求检查 TypeScript / Vue 类型错误时，使用 "workspace_typecheck" 对受限白名单 target 运行 typecheck。
- 当用户要求检查 ESLint / lint 结果时，使用 "workspace_lint" 对受限白名单 target 运行 lint。
- ${blocksWorkspaceEditPreviewBecauseKnownUnsupported || blocksWorkspaceEditApplyBecauseKnownUnsupported ? `当前模型 / 提供商组合对编辑类 bundle ${formatUnsupportedSourceText(previewUnsupportedSource ?? applyUnsupportedSource)}；这一轮不要主动尝试 preview 或 apply。` : '当前模型 / 提供商组合对编辑类 bundle 没有稳定兼容性记录；这一轮不要主动尝试 preview 或 apply。'}
- 如果用户明确要求修改文件，先解释这一轮编辑工具没有放行，再继续通过阅读、分析、给出 patch 建议来保持聊天不中断。
${lastToolRouteDiagnosticLine}

当前桌面命令服务支持的动作：${status.supportedActions.join('、')}。`
  }

  return `# 桌面工作区能力

你当前运行在桌面版，并且这一轮可以直接调用工作区工具查看当前呜异工作区。

- 如果用户只是在问你能不能读取、看到或访问工作区文件，先简短说明能力范围和当前权限，不要把问题改写成目录检查。
- 当用户明确要求你查看当前工作区、列出文件、寻找文件、读取代码或确认某个路径时，优先调用工具，不要口头说自己看不了文件。
- 对明确执行请求，能直接调用工具时就直接调用，不要先发“我先看看”“我现在去列一下”之类的占位说明。
- 不要把原始工具调用标记、函数调用草稿、\`to=...\`、\`tool_input\`、JSON 参数块当成聊天正文发给用户。
- 工具调用成功后，先用自然语言简洁总结结果，再按需展开细节。
- 使用 "workspace_list_directory" 查看目录和文件名。
- 使用 "workspace_search" 定位文件、路径片段或代码文本。
- 使用 "workspace_read_file" 读取具体文件内容，再基于读取结果回答。
- 当用户要求检查 TypeScript / Vue 类型错误时，使用 "workspace_typecheck" 对受限白名单 target 运行 typecheck。
- 当用户要求检查 ESLint / lint 结果时，使用 "workspace_lint" 对受限白名单 target 运行 lint。
- 只有在某次工具调用真的失败时，才说明失败原因；在调用前不要假设自己没有这项能力。
- 如果用户要求修改文件、创建文档或保存 txt/md，信息足够时直接调用 "workspace_preview_text_edit" 生成预览，不要只回复“我将准备”。
- 只有在用户明确确认应用修改后，才应该进入真正的写入步骤；确认后使用 preview 返回的 proposalId 调用 "workspace_apply_text_edit"。
${lastToolRouteDiagnosticLine}

当前桌面命令服务支持的动作：${status.supportedActions.join('、')}。`
}

export function createCommandExecutionCapabilityContext(params: {
  status?: ElectronCommandExecutionStatus
  supportsTools?: boolean
  availableToolBundleIds?: string[]
  blockedToolBundleIds?: string[]
  blockedToolBundles?: ChatToolBlockedBundle[]
  bundleSupportSources?: Partial<Record<string, ChatToolBundleSupportSource>>
  lastToolRouteDiagnostic?: LLMToolRouteDiagnostic
}): ContextMessage {
  return {
    id: globalThis.crypto?.randomUUID?.() ?? `desktop-workspace-tools-${Date.now()}`,
    contextId: COMMAND_EXECUTION_CAPABILITY_CONTEXT_ID,
    strategy: ContextUpdateStrategy.ReplaceSelf,
    text: createCapabilityText(params),
    createdAt: Date.now(),
  }
}
