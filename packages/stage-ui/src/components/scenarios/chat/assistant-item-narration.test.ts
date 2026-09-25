import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./assistant-item.vue', import.meta.url), 'utf8').replace(/\r\n/g, '\n')

describe('assistant narration presentation', () => {
  it('renders narration as a translated, avatar-free note instead of a chat bubble', () => {
    const narrationBranch = source.indexOf('v-if="isNarration && !shouldHideMessage"')
    const ordinaryAssistantBranch = source.indexOf('v-else-if="isToolStatusOnly"', narrationBranch)

    expect(narrationBranch).toBeGreaterThan(-1)
    expect(ordinaryAssistantBranch).toBeGreaterThan(narrationBranch)
    expect(source.slice(narrationBranch, ordinaryAssistantBranch)).toContain(`t('stage.chat.group.narration-label')`)
    expect(source.slice(narrationBranch, ordinaryAssistantBranch)).not.toContain('<ChatMessageAvatar')
  })

  it('never exposes feedback or inner-voice actions on narration', () => {
    expect(source).toMatch(/const showFeedbackActions = computed\(\(\) => \{[\s\S]*?&& !isNarration\.value/)
    expect(source).toContain('return showFeedbackActions.value\n    && isCanonicalInnerVoiceMessage.value')
  })
})
