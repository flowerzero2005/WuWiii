import { tool } from '@xsai/tool'
import { z } from 'zod'

import { getMcpToolBridge } from '../stores/mcp-tool-bridge'

const tools = [
  tool({
    name: 'mcp_list_tools',
    description: 'Use only when the current user explicitly asks to query, list, or discover currently connected MCP tools. Do not call for discussion, complaints, hypothetical examples, capability questions, historical narration, or mere mention of MCP or tools.',
    execute: async (_, __) => {
      try {
        return await getMcpToolBridge().listTools()
      }
      catch (error) {
        console.warn('[mcp_list_tools] failed to list tools:', error)
        return []
      }
    },
    parameters: z.object({}).strict(),
  }),
  tool({
    name: 'mcp_call_tool',
    description: 'Use only when the current user explicitly asks to perform a concrete action through MCP and a known qualified tool name is available (format "<serverName>::<toolName>"). Do not call for discussion, complaints, hypothetical examples, capability questions, historical narration, or mere mention of MCP. Never invent a tool name; use mcp_list_tools first when the qualified name is unknown. The result reports returned content and whether the call failed.',
    execute: async ({ name, parameters }) => {
      try {
        const parametersObject = Object.fromEntries(parameters.map(({ name, value }) => [name, value]))
        const result = await getMcpToolBridge().callTool({
          name,
          arguments: parametersObject,
        })
        return result satisfies {
          content?: Record<string, unknown>[]
          isError?: boolean
          structuredContent?: Record<string, unknown>
          toolResult?: unknown
        }
      }
      catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return {
          isError: true,
          content: [
            {
              type: 'text',
              text: message,
            },
          ],
        }
      }
    },
    parameters: z.object({
      name: z.string().describe('The qualified tool name to call. Use format "<serverName>::<toolName>"'),
      parameters: z.array(z.object({
        name: z.string().describe('The name of the parameter'),
        value: z.unknown().describe('The value of the parameter'),
      }).strict()).describe('The parameters to pass to the tool'),
    }).strict(),
  }),
]

export const mcp = async () => Promise.all(tools)
