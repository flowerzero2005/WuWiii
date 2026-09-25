import type { WorkbenchInspectorTabId } from './workbench-process-events'

import { describe, expect, it } from 'vitest'

import {
  getWorkbenchMainTabForInspectorTab,
  WORKBENCH_ADVANCED_INSPECTOR_TABS,
  WORKBENCH_CORE_INSPECTOR_TABS,
  WORKBENCH_INSPECTOR_TABS,
} from './workbench-inspector-tabs'

describe('workbench inspector tabs', () => {
  it('keeps the right inspector skeleton grouped by product priority', () => {
    expect(WORKBENCH_CORE_INSPECTOR_TABS.map(tab => [tab.id, tab.labelKey])).toEqual([
      ['changes', 'tamagotchi.stage.workbench.tabs.changes'],
      ['terminal', 'tamagotchi.stage.workbench.labels.terminal'],
    ])
    expect(WORKBENCH_ADVANCED_INSPECTOR_TABS.map(tab => [tab.id, tab.labelKey])).toEqual([
      ['summary', 'tamagotchi.stage.workbench.labels.summary'],
      ['search', 'tamagotchi.stage.workbench.labels.search'],
      ['context', 'tamagotchi.stage.workbench.labels.context'],
      ['audit', 'tamagotchi.stage.workbench.labels.audit'],
    ])
    expect(WORKBENCH_INSPECTOR_TABS.map(tab => [tab.id, tab.labelKey])).toEqual([
      ['changes', 'tamagotchi.stage.workbench.tabs.changes'],
      ['terminal', 'tamagotchi.stage.workbench.labels.terminal'],
      ['summary', 'tamagotchi.stage.workbench.labels.summary'],
      ['search', 'tamagotchi.stage.workbench.labels.search'],
      ['context', 'tamagotchi.stage.workbench.labels.context'],
      ['audit', 'tamagotchi.stage.workbench.labels.audit'],
    ])
  })

  it('routes inspector tabs to the existing main workbench panels', () => {
    expect(Object.fromEntries(
      WORKBENCH_INSPECTOR_TABS.map(tab => [tab.id, getWorkbenchMainTabForInspectorTab(tab.id)]),
    )).toEqual({
      summary: 'run',
      changes: 'changes',
      terminal: 'run',
      search: 'run',
      context: 'files',
      audit: 'run',
    })
  })

  it('keeps every process detail target backed by one unique inspector tab', () => {
    const processDetailTabs = [
      'changes',
      'terminal',
      'summary',
      'search',
      'context',
      'audit',
    ] satisfies WorkbenchInspectorTabId[]
    const configuredTabIds = WORKBENCH_INSPECTOR_TABS.map(tab => tab.id)

    expect(new Set(configuredTabIds).size).toBe(configuredTabIds.length)
    expect(configuredTabIds).toEqual(processDetailTabs)
    expect(processDetailTabs.map(tab => [tab, getWorkbenchMainTabForInspectorTab(tab)])).toEqual([
      ['changes', 'changes'],
      ['terminal', 'run'],
      ['summary', 'run'],
      ['search', 'run'],
      ['context', 'files'],
      ['audit', 'run'],
    ])
  })

  it('uses a visible search icon from the shared icon set', () => {
    expect(WORKBENCH_ADVANCED_INSPECTOR_TABS.find(tab => tab.id === 'search')?.icon)
      .toBe('i-solar:magnifer-line-duotone')
  })
})
