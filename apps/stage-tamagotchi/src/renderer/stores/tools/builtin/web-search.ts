/**
 * Web search tools for intelligent web searching with character-aware filtering
 */
export async function webSearchTools() {
  // Dynamically import to ensure tools are properly initialized
  const { intelligentWebSearch } = await import('@proj-airi/stage-ui/tools/web-search')

  // Only expose the main intelligent search tool
  // Internal tools (intentAnalyzer, contextEvaluator, etc.) are used internally
  return [await intelligentWebSearch]
}
