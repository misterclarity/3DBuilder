# Codex bridge — drive the app from a ChatGPT subscription

Run the designer on GPT models billed to a **ChatGPT Business/Plus/Pro seat**
instead of an API key, by pointing it at a local OpenAI-compatible server that
reuses the Codex sign-in.

**No application code is involved.** `js/llm.js` already speaks the OpenAI wire
format and sends no `Authorization` header, so this is entirely a matter of
running a local server and changing one field in ⚙ Settings. Nothing in this
folder is imported by the app — it is documentation only.

## Read this first

A ChatGPT subscription does **not** include API access; OpenAI bills the API
platform separately ([billing FAQ][billing]). What a Business seat *does*
include is **Codex**, and Codex CLI authenticates with
[Sign in with ChatGPT][codex-signin], storing OAuth tokens in `~/.codex`.

The bridges below reuse those tokens to serve an OpenAI-compatible API from
`chatgpt.com/backend-api/codex`. That is **outside the intended use** of the
Codex credential:

- It is not a supported OpenAI interface, and can break without notice whenever
  that backend changes.
- If the account is flagged, the blast radius on a **Business** plan includes
  your colleagues' seats, not just yours.

Weigh that before wiring it to a shared workspace. For a sanctioned setup that
survives, use an API key behind a server-side proxy — the
[`../claude-proxy`](../claude-proxy) worker is the same pattern, pointed at a
different vendor.

## Setup

### 1. Install and sign in

[ChatMock][chatmock] is the best fit here: it auto-discovers models (so the
app's *Auto* model option works), requires no client API key, and defaults to
`think-tags` reasoning output — which `stripThink()` in `js/llm.js` already
strips out of the JSON envelope.

```bash
pipx install chatmock
chatmock login          # opens a browser; add --headless on a remote box
```

### 2. Start the server on a free port

```bash
chatmock serve --port 8111 --reasoning-effort high
```

> **Do not leave it on the default port 8000.** That collides with
> `python -m http.server`, which is how you will serve the app itself in step 4.

### 3. Point the app at it

⚙ Settings:

| Field | Value | Why |
|---|---|---|
| **AI endpoint** | `http://127.0.0.1:8111/v1` | The bridge's OpenAI base URL. |
| **Model** | *Auto*, or e.g. `gpt-5.6-sol` | Auto reads `/models` from the bridge. |
| **Reasoning budget** | *clear the field* | `reasoning_budget_tokens` is a llama.cpp knob. Use `--reasoning-effort` on the bridge instead; a strict server rejects the parameter outright. |
| **Temperature** | *clear the field* | GPT-5-class reasoning models reject a non-default temperature. Empty = don't send it. |
| **Strict JSON** | `Auto` | Tries `response_format`, remembers and falls back if the bridge rejects it. |

Leave *Two-stage design* and *Auto-fix geometry* on — they are plain extra
round-trips and work unchanged.

### 4. Close the HTTPS/HTTP gap

The bridge is plain HTTP. Pick one of the two paths below depending on where
the app itself is served from.

#### Path A — everything local (simplest)

Serve the app over HTTP too, so there is no mixed content at all:

```bash
python -m http.server 8000      # in the repo root, NOT port 8111
```

Then open `http://localhost:8000`. This is the path to start on — it has the
fewest moving parts, and it is the one to use when something does not work,
to rule the transport out.

#### Path B — app on GitHub Pages

**A GitHub Pages site cannot talk to `http://127.0.0.1` directly.** Pages is
HTTPS, so the call is blocked as mixed content; Chrome additionally requires a
[Private Network Access][pna] preflight that the bridge does not answer. Do not
expect the loopback address to work from the deployed site — the bridge has to
be reachable over HTTPS.

With Tailscale (same approach the main README suggests for llama.cpp):

```bash
tailscale cert                        # once, for this machine
tailscale serve --bg 8111             # publish the bridge over HTTPS
```

Put the resulting `https://<host>.<tailnet>.ts.net` URL (plus `/v1`) in
⚙ Settings instead of the loopback address. Both sides are then HTTPS, which
clears the mixed-content block.

One thing left to verify on this path: the call is now **cross-origin**
(`github.io` → `ts.net`), so the bridge must answer with permissive CORS
headers. llama.cpp's `llama-server` does by default; whether ChatMock does is
untested here. If *Test connection* fails on Path B while Path A works, CORS is
the first thing to check — the browser console names it explicitly, and the
🐞 console will show the request as never having been answered.

> **The bridge has no authentication.** Anything that can reach it spends your
> ChatGPT quota, with no key required. On a tailnet that is your own devices,
> which is the point of using Tailscale here. Do **not** publish it through a
> public tunnel (Cloudflare Quick Tunnel, ngrok, `tailscale funnel`) — on a
> Business plan that is an open, unauthenticated proxy to your company's
> subscription. If you need a shareable endpoint, use an API key behind the
> [`../claude-proxy`](../claude-proxy) pattern, which has a token and a daily
> cap, rather than exposing this.

The remaining workarounds in the main
[README](../../README.md#mixed-content-https-site--http-llm) also apply.

## Checking it works

⚙ Settings → **Test connection** should list the bridge's models. If it does
not, the 🐞 debug console tells you which half is at fault: no response headers
at all means the request never reached the bridge (wrong port, or it is not
running); headers followed by an error body means the bridge answered and
rejected the request — read the body for the offending parameter, which is
usually `reasoning_budget_tokens` or `temperature` left set in step 3.

## Reverting

There is nothing to uninstall from the app — put the previous URL back in
⚙ Settings. To drop the credential as well, `chatmock logout` and delete
`~/.codex`.

## Alternatives

Same approach, different implementations, if ChatMock stops working:

- [openai-api-server-via-codex][via-codex] — Go, `uvx openai-api-server-via-codex`,
  defaults to `http://127.0.0.1:18080/v1`. Note it expects a placeholder API key
  from clients; this app sends no header, so use its `--api-key` opt-out.
- [openai-oauth][oauth] — Node, defaults to port 10531, same `~/.codex` tokens.

[billing]: https://help.openai.com/en/articles/8156019-is-api-usage-included-in-chatgpt-subscriptions-even-if-i-have-a-paid-chatgpt-account
[codex-signin]: https://help.openai.com/en/articles/11381614-codex-cli-and-sign-in-with-chatgpt
[chatmock]: https://github.com/RayBytes/ChatMock
[via-codex]: https://github.com/hotchpotch/openai-api-server-via-codex
[oauth]: https://github.com/EvanZhouDev/openai-oauth
[pna]: https://developer.chrome.com/blog/private-network-access-preflight
