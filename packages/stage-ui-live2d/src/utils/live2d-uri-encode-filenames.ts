import type { Live2DFactoryContext, Middleware, ModelSettings } from 'pixi-live2d-display/cubism4'

interface Live2DFileEncodingSettings extends Partial<ModelSettings> {
  expressions?: Array<{ File?: string, file?: string }>
  motions?: Record<string, Array<{ File?: string, Sound?: string, file?: string, sound?: string }>>
}

function encodeLive2DURI(value: string) {
  try {
    return encodeURI(decodeURI(value))
  }
  catch {
    return encodeURI(value)
  }
}

function tryEncode(obj: any, prop: string | number) {
  if (obj?.[prop] && typeof obj[prop] === 'string') {
    obj[prop] = encodeLive2DURI(obj[prop])
  }
}

// A middleware to URI-encode possible filenames in settings to handle filenames with UTF-8 characters.
export const live2dEncodeFilenamesMiddleware: Middleware<Live2DFactoryContext> = (context, next) => {
  if (typeof context.source !== 'object' || !context.source)
    return next()

  // Be skeptical
  const settings = context.source.settings as Live2DFileEncodingSettings | undefined
  if (!settings)
    return next()

  tryEncode(settings, 'moc')
  if (Array.isArray(settings.textures)) {
    for (let i = 0; i < settings.textures.length; i++) {
      tryEncode(settings.textures, i)
    }
  }
  tryEncode(settings, 'physics')
  tryEncode(settings, 'pose')
  tryEncode(settings, 'url')

  if (settings.motions && typeof settings.motions === 'object') {
    Object.values(settings.motions).forEach((motions) => {
      motions?.forEach((motion) => {
        tryEncode(motion, 'File')
        tryEncode(motion, 'Sound')
        tryEncode(motion, 'file')
        tryEncode(motion, 'sound')
      })
    })
  }

  settings.expressions?.forEach((expression) => {
    tryEncode(expression, 'File')
    tryEncode(expression, 'file')
  })

  return next()
}
