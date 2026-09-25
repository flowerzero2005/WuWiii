// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, defineComponent, h, nextTick, ref } from 'vue'

import RadioCardDetail from './radio-card-detail.vue'

vi.mock('@proj-airi/ui', () => ({
  Input: defineComponent({
    props: { modelValue: String },
    emits: ['update:modelValue'],
    render() {
      return h('input', {
        class: 'custom-model-input',
        value: this.modelValue,
        onInput: (event: Event) => this.$emit('update:modelValue', (event.target as HTMLInputElement).value),
      })
    },
  }),
  TransitionVertical: defineComponent({ render() { return this.$slots.default?.() } }),
}))

let root: HTMLDivElement | undefined

afterEach(() => {
  root?.remove()
  root = undefined
})

describe('radioCardDetail', () => {
  it('selects the card from every non-interactive card region', async () => {
    const selected = ref('')
    const updateSelected = vi.fn((value: string) => selected.value = value)
    root = document.createElement('div')
    document.body.append(root)

    createApp({
      render: () => h(RadioCardDetail, {
        'id': 'official-cloud',
        'description': 'Use the official cloud provider.',
        'modelValue': selected.value,
        'name': 'onboarding-setup-path',
        'title': 'Official cloud',
        'value': 'official-cloud',
        'onUpdate:modelValue': updateSelected,
      }),
    }).mount(root)

    const selectionIndicator = root.querySelector<HTMLElement>('.form_radio-card-detail > div')
    expect(selectionIndicator).toBeTruthy()
    selectionIndicator?.click()
    await nextTick()

    expect(updateSelected).toHaveBeenCalledWith('official-cloud')
    expect(selected.value).toBe('official-cloud')

    selected.value = ''
    await nextTick()
    root.querySelector<HTMLElement>('.line-clamp-1')?.click()
    await nextTick()

    expect(selected.value).toBe('official-cloud')

    selected.value = ''
    await nextTick()
    root.querySelector<HTMLElement>('.line-clamp-2')?.click()
    await nextTick()

    expect(selected.value).toBe('official-cloud')

    selected.value = ''
    await nextTick()
    root.querySelector<HTMLElement>('.form_radio-card-detail')?.click()
    await nextTick()

    expect(selected.value).toBe('official-cloud')
  })

  it('does not select the card when expanding its description', async () => {
    const selected = ref('')
    root = document.createElement('div')
    document.body.append(root)

    createApp({
      render: () => h(RadioCardDetail, {
        'id': 'official-cloud',
        'description': 'Use the official cloud provider. This deliberately long description keeps the expansion control visible without selecting the model.',
        'expandCollapseThreshold': 20,
        'modelValue': selected.value,
        'name': 'onboarding-setup-path',
        'title': 'Official cloud',
        'value': 'official-cloud',
        'onUpdate:modelValue': (value: string) => selected.value = value,
      }),
    }).mount(root)

    root.querySelector<HTMLButtonElement>('button')?.click()
    await nextTick()

    expect(selected.value).toBe('')
  })

  it('keeps the custom model input editable', async () => {
    const selected = ref('custom')
    root = document.createElement('div')
    document.body.append(root)

    createApp({
      render: () => h(RadioCardDetail, {
        'id': 'custom',
        'modelValue': selected.value,
        'name': 'onboarding-setup-path',
        'showCustomInput': true,
        'title': 'Custom model',
        'value': 'custom',
        'onUpdate:modelValue': (value: string) => selected.value = value,
      }),
    }).mount(root)

    const input = root.querySelector<HTMLInputElement>('.custom-model-input')!
    input.value = 'custom-model'
    input.dispatchEvent(new Event('input', { bubbles: true }))
    await nextTick()

    expect(selected.value).toBe('custom-model')
  })
})
