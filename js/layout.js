/* layout.js — resizable panels + collapsible chat.
 * Adds a vertical splitter between the chat panel and the viewer (with a
 * collapse button) and a horizontal splitter between the viewer and the
 * bottom tabs. Sizes persist in localStorage. Fires window `resize` while
 * dragging so the A-Frame canvas follows.
 */
(function () {
  'use strict';

  var LS = { chatW: 'diy.layout.chatW', tabsH: 'diy.layout.tabsH', chatCol: 'diy.layout.chatCollapsed' };

  function fireResize() { window.dispatchEvent(new Event('resize')); }

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
    if (!layout || !chat || !right || !tabs) return;

    // restore saved sizes
    var w = parseInt(localStorage.getItem(LS.chatW), 10);
    if (w) chat.style.width = Math.min(w, window.innerWidth * 0.7) + 'px';
    var h = parseInt(localStorage.getItem(LS.tabsH), 10);
    if (h) tabs.style.height = Math.min(h, window.innerHeight * 0.7) + 'px';

    // --- vertical splitter: chat | viewer, with collapse button ---
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
      colBtn.textContent = c ? '▶' : '◀';
      try { localStorage.setItem(LS.chatCol, c ? '1' : ''); } catch (e) {}
      fireResize();
    }
    colBtn.addEventListener('click', function () { setCollapsed(!collapsed()); });
    setCollapsed(localStorage.getItem(LS.chatCol) === '1');

    drag(vSplit, function (e) {
      if (collapsed()) return;
      var left = layout.getBoundingClientRect().left;
      var width = Math.max(200, Math.min(e.clientX - left, window.innerWidth * 0.7));
      chat.style.width = width + 'px';
    }, function () {
      try { localStorage.setItem(LS.chatW, parseInt(chat.style.width, 10) || ''); } catch (e) {}
    });

    // --- horizontal splitter: viewer / bottom tabs ---
    var hSplit = document.createElement('div');
    hSplit.id = 'hSplit';
    hSplit.title = 'Drag to resize panel';
    right.insertBefore(hSplit, tabs);

    drag(hSplit, function (e) {
      var r = right.getBoundingClientRect();
      var height = Math.max(60, Math.min(r.bottom - e.clientY, r.height - 140));
      tabs.style.height = height + 'px';
    }, function () {
      try { localStorage.setItem(LS.tabsH, parseInt(tabs.style.height, 10) || ''); } catch (e) {}
    });

    if (window.Debug) Debug.log('ok', 'layout', 'Splitters ready (drag to resize, ◀ collapses chat)');
  });
})();
