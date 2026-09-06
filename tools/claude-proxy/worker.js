/* claude-proxy — Cloudflare Worker that lets the DIY Workshop demo run on Claude
 * without exposing your Anthropic API key to the browser.
 *
 * The app speaks an OpenAI-compatible wire format (POST /chat/completions with
 * SSE streaming, GET /models). This worker translates that to the Anthropic
 * Messages API (raw HTTP per Anthropic's documented wire format — kept
 * dependency-free on purpose so `wrangler deploy` needs no build step).
 *
 * Deploy:
 *   cd tools/claude-proxy
 *   npx wrangler deploy
 *   npx wrangler secret put ANTHROPIC_API_KEY     # paste your sk-ant-... key
 *   npx wrangler secret put DEMO_TOKEN            # the token in the demo URL
 *
 * Then point the app at:  https://<name>.<account>.workers.dev/t/<DEMO_TOKEN>
 * Both secrets live in Cloudflare, never in wrangler.toml — the config file is
 * safe to commit publicly. The other knobs (ALLOWED_ORIGIN, MODELS, …) are vars.
 *
 * Spend safety: the real guard is the spend limit / prepaid credits on your
 * Anthropic Console workspace. DAILY_LIMIT here is a best-effort per-isolate
 * request counter, not a hard guarantee. Delete the worker after the demo.
 */

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// Best-effort per-isolate daily counter (resets on isolate recycle).
let counter = { day: '', n: 0 };

function modelList(env) {
  return String(env.MODELS || 'claude-opus-5,claude-opus-4-8,claude-sonnet-5,claude-haiku-4-5')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

// Models that take adaptive thinking + output_config.effort (Opus 5, Opus 4.6+,
// Sonnet 4.6/5, Fable/Mythos 5). Haiku 4.5 and older reject those params (400),
// so we send them plain. This is THE lever that makes Claude reason before
// answering; without it Opus runs in its weakest no-thinking mode AND gets
// clamped to the low token cap below (truncating complex designs mid-JSON).
export function supportsAdaptive(model) {
  return /opus-5|opus-4-[678]|sonnet-(5|4-6)|fable-5|mythos-5/.test(String(model));
}

function corsHeaders(env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Max-Age': '86400'
  };
}

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status: status,
    headers: Object.assign({ 'Content-Type': 'application/json' }, cors)
  });
}

/* ---------- OpenAI wire -> Anthropic Messages ---------- */

// One OpenAI content entry (string or part array) -> Anthropic content blocks.
export function toBlocks(content) {
  if (typeof content === 'string') return [{ type: 'text', text: content }];
  const blocks = [];
  for (const part of Array.isArray(content) ? content : []) {
    if (!part) continue;
    if (part.type === 'text' && part.text) {
      blocks.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_url' && part.image_url && part.image_url.url) {
      const m = /^data:(image\/[a-z+.-]+);base64,(.+)$/i.exec(part.image_url.url);
      if (m) blocks.push({ type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } });
      else blocks.push({ type: 'image', source: { type: 'url', url: part.image_url.url } });
    }
  }
  return blocks.length ? blocks : [{ type: 'text', text: ' ' }];
}

export function toAnthropicRequest(body, env) {
  const models = modelList(env);
  const model = models.indexOf(body.model) >= 0 ? body.model : models[0];

  const systemParts = [];
  const messages = [];
  for (const msg of Array.isArray(body.messages) ? body.messages : []) {
    if (!msg) continue;
    if (msg.role === 'system') {
      systemParts.push(typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content));
      continue;
    }
    messages.push({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: toBlocks(msg.content)
    });
  }
  if (!messages.length || messages[0].role !== 'user') {
    messages.unshift({ role: 'user', content: [{ type: 'text', text: '(continue)' }] });
  }

  const adaptive = supportsAdaptive(model);
  // max_tokens is the budget for thinking AND the JSON output combined. With
  // thinking on, complex designs truncate if the ceiling is too low. Give
  // adaptive models (Opus/Sonnet, 128K output) generous room — this is only a
  // ceiling; the model stops at end_turn when the design is done, so normal
  // designs cost/take no more. Haiku 4.5 maxes at 64K output, so clamp it.
  const cap = adaptive ? (Number(env.MAX_TOKENS_CAP) || 128000) : 60000;
  const floor = adaptive ? 64000 : 16384;
  const req = {
    model: model,
    max_tokens: Math.min(cap, Math.max(Number(body.max_tokens) || 16384, floor)),
    messages: messages,
    stream: body.stream !== false
  };
  if (adaptive) {
    // Adaptive thinking is the whole reason to use Claude here: it reasons about
    // the geometry/joinery before emitting JSON. effort (low|medium|high|xhigh|
    // max) tunes how deep — "high" is a strong default; raise to "xhigh" for the
    // hardest designs (slower/costlier). Thinking text is not forwarded to the
    // app (display defaults to omitted), only the improved final answer.
    req.thinking = { type: 'adaptive' };
    req.output_config = { effort: (env.EFFORT || 'high').trim() };
  }
  if (systemParts.length) {
    // cache_control: the app resends its large system prompt every turn —
    // caching it cuts repeated-prompt cost by ~90% during a demo session.
    req.system = [{ type: 'text', text: systemParts.join('\n\n'), cache_control: { type: 'ephemeral' } }];
  }
  // Deliberately dropped: temperature/top_p/top_k (rejected by Opus 4.8 /
  // Sonnet 5), response_format (llama.cpp grammar feature; Claude's JSON
  // discipline + the app's extraction/repair path handle it), and
  // reasoning_budget_tokens (a local-server knob; adaptive thinking above is
  // Claude's equivalent, and fixed thinking budgets are rejected outright).
  return req;
}

