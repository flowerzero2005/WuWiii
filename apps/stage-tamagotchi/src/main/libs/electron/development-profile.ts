import type { App } from 'electron'

import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

/** Keep both packaged and unpackaged development builds away from consumer data. */
export function configureDevelopmentProfile(app: Pick<App, 'getPath' | 'setPath'>, regression: boolean) {
  if (regression)
    return
  const userData = join(app.getPath('appData'), 'cn.wuwiii.desktop.development')
  const paths = { userData, sessionData: join(userData, 'session'), logs: join(userData, 'logs') }
  for (const [name, path] of Object.entries(paths)) {
    mkdirSync(path, { recursive: true })
    app.setPath(name, path)
  }
}
