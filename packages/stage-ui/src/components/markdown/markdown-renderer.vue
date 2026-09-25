<script setup lang="ts">
import DOMPurify from 'dompurify'

import { ref, watch } from 'vue'

import { useMarkdown } from '../../composables/markdown'

interface Props {
  content: string
  class?: string
}

const props = defineProps<Props>()

const processedContent = ref('')
const { process, processSync } = useMarkdown()
let processContentRequestId = 0

async function processContent() {
  const requestId = ++processContentRequestId
  const content = props.content

  if (!content) {
    processedContent.value = ''
    return
  }

  try {
    const nextContent = DOMPurify.sanitize(await process(content))
    if (requestId === processContentRequestId)
      processedContent.value = nextContent
  }
  catch (error) {
    console.warn('[MarkdownRenderer] Failed to process markdown with syntax highlighting, using fallback:', error)
    const nextContent = DOMPurify.sanitize(processSync(content))
    if (requestId === processContentRequestId)
      processedContent.value = nextContent
  }
}

watch(() => props.content, processContent, { immediate: true })
</script>

<template>
  <div
    :class="props.class"
    class="markdown-content"
    v-html="processedContent"
  />
</template>

<style scoped>
.markdown-content :deep(pre) {
  overflow-x: auto;
  max-width: 100%;
  border-radius: 6px;
  padding: 1rem;
  margin: 0.5rem 0;
}

/* Markdown normally collapses whitespace in paragraphs. Chat replies are
 * streamed verbatim, so preserve intentional spaces and line breaks after the
 * typewriter switches to the completed Markdown renderer. */
.markdown-content {
  white-space: pre-wrap;
}

.markdown-content :deep(code) {
  font-family: 'Fira Code', 'Monaco', 'Consolas', monospace;
  font-size: 0.875em;
}

.markdown-content :deep(pre code) {
  display: block;
  width: fit-content;
  min-width: 100%;
}

/* Ensure horizontal scrolling for wide code blocks */
.markdown-content :deep(pre.shiki) {
  overflow-x: auto;
  white-space: pre;
}

.markdown-content :deep(.shiki) {
  border-radius: 6px;
  padding: 1rem;
  margin: 0.5rem 0;
}

/* Fallback styles for non-shiki code blocks */
.markdown-content :deep(pre:not(.shiki)) {
  background: var(--airi-chat-detail-surface, #f6f8fa);
  border: 1px solid var(--airi-border-subtle, #d0d7de);
}

.dark .markdown-content :deep(pre:not(.shiki)) {
  background: var(--airi-chat-detail-surface, #161b22);
  border: 1px solid var(--airi-border-subtle, #30363d);
}

/* Force Shiki multi-theme output to follow our dark mode */
.dark .markdown-content :deep(.shiki) {
  background: var(--shiki-dark-bg, #0d1117) !important;
  color: var(--shiki-dark, #e6edf3) !important;
}

.dark .markdown-content :deep(.shiki span[style*="--shiki-dark"]) {
  color: var(--shiki-dark, inherit) !important;
}

.dark .markdown-content :deep(.shiki span[style*="--shiki-dark-background"]) {
  background-color: var(--shiki-dark-background, var(--shiki-dark-bg, transparent)) !important;
}
</style>
