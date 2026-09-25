import type { WidgetsAddPayload, WidgetSnapshot } from '../../shared/eventa'

export const QUICK_CHAT_WIDGET_ID = 'quick-chat'

export interface QuickChatWidgetBridge {
  addWidget: (payload: WidgetsAddPayload) => Promise<string | undefined>
  fetchWidget: (payload: { id: string }) => Promise<WidgetSnapshot | void>
  openWindow: (payload: { id?: string }) => Promise<void>
  prepareWindow: (payload: { id?: string }) => Promise<string | undefined>
}

export async function showQuickChatWidget(bridge: QuickChatWidgetBridge) {
  const existing = await bridge.fetchWidget({ id: QUICK_CHAT_WIDGET_ID })

  if (existing) {
    await bridge.openWindow({ id: QUICK_CHAT_WIDGET_ID })
    return QUICK_CHAT_WIDGET_ID
  }

  const id = await bridge.prepareWindow({ id: QUICK_CHAT_WIDGET_ID })

  await bridge.addWidget({
    id: id ?? QUICK_CHAT_WIDGET_ID,
    componentName: 'quick-chat',
    componentProps: {},
    size: 's',
  })

  return id ?? QUICK_CHAT_WIDGET_ID
}
