import { describe, expect, it, vi } from 'vitest'

import { broadcastToWindowEventaContexts, registerWindowEventaContext } from './window-eventa-context-registry'

describe('window Eventa context registry', () => {
  it('broadcasts to every registered renderer and unregisters closed contexts', () => {
    const first = { emit: vi.fn() }
    const second = { emit: vi.fn() }
    const unregisterFirst = registerWindowEventaContext(first as never)
    const unregisterSecond = registerWindowEventaContext(second as never)

    expect(broadcastToWindowEventaContexts(context => context.emit({} as never, { requestedAt: 1 }))).toBe(2)
    expect(first.emit).toHaveBeenCalledOnce()
    expect(second.emit).toHaveBeenCalledOnce()

    unregisterFirst()
    expect(broadcastToWindowEventaContexts(context => context.emit({} as never, { requestedAt: 2 }))).toBe(1)
    expect(first.emit).toHaveBeenCalledOnce()
    expect(second.emit).toHaveBeenCalledTimes(2)

    unregisterSecond()
  })

  it('continues broadcasting when one renderer rejects an event', () => {
    const broken = {
      emit: vi.fn(() => {
        throw new Error('closed')
      }),
    }
    const healthy = { emit: vi.fn() }
    const unregisterBroken = registerWindowEventaContext(broken as never)
    const unregisterHealthy = registerWindowEventaContext(healthy as never)
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})

    expect(broadcastToWindowEventaContexts(context => context.emit({} as never, undefined))).toBe(1)
    expect(healthy.emit).toHaveBeenCalledOnce()
    expect(warn).toHaveBeenCalledOnce()

    unregisterBroken()
    unregisterHealthy()
    warn.mockRestore()
  })
})
