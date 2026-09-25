import type { JsonSchema } from 'xsschema'

import { describe, expect, it } from 'vitest'

import { mcp } from './mcp'

describe('tools mcp schema', () => {
  it('describes explicit user-intent boundaries for MCP discovery and actions', async () => {
    const tools = await mcp()
    const descriptions = Object.fromEntries(tools.map(tool => [tool.function.name, tool.function.description ?? '']))

    expect(descriptions.mcp_list_tools).toContain('explicitly asks')
    expect(descriptions.mcp_list_tools).toContain('Do not call for discussion')
    expect(descriptions.mcp_call_tool).toContain('explicitly asks to perform a concrete action')
    expect(descriptions.mcp_call_tool).toContain('known qualified tool name')
    expect(descriptions.mcp_call_tool).toContain('Never invent a tool name')
  })

  it('emits strict parameter objects', async () => {
    const tools = await mcp()
    const toolNames = [
      'mcp_list_tools',
      'mcp_call_tool',
    ]

    for (const name of toolNames) {
      const tool = tools.find(entry => entry.function.name === name)
      expect(tool, `missing tool: ${name}`).toBeDefined()
      expect(tool?.function.parameters.additionalProperties).toBe(false)
    }
  })

  it('keeps mcp_call_tool parameters items strict', async () => {
    const tools = await mcp()
    const callTool = tools.find(entry => entry.function.name === 'mcp_call_tool')

    expect(callTool).toBeDefined()
    const items = ((callTool!.function.parameters as JsonSchema).properties?.parameters as JsonSchema)?.items as JsonSchema
    expect(items).toBeDefined()
    expect(items.additionalProperties).toBe(false)
  })
})
