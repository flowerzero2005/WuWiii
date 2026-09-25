import type { ElectronButlerTaskMutationPayload } from '../../shared/eventa'

import { describe, expect, it, vi } from 'vitest'

import { applyButlerTaskMutationWithFallback } from './butler-task-main-mutation'

const createMutation: ElectronButlerTaskMutationPayload = {
  id: 'butler-task-create',
  input: {
    dueAt: 1_782_895_200_000,
    title: 'Focus sprint',
  },
  type: 'create',
}

describe('butler task main mutation helper', () => {
  it('replaces local tasks with the main-process mutation result', async () => {
    const fallback = vi.fn()
    const onApplied = vi.fn()
    const replaceWithMainTasks = vi.fn()
    const applyMutation = vi.fn(async () => [{
      createdAt: 1,
      dueAt: createMutation.input.dueAt,
      id: 'task-main',
      status: 'open' as const,
      title: createMutation.input.title,
      updatedAt: 1,
    }])

    await expect(applyButlerTaskMutationWithFallback({
      applyMutation,
      fallback,
      mutation: createMutation,
      onApplied,
      replaceWithMainTasks,
    })).resolves.toBe(true)

    expect(applyMutation).toHaveBeenCalledWith(createMutation)
    expect(replaceWithMainTasks).toHaveBeenCalledWith([expect.objectContaining({ id: 'task-main' })])
    expect(onApplied).toHaveBeenCalledWith([expect.objectContaining({ id: 'task-main' })])
    expect(fallback).not.toHaveBeenCalled()
  })

  it('falls back only when main-process mutation is unavailable', async () => {
    const fallback = vi.fn()
    const replaceWithMainTasks = vi.fn()

    await expect(applyButlerTaskMutationWithFallback({
      fallback,
      mutation: createMutation,
      replaceWithMainTasks,
    })).resolves.toBe(false)

    await expect(applyButlerTaskMutationWithFallback({
      applyMutation: vi.fn(async () => undefined),
      fallback,
      mutation: createMutation,
      replaceWithMainTasks,
    })).resolves.toBe(false)

    await expect(applyButlerTaskMutationWithFallback({
      applyMutation: vi.fn(async () => {
        throw new Error('ipc unavailable')
      }),
      fallback,
      mutation: createMutation,
      replaceWithMainTasks,
    })).resolves.toBe(false)

    expect(fallback).toHaveBeenCalledOnce()
    expect(replaceWithMainTasks).not.toHaveBeenCalled()
  })

  it('releases the caller without a local fallback when the main-process mutation never settles', async () => {
    const fallback = vi.fn()
    const onError = vi.fn()
    const replaceWithMainTasks = vi.fn()

    await expect(applyButlerTaskMutationWithFallback({
      applyMutation: vi.fn(() => new Promise<never>(() => {})),
      fallback,
      mutation: createMutation,
      onError,
      replaceWithMainTasks,
      timeoutMs: 1,
    })).resolves.toBe(false)

    expect(fallback).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      message: 'Butler task mutation timed out after 1ms.',
    }))
    expect(replaceWithMainTasks).not.toHaveBeenCalled()
  })
})
