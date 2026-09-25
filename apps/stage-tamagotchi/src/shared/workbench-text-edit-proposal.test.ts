import type { ElectronWorkbenchAgentRuntimeGenerateTextEditProposalPayload } from './eventa'

import { describe, expect, it } from 'vitest'

import {
  buildWorkbenchTextEditGenerationPrompt,
  inferWorkbenchBrowserDemoRequest,
} from './workbench-text-edit-proposal'

function createPayload(input: string, overrides: Partial<ElectronWorkbenchAgentRuntimeGenerateTextEditProposalPayload> = {}): ElectronWorkbenchAgentRuntimeGenerateTextEditProposalPayload {
  return {
    chatConfig: {},
    input,
    selection: {
      model: 'Official Codex',
      modelKey: 'airi-codex',
      providerId: 'official-cloud',
    },
    sessionId: 'test-session',
    systemPrompt: 'system',
    workspaceRoot: 'D:/demo',
    ...overrides,
  }
}

describe('inferWorkbenchBrowserDemoRequest', () => {
  it.each([
    '创建一个坦克大战',
    '做一个小游戏',
    'make a game',
    'build a browser demo',
    'draw it with canvas',
  ])('detects browser game/demo requests: %s', (input) => {
    expect(inferWorkbenchBrowserDemoRequest(input)).toBe(true)
  })

  it('does not classify ordinary document requests as browser demos', () => {
    expect(inferWorkbenchBrowserDemoRequest('写一篇项目复盘')).toBe(false)
  })
})

describe('buildWorkbenchTextEditGenerationPrompt', () => {
  it('adds single-file browser game requirements for tank game requests', () => {
    const prompt = buildWorkbenchTextEditGenerationPrompt(createPayload('创建一个坦克大战小游戏'))

    expect(prompt).toContain('index.html')
    expect(prompt).toContain('single self-contained HTML file')
    expect(prompt).toContain('Canvas')
    expect(prompt).toContain('no external network assets')
    expect(prompt).toContain('keyboard controls')
    expect(prompt).toContain('restart button')
  })

  it('keeps compact browser demo proposals to one edit', () => {
    const prompt = buildWorkbenchTextEditGenerationPrompt(createPayload('build a browser demo'), true)

    expect(prompt).toContain('Return exactly 1 edit')
    expect(prompt).toContain('one self-contained index.html file')
  })
})
