let themeTransitionBusy = false

export function toggleMobileTheme(toggle: () => void) {
  const root = document.documentElement
  if (themeTransitionBusy)
    return
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    toggle()
    return
  }

  const bridge = (window as Window & {
    pocketBridge?: {
      prepareThemeTransition: () => Promise<void>
      startThemeTransition: () => Promise<void>
    }
  }).pocketBridge
  themeTransitionBusy = true
  const finish = () => {
    root.classList.remove('pocket-theme-transitioning')
    delete root.dataset.pocketThemeTransition
    themeTransitionBusy = false
    window.dispatchEvent(new Event('pocket-theme-transition-finished'))
  }
  const webTransition = () => {
    root.classList.add('pocket-theme-transitioning')
    if (!document.startViewTransition) {
      toggle()
      finish()
      return
    }
    const transition = document.startViewTransition(toggle)
    void transition.finished.then(finish, finish)
  }
  if (!bridge) {
    webTransition()
    return
  }
  let toggled = false
  void bridge.prepareThemeTransition().then(async () => {
    root.dataset.pocketThemeTransition = 'native'
    toggle()
    toggled = true
    await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())))
    await bridge.startThemeTransition()
  }).then(finish, (error) => {
    console.warn('[PocketTheme] Native transition unavailable', error)
    if (!toggled)
      toggle()
    finish()
  })
}
