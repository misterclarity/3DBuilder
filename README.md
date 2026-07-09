# DIY Workshop — AI 3D Design Assistant

A static web app for designing DIY (mainly wood) projects with a local AI. Describe what you want to build; the AI generates a 3D model rendered with [A-Frame](https://aframe.io), plus a cut list, per-part preparation instructions, step-by-step assembly, and finishing (paint/stain/varnish/grain).

## Features

- **Chat-driven design** — natural language generation and modification ("split the selected piece in 2 and connect them via hinge"). The AI asks clarifying questions when your request lacks the data it needs.
- **Desktop 3D viewer** — drag to orbit, wheel to zoom, right-drag to pan. Click a part for dimensions, stock, prep operations and connections. Ctrl+click for multi-select. Exploded view slider.
- **Cut & Prep mode** — all parts laid out flat on a virtual workbench with labels, like a cutting diagram.
- **Assembly mode** — step-by-step build: parts appear per step, current parts pulse, joints highlight.
- **Finishing** — per-part colors, stains, varnish shine, wood grain; quick presets or via chat.
- **Library** — designs saved in your browser (IndexedDB) with thumbnails, plus JSON export/import.
- **Cut list** — grouped, printable together with prep and assembly instructions.
- **Board & sheet optimization** — the cut list is nested onto standard stock (sheets 2500×1250, lengths up to 4 m, 4 mm kerf) with visual cutting diagrams and waste percentages.
- **Cost estimate** — editable unit prices per board/sheet/hardware item (saved in the browser) with running total.
- **Measure tool** — 📏 click two points on parts to get the exact distance in mm.
- **Undo/redo** — ↶/↷ or Ctrl+Z/Ctrl+Y across AI revisions, finishes and manual moves; AI modifications show a change summary (added/removed/modified parts).
- **Part nudging** — move selected parts along X/Y/Z in 1–100 mm steps from the part card.
- **OBJ export** — download the model as .obj + .mtl for Blender/CAD (mm units).
- **Assembly animation** — parts of the current step drop into place.
- **EN/DE interface** — with German AI output (part names, instructions, questions) when German is selected.

## AI server

Any OpenAI-compatible endpoint works. Default: `http://100.119.213.123:8080/v1`, model `qwen3.6-27b-mtp` (change in ⚙ Settings). The server must allow CORS (llama.cpp `llama-server` does by default).

### Mixed content (HTTPS site → HTTP LLM)

GitHub Pages is HTTPS; browsers block calls to a plain-HTTP endpoint. Options:

1. **Allow insecure content for this site** — Chrome/Edge: lock icon → Site settings → Insecure content → Allow. Firefox: lock icon → disable protection for this page.
2. **Serve the LLM over HTTPS** — with Tailscale: `tailscale cert` + `tailscale serve --bg 8080`, then set the `https://…ts.net` URL in Settings.
3. **Run the site locally** — `python -m http.server` in this folder, open `http://localhost:8000` (HTTP→HTTP is fine).

## Deploy to GitHub Pages

```bash
git init && git add . && git commit -m "DIY Workshop"
git branch -M main
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin main
```

Then on GitHub: **Settings → Pages → Source: Deploy from a branch → main / (root)**. The site appears at `https://<you>.github.io/<repo>/`.

## Debugging

**Do not open `index.html` via `file://`** — browsers block stylesheets/CORS on file:// pages and the 3D viewport collapses to zero height. Serve it: `python -m http.server 8000` → `http://localhost:8000`. The app shows a red banner if it detects file://.

Built-in debug console: **🐞 button** in the top bar, `Ctrl+Shift+D`, or add `?debug=1` to the URL. It captures all JS errors/warnings, logs app events (scene creation, canvas size, design loads, AI requests), and the **Diagnostics** button dumps environment checks (protocol, A-Frame/THREE versions, WebGL support, viewport size, CSS applied, entity counts). **Copy** puts the full report on the clipboard to paste into a chat or issue. A-Frame's own inspector opens with `Ctrl+Alt+I`.

## Updating A-Frame

⚙ Settings → "A-Frame version" (loads `https://aframe.io/releases/<version>/aframe.min.js`). If a version fails to load, the app falls back to 1.8.0. See [A-Frame releases](https://github.com/aframevr/aframe/releases).

## Files

- `index.html` — layout + A-Frame bootstrap (version from settings)
- `js/schema.js` — design JSON schema, validation, cut-list grouping, sample bed
- `js/viewer.js` — A-Frame viewer: orbit camera, picking, explode, prep & assembly modes
- `js/llm.js` — OpenAI-compatible streaming client + robust JSON extraction (handles `<think>` blocks)
- `js/prompts.js` — system prompt & message building (design / clarify / chat protocol)
- `js/materials.js` — procedural wood grain textures, stain presets
- `js/storage.js` — IndexedDB library, export/import
- `js/app.js` — UI wiring
