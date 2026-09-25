import { nativeImage } from 'electron'
import { isWindows } from 'std-env'

import windowsIcon from '../../../../resources/icon.ico?asset'
import defaultIcon from '../../../../resources/icon.png?asset'

export const windowIcon = nativeImage.createFromPath(isWindows ? windowsIcon : defaultIcon)
