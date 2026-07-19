/* inventory.js — editable stock inventory: the standard parts, connectors and
 * cuts the AI designs from before inventing anything custom. Metadata:
 * P = assembly priority (1 = base structure, built first … 5 = trim, last)
 * C = complexity (parts: to make from raw material; cuts/connectors: skill needed).
 * Defaults are built in; user edits persist in localStorage ('diyw_inventory').
 * Also provides stock-conformance matching for the geometry lints and
 * per-part difficulty estimates for the cut list. Exposes window.Inventory.
 */
(function () {
  'use strict';

  var LS_KEY = 'diyw_inventory';

  // name | section | max length mm | material | priority | complexity | typical use
  var DEFAULT_PARTS = [
    ['Construction lumber 45x95mm', '45x95mm', 4000, 'softwood (pine or spruce)', 1, 1, 'frames, bed rails, table aprons, heavy structures'],
    ['Construction lumber 45x70mm', '45x70mm', 4000, 'softwood (pine or spruce)', 1, 1, 'light frames, rails, stretchers'],
    ['Post 70x70mm', '70x70mm', 3000, 'softwood (pine or spruce)', 1, 1, 'table/bench legs, bed posts, uprights'],
    ['Post 90x90mm', '90x90mm', 3000, 'softwood (pine or spruce)', 1, 1, 'heavy posts, workbench legs, pergolas'],
    ['Batten 45x45mm', '45x45mm', 3000, 'softwood (pine or spruce)', 2, 1, 'light frames, cleats, corner blocking'],
    ['Batten 30x30mm', '30x30mm', 2400, 'softwood (pine or spruce)', 3, 1, 'cleats, slat supports, light bracing'],
    ['Lath 20x40mm', '20x40mm', 2400, 'softwood (pine or spruce)', 3, 1, 'cleats, trim, diagonal bracing'],
    ['Board 18x70mm', '18x70mm', 2400, 'softwood (pine or spruce)', 3, 1, 'slats, pickets, light shelves'],
    ['Board 18x120mm', '18x120mm', 2400, 'softwood (pine or spruce)', 2, 1, 'shelves, box sides, seat slats'],
    ['Board 28x140mm', '28x140mm', 4000, 'softwood (pine or spruce)', 2, 1, 'bed and planter sides, bench parts, stair treads'],
    ['Plank 27x200mm', '27x200mm', 4000, 'softwood (spruce)', 2, 1, 'bench tops, wide shelves, rustic tables'],
    ['Frame slat 20x95mm', '20x95mm', 2400, 'softwood (pine or spruce)', 3, 1, 'infill slats, gates, headboards'],
    ['Plywood 18mm', '18mm sheet', 2500, 'plywood (birch or spruce)', 2, 2, 'table tops, cabinet carcasses, shelves (rip + crosscut from sheet)'],
    ['Plywood 12mm', '12mm sheet', 2500, 'plywood (birch or spruce)', 2, 2, 'drawers, boxes, lighter panels'],
    ['Plywood 9mm', '9mm sheet', 2500, 'plywood (birch)', 3, 2, 'curved parts, light boxes'],
    ['MDF board 19mm', '19mm sheet', 2800, 'medium-density fiberboard', 2, 2, 'paint-grade tops and panels (indoor only)'],
    ['Edge-glued panel 18mm', '18mm panel', 2000, 'solid wood panel (spruce or beech)', 2, 1, 'table tops, shelves, cabinet sides (ready-made surface)'],
    ['Hardboard 3mm', '3mm sheet', 2750, 'hardboard (HDF)', 4, 1, 'cabinet backs, drawer bottoms'],
    ['Decking board 28x120mm', '28x120mm, grooved surface', 4000, 'larch or pressure-treated pine', 2, 1, 'outdoor tops, planters, terraces'],
    ['Dowel rod Ø25mm', 'Ø25mm', 1000, 'hardwood (beech)', 3, 1, 'hanging rails, rungs, handles'],
    ['Dowel rod Ø12mm', 'Ø12mm', 1000, 'hardwood (beech)', 3, 1, 'pegs, light rungs'],
    ['Trim / quarter round 15x15mm', '15x15mm', 2400, 'softwood (pine)', 5, 1, 'edges, gap covers, finishing touches']
  ];

  // name | size | complexity | typical use
  var DEFAULT_CONNECTORS = [
    ['Wood screw 4x40mm', '4x40mm, countersunk', 1, 'general face-to-edge fastening in 18-28mm stock (pre-drill near edges)'],
    ['Wood screw 4x60mm', '4x60mm, countersunk', 1, 'fastening into 45mm framing, cleats to rails'],
    ['Wood screw 5x80mm', '5x80mm, countersunk', 1, 'heavy framing connections, legs, thick stock'],
    ['Chipboard screw 3.5x30mm', '3.5x30mm', 1, 'thin panels, cabinet backs, drawer bottoms'],
    ['Pocket-hole screw 4x35mm', '4x35mm, coarse thread', 2, 'hidden angled joints in frames (requires pocket-hole jig)'],
    ['Wood glue (PVA, D3)', '750g bottle', 1, 'almost every permanent joint — combine with screws, dowels or clamps'],
    ['Construction adhesive', 'cartridge', 1, 'panels to frames, uneven surfaces, where clamping is hard'],
    ['Brad nail 1.6x40mm', '1.6x40mm', 1, 'trim, small moldings, holding parts while glue dries'],
    ['Lost-head nail 2.5x55mm', '2.5x55mm', 1, 'light structural fixing, cleats, fence slats'],
    ['Hardwood dowel Ø8x40mm', 'Ø8x40mm, fluted', 2, 'aligned glue joints in panels and frames (requires dowel jig)'],
    ['Carriage bolt M8x80mm', 'M8x80mm + washer and nut', 1, 'strong visible frame connections, outdoor builds'],
    ['Bed bolt with cross dowel M8x80mm', 'M8x80mm', 2, 'demountable bed/table frames — strong and hidden'],
    ['Lag screw 8x80mm', '8x80mm, hex head', 1, 'heavy frame members, ledgers (pre-drill, use washer)'],
    ['Angle bracket 40x40mm', '40x40x20mm, steel', 1, 'quick right-angle reinforcement, shelf supports'],
    ['Heavy angle bracket 90x90mm', '90x90x40mm, steel', 1, 'workbench frames, heavy loads'],
    ['Butt hinge 80mm', '80mm, steel', 2, 'doors, lids, folding parts (mortised or surface-mounted)'],
    ['Piano hinge', 'per meter', 2, 'long lids and flaps, even load along the edge'],
    ['Shelf pin Ø5mm', 'Ø5mm', 1, 'adjustable shelves in 5mm hole rows'],
    ['Threaded insert M6 + machine screw', 'M6', 3, 'demountable connections that are re-assembled often'],
    ['Adjustable foot M8', 'M8, plastic base', 1, 'leveling tables and cabinets on uneven floors']
  ];

  // name | complexity | note
  var DEFAULT_CUTS = [
    ['crosscut', 1, 'cut to length across the grain (hand/miter saw)'],
    ['rip cut', 2, 'cut along the grain, split boards (circular/table saw)'],
    ['panel cut', 2, 'straight sheet cuts with a guide rail (circular saw)'],
    ['miter 45°', 2, 'angled cuts for frames and corners (miter saw)'],
    ['bevel', 2, 'tilted edge cut, e.g. matching a slanted top (circular/table saw)'],
    ['taper', 3, 'tapered legs, wedges (jig or hand plane)'],
    ['curve cut', 3, 'rounded corners, arcs (jigsaw/bandsaw)'],
    ['large hole / cutout', 2, 'bowl/cable cutouts (hole saw, or jigsaw from a pilot hole)'],
    ['drilling', 1, 'pilot, clearance and dowel holes'],
    ['countersink / counterbore', 1, 'recessed or plugged screw heads'],
    ['pocket holes', 2, 'angled hidden screw joints (pocket-hole jig)'],
    ['notch', 2, 'corner notches so panels fit around legs (jigsaw or saw kerfs + chisel)'],
    ['dado / groove', 3, 'housing slots for shelves and panels (router/table saw)'],
    ['rabbet', 3, 'edge recess for backs and panels (router)'],
    ['round-over / chamfer', 2, 'softened edges (router or sanding block)'],
    ['lap joint', 3, 'halved overlapping members (saw + chisel)'],
    ['mortise & tenon', 4, 'strong traditional frame joinery (drill + chisel or router)'],
    ['dovetail', 5, 'drawer-grade corner joinery (hand cut or jig)'],
    ['turning', 5, 'round profiles — requires a lathe']
  ];

  function toParts(rows) {
    return rows.map(function (r) {
      return { name: r[0], section: r[1], maxLen: r[2], species: r[3], priority: r[4], complexity: r[5], use: r[6] };
    });
  }
  function toConnectors(rows) {
    return rows.map(function (r) { return { name: r[0], size: r[1], complexity: r[2], use: r[3] }; });
  }
  function toCuts(rows) {
    return rows.map(function (r) { return { name: r[0], complexity: r[1], note: r[2] }; });
  }

  function defaults() {
    return { parts: toParts(DEFAULT_PARTS), connectors: toConnectors(DEFAULT_CONNECTORS), cuts: toCuts(DEFAULT_CUTS) };
  }

  function get() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (s && Array.isArray(s.parts) && Array.isArray(s.cuts) && s.parts.length) {
        if (!Array.isArray(s.connectors)) s.connectors = defaults().connectors; // upgrade older saves
        return s;
      }
    } catch (e) {}
    return defaults();
  }

  function save(inv) { localStorage.setItem(LS_KEY, JSON.stringify(inv)); }

  function reset() {
    try { localStorage.removeItem(LS_KEY); } catch (e) {}
    return defaults();
  }

  // Compact text block for the LLM prompts.
  function promptBlock() {
    var inv = get();
    var lines = [
      'STOCK INVENTORY — these standard parts are available. ALWAYS design from this list first, cutting to',
      'length/size as needed. Invent custom stock ONLY when nothing here fits, and say so in the summary.',
      'Reference the inventory name in each part\'s "stock" field. Respect the max lengths.',
      'P = assembly priority (1 = base structure, built first … 5 = trim, installed last).',
      'C = complexity to make from raw material (1 = a single cut … 5 = advanced machining). Prefer C1-C3 for DIY.',
      'format: name | section | max mm | material | P | C | typical use'
    ];
    inv.parts.forEach(function (p) {
      lines.push('- ' + p.name + ' | ' + p.section + ' | ' + p.maxLen + ' | ' + p.species + ' | P' + p.priority + ' | C' + p.complexity + ' | ' + p.use);
    });
    lines.push('');
    lines.push('CONNECTORS & FASTENERS — choose hardware from this list. Every "hardware" entry and joint "note"');
    lines.push('should reference one of these (with quantity and size). format: name | size | C | typical use');
    (inv.connectors || []).forEach(function (c) {
      lines.push('- ' + c.name + ' | ' + c.size + ' | C' + c.complexity + ' | ' + c.use);
    });
    lines.push('');
    lines.push('CUTS & OPERATIONS — use these terms in prep instructions (C = difficulty 1-5):');
    inv.cuts.forEach(function (c) {
      lines.push('- ' + c.name + ' (C' + c.complexity + '): ' + c.note);
    });
    lines.push('Order assembly steps so lower-P parts are built first. Avoid C4-C5 operations unless the user asks for fine joinery.');
    return lines.join('\n');
  }

  /* ---------- stock matching (used by geometry lints & cut list) ---------- */
  // Parse a section string: "45x95mm" → rect, "Ø25mm" → round, "18mm sheet/panel" → sheet.
  function parseSection(s) {
    s = String(s || '');
    var m = /(\d+(?:\.\d+)?)\s*[x×]\s*(\d+(?:\.\d+)?)/.exec(s);
    if (m) return { type: 'rect', a: Number(m[1]), b: Number(m[2]) };
    m = /[Øø]\s*(\d+(?:\.\d+)?)/.exec(s);
    if (m) return { type: 'round', d: Number(m[1]) };
    m = /(\d+(?:\.\d+)?)\s*mm\s*(sheet|panel|board)/i.exec(s);
    if (m) return { type: 'sheet', t: Number(m[1]) };
    return null;
  }

  function near(a, b, tol) { return Math.abs(a - b) <= tol; }

  /* Does this design part correspond to an inventory item?
   * Returns { ok:true, item } | { ok:false, dims, closest } | null (unparseable/no inventory). */
  function matchStock(part) {
    var inv = get();
    if (!inv.parts.length) return null;
    var dims, sorted;
    if (part.shape === 'cylinder') {
      dims = { d: part.dimensions.radius * 2, len: part.dimensions.height };
    } else {
      sorted = [part.dimensions.x, part.dimensions.y, part.dimensions.z].slice().sort(function (a, b) { return a - b; });
      dims = { small: sorted[0], mid: sorted[1], len: sorted[2] };
    }
    var closest = null, closestScore = 1e12;
    for (var i = 0; i < inv.parts.length; i++) {
      var it = inv.parts[i];
      var sec = parseSection(it.section);
      if (!sec) continue;
      var maxLen = it.maxLen || 1e9;
      if (part.shape === 'cylinder') {
        if (sec.type !== 'round') continue;
        if (near(sec.d, dims.d, 1.5) && dims.len <= maxLen + 1) return { ok: true, item: it };
        var sc = Math.abs(sec.d - dims.d);
        if (sc < closestScore) { closestScore = sc; closest = it; }
      } else if (sec.type === 'rect') {
        var lo = Math.min(sec.a, sec.b), hi = Math.max(sec.a, sec.b);
        if (near(lo, dims.small, 2) && near(hi, dims.mid, 2) && dims.len <= maxLen + 1) return { ok: true, item: it };
        var sc2 = Math.abs(lo - dims.small) + Math.abs(hi - dims.mid);
        if (sc2 < closestScore) { closestScore = sc2; closest = it; }
      } else if (sec.type === 'sheet') {
        // Panels: thickness matches, both sheet dimensions within max length.
        if (near(sec.t, dims.small, 1.5) && dims.len <= maxLen + 1 && dims.mid <= maxLen + 1) return { ok: true, item: it };
        var sc3 = Math.abs(sec.t - dims.small) + 10; // slight penalty vs rect matches
        if (sc3 < closestScore) { closestScore = sc3; closest = it; }
      }
    }
    var dimsLabel = part.shape === 'cylinder'
      ? ('Ø' + Math.round(dims.d) + '×' + Math.round(dims.len) + 'mm')
      : (Math.round(dims.small) + '×' + Math.round(dims.mid) + '×' + Math.round(dims.len) + 'mm');
    return { ok: false, dims: dimsLabel, closest: closest ? (closest.name + ' (' + closest.section + ')') : null };
  }

  /* Difficulty estimate for a part: its stock complexity plus the hardest
   * cut/operation found in its prep instructions. Returns 1-5. */
  function partComplexity(part) {
    var inv = get();
    var c = 1;
    var m = matchStock(part);
    if (m && m.ok) c = Math.max(c, m.item.complexity || 1);
    var text = ((part.prep && part.prep.operations) || []).map(function (o) {
      return (o.type + ' ' + o.instruction).toLowerCase();
    }).join(' ');
    inv.cuts.forEach(function (cut) {
      var tokens = cut.name.toLowerCase().split(/[\/&,]| and /).map(function (x) { return x.trim(); }).filter(Boolean);
      tokens.forEach(function (tok) {
        if (tok.length > 3 && text.indexOf(tok) >= 0) c = Math.max(c, cut.complexity || 1);
      });
    });
    return Math.min(5, c);
  }

  window.Inventory = {
    defaults: defaults,
    get: get,
    save: save,
    reset: reset,
    promptBlock: promptBlock,
    parseSection: parseSection,
    matchStock: matchStock,
    partComplexity: partComplexity
  };
})();
