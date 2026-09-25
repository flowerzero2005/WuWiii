import type { createContext } from '@moeru/eventa/adapters/electron/main'

import type {
  ElectronProtectedResourceAction,
  ElectronProtectedResourceDefaults,
  ElectronProtectedResourceEvaluationPayload,
  ElectronProtectedResourceEvaluationResult,
  ElectronProtectedResourceRiskLevel,
  ElectronProtectedResourceRule,
} from '../../../../shared/eventa'

import { isAbsolute, relative, resolve } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { createContext as createElectronContext } from '@moeru/eventa/adapters/electron/main'
import { app, ipcMain } from 'electron'

import {
  electronProtectedResourcesEvaluate,
  electronProtectedResourcesGetDefaults,
} from '../../../../shared/eventa'

export interface ProtectedResourcesRegistryService {
  getDefaults: () => ElectronProtectedResourceDefaults
  evaluate: (payload: ElectronProtectedResourceEvaluationPayload) => ElectronProtectedResourceEvaluationResult
  assertAllowed: (payload: ElectronProtectedResourceEvaluationPayload) => ElectronProtectedResourceEvaluationResult
}

type ProtectedResourceContext = ReturnType<typeof createContext>['context']

const READ_ACTIONS: ElectronProtectedResourceAction[] = ['read', 'search', 'list-directory', 'diff']
const WRITE_ACTIONS: ElectronProtectedResourceAction[] = ['write', 'edit-preview', 'edit-apply']
const ALL_ACTIONS: ElectronProtectedResourceAction[] = [...READ_ACTIONS, ...WRITE_ACTIONS, 'command']

const DEFAULT_PROTECTED_RESOURCE_RULES: ElectronProtectedResourceRule[] = [
  {
    actions: ALL_ACTIONS,
    label: 'Environment files',
    pattern: '.env',
    riskLevel: 'critical',
    ruleId: 'default:env-file',
    source: 'default',
  },
  {
    actions: ALL_ACTIONS,
    label: 'Environment variants',
    pattern: '.env.*',
    riskLevel: 'critical',
    ruleId: 'default:env-variants',
    source: 'default',
  },
  {
    actions: ALL_ACTIONS,
    label: 'Secret directories',
    pattern: '**/secrets/**',
    riskLevel: 'critical',
    ruleId: 'default:secrets-directory',
    source: 'default',
  },
  {
    actions: ALL_ACTIONS,
    label: 'Secret-like paths',
    pattern: '**/*secret*',
    riskLevel: 'critical',
    ruleId: 'default:secret-path',
    source: 'default',
  },
  {
    actions: ALL_ACTIONS,
    label: 'Token-like paths',
    pattern: '**/*token*',
    riskLevel: 'critical',
    ruleId: 'default:token-path',
    source: 'default',
  },
  {
    actions: ALL_ACTIONS,
    label: 'Credential-like paths',
    pattern: '**/*credential*',
    riskLevel: 'critical',
    ruleId: 'default:credential-path',
    source: 'default',
  },
  {
    actions: ALL_ACTIONS,
    label: 'Password-like paths',
    pattern: '**/*password*',
    riskLevel: 'critical',
    ruleId: 'default:password-path',
    source: 'default',
  },
  {
    actions: ALL_ACTIONS,
    label: 'Private key-like paths',
    pattern: '**/*private*key*',
    riskLevel: 'critical',
    ruleId: 'default:private-key-path',
    source: 'default',
  },
  {
    actions: ALL_ACTIONS,
    label: 'SSH RSA private key',
    pattern: '**/id_rsa',
    riskLevel: 'critical',
    ruleId: 'default:ssh-id-rsa',
    source: 'default',
  },
  {
    actions: ALL_ACTIONS,
    label: 'SSH Ed25519 private key',
    pattern: '**/id_ed25519',
    riskLevel: 'critical',
    ruleId: 'default:ssh-id-ed25519',
    source: 'default',
  },
]

const RISK_SCORE: Record<ElectronProtectedResourceRiskLevel, number> = {
  critical: 3,
  high: 2,
  medium: 1,
}

function cloneRule(rule: ElectronProtectedResourceRule): ElectronProtectedResourceRule {
  return {
    ...rule,
    actions: [...rule.actions],
  }
}

function createRuntimeProtectedResourceRules(): ElectronProtectedResourceRule[] {
  try {
    const userDataPath = normalizePath(app.getPath('userData'))
    if (!userDataPath)
      return []

    return [
      {
        actions: WRITE_ACTIONS,
        label: 'Wuwiii local data root',
        pattern: userDataPath,
        riskLevel: 'high',
        ruleId: 'runtime:airi-user-data-root',
        source: 'runtime',
      },
      {
        actions: WRITE_ACTIONS,
        label: 'Wuwiii local data',
        pattern: `${userDataPath}/**`,
        riskLevel: 'high',
        ruleId: 'runtime:airi-user-data',
        source: 'runtime',
      },
    ]
  }
  catch {
    return []
  }
}

export function getDefaultProtectedResourcePathPatterns() {
  return DEFAULT_PROTECTED_RESOURCE_RULES
    .filter(rule => rule.source === 'default')
    .map(rule => rule.pattern)
}

