# Extension: install and manual test

Automated coverage: `e2e/picker.e2e.ts` drives the same picker core (bookmarklet build)
in headless Chrome: hover badge, dialog, server preview, Create, Esc.

## Install

1. `npm run build` (or `node scripts/build.mjs extension`).
2. `chrome://extensions` → Developer mode → **Load unpacked** → `dist/extension`.
3. The options page opens on first click: server URL, basic-auth username/password,
   default frequency → **Save** (Chrome asks to allow the server's origin) → **Test connection**.
4. Pin the icon. Shortcut: Alt+Shift+G. Re-load the extension after each build.

## Manual checks

| Page | Expect |
|---|---|
| YouTube watch page, click the "…K views" line | Rounded value; the dialog offers **Track with the YouTube helper** (use it). |
| Amazon product page, click the Best Sellers Rank line | Proxy pre-checked; preview shows http or browser ✓ once the proxy is configured. |
| One of your own pages behind basic auth | Preview shows HTTP 401 until the host is in `credentials.json`. |
| A page with a strict CSP (e.g. github.com) | Extension works; the bookmarklet does not (expected). |
| Any page, press Esc | Picker disappears; page clicks work again. |
