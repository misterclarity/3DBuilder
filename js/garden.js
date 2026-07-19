/* garden.js — gardening module data: sample vegetable garden design (localized EN/DE),
 * species emoji lookup and German display names for species keys.
 * Species keys stay lowercase English everywhere (matching keys for companions/avoid
 * and emoji); only their DISPLAY is translated. Plain script. Exposes window.Garden.
 */
(function () {
  'use strict';

  // species keyword → emoji (first match wins; fall back to habit, then 🌱)
  var SPECIES_EMOJI = [
    ['tomato', '🍅'], ['carrot', '🥕'], ['lettuce', '🥬'], ['salad', '🥬'], ['cabbage', '🥬'],
    ['kale', '🥬'], ['spinach', '🥬'], ['chard', '🥬'], ['onion', '🧅'], ['garlic', '🧄'],
    ['leek', '🧅'], ['cucumber', '🥒'], ['zucchini', '🥒'], ['courgette', '🥒'],
    ['pepper', '🫑'], ['chili', '🌶️'], ['potato', '🥔'], ['strawberr', '🍓'], ['corn', '🌽'],
    ['maize', '🌽'], ['broccoli', '🥦'], ['cauliflower', '🥦'], ['eggplant', '🍆'], ['aubergine', '🍆'],
    ['pumpkin', '🎃'], ['squash', '🎃'], ['melon', '🍈'], ['watermelon', '🍉'],
    ['pea', '🫛'], ['bean', '🫘'], ['radish', '🌶'], ['beet', '🫜'],
    ['sunflower', '🌻'], ['rose', '🌹'], ['tulip', '🌷'], ['lavender', '💜'],
    ['apple', '🍎'], ['pear', '🍐'], ['cherry', '🍒'], ['peach', '🍑'], ['lemon', '🍋'],
    ['grape', '🍇'], ['blueberr', '🫐'], ['raspberr', '🍒'],
    ['basil', '🌿'], ['parsley', '🌿'], ['mint', '🌿'], ['thyme', '🌿'], ['rosemary', '🌿'],
    ['sage', '🌿'], ['oregano', '🌿'], ['dill', '🌿'], ['chive', '🌿'], ['coriander', '🌿'], ['cilantro', '🌿']
  ];
  var HABIT_EMOJI = {
    leafy: '🥬', bushy: '🌱', vining: '🌿', climbing: '🌿', root: '🥕',
    herb: '🌿', flower: '🌸', shrub: '🌳', tree: '🌳', grass: '🌾'
  };

  function emojiFor(species, habit) {
    var s = String(species || '').toLowerCase();
    for (var i = 0; i < SPECIES_EMOJI.length; i++) {
      if (s.indexOf(SPECIES_EMOJI[i][0]) >= 0) return SPECIES_EMOJI[i][1];
    }
    return HABIT_EMOJI[habit] || '🌱';
  }

  // German display names for English species keys (used in tabs, cards, print).
  var SPECIES_DE = {
    tomato: 'Tomate', basil: 'Basilikum', onion: 'Zwiebel', garlic: 'Knoblauch', leek: 'Lauch',
    lettuce: 'Salat', carrot: 'Karotte', potato: 'Kartoffel', cucumber: 'Gurke', zucchini: 'Zucchini',
    courgette: 'Zucchini', pepper: 'Paprika', chili: 'Chili', bean: 'Bohne', beans: 'Bohnen',
    pea: 'Erbse', peas: 'Erbsen', spinach: 'Spinat', kale: 'Grünkohl', cabbage: 'Kohl',
    cauliflower: 'Blumenkohl', broccoli: 'Brokkoli', radish: 'Radieschen', beet: 'Rote Bete',
    beetroot: 'Rote Bete', chard: 'Mangold', celery: 'Sellerie', parsley: 'Petersilie',
    dill: 'Dill', mint: 'Minze', thyme: 'Thymian', rosemary: 'Rosmarin', sage: 'Salbei',
    oregano: 'Oregano', chive: 'Schnittlauch', chives: 'Schnittlauch', coriander: 'Koriander',
    cilantro: 'Koriander', strawberry: 'Erdbeere', fennel: 'Fenchel', corn: 'Mais', maize: 'Mais',
    pumpkin: 'Kürbis', squash: 'Kürbis', eggplant: 'Aubergine', aubergine: 'Aubergine',
    melon: 'Melone', watermelon: 'Wassermelone', sunflower: 'Sonnenblume', rue: 'Weinraute',
    parsnip: 'Pastinake', lavender: 'Lavendel', rose: 'Rose', tulip: 'Tulpe',
    apple: 'Apfel', pear: 'Birne', cherry: 'Kirsche', peach: 'Pfirsich', lemon: 'Zitrone',
    grape: 'Weinrebe', blueberry: 'Heidelbeere', raspberry: 'Himbeere'
  };

  function speciesLabel(species) {
    var lang = window.I18n ? I18n.getLang() : 'en';
    if (lang !== 'de') return species;
    var fromDb = window.PlantDB ? PlantDB.labelFor(species, 'de') : null;
    return fromDb || SPECIES_DE[String(species || '').toLowerCase().trim()] || species;
  }

  /* Care for display: the plant's own text wins per field; empty fields are
   * filled from the plant catalog in the current UI language. */
  function resolveCare(plant) {
    var lang = window.I18n ? I18n.getLang() : 'en';
    var cat = window.PlantDB ? PlantDB.careFor(plant.species, lang) : null;
    var out = {};
    ['sun', 'water', 'soil', 'planting', 'harvest', 'notes'].forEach(function (f) {
      out[f] = (plant.care && plant.care[f]) || (cat ? cat[f] : '');
    });
    return out;
  }

  /* ---------- Sample design: basic vegetable garden (raised bed 2000×1000) ----------
   * All human-readable text is generated in the current UI language; species keys,
   * ids and enum values stay English. */
  function sampleGarden() {
    var de = !!(window.I18n && I18n.getLang() === 'de');
    function L(en, deTxt) { return de ? deTxt : en; }

    var parts = [], joints = [], plants = [];
    var L_BED = 2000, W = 1000, T = 28, BH = 140;  // bed outer size, board thickness/height
    var POST = 45, SOIL_TOP = 240;
    var endLen = W - 2 * T;                        // 944

    function box(id, name, dx, dy, dz, px, py, pz, opts) {
      opts = opts || {};
      parts.push({
        id: id, name: name, shape: 'box',
        dimensions: { x: dx, y: dy, z: dz },
        position: { x: px, y: py, z: pz },
        material: { species: opts.species || 'larch', finish: 'raw', shine: 0.1, grainDirection: opts.grain },
        stock: opts.stock || '',
        prep: { operations: opts.ops || [{ type: 'cut', instruction: L('Cut to ', 'Zuschneiden auf ') + dx + ' × ' + dy + ' × ' + dz + ' mm.' }] }
      });
    }

    // Corner posts, inside the walls (left = -x, front = +z)
    [['post_front_left', -1, 1, L('front left', 'vorne links')],
     ['post_front_right', 1, 1, L('front right', 'vorne rechts')],
     ['post_back_left', -1, -1, L('back left', 'hinten links')],
     ['post_back_right', 1, -1, L('back right', 'hinten rechts')]]
      .forEach(function (c) {
        box(c[0], L('Corner post (', 'Eckpfosten (') + c[3] + ')', POST, 2 * BH, POST,
          c[1] * (L_BED / 2 - T - POST / 2), BH, c[2] * (W / 2 - T - POST / 2),
          { stock: 'Batten 45x45mm', ops: [
            { type: 'cut', instruction: L('Cut 45x45 batten to ' + (2 * BH) + ' mm length.', 'Kantholz 45x45 auf ' + (2 * BH) + ' mm ablängen.') },
            { type: 'sand', instruction: L('Break the edges; the post stays inside the bed.', 'Kanten brechen; der Pfosten sitzt innen im Beet.') }
          ]});
      });

    // Long walls (front/back), two boards stacked
    [['front', 1, L('front', 'vorne')], ['back', -1, L('back', 'hinten')]].forEach(function (c) {
      [['low', L('low', 'unten')], ['high', L('high', 'oben')]].forEach(function (lvl, li) {
        box('side_' + c[0] + '_' + lvl[0], L('Side board (', 'Seitenbrett (') + c[2] + ', ' + lvl[1] + ')', L_BED, BH, T,
          0, BH / 2 + li * BH, c[1] * (W / 2 - T / 2),
          { grain: 'x', stock: 'Board 28x140mm', ops: [
            { type: 'cut', instruction: L('Cut 28x140 board to ' + L_BED + ' mm length.', 'Brett 28x140 auf ' + L_BED + ' mm ablängen.') },
            { type: 'drill', instruction: L('Pre-drill two 4 mm holes at each end, aligned with the corner posts.', 'An beiden Enden je zwei 4-mm-Löcher vorbohren, passend zu den Eckpfosten.') }
          ]});
      });
    });

    // End walls (left/right), two boards stacked between the long walls
    [['left', -1, L('left', 'links')], ['right', 1, L('right', 'rechts')]].forEach(function (c) {
      [['low', L('low', 'unten')], ['high', L('high', 'oben')]].forEach(function (lvl, li) {
        box('end_' + c[0] + '_' + lvl[0], L('End board (', 'Stirnbrett (') + c[2] + ', ' + lvl[1] + ')', T, BH, endLen,
          c[1] * (L_BED / 2 - T / 2), BH / 2 + li * BH, 0,
          { grain: 'z', stock: 'Board 28x140mm', ops: [
            { type: 'cut', instruction: L('Cut 28x140 board to ' + endLen + ' mm length.', 'Brett 28x140 auf ' + endLen + ' mm ablängen.') },
            { type: 'drill', instruction: L('Pre-drill two 4 mm holes at each end, aligned with the corner posts.', 'An beiden Enden je zwei 4-mm-Löcher vorbohren, passend zu den Eckpfosten.') }
          ]});
      });
    });

    // Soil fill (soil conforms around the posts — overlap is intended)
    box('soil', L('Soil fill', 'Erdfüllung'), L_BED - 2 * T, SOIL_TOP, endLen, 0, SOIL_TOP / 2, 0,
      { species: 'soil', stock: L('topsoil/compost mix (60/40)', 'Mutterboden-Kompost-Gemisch (60/40)'), ops: [
        { type: 'fill', instruction: L(
          'Fill the bed with a 60/40 topsoil-compost mix up to 40 mm below the rim (' + SOIL_TOP + ' mm), water well and let it settle for a few days.',
          'Das Beet mit einem 60/40-Gemisch aus Mutterboden und Kompost bis 40 mm unter den Rand füllen (' + SOIL_TOP + ' mm), gut wässern und einige Tage setzen lassen.') }
      ]});

    // Screws: each corner fixes the long wall and the end wall to the post
    var noteSide = L('4x wood screw 4x60mm (2 per board) through the side boards into the post',
      '4x Holzschraube 4x60mm (2 pro Brett) durch die Seitenbretter in den Pfosten');
    var noteEnd = L('4x wood screw 4x60mm (2 per board) through the end boards into the post',
      '4x Holzschraube 4x60mm (2 pro Brett) durch die Stirnbretter in den Pfosten');
    [['fl', 'front', 'left', -1, 1], ['fr', 'front', 'right', 1, 1], ['bl', 'back', 'left', -1, -1], ['br', 'back', 'right', 1, -1]]
      .forEach(function (c) {
        var post = 'post_' + c[1] + '_' + c[2];
        var px = c[3] * (L_BED / 2 - T - POST / 2), pz = c[4] * (W / 2 - T - POST / 2);
        joints.push({ id: 'j_' + c[0] + '_side', type: 'screw', parts: ['side_' + c[1] + '_low', post],
          position: { x: px, y: BH, z: c[4] * (W / 2 - T) }, note: noteSide });
        joints.push({ id: 'j_' + c[0] + '_end', type: 'screw', parts: ['end_' + c[2] + '_low', post],
          position: { x: c[3] * (L_BED / 2 - T), y: BH, z: pz }, note: noteEnd });
      });

    // Plants: 3 rows on the soil surface (y = SOIL_TOP), spacing rules respected.
    // Care, companions and avoid come from the plant catalog (PlantDB) in the
    // UI language at display time — nothing is baked into the design.
    function plant(id, name, species, habit, x, z, h, dia, spacing, color) {
      plants.push({ id: id, name: name, species: species, habit: habit,
        position: { x: x, y: SOIL_TOP, z: z },
        matureHeight: h, matureDiameter: dia, spacing: spacing,
        color: color || null, care: {}, companions: [], avoid: [] });
    }

    var nTomato = L('Tomato', 'Tomate'), nBasil = L('Basil', 'Basilikum'), nOnion = L('Onion', 'Zwiebel'),
        nLettuce = L('Lettuce', 'Salat'), nCarrot = L('Carrot', 'Karotte');

    // back row: tomatoes · middle: basil + onions · front: lettuce + carrots
    [-600, 0, 600].forEach(function (x, i) {
      plant('tomato_' + (i + 1), nTomato + ' ' + (i + 1), 'tomato', 'bushy', x, -300, 1500, 500, 500, '#e05c3a');
    });
    [-300, 300].forEach(function (x, i) {
      plant('basil_' + (i + 1), nBasil + ' ' + (i + 1), 'basil', 'herb', x, 60, 350, 250, 250);
    });
    [-750, -650, -550].forEach(function (x, i) {
      plant('onion_' + (i + 1), nOnion + ' ' + (i + 1), 'onion', 'root', x, 60, 300, 100, 100);
    });
    [-700, -450, -200].forEach(function (x, i) {
      plant('lettuce_' + (i + 1), nLettuce + ' ' + (i + 1), 'lettuce', 'leafy', x, 330, 200, 250, 250, '#7cb342');
    });
    for (var i = 0; i < 6; i++) {
      plant('carrot_' + (i + 1), nCarrot + ' ' + (i + 1), 'carrot', 'root', 200 + i * 100, 330, 250, 80, 75);
    }

    return validateSample({
      meta: {
        name: L('Vegetable garden bed (2000×1000)', 'Gemüse-Hochbeet (2000×1000)'),
        description: L(
          'Raised vegetable bed in untreated larch with a classic companion layout: tomatoes with basil, onions guarding the carrot rows, lettuce in the shaded front row.',
          'Hochbeet aus unbehandelter Lärche mit klassischer Mischkultur: Tomaten mit Basilikum, Zwiebeln schützen die Karottenreihen, Salat in der halbschattigen vorderen Reihe.'),
        units: 'mm', mode: 'garden'
      },
      parts: parts,
      plants: plants,
      joints: joints,
      hardware: [
        { name: L('Wood screw 4x60mm', 'Holzschraube 4x60mm'), quantity: 32, note: L('Walls to corner posts', 'Wände an die Eckpfosten') },
        { name: L('Root barrier / hardware cloth 2x1m', 'Wühlmausgitter / Drahtgeflecht 2x1m'), quantity: 1, note: L('Line the bed base against voles (optional)', 'Beetboden gegen Wühlmäuse auslegen (optional)') }
      ],
      assembly: [
        { step: 1,
          title: L('Corner posts & end walls', 'Eckpfosten & Stirnwände'),
          instruction: L(
            'Stand the four 45x45 posts up and screw the stacked end boards to them (2 screws per board end) so you get two H-shaped end frames, boards flush with the post tops.',
            'Die vier 45x45-Pfosten aufstellen und die übereinanderliegenden Stirnbretter anschrauben (2 Schrauben pro Brettende), sodass zwei H-förmige Stirnrahmen entstehen; Bretter bündig mit den Pfostenoberkanten.'),
          parts: ['post_front_left', 'post_front_right', 'post_back_left', 'post_back_right', 'end_left_low', 'end_left_high', 'end_right_low', 'end_right_high'],
          joints: ['j_fl_end', 'j_fr_end', 'j_bl_end', 'j_br_end'] },
        { step: 2,
          title: L('Long walls', 'Längswände'),
          instruction: L(
            'Connect the two end frames with the four 2000 mm side boards, screwing each board end into the corner posts. Check the diagonals for square before the final screws.',
            'Die beiden Stirnrahmen mit den vier 2000-mm-Seitenbrettern verbinden, jedes Brettende in die Eckpfosten schrauben. Vor den letzten Schrauben die Diagonalen auf Rechtwinkligkeit prüfen.'),
          parts: ['side_front_low', 'side_front_high', 'side_back_low', 'side_back_high'],
          joints: ['j_fl_side', 'j_fr_side', 'j_bl_side', 'j_br_side'] },
        { step: 3,
          title: L('Fill with soil', 'Mit Erde befüllen'),
          instruction: L(
            'Optionally staple hardware cloth to the base against voles, then fill with the topsoil/compost mix to 40 mm below the rim. Water and let it settle.',
            'Optional den Boden mit Wühlmausgitter austackern, dann mit dem Mutterboden-Kompost-Gemisch bis 40 mm unter den Rand füllen. Wässern und setzen lassen.'),
          parts: ['soil'], joints: [] },
        { step: 4,
          title: L('Plant the back & middle rows', 'Hintere & mittlere Reihe pflanzen'),
          instruction: L(
            'Plant the three tomatoes along the back edge (500 mm apart), the two basil plants in front of them, and push the onion sets into the middle left row.',
            'Die drei Tomaten entlang der Hinterkante pflanzen (Abstand 500 mm), die zwei Basilikumpflanzen davor setzen und die Steckzwiebeln in die mittlere linke Reihe stecken.'),
          parts: ['tomato_1', 'tomato_2', 'tomato_3', 'basil_1', 'basil_2', 'onion_1', 'onion_2', 'onion_3'], joints: [] },
        { step: 5,
          title: L('Sow the front row', 'Vordere Reihe säen'),
          instruction: L(
            'Set the lettuce seedlings in the front left row and sow the carrot row front right, 5–10 mm deep. Water everything in gently.',
            'Die Salat-Setzlinge in die vordere linke Reihe setzen und rechts davon die Karottenreihe 5–10 mm tief säen. Alles vorsichtig angießen.'),
          parts: ['lettuce_1', 'lettuce_2', 'lettuce_3', 'carrot_1', 'carrot_2', 'carrot_3', 'carrot_4', 'carrot_5', 'carrot_6'], joints: [] }
      ],
      finishing: [
        { step: 1,
          title: L('Weather protection (optional)', 'Wetterschutz (optional)'),
          instruction: L(
            'Untreated larch greys naturally. For a darker look, oil the OUTER faces with linseed oil — never treat the inner faces that touch the soil.',
            'Unbehandelte Lärche vergraut natürlich. Für einen dunkleren Ton die ÄUSSEREN Flächen mit Leinöl behandeln — niemals die Innenflächen mit Erdkontakt.'),
          parts: ['side_front_low', 'side_front_high', 'side_back_low', 'side_back_high', 'end_left_low', 'end_left_high', 'end_right_low', 'end_right_high'] }
      ]
    });
  }

  function validateSample(input) {
    var v = window.Schema.validate(input);
    if (window.Debug && v.warnings.length) Debug.log('warn', 'garden', 'sample garden warnings: ' + v.warnings.join(' | '));
    return v.design;
  }

  window.Garden = {
    sampleGarden: sampleGarden,
    emojiFor: emojiFor,
    speciesLabel: speciesLabel,
    resolveCare: resolveCare
  };
})();
