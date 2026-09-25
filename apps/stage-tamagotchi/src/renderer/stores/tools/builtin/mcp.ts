import type { McpToolDescriptor } from '@proj-airi/stage-ui/stores/mcp-tool-bridge'
import type { Tool } from '@xsai/shared-chat'

import { getMcpToolBridge } from '@proj-airi/stage-ui/stores/mcp-tool-bridge'
import { mcp } from '@proj-airi/stage-ui/tools/mcp'
import { tool } from '@xsai/tool'
import { z } from 'zod'

const lowRiskConversationalToolPatterns = [
  /(anime|book|comic|entertainment|fact|fun|game|headline|history|idea|movie|music|news|recommend|search|topic|trivia|video|weather|wiki)/i,
  /(八卦|动漫|历史|天气|百科|聊点|话题|趣闻|新闻|梗|游戏|电影|音乐|推荐)/,
]

const blockedMcpToolPatterns = [
  /(admin|browser|command|computer|database|delete|deploy|exec|file|git|install|kill|migrate|process|remove|rename|run|shell|sql|terminal|window|write)/i,
  /(写入|删除|命令|终端|执行|脚本|进程|文件|数据库|浏览器|窗口|部署|安装)/,
]

const blockedArgumentKeyPatterns = [
  /(command|content|cwd|diff|file|path|patch|prompt|queryText|script|sql|text|url|write)/i,
]

const proactiveTopicParameters = z.object({
  name: z.string().describe('The qualified MCP tool name to call. Only use low-risk informational or recommendation tools.'),
  parameters: z.array(z.object({
    name: z.string().describe('The name of the parameter'),
    value: z.unknown().describe('The value of the parameter'),
  }).strict()).describe('The parameters to pass to the tool'),
}).strict()

function descriptorText(descriptor: McpToolDescriptor) {
  return [
    descriptor.serverName,
    descriptor.toolName,
    descriptor.name,
    descriptor.description ?? '',
  ].join(' ')
}

export function isLowRiskConversationalMcpTool(descriptor: McpToolDescriptor) {
  const text = descriptorText(descriptor)
  return lowRiskConversationalToolPatterns.some(pattern => pattern.test(text))
    && !blockedMcpToolPatterns.some(pattern => pattern.test(text))
}

export function hasBlockedMcpArgumentKeys(parameters: Array<{ name: string, value: unknown }>) {
  return parameters.some(parameter => blockedArgumentKeyPatterns.some(pattern => pattern.test(parameter.name)))
}

async function findMcpDescriptor(name: string) {
  const descriptors = await getMcpToolBridge().listTools()
  return descriptors.find(descriptor => descriptor.name === name)
}

const proactiveTopicMcpTool = tool({
  name: 'mcp_call_tool_topic_safe',
  description: 'Call a low-risk MCP tool only for lightweight topic opening, recommendations, trivia, weather, or similar conversational prompts. Do not use this for filesystem, shell, browser, admin, database, or other high-impact tools.',
  parameters: proactiveTopicParameters,
  execute: async ({ name, parameters }) => {
    try {
      const descriptor = await findMcpDescriptor(name)
      if (!descriptor) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `MCP tool not found: ${name}`,
          }],
        }
      }

      if (!isLowRiskConversationalMcpTool(descriptor)) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `Blocked MCP tool for proactive topic opening: ${name}`,
          }],
        }
      }

      if (hasBlockedMcpArgumentKeys(parameters)) {
        return {
          isError: true,
          content: [{
            type: 'text',
            text: `Blocked MCP arguments for proactive topic opening: ${name}`,
          }],
        }
      }

      const parametersObject = Object.fromEntries(parameters.map(({ name, value }) => [name, value]))
      return await getMcpToolBridge().callTool({
        name,
        arguments: parametersObject,
      })
    }
    catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        isError: true,
        content: [{
          type: 'text',
          text: message,
        }],
      }
    }
  },
})

export async function mcpDiscoveryTools(): Promise<Tool[]> {
  const tools = await mcp()
  return tools.filter(tool => tool.function.name === 'mcp_list_tools')
}

export async function mcpExplicitActionTools(): Promise<Tool[]> {
  const tools = await mcp()
  return tools.filter(tool => tool.function.name === 'mcp_call_tool')
}

export async function mcpProactiveTopicTools(): Promise<Tool[]> {
  return [await proactiveTopicMcpTool]
}
