/** State is produced by the source renderer, which owns the live chat runtime. */
export interface ComposerToolbarState {
  dictating: boolean
  dictationAvailable: boolean
  floatingRepliesEnabled: boolean
  floatingRepliesAvailable: boolean
  imageAvailable: boolean
  innerVoiceEnabled: boolean
  innerVoiceAvailable: boolean
  interruptAvailable: boolean
  screenCaptureAvailable: boolean
  settingsAvailable: boolean
  speechOutputEnabled: boolean
  speechOutputAvailable: boolean
  voiceCallActive: boolean
  voiceCallAvailable: boolean
  webSearchEnabled: boolean
  webSearchAvailable: boolean
}

export type ComposerToolbarAction =
  | 'capture-screen'
    | 'interrupt'
    | 'open-image-picker'
    | 'open-settings'
    | 'toggle-dictation'
    | 'toggle-floating-replies'
    | 'toggle-inner-voice'
    | 'toggle-speech-output'
    | 'toggle-voice-call'
    | 'toggle-web-search'
