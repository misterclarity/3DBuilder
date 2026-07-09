/* layout.js — resizable panels + collapsible chat + mobile-aware layout.
 * Desktop: vertical splitter chat|viewer, horizontal splitter viewer/tabs,
 * and a splitter inside the chat panel to resize the input area.
 * Mobile (narrow or coarse-pointer screens): panels stack vertically, the
 * chat splitter becomes a height handle, splitters get touch-friendly sizes,
 * and everything is re-clamped to the available screen space on resize /
 * rotation. Sizes persist in localStorage. Fires window `resize` while
 * dragging so the A-Frame canvas follows.
 */
(function () {
  'use strict';

  var LS = {
    chatW: 'diy.layout.chatW',       // desktop: chat panel width
    chatH: 'diy.layout.chatH',       // mobile: chat panel height
    tabsH: 'diy.layout.tabsH',
    inputH: 'diy.layout.chatInputH', // chat input area height
    chatCol: 'diy.layout.chatCollapsed'
  };

  // Mobile = narrow viewport, or a touch device with a smallish screen.
  var mq = window.matchMedia('(max-width: 820px), (pointer: coarse) and (max-width: 1080px)');
  function isMobile() { return mq.matches; }

  function fireResize() { window.dispatchEvent(new Event('resize')); }
  function clamp(v, min, max) { return Math.max(min, Math.min(v, max)); }
  function lsGet(k) { var v = parseInt(localStorage.getItem(k), 10); return isFinite(v) ? v : 0; }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }

  function drag(el, onMove, onEnd) {
    el.addEventListener('pointerdown', function (e) {
      if (e.target !== el) return; // ignore clicks on the collapse button
      e.preventDefault();
      el.setPointerCapture(e.pointerId);
      document.body.classList.add('resizing');
      function mv(ev) { onMove(ev); fireResize(); }
      function up(ev) {
        el.releasePointerCapture(ev.pointerId);
        el.removeEventListener('pointermove', mv);
        el.removeEventListener('pointerup', up);
        document.body.classList.remove('resizing');
        if (onEnd) onEnd();
        fireResize();
      }
      el.addEventListener('pointermove', mv);
      el.addEventListener('pointerup', up);
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    var layout = document.getElementById('layout');
    var chat = document.getElementById('chatPanel');
    var right = document.getElementById('rightPane');
    var tabs = document.getElementById('tabs');
    var inputRow = document.getElementById('chatInputRow');
    var selChip = document.getElementById('selChip');
    if (!layout || !chat || !right || !tabs) return;

    // --- vertical splitter: chat | viewer (chat / viewer on mobile), with collapse button ---
    var vSplit = document.createElement('div');
    vSplit.id = 'vSplit';
    vSplit.title = 'Drag to resize chat';
    var colBtn = document.createElement('button');
    colBtn.id = 'chatCollapse';
    colBtn.title = 'Collapse / expand chat';
    vSplit.appendChild(colBtn);
    layout.insertBefore(vSplit, right);

    function collapsed() { return chat.classList.contains('collapsed'); }
    function setCollapsed(c) {
      chat.classList.toggle('collapsed', c);
      colBtn.textContent = isMobile() ? (c ? '▼' : '▲') : (c ? '▶' : '◀');
      lsSet(LS.chatCol, c ? '1' : '');
      fireResize();
    }
    colBtn.addEventListener('click', function () { setCollapsed(!collapsed()); });

    drag(vSplit, function (e) {
      if (collapsed()) return;
      var r = layout.getBoundingClientRect();
      if (isMobile()) {
        chat.style.height = clamp(e.clientY - r.top, 120, r.height * 0.75) + 'px';
      } else {
        chat.style.width = clamp(e.clientX - r.left, 200, window.innerWidth * 0.7) + 'px';
      }
    }, function () {
      if (isMobile()) lsSet(LS.chatH, parseInt(chat.style.height, 10) || '');
      else lsSet(LS.chatW, parseInt(chat.style.width, 10) || '');
    });

    // --- splitter inside the chat panel: chat log / input area ---
    var cSplit = document.createElement('div');
    cSplit.id = 'chatSplit';
    cSplit.title = 'Drag to resize input area';
    if (inputRow) {
      chat.insertBefore(cSplit, selChip || inputRow);
      drag(cSplit, function (e) {
        var r = chat.getBoundingClientRect();
        inputRow.style.height = clamp(r.bottom - e.clientY, 70, r.height - 120) + 'px';
      }, function () {
        lsSet(LS.inputH, parseInt(inputRow.style.height, 10) || '');
      });
      var ih = lsGet(LS.inputH);
      if (ih) inputRow.style.height = clamp(ih, 70, window.innerHeight - 160) + 'px';
    }

    // --- horizontal splitter: viewer / bottom tabs ---
    var hSplit = document.createElement('div');
    hSplit.id = 'hSplit';
    hSplit.title = 'Drag to resize panel';
    right.insertBefore(hSplit, tabs);

    drag(hSplit, function (e) {
      var r = right.getBoundingClientRect();
      tabs.style.height = clamp(r.bottom - e.clientY, 60, r.height - 140) + 'px';
    }, function () {
      lsSet(LS.tabsH, parseInt(tabs.style.height, 10) || '');
    });

    // --- mobile / desktop mode + fitting to available screen space ---
    function applyMode() {
      var m = isMobile();
      document.body.classList.toggle('mobile', m);
      if (m) {
        chat.style.width = '';
        var h = lsGet(LS.chatH) || Math.round(window.innerHeight * 0.38);
        chat.style.height = clamp(h, 120, window.innerHeight * 0.7) + 'px';
      } else {
        chat.style.height = '';
        var w = lsGet(LS.chatW) || 360;
        chat.style.width = clamp(w, 200, window.innerWidth * 0.7) + 'px';
      }
      var th = lsGet(LS.tabsH);
      if (th) tabs.style.height = clamp(th, 60, Math.max(160, window.innerHeight - 260)) + 'px';
      setCollapsed(collapsed()); // refresh arrow glyph for orientation
    }

    // Re-clamp panels to the viewport after rotation, keyboard, or window resize.
    function reclamp() {
      if (document.body.classList.contains('mobile') !== isMobile()) { applyMode(); return; }
      if (isMobile()) {
        var h = parseInt(chat.style.height, 10);
        if (h) chat.style.height = clamp(h, 120, window.innerHeight * 0.7) + 'px';
      } else {
        var w = parseInt(chat.style.width, 10);
        if (w) chat.style.width = clamp(w, 200, window.innerWidth * 0.7) + 'px';
      }
      var rh = right.getBoundingClientRect().height;
      var th = parseInt(tabs.style.height, 10);
      if (th && rh > 200) tabs.style.height = clamp(th, 60, rh - 140) + 'px';
      if (inputRow) {
        var ch = chat.getBoundingClientRect().height;
        var ih = parseInt(inputRow.style.height, 10);
        if (ih && ch > 200) inputRow.style.height = clamp(ih, 70, ch - 120) + 'px';
      }
    }
    var rcTimer = null;
    window.addEventListener('resize', function () {
      clearTimeout(rcTimer);
      rcTimer = setTimeout(reclamp, 150);
    });
    if (mq.addEventListener) mq.addEventListener('change', applyMode);
    else if (mq.addListener) mq.addListener(applyMode); // older Safari

    setCollapsed(localStorage.getItem(LS.chatCol) === '1');
    applyMode();

    window.Layout = { isMobile: isMobile };
    if (window.Debug) Debug.log('ok', 'layout', 'Splitters ready (' + (isMobile() ? 'mobile' : 'desktop') + ' mode)');
  });
})();
