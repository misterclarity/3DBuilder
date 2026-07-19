/* blender.js — client for the optional local Blender bridge (tools/blender_bridge.py).
 * Off by default: every function is only called when settings.blenderBridge is on,
 * and callers must fall back gracefully when the bridge is unreachable.
 * Exposes window.Blender.
 */
(function () {
  'use strict';

  function enabled() {
    return !!(window.LLM && LLM.settings().blenderBridge);
  }

  function base() {
    var url = (window.LLM && LLM.settings().blenderURL) || 'http://127.0.0.1:8800';
    return url.replace(/\/+$/, '');
  }

  function health() {
    return fetch(base() + '/health').then(function (r) {
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    });
  }

  function post(path, payload) {
    return fetch(base() + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
  }

  /* Photoreal render(s). opts: {width, height, views:[[azDeg, elevDeg],...], samples, engine}.
   * Resolves to an array of PNG data URLs. */
  function render(design, opts) {
    var payload = opts || {};
    payload.design = design;
    return post('/render', payload).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ': ' + t.slice(0, 200)); });
      return r.json();
    }).then(function (j) {
      if (!j.images || !j.images.length) throw new Error('bridge returned no images');
      if (window.Debug) Debug.log('ok', 'blender', j.images.length + ' render(s) in ' + j.seconds + 's');
      return j.images;
    });
  }

  // Same three angles the WebGL vision capture uses (iso front-left, iso back-right, low front).
  function renderViews(design, width) {
    return render(design, {
      width: width || 512, height: Math.round((width || 512) * 0.75),
      views: [[45, 30], [-135, 30], [0, 6]], samples: 24
    });
  }

  // Download an /stl or /glb export (cutouts applied as real booleans).
  function download(kind, design, name) {
    return post('/' + kind, { design: design }).then(function (r) {
      if (!r.ok) return r.text().then(function (t) { throw new Error('HTTP ' + r.status + ': ' + t.slice(0, 200)); });
      return r.blob();
    }).then(function (blob) {
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = (name || 'design').replace(/[^\w\-]+/g, '_') + '.' + kind;
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
    });
  }

  window.Blender = {
    enabled: enabled,
    health: health,
    render: render,
    renderViews: renderViews,
    download: download
  };
})();
