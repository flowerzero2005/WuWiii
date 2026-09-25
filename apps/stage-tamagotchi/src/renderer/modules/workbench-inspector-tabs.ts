import type { WorkbenchInspectorTabId } from './workbench-process-events'

export type WorkbenchInspectorMainTabId = 'run' | 'files' | 'changes'

export interface WorkbenchInspectorTabOption {
  icon: string
  id: WorkbenchInspectorTabId
  labelKey: string
}

export const WORKBENCH_CORE_INSPECTOR_TABS: WorkbenchInspectorTabOption[] = [
  { id: 'changes', labelKey: 'tamagotchi.stage.workbench.tabs.changes', icon: 'i-solar:branching-paths-up-bold-duotone' },
  { id: 'terminal', labelKey: 'tamagotchi.stage.workbench.labels.terminal', icon: 'i-ph:terminal-window-duotone' },
]

export const WORKBENCH_ADVANCED_INSPECTOR_TABS: WorkbenchInspectorTabOption[] = [
  { id: 'summary', labelKey: 'tamagotchi.stage.workbench.labels.summary', icon: 'i-solar:document-text-bold-duotone' },
  { id: 'search', labelKey: 'tamagotchi.stage.workbench.labels.search', icon: 'i-solar:magnifer-line-duotone' },
  { id: 'context', labelKey: 'tamagotchi.stage.workbench.labels.context', icon: 'i-solar:folder-open-bold-duotone' },
  { id: 'audit', labelKey: 'tamagotchi.stage.workbench.labels.audit', icon: 'i-solar:shield-check-bold-duotone' },
]

export const WORKBENCH_INSPECTOR_TABS: WorkbenchInspectorTabOption[] = [
  ...WORKBENCH_CORE_INSPECTOR_TABS,
  ...WORKBENCH_ADVANCED_INSPECTOR_TABS,
]

export function getWorkbenchMainTabForInspectorTab(tab: WorkbenchInspectorTabId): WorkbenchInspectorMainTabId {
  if (tab === 'changes')
    return 'changes'

  if (tab === 'context')
    return 'files'

  return 'run'
}
