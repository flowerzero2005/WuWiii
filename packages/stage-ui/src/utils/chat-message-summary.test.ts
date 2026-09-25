import { describe, expect, it } from 'vitest'

import { classifyAssistantToolOutcome, summarizeChatHistoryMessage } from './chat-message-summary'

describe('summarizeChatHistoryMessage', () => {
  it('keeps assistant text and appends readable tool summaries', () => {
    const summary = summarizeChatHistoryMessage({
      role: 'assistant',
      content: '我先去看一下当前工作区。',
      slices: [
        {
          type: 'tool-call',
          toolCall: {
            toolName: 'workspace_list_directory',
            args: JSON.stringify({ path: '.', recursive: false }),
            toolCallId: 'tool-1',
            toolCallType: 'function',
          },
        },
      ],
      tool_results: [
        {
          id: 'tool-1',
          result: JSON.stringify({
            success: true,
            message: '列出了当前工作区目录，共 6 项。',
          }),
        },
      ],
    } as any, {
      maxLength: 300,
    })

    expect(summary).toContain('我先去看一下当前工作区。')
    expect(summary).toContain('Called tool workspace_list_directory (path=".", recursive=false)')
    expect(summary).toContain('Result: 列出了当前工作区目录，共 6 项。')
  })

  it('falls back to assistant tool activity when content is empty', () => {
    const summary = summarizeChatHistoryMessage({
      role: 'assistant',
      content: '',
      slices: [
        {
          type: 'tool-call',
          toolCall: {
            toolName: 'workspace_typecheck',
            args: JSON.stringify({ target: 'stage-tamagotchi' }),
            toolCallId: 'tool-2',
            toolCallType: 'function',
          },
        },
      ],
      tool_results: [
        {
          id: 'tool-2',
          result: JSON.stringify({
            success: true,
            message: 'Typecheck for stage-tamagotchi passed.',
          }),
        },
      ],
    } as any)

    expect(summary).toContain('Called tool workspace_typecheck (target="stage-tamagotchi")')
    expect(summary).toContain('Result: Typecheck for stage-tamagotchi passed.')
  })

  it('returns a placeholder when nothing readable is available', () => {
    expect(summarizeChatHistoryMessage({
      role: 'assistant',
      content: '',
      slices: [],
      tool_results: [],
    } as any)).toBe('[no content]')
  })
})

describe('classifyAssistantToolOutcome', () => {
  function singleToolTurn(result: string) {
    return {
      slices: [{ type: 'tool-call', toolCall: { toolCallId: 'voice-call' } }],
      tool_results: [{ id: 'voice-call', result }],
    } as any
  }

  function toolTurn(results: Array<{ id: string, result?: string }>) {
    return {
      slices: [
        { type: 'tool-call', toolCall: { toolCallId: 'tool-1' } },
        { type: 'tool-call', toolCall: { toolCallId: 'tool-2' } },
      ],
      tool_results: results,
    } as any
  }

  it('uses explicit result facts instead of assistant wording', () => {
    expect(classifyAssistantToolOutcome(toolTurn([
      { id: 'tool-1', result: JSON.stringify({ completed: true }) },
      { id: 'tool-2', result: JSON.stringify({ success: true }) },
    ]))).toBe('success')

    expect(classifyAssistantToolOutcome(toolTurn([
      { id: 'tool-1', result: JSON.stringify({ completed: false, error: 'not persisted' }) },
      { id: 'tool-2', result: JSON.stringify({ isError: true, message: 'MCP call failed' }) },
    ]))).toBe('failed')
  })

  it.each([
    [{ completed: true, status: 'ringing' }, 'success'],
    [{ completed: false, status: 'unavailable' }, 'failed'],
    [{ completed: true, status: 'cancelled' }, 'failed'],
  ] as const)('classifies structured voice-call result %j as %s', (result, outcome) => {
    expect(classifyAssistantToolOutcome(singleToolTurn(JSON.stringify(result)))).toBe(outcome)
  })

  it.each([
    'Unable to access the workspace',
    'Permission denied',
    'The tool timed out',
    'Cancelled by user',
    '无法访问工作区',
    '权限被拒绝',
    '操作超时',
    '操作已取消',
  ])('classifies explicit failure result %j as failed', (result) => {
    expect(classifyAssistantToolOutcome(singleToolTurn(result))).toBe('failed')
  })

  it.each([
    '',
    'Workspace contains four files.',
    '{not-json}',
  ])('classifies ambiguous result %j as unknown', (result) => {
    expect(classifyAssistantToolOutcome(singleToolTurn(result))).toBe('unknown')
  })

  it('marks mixed known outcomes as partial and missing results as unknown', () => {
    expect(classifyAssistantToolOutcome(toolTurn([
      { id: 'tool-1', result: JSON.stringify({ completed: true }) },
      { id: 'tool-2', result: 'Failed: permission denied' },
    ]))).toBe('partial')

    expect(classifyAssistantToolOutcome(toolTurn([
      { id: 'tool-1', result: JSON.stringify({ completed: true }) },
    ]))).toBe('unknown')
  })
})
