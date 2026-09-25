/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_EDITION?: 'consumer' | 'creator' | 'dev'
  readonly VITE_BETA_PURCHASE_URL?: string
  readonly VITE_SERVER_URL?: string
  readonly VITE_POSTHOG_PROJECT_KEY_WEB?: string
  readonly VITE_POSTHOG_PROJECT_KEY_DESKTOP?: string
  readonly VITE_POSTHOG_PROJECT_KEY_POCKET?: string
  readonly VITE_POSTHOG_PROJECT_KEY_DOCS?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
