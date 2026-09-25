import { describe, expect, it } from 'vitest'

import {
  buildWorkbenchWebSearchArtifactRefs,
  buildWorkbenchWebSearchMetadata,
  buildWorkbenchWebSearchRequest,
} from './workbench-web-search'

describe('workbench web search view model', () => {
  it('normalizes planner query and records the visible baseline provider status', () => {
    const request = buildWorkbenchWebSearchRequest({
      now: 100,
      plannerQuery: '  Vue 3 latest   defineModel docs  ',
      userInput: 'look this up',
    })

    expect(request).toMatchObject({
      providerStatus: 'not-run',
      query: 'Vue 3 latest defineModel docs',
      requestedAt: 100,
      skippedReason: 'mvp1-visible-baseline',
      sourceCount: 0,
    })
    expect(request.queryId).toMatch(/^workbench-web-search-100-/)
  })

  it('falls back to the user input and clamps source count', () => {
    const request = buildWorkbenchWebSearchRequest({
      now: 200,
      plannerQuery: '   ',
      providerStatus: 'completed',
      sourceCount: '3.8',
      userInput: 'check the latest release notes',
    })

    expect(request).toMatchObject({
      providerStatus: 'completed',
      query: 'check the latest release notes',
      skippedReason: undefined,
      sourceCount: 3,
    })
  })

  it('builds web-source artifacts with query metadata for the Search detail target', () => {
    const request = buildWorkbenchWebSearchRequest({
      now: 300,
      userInput: 'search web for current package docs',
    })

    expect(buildWorkbenchWebSearchMetadata(request, { agentLoopStep: 'web-search-query' })).toMatchObject({
      agentLoopStep: 'web-search-query',
      searchProviderStatus: 'not-run',
      searchQuery: 'search web for current package docs',
      searchRequestedAt: 300,
      searchSkippedReason: 'mvp1-visible-baseline',
      searchSourceCount: 0,
    })

    expect(buildWorkbenchWebSearchArtifactRefs(request)).toEqual([{
      id: request.queryId,
      kind: 'web-source',
      label: 'search web for current package docs',
      metadata: expect.objectContaining({
        searchQuery: 'search web for current package docs',
        searchQueryId: request.queryId,
      }),
    }])
  })
})
