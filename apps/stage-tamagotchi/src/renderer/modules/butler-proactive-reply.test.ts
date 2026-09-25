import { describe, expect, it } from 'vitest'

import { createButlerProactiveReplyRequest, ingestButlerProactiveReplyCapabilityContext } from './butler-proactive-reply'

describe('butler proactive reply request', () => {
  it.each(['reminder', 'alarm', 'timer'] as const)('preserves trusted %s provenance without tool routing', (kind) => {
    const request = createButlerProactiveReplyRequest({
      dueAt: Date.parse('2026-08-09T10:00:00.000Z'),
      id: `${kind}-1`,
      kind,
      note: 'Drink water.',
      status: 'open',
      title: 'Hydrate',
    })

    expect(request.runtimeSignal).toEqual({
      dueAt: Date.parse('2026-08-09T10:00:00.000Z'),
      kind,
      source: 'butler',
      taskId: `${kind}-1`,
      title: 'Hydrate',
    })
    expect(request.prompt).toContain('trusted desktop Butler event')
    expect(request).not.toHaveProperty('tools')
    expect(request).not.toHaveProperty('toolBundles')
    expect(request.appCapabilityContext.text).toContain('Current conversation surface: butler-task-reminder')
    expect(request.appCapabilityContext.text).toContain('No callable application capability is confirmed')
    expect(request.appCapabilityContext.text).toContain('Without it, nothing has started')
    expect(request.appCapabilityContext.text).not.toContain('Available now:')
    expect(request.appCapabilityContext.text).not.toContain('Long-term memory disabled')
  })

  it('keeps task details as optional context instead of a reply checklist', () => {
    const request = createButlerProactiveReplyRequest({
      dueAt: Date.parse('2026-08-09T10:00:00.000Z'),
      id: 'reminder-1',
      kind: 'reminder',
      note: 'Bring an umbrella.',
      status: 'open',
      title: 'Leave for work',
    }, {
      currentAt: Date.parse('2026-08-09T10:02:00.000Z'),
      triggeredAt: Date.parse('2026-08-09T10:01:00.000Z'),
    })

    expect(request.prompt).toContain('optional background only')
    expect(request.prompt).toContain('you do not need to mention it')
    expect(request.prompt).toContain('Never recite, list, or account for its fields')
    expect(request.prompt).toContain('- task title: Leave for work')
    expect(request.prompt).toContain('- scheduled time: 2026-08-09T10:00:00.000Z')
    expect(request.prompt).toContain('- trigger time: 2026-08-09T10:01:00.000Z')
    expect(request.prompt).toContain('- current time: 2026-08-09T10:02:00.000Z')
    expect(request.prompt).toContain('- task status: open')
    expect(request.prompt).not.toContain('Task: Leave for work')
    expect(request.prompt).not.toContain('Scheduled time: 2026-08-09T10:00:00.000Z')
    expect(request.prompt).not.toContain('remind the user naturally in one short sentence')
  })

  it('injects the execution truth contract only into the active reminder session', () => {
    const request = createButlerProactiveReplyRequest({
      dueAt: Date.parse('2026-08-09T10:00:00.000Z'),
      id: 'reminder-1',
      kind: 'reminder',
      status: 'open',
      title: 'Hydrate',
    })
    const calls: unknown[][] = []
    const store = {
      ingestContextMessage: (...args: unknown[]) => {
        calls.push(args)
        return true
      },
    }

    expect(ingestButlerProactiveReplyCapabilityContext(store, request, 'session-1')).toBe(true)
    expect(calls).toEqual([[request.appCapabilityContext, { type: 'session', sessionId: 'session-1' }]])
    expect(ingestButlerProactiveReplyCapabilityContext(store, request, '')).toBe(false)
  })
})
