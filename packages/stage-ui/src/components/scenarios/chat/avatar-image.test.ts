// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createApp, h, nextTick } from 'vue'

import CharacterAvatarImage from './avatar-image.vue'

const modelPreview = 'data:image/png;base64,cHJldmlldw=='

vi.mock('../../../stores/display-models', () => ({
  useDisplayModelsStore: () => ({ displayModels: [{ id: 'selected-model', previewImage: 'data:image/png;base64,cHJldmlldw==' }] }),
}))
vi.mock('../../../stores/settings/avatar-framing', () => ({
  useAvatarFramingSettingsStore: () => ({ getFraming: () => ({}) }),
  createAvatarFramingStyle: () => ({}),
}))

let root: HTMLDivElement | undefined

afterEach(() => {
  root?.remove()
  root = undefined
})

describe('character avatar image', () => {
  it('uses the model preview when the card avatar fails, then falls back to the initial', async () => {
    root = document.createElement('div')
    document.body.append(root)
    const onError = vi.fn()
    createApp({
      render: () => h(CharacterAvatarImage, { src: 'https://invalid.example/avatar.png', modelId: 'selected-model', onError }, { default: () => '角' }),
    }).mount(root)

    const image = root.querySelector('img')!
    expect(image.getAttribute('src')).toBe('https://invalid.example/avatar.png')
    image.dispatchEvent(new Event('error'))
    await nextTick()
    expect(root.querySelector('img')?.getAttribute('src')).toBe(modelPreview)
    expect(onError).not.toHaveBeenCalled()

    root.querySelector('img')!.dispatchEvent(new Event('error'))
    await nextTick()
    expect(root.querySelector('img')).toBeNull()
    expect(root.textContent).toBe('角')
    expect(onError).toHaveBeenCalledOnce()
  })
})
