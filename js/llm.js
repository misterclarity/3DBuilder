/* llm.js — OpenAI-compatible chat client with streaming (SSE). Exposes window.LLM. */
(function () {
  'use strict';

  var DEFAULTS = {
    endpoint: 'http://100.119.213.123:8080/v1',
    model: 'qwen3.6-27b-mtp',
    temperature: 0.4,
    maxTokens: 16384,
    aframeVersion: '1.8.0',
    language: 'en'
  };

  function settings() {
    var s = {};
    try { s = JSON.parse(localStorage.getItem('diyw_settings') || '{}'); } catch (e) { s = {}; }
    var out = {};
    Object.keys(DEFAULTS).forEach(function (k) {
      // Empty temperature/maxTokens mean "omit from requests, use the server's defaults".
      if ((k === 'temperature' || k === 'maxTokens') && s[k] === '') { out[k] = ''; return; }
      out[k] = (s[k] !== undefined && s[k] !== '') ? s[k] : DEFAULTS[k];
    });
    return out;
  }

  function saveSettings(s) {
    localStorage.setItem('diyw_settings', JSON.stringify(s));
  }

  /* Stream a chat completion.
   * messages: [{role, content}]
   * onDelta(textChunk, fullTextSoFar), returns Promise<fullText>.
   * Returns an object {promise, abort} */
  function chat(messages, onDelta) {
    var s = settings();
    var ctrl = new AbortController();
    var promise = fetch(s.endpoint.replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: ctrl.signal,
      body: JSON.stringify((function () {
        var body = { model: s.model, messages: messages, stream: true };
        // Only send sampling params that are explicitly set; otherwise the server defaults apply.
        if (s.temperature !== '' && isFinite(Number(s.temperature))) body.temperature = Number(s.temperature);
        if (s.maxTokens !== '' && isFinite(Number(s.maxTokens))) body.max_tokens = Number(s.maxTokens);
        return body;
      })())
    }).then(function (res) {
      if (!res.ok) {
        return res.text().then(function (t) {
          throw new Error('LLM server error ' + res.status + ': ' + t.slice(0, 300));
        });
      }
      var reader = res.body.getReader();
      var decoder = new TextDecoder();
      var buf = '', full = '';
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return full;
          buf += decoder.decode(r.value, { stream: true });
          var lines = buf.split('\n');
          buf = lines.pop();
          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line.startsWith('data:')) continue;
            var data = line.slice(5).trim();
            if (data === '[DONE]') return full;
            try {
              var j = JSON.parse(data);
              var delta = j.choices && j.choices[0] && j.choices[0].delta && j.choices[0].delta.content;
              if (delta) { full += delta; if (onDelta) onDelta(delta, full); }
            } catch (e) { /* partial line, ignore */ }
          }
          return pump();
        });
      }
      return pump();
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
        return { ok: true, models: models };
      });
  }

  /* Extract the JSON envelope from a model response.
   * Handles: <think>...</think> blocks (qwen3), markdown fences, leading prose. */
  function extractJSON(text) {
    if (!text) return null;
    var t = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
    // If an unclosed think block remains, take everything after the last </think>,
    // and drop anything inside a never-closed <think> (truncated reasoning, no JSON there).
    var lastClose = t.lastIndexOf('</think>');
    if (lastClose >= 0) t = t.slice(lastClose + 8);
    var openThink = t.indexOf('<think>');
    if (openThink >= 0) t = t.slice(0, openThink);
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
    testConnection: testConnection,
    extractJSON: extractJSON
  };
})();
