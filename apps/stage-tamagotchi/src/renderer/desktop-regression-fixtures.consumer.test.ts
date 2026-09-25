import { describe, expect, it } from 'vitest'

import { parseModelPerformanceConfig } from '../../../../packages/server-shared/src/types'
import { parseOfficialPricing } from '../../../../packages/stage-ui/src/stores/official-pricing'
import {
  getDesktopRegressionCharacterPerformanceFixture,
  getDesktopRegressionPricingFixture,
} from '../shared/desktop-regression-fixtures'

describe('desktop regression fixture consumers', () => {
  it('accepts the fixture pricing and published performance payloads', () => {
    expect(parseOfficialPricing(getDesktopRegressionPricingFixture())).toBeDefined()
    expect(parseModelPerformanceConfig(getDesktopRegressionCharacterPerformanceFixture().config.config)).toMatchObject({
      modelId: 'preset-live2d-1',
      renderer: 'live2d',
    })
  })
})