/* ---------- Anthropic SSE -> OpenAI-style SSE ---------- */

export function translateSSE() {
  let buf = '';
  const dec = new TextDecoder();
  const enc = new TextEncoder();
  function chunk(text) {
    return 'data: ' + JSON.stringify({
      object: 'chat.completion.chunk',
      choices: [{ index: 0, delta: { content: text } }]
    }) + '\n\n';
  }
  return new TransformStream({
    transform(part, controller) {
      buf += dec.decode(part, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop();
      for (const line of lines) {
        const s = line.trim();
        if (!s.startsWith('data:')) continue;
        let j;
        try { j = JSON.parse(s.slice(5).trim()); } catch (e) { continue; }
        if (j.type === 'content_block_delta' && j.delta && j.delta.type === 'text_delta') {
          controller.enqueue(enc.encode(chunk(j.delta.text)));
        } else if (j.type === 'message_stop') {
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
        } else if (j.type === 'error') {
          const msg = (j.error && j.error.message) || 'upstream error';
          controller.enqueue(enc.encode(chunk('\n[Claude proxy error: ' + msg + ']')));
          controller.enqueue(enc.encode('data: [DONE]\n\n'));
        }
        // thinking_delta and other event types are intentionally not forwarded.
      }
    }
  });
}

/* ---------- request handling ---------- */

async function handleChat(request, env, cors) {
  const limit = Number(env.DAILY_LIMIT) || 400;
  const today = new Date().toISOString().slice(0, 10);
  if (counter.day !== today) { counter.day = today; counter.n = 0; }
  if (++counter.n > limit) {
    return json({ error: { message: 'Demo daily request limit reached.' } }, 429, cors);
  }

  let body;
  try { body = await request.json(); } catch (e) {
    return json({ error: { message: 'invalid JSON body' } }, 400, cors);
  }
  const req = toAnthropicRequest(body, env);

  const upstream = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': ANTHROPIC_VERSION
    },
    body: JSON.stringify(req)
  });

  if (!upstream.ok) {
    const text = await upstream.text();
    return json({ error: { message: 'Anthropic API ' + upstream.status + ': ' + text.slice(0, 500) } },
      upstream.status, cors);
  }

  if (req.stream) {
    return new Response(upstream.body.pipeThrough(translateSSE()), {
      headers: Object.assign({ 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' }, cors)
    });
  }

  // Non-streaming fallback (the app itself always streams).
  const msg = await upstream.json();
  const text = (msg.content || [])
    .filter(function (b) { return b.type === 'text'; })
    .map(function (b) { return b.text; }).join('');
  return json({
    object: 'chat.completion',
    model: msg.model,
    choices: [{ index: 0, message: { role: 'assistant', content: text }, finish_reason: msg.stop_reason }]
  }, 200, cors);
}

export default {
  async fetch(request, env) {
    const cors = corsHeaders(env);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });

    const origin = request.headers.get('Origin') || '';
    if (env.ALLOWED_ORIGIN && origin && origin !== env.ALLOWED_ORIGIN) {
      return json({ error: { message: 'origin not allowed' } }, 403, cors);
    }

    const url = new URL(request.url);
    const m = /^\/t\/([^/]+)(\/.*)$/.exec(url.pathname);
    // The token segment arrives percent-encoded (browsers encode any non-ASCII
    // or reserved chars) — decode before comparing to the raw DEMO_TOKEN secret.
    let token = null;
    if (m) { try { token = decodeURIComponent(m[1]); } catch (e) { token = m[1]; } }
    if (!m || !env.DEMO_TOKEN || token !== env.DEMO_TOKEN) {
      return json({ error: { message: 'not found' } }, 404, cors);
    }

    if (m[2] === '/models' && request.method === 'GET') {
      return json({
        object: 'list',
        data: modelList(env).map(function (id) { return { id: id, object: 'model' }; })
      }, 200, cors);
    }
    if (m[2] === '/chat/completions' && request.method === 'POST') {
      return handleChat(request, env, cors);
    }
    return json({ error: { message: 'not found' } }, 404, cors);
  }
};
