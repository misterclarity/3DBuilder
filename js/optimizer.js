/* optimizer.js — board/sheet cutting optimization with SVG diagrams and waste %.
 * Sheets (plywood/MDF/panels): 2D shelf nesting on 2500×1250 mm stock.
 * Dimensional lumber: 1D first-fit-decreasing into standard lengths.
 * Exposes window.Optimizer: plan(design), renderHTML(plan, t).
 */
(function () {
  'use strict';

  var KERF = 4;                       // saw blade width, mm
  var SHEET_W = 2500, SHEET_H = 1250; // standard sheet, mm
  var STD_LENGTHS = [1000, 1500, 2000, 2500, 3000, 4000];

  function isSheetPart(p, dims) {
    var txt = (p.stock || '') + ' ' + (p.material.species || '');
    if (/ply|mdf|osb|panel|platte|sperrholz|leimholz/i.test(txt)) return true;
    return dims[2] <= 25 && dims[1] >= 160; // thin and wide → panel
  }

  /* Build a cutting plan from a design. Returns:
   * { sheetGroups: [{key, thickness, sheets:[{items:[{x,y,w,h,name}], usedPct}]}],
   *   boardGroups: [{key, boards:[{len, items:[{x,len,name}], wastePct}]}],
   *   oversize: [names] } */
  function plan(design) {
    var sheetGroups = {}, boardGroups = {}, oversize = [];

    (design.parts || []).forEach(function (p) {
      if ((p.material && p.material.species) === 'soil') return; // bought loose, not cut
      if (p.shape === 'cylinder') {
        var key = 'Ø' + Math.round(p.dimensions.radius * 2) + ' mm ' + (p.stock || p.material.species);
        (boardGroups[key] = boardGroups[key] || []).push({ len: p.dimensions.height, name: p.name });
        return;
      }
      var dims = [p.dimensions.x, p.dimensions.y, p.dimensions.z].sort(function (a, b) { return b - a; });
      if (isSheetPart(p, dims)) {
        var k = dims[2] + ' mm — ' + (p.stock || p.material.species);
        var it = { w: dims[0], h: dims[1], name: p.name };
        if (it.w > SHEET_W || it.h > SHEET_H) { oversize.push(p.name); return; }
        (sheetGroups[k] = sheetGroups[k] || []).push(it);
      } else {
        var k2 = Math.round(dims[1]) + '×' + Math.round(dims[2]) + ' mm — ' + (p.stock || p.material.species);
        if (dims[0] > STD_LENGTHS[STD_LENGTHS.length - 1]) { oversize.push(p.name); return; }
        (boardGroups[k2] = boardGroups[k2] || []).push({ len: dims[0], name: p.name });
      }
    });

    var out = { sheetGroups: [], boardGroups: [], oversize: oversize };

    Object.keys(sheetGroups).forEach(function (key) {
      out.sheetGroups.push({ key: key, sheets: pack2D(sheetGroups[key]) });
    });
    Object.keys(boardGroups).forEach(function (key) {
      out.boardGroups.push({ key: key, boards: pack1D(boardGroups[key]) });
    });
    return out;
  }

  // ---- 1D packing: first-fit-decreasing into the largest standard length, then shrink each board ----
  function pack1D(items) {
    items = items.slice().sort(function (a, b) { return b.len - a.len; });
    var cap = STD_LENGTHS[STD_LENGTHS.length - 1];
    var boards = [];
    items.forEach(function (it) {
      var b = null;
      for (var i = 0; i < boards.length; i++) {
        var need = boards[i].used + KERF + it.len;
        if (need <= cap) { b = boards[i]; break; }
      }
      if (!b) { b = { used: 0, items: [] }; boards.push(b); }
      if (b.items.length) b.used += KERF;
      it = { len: it.len, name: it.name, x: b.used };
      b.items.push(it);
      b.used += it.len;
    });
    boards.forEach(function (b) {
      b.len = STD_LENGTHS.filter(function (L) { return L >= b.used; })[0] || cap;
      b.wastePct = Math.max(0, Math.round(100 * (1 - b.used / b.len)));
    });
    return boards;
  }

  // ---- 2D shelf nesting on standard sheets ----
  function pack2D(items) {
    // normalize orientation: w >= h
    items = items.map(function (it) {
      return it.w >= it.h ? { w: it.w, h: it.h, name: it.name } : { w: it.h, h: it.w, name: it.name };
    }).sort(function (a, b) { return b.h - a.h; });

    var sheets = [];
    items.forEach(function (it) {
      var placed = false;
      for (var s = 0; s < sheets.length && !placed; s++) {
        var sh = sheets[s];
        for (var i = 0; i < sh.shelves.length && !placed; i++) {
          var shelf = sh.shelves[i];
          var x = shelf.x + (shelf.items.length ? KERF : 0);
          if (it.h <= shelf.h && x + it.w <= SHEET_W) {
            it.x = x; it.y = shelf.y;
            shelf.items.push(it); sh.items.push(it);
            shelf.x = x + it.w;
            placed = true;
          }
        }
        if (!placed) {
          var y = sh.yCur + (sh.shelves.length ? KERF : 0);
          if (y + it.h <= SHEET_H) {
            var nshelf = { y: y, h: it.h, x: it.w, items: [it] };
            it.x = 0; it.y = y;
            sh.shelves.push(nshelf); sh.items.push(it);
            sh.yCur = y + it.h;
            placed = true;
          }
        }
      }
      if (!placed) {
        var ns = { shelves: [{ y: 0, h: it.h, x: it.w, items: [it] }], items: [it], yCur: it.h };
        it.x = 0; it.y = 0;
        sheets.push(ns);
      }
    });
    sheets.forEach(function (sh) {
      var used = sh.items.reduce(function (a, it) { return a + it.w * it.h; }, 0);
      sh.usedPct = Math.round(100 * used / (SHEET_W * SHEET_H));
    });
    return sheets;
  }

  // ---- HTML/SVG rendering ----
  function escS(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function short(n) { return n.length > 16 ? n.slice(0, 15) + '…' : n; }

  function renderHTML(p, t) {
    var h = '<h4 style="margin:14px 0 4px">' + t('opt.title') + ' <small style="color:#90a0aa">(' + t('opt.kerf') + ')</small></h4>';
    if (!p.sheetGroups.length && !p.boardGroups.length) return h + '<i>—</i>';

    p.boardGroups.forEach(function (g) {
      h += '<div class="optGroup"><b>' + escS(g.key) + '</b> — ' + g.boards.length + '× ' + t('opt.board') + '';
      g.boards.forEach(function (b) {
        var scale = 700 / b.len;
        h += '<div class="optRow"><svg viewBox="0 0 ' + (b.len * scale + 60) + ' 26" style="width:100%;max-width:760px;height:26px">';
        h += '<rect x="0" y="2" width="' + (b.len * scale) + '" height="20" fill="#3a3126" stroke="#5d4f3c"/>';
        b.items.forEach(function (it) {
          h += '<rect x="' + (it.x * scale) + '" y="2" width="' + (it.len * scale) + '" height="20" fill="#c49a6c" stroke="#22292e"/>';
          if (it.len * scale > 44) h += '<text x="' + ((it.x + it.len / 2) * scale) + '" y="16" font-size="9" text-anchor="middle" fill="#22292e">' + escS(short(it.name)) + ' ' + Math.round(it.len) + '</text>';
        });
        h += '<text x="' + (b.len * scale + 4) + '" y="16" font-size="10" fill="#90a0aa">' + b.len + ' (' + b.wastePct + '% ' + t('opt.waste') + ')</text></svg></div>';
      });
      h += '</div>';
    });

    p.sheetGroups.forEach(function (g) {
      h += '<div class="optGroup"><b>' + escS(g.key) + '</b> — ' + g.sheets.length + '× ' + t('opt.sheet') + ' ' + SHEET_W + '×' + SHEET_H;
      g.sheets.forEach(function (sh) {
        var scale = 500 / SHEET_W;
        h += '<div class="optRow"><svg viewBox="0 0 ' + (SHEET_W * scale) + ' ' + (SHEET_H * scale + 14) + '" style="width:100%;max-width:520px">';
        h += '<rect x="0" y="0" width="' + (SHEET_W * scale) + '" height="' + (SHEET_H * scale) + '" fill="#3a3126" stroke="#5d4f3c"/>';
        sh.items.forEach(function (it) {
          h += '<rect x="' + (it.x * scale) + '" y="' + (it.y * scale) + '" width="' + (it.w * scale) + '" height="' + (it.h * scale) + '" fill="#d7a97f" stroke="#22292e"/>';
          if (it.w * scale > 50 && it.h * scale > 12) h += '<text x="' + ((it.x + it.w / 2) * scale) + '" y="' + ((it.y + it.h / 2) * scale + 3) + '" font-size="9" text-anchor="middle" fill="#22292e">' + escS(short(it.name)) + ' ' + Math.round(it.w) + '×' + Math.round(it.h) + '</text>';
        });
        h += '<text x="2" y="' + (SHEET_H * scale + 11) + '" font-size="10" fill="#90a0aa">' + sh.usedPct + '% ' + t('opt.used') + '</text></svg></div>';
      });
      h += '</div>';
    });

    if (p.oversize.length) h += '<div style="color:#ffcc80">⚠ ' + t('opt.oversize') + ': ' + p.oversize.map(escS).join(', ') + '</div>';
    return h;
  }

  window.Optimizer = { plan: plan, renderHTML: renderHTML, SHEET_W: SHEET_W, SHEET_H: SHEET_H, KERF: KERF };
})();
