export interface AutoCleanupDecision {
  // 本次检查是否应执行清理
  shouldCleanup: boolean
  // 本次是否保持"已触发"标记。清理后若消息数仍 >= 上限（例如问候消息被保留），
  // 保持 true 可避免在同一超限状态下反复触发形成死循环。
  armed: boolean
}

/**
 * 纯函数决策：根据当前消息数、上限、开关，以及是否已在当前超限状态触发过，决定是否清理。
 * - 开关关闭 => 不复位也未触发，关闭自动清理时自动复位标记。
 * - count < limit => 复位（下一次超限可再次清理）。
 * - count >= limit 且未触发过 => 触发一次。
 * - count >= limit 且已触发过 => 跳过（防重复触发）。
 *
 * 触发条件用 `>=`：与需求"达到/超过上限"一致。
 */
export function decideAutoCleanup(
  count: number,
  limit: number,
  enabled: boolean,
  alreadyTriggered: boolean,
): AutoCleanupDecision {
  if (!enabled)
    return { shouldCleanup: false, armed: false }

  if (count < limit)
    return { shouldCleanup: false, armed: false }

  if (alreadyTriggered)
    return { shouldCleanup: false, armed: true }

  return { shouldCleanup: true, armed: true }
}

export interface AutoCleanupGuardOptions {
  isEnabled: () => boolean
  getLimit: () => number
  // 实际清理函数，接入时传 session 的 cleanupMessages；测试时用 vi.fn 替换。
  cleanup: () => void | Promise<void>
}

export interface AutoCleanupGuard {
  check: (sessionId: string, count: number) => Promise<boolean>
  reset: (sessionId: string) => void
}

/**
 * 有状态守卫：按会话记住"当前超限状态是否已清理"，串接纯函数决策与实际清理函数。
 * 触发清理前先置位 armed，保证清理函数自身触发的持久化（消息数回落前的中间状态）
 * 不会重新进入清理，避免递归/死循环。
 */
export function createAutoCleanupGuard(options: AutoCleanupGuardOptions): AutoCleanupGuard {
  const armedSessionIds = new Set<string>()

  async function check(sessionId: string, count: number): Promise<boolean> {
    const decision = decideAutoCleanup(
      count,
      options.getLimit(),
      options.isEnabled(),
      armedSessionIds.has(sessionId),
    )

    if (decision.armed)
      armedSessionIds.add(sessionId)
    else
      armedSessionIds.delete(sessionId)

    if (!decision.shouldCleanup)
      return false

    await options.cleanup()
    return true
  }

  function reset(sessionId: string) {
    armedSessionIds.delete(sessionId)
  }

  return { check, reset }
}