function normalizePath(path: string) {
  return path.trim().replace(/\\/g, '/')
}

function normalizeAbsolutePath(path: string) {
  return resolve(path).replace(/\\/g, '/')
}

function toWorkspaceRelativePath(workspaceRoot: string | undefined, targetPath: string) {
  if (!workspaceRoot)
    return normalizePath(targetPath)

  const normalizedWorkspaceRoot = normalizeAbsolutePath(workspaceRoot)
  const absoluteTarget = isAbsolute(targetPath)
    ? normalizeAbsolutePath(targetPath)
    : normalizeAbsolutePath(resolve(normalizedWorkspaceRoot, targetPath))
  const relativePath = relative(normalizedWorkspaceRoot, absoluteTarget).replace(/\\/g, '/')

  if (!relativePath || relativePath.startsWith('..') || isAbsolute(relativePath))
    return normalizePath(targetPath)

  return relativePath
}

function escapeRegex(value: string) {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')
}

function patternToRegex(pattern: string) {
  const normalized = normalizePath(pattern)
  let output = ''

  for (let index = 0; index < normalized.length; index += 1) {
    const char = normalized[index]
    const nextChar = normalized[index + 1]
    if (char === '*' && nextChar === '*') {
      if (normalized[index + 2] === '/') {
        output += '(?:.*/)?'
        index += 2
        continue
      }

      output += '.*'
      index += 1
      continue
    }
    if (char === '*') {
      output += '[^/]*'
      continue
    }

    output += escapeRegex(char)
  }

  return new RegExp(`(^|/)${output}$`, 'i')
}

function createWorkspaceProfileRules(patterns?: string[]) {
  return Array.from(new Set(
    (patterns ?? [])
      .map(pattern => normalizePath(pattern))
      .filter(Boolean),
  )).map((pattern, index): ElectronProtectedResourceRule => ({
    actions: ALL_ACTIONS,
    label: 'Workspace protected path',
    pattern,
    riskLevel: 'critical',
    ruleId: `workspace-profile:${index}:${pattern}`,
    source: 'workspace-profile',
  }))
}

function getHighestRiskLevel(risks: ElectronProtectedResourceRiskLevel[]) {
  return risks.sort((left, right) => RISK_SCORE[right] - RISK_SCORE[left])[0]
}

export function createProtectedResourcesRegistryService(): ProtectedResourcesRegistryService {
  function getDefaults(): ElectronProtectedResourceDefaults {
    const rules = [
      ...DEFAULT_PROTECTED_RESOURCE_RULES,
      ...createRuntimeProtectedResourceRules(),
    ].map(cloneRule)
    return {
      protectedPaths: getDefaultProtectedResourcePathPatterns(),
      rules,
    }
  }

  function evaluate(payload: ElectronProtectedResourceEvaluationPayload): ElectronProtectedResourceEvaluationResult {
    const normalizedPath = normalizePath(payload.targetPath)
    const workspaceRelativePath = toWorkspaceRelativePath(payload.workspaceRoot, payload.targetPath)
    const readScope = payload.readScope ?? 'workspace'
    const rules = [
      ...DEFAULT_PROTECTED_RESOURCE_RULES,
      ...createRuntimeProtectedResourceRules(),
      ...createWorkspaceProfileRules(payload.workspaceProtectedPaths),
    ]
    const matchedRules = rules
      .filter(rule => rule.actions.includes(payload.action))
      .filter(rule => patternToRegex(rule.pattern).test(workspaceRelativePath) || patternToRegex(rule.pattern).test(normalizedPath))
      .map(rule => ({
        matchedPath: workspaceRelativePath,
        rule: cloneRule(rule),
      }))
    const highestRiskLevel = getHighestRiskLevel(matchedRules.map(match => match.rule.riskLevel))
    const allowed = matchedRules.length === 0

    return {
      action: payload.action,
      allowed,
      highestRiskLevel,
      matchedRules,
      normalizedPath,
      readScope,
      reason: allowed
        ? undefined
        : `Protected resource blocked for ${payload.action}: ${workspaceRelativePath}`,
      targetPath: payload.targetPath,
    }
  }

  function assertAllowed(payload: ElectronProtectedResourceEvaluationPayload) {
    const result = evaluate(payload)
    if (!result.allowed)
      throw new Error(result.reason ?? `Protected resource blocked: ${payload.targetPath}`)

    return result
  }

  return {
    assertAllowed,
    evaluate,
    getDefaults,
  }
}

export function createProtectedResourcesRegistryHandlers(params: {
  context: ProtectedResourceContext
  service: ProtectedResourcesRegistryService
}) {
  defineInvokeHandler(params.context, electronProtectedResourcesGetDefaults, () => {
    return params.service.getDefaults()
  })

  defineInvokeHandler(params.context, electronProtectedResourcesEvaluate, (payload) => {
    return params.service.evaluate(payload)
  })
}

export function setupProtectedResourcesRegistryService() {
  const { context } = createElectronContext(ipcMain)
  const service = createProtectedResourcesRegistryService()
  createProtectedResourcesRegistryHandlers({ context, service })
  return service
}
