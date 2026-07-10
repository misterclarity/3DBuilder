/* export3d.js — self-contained OBJ + MTL export of a design (no external libs).
 * Boxes and cylinders are generated directly; rotation matches A-Frame (YXZ Euler, degrees).
 * Units: millimeters. Exposes window.Export3D.
 */
(function () {
  'use strict';

  var DEG = Math.PI / 180;

  function rotate(v, rot) {
    // YXZ order like A-Frame/THREE default for entities
    var rx = (rot.x || 0) * DEG, ry = (rot.y || 0) * DEG, rz = (rot.z || 0) * DEG;
    var x = v[0], y = v[1], z = v[2], c, s, t0, t1;
    // Z
    c = Math.cos(rz); s = Math.sin(rz);
    t0 = x * c - y * s; t1 = x * s + y * c; x = t0; y = t1;
    // X
    c = Math.cos(rx); s = Math.sin(rx);
    t0 = y * c - z * s; t1 = y * s + z * c; y = t0; z = t1;
    // Y
    c = Math.cos(ry); s = Math.sin(ry);
    t0 = z * s + x * c; t1 = z * c - x * s; x = t0; z = t1;
    return [x, y, z];
  }

  function hexToKd(hex) {
    var m = /^#?([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return '0.8 0.7 0.55';
    var n = parseInt(m[1], 16);
    return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]
      .map(function (v) { return v.toFixed(4); }).join(' ');
  }

  function boxGeom(d) {
    var x = d.x / 2, y = d.y / 2, z = d.z / 2;
    var v = [[-x,-y,-z],[x,-y,-z],[x,y,-z],[-x,y,-z],[-x,-y,z],[x,-y,z],[x,y,z],[-x,y,z]];
    var f = [[1,2,3,4],[8,7,6,5],[5,6,2,1],[4,3,7,8],[2,6,7,3],[5,1,4,8]];
    return { v: v, f: f };
  }

  function cylGeom(d) {
    var N = 20, v = [], top = [], bot = [];
    for (var i = 0; i < N; i++) {
      var a = i / N * Math.PI * 2;
      var cx = Math.cos(a) * d.radius, cz = Math.sin(a) * d.radius;
      v.push([cx, -d.height / 2, cz]); bot.push(i * 2 + 1);
      v.push([cx, d.height / 2, cz]);  top.push(i * 2 + 2);
    }
    var f = [];
    for (var j = 0; j < N; j++) {
      var k = (j + 1) % N;
      f.push([j * 2 + 1, k * 2 + 1, k * 2 + 2, j * 2 + 2]); // side quad
    }
    f.push(bot.slice().reverse());
    f.push(top);
    return { v: v, f: f };
  }

  function build(design) {
    var obj = ['# DIY Workshop export — ' + (design.meta.name || 'design'), 'mtllib design.mtl', ''];
    var mtl = ['# DIY Workshop materials', '', 'newmtl m_hole', 'Kd 0.08 0.09 0.10', 'Ns 10', 'd 1.0', ''];
    var base = 0;
    (design.parts || []).forEach(function (p) {
      var color = p.material.color || (window.Materials && Materials.baseColor ? Materials.baseColor(p.material.species) : '#d9b380');
      var shine = p.material.shine || 0.15;
      mtl.push('newmtl m_' + p.id, 'Kd ' + hexToKd(color), 'Ns ' + Math.round(10 + shine * 400), 'd 1.0', '');
      var g = p.shape === 'cylinder' ? cylGeom(p.dimensions) : boxGeom(p.dimensions);
      obj.push('o ' + p.id, 'usemtl m_' + p.id);
      g.v.forEach(function (vv) {
        var w = rotate(vv, p.rotation || {});
        obj.push('v ' + (w[0] + p.position.x).toFixed(2) + ' ' + (w[1] + p.position.y).toFixed(2) + ' ' + (w[2] + p.position.z).toFixed(2));
      });
      g.f.forEach(function (fc) {
        obj.push('f ' + fc.map(function (i) { return i + base; }).join(' '));
      });
      base += g.v.length;
      obj.push('');

      // Cutout markers: dark cylinders through the part (viewers without CSG
      // still show where the holes go; drill the real holes per the cut list).
      (p.cutouts || []).forEach(function (co, ci) {
        var g2 = cylGeom({ radius: co.diameter / 2, height: (p.dimensions[co.axis] || 10) + 1 });
        var pre = co.axis === 'x' ? { z: 90 } : (co.axis === 'z' ? { x: 90 } : {});
        obj.push('o ' + p.id + '_hole' + (ci + 1), 'usemtl m_hole');
        g2.v.forEach(function (vv) {
          var w = rotate(vv, pre);
          w = [w[0] + co.offset.x, w[1] + co.offset.y, w[2] + co.offset.z];
          w = rotate(w, p.rotation || {});
          obj.push('v ' + (w[0] + p.position.x).toFixed(2) + ' ' + (w[1] + p.position.y).toFixed(2) + ' ' + (w[2] + p.position.z).toFixed(2));
        });
        g2.f.forEach(function (fc) {
          obj.push('f ' + fc.map(function (i) { return i + base; }).join(' '));
        });
        base += g2.v.length;
        obj.push('');
      });
    });
    return { obj: obj.join('\n'), mtl: mtl.join('\n') };
  }

  function download(text, filename, mime) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: mime || 'text/plain' }));
    a.download = filename;
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function exportOBJ(design, name) {
    var files = build(design);
    var safe = (name || design.meta.name || 'design').replace(/[^\w\-]+/g, '_');
    // OBJ references design.mtl — keep that name stable so it links after download.
    download(files.obj, safe + '.obj', 'model/obj');
    setTimeout(function () { download(files.mtl, 'design.mtl', 'model/mtl'); }, 300);
  }

  window.Export3D = { exportOBJ: exportOBJ, build: build };
})();
