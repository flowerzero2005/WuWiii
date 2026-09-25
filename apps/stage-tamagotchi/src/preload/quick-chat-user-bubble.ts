import type { QuickChatUserBubbleWindowPayload } from '../shared/eventa'
import type { QuickChatUserBubbleApi } from '../shared/quick-chat-user-bubble'

import { contextBridge, ipcRenderer } from 'electron'

import { QUICK_CHAT_USER_BUBBLE_UPDATE_CHANNEL } from '../shared/quick-chat-user-bubble'

const api: QuickChatUserBubbleApi = {
  onPayload(listener) {
    ipcRenderer.on(QUICK_CHAT_USER_BUBBLE_UPDATE_CHANNEL, (_event, payload: QuickChatUserBubbleWindowPayload) => {
      listener(payload)
    })
  },
}

contextBridge.exposeInMainWorld('quickChatUserBubble', api)
