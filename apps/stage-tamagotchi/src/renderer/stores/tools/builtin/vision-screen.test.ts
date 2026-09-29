import type { VisionScreenCapture } from '@proj-airi/stage-ui/composables/use-vision-screen-capture'
import type { useVisionStore } from '@proj-airi/stage-ui/stores/modules/vision'

import { describe, expect, it, vi } from 'vitest'

import { createVisionScreenTools } from './vision-screen'

function createFixture() {
  const capture = {
    listSources: vi.fn(async () => [
      { id: 'screen:0', name: 'Main display', previewDataUrl: '' },
      { id: 'window:1', name: 'Notes', previewDataUrl: '' },
    ]),
    capture: vi.fn(async () => ({ type: 'image' as const, data: 'aGVsbG8=', mimeType: 'image/jpeg' })),
  } satisfies VisionScreenCapture
  const vision = {
    enabled: true,
    modelScreenshotEnabled: true,
    customProviderConfigured: true,
    configurationRevision: 0,
    provider: 'official-cloud',
    analyze: vi.fn(async () => ({ text: 'A note is open.' })),
  } as unknown as ReturnType<typeof useVisionStore>
  const ensureOfficialConsent = vi.fn(async () => true)
  const options = {
    capture,
    vision,
    ensureOfficialConsent,
    isCurrent: () => true,
    parentRequestId: 'user-turn-1',
    sourceSurface: 'voice-call',
  }
  return { capture, ensureOfficialConsent, options, vision }
}

const executionOptions = { messages: [], toolCallId: 'tool-call-1' }

describe('model-directed screen inspection', () => {
  it('sends multiple selected sources in one billed vision request', async () => {
    const { capture, ensureOfficialConsent, options, vision } = createFixture()
    const [screenTool] = await createVisionScreenTools(options)
    const result = await screenTool!.execute({ sourceIds: ['screen:0', 'window:1'], question: 'What is open?' }, executionOptions)

    expect(result).toMatchObject({ inspected: true, description: 'A note is open.' })
    expect(capture.capture).toHaveBeenCalledTimes(2)
    expect(ensureOfficialConsent).toHaveBeenCalledTimes(1)
    expect(vision.analyze).toHaveBeenCalledTimes(1)
    expect(vi.mocked(vision.analyze).mock.calls[0]?.[1]).toHaveLength(2)
    expect(vi.mocked(vision.analyze).mock.calls[0]?.[2]).toMatchObject({
      parentRequestId: 'user-turn-1',
      sourceSurface: 'voice-call',
      turnId: 'user-turn-1',
    })
  })

  it('claims the turn before awaiting consent so parallel calls cannot charge twice', async () => {
    const { capture, options, vision } = createFixture()
    let accept!: (accepted: boolean) => void
    options.ensureOfficialConsent = vi.fn(() => new Promise<boolean>((resolve) => { accept = resolve }))
    const [screenTool] = await createVisionScreenTools(options)
    const first = screenTool!.execute({ sourceIds: ['screen:0'] }, executionOptions)
    const second = await screenTool!.execute({ sourceIds: ['window:1'] }, executionOptions)
    expect(second).toMatchObject({ inspected: false })
    accept(true)
    await first
    expect(capture.capture).toHaveBeenCalledTimes(1)
    expect(vision.analyze).toHaveBeenCalledTimes(1)
  })

  it('stops before capture when the user disables model-directed screenshots', async () => {
    const { capture, options, vision } = createFixture()
    options.ensureOfficialConsent = vi.fn(async () => {
      vision.modelScreenshotEnabled = false
      return true
    })
    const [screenTool] = await createVisionScreenTools(options)
    const result = await screenTool!.execute({ sourceIds: ['screen:0'] }, executionOptions)
    expect(result).toMatchObject({ inspected: false })
    expect(capture.capture).not.toHaveBeenCalled()
    expect(vision.analyze).not.toHaveBeenCalled()
  })

  it('uses the accepted official quote revision and rejects unknown source IDs', async () => {
    const { capture, options, vision } = createFixture()
    options.ensureOfficialConsent = vi.fn(async () => {
      vision.configurationRevision = 1
      return true
    })
    const [screenTool] = await createVisionScreenTools(options)
    await screenTool!.execute({ sourceIds: ['not-listed'] }, executionOptions)
    expect(capture.capture).not.toHaveBeenCalled()
    await screenTool!.execute({ sourceIds: ['screen:0'] }, executionOptions)
    expect(vi.mocked(vision.analyze).mock.calls[0]?.[2]).toMatchObject({ configurationRevision: 1 })
  })
})
