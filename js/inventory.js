/* inventory.js — editable stock inventory: the standard parts and cuts the AI
 * designs from before inventing anything custom. Each part carries metadata:
 * P = assembly priority (1 = base structure, built first … 5 = trim, last)
 * C = complexity to make from raw material (1 = single cut … 5 = advanced).
 * Defaults are built in; user edits persist in localStorage ('diyw_inventory').
 * Exposes window.Inventory.
 */
(function () {
  'use strict';

  var LS_KEY = 'diyw_inventory';

  // name | section | max length mm | material | priority | complexity | typical use
  var DEFAULT_PARTS = [
    ['Construction lumber 45x95mm', '45x95mm', 4000, 'pine/spruce', 1, 1, 'frames, bed rails, table aprons, heavy structures'],
    ['Construction lumber 45x70mm', '45x70mm', 4000, 'pine/spruce', 1, 1, 'light frames, rails, stretchers'],
    ['Post 70x70mm', '70x70mm', 3000, 'pine/spruce', 1, 1, 'table/bench legs, bed posts, uprights'],
    ['Post 90x90mm', '90x90mm', 3000, 'pine/spruce', 1, 1, 'heavy posts, workbench legs, pergolas'],
    ['Batten 45x45mm', '45x45mm', 3000, 'pine/spruce', 2, 1, 'light frames, cleats, corner blocking'],
    ['Batten 30x30mm', '30x30mm', 2400, 'pine/spruce', 3, 1, 'cleats, slat supports, light bracing'],
    ['Lath 20x40mm', '20x40mm', 2400, 'pine/spruce', 3, 1, 'cleats, trim, diagonal bracing'],
    ['Board 18x70mm', '18x70mm', 2400, 'pine/spruce', 3, 1, 'slats, pickets, light shelves'],
    ['Board 18x120mm', '18x120mm', 2400, 'pine/spruce', 2, 1, 'shelves, box sides, seat slats'],
    ['Board 28x140mm', '28x140mm', 4000, 'pine/spruce', 2, 1, 'bed/planter sides, bench parts, treads'],
    ['Plank 27x200mm', '27x200mm', 4000, 'spruce', 2, 1, 'bench tops, wide shelves, rustic tables'],
    ['Frame slat 20x95mm', '20x95mm', 2400, 'pine/spruce', 3, 1, 'infill slats, gates, headboards'],
    ['Plywood 18mm', '18mm sheet', 2500, 'birch/spruce ply', 2, 2, 'table tops, carcasses, shelves (rip + crosscut from sheet)'],
    ['Plywood 12mm', '12mm sheet', 2500, 'birch/spruce ply', 2, 2, 'drawers, boxes, lighter panels'],
    ['Plywood 9mm', '9mm sheet', 2500, 'birch ply', 3, 2, 'curved parts, light boxes'],
    ['MDF 19mm', '19mm sheet', 2800, 'MDF', 2, 2, 'paint-grade tops and panels (indoor only)'],
    ['Edge-glued panel 18mm', '18mm panel', 2000, 'spruce/beech', 2, 1, 'table tops, shelves, cabinet sides (ready surface)'],
    ['Hardboard/HDF 3mm', '3mm sheet', 2750, 'HDF', 4, 1, 'cabinet backs, drawer bottoms'],
    ['Decking board 28x120mm', '28x120mm grooved', 4000, 'larch/impreg. pine', 2, 1, 'outdoor tops, planters, terraces'],
    ['Dowel rod Ø25mm', 'Ø25mm', 1000, 'beech', 3, 1, 'hanging rails, rungs, handles'],
    ['Dowel rod Ø12mm', 'Ø12mm', 1000, 'beech', 3, 1, 'pegs, light rungs'],
    ['Trim / quarter round 15x15mm', '15x15mm', 2400, 'pine', 5, 1, 'edges, gap covers, finishing touches']
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
  function toCuts(rows) {
    return rows.map(function (r) { return { name: r[0], complexity: r[1], note: r[2] }; });
  }

  function defaults() { return { parts: toParts(DEFAULT_PARTS), cuts: toCuts(DEFAULT_CUTS) }; }

  function get() {
    try {
      var s = JSON.parse(localStorage.getItem(LS_KEY) || 'null');
      if (s && Array.isArray(s.parts) && Array.isArray(s.cuts) && s.parts.length) return s;
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
    lines.push('CUTS & OPERATIONS — use these terms in prep instructions (C = difficulty 1-5):');
    inv.cuts.forEach(function (c) {
      lines.push('- ' + c.name + ' (C' + c.complexity + '): ' + c.note);
    });
    lines.push('Order assembly steps so lower-P parts are built first. Avoid C4-C5 operations unless the user asks for fine joinery.');
    return lines.join('\n');
  }

  window.Inventory = { defaults: defaults, get: get, save: save, reset: reset, promptBlock: promptBlock };
})();
