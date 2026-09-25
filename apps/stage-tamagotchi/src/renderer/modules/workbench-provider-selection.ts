export function isWorkbenchProviderSelectionCurrent(input: {
  generation: number
  currentGeneration: number
  providerId: string
  selectedProviderId: string
}) {
  return input.generation === input.currentGeneration
    && input.providerId === input.selectedProviderId
}
