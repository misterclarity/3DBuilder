/* materials.js — procedural wood-grain textures and material application. Exposes window.Materials. */
(function () {
  'use strict';

  var SPECIES = {
    pine:     { base: '#d9b380', dark: '#b3854e', rings: 14 },
    spruce:   { base: '#e3c496', dark: '#c09a62', rings: 12 },
    oak:      { base: '#c49a6c', dark: '#8f6844', rings: 20 },
    beech:    { base: '#d7a97f', dark: '#b07f52', rings: 16 },
    birch:    { base: '#e8d3ae', dark: '#c4a878', rings: 10 },
    walnut:   { base: '#6b4a2f', dark: '#452c18', rings: 22 },
    mahogany: { base: '#7e3b26', dark: '#571f10', rings: 18 },
    plywood:  { base: '#dec294', dark: '#c2a370', rings: 6 },
    mdf:      { base: '#c8b08a', dark: '#b89f7c', rings: 0 },
    metal:    { base: '#9aa2ab', dark: '#7b838c', rings: 0 },
    larch:    { base: '#c99a66', dark: '#9a6f42', rings: 16 },
    soil:     { base: '#4a3b2c', dark: '#38291c', rings: 0 }
  };

  var texCache = {};

  function grainTexture(speciesKey) {
    var key = speciesKey in SPECIES ? speciesKey : 'pine';
    if (texCache[key]) return texCache[key];
    var sp = SPECIES[key];
    var c = document.createElement('canvas');
    c.width = 256; c.height = 256;
    var ctx = c.getContext('2d');
    ctx.fillStyle = sp.base;
    ctx.fillRect(0, 0, 256, 256);
    if (sp.rings > 0) {
      // Long wavy grain lines along Y of the canvas.
      for (var i = 0; i < sp.rings; i++) {
        var x = (i + 0.5) * (256 / sp.rings) + rnd(i) * 6;
        ctx.strokeStyle = sp.dark;
        ctx.globalAlpha = 0.18 + 0.2 * Math.abs(rnd(i * 3));
        ctx.lineWidth = 1 + Math.abs(rnd(i * 7)) * 2.2;
        ctx.beginPath();
        ctx.moveTo(x, -10);
        for (var y = 0; y <= 256; y += 16) {
          ctx.lineTo(x + Math.sin(y * 0.02 + i * 2.1) * 4 + rnd(i * 11 + y) * 2, y);
        }
        ctx.stroke();
      }
      // A few knots.
      ctx.globalAlpha = 0.25;
      for (var k = 0; k < 2; k++) {
        var kx = 40 + Math.abs(rnd(key.length * 13 + k * 31)) * 180;
        var ky = 40 + Math.abs(rnd(k * 57 + 5)) * 180;
        var g = ctx.createRadialGradient(kx, ky, 1, kx, ky, 12);
        g.addColorStop(0, sp.dark);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(kx, ky, 12, 0, Math.PI * 2); ctx.fill();
      }
      ctx.globalAlpha = 1;
    }
    var url = c.toDataURL('image/png');
    texCache[key] = url;
    return url;
  }

  // Deterministic pseudo-random in [-1, 1].
  function rnd(n) { var x = Math.sin(n * 127.1 + 311.7) * 43758.5453; return (x - Math.floor(x)) * 2 - 1; }

  // Compute A-Frame material attribute value for a part.
  function materialFor(part) {
    var m = part.material || {};
    var speciesKey = (m.species || 'pine').toLowerCase();
    if (!(speciesKey in SPECIES)) speciesKey = /ply/.test(speciesKey) ? 'plywood' : (/metal|steel|alu/.test(speciesKey) ? 'metal' : 'pine');
    var shine = typeof m.shine === 'number' ? m.shine : 0.15;
    var attrs = {
      shader: 'standard',
      roughness: Math.max(0.05, 1 - shine * 0.9),
      metalness: speciesKey === 'metal' ? 0.7 : 0.0
    };
    if (m.color && m.finish === 'painted') {
      attrs.color = m.color;               // paint hides grain
    } else {
      attrs.src = grainTexture(speciesKey);
      attrs.color = (m.color && m.finish === 'stained') ? m.color : '#ffffff'; // stain tints grain
      // Repeat grain along the part's grain direction.
      var rep = grainRepeat(part);
      attrs.repeat = rep.x + ' ' + rep.y;
    }
    return attrs;
  }

  function grainRepeat(part) {
    if (part.shape !== 'box') return { x: 1, y: 1 };
    var d = part.dimensions;
    var g = (part.material && part.material.grainDirection) || 'x';
    var along = d[g] || 100;
    return { x: 1, y: Math.max(1, Math.round(along / 250)) };
  }

  // Grain direction → rotate texture by aligning: we rely on repeat + geometry UVs; good enough visually.

  var STAIN_PRESETS = [
    { name: 'Natural (clear)', color: null, finish: 'varnished', shine: 0.45 },
    { name: 'Golden oak', color: '#c68a3f', finish: 'stained', shine: 0.3 },
    { name: 'Teak', color: '#a5692e', finish: 'stained', shine: 0.35 },
    { name: 'Walnut', color: '#5d3a1e', finish: 'stained', shine: 0.3 },
    { name: 'Mahogany', color: '#6e2f1a', finish: 'stained', shine: 0.4 },
    { name: 'Ebony', color: '#2b2018', finish: 'stained', shine: 0.35 },
    { name: 'White wash', color: '#e9e4da', finish: 'stained', shine: 0.2 }
  ];

  function baseColor(species) {
    var key = (species || 'pine').toLowerCase();
    if (!(key in SPECIES)) key = /ply/.test(key) ? 'plywood' : (/metal|steel|alu/.test(key) ? 'metal' : 'pine');
    return SPECIES[key].base;
  }

  window.Materials = {
    SPECIES: Object.keys(SPECIES),
    STAIN_PRESETS: STAIN_PRESETS,
    materialFor: materialFor,
    grainTexture: grainTexture,
    baseColor: baseColor
  };
})();
