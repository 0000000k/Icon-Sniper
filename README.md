# Icon Sniper

**Copy SVG icons from websites and paste them into Figma.**

Icon Sniper is a lightweight Chrome extension that inspects the page's DOM and copies the **original SVG source** instead of converting a screenshot into vector shapes. It's designed for designers who need editable icons, not raster approximations.

> **Status:** v0.3.0 — experimental. SVG extraction can vary by website and paste behavior can vary by Figma/browser version. Not published in the Chrome Web Store.

## Features

- Click-to-select picker with an on-page outline and source label.
- Detects inline `<svg>` elements, including SVG nested in accessible shadow roots.
- Resolves many `<use>` / `<symbol>` references and SVG sprites.
- Supports some external SVG assets in `<img>`, CSS `mask-image`, and `background-image` (when the browser permits reading the source).
- Attempts to preserve computed fills, strokes, and other styling as SVG attributes/styles.
- Copies SVG markup to the clipboard. Does **not** fall back to screenshots, PNG, or bitmap tracing.
- No accounts, server, analytics, or external service required.

## Install locally

1. Download/clone this repository.
2. Open `chrome://extensions` in Google Chrome.
3. Enable **Developer mode**.
4. Click **Load unpacked** and select the repository folder (the one containing `manifest.json`).
5. Pin **Icon Sniper** in the Chrome toolbar if desired.

## Usage

1. Open a website with SVG icons.
2. Click the Icon Sniper toolbar button to enter selection mode.
3. Move over an icon to highlight its SVG element.
4. Click the icon to copy the SVG.
5. Switch to Figma and try `Cmd + V` (macOS) / `Ctrl + V` (Windows).
6. Press `Esc` to exit selection mode without copying.

A small test page is included at [`demo/index.html`](demo/index.html) to exercise inline SVG, `<use>` sprites, and CSS masks.

## How extraction works

```text
Click on page
      ↓
Inspect click target + nearby DOM / open Shadow DOM
      ↓
Find source: inline SVG → <use> / <symbol> → SVG asset / CSS mask
      ↓
Resolve accessible SVG definitions and computed styles
      ↓
Serialize SVG → clipboard → paste in Figma
```

The code lives in:

| File | Role |
| --- | --- |
| `manifest.json` | Chrome Manifest V3 permissions, extension metadata |
| `background.js` | Injects the picker into the active tab |
| `content.js` | DOM inspection, SVG extraction, selection UI and clipboard |
| `icons/` | Extension icons |
| `demo/index.html` | Local examples for manual testing |

## Limitations

- Canvas-rendered icons, PNGs, icon fonts, and CSS-drawn shapes do not have extractable original SVG paths.
- Cross-origin resources and cross-origin iframes may be inaccessible because of browser security restrictions.
- Complex masks, filters, transforms, gradients, and external stylesheets can produce visual differences after extraction.
- Pasting an SVG from the clipboard into Figma is dependent on clipboard format support; **end-to-end Figma compatibility has not yet been verified** for every platform.
- This project is a prototype, not a universal reverse-engineering tool. Use icons in accordance with the source site's license.

## Permissions & privacy

`activeTab`, `scripting`, `clipboardWrite`. These enable injection on the page you choose and clipboard writing. No telemetry, remote API, or server is used by this extension. All extraction happens in the browser.

## Development

This project uses plain JavaScript; no build or dependency installation required. Edit `content.js`, then reload the unpacked extension from `chrome://extensions` and refresh your test tab.

Icon Sniper is an independent experimental project and is not affiliated with Google or Figma.