# DIY Workshop — AI 3D Design Assistant

A static web app for designing DIY (mainly wood) projects with a local AI. Describe what you want to build; the AI generates a 3D model rendered with [A-Frame](https://aframe.io), plus a cut list, per-part preparation instructions, step-by-step assembly, and finishing (paint/stain/varnish/grain).

## Features

- **Chat-driven design** — natural language generation and modification ("split the selected piece in 2 and connect them via hinge"). The AI asks clarifying questions when your request lacks the data it needs.
- **Garden mode (🌱)** — toggle in the top bar. The AI designs gardens instead of furniture: raised beds, planters and trellises built like woodwork (cut list + assembly included), plus the planting plan inside them. The AI chooses companion plants, decides spacing, and generates per-plant care data — click a plant in 3D for sun/water/soil/planting/harvest instructions. Plants render as procedural 3D shapes with name labels (or flat icon billboards — switch in ⚙ Settings). Spacing violations and bad plant neighbors are linted and auto-repaired like geometry problems. A sample vegetable bed (tomatoes + basil, onions guarding the carrots, lettuce in front) loads as the default garden design.
- **Plant catalog** — a built-in bilingual (EN/DE) database of ~60 species: vegetables, herbs, berries, fruit trees (apple, pear, cherry, plum, peach, apricot, quince, fig, walnut, hazel) and ornamental trees/shrubs. The AI designs from it before inventing anything: sizes, spacing, companions and care texts come from the catalog, and care always displays in the current UI language. Browse and edit it via 📦 Stock while in garden mode: add your own species, tweak spacing/companions, edit the care texts in both languages (📝) — changes persist in your browser and feed straight into the AI prompts; a separate "Reset plants" restores the built-ins.
- **AI design translation** — switching EN↔DE regenerates the built-in samples in the new language; for your own designs a one-click "🌐 Translate" action appears in the chat. Only text fields are merged back, so geometry cannot be affected.
- **Blender bridge (optional, off by default)** — enable in ⚙ Settings to connect a local headless Blender. Requires [Blender](https://www.blender.org/download/) 3.6+ (free); start it with `blender --background --python tools/blender_bridge.py` and keep the terminal open. Adds: **📷 Render** (photoreal Cycles image of the current design, incl. plants, into the chat), **STL/GLB export** with cutouts as real boolean holes (STL in mm for 3D printing), and the AI **vision review** judges proper renders instead of WebGL screenshots. When off — or when the bridge is unreachable — the app behaves exactly as before.
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

Reasoning models get a thinking budget: every chat request carries `"reasoning_budget_tokens": 2000` (⚙ Settings → *Reasoning budget*). Change the number there, or clear the field to stop sending the parameter altogether — servers that don't know it normally ignore it, but a strict one may reject the request (the 🐞 debug console says so when it does). The Claude proxy drops the parameter and uses adaptive thinking instead.

While a reasoning model thinks, its thinking tokens arrive in a separate stream field (`reasoning_content`) that is never part of the answer — the chat shows *Thinking (n)* so a long thinking phase is visibly alive, and the 🐞 debug console logs when response headers arrive, when the first byte lands, and every 30 s of silence. If a request fails, the log says whether the endpoint answered at all: nothing at all means the request never arrived (tunnel/VPN, host/port, CORS); headers-then-silence means the connection died mid-stream (proxy idle timeout).

### Demo with Claude (share a link that just works)

To showcase the app powered by Claude — billed to your Anthropic account, with nothing for the visitor to set up — deploy the included proxy, which keeps your API key server-side:

1. Create an API key at [platform.claude.com](https://platform.claude.com), load a small prepaid credit amount and set a **workspace spend limit** (this is the hard cost guard).
2. (Optional) Edit `tools/claude-proxy/wrangler.toml`: set `ALLOWED_ORIGIN` to your GitHub Pages origin (e.g. `"https://you.github.io"`) as an extra guard, and adjust the `MODELS` list that feeds the app's model dropdown (first entry is the default). **No secrets go in this file** — it is safe to commit.
3. Deploy (free Cloudflare account). Both secrets are stored in Cloudflare, never in the repo — `wrangler secret put` prompts you and you paste the value:
   ```bash
   cd tools/claude-proxy
   npx wrangler deploy
   npx wrangler secret put ANTHROPIC_API_KEY     # paste your sk-ant-... key
   npx wrangler secret put DEMO_TOKEN            # a long random string (ASCII recommended)
   ```
   `DEMO_TOKEN` is the unguessable token in the demo URL — you invent it; it is not from Anthropic.
4. Share one link — the URL parameters preseed the settings (use the same token you set above). `&vision=1` turns on the AI visual review (Claude reads the rendered images well, and the same model does the critique via the proxy):
   ```
   https://<you>.github.io/<repo>/?endpoint=https://diyw-claude-proxy.<account>.workers.dev/t/<DEMO_TOKEN>&model=claude-opus-5&lang=en&vision=1
   ```

Both sides are HTTPS, so the mixed-content workaround below is not needed for the demo. **Switching models** (e.g. Sonnet vs Opus): ⚙ Settings → Model lists everything from `MODELS`, or hand out links with different `&model=` values. The proxy streams, translates the app's OpenAI-style requests to the Anthropic Messages API, **enables adaptive thinking** on Opus/Sonnet (this is what makes Claude reason about the geometry before answering — without it the model runs in a weak no-thinking mode that's no better than a local model), caches the system prompt (≈90% cheaper repeat turns), strips parameters Claude rejects, and forwards the vision-review images so the visual critique runs on Claude too. Reasoning depth is the `EFFORT` var in `wrangler.toml` (`high` default; `xhigh` for the hardest designs, slower/costlier). After the demo, delete the worker (`npx wrangler delete`) or rotate the key, and the link goes dead.

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
- `js/schema.js` — design JSON schema (parts + plants), validation, cut-list grouping, garden lints, sample bed
- `js/plantdb.js` — bilingual plant catalog (species data + care texts, EN/DE) the AI designs from
- `js/blender.js` — client for the optional local Blender bridge
- `tools/blender_bridge.py` — headless Blender HTTP service (renders, STL/GLB with boolean cutouts)
- `js/garden.js` — gardening module: sample vegetable garden, species labels, care resolution
- `js/viewer.js` — A-Frame viewer: orbit camera, picking, explode, prep & assembly modes
- `js/llm.js` — OpenAI-compatible streaming client + robust JSON extraction (handles `<think>` blocks)
- `js/prompts.js` — system prompt & message building (design / clarify / chat protocol)
- `js/materials.js` — procedural wood grain textures, stain presets
- `js/storage.js` — IndexedDB library, export/import
- `js/app.js` — UI wiring
