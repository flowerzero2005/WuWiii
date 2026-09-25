import type { ElectronButlerTaskMutationPayload, ElectronButlerTaskSnapshot } from '../../shared/eventa'
import type { ButlerTask } from './butler-tasks'

export interface ButlerTaskMainMutationParams {
  applyMutation?: (mutation: ElectronButlerTaskMutationPayload) => Promise<ElectronButlerTaskSnapshot[] | undefined>
  fallback: () => void
  mutation: ElectronButlerTaskMutationPayload
  onError?: (error: unknown) => void
  onApplied?: (tasks: ButlerTask[]) => void
  replaceWithMainTasks: (tasks: ButlerTask[]) => void
  timeoutMs?: number
}

const DEFAULT_MUTATION_TIMEOUT_MS = 2_500

async function waitForMainMutation<T>(promise: Promise<T>, timeoutMs: number) {
  let timeout: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`Butler task mutation timed out after ${timeoutMs}ms.`)), timeoutMs)
      }),
    ])
  }
  finally {
    if (timeout)
      clearTimeout(timeout)
  }
}

export async function applyButlerTaskMutationWithFallback(params: ButlerTaskMainMutationParams) {
  if (!params.applyMutation) {
    params.fallback()
    return false
  }

  try {
    const tasks = await waitForMainMutation(params.applyMutation(params.mutation), params.timeoutMs ?? DEFAULT_MUTATION_TIMEOUT_MS)
    if (!tasks)
      throw new Error('Butler task mutation returned no persisted snapshot.')

    const mainTasks = tasks as ButlerTask[]
    params.replaceWithMainTasks(mainTasks)
    params.onApplied?.(mainTasks)
    return true
  }
  catch (error) {
    params.onError?.(error)
    return false
  }
}
