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
| **AI endpoint** | `http://127.0.0.1:8111/v1` | The bridge's OpenAI base URL — but see step 4: from another device this must be the tailnet address, not loopback. |
| **Model** | *Auto*, or e.g. `gpt-5.6-sol` | Auto reads `/models` from the bridge. |
| **Reasoning budget** | *clear the field* | `reasoning_budget_tokens` is a llama.cpp knob. Use `--reasoning-effort` on the bridge instead; a strict server rejects the parameter outright. |
| **Temperature** | *clear the field* | GPT-5-class reasoning models reject a non-default temperature. Empty = don't send it. |
| **Strict JSON** | `Auto` | Tries `response_format`, remembers and falls back if the bridge rejects it. |

Leave *Two-stage design* and *Auto-fix geometry* on — they are plain extra
round-trips and work unchanged.

### 4. Choose where the app is served from

All three paths need CORS (see below). They differ only in whether the browser
also blocks the call as **mixed content** — an HTTPS page may not call a plain
HTTP endpoint, and that is browser policy with no server-side fix. Keeping both
sides HTTP avoids it entirely.

#### Path A — same machine

```bash
python -m http.server 8000      # repo root, NOT port 8111
```

Open `http://localhost:8000`; endpoint stays `http://127.0.0.1:8111/v1`. Start
here — fewest moving parts, and the baseline for ruling out the transport when
something else fails.

#### Path B — another device on the tailnet (recommended)

Phone or laptop opening the app served from the machine that runs the bridge.
Both sides stay HTTP, so there is no mixed content and no certificate to issue;
tailnet traffic is WireGuard-encrypted at the network layer already.

Bind **both** servers to all interfaces — loopback-only defaults are reachable
from that machine and nowhere else:

```bash
python -m http.server 8000 --bind 0.0.0.0
chatmock serve --port 8111 --host 0.0.0.0 --reasoning-effort high
```

> Check `chatmock serve --help` for the exact host flag; the spelling varies
> between bridges.

Then on the other device open `http://<host>.<tailnet>.ts.net:8000`, and set the
endpoint to `http://<host>.<tailnet>.ts.net:8111/v1`. **Not `127.0.0.1`** —
settings live in the viewing device's `localStorage`, where loopback means that
device itself, not the machine running the bridge.

#### Path C — app on GitHub Pages

Needs the bridge on HTTPS: a Pages site cannot call `http://127.0.0.1` at all
(mixed content, plus Chrome wants a [Private Network Access][pna] preflight the
bridge does not answer). `tailscale cert` + `tailscale serve --bg 8111` gets an
`https://…ts.net` URL that works. Path B is simpler for testing; this one is
only worth it to demo from the deployed site.

> **The bridge has no authentication.** Anything that can reach it spends your
> ChatGPT quota, with no key required. A tailnet is your own devices, which is
> what makes Path B reasonable. Do **not** publish it through a public tunnel
> (Cloudflare Quick Tunnel, ngrok, `tailscale funnel`) — on a Business plan that
> is an open, unauthenticated proxy to your company's subscription. For a
> shareable endpoint use an API key behind the
> [`../claude-proxy`](../claude-proxy) pattern, which has a token and a daily cap.

#### CORS applies to all three

The page and the bridge are always different origins — the port alone is enough,
so `localhost:8000` → `127.0.0.1:8111` counts even on one machine. The bridge
must return permissive CORS headers; `llama-server` does by default, and whether
ChatMock does is untested here. A CORS failure looks like a request that was
never answered in the 🐞 console, and the browser console names it outright.

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
