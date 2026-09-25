/** Builds the isolated document used by the non-focusable sent-message preview window. */
export function createUserBubbleDocument() {
  return `<!doctype html>
<html>
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'unsafe-inline'">
  <style>
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; overflow: hidden; background: transparent; }
    body { display: flex; align-items: flex-end; justify-content: center; padding: 4px 8px; font-family: var(--font-family); }
    .row { display: flex; width: 100%; min-width: 0; align-items: flex-end; gap: 8px; }
    .bubble {
      position: relative; min-width: 0; flex: 1; max-height: 124px; overflow: hidden; padding: 12px 15px 14px;
      border: 1px solid var(--border); border-radius: var(--radius); background: var(--surface); box-shadow: var(--shadow);
      opacity: 0; filter: blur(8px); transform: translateY(16px);
      transition: opacity var(--enter) ease, filter var(--enter) ease, transform var(--enter) cubic-bezier(0.16, 1, 0.3, 1);
    }
    .bubble.visible { opacity: 1; filter: blur(0); transform: translateY(0); }
    .bubble.leaving { opacity: 0; filter: blur(7px); transform: translateY(-18px); transition-duration: var(--exit); }
    .avatar { position: relative; display: grid; width: 38px; height: 38px; flex: 0 0 38px; place-items: center; overflow: hidden; border: 1px solid var(--border); border-radius: 999px; background: color-mix(in srgb, var(--surface) 82%, white); box-shadow: var(--shadow); opacity: 0; transform: translateY(12px); transition: opacity var(--enter) ease, transform var(--enter) cubic-bezier(0.16, 1, 0.3, 1); }
    .bubble.visible + .avatar { opacity: 1; transform: translateY(0); }
    .bubble.leaving + .avatar { opacity: 0; transform: translateY(-12px); transition-duration: var(--exit); }
    .avatar img { width: 100%; height: 100%; object-fit: cover; }
    .avatar-fallback::before { content: ''; position: absolute; left: 50%; top: 8px; width: 10px; height: 10px; border-radius: 999px; background: var(--text); opacity: 0.68; transform: translateX(-50%); }
    .avatar-fallback::after { content: ''; position: absolute; left: 50%; bottom: 6px; width: 20px; height: 11px; border-radius: 12px 12px 6px 6px; background: var(--text); opacity: 0.68; transform: translateX(-50%); }
    .image { position: absolute; inset: 0; background-position: center; background-repeat: no-repeat; background-size: cover; opacity: var(--image-strength); pointer-events: none; }
    .content { position: relative; z-index: 1; }
    .label { margin-bottom: 5px; color: color-mix(in srgb, var(--accent) 58%, white); font-size: 10px; font-weight: 700; letter-spacing: 0.18em; }
    .text { display: -webkit-box; margin: 0; overflow: hidden; overflow-wrap: anywhere; color: var(--text); font-size: var(--font-size); font-weight: var(--font-weight); line-height: var(--line-height); -webkit-box-orient: vertical; -webkit-line-clamp: 4; }
    @media (prefers-reduced-motion: reduce) { .bubble, .avatar { filter: none; transform: none; transition-duration: 0.01ms !important; } }
  </style>
</head>
<body>
  <div class="row"><section class="bubble"><div class="image"></div><div class="content"><div class="label"></div><p class="text"></p></div></section><div class="avatar"><img alt=""><span class="avatar-fallback"></span></div></div>
  <script>
    const root = document.documentElement;
    const bubble = document.querySelector('.bubble');
    const image = document.querySelector('.image');
    const avatarImage = document.querySelector('.avatar img');
    const avatarFallback = document.querySelector('.avatar-fallback');
    const label = document.querySelector('.label');
    const text = document.querySelector('.text');
    let animationFrame;
    let leaveTimer;

    window.quickChatUserBubble.onPayload((payload) => {
      if (animationFrame)
        cancelAnimationFrame(animationFrame);
      if (leaveTimer)
        clearTimeout(leaveTimer);

      bubble.classList.remove('visible', 'leaving');
      root.style.setProperty('--accent', payload.accentColor);
      root.style.setProperty('--surface', payload.backgroundColor);
      root.style.setProperty('--border', payload.borderColor);
      root.style.setProperty('--radius', payload.borderRadius);
      root.style.setProperty('--shadow', payload.boxShadow);
      root.style.setProperty('--text', payload.textColor);
      root.style.setProperty('--font-family', payload.fontFamily);
      root.style.setProperty('--font-size', payload.fontSize + 'px');
      root.style.setProperty('--font-weight', payload.fontWeight);
      root.style.setProperty('--line-height', payload.lineHeight);
      root.style.setProperty('--image-strength', payload.imageStrength);
      root.style.setProperty('--enter', payload.enterDurationMs + 'ms');
      root.style.setProperty('--exit', payload.exitDurationMs + 'ms');
      image.style.backgroundImage = payload.backgroundImageDataUrl
        ? 'url(' + JSON.stringify(payload.backgroundImageDataUrl) + ')'
        : 'none';
      avatarImage.hidden = !payload.avatarDataUrl;
      avatarFallback.hidden = Boolean(payload.avatarDataUrl);
      avatarImage.src = payload.avatarDataUrl || '';
      label.textContent = payload.label;
      text.textContent = payload.text;

      animationFrame = requestAnimationFrame(() => {
        animationFrame = undefined;
        bubble.classList.add('visible');
        leaveTimer = setTimeout(() => {
          leaveTimer = undefined;
          bubble.classList.add('leaving');
        }, payload.enterDurationMs + payload.holdDurationMs);
      });
    });
  </script>
</body>
</html>`
}
