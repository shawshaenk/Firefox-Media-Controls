# Media Controls

## Load in Firefox or LibreWolf Flatpak

Build a complete archive with `npm run package` (Node.js and Python 3).

1. Open `about:debugging#/runtime/this-firefox`.
2. Remove the existing temporary **Media Controls** extension.
3. Click **Load Temporary Add-on** and select the newest XPI in `dist/`.

Use the XPI file when loading through a Flatpak file picker. Selecting a loose
`manifest.json` can grant access to that file without exposing its sibling HTML,
CSS, JavaScript, or icons. Reloading the extension does not expand that grant.
The archive includes all runtime files and does not need broader filesystem access.

Temporary add-ons must be loaded again after restarting the browser. This XPI is
for temporary loading through `about:debugging`; it is not Mozilla-signed.

## Development checks

`npm run typecheck`

`node --test tests/background.test.cjs`

`npm run lint`
