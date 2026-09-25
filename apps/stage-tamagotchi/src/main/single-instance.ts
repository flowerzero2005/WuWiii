interface SingleInstanceApp {
  on: (event: 'second-instance', listener: () => void) => unknown
  quit: () => void
  requestSingleInstanceLock: () => boolean
}

// Claims Electron's process lock and defers activation until the primary main window owns it.
export function setupSingleInstance(app: SingleInstanceApp) {
  const isPrimary = app.requestSingleInstanceLock()
  let activationOwner: (() => void) | undefined
  let activationPending = false

  if (!isPrimary) {
    app.quit()
  }
  else {
    app.on('second-instance', () => {
      if (activationOwner)
        activationOwner()
      else
        activationPending = true
    })
  }

  return {
    isPrimary,
    setActivationOwner(activate: () => void) {
      activationOwner = activate
      if (!activationPending)
        return

      activationPending = false
      activationOwner()
    },
  }
}
