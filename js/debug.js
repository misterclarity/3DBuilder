/* debug.js — in-app debug console. Load FIRST so it captures everything.
 * Self-contained with inline styles (works even when style.css fails to load).
 * Open with the 🐞 button, ?debug=1, or Ctrl+Shift+D. Exposes window.Debug.
 */
(function () {
  'use strict';

  var entries = [];
  var MAX = 400;
  var panel = null, listEl = null, badge = null;
  var COLORS = { error: '#ef9a9a', warn: '#ffcc80', info: '#90caf9', ok: '#a5d6a7' };

  function ts() {
    var d = new Date();
    return ('0' + d.getHours()).slice(-2) + ':' + ('0' + d.getMinutes()).slice(-2) + ':' + ('0' + d.getSeconds()).slice(-2);
  }

  function log(level, source, msg) {
    var e = { t: ts(), level: level, source: source, msg: String(msg) };
    entries.push(e);
    if (entries.length > MAX) entries.shift();
    if (panel && !panel.hidden) render();
    if ((level === 'error' || level === 'warn') && badge) badge.style.display = 'inline-block';
  }

  // ---- capture global errors ----
  window.addEventListener('error', function (ev) {
    log('error', 'window', (ev.message || ev.type) + (ev.filename ? ' @ ' + ev.filename.split('/').pop() + ':' + ev.lineno : ''));
  }, true);
  window.addEventListener('unhandledrejection', function (ev) {
    log('error', 'promise', (ev.reason && (ev.reason.message || ev.reason)) || 'unhandled rejection');
  });
  ['error', 'warn'].forEach(function (m) {
    var orig = console[m].bind(console);
    console[m] = function () {
      try { log(m === 'warn' ? 'warn' : 'error', 'console', Array.prototype.map.call(arguments, String).join(' ')); } catch (e) {}
      orig.apply(null, arguments);
    };
  });

  // ---- environment diagnostics ----
  function envInfo() {
    var lines = [];
    lines.push('URL: ' + location.href);
    lines.push('Protocol: ' + location.protocol + (location.protocol === 'file:' ? '  ⚠ file:// breaks CSS/CORS — serve over HTTP!' : ''));
    lines.push('UA: ' + navigator.userAgent);
    lines.push('A-Frame: ' + (window.AFRAME ? AFRAME.version : 'NOT LOADED ⚠'));
    lines.push('THREE: ' + (window.THREE ? 'r' + THREE.REVISION : 'not loaded'));
    try {
      var c = document.createElement('canvas');
      var gl = c.getContext('webgl2') || c.getContext('webgl');
      lines.push('WebGL: ' + (gl ? gl.getParameter(gl.VERSION) : 'NOT AVAILABLE ⚠'));
    } catch (e) { lines.push('WebGL: check failed: ' + e.message + ' ⚠'); }
    var scene = document.querySelector('a-scene');
    if (scene) {
      var canvas = scene.canvas;
      lines.push('a-scene: present, loaded=' + !!scene.hasLoaded + ', canvas=' + (canvas ? canvas.width + '×' + canvas.height : 'none'));
      var vp = document.getElementById('viewport');
      if (vp) {
        var r = vp.getBoundingClientRect();
        lines.push('#viewport rect: ' + Math.round(r.width) + '×' + Math.round(r.height) + (r.height < 10 ? '  ⚠ zero height — style.css probably did not load' : ''));
      }
      lines.push('entities: ' + scene.querySelectorAll('a-entity').length + ' (clickable parts: ' + scene.querySelectorAll('.pickable').length + ')');
    } else {
      lines.push('a-scene: NOT IN DOM ⚠ (app.js/viewer.js may have failed — check errors above)');
    }
    var cssOk = getComputedStyle(document.body).getPropertyValue('--bg');
    lines.push('style.css applied: ' + (cssOk ? 'yes' : 'NO ⚠'));
    return lines;
  }

  // ---- panel UI (inline styles on purpose) ----
  function ensurePanel() {
    if (panel) return;
    panel = document.createElement('div');
    panel.hidden = true;
    panel.style.cssText = 'position:fixed;right:10px;bottom:10px;width:520px;max-width:95vw;max-height:45vh;z-index:9999;' +
      'background:#10151a;color:#cfd8dc;border:1px solid #445;border-radius:8px;display:flex;flex-direction:column;' +
      'font:11px/1.5 Consolas,Menlo,monospace;box-shadow:0 4px 20px rgba(0,0,0,.5)';
    var bar = document.createElement('div');
    bar.style.cssText = 'display:flex;gap:6px;padding:6px 8px;border-bottom:1px solid #333;align-items:center';
    bar.innerHTML = '<b style="flex:1">🐞 Debug console</b>';
    ['Diagnostics', 'Copy', 'Clear', '✕'].forEach(function (label) {
      var b = document.createElement('button');
      b.textContent = label;
      b.style.cssText = 'background:#263238;color:#cfd8dc;border:1px solid #455;border-radius:4px;padding:2px 8px;cursor:pointer;font:inherit';
      b.onclick = function () {
        if (label === 'Diagnostics') { envInfo().forEach(function (l) { log(l.indexOf('⚠') >= 0 ? 'warn' : 'info', 'env', l); }); render(); }
        else if (label === 'Copy') {
          var txt = envInfo().join('\n') + '\n---\n' + entries.map(function (e) { return e.t + ' [' + e.level + '] ' + e.source + ': ' + e.msg; }).join('\n');
          (navigator.clipboard ? navigator.clipboard.writeText(txt) : Promise.reject()).then(
            function () { log('ok', 'debug', 'Copied diagnostics to clipboard'); render(); },
            function () { window.prompt('Copy diagnostics:', txt); });
        }
        else if (label === 'Clear') { entries = []; render(); }
        else toggle(false);
      };
      bar.appendChild(b);
    });
    listEl = document.createElement('div');
    listEl.style.cssText = 'overflow-y:auto;padding:6px 8px;flex:1;white-space:pre-wrap;word-break:break-word';
    panel.appendChild(bar);
    panel.appendChild(listEl);
    document.body.appendChild(panel);
  }

  function render() {
    if (!listEl) return;
    listEl.innerHTML = entries.map(function (e) {
      return '<div style="color:' + (COLORS[e.level] || '#cfd8dc') + '">' + e.t + ' [' + e.source + '] ' +
        e.msg.replace(/&/g, '&amp;').replace(/</g, '&lt;') + '</div>';
    }).join('');
    listEl.scrollTop = listEl.scrollHeight;
  }

  function toggle(show) {
    ensurePanel();
    panel.hidden = (show === undefined) ? !panel.hidden : !show;
    if (!panel.hidden) {
      if (badge) badge.style.display = 'none';
      envInfo().forEach(function (l) { if (l.indexOf('⚠') >= 0) log('warn', 'env', l); });
      render();
    }
  }

  document.addEventListener('DOMContentLoaded', function () {
    var btn = document.getElementById('btnDebug');
    if (btn) {
      btn.onclick = function () { toggle(); };
      badge = document.createElement('span');
      badge.textContent = '!';
      badge.style.cssText = 'display:none;color:#ef5350;font-weight:bold;margin-left:2px';
      btn.appendChild(badge);
      if (entries.some(function (e) { return e.level === 'error' || e.level === 'warn'; })) badge.style.display = 'inline-block';
    }
    // file:// warning banner (inline styles: must work without CSS)
    if (location.protocol === 'file:') {
      var b = document.createElement('div');
      b.style.cssText = 'background:#7f1d1d;color:#fff;padding:10px 16px;font:14px system-ui;line-height:1.5';
      b.innerHTML = '<b>⚠ You opened this page from a local file (file://).</b> Browsers block stylesheets, ' +
        'textures and API calls on file:// pages, so the app cannot work this way. Start a local server in this folder ' +
        'and open it over HTTP instead:<br><code style="background:#450a0a;padding:1px 6px;border-radius:4px">python -m http.server 8000</code> ' +
        '→ then open <code style="background:#450a0a;padding:1px 6px;border-radius:4px">http://localhost:8000</code>';
      document.body.prepend(b);
      log('error', 'env', 'Page loaded via file:// — CSS/CORS blocked. Serve over HTTP.');
    }
    // detect CSS failure even over http
    setTimeout(function () {
      if (!getComputedStyle(document.body).getPropertyValue('--bg')) {
        log('error', 'env', 'style.css did not load/apply — layout will be broken and the 3D viewport may have zero height.');
        if (badge) badge.style.display = 'inline-block';
      }
    }, 1500);
    if (/[?&]debug=1/.test(location.search)) toggle(true);
  });

  window.addEventListener('keydown', function (e) {
    if (e.ctrlKey && e.shiftKey && (e.key === 'D' || e.key === 'd')) { e.preventDefault(); toggle(); }
  });

  log('info', 'debug', 'Debug console armed (🐞 button, Ctrl+Shift+D, or ?debug=1)');

  window.Debug = { log: log, toggle: toggle, envInfo: envInfo };
})();
