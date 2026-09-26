import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

const source = readFileSync(new URL('./Live2D.vue', import.meta.url), 'utf8')
const modelSource = readFileSync(new URL('./live2d/Model.vue', import.meta.url), 'utf8')

describe('live2D scene render resolution', () => {
  it('keeps the full-quality default while allowing lighter previews', () => {
    expect(source).toContain('resolution?: number')
    expect(source).toContain('resolution: 2')
    expect(source).toContain(':resolution="resolution"')
  })

  it('pauses both the Pixi canvas and model updates', () => {
    expect(source.match(/:paused="paused"/g)).toHaveLength(2)
  })

  it('forwards the runtime mode to isolate settings previews from stage events', () => {
    expect(source).toContain('runtimeMode?: \'stage\' | \'preview\'')
    expect(source).toContain('runtimeMode: \'stage\'')
    expect(source).toContain(':runtime-mode="runtimeMode"')
  })

  it('exposes a local composite action preview API', () => {
    expect(source).toContain('previewAction(action:')
    expect(source).toContain('previewAction,')
    expect(modelSource).toContain('async function previewAction(')
    expect(modelSource).toContain('beginMotionPlayback(\'preview\'')
    expect(modelSource).toContain('resolveActionExpression(action.expression)')
  })
})
