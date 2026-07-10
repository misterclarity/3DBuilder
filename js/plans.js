/* plans.js — 2D orthographic plans (front / side / top) with dimension lines,
 * exported as a multi-page PDF (jsPDF, lazy-loaded from cdnjs).
 * Page 1: dimensioned views. Following pages: cut list, hardware, stock
 * summary, assembly and finishing instructions. Exposes window.Plans.
 */
(function () {
  'use strict';

  var D2R = Math.PI / 180;
  var JSPDF_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js';

  function withJsPDF() {
    return new Promise(function (resolve, reject) {
      if (window.jspdf && window.jspdf.jsPDF) return resolve(window.jspdf.jsPDF);
      var s = document.createElement('script');
      s.src = JSPDF_URL;
      s.onload = function () {
        if (window.jspdf && window.jspdf.jsPDF) resolve(window.jspdf.jsPDF);
        else reject(new Error('jsPDF loaded but not found'));
      };
      s.onerror = function () { reject(new Error('could not load jsPDF (offline?)')); };
      document.head.appendChild(s);
    });
  }

  // ---------- geometry ----------
  function partCorners(p) {
    var hx, hy, hz;
    if (p.shape === 'cylinder') { hx = p.dimensions.radius; hy = p.dimensions.height / 2; hz = p.dimensions.radius; }
    else { hx = p.dimensions.x / 2; hy = p.dimensions.y / 2; hz = p.dimensions.z / 2; }
    var rot = p.rotation || {};
    var q = null;
    if ((rot.x || rot.y || rot.z) && window.THREE) {
      q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rot.x * D2R, rot.y * D2R, rot.z * D2R, 'YXZ'));
    }
    var out = [];
    [[-1, -1, -1], [1, -1, -1], [1, 1, -1], [-1, 1, -1], [-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]].forEach(function (sg) {
      var v = { x: sg[0] * hx, y: sg[1] * hy, z: sg[2] * hz };
      if (q) { var tv = new THREE.Vector3(v.x, v.y, v.z).applyQuaternion(q); v = { x: tv.x, y: tv.y, z: tv.z }; }
      out.push({ x: v.x + p.position.x, y: v.y + p.position.y, z: v.z + p.position.z });
    });
    return out;
  }

  // Andrew's monotone chain convex hull. pts: [[u,v],...] → hull [[u,v],...]
  function hull(pts) {
    pts = pts.slice().sort(function (a, b) { return a[0] - b[0] || a[1] - b[1]; });
    if (pts.length < 3) return pts;
    function cross(o, a, b) { return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]); }
    var lower = [], upper = [], i;
    for (i = 0; i < pts.length; i++) {
      while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], pts[i]) <= 0) lower.pop();
      lower.push(pts[i]);
    }
    for (i = pts.length - 1; i >= 0; i--) {
      while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], pts[i]) <= 0) upper.pop();
      upper.push(pts[i]);
    }
    lower.pop(); upper.pop();
    return lower.concat(upper);
  }

  function bbox(design) {
    var min = { x: 1e9, y: 1e9, z: 1e9 }, max = { x: -1e9, y: -1e9, z: -1e9 };
    design.parts.forEach(function (p) {
      partCorners(p).forEach(function (c) {
        ['x', 'y', 'z'].forEach(function (a) {
          if (c[a] < min[a]) min[a] = c[a];
          if (c[a] > max[a]) max[a] = c[a];
        });
      });
    });
    return { min: min, max: max };
  }

  /* One orthographic view. axes = {u, v, d} (axis names); parts sorted far→near.
   * Returns { polys: [{ pts:[[u,v],..], circle:{u,v,r}|null }], ... } */
  function projectView(design, axes) {
    var polys = design.parts.map(function (p) {
      var noRot = !(p.rotation && (p.rotation.x || p.rotation.y || p.rotation.z));
      // A plain vertical cylinder seen from the top is a circle.
      if (p.shape === 'cylinder' && noRot && axes.d === 'y') {
        return { depth: p.position.y, circle: { u: p.position[axes.u], v: p.position[axes.v], r: p.dimensions.radius } };
      }
      var pts2 = partCorners(p).map(function (c) { return [c[axes.u], c[axes.v]]; });
      return { depth: p.position[axes.d], pts: hull(pts2) };
    });
    polys.sort(function (a, b) { return a.depth - b.depth; }); // far first (viewer sits at +d)
    return polys;
  }

  // ---------- PDF drawing helpers ----------
  function drawView(doc, polys, opts) {
    // opts: { x, y, s, umin, vmin, vmax, flipV } — flipV true = v grows upward on paper
    function U(u) { return opts.x + (u - opts.umin) * opts.s; }
    function V(v) { return opts.flipV ? opts.y + (opts.vmax - v) * opts.s : opts.y + (v - opts.vmin) * opts.s; }
    doc.setDrawColor(45, 45, 45);
    doc.setFillColor(235, 229, 218);
    doc.setLineWidth(0.25);
    polys.forEach(function (po) {
      if (po.circle) {
        doc.circle(U(po.circle.u), V(po.circle.v), po.circle.r * opts.s, 'FD');
        return;
      }
      if (!po.pts || po.pts.length < 2) return;
      var segs = [];
      for (var i = 1; i < po.pts.length; i++) {
        segs.push([U(po.pts[i][0]) - U(po.pts[i - 1][0]), V(po.pts[i][1]) - V(po.pts[i - 1][1])]);
      }
      doc.lines(segs, U(po.pts[0][0]), V(po.pts[0][1]), [1, 1], 'FD', true);
    });
  }

  function slash(doc, x, y) { doc.line(x - 1, y + 1, x + 1, y - 1); }

  // Horizontal dimension: line + end slashes + extension lines + centered label above.
  function dimH(doc, x1, x2, y, extTop, label) {
    doc.setLineWidth(0.15);
    doc.setDrawColor(90, 90, 90);
    doc.line(x1, extTop, x1, y + 1.5);
    doc.line(x2, extTop, x2, y + 1.5);
    doc.line(x1, y, x2, y);
    slash(doc, x1, y); slash(doc, x2, y);
    doc.setFontSize(8);
    doc.setTextColor(30);
    doc.text(label, (x1 + x2) / 2, y - 1.2, { align: 'center' });
  }

  // Vertical dimension: label rotated, extension lines toward the view (to the right).
  function dimV(doc, x, y1, y2, extRight, label) {
    doc.setLineWidth(0.15);
    doc.setDrawColor(90, 90, 90);
    doc.line(x - 1.5, y1, extRight, y1);
    doc.line(x - 1.5, y2, extRight, y2);
    doc.line(x, y1, x, y2);
    slash(doc, x, y1); slash(doc, x, y2);
    doc.setFontSize(8);
    doc.setTextColor(30);
    doc.text(label, x - 1.2, (y1 + y2) / 2, { align: 'center', angle: 90 });
  }

  function niceScale(raw) {
    // raw = paper mm per design mm. Return denominator n for "1:n" with 1/n <= raw.
    var dens = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10, 12.5, 15, 20, 25, 30, 40, 50, 75, 100, 150, 200, 300, 500];
    for (var i = 0; i < dens.length; i++) { if (1 / dens[i] <= raw) return dens[i]; }
    return 1000;
  }

  function mm(n) { return String(Math.round(n)); }

  // ---------- text pages ----------
  function TextPager(doc) {
    this.doc = doc; this.y = 20;
  }
  TextPager.prototype.need = function (h) {
    if (this.y + h > 285) { this.doc.addPage('a4', 'portrait'); this.y = 20; }
  };
  TextPager.prototype.heading = function (s) {
    this.need(14);
    this.doc.setFont('helvetica', 'bold'); this.doc.setFontSize(13); this.doc.setTextColor(20);
    this.doc.text(s, 15, this.y);
    this.y += 7;
    this.doc.setFont('helvetica', 'normal');
  };
  TextPager.prototype.para = function (s, opts) {
    opts = opts || {};
    this.doc.setFontSize(opts.size || 9.5);
    this.doc.setTextColor(opts.color || 40);
    if (opts.bold) this.doc.setFont('helvetica', 'bold');
    var lines = this.doc.splitTextToSize(s, 180);
    var h = lines.length * 4.3;
    this.need(h + 2);
    this.doc.text(lines, 15, this.y);
    this.y += h + (opts.gap != null ? opts.gap : 2);
    if (opts.bold) this.doc.setFont('helvetica', 'normal');
  };
  TextPager.prototype.table = function (headers, rows, widths) {
    var doc = this.doc, self = this;
    var x0 = 15;
    function row(cells, bold) {
      doc.setFont('helvetica', bold ? 'bold' : 'normal');
      doc.setFontSize(8.5);
      var wrapped = cells.map(function (c, i) { return doc.splitTextToSize(String(c == null ? '' : c), widths[i] - 2); });
      var h = Math.max.apply(null, wrapped.map(function (w) { return w.length; })) * 3.8 + 2.2;
      self.need(h + 1);
      var x = x0;
      wrapped.forEach(function (w, i) { doc.text(w, x + 1, self.y + 3.2); x += widths[i]; });
      doc.setDrawColor(190);
      doc.setLineWidth(0.1);
      doc.line(x0, self.y + h, x0 + widths.reduce(function (a, b) { return a + b; }, 0), self.y + h);
      self.y += h;
      doc.setFont('helvetica', 'normal');
    }
    row(headers, true);
    rows.forEach(function (r) { row(r, false); });
    this.y += 3;
  };

  // ---------- main export ----------
  function exportPDF(design, name, t, plan) {
    return withJsPDF().then(function (jsPDF) {
      var doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4' });
      var b = bbox(design);
      var Wf = Math.max(1, b.max.x - b.min.x);   // front/top width  (x)
      var Hf = Math.max(1, b.max.y - b.min.y);   // front/side height (y)
      var Ws = Math.max(1, b.max.z - b.min.z);   // side width / top height (z)

      // Title block
      doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(15);
      doc.text(name || design.meta.name, 14, 14);
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(90);
      doc.text(new Date().toLocaleDateString() + '  ·  ' + design.parts.length + ' parts', 283, 14, { align: 'right' });

      // Fit: [top over front] left column, side right of front. Dims need margins.
      var GAP = 12;                               // paper mm between views
      var x0 = 26, yTop = 24;                     // drawing region origin (leaves room for left dims)
      var availW = 283 - x0, availH = 196 - yTop; // keep room for bottom dim
      var raw = Math.min((availW - GAP) / (Wf + Ws), (availH - GAP) / (Hf + Ws));
      var den = niceScale(raw);
      var s = 1 / den;

      var topH = Ws * s, frontH = Hf * s, frontW = Wf * s, sideW = Ws * s;
      var xFront = x0, yTopView = yTop, yFront = yTop + topH + GAP;
      var xSide = x0 + frontW + GAP;

      // Views (far-first painter's order)
      var axTop = { u: 'x', v: 'z', d: 'y' }, oTop = { x: xFront, y: yTopView, s: s, umin: b.min.x, vmin: b.min.z, vmax: b.max.z, flipV: false };
      var axFront = { u: 'x', v: 'y', d: 'z' }, oFront = { x: xFront, y: yFront, s: s, umin: b.min.x, vmin: b.min.y, vmax: b.max.y, flipV: true };
      var axSide = { u: 'z', v: 'y', d: 'x' }, oSide = { x: xSide, y: yFront, s: s, umin: b.min.z, vmin: b.min.y, vmax: b.max.y, flipV: true };
      drawView(doc, projectView(design, axTop), oTop);
      drawView(doc, projectView(design, axFront), oFront);
      drawView(doc, projectView(design, axSide), oSide);

      // Cutouts: draw hole circles in the view that looks along the hole axis.
      function drawCutouts(axes, o) {
        design.parts.forEach(function (p) {
          (p.cutouts || []).forEach(function (co) {
            if (co.axis !== axes.d) return;
            var u = p.position[axes.u] + (co.offset[axes.u] || 0);
            var v = p.position[axes.v] + (co.offset[axes.v] || 0);
            var U = o.x + (u - o.umin) * o.s;
            var V = o.flipV ? o.y + (o.vmax - v) * o.s : o.y + (v - o.vmin) * o.s;
            doc.setDrawColor(45, 45, 45);
            doc.setLineWidth(0.25);
            doc.circle(U, V, co.diameter / 2 * o.s, 'S');
            doc.setFontSize(7);
            doc.setTextColor(60);
            doc.text('Ø' + Math.round(co.diameter), U, V + 1, { align: 'center' });
          });
        });
      }
      drawCutouts(axTop, oTop);
      drawCutouts(axFront, oFront);
      drawCutouts(axSide, oSide);

      // Labels
      doc.setFontSize(9); doc.setTextColor(80);
      doc.text(t('plans.top'), xFront + frontW / 2, yTopView - 2, { align: 'center' });
      doc.text(t('plans.front'), xFront + frontW / 2, yFront + frontH + 10, { align: 'center' });
      doc.text(t('plans.side'), xSide + sideW / 2, yFront + frontH + 10, { align: 'center' });

      // Dimensions (overall)
      dimH(doc, xFront, xFront + frontW, yFront + frontH + 5, yFront + frontH, mm(Wf));
      dimV(doc, xFront - 5, yFront, yFront + frontH, xFront, mm(Hf));
      dimV(doc, xFront - 5, yTopView, yTopView + topH, xFront, mm(Ws));
      dimH(doc, xSide, xSide + sideW, yFront + frontH + 5, yFront + frontH, mm(Ws));

      // Scale note
      doc.setFontSize(9); doc.setTextColor(80);
      doc.text(t('plans.scale') + ' 1:' + den + '  ·  ' + t('plans.units'), 283, 202, { align: 'right' });

      // ---- text pages ----
      doc.addPage('a4', 'portrait');
      var pg = new TextPager(doc);
      if (design.meta.description) pg.para(design.meta.description, { size: 10, gap: 4 });

      pg.heading(t('print.cutlist'));
      var groups = Schema.cutList(design);
      pg.table(
        [t('cut.qty'), t('cut.part'), t('cut.dims'), t('cut.stock'), t('cut.mat')],
        groups.map(function (g) { return [g.qty + '×', g.name, g.dims, g.stock || '—', g.species]; }),
        [12, 62, 42, 42, 22]
      );

      if (design.hardware && design.hardware.length) {
        pg.heading(t('print.hardware'));
        pg.table(
          [t('cut.qty'), '', ''],
          design.hardware.map(function (h) { return [h.quantity + '×', h.name, h.note || '']; }),
          [12, 88, 80]
        );
      }

      if (plan && (plan.boardGroups.length || plan.sheetGroups.length)) {
        pg.heading(t('plans.stock'));
        plan.boardGroups.forEach(function (g) { pg.para(g.boards.length + '× ' + g.key, { gap: 1 }); });
        plan.sheetGroups.forEach(function (g) { pg.para(g.sheets.length + '× ' + g.key + ' (' + t('opt.sheet') + ')', { gap: 1 }); });
        pg.y += 2;
      }

      pg.heading(t('print.prep'));
      design.parts.forEach(function (p) {
        pg.para(p.name + ' (' + Schema.dimsLabel(p) + ')', { bold: true, gap: 0.5 });
        p.prep.operations.forEach(function (o) { pg.para('• ' + o.type + ': ' + o.instruction, { gap: 0.5 }); });
        pg.y += 2;
      });

      pg.heading(t('print.assembly'));
      design.assembly.forEach(function (st) {
        pg.para(t('steps.step') + ' ' + st.step + ': ' + st.title, { bold: true, gap: 0.5 });
        pg.para(st.instruction, { gap: 3 });
      });

      if (design.finishing && design.finishing.length) {
        pg.heading(t('print.finishing'));
        design.finishing.forEach(function (f) {
          pg.para(f.step + '. ' + f.title, { bold: true, gap: 0.5 });
          pg.para(f.instruction, { gap: 3 });
        });
      }

      var fname = String(name || design.meta.name || 'design').replace(/[^\wÀ-ſ-]+/g, '_') + '_plans.pdf';
      doc.save(fname);
      if (window.Debug) Debug.log('ok', 'plans', 'PDF exported: ' + fname + ' (scale 1:' + den + ')');
    });
  }

  window.Plans = { exportPDF: exportPDF };
})();
