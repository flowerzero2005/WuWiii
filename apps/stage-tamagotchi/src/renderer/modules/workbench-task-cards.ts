import type {
  ElectronWorkbenchCommandRunSnapshot,
  ElectronWorkbenchMemoryItem,
  ElectronWorkbenchMemoryItemKind,
} from '../../shared/eventa'

export interface WorkbenchTaskCard {
  taskCardId: string
  rootItem: ElectronWorkbenchMemoryItem
  title: string
  summary: string
  body?: string
  kind: ElectronWorkbenchMemoryItemKind
  contextUnits: number
  createdAt: number
  updatedAt: number
  artifactRefs: ElectronWorkbenchMemoryItem['artifactRefs']
  commandRuns: ElectronWorkbenchCommandRunSnapshot[]
  relatedItems: ElectronWorkbenchMemoryItem[]
}

function isTaskRootItem(item: ElectronWorkbenchMemoryItem) {
  return item.kind === 'plan' || item.kind === 'user-goal'
}

function isWorkbenchEphemeralItem(item: ElectronWorkbenchMemoryItem) {
  return item.tags.includes('workbench-ephemeral') || item.metadata?.workbenchEphemeral === true
}

function isAutoTitledTaskRoot(item: ElectronWorkbenchMemoryItem) {
  return item.metadata?.workbenchAutoTitle === true
}

function isWorkbenchTitleCandidate(item: ElectronWorkbenchMemoryItem) {
  return item.metadata?.workbenchTitleCandidate === true && item.title.trim().length > 0
}

function hasUsefulWorkbenchTitle(item: ElectronWorkbenchMemoryItem) {
  const normalizedTitle = item.title.trim().replace(/\s+/g, '')
  return normalizedTitle.length > 3
}

function isImplicitWorkbenchTitleCandidate(item: ElectronWorkbenchMemoryItem) {
  return item.tags.includes('task-input') && hasUsefulWorkbenchTitle(item)
}

export function getTaskCardIdForMemory(item: ElectronWorkbenchMemoryItem) {
  if (isWorkbenchEphemeralItem(item))
    return undefined

  if (typeof item.metadata?.taskCardId === 'string')
    return item.metadata.taskCardId

  const taskTag = item.tags.find(tag => tag.startsWith('task:'))
  if (taskTag)
    return taskTag.slice('task:'.length)

  return isTaskRootItem(item) ? item.memoryId : undefined
}

function getCommandRunForMemory(
  item: ElectronWorkbenchMemoryItem,
  commandRunById: ReadonlyMap<string, ElectronWorkbenchCommandRunSnapshot>,
) {
  if (item.kind !== 'command-output')
    return undefined

  const commandArtifact = item.artifactRefs.find(artifact => artifact.kind === 'command' && artifact.id)
  const runId = item.sourceRunId ?? commandArtifact?.id
  return runId ? commandRunById.get(runId) : undefined
}

function createStandaloneTaskCard(
  item: ElectronWorkbenchMemoryItem,
  commandRunById: ReadonlyMap<string, ElectronWorkbenchCommandRunSnapshot>,
): WorkbenchTaskCard {
  const commandRun = getCommandRunForMemory(item, commandRunById)
  return {
    artifactRefs: item.artifactRefs,
    body: item.body,
    commandRuns: commandRun ? [commandRun] : [],
    contextUnits: item.contextUnits,
    createdAt: item.createdAt,
    kind: item.kind,
    relatedItems: [item],
    rootItem: item,
    summary: item.summary,
    taskCardId: getTaskCardIdForMemory(item) ?? item.memoryId,
    title: item.title,
    updatedAt: item.updatedAt,
  }
}

export function buildWorkbenchTaskCards(
  items: ElectronWorkbenchMemoryItem[],
  commandRuns: ElectronWorkbenchCommandRunSnapshot[] = [],
  sessionId?: string,
) {
  const visibleItems = items.filter(item => !isWorkbenchEphemeralItem(item))
  const commandRunById = new Map(commandRuns.map(run => [run.runId, run]))
  const cards = new Map<string, WorkbenchTaskCard>()

  function ensureCard(rootItem: ElectronWorkbenchMemoryItem) {
    const taskCardId = getTaskCardIdForMemory(rootItem) ?? rootItem.memoryId
    const existing = cards.get(taskCardId)
    if (existing)
      return existing

    const card = createStandaloneTaskCard(rootItem, commandRunById)
    card.taskCardId = taskCardId
    cards.set(taskCardId, card)
    return card
  }

  for (const item of visibleItems) {
    if (isTaskRootItem(item))
      ensureCard(item)
  }

  for (const item of visibleItems) {
    const taskCardId = getTaskCardIdForMemory(item)
    if (!taskCardId || isTaskRootItem(item))
      continue

    const rootItem = visibleItems.find(candidate => candidate.memoryId === taskCardId) ?? item
    const card = cards.get(taskCardId) ?? ensureCard(rootItem)
    if (!card.relatedItems.some(relatedItem => relatedItem.memoryId === item.memoryId)) {
      card.relatedItems.push(item)
      card.contextUnits += item.contextUnits
      card.updatedAt = Math.max(card.updatedAt, item.updatedAt)
    }

    const commandRun = getCommandRunForMemory(item, commandRunById)
    if (commandRun && !card.commandRuns.some(run => run.runId === commandRun.runId))
      card.commandRuns.push(commandRun)
  }

  for (const item of visibleItems) {
    if (isTaskRootItem(item) || getTaskCardIdForMemory(item))
      continue

    cards.set(item.memoryId, createStandaloneTaskCard(item, commandRunById))
  }

  for (const run of commandRuns) {
    if (sessionId && run.sessionId !== sessionId)
      continue
    if (!run.taskCardId)
      continue

    const rootItem = visibleItems.find(item => item.memoryId === run.taskCardId)
    if (!rootItem)
      continue

    const card = cards.get(run.taskCardId) ?? ensureCard(rootItem)
    if (!card.commandRuns.some(commandRun => commandRun.runId === run.runId)) {
      card.commandRuns.push(run)
      card.updatedAt = Math.max(card.updatedAt, run.updatedAt)
    }
  }

  for (const card of cards.values()) {
    if (!isAutoTitledTaskRoot(card.rootItem))
      continue

    const titleCandidate = [...card.relatedItems]
      .filter(item => item.memoryId !== card.rootItem.memoryId && (isWorkbenchTitleCandidate(item) || isImplicitWorkbenchTitleCandidate(item)))
      .sort((left, right) => {
        const leftExplicit = isWorkbenchTitleCandidate(left) ? 1 : 0
        const rightExplicit = isWorkbenchTitleCandidate(right) ? 1 : 0
        if (rightExplicit !== leftExplicit)
          return rightExplicit - leftExplicit

        if (right.updatedAt !== left.updatedAt)
          return right.updatedAt - left.updatedAt

        return right.createdAt - left.createdAt
      })[0]

    if (titleCandidate) {
      card.title = titleCandidate.title
      card.summary = titleCandidate.summary || titleCandidate.body || card.summary
    }
  }

  return [...cards.values()].sort((left, right) => {
    if (right.updatedAt !== left.updatedAt)
      return right.updatedAt - left.updatedAt

    return right.createdAt - left.createdAt
  })
}

export function getPrimaryCommandRunForTaskCard(taskCard: WorkbenchTaskCard) {
  return [...taskCard.commandRuns].sort((left, right) => right.updatedAt - left.updatedAt)[0]
}
