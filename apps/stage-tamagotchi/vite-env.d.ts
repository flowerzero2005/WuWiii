/// <reference types="vite/client" />
/// <reference types="../../vite-env.d.ts" />

interface ImportMetaEnv {
  readonly VITE_DESKTOP_DEVELOPER_TOOLS_ENABLED: boolean
  readonly VITE_DESKTOP_UPDATES_ENABLED: boolean
  readonly VITE_WINDOWS_ANGLE_BACKEND?: string
}
