import type { Renderer } from '@pixi/core'

import { ShaderSystem } from '@pixi/core'
import { describe, expect, it, vi } from 'vitest'

import './pixi-csp'

describe('pixi strict CSP support', () => {
  it('initializes without dynamic Function evaluation', () => {
    vi.stubGlobal('Function', () => {
      throw new EvalError('unsafe-eval is blocked')
    })

    try {
      expect(() => new ShaderSystem({} as Renderer)).not.toThrow()
    }
    finally {
      vi.unstubAllGlobals()
    }
  })
})
