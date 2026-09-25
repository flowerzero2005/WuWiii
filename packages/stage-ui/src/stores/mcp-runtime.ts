import { defineStore } from 'pinia'
import { computed, ref } from 'vue'

interface McpRuntimeStatusLike {
  servers: Array<{ state: string }>
}

export const useMcpRuntimeStatusStore = defineStore('mcp-runtime-status', () => {
  const status = ref<McpRuntimeStatusLike>({ servers: [] })
  const configured = computed(() => status.value.servers.some(server => server.state === 'running'))

  function updateStatus(nextStatus: McpRuntimeStatusLike) {
    status.value = {
      servers: nextStatus.servers.map(server => ({ state: server.state })),
    }
  }

  return {
    configured,
    status,
    updateStatus,
  }
})
