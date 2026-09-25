import { isProductAudienceVisible } from '@proj-airi/stage-shared'
import { describe, expect, it } from 'vitest'

describe('desktop product audience visibility', () => {
  it('keeps advanced features visible while hiding developer tools from consumers', () => {
    expect(isProductAudienceVisible('advanced', 'consumer')).toBe(true)
    expect(isProductAudienceVisible('developer', 'consumer')).toBe(false)
    expect(isProductAudienceVisible('developer', 'dev')).toBe(true)
  })
})
