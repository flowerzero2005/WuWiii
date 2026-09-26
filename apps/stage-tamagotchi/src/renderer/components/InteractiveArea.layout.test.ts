import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'
import { parse } from 'vue/compiler-sfc'

describe('chat composer branches', () => {
  it('renders the main composer as the alternative to the widget surface', () => {
    const source = readFileSync(new URL('./InteractiveArea.vue', import.meta.url), 'utf8')
    const { descriptor, errors } = parse(source)
    expect(errors).toEqual([])
    const ast = descriptor.template!.ast!
    let found = false
    function visit(node: typeof ast | (typeof ast['children'][number])) {
      if (node.type !== 0 && node.type !== 1)
        return
      const elements = node.children.filter(child => child.type === 1)
      for (let index = 0; index < elements.length; index++) {
        const element = elements[index]
        const widgetBranch = element.tag === 'div'
          && source.slice(element.loc.start.offset, element.loc.end.offset).includes('ref="quickChatTextareaRef"')
          && element.props.some(prop => prop.type === 7 && prop.name === 'if' && prop.exp?.type === 4 && prop.exp.content === 'isWidgetSurface')
        if (widgetBranch) {
          const alternative = elements[index + 1]
          expect(alternative?.props.some(prop => prop.type === 7 && prop.name === 'else'), `Widget branch at line ${element.loc.start.line}: next sibling ${alternative?.tag}`).toBe(true)
          expect(source.slice(alternative.loc.start.offset, alternative.loc.end.offset)).toContain('ref="mainChatTextareaRef"')
          found = true
        }
      }
      node.children.forEach(visit)
    }
    visit(ast)
    expect(found).toBe(true)
  })

  it('keeps detached composer controls out of collapsed quick chat while retaining recovery access', () => {
    const source = readFileSync(new URL('./InteractiveArea.vue', import.meta.url), 'utf8')

    expect(source).toContain('v-if="isCollapsed && (detachedComposer.failed.value || detachedComposer.recoveryUncertain.value || detachedComposer.checkpointFailed.value)"')
    expect(source).toContain('data-chat-composer-recovery')
    expect(source).toContain('@click.stop="requestWidgetExpand()"')
    expect(source).toContain(':placeholder="isInitialized ? t(\'stage.chat.composer.placeholder\') : t(\'tamagotchi.stage.bootstrap.conversation\')"')
    expect(source).not.toContain("t('stage.message')")
    expect(source).toMatch(/<div v-if="!isCollapsed" class="order-2 w-full flex shrink-0 items-center gap-1 overflow-x-auto">[\s\S]*data-chat-composer-detach-controls/)
  })
})
