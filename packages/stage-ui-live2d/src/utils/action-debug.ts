// NOTICE: Live2D 动作/表情全链路诊断日志（第十八轮）。用户复现"主舞台不动"时
// 需要看到每一环的成败，但默认必须静默（第十六轮已把常开日志清理掉）。
// 统一开关：localStorage 'AIRI_LIVE2D_DEBUG' = '1'（与 AIRI_CHAT_DEBUG 分开，
// 动作链路排查时不用打开聊天全量 trace）。
export const LIVE2D_ACTION_DEBUG_FLAG = 'AIRI_LIVE2D_DEBUG'

export function isLive2DActionDebugEnabled(): boolean {
  if (!import.meta.env.DEV)
    return false
  if (typeof localStorage === 'undefined')
    return false
  return localStorage.getItem(LIVE2D_ACTION_DEBUG_FLAG) === '1'
}

export function logLive2DActionEvent(event: string, details: Record<string, unknown>) {
  if (!isLive2DActionDebugEnabled())
    return
  console.info(`[Live2DAction] ${event}`, { at: Date.now(), ...details })
}

export function warnLive2DActionEvent(event: string, details: Record<string, unknown>) {
  if (!isLive2DActionDebugEnabled())
    return
  console.warn(`[Live2DAction] ${event}`, { at: Date.now(), ...details })
}
