/* schema.js — Design JSON schema, validation, normalization, cut-list grouping, sample design.
 * Units: millimeters. Coordinate system: y-up, floor at y=0, positions are part CENTERS.
 * Plain script (no modules) so the app works from file:// too. Exposes window.Schema.
 */
(function () {
  'use strict';

  var SCHEMA_VERSION = 1;

  // Joinery vocabulary. Housed/machined joints require matching prep operations on the machined part(s).
  var JOINT_TYPES = ['screw', 'bolt', 'nail', 'glue', 'bracket', 'hinge', 'dowel', 'biscuit', 'domino',
    'pocket_hole', 'dado', 'groove', 'rabbet', 'lap', 'mortise_tenon', 'dovetail', 'miter', 'other'];

  // Human/AI readable schema description (embedded into the LLM system prompt).
  var SCHEMA_DOC = [
    'DESIGN JSON SCHEMA (all lengths in millimeters, y-up, floor at y=0, positions are part CENTERS):',
    '{',
    '  "meta": { "name": str, "description": str, "units": "mm" },',
    '  "parts": [ {',
    '    "id": str (unique, snake_case),',
    '    "name": str (human friendly, e.g. "Side rail (left)"),',
    '    "shape": "box" | "cylinder",',
    '    "dimensions": box: {"x": mm, "y": mm, "z": mm} | cylinder: {"radius": mm, "height": mm},',
    '    "position": {"x": mm, "y": mm, "z": mm},',
    '    "rotation": {"x": deg, "y": deg, "z": deg}  (optional, default 0),',
    '    "material": { "species": e.g. "pine"|"oak"|"plywood"|"metal", "color": "#hex" (optional),',
    '                  "finish": "raw"|"painted"|"stained"|"varnished", "shine": 0..1,',
    '                  "grainDirection": "x"|"y"|"z" (longest axis of the wood grain) },',
    '    "stock": str (what to buy/cut from, e.g. "45x95mm construction lumber" or "18mm plywood"),',
    '    "prep": { "operations": [ {"type": "cut"|"drill"|"sand"|"route"|"plane"|"other", "instruction": str} ],',
    '              "notes": str (optional) }',
    '  } ],',
    '  "joints": [ { "id": str, "type": "screw"|"bolt"|"nail"|"glue"|"bracket"|"hinge"|"dowel"|"biscuit"|"domino"|',
    '                        "pocket_hole"|"dado"|"groove"|"rabbet"|"lap"|"mortise_tenon"|"dovetail"|"miter",',
    '                "parts": [partId, partId], "position": {"x","y","z"} (mm, marker location),',
    '                "note": str (e.g. "3x wood screws 4x50mm", "dado 18mm wide x 8mm deep") } ],',
    '  "hardware": [ { "name": str, "quantity": int, "note": str (optional) } ],',
    '  "assembly": [ { "step": int (1-based, ordered), "title": str, "instruction": str (detailed),',
    '                  "parts": [partId...] (parts added in this step), "joints": [jointId...] (optional) } ],',
    '  "finishing": [ { "step": int, "title": str, "instruction": str, "parts": [partId...] or ["*"] } ]',
    '}',
    'RULES:',
    '- Every part MUST appear in exactly one assembly step\'s "parts" list.',
    '- Every part MUST have at least one prep operation (usually a cut from stock).',
    '- Geometry must be physically plausible: parts touch where joined, nothing floats, floor is y=0.',
    '- Use realistic commercially available stock sizes (18mm plywood, 45x95, 70x70 posts, etc.).',
    '- Hinged parts must have a "hinge" joint AND matching hardware entry.',
    '- Keep part count reasonable (< 80). Identical parts get separate entries with ids like slat_1, slat_2.'
  ].join('\n');

  function num(v, d) { return (typeof v === 'number' && isFinite(v)) ? v : (d || 0); }

  function normVec(v, d) {
    v = v || {};
    return { x: num(v.x, d), y: num(v.y, d), z: num(v.z, d) };
  }

  function slug(s, i) {
    s = String(s || 'part_' + i).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    return s || ('part_' + i);
  }

  // Validate + normalize a design object. Returns {ok, design, errors[], warnings[]}.
  function validate(input) {
    var errors = [], warnings = [];
    if (!input || typeof input !== 'object') return { ok: false, errors: ['Design is not an object'], warnings: [] };

    var d = {
      schemaVersion: SCHEMA_VERSION,
      meta: {
        name: (input.meta && input.meta.name) || 'Untitled design',
        description: (input.meta && input.meta.description) || '',
        units: 'mm'
      },
      parts: [], joints: [], hardware: [], assembly: [], finishing: []
    };

    var parts = Array.isArray(input.parts) ? input.parts : [];
    if (!parts.length) errors.push('Design has no parts');
    var ids = {};
    parts.forEach(function (p, i) {
      if (!p || typeof p !== 'object') { warnings.push('Part #' + i + ' invalid, skipped'); return; }
      var id = slug(p.id || p.name, i);
      while (ids[id]) id = id + '_x';
      ids[id] = true;
      var shape = p.shape === 'cylinder' ? 'cylinder' : 'box';
      var dims;
      if (shape === 'cylinder') {
        dims = { radius: Math.max(1, num(p.dimensions && p.dimensions.radius, 20)),
                 height: Math.max(1, num(p.dimensions && p.dimensions.height, 100)) };
      } else {
        dims = { x: Math.max(1, num(p.dimensions && p.dimensions.x, 100)),
                 y: Math.max(1, num(p.dimensions && p.dimensions.y, 100)),
                 z: Math.max(1, num(p.dimensions && p.dimensions.z, 100)) };
      }
      var mat = p.material || {};
      var ops = (p.prep && Array.isArray(p.prep.operations)) ? p.prep.operations : [];
      ops = ops.filter(function (o) { return o && o.instruction; }).map(function (o) {
        return { type: o.type || 'cut', instruction: String(o.instruction) };
      });
      if (!ops.length) {
        warnings.push('Part "' + id + '" had no prep operations; default cut added');
        ops = [{ type: 'cut', instruction: 'Cut to size from stock: ' + dimsLabel({ shape: shape, dimensions: dims }) + '.' }];
      }
      d.parts.push({
        id: id,
        name: p.name || id,
        shape: shape,
        dimensions: dims,
        position: normVec(p.position, 0),
        rotation: normVec(p.rotation, 0),
        material: {
          species: mat.species || 'pine',
          color: mat.color || null,
          finish: mat.finish || 'raw',
          shine: Math.min(1, Math.max(0, num(mat.shine, 0.15))),
          grainDirection: /^[xyz]$/.test(mat.grainDirection) ? mat.grainDirection : longestAxis(shape, dims)
        },
        stock: p.stock || '',
        prep: { operations: ops, notes: (p.prep && p.prep.notes) || '' }
      });
    });

    (Array.isArray(input.joints) ? input.joints : []).forEach(function (j, i) {
      if (!j || !Array.isArray(j.parts)) return;
      var jp = j.parts.map(function (pid) { return slug(pid, 0); }).filter(function (pid) { return ids[pid]; });
      if (jp.length < 1) { warnings.push('Joint #' + i + ' references unknown parts, skipped'); return; }
      var jtype = String(j.type || 'screw').toLowerCase().replace(/[\s-]+/g, '_');
      if (JOINT_TYPES.indexOf(jtype) < 0) {
        warnings.push('Joint #' + i + ' has unknown type "' + j.type + '" (kept as "other")');
        jtype = 'other';
      }
      d.joints.push({
        id: slug(j.id || ('joint_' + i), i), type: jtype, parts: jp,
        position: j.position ? normVec(j.position, 0) : null,
        note: j.note || ''
      });
    });

    (Array.isArray(input.hardware) ? input.hardware : []).forEach(function (h) {
      if (h && h.name) d.hardware.push({ name: String(h.name), quantity: Math.max(1, Math.round(num(h.quantity, 1))), note: h.note || '' });
    });

    (Array.isArray(input.assembly) ? input.assembly : []).forEach(function (s, i) {
      if (!s) return;
      var sp = (Array.isArray(s.parts) ? s.parts : []).map(function (pid) { return slug(pid, 0); }).filter(function (pid) { return ids[pid]; });
      d.assembly.push({
        step: d.assembly.length + 1,
        title: s.title || ('Step ' + (i + 1)),
        instruction: s.instruction || '',
        parts: sp,
        joints: (Array.isArray(s.joints) ? s.joints : []).map(function (jid) { return slug(jid, 0); })
      });
    });

    // Normalize step membership so the assembly view builds up correctly:
    // a part belongs to the step where it is ADDED, exactly once.
    // 1. Strip "bulk" steps ("cut all parts" style) that list nearly every part
    //    when those parts are also assigned to other steps.
    var totalParts = d.parts.length;
    if (d.assembly.length > 2 && totalParts >= 4) {
      d.assembly.forEach(function (s) {
        if (s.parts.length < totalParts * 0.8) return;
        var elsewhere = {};
        d.assembly.forEach(function (o) { if (o !== s) o.parts.forEach(function (pid) { elsewhere[pid] = true; }); });
        var before = s.parts.length;
        s.parts = s.parts.filter(function (pid) { return !elsewhere[pid]; });
        if (s.parts.length < before) warnings.push('Assembly step "' + s.title + '" listed nearly all parts; kept only the parts not added in other steps.');
      });
    }
    // 2. Deduplicate across steps (first occurrence wins — handles cumulative lists).
    var covered = {}, dedup = 0;
    d.assembly.forEach(function (s) {
      s.parts = s.parts.filter(function (pid) {
        if (covered[pid]) { dedup++; return false; }
        covered[pid] = true;
        return true;
      });
    });
    if (dedup) warnings.push(dedup + ' part reference(s) repeated across assembly steps were removed (each part is added once).');

    var orphans = d.parts.filter(function (p) { return !covered[p.id]; }).map(function (p) { return p.id; });
    if (orphans.length) {
      warnings.push('Parts missing from assembly steps (auto step added): ' + orphans.join(', '));
      d.assembly.push({ step: d.assembly.length + 1, title: 'Remaining parts', instruction: 'Attach the remaining parts.', parts: orphans, joints: [] });
    }
    if (!d.assembly.length && d.parts.length) {
      d.assembly.push({ step: 1, title: 'Assemble', instruction: 'Assemble all parts.', parts: d.parts.map(function (p) { return p.id; }), joints: [] });
    }

    (Array.isArray(input.finishing) ? input.finishing : []).forEach(function (f, i) {
      if (!f) return;
      d.finishing.push({
        step: d.finishing.length + 1, title: f.title || ('Finishing ' + (i + 1)),
        instruction: f.instruction || '', parts: Array.isArray(f.parts) ? f.parts : ['*']
      });
    });

    return { ok: errors.length === 0, design: d, errors: errors, warnings: warnings };
  }

  function longestAxis(shape, dims) {
    if (shape === 'cylinder') return 'y';
    var m = Math.max(dims.x, dims.y, dims.z);
    return m === dims.x ? 'x' : (m === dims.y ? 'y' : 'z');
  }

  function dimsLabel(p) {
    if (p.shape === 'cylinder') return 'Ø' + r1(p.dimensions.radius * 2) + ' × ' + r1(p.dimensions.height) + ' mm';
    var a = [p.dimensions.x, p.dimensions.y, p.dimensions.z].sort(function (a, b) { return b - a; });
    return r1(a[0]) + ' × ' + r1(a[1]) + ' × ' + r1(a[2]) + ' mm';
  }

  function r1(n) { return Math.round(n * 10) / 10; }

  // Group identical parts for the cut list: same shape+dims+stock+species.
  function cutList(design) {
    var groups = {};
    (design.parts || []).forEach(function (p) {
      var key = [p.shape, dimsLabel(p), p.stock, p.material.species].join('|');
      var base = p.name.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+\d+$/, '');
      if (!groups[key]) groups[key] = { names: [], qty: 0, dims: dimsLabel(p), stock: p.stock, species: p.material.species, ids: [], ops: p.prep.operations };
      if (groups[key].names.indexOf(base) < 0) groups[key].names.push(base);
      groups[key].qty++;
      groups[key].ids.push(p.id);
    });
    return Object.keys(groups).map(function (k) {
      var g = groups[k];
      g.name = g.names.slice(0, 2).join(' / ') + (g.names.length > 2 ? ' …' : '');
      return g;
    }).sort(function (a, b) { return b.qty - a.qty; });
  }

  // ---------- Sample design: single person wooden bed (900 x 2000 mattress) ----------
  function sampleBed() {
    var parts = [], joints = [], assemblySlats = [];
    var RAIL_T = 28, RAIL_H = 140, RAIL_TOP = 350;           // side/end rails
    var innerW = 910;                                         // clear width for 900 mattress
    var railCX = innerW / 2 + RAIL_T / 2;                     // 469
    var railCY = RAIL_TOP - RAIL_H / 2;                       // 280
    var LEN = 2000;
    var POST = 70;

    function box(id, name, dx, dy, dz, px, py, pz, opts) {
      opts = opts || {};
      parts.push({
        id: id, name: name, shape: 'box',
        dimensions: { x: dx, y: dy, z: dz },
        position: { x: px, y: py, z: pz },
        rotation: { x: 0, y: 0, z: 0 },
        material: { species: opts.species || 'pine', finish: 'raw', shine: 0.15, grainDirection: opts.grain },
        stock: opts.stock || '',
        prep: { operations: opts.ops || [{ type: 'cut', instruction: 'Cut to ' + dx + ' × ' + dy + ' × ' + dz + ' mm from stock.' }], notes: opts.notes || '' }
      });
    }

    // Corner posts (head posts taller for headboard)
    [['post_head_left', -1, 1, 800], ['post_head_right', 1, 1, 800], ['post_foot_left', -1, -1, 450], ['post_foot_right', 1, -1, 450]]
      .forEach(function (c) {
        box(c[0], 'Post (' + c[0].replace(/_/g, ' ').replace('post ', '') + ')', POST, c[3], POST,
          c[1] * (railCX + RAIL_T / 2 + POST / 2 - 14), c[3] / 2, c[2] * (LEN / 2 + POST / 2),
          { stock: '70x70mm post', ops: [
            { type: 'cut', instruction: 'Cut 70x70 post to ' + c[3] + ' mm length.' },
            { type: 'drill', instruction: 'Drill two 8mm pilot holes on the inner faces for the rail bolts (60 and 100 mm below the top of the rail position).' },
            { type: 'sand', instruction: 'Sand all faces with 120 then 180 grit; break the edges with a light chamfer.' }
          ]});
      });

    // Side rails
    [-1, 1].forEach(function (s) {
      box('side_rail_' + (s < 0 ? 'left' : 'right'), 'Side rail (' + (s < 0 ? 'left' : 'right') + ')',
        RAIL_T, RAIL_H, LEN, s * railCX, railCY, 0,
        { stock: '28x140mm board', grain: 'z', ops: [
          { type: 'cut', instruction: 'Cut 28x140 board to 2000 mm length.' },
          { type: 'drill', instruction: 'Drill and countersink screw holes every 300 mm along the lower inside edge for the slat cleat.' },
          { type: 'sand', instruction: 'Sand faces and edges, 120 → 180 grit.' }
        ]});
    });

    // Head/foot rails (span between side rails, inside faces)
    [['head_rail', 1], ['foot_rail', -1]].forEach(function (c) {
      box(c[0], c[0] === 'head_rail' ? 'Head rail' : 'Foot rail', innerW, RAIL_H, RAIL_T,
        0, railCY, c[1] * (LEN / 2 - RAIL_T / 2),
        { stock: '28x140mm board', grain: 'x', ops: [
          { type: 'cut', instruction: 'Cut 28x140 board to ' + innerW + ' mm length.' },
          { type: 'drill', instruction: 'Drill two 8mm holes at each end for bed bolts into the posts.' },
          { type: 'sand', instruction: 'Sand faces and edges, 120 → 180 grit.' }
        ]});
    });

    // Headboard panel
    box('headboard', 'Headboard panel', innerW + 2 * (RAIL_T + POST) - 28, 250, 18, 0, 640, LEN / 2 + POST / 2,
      { stock: '18mm plywood or glued panel', grain: 'x', ops: [
        { type: 'cut', instruction: 'Cut panel to size; round the two top corners with a 30 mm radius using a jigsaw.' },
        { type: 'route', instruction: 'Round over the top edge with a 6 mm round-over bit.' },
        { type: 'sand', instruction: 'Sand faces 120 → 180 → 240 grit.' }
      ]});

    // Slat cleats
    [-1, 1].forEach(function (s) {
      box('cleat_' + (s < 0 ? 'left' : 'right'), 'Slat cleat (' + (s < 0 ? 'left' : 'right') + ')',
        30, 30, LEN - 2 * RAIL_T, s * (innerW / 2 - 15), 245, 0,
        { stock: '30x30mm batten', grain: 'z', ops: [
          { type: 'cut', instruction: 'Cut 30x30 batten to ' + (LEN - 2 * RAIL_T) + ' mm.' },
          { type: 'drill', instruction: 'Pre-drill 4mm clearance holes every 300 mm.' }
        ]});
    });

    // Slats: 12 across the length
    var N = 12, SLAT_W = 70, SLAT_T = 18;
    var usable = LEN - 2 * RAIL_T, gap = (usable - N * SLAT_W) / (N + 1);
    for (var i = 0; i < N; i++) {
      var z = -usable / 2 + gap * (i + 1) + SLAT_W * (i + 0.5);
      var id = 'slat_' + (i + 1);
      box(id, 'Slat ' + (i + 1), innerW - 10, SLAT_T, SLAT_W, 0, 260 + SLAT_T / 2, z,
        { stock: '18x70mm slat board', grain: 'x', ops: [
          { type: 'cut', instruction: 'Cut 18x70 board to ' + (innerW - 10) + ' mm.' },
          { type: 'sand', instruction: 'Sand and break edges so bedding does not snag.' }
        ]});
      assemblySlats.push(id);
      joints.push({ id: 'j_slat_' + (i + 1), type: 'screw', parts: [id, 'cleat_left'], position: { x: -(innerW / 2 - 15), y: 275, z: z }, note: '1x screw 4x40mm each end' });
    }

    // Frame joints
    [['j_head_left', 'head_rail', 'post_head_left'], ['j_head_right', 'head_rail', 'post_head_right'],
     ['j_foot_left', 'foot_rail', 'post_foot_left'], ['j_foot_right', 'foot_rail', 'post_foot_right']]
      .forEach(function (j) {
        var p2 = parts.find(function (p) { return p.id === j[2]; });
        joints.push({ id: j[0], type: 'bolt', parts: [j[1], j[2]], position: { x: p2.position.x * 0.92, y: railCY, z: p2.position.z * 0.9 }, note: '2x bed bolts M8x80 with cross dowels' });
      });
    [['j_side_hl', 'side_rail_left', 'post_head_left'], ['j_side_hr', 'side_rail_right', 'post_head_right'],
     ['j_side_fl', 'side_rail_left', 'post_foot_left'], ['j_side_fr', 'side_rail_right', 'post_foot_right']]
      .forEach(function (j) {
        var p2 = parts.find(function (p) { return p.id === j[2]; });
        joints.push({ id: j[0], type: 'bolt', parts: [j[1], j[2]], position: { x: p2.position.x * 0.92, y: railCY, z: p2.position.z * 0.9 }, note: '2x bed bolts M8x80 with cross dowels' });
      });
    joints.push({ id: 'j_headboard', type: 'screw', parts: ['headboard', 'post_head_left'], position: { x: 0, y: 640, z: LEN / 2 + POST / 2 }, note: '6x screws 4x45mm from the back into both head posts' });
    [-1, 1].forEach(function (s) {
      joints.push({ id: 'j_cleat_' + (s < 0 ? 'l' : 'r'), type: 'screw', parts: ['cleat_' + (s < 0 ? 'left' : 'right'), 'side_rail_' + (s < 0 ? 'left' : 'right')], position: { x: s * (innerW / 2 - 15), y: 245, z: 0 }, note: 'Screws 4x60mm every 300 mm' });
    });

    return validate({
      meta: { name: 'Single bed (900×2000)', description: 'Single person wooden bed for a 900×2000 mm mattress. Pine construction with bolted rail joints and a slatted base.', units: 'mm' },
      parts: parts,
      joints: joints,
      hardware: [
        { name: 'Bed bolt M8x80 with cross dowel', quantity: 16, note: '2 per rail-to-post joint' },
        { name: 'Wood screw 4x60mm', quantity: 28, note: 'Cleats to side rails' },
        { name: 'Wood screw 4x40mm', quantity: 24, note: 'Slats to cleats' },
        { name: 'Wood screw 4x45mm', quantity: 6, note: 'Headboard to posts' },
        { name: 'Wood glue', quantity: 1, note: 'Optional, for cleats' }
      ],
      assembly: [
        { step: 1, title: 'Head end', instruction: 'Stand the two head posts up and bolt the head rail between them using two M8 bed bolts per side. Keep the rail top 350 mm above the floor. Check for square with a speed square.', parts: ['post_head_left', 'post_head_right', 'head_rail'], joints: ['j_head_left', 'j_head_right'] },
        { step: 2, title: 'Foot end', instruction: 'Repeat with the two foot posts and the foot rail. Both end frames should be mirror images.', parts: ['post_foot_left', 'post_foot_right', 'foot_rail'], joints: ['j_foot_left', 'j_foot_right'] },
        { step: 3, title: 'Side rails', instruction: 'Connect the two end frames with the side rails using two M8 bed bolts per corner. Measure both diagonals of the frame — equal diagonals mean the frame is square.', parts: ['side_rail_left', 'side_rail_right'], joints: ['j_side_hl', 'j_side_hr', 'j_side_fl', 'j_side_fr'] },
        { step: 4, title: 'Headboard', instruction: 'Screw the headboard panel to the back of the head posts with 4x45 mm screws, top edge 765 mm above the floor.', parts: ['headboard'], joints: ['j_headboard'] },
        { step: 5, title: 'Slat cleats', instruction: 'Screw the 30x30 cleats to the inside of each side rail, top edge 260 mm above the floor, using 4x60 mm screws every 300 mm.', parts: ['cleat_left', 'cleat_right'], joints: ['j_cleat_l', 'j_cleat_r'] },
        { step: 6, title: 'Slats', instruction: 'Lay the 12 slats on the cleats with even gaps (~89 mm) and fix each end with one 4x40 mm screw.', parts: assemblySlats, joints: [] }
      ],
      finishing: [
        { step: 1, title: 'Final sanding', instruction: 'Sand everything with 180 grit, then wipe off dust with a damp cloth.', parts: ['*'] },
        { step: 2, title: 'Oil or varnish', instruction: 'Apply two coats of clear hard-wax oil or water-based varnish; light 240-grit sanding between coats. Slats can stay raw.', parts: ['post_head_left', 'post_head_right', 'post_foot_left', 'post_foot_right', 'side_rail_left', 'side_rail_right', 'head_rail', 'foot_rail', 'headboard'] }
      ]
    }).design;
  }

  /* Geometric joint audit: detect joints between non-touching parts and snap misplaced
   * joint markers onto the actual contact region. Mutates design.joints. Returns
   * { notouch: [jointId...], moved: n }. */
  function auditJoints(design) {
    var MARGIN = 25; // mm tolerance
    var byId = {};
    (design.parts || []).forEach(function (p) { byId[p.id] = p; });

    function bounds(p) {
      var c = p.position, half;
      if (p.shape === 'cylinder') half = { x: p.dimensions.radius, y: p.dimensions.height / 2, z: p.dimensions.radius };
      else half = { x: p.dimensions.x / 2, y: p.dimensions.y / 2, z: p.dimensions.z / 2 };
      var rotated = p.rotation && (p.rotation.x || p.rotation.y || p.rotation.z);
      if (rotated) {
        // Loose bound for rotated parts: bounding sphere as cube.
        var r = Math.sqrt(half.x * half.x + half.y * half.y + half.z * half.z);
        half = { x: r, y: r, z: r };
      }
      return {
        min: { x: c.x - half.x, y: c.y - half.y, z: c.z - half.z },
        max: { x: c.x + half.x, y: c.y + half.y, z: c.z + half.z }
      };
    }

    var notouch = [], moved = 0;
    (design.joints || []).forEach(function (j) {
      if (!j.parts || j.parts.length < 2) return;
      var a = byId[j.parts[0]], b = byId[j.parts[1]];
      if (!a || !b) return;
      var ba = bounds(a), bb = bounds(b);
      var overlap = {}, touching = true;
      ['x', 'y', 'z'].forEach(function (ax) {
        var lo = Math.max(ba.min[ax], bb.min[ax]) - MARGIN;
        var hi = Math.min(ba.max[ax], bb.max[ax]) + MARGIN;
        if (lo > hi) touching = false;
        overlap[ax] = [lo, hi];
      });
      if (!touching) { notouch.push(j.id); return; }
      var center = {
        x: (overlap.x[0] + overlap.x[1]) / 2,
        y: (overlap.y[0] + overlap.y[1]) / 2,
        z: (overlap.z[0] + overlap.z[1]) / 2
      };
      if (!j.position) { j.position = center; moved++; return; }
      var off = false;
      ['x', 'y', 'z'].forEach(function (ax) {
        if (j.position[ax] < overlap[ax][0] || j.position[ax] > overlap[ax][1]) off = true;
      });
      if (off) {
        // Keep in-range coordinates, snap out-of-range ones to the contact center.
        ['x', 'y', 'z'].forEach(function (ax) {
          if (j.position[ax] < overlap[ax][0] || j.position[ax] > overlap[ax][1]) j.position[ax] = center[ax];
        });
        moved++;
      }
    });
    return { notouch: notouch, moved: moved };
  }

  /* ---------- geometry cleanup & lints ---------- */
  function isRotated(p) { return !!(p.rotation && (p.rotation.x || p.rotation.y || p.rotation.z)); }

  function partBounds(p) {
    var half;
    if (p.shape === 'cylinder') half = { x: p.dimensions.radius, y: p.dimensions.height / 2, z: p.dimensions.radius };
    else half = { x: p.dimensions.x / 2, y: p.dimensions.y / 2, z: p.dimensions.z / 2 };
    if (isRotated(p)) {
      var r = Math.sqrt(half.x * half.x + half.y * half.y + half.z * half.z);
      half = { x: r, y: r, z: r };
    }
    var c = p.position;
    return {
      min: { x: c.x - half.x, y: c.y - half.y, z: c.z - half.z },
      max: { x: c.x + half.x, y: c.y + half.y, z: c.z + half.z }
    };
  }

  function partVolume(p) {
    return p.shape === 'cylinder'
      ? Math.PI * p.dimensions.radius * p.dimensions.radius * p.dimensions.height
      : p.dimensions.x * p.dimensions.y * p.dimensions.z;
  }

  /* Deterministic cleanup of sloppy AI coordinates. Mutates the design.
   * - rounds positions/dimensions to 0.5 mm
   * - snaps parts that almost rest on the floor (|bottom| < 8 mm) onto y=0
   * - closes small gaps (<= 6 mm) between joined parts by moving the smaller part
   * Returns { floored, gapsClosed }. */
  function snapDesign(d) {
    var res = { floored: 0, gapsClosed: 0 };
    function r05(v) { return Math.round(v * 2) / 2; }
    (d.parts || []).forEach(function (p) {
      ['x', 'y', 'z'].forEach(function (ax) { p.position[ax] = r05(p.position[ax]); });
      if (p.shape === 'cylinder') { p.dimensions.radius = r05(p.dimensions.radius); p.dimensions.height = r05(p.dimensions.height); }
      else ['x', 'y', 'z'].forEach(function (ax) { p.dimensions[ax] = r05(p.dimensions[ax]); });
      if (!isRotated(p)) {
        var bottom = partBounds(p).min.y;
        if (Math.abs(bottom) > 0.01 && bottom > -8 && bottom < 8) { p.position.y -= bottom; res.floored++; }
      }
    });
    var byId = {};
    (d.parts || []).forEach(function (p) { byId[p.id] = p; });
    (d.joints || []).forEach(function (j) {
      if (!j.parts || j.parts.length < 2) return;
      var a = byId[j.parts[0]], b = byId[j.parts[1]];
      if (!a || !b || isRotated(a) || isRotated(b)) return;
      var ba = partBounds(a), bb = partBounds(b);
      var sepAxis = null, sep = 0, n = 0;
      ['x', 'y', 'z'].forEach(function (ax) {
        var g = Math.max(ba.min[ax] - bb.max[ax], bb.min[ax] - ba.max[ax]);
        if (g > 0.01) { n++; sepAxis = ax; sep = g; }
      });
      if (n === 1 && sep <= 6) {
        // Never move a part that stands on the floor — prefer the other one,
        // otherwise move the smaller part.
        function onFloor(p) { return Math.abs(partBounds(p).min.y) < 0.6; }
        var mover;
        if (onFloor(a) && !onFloor(b)) mover = b;
        else if (onFloor(b) && !onFloor(a)) mover = a;
        else mover = partVolume(a) <= partVolume(b) ? a : b;
        var other = mover === a ? b : a;
        mover.position[sepAxis] += (other.position[sepAxis] > mover.position[sepAxis] ? 1 : -1) * sep;
        res.gapsClosed++;
      }
    });
    return res;
  }

  /* Geometry lints for the automatic repair loop. Returns human-readable issue
   * strings (max 12). Rotated parts are exempt (loose bounds → false positives). */
  function lintDesign(d) {
    var issues = [], overlapIssues = [];
    var parts = d.parts || [];
    var byId = {};
    parts.forEach(function (p) { byId[p.id] = p; });

    // 1. below floor
    parts.forEach(function (p) {
      if (isRotated(p)) return;
      var b = partBounds(p);
      if (b.min.y < -1) issues.push('Part "' + p.id + '" extends ' + Math.round(-b.min.y) + ' mm below the floor (y=0).');
    });

    // touching graph (3 mm tolerance)
    function touching(a, b) {
      var ba = partBounds(a), bb = partBounds(b), ok = true;
      ['x', 'y', 'z'].forEach(function (ax) {
        if (ba.min[ax] - 3 > bb.max[ax] || bb.min[ax] - 3 > ba.max[ax]) ok = false;
      });
      return ok;
    }
    var adj = {};
    var i, k;
    for (i = 0; i < parts.length; i++) {
      for (k = i + 1; k < parts.length; k++) {
        if (touching(parts[i], parts[k])) {
          (adj[parts[i].id] = adj[parts[i].id] || []).push(parts[k].id);
          (adj[parts[k].id] = adj[parts[k].id] || []).push(parts[i].id);
        }
      }
    }

    // 2. support: BFS from grounded parts (bottom within 2 mm of the floor)
    var grounded = {}, queue = [];
    parts.forEach(function (p) {
      if (isRotated(p) || partBounds(p).min.y <= 2) { grounded[p.id] = true; queue.push(p.id); }
    });
    while (queue.length) {
      var cur = queue.pop();
      (adj[cur] || []).forEach(function (nid) {
        if (!grounded[nid]) { grounded[nid] = true; queue.push(nid); }
      });
    }
    parts.forEach(function (p) {
      if (grounded[p.id]) return;
      var reason = (adj[p.id] && adj[p.id].length) ? 'it only touches other unsupported parts' : 'it touches no other part';
      issues.push('Part "' + p.id + '" floats in mid-air (' + reason + '; bottom at y=' + Math.round(partBounds(p).min.y) + ' mm).');
    });

    // 3. deep overlaps (joined pairs get slack: housed joints legitimately interpenetrate)
    var joined = {};
    (d.joints || []).forEach(function (j) {
      if (j.parts && j.parts.length >= 2) {
        joined[j.parts[0] + '|' + j.parts[1]] = j.type;
        joined[j.parts[1] + '|' + j.parts[0]] = j.type;
      }
    });
    var HOUSED = { dado: 1, groove: 1, rabbet: 1, lap: 1, mortise_tenon: 1, dovetail: 1, miter: 1 };
    for (i = 0; i < parts.length; i++) {
      for (k = i + 1; k < parts.length; k++) {
        var a = parts[i], b = parts[k];
        if (isRotated(a) || isRotated(b)) continue;
        var jt = joined[a.id + '|' + b.id];
        if (jt && HOUSED[jt]) continue;      // housed joints (incl. through-tenons) interpenetrate by design
        var allow = jt ? 45 : 6;             // joined parts model their joinery as overlap — give them slack
        var ba = partBounds(a), bb = partBounds(b);
        var pen = 1e9, over = true, ovol = 1;
        ['x', 'y', 'z'].forEach(function (ax) {
          var o = Math.min(ba.max[ax], bb.max[ax]) - Math.max(ba.min[ax], bb.min[ax]);
          if (o <= 0) over = false; else { pen = Math.min(pen, o); ovol *= o; }
        });
        if (!over) continue;
        if (pen > allow) {
          overlapIssues.push('Parts "' + a.id + '" and "' + b.id + '" overlap by ~' + Math.round(pen) + ' mm.' +
            (jt ? ' Separate them, or model a housed joint (dado/rabbet/lap) with a matching cutout prep operation.'
                : ' If this is intended joinery, add a joint entry between them instead of moving parts.'));
        } else if (jt && ovol > 0.75 * Math.min(partVolume(a), partVolume(b))) {
          var inner = partVolume(a) < partVolume(b) ? a : b;
          var outer = inner === a ? b : a;
          issues.push('Part "' + inner.id + '" is almost entirely buried inside "' + outer.id + '" — it is redundant or misplaced.');
        }
      }
    }

    // 4. fastener joints but no hardware to buy
    var FASTENED = { screw: 1, bolt: 1, nail: 1, bracket: 1, hinge: 1, dowel: 1, biscuit: 1, domino: 1, pocket_hole: 1 };
    if ((!d.hardware || !d.hardware.length) && (d.joints || []).some(function (j) { return FASTENED[j.type]; })) {
      issues.push('The hardware list is empty although the design uses fasteners — add every screw/bolt/fitting with quantity and size.');
    }

    // 5. assembly step sanity (fixable via set_assembly)
    var steps = d.assembly || [];
    var np = parts.length;
    if (np >= 6 && steps.length && steps.length < 3) {
      issues.push('Only ' + steps.length + ' assembly step(s) for ' + np + ' parts — replace the assembly (set_assembly) with 5-10 ordered steps, each adding a small connected group of parts.');
    }
    steps.forEach(function (s) {
      if (np >= 6 && s.parts && s.parts.length > np * 0.6) {
        issues.push('Assembly step ' + s.step + ' ("' + s.title + '") adds ' + s.parts.length + ' of ' + np + ' parts at once — split it into logical stages (set_assembly).');
      }
    });
    // Buildability: every part added after step 1 must rest on the floor or
    // touch something already assembled.
    if (steps.length > 1) {
      var placed = {}, buildIssues = 0;
      (steps[0].parts || []).forEach(function (pid) { placed[pid] = true; });
      for (var si = 1; si < steps.length; si++) {
        (steps[si].parts || []).forEach(function (pid) {
          var p = byId[pid];
          if (p && !isRotated(p)) {
            var connected = partBounds(p).min.y <= 2;
            if (!connected) (adj[pid] || []).forEach(function (nid) { if (placed[nid]) connected = true; });
            if (!connected && buildIssues < 3) {
              issues.push('Assembly step ' + steps[si].step + ' adds "' + pid + '" but it touches nothing assembled in earlier steps — reorder the steps or fix its position.');
              buildIssues++;
            }
          }
          placed[pid] = true;
        });
      }
    }

    // Overlaps last: structural problems (floating/buried/hardware) matter more
    // and must survive the cap.
    return issues.concat(overlapIssues).slice(0, 12);
  }

  /* Deterministic fix for joints whose parts do not touch: keep the first part
   * and reattach the joint to the touching part nearest the joint position
   * (also tries the reverse). Hinges are never retargeted. Mutates design.
   * Returns { fixed: [{id, to}], remaining: [jointId...] }. */
  function retargetJoints(d, notouchIds) {
    var byId = {};
    (d.parts || []).forEach(function (p) { byId[p.id] = p; });

    function contactCenter(a, c, ref) {
      // Overlap region (25 mm margin) between a and c; null if they don't touch.
      var ba = partBounds(a), bc = partBounds(c), center = {}, ok = true;
      ['x', 'y', 'z'].forEach(function (ax) {
        var lo = Math.max(ba.min[ax], bc.min[ax]) - 25;
        var hi = Math.min(ba.max[ax], bc.max[ax]) + 25;
        if (lo > hi) ok = false; else center[ax] = (lo + hi) / 2;
      });
      if (!ok) return null;
      var dx = center.x - ref.x, dy = center.y - ref.y, dz = center.z - ref.z;
      return { center: center, dist: dx * dx + dy * dy + dz * dz };
    }

    function bestPartner(keep, excludeId, ref) {
      var best = null;
      (d.parts || []).forEach(function (c) {
        if (c.id === keep.id || c.id === excludeId) return;
        if (isRotated(c)) return; // loose bounds of rotated parts phantom-touch everything
        var cc = contactCenter(keep, c, ref);
        if (cc && (!best || cc.dist < best.dist)) best = { id: c.id, center: cc.center, dist: cc.dist };
      });
      return best;
    }

    var fixed = [], remaining = [];
    (notouchIds || []).forEach(function (jid) {
      var j = (d.joints || []).find(function (x) { return x.id === jid; });
      if (!j || j.type === 'hinge' || !j.parts || j.parts.length !== 2) { remaining.push(jid); return; }
      var a = byId[j.parts[0]], b = byId[j.parts[1]];
      if (!a || !b) { remaining.push(jid); return; }
      var ref = j.position || a.position;
      var cand = bestPartner(a, b.id, ref);
      if (cand) {
        j.parts = [a.id, cand.id];
      } else {
        cand = bestPartner(b, a.id, ref);
        if (cand) j.parts = [b.id, cand.id];
      }
      if (cand) {
        j.position = cand.center;
        fixed.push({ id: jid, to: cand.id });
      } else {
        remaining.push(jid);
      }
    });
    return { fixed: fixed, remaining: remaining };
  }

  /* ---------- patch application (diff-based AI edits) ----------
   * Applies part-level ops to a deep copy of the design. The result must still
   * be run through validate(). Returns { design, notes[] }. */
  function applyPatch(base, ops) {
    var d = JSON.parse(JSON.stringify(base));
    d.joints = d.joints || []; d.hardware = d.hardware || [];
    d.assembly = d.assembly || []; d.finishing = d.finishing || [];
    var notes = [];

    function merge(target, src) {
      if (!src || typeof src !== 'object') return;
      Object.keys(src).forEach(function (k) { target[k] = src[k]; });
    }
    function mergePart(p, set) {
      if (!set) return;
      Object.keys(set).forEach(function (k) {
        var nested = (k === 'dimensions' || k === 'position' || k === 'rotation' || k === 'material');
        if (nested && set[k] && typeof set[k] === 'object' && p[k] && typeof p[k] === 'object') merge(p[k], set[k]);
        else p[k] = set[k];
      });
    }
    function findPart(id) { return d.parts.find(function (p) { return p.id === id; }); }

    (Array.isArray(ops) ? ops : []).forEach(function (o) {
      if (!o || !o.op) return;
      switch (o.op) {
        case 'update_meta':
          merge(d.meta, o.set);
          break;
        case 'add_part':
          if (o.part) d.parts.push(o.part);
          break;
        case 'remove_part':
          d.parts = d.parts.filter(function (p) { return p.id !== o.id; });
          d.joints = d.joints.filter(function (j) { return (j.parts || []).indexOf(o.id) < 0; });
          d.assembly.forEach(function (s) { s.parts = (s.parts || []).filter(function (x) { return x !== o.id; }); });
          break;
        case 'update_part':
          var p = findPart(o.id);
          if (p) mergePart(p, o.set);
          else notes.push('patch: unknown part "' + o.id + '"');
          break;
        case 'add_joint':
          if (o.joint) d.joints.push(o.joint);
          break;
        case 'update_joint':
          var j = d.joints.find(function (x) { return x.id === o.id; });
          if (j) merge(j, o.set);
          else notes.push('patch: unknown joint "' + o.id + '"');
          break;
        case 'remove_joint':
          d.joints = d.joints.filter(function (x) { return x.id !== o.id; });
          d.assembly.forEach(function (s) { if (s.joints) s.joints = s.joints.filter(function (x) { return x !== o.id; }); });
          break;
        case 'set_hardware': d.hardware = Array.isArray(o.hardware) ? o.hardware : []; break;
        case 'set_assembly': d.assembly = Array.isArray(o.assembly) ? o.assembly : []; break;
        case 'set_finishing': d.finishing = Array.isArray(o.finishing) ? o.finishing : []; break;
        default: notes.push('patch: unknown op "' + o.op + '"');
      }
    });
    return { design: d, notes: notes };
  }

  /* ---------- JSON Schema of the response envelope (for response_format json_schema) ----------
   * All object properties are declared explicitly because some servers (llama.cpp)
   * compile schemas to grammars that disallow undeclared keys. */
  var J_VEC = { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' } }, required: ['x', 'y', 'z'] };
  var J_MATERIAL = { type: 'object', properties: {
    species: { type: 'string' }, color: { type: ['string', 'null'] },
    finish: { enum: ['raw', 'painted', 'stained', 'varnished'] },
    shine: { type: 'number' }, grainDirection: { enum: ['x', 'y', 'z'] }
  } };
  var J_PREP = { type: 'object', properties: {
    operations: { type: 'array', items: { type: 'object', properties: {
      type: { type: 'string' }, instruction: { type: 'string' } }, required: ['type', 'instruction'] } },
    notes: { type: 'string' }
  } };
  var J_PART_PROPS = {
    id: { type: 'string' }, name: { type: 'string' }, shape: { enum: ['box', 'cylinder'] },
    dimensions: { type: 'object', properties: { x: { type: 'number' }, y: { type: 'number' }, z: { type: 'number' }, radius: { type: 'number' }, height: { type: 'number' } } },
    position: J_VEC, rotation: J_VEC, material: J_MATERIAL, stock: { type: 'string' }, prep: J_PREP
  };
  var J_PART = { type: 'object', properties: J_PART_PROPS, required: ['id', 'name', 'shape', 'dimensions', 'position'] };
  var J_PART_SET = { type: 'object', properties: J_PART_PROPS };
  var J_JOINT = { type: 'object', properties: {
    id: { type: 'string' }, type: { enum: JOINT_TYPES },
    parts: { type: 'array', items: { type: 'string' } }, position: J_VEC, note: { type: 'string' }
  }, required: ['id', 'type', 'parts'] };
  var J_HARDWARE = { type: 'object', properties: { name: { type: 'string' }, quantity: { type: 'integer' }, note: { type: 'string' } }, required: ['name', 'quantity'] };
  var J_STEP = { type: 'object', properties: {
    step: { type: 'integer' }, title: { type: 'string' }, instruction: { type: 'string' },
    parts: { type: 'array', items: { type: 'string' } }, joints: { type: 'array', items: { type: 'string' } }
  }, required: ['step', 'title', 'instruction', 'parts'] };
  var J_FINISH = { type: 'object', properties: {
    step: { type: 'integer' }, title: { type: 'string' }, instruction: { type: 'string' },
    parts: { type: 'array', items: { type: 'string' } }
  }, required: ['step', 'title', 'instruction'] };
  var J_DESIGN = { type: 'object', properties: {
    meta: { type: 'object', properties: { name: { type: 'string' }, description: { type: 'string' }, units: { type: 'string' } }, required: ['name'] },
    parts: { type: 'array', items: J_PART },
    joints: { type: 'array', items: J_JOINT },
    hardware: { type: 'array', items: J_HARDWARE },
    assembly: { type: 'array', items: J_STEP },
    finishing: { type: 'array', items: J_FINISH }
  }, required: ['meta', 'parts', 'assembly'] };
  var J_OP = { type: 'object', properties: {
    op: { enum: ['update_meta', 'add_part', 'remove_part', 'update_part', 'add_joint', 'update_joint', 'remove_joint', 'set_hardware', 'set_assembly', 'set_finishing'] },
    id: { type: 'string' }, set: J_PART_SET, part: J_PART, joint: J_JOINT,
    hardware: { type: 'array', items: J_HARDWARE },
    assembly: { type: 'array', items: J_STEP },
    finishing: { type: 'array', items: J_FINISH }
  }, required: ['op'] };
  var ENVELOPE_SCHEMA = { anyOf: [
    { type: 'object', properties: { type: { enum: ['design'] }, scope: { enum: ['new', 'modify'] }, summary: { type: 'string' }, design: J_DESIGN }, required: ['type', 'design'] },
    { type: 'object', properties: { type: { enum: ['patch'] }, summary: { type: 'string' }, ops: { type: 'array', items: J_OP } }, required: ['type', 'ops'] },
    { type: 'object', properties: { type: { enum: ['clarify'] }, message: { type: 'string' }, questions: { type: 'array', items: { type: 'string' } } }, required: ['type', 'questions'] },
    { type: 'object', properties: { type: { enum: ['chat'] }, message: { type: 'string' } }, required: ['type', 'message'] }
  ] };

  window.Schema = {
    VERSION: SCHEMA_VERSION,
    DOC: SCHEMA_DOC,
    JOINT_TYPES: JOINT_TYPES,
    ENVELOPE: ENVELOPE_SCHEMA,
    validate: validate,
    applyPatch: applyPatch,
    snapDesign: snapDesign,
    lintDesign: lintDesign,
    retargetJoints: retargetJoints,
    cutList: cutList,
    dimsLabel: dimsLabel,
    auditJoints: auditJoints,
    sampleBed: sampleBed
  };
})();
