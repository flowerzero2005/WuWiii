import { describe, expect, it, vi } from 'vitest'

import {
  AUTO_CLEANUP_LIMIT_DEFAULT,
  AUTO_CLEANUP_LIMIT_MAX,
  AUTO_CLEANUP_LIMIT_MIN,
  clampAutoCleanupLimit,
} from '../settings/memory-short-term'
import { createAutoCleanupGuard, decideAutoCleanup } from './auto-cleanup-guard'

describe('clampAutoCleanupLimit', () => {
  it('把上限收敛到 [1, 400] 并四舍五入', () => {
    expect(clampAutoCleanupLimit(0)).toBe(AUTO_CLEANUP_LIMIT_MIN)
    expect(clampAutoCleanupLimit(-5)).toBe(AUTO_CLEANUP_LIMIT_MIN)
    expect(clampAutoCleanupLimit(400)).toBe(AUTO_CLEANUP_LIMIT_MAX)
    expect(clampAutoCleanupLimit(401)).toBe(AUTO_CLEANUP_LIMIT_MAX)
    expect(clampAutoCleanupLimit(9999)).toBe(AUTO_CLEANUP_LIMIT_MAX)
    expect(clampAutoCleanupLimit(200.4)).toBe(200)
    expect(clampAutoCleanupLimit(200.6)).toBe(201)
  })

  it('非法输入回落到默认值', () => {
    expect(clampAutoCleanupLimit(Number.NaN)).toBe(AUTO_CLEANUP_LIMIT_DEFAULT)
    expect(clampAutoCleanupLimit(Number.POSITIVE_INFINITY)).toBe(AUTO_CLEANUP_LIMIT_DEFAULT)
    expect(clampAutoCleanupLimit(Number.NEGATIVE_INFINITY)).toBe(AUTO_CLEANUP_LIMIT_DEFAULT)
  })
})

describe('decideAutoCleanup', () => {
  it('开关关闭时无论是否超限/是否已触发都不清理并复位', () => {
    expect(decideAutoCleanup(500, 200, false, false)).toEqual({ shouldCleanup: false, armed: false })
    expect(decideAutoCleanup(500, 200, false, true)).toEqual({ shouldCleanup: false, armed: false })
  })

  it('未达上限时复位标记，允许下一轮超限再次清理', () => {
    expect(decideAutoCleanup(199, 200, true, true)).toEqual({ shouldCleanup: false, armed: false })
  })

  it('达到或超过上限且未触发过时清理一次（>= 包含等于）', () => {
    expect(decideAutoCleanup(200, 200, true, false)).toEqual({ shouldCleanup: true, armed: true })
    expect(decideAutoCleanup(201, 200, true, false)).toEqual({ shouldCleanup: true, armed: true })
  })

  it('已触发过则跳过，防止在同一超限状态下重复清理', () => {
    expect(decideAutoCleanup(250, 200, true, true)).toEqual({ shouldCleanup: false, armed: true })
  })
})

describe('createAutoCleanupGuard', () => {
  it('超限只清理一次；计数回落后再次超限才会再次清理', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const guard = createAutoCleanupGuard({
      isEnabled: () => true,
      getLimit: () => 200,
      cleanup,
    })

    // 首次超限：清理一次
    expect(await guard.check('s1', 201)).toBe(true)
    expect(cleanup).toHaveBeenCalledTimes(1)

    // 同一超限状态（清理后仍 >= limit 的场景，如问候消息被保留）：不再重复清理
    expect(await guard.check('s1', 201)).toBe(false)
    expect(await guard.check('s1', 250)).toBe(false)
    expect(cleanup).toHaveBeenCalledTimes(1)

    // 计数回落到上限以下：复位
    expect(await guard.check('s1', 2)).toBe(false)

    // 再次超限：再次清理
    expect(await guard.check('s1', 201)).toBe(true)
    expect(cleanup).toHaveBeenCalledTimes(2)
  })

  it('开关关闭时即使超限也不清理', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const guard = createAutoCleanupGuard({
      isEnabled: () => false,
      getLimit: () => 200,
      cleanup,
    })

    expect(await guard.check('s1', 300)).toBe(false)
    expect(cleanup).not.toHaveBeenCalled()
  })

  it('不同会话各自独立去重', async () => {
    const cleanup = vi.fn().mockResolvedValue(undefined)
    const guard = createAutoCleanupGuard({
      isEnabled: () => true,
      getLimit: () => 200,
      cleanup,
    })

    expect(await guard.check('s1', 201)).toBe(true)
    expect(await guard.check('s2', 201)).toBe(true)
    expect(cleanup).toHaveBeenCalledTimes(2)
  })
})
