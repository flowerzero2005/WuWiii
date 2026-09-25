import type { BrowserWindow as ElectronBrowserWindow } from 'electron'

import { BrowserWindow } from 'electron'

import { windowIcon } from '../shared/window-icon'

export interface StartupWindowController {
  close: () => void
}

export function createStartupWindowDocument(iconDataUrl: string) {
  const iconMarkup = iconDataUrl
    ? `<img src="${iconDataUrl}" alt="">`
    : '<span aria-hidden="true">W</span>'

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'">
  <title>Wuwiii 正在启动</title>
  <style>
    :root { color-scheme: light; font-family: "Segoe UI", "Microsoft YaHei UI", sans-serif; }
    * { box-sizing: border-box; }
    body {
      width: 100vw;
      height: 100vh;
      margin: 0;
      padding: 24px 28px;
      display: grid;
      grid-template-columns: 58px minmax(0, 1fr);
      align-items: center;
      gap: 18px;
      overflow: hidden;
      color: #18312b;
      background: #f7faf8;
      letter-spacing: 0;
      user-select: none;
    }
    .icon {
      width: 58px;
      height: 58px;
      display: grid;
      place-items: center;
      overflow: hidden;
      border: 1px solid #d8e4df;
      border-radius: 8px;
      color: #ffffff;
      background: #2f8f69;
      font-size: 28px;
      font-weight: 700;
    }
    .icon img { width: 100%; height: 100%; object-fit: cover; }
    main { min-width: 0; }
    h1 { margin: 0; font-size: 21px; line-height: 1.25; font-weight: 650; }
    .status { margin: 7px 0 14px; color: #60706c; font-size: 13px; line-height: 1.4; }
    .progress { width: 92px; display: grid; grid-template-columns: 1fr 1.55fr 1fr; gap: 5px; }
    .progress span {
      height: 4px;
      border-radius: 2px;
      background: #2f8f69;
      animation: breathe 1.2s ease-in-out infinite;
    }
    .progress span:nth-child(2) { animation-delay: 140ms; }
    .progress span:nth-child(3) { animation-delay: 280ms; }
    @keyframes breathe { 0%, 100% { opacity: .24; } 50% { opacity: 1; } }
    @media (prefers-reduced-motion: reduce) { .progress span { animation: none; opacity: .7; } }
  </style>
</head>
<body>
  <div class="icon">${iconMarkup}</div>
  <main role="status" aria-live="polite">
    <h1>正在启动 Wuwiii</h1>
    <p class="status">正在载入角色与设置...</p>
    <div class="progress" aria-hidden="true"><span></span><span></span><span></span></div>
  </main>
</body>
</html>`
}

export function setupStartupWindow(): StartupWindowController {
  let window: ElectronBrowserWindow | undefined
  let canShow = true

  function close() {
    const currentWindow = window
    window = undefined
    if (currentWindow && !currentWindow.isDestroyed())
      currentWindow.destroy()
  }

  try {
    const startupWindow = new BrowserWindow({
      title: 'Wuwiii 正在启动',
      width: 400,
      height: 170,
      useContentSize: true,
      center: true,
      show: false,
      closable: false,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      autoHideMenuBar: true,
      backgroundColor: '#f7faf8',
      icon: windowIcon,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    window = startupWindow

    startupWindow.once('ready-to-show', () => {
      if (canShow && window === startupWindow && !startupWindow.isDestroyed())
        startupWindow.show()
    })
    startupWindow.once('closed', () => {
      if (window === startupWindow)
        window = undefined
    })

    const iconDataUrl = windowIcon.isEmpty() ? '' : windowIcon.toDataURL()
    const document = createStartupWindowDocument(iconDataUrl)
    void startupWindow.loadURL(`data:text/html;charset=UTF-8,${encodeURIComponent(document)}`)
      .catch((error) => {
        console.warn('[StartupWindow] Failed to load startup document:', error)
        // NOTICE: Destroying the only BrowserWindow can trigger window-all-closed
        // before the main window exists. Keep it hidden until normal cleanup.
        canShow = false
        if (!startupWindow.isDestroyed())
          startupWindow.hide()
      })
  }
  catch (error) {
    console.warn('[StartupWindow] Failed to create startup window:', error)
    close()
  }

  return { close }
}
