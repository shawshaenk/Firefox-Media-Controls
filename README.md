# Media Controls for Firefox

Media Controls brings a Chrome-style global media controls flyout to Firefox. Open it from the toolbar to see and control media across your tabs in one place.

## Features

- **One card per media tab.** Keep track of multiple tabs playing or holding media, with the site name, page title, artist when available, and cover art or favicon.
- **Broad media detection.** Detects audio and video elements, including media in frames and shadow DOM, detached `new Audio()` elements, Media Session metadata and actions, and Web Audio contexts.
- **Playback controls.** Play and pause media, and use previous or next when the site provides those actions. YouTube playlist position and available player controls are used to decide when track controls are available.
- **Seeking.** Drag the progress bar to seek or skip backward and forward by 10 seconds. Seeking controls are hidden for live or non-seekable media and disabled when playback is blocked.
- **Autoplay feedback.** Firefox's autoplay policy still applies. If Firefox blocks extension playback, the Play button and seek skip buttons are disabled until playback is started from the page.
- **Fallback for restricted tabs.** When Firefox reports a tab as audible but the extension cannot access its page, a simplified card lets you mute or unmute that tab.
- **Pin and reorder cards.** Pin important cards to keep them above the rest, then drag cards to arrange their order. Pinning and custom order are saved across browser restarts.
- **Tab count badge.** The toolbar badge shows how many cards are being tracked, including paused sessions; it is not limited to tabs currently producing sound.
- **Light and dark themes.** The flyout follows the browser's color scheme.
- **Keyboard access.** Use the slider's arrow, Home, and End keys to seek. Use the card's drag handle or Alt/Ctrl + Up/Down to reorder cards.
- **Quick access.** Open the flyout with `Alt+Shift+M` or click the extension's toolbar button.

Paused sessions stay in the flyout for up to 60 minutes, so you can resume playback without finding the tab again. They are removed when their tab closes or navigates. Click the non-control area of a card to focus its tab. When there are no cards, the flyout shows a “No media is playing” message.

## Compatibility and permissions

- Firefox 128 or newer (Manifest V3).
- LibreWolf may also work, depending on its WebExtension support and permission settings.
- The extension requests access to web pages so it can detect media and send controls to the page. If access is missing, use **Grant access** in the flyout.
- Firefox does not allow extensions to synthesize a trusted click in a page. A page that requires user activation must be started manually once before extension playback controls can work.
- Track controls depend on each site's player. Previous and next are disabled when the page does not expose those actions; site behavior can vary.
- Some browser-internal and protected pages do not allow content scripts. Audible tabs on those pages can only use the mute/unmute fallback.

## Install for local use

Build the XPI, then load it as a temporary add-on:

1. Install Node.js and Python 3.
2. Run `npm install` in this repository.
3. Run `npm run package`.
4. In Firefox, open `about:debugging#/runtime/this-firefox`.
5. Choose **Load Temporary Add-on** and select `dist/media-controls-1.0.10.xpi`.

Temporary add-ons must be loaded again after restarting Firefox. This locally built XPI is not signed for permanent installation from the Add-ons Manager.

## Build and development

```sh
npm install
npm run build       # Bundle the extension scripts
npm run package     # Build and create dist/media-controls-1.0.10.xpi
npm run typecheck   # Check TypeScript types
npm run lint        # Run web-ext lint
```

The extension uses TypeScript, esbuild, and vanilla HTML/CSS/JavaScript for its popup. Its page hook runs in the page's main world to observe and control media; an isolated relay passes sanitized state and commands to the background event page, which maintains sessions and updates the popup.
