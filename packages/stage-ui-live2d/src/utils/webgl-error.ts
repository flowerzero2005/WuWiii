function extractErrorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function isPixiCanvasFallbackHint(message: string) {
  return /pixi\.js-legacy|fallback canvas2d support/i.test(message)
}

function isWebGLUnsupportedMessage(message: string) {
  return /webgl unsupported|webgl.*unavailable|failed to initialize.*webgl/i.test(message)
}

// NOTICE: Live2D on pixi-live2d-display requires a WebGL renderer. Pixi's generic
// "use pixi.js-legacy" hint is misleading here because canvas fallback cannot render
// the model, so we normalize the message before surfacing it to users.
export function normalizeLive2DWebGLErrorMessage(error: unknown) {
  const message = extractErrorMessage(error)

  if (isWebGLUnsupportedMessage(message) || isPixiCanvasFallbackHint(message)) {
    return 'WebGL is unavailable in this renderer process. Live2D requires WebGL, and Pixi canvas fallback is not supported for this scene.'
  }

  return message
}
