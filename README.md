# Media Controls for Firefox

Media Controls brings a Chrome-style global media controls flyout to Firefox. Open it from the toolbar to see and control media across your tabs in one place.

![Media Controls extension demo](dev/EXTENSION_DEMO.png)

## Features

- **One card per media tab.** Keep track of multiple tabs playing or holding media, with the site name, page title, artist when available, and cover art or favicon.
- **Broad media detection.** Detects audio and video elements, including media in frames and shadow DOM, detached `new Audio()` elements, Media Session metadata and actions, and Web Audio contexts.
- **Playback controls.** Play and pause media, and use previous or next when the site provides those actions. Site-aware controls account for YouTube playlist position and player controls, and improve playback reliability on supported sites such as Spotify.
- **Seeking.** Drag the progress bar to seek or skip backward and forward by 10 seconds. Seeking controls are hidden for live or non-seekable media and disabled when playback is blocked.
- **Per-card volume.** Open the volume menu on a card to adjust that tab's volume with a 0–100% slider and percentage label. Each card controls only its own tab; YouTube cards use the player volume so the site and flyout stay in sync. The row also has a mute/unmute button for the tab. Muting preserves the slider level, and moving the slider while muted changes the stored level without unmuting. Web Audio and restricted-player cards show tab mute with a “Volume unavailable for this player” note instead of a slider.
- **YouTube chapters.** Open the chapter menu on a YouTube video card to jump to a chapter. The list scrolls within the card and automatically scrolls to the chapter currently playing.
- **Autoplay feedback.** Firefox's autoplay policy still applies. If Firefox blocks extension playback, the Play button and seek skip buttons are disabled until playback is started from the page.
- **Fallback for restricted tabs.** When Firefox reports a tab as audible but the extension cannot access its page, a simplified card lets you mute or unmute that tab.
- **Pin and reorder cards.** Pin important cards to keep them above the rest, then drag cards to arrange their order. The order of pinned cards is saved across flyout and browser restarts.
- **Tab count badge.** The toolbar badge shows how many cards are being tracked, including paused sessions; it is not limited to tabs currently producing sound.
- **Light and dark themes.** The flyout follows the browser's color scheme.
- **Keyboard access.** Use the seek slider's arrow, Home, and End keys to seek, and the volume slider's arrows to adjust volume. Use the card's drag handle or Alt/Ctrl + Up/Down to reorder cards.
- **Quick access.** Open the flyout with `Alt+Shift+M` or click the extension's toolbar button.

Paused sessions stay in the flyout while their media remains available to control. They are removed when their tab closes or navigates away from the media. Click the non-control area of a card to focus its tab. When there are no cards, the flyout shows a “No media is playing” message.

## Compatibility and permissions

- Firefox 128 or newer (Manifest V3).
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
5. Choose **Load Temporary Add-on** and select the XPI in `dist` (currently `dist/media-controls-1.0.1.xpi`).

Temporary add-ons must be loaded again after restarting Firefox. This locally built XPI is not signed for permanent installation from the Add-ons Manager.

## Build and development

```sh
npm install
npm run build       # Bundle the extension scripts
npm run package     # Build and create an XPI in dist using the manifest version
npm run typecheck   # Check TypeScript types
npm run lint        # Run web-ext lint
```

The extension uses TypeScript, esbuild, and vanilla HTML/CSS/JavaScript for its popup. Its page hook runs in the page's main world to observe and control media; an isolated relay passes sanitized state and commands to the background event page, which maintains sessions and updates the popup.

## License

The extension's original code is licensed under the MIT License; see [LICENSE](LICENSE). Bundled Material Symbols Rounded icons are licensed under Apache 2.0; see [LICENSE-APACHE-2.0.txt](LICENSE-APACHE-2.0.txt) and [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

## Privacy and security

The extension does not collect or transmit user data to the developer or an analytics service. Media details and tab information stay in the browser for the controls to work. The manifest declares `data_collection_permissions.required: ["none"]` for Firefox's no-data-collection disclosure.

Media reports from pages are untrusted. The extension validates and bounds their fields, coalesces frequent updates, and accepts privileged control requests only from its own popup. A page can still misreport its own media; it cannot choose another tab's identity through the media relay.

Saved pins and ordering use installation-specific HMAC identifiers instead of full URLs. Existing saved URLs are migrated and removed. These identifiers preserve exact matching across restarts, including pages with different query parameters. This reduces plaintext URL retention; it does not encrypt the browser profile. Current tab information and YouTube back-navigation history remain in session storage for playback features.

Cover images and favicons can contact their original hosts. The popup sends no referrer with those image requests and reuses loaded image elements across state updates. It preserves legitimate image CDNs and local HTTP media sources; remote artwork is not anonymous.
