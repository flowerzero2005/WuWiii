import type { WorkbenchProviderModelOption } from './workbench-model-selection'

import { describe, expect, it } from 'vitest'

import {
  inferWorkbenchTaskKind,
  resolveRecommendedWorkbenchModelSelection,

} from './workbench-model-selection'

function option(providerId: string, modelId: string, configured = true): WorkbenchProviderModelOption {
  return {
    configured,
    modelId,
    modelKey: `${providerId}::${modelId}`,
    providerId,
  }
}

describe('workbench model selection', () => {
  it('lets manual selection win', () => {
    expect(resolveRecommendedWorkbenchModelSelection({
      configuredOptions: [
        option('official-cloud', 'airi-codex'),
      ],
      mode: 'manual',
      selectedModelKey: 'custom-provider::manual-model',
      selectedProviderId: 'custom-provider',
      taskKind: 'game',
    })).toEqual({
      modelId: 'manual-model',
      modelKey: 'custom-provider::manual-model',
      providerId: 'custom-provider',
      reasonCode: 'manual-selection',
    })
  })

  it('uses the official code model for game and code tasks when configured', () => {
    for (const taskKind of ['game', 'code'] as const) {
      expect(resolveRecommendedWorkbenchModelSelection({
        configuredOptions: [
          option('openai-compatible', 'fallback-model'),
          option('official-cloud', 'airi-codex'),
        ],
        mode: 'auto',
        taskKind,
      })).toMatchObject({
        modelId: 'airi-codex',
        modelKey: 'official-cloud::airi-codex',
        providerId: 'official-cloud',
        reasonCode: 'official-codex-for-code',
      })
    }
  })

  it('uses the official long-context model for long-context tasks when configured', () => {
    expect(resolveRecommendedWorkbenchModelSelection({
      configuredOptions: [
        option('official-cloud', 'airi-long'),
      ],
      mode: 'auto',
      taskKind: 'long-context',
    })).toMatchObject({
      modelId: 'airi-long',
      modelKey: 'official-cloud::airi-long',
      providerId: 'official-cloud',
      reasonCode: 'official-long-context',
    })
  })

  it('prefers official Claude for long-context tasks and keeps manual Codex or Claude selection', () => {
    expect(resolveRecommendedWorkbenchModelSelection({
      configuredOptions: [
        option('official-cloud', 'airi-long'),
        option('official-cloud', 'airi-claude'),
      ],
      mode: 'auto',
      taskKind: 'long-context',
    })).toMatchObject({
      modelId: 'airi-claude',
      modelKey: 'official-cloud::airi-claude',
      reasonCode: 'official-claude-for-long-context',
    })

    for (const modelId of ['airi-codex', 'airi-claude']) {
      expect(resolveRecommendedWorkbenchModelSelection({
        configuredOptions: [],
        mode: 'manual',
        selectedModelKey: `official-cloud::${modelId}`,
        selectedProviderId: 'official-cloud',
        taskKind: 'document',
      })).toMatchObject({ modelId, reasonCode: 'manual-selection' })
    }
  })

  it('uses official balanced or default for ordinary workbench tasks', () => {
    expect(resolveRecommendedWorkbenchModelSelection({
      configuredOptions: [
        option('official-cloud', 'airi-default'),
        option('official-cloud', 'airi-balanced'),
      ],
      mode: 'auto',
      taskKind: 'document',
    })).toMatchObject({
      modelId: 'airi-balanced',
      reasonCode: 'official-balanced-default',
    })

    expect(resolveRecommendedWorkbenchModelSelection({
      configuredOptions: [
        option('official-cloud', 'airi-default'),
      ],
      mode: 'auto',
      taskKind: 'inspect',
    })).toMatchObject({
      modelId: 'airi-default',
      reasonCode: 'official-balanced-default',
    })
  })

  it('falls back to the first configured provider when official cloud is unavailable', () => {
    expect(resolveRecommendedWorkbenchModelSelection({
      configuredOptions: [
        option('openai-compatible', 'gpt-workbench'),
        option('official-cloud', 'airi-codex', false),
      ],
      mode: 'auto',
      taskKind: 'code',
    })).toEqual({
      modelId: 'gpt-workbench',
      modelKey: 'openai-compatible::gpt-workbench',
      providerId: 'openai-compatible',
      reasonCode: 'configured-provider-fallback',
    })
  })

  it('falls back to the active chat model when no configured provider exists', () => {
    expect(resolveRecommendedWorkbenchModelSelection({
      chatActiveModel: 'chat-model',
      chatActiveProvider: 'chat-provider',
      configuredOptions: [],
      mode: 'auto',
      taskKind: 'chat',
    })).toEqual({
      modelId: 'chat-model',
      modelKey: 'chat-provider::chat-model',
      providerId: 'chat-provider',
      reasonCode: 'chat-model-fallback',
    })
  })

  it('infers conservative task kinds from user input', () => {
    expect(inferWorkbenchTaskKind('做一个坦克大战 HTML5 game')).toBe('game')
    expect(inferWorkbenchTaskKind('修复这个项目的代码')).toBe('code')
    expect(inferWorkbenchTaskKind('总结文件，很多内容')).toBe('long-context')
    expect(inferWorkbenchTaskKind('整理一份说明文档')).toBe('document')
  })
})
