/* llm.js — OpenAI-compatible chat client with streaming (SSE). Exposes window.LLM. */
(function () {
  'use strict';

  /* Demo-link bootstrap: ?endpoint=…&model=…&lang=…&vision=1 preseed the settings
   * so a single shared URL works with zero setup (e.g. pointing at the Claude
   * proxy: ?endpoint=https://….workers.dev/t/TOKEN&model=claude-opus-5&vision=1).
   * vision=1 turns on the AI visual review — worthwhile with Claude, which reads
   * the rendered images well; the same model does the critique via the proxy. */
  try {
    var q = new URLSearchParams(location.search);
    if (q.get('endpoint') || q.get('model') || q.get('lang') || q.get('vision') !== null) {
      var boot = {};
      try { boot = JSON.parse(localStorage.getItem('diyw_settings') || '{}'); } catch (e) { boot = {}; }
      if (q.get('endpoint')) boot.endpoint = q.get('endpoint');
      if (q.get('model') !== null) boot.model = q.get('model');
      if (q.get('lang')) boot.language = q.get('lang');
      if (q.get('vision') !== null) boot.visionReview = /^(1|true|on|yes)$/i.test(q.get('vision'));
      localStorage.setItem('diyw_settings', JSON.stringify(boot));
      if (q.get('lang') && window.I18n) I18n.setLang(q.get('lang'));
      if (window.Debug) Debug.log('info', 'llm', 'Settings preseeded from URL parameters');
    }
  } catch (e) { /* very old browser — ignore */ }

  var DEFAULTS = {
    endpoint: 'http://100.119.213.123:8080/v1',
    model: '', // '' = auto: use whatever model the server reports on /models
    temperature: 0.4,
    maxTokens: 16384,
    reasoningBudgetTokens: 2000, // thinking budget sent as reasoning_budget_tokens ('' = omit)
    aframeVersion: '1.8.0',
    language: 'en',
    strictJson: 'auto', // 'auto' | 'on' | 'off' — send response_format json_schema (grammar-constrained output)
    twoPass: true,      // plan first, then generate geometry (new designs)
    autoRepair: true,   // feed geometry lint findings back to the AI automatically
    visionReview: false,  // send renders to a vision model for visual critique
    visionEndpoint: '',   // separate endpoint for the vision model ('' = main endpoint)
    plantStyle: 'primitives', // garden mode: 'primitives' (procedural 3D shapes) | 'billboard' (flat icons)
    blenderBridge: false, // optional local Blender service (photoreal renders, STL/GLB with real cutouts)
    blenderURL: 'http://127.0.0.1:8800'
  };

  function settings() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem('diyw_settings') || '{}'); } catch (e) { s = {}; }
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      // Empty temperature/maxTokens/reasoningBudgetTokens mean "omit from requests,
      // use the server's defaults". Empty model means "auto — resolve from /models".
      if ((k === 'temperature' || k === 'maxTokens' || k === 'reasoningBudgetTokens' || k === 'model') && s[k] === '') { out[k] = ''; return; }
      out[k] = (s[k] !== undefined && s[k] !== '') ? s[k] : DEFAULTS[k];
    });
    return out;
  }

  // Cache the auto-detected model per endpoint for 5 minutes.
  var modelCache = {};
  var reqSeq = 0; // per-request id so concurrent/streamed calls are distinguishable in logs

  // Lightweight logger → the in-app Debug console (🐞). No-ops if Debug is absent.
  function dbg(level, msg) { try { if (window.Debug) window.Debug.log(level, 'llm', msg); } catch (e) {} }

  /* Resolve which model to send for an endpoint: the configured one, or (auto)
   * the first model that endpoint is currently serving. Resolves to '' if
   * unknown — llama.cpp and most single-model servers ignore the field anyway. */
  function resolveModel(endpoint, modelOverride) {
    var s = settings();
    var ep = endpoint || s.endpoint;
    var m = (modelOverride !== undefined && modelOverride !== null) ? modelOverride : (endpoint ? '' : s.model);
    if (m) return Promise.resolve(m);
    var c = modelCache[ep];
    if (c && c.id && (Date.now() - c.at) < 300000) return Promise.resolve(c.id);
    return fetch(ep.replace(/\/+$/, '') + '/models')
      .then(function (r) { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
      .then(function (j) {
        var id = (j.data && j.data[0] && j.data[0].id) || '';
        modelCache[ep] = { id: id, at: Date.now() };
        if (id && window.Debug) Debug.log('info', 'llm', 'Auto-detected model at ' + ep + ': ' + id);
        return id;
      })
      .catch(function () { return ''; });
  }

  function saveSettings(s) {
    localStorage.setItem('diyw_settings', JSON.stringify(s));
  }

  // Endpoints that rejected response_format (auto mode remembers and stops sending it).
  var rfBlocked = {};

  /* Stream a chat completion.
   * messages: [{role, content}] — content may be a string or an OpenAI-style
   * array of {type:'text'|'image_url', ...} parts (vision models).
   * onDelta(textChunk, fullTextSoFar), returns Promise<fullText>.
   * opts.responseSchema: JSON Schema — sent as response_format json_schema when strictJson allows.
   * opts.endpoint / opts.model: override the target server (e.g. vision model).
   * Returns an object {promise, abort} */
  function chat(messages, onDelta, opts) {
    opts = opts || {};
    var s = settings();
    var ep = opts.endpoint || s.endpoint;
    var ctrl = new AbortController();
    var useRF = !!opts.responseSchema && s.strictJson !== 'off' &&
                !(s.strictJson === 'auto' && rfBlocked[ep]);
    var reqId = 'r' + (++reqSeq);
    var payloadChars = 0;
    try { payloadChars = JSON.stringify(messages).length; } catch (e) {}
    var t0 = Date.now();

    function doFetch(model, withRF) {
      var body = { messages: messages, stream: true };
      if (model) body.model = model;
      // Only send sampling params that are explicitly set; otherwise the server defaults apply.
      if (s.temperature !== '' && isFinite(Number(s.temperature))) body.temperature = Number(s.temperature);
      if (s.maxTokens !== '' && isFinite(Number(s.maxTokens))) body.max_tokens = Number(s.maxTokens);
      // Thinking budget for reasoning models (qwen3 & co). Sent on every request;
      // clear the field in ⚙ Settings for servers that reject the parameter.
      if (s.reasoningBudgetTokens !== '' && isFinite(Number(s.reasoningBudgetTokens)))
        body.reasoning_budget_tokens = Number(s.reasoningBudgetTokens);
      if (withRF) body.response_format = { type: 'json_schema', json_schema: { name: 'envelope', schema: opts.responseSchema } };
      dbg('info', reqId + ' → POST ' + ep + '/chat/completions  model=' + (model || 'auto') +
        ' msgs=' + messages.length + ' prompt≈' + payloadChars + 'ch' +
        (body.max_tokens ? ' max_tokens=' + body.max_tokens : '') +
        (body.reasoning_budget_tokens !== undefined ? ' reasoning_budget_tokens=' + body.reasoning_budget_tokens : '') +
        (withRF ? ' response_format=json_schema' : ''));
      return fetch(ep.replace(/\/+$/, '') + '/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: ctrl.signal,
        body: JSON.stringify(body)
      });
    }

    var promise = resolveModel(opts.endpoint, opts.model).then(function (model) {
      return doFetch(model, useRF).then(function (res) {
        if (!res.ok && useRF && s.strictJson === 'auto') {
          // Server likely doesn't support response_format — remember and retry once without.
          rfBlocked[ep] = true;
          dbg('warn', reqId + ' response_format rejected (HTTP ' + res.status + '), retrying without. Strict JSON disabled for this endpoint.');
          return doFetch(model, false);
        }
        return res;
      });
    }).then(function (res) {
      if (!res.ok) {
        // Log the full-ish server body (llama.cpp puts the real cause here, e.g.
        // "the request exceeds the available context size") — UI gets a shorter slice.
        return res.text().then(function (t) {
          dbg('error', reqId + ' ✖ HTTP ' + res.status + ' from server: ' + t.slice(0, 1500) +
            (res.status === 400 && /reasoning_budget_tokens/.test(t)
              ? '  ⚠ This server rejects reasoning_budget_tokens — clear the reasoning budget field in ⚙ Settings.'
              : ''));
          throw new Error('LLM server error ' + res.status + ': ' + t.slice(0, 400));
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = '', full = '', finishReason = '', chunks = 0, badLines = 0;
      function finalize(reason) {
        var trunc = finishReason === 'length';
        dbg(full ? (trunc ? 'warn' : 'info') : 'error',
          reqId + ' ' + (full ? '✓' : '✖') + ' done (' + reason + ', ' + (Date.now() - t0) + 'ms): ' +
          full.length + 'ch, ' + chunks + ' delta chunks' +
          (finishReason ? ', finish_reason=' + finishReason : '') +
          (badLines ? ', ' + badLines + ' unparsable lines' : '') +
          (trunc ? '  ⚠ TRUNCATED — raise the server context (llama-server -c) or lower max_tokens in ⚙ Settings' : '') +
          (full ? '' : '  ⚠ EMPTY response — server sent no content'));
        return full;
      }
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return finalize('stream end');
          buf += decoder.decode(r.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line || line.charAt(0) === ':') continue; // blank line or SSE keep-alive comment
            if (line.indexOf('data:') !== 0) continue;
            var data = line.slice(5).trim();
            if (data === '[DONE]') return finalize('[DONE]');
            var j;
            try { j = JSON.parse(data); }
            catch (e) { badLines++; continue; } // genuinely malformed complete line (buffer holds partials)
            // Some OpenAI-compatible servers stream an error object instead of a delta.
            if (j.error) {
              var em = (j.error && (j.error.message || j.error)) || 'unknown stream error';
              dbg('error', reqId + ' ✖ stream error after ' + full.length + 'ch: ' + em);
              throw new Error('LLM stream error: ' + em);
            }
            var ch = j.choices && j.choices[0];
            if (ch) {
              if (ch.finish_reason) finishReason = ch.finish_reason;
              var delta = ch.delta && ch.delta.content;
              if (delta) { chunks++; full += delta; if (onDelta) onDelta(delta, full); }
            }
          }
          return pump();
        });
      }
      return pump();
    });
    // Side-branch for logging only — the original `promise` is still returned and
    // handled by callers, so this does not swallow the rejection from them.
    promise.catch(function (err) {
      if (err && err.name === 'AbortError') dbg('info', reqId + ' aborted by user');
      else dbg('error', reqId + ' ✖ request failed: ' + (err && err.message || err));
    });
    return { promise: promise, abort: function () { ctrl.abort(); } };
  }

  // Non-streaming quick test.
  function testConnection() {
    var s = settings();
    return fetch(s.endpoint.replace(/\/+$/, '') + '/models', { method: 'GET' })
      .then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.json();
      })
      .then(function (j) {
        var models = (j.data || []).map(function (m) { return m.id; });
        if (models.length) modelCache[s.endpoint] = { id: models[0], at: Date.now() };
        return { ok: true, models: models };
      });
  }

  // List models currently served by the endpoint.
  function listModels() {
    return testConnection().then(function (r) { return r.models; });
  }

  /* Remove <think>...</think> reasoning blocks (qwen3 etc.), including unclosed
   * ones: take everything after the last </think>, drop a never-closed <think>. */
  function stripThink(text) {
    if (!text) return '';
    var t = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    var lastClose = t.lastIndexOf('</think>');
    if (lastClose >= 0) t = t.slice(lastClose + 8);
    var openThink = t.indexOf('<think>');
    if (openThink >= 0) t = t.slice(0, openThink);
    return t.trim();
  }

  /* Extract the JSON envelope from a model response.
   * Handles: <think>...</think> blocks (qwen3), markdown fences, leading prose. */
  function extractJSON(text) {
    var t = stripThink(text);
    if (!t) return null;
    var fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) t = fence[1];
    var start = t.indexOf('{');
    if (start < 0) return null;
    // Find matching closing brace.
    var depth = 0, inStr = false, esc = false;
    for (var i = start; i < t.length; i++) {
      var ch = t[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          var candidate = t.slice(start, i + 1);
          try { return JSON.parse(candidate); }
          catch (e) {
            try { return JSON.parse(repair(candidate)); }
            catch (e2) { return null; }
          }
        }
      }
    }
    // Truncated JSON — attempt repair by closing open structures.
    try { return JSON.parse(repair(t.slice(start))); } catch (e) { return null; }
  }

  function repair(s) {
    // Remove trailing commas.
    s = s.replace(/,\s*([}\]])/g, '$1');
    // Balance braces/brackets for truncated output.
    var stack = [], inStr = false, esc = false;
    for (var i = 0; i < s.length; i++) {
      var ch = s[i];
      if (esc) { esc = false; continue; }
      if (ch === '\\') { esc = true; continue; }
      if (ch === '"') { inStr = !inStr; continue; }
      if (inStr) continue;
      if (ch === '{') stack.push('}');
      else if (ch === '[') stack.push(']');
      else if (ch === '}' || ch === ']') stack.pop();
    }
    if (inStr) s += '"';
    while (stack.length) s += stack.pop();
    return s;
  }

  window.LLM = {
    DEFAULTS: DEFAULTS,
    settings: settings,
    saveSettings: saveSettings,
    chat: chat,
    resolveModel: resolveModel,
    listModels: listModels,
    testConnection: testConnection,
    extractJSON: extractJSON,
    stripThink: stripThink
  };
})();
