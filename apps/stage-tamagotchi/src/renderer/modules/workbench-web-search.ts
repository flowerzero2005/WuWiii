import type { ElectronWorkbenchMemoryArtifactRef } from '../../shared/eventa'

export type WorkbenchWebSearchProviderStatus = 'completed' | 'failed' | 'not-run' | 'unconfigured'

export interface WorkbenchWebSearchRequest {
  providerStatus: WorkbenchWebSearchProviderStatus
  query: string
  queryId: string
  requestedAt: number
  skippedReason?: string
  sourceCount: number
}

export interface BuildWorkbenchWebSearchRequestInput {
  now?: number
  plannerQuery?: unknown
  providerStatus?: unknown
  sourceCount?: unknown
  userInput: string
}

const DEFAULT_PROVIDER_STATUS: WorkbenchWebSearchProviderStatus = 'not-run'
const DEFAULT_SKIPPED_REASON = 'mvp1-visible-baseline'

function normalizeWebSearchQuery(value: unknown) {
  if (typeof value !== 'string')
    return undefined

  const query = value.replace(/\s+/g, ' ').trim()
  return query ? query.slice(0, 240) : undefined
}

function normalizeProviderStatus(value: unknown): WorkbenchWebSearchProviderStatus {
  if (value === 'completed' || value === 'failed' || value === 'not-run' || value === 'unconfigured')
    return value

  return DEFAULT_PROVIDER_STATUS
}

function normalizeSourceCount(value: unknown) {
  const count = typeof value === 'number'
    ? value
    : typeof value === 'string' && value.trim()
      ? Number(value)
      : 0

  if (!Number.isFinite(count))
    return 0

  return Math.max(0, Math.floor(count))
}

function hashQuery(value: string) {
  let hash = 0
  for (let index = 0; index < value.length; index += 1)
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0

  return hash.toString(36)
}

export function buildWorkbenchWebSearchRequest(input: BuildWorkbenchWebSearchRequestInput): WorkbenchWebSearchRequest {
  const query = normalizeWebSearchQuery(input.plannerQuery) ?? normalizeWebSearchQuery(input.userInput) ?? 'web search'
  const requestedAt = input.now ?? Date.now()
  const providerStatus = normalizeProviderStatus(input.providerStatus)

  return {
    providerStatus,
    query,
    queryId: `workbench-web-search-${requestedAt}-${hashQuery(query)}`,
    requestedAt,
    skippedReason: providerStatus === 'not-run' || providerStatus === 'unconfigured'
      ? DEFAULT_SKIPPED_REASON
      : undefined,
    sourceCount: normalizeSourceCount(input.sourceCount),
  }
}

export function buildWorkbenchWebSearchMetadata(
  request: WorkbenchWebSearchRequest,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...extra,
    searchProviderStatus: request.providerStatus,
    searchQuery: request.query,
    searchQueryId: request.queryId,
    searchRequestedAt: request.requestedAt,
    searchSourceCount: request.sourceCount,
    ...(request.skippedReason ? { searchSkippedReason: request.skippedReason } : {}),
  }
}

export function buildWorkbenchWebSearchArtifactRefs(request: WorkbenchWebSearchRequest): ElectronWorkbenchMemoryArtifactRef[] {
  return [{
    id: request.queryId,
    kind: 'web-source',
    label: request.query,
    metadata: buildWorkbenchWebSearchMetadata(request),
  }]
}
