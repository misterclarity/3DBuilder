/* viewer.js — A-Frame 3D viewer: desktop orbit controls, part picking, exploded view,
 * cut-prep layout mode, assembly step mode, joint markers.
 * Registers components only after A-Frame is loaded: call Viewer.init(container, callbacks).
 * Exposes window.Viewer. Units: design mm → scene meters (/1000).
 */
(function () {
  'use strict';

  var S = 0.001; // mm → m
  var sceneEl = null, partsRoot = null, jointsRoot = null, labelsRoot = null, measureRoot = null, camEl = null;
  var measureMode = false, measurePt = null;
  var design = null;
  var mode = 'model';            // 'model' | 'prep' | 'assembly'
  var explodeF = 0;
  var asmStep = 1;
  var selected = {};             // partId -> true
  var hovered = null;
  var showJoints = true;
  var cb = {};                   // callbacks: onSelect(ids), onPartInfo(part|null), onJointInfo(joint|null), onPlantInfo(plant|null)
  var partEls = {}, jointEls = {}, plantEls = {};
  var dragDist = 0, downPos = null;

  // foliage default colors per growth habit (plant.color overrides the accent)
  var HABIT_GREEN = {
    leafy: '#66bb6a', bushy: '#4caf50', vining: '#7cb342', climbing: '#7cb342', root: '#8bc34a',
    herb: '#81c784', flower: '#66bb6a', shrub: '#388e3c', tree: '#2e7d32', grass: '#9ccc65'
  };

  var JOINT_COLORS = {
    hinge: '#ff9800', screw: '#90a4ae', bolt: '#546e7a', dowel: '#d7a97f', glue: '#eceff1',
    nail: '#b0bec5', bracket: '#78909c', pocket_hole: '#8d6e63', biscuit: '#d7ccc8', domino: '#bcaaa4',
    dado: '#4db6ac', groove: '#26a69a', rabbet: '#00897b', lap: '#5c6bc0',
    mortise_tenon: '#7e57c2', dovetail: '#ab47bc', miter: '#789fa5', other: '#90a4ae'
  };
  // Housed / machined joints get a flat box marker instead of a sphere.
  var HOUSED_JOINTS = { dado: 1, groove: 1, rabbet: 1, lap: 1, mortise_tenon: 1, dovetail: 1, miter: 1 };

  // ---------- component registration ----------
  function registerComponents() {
    if (AFRAME.components['orbit-cam']) return;

    AFRAME.registerComponent('orbit-cam', {
      schema: {},
      init: function () {
        this.target = new THREE.Vector3(0, 0.4, 0);
        this.radius = 3.2;
        this.azimuth = Math.PI / 4;
        this.polar = Math.PI / 3;
        this.attach();
        this.update3D();
      },
      attach: function () {
        var self = this;
        var scene = this.el.sceneEl;
        function withCanvas(fn) {
          if (scene.canvas) fn(scene.canvas);
          else scene.addEventListener('render-target-loaded', function () { fn(scene.canvas); });
        }
        withCanvas(function (canvas) {
          canvas.style.touchAction = 'none';
          canvas.addEventListener('contextmenu', function (e) { e.preventDefault(); });
          canvas.addEventListener('mousedown', function (e) {
            self.drag = { x: e.clientX, y: e.clientY, btn: e.button, shift: e.shiftKey };
            downPos = { x: e.clientX, y: e.clientY };
            dragDist = 0;
          });
          window.addEventListener('mousemove', function (e) {
            if (!self.drag) return;
            var dx = e.clientX - self.drag.x, dy = e.clientY - self.drag.y;
            self.drag.x = e.clientX; self.drag.y = e.clientY;
            dragDist += Math.abs(dx) + Math.abs(dy);
            if (self.drag.btn === 0 && !self.drag.shift) {
              self.azimuth -= dx * 0.006;
              self.polar = Math.min(Math.PI - 0.08, Math.max(0.08, self.polar - dy * 0.006));
            } else {
              // pan (right / middle / shift+left)
              var cam = self.el.object3D;
              var right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
              var up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
              var k = self.radius * 0.0012;
              self.target.addScaledVector(right, -dx * k);
              self.target.addScaledVector(up, dy * k);
            }
            self.update3D();
          });
          window.addEventListener('mouseup', function () { self.drag = null; });
          canvas.addEventListener('wheel', function (e) {
            e.preventDefault();
            self.radius = Math.min(30, Math.max(0.3, self.radius * (1 + e.deltaY * 0.0012)));
            self.update3D();
          }, { passive: false });
          // touch: one finger orbit, two fingers pinch-zoom + pan, tap = select
          var touches = {};
          canvas.addEventListener('touchstart', function (e) {
            for (var i = 0; i < e.touches.length; i++) touches[e.touches[i].identifier] = { x: e.touches[i].clientX, y: e.touches[i].clientY };
            self.pinch = null; self.mid = null;
            if (e.touches.length === 1) {
              downPos = { x: e.touches[0].clientX, y: e.touches[0].clientY };
              dragDist = 0;                 // so a clean tap registers as a click/select
            } else {
              dragDist = 100;               // multi-finger gestures are never taps
            }
          }, { passive: true });
          canvas.addEventListener('touchmove', function (e) {
            e.preventDefault();
            if (e.touches.length === 1) {
              var t = e.touches[0], prev = touches[t.identifier];
              if (prev) {
                var dx = t.clientX - prev.x, dy = t.clientY - prev.y;
                dragDist += Math.abs(dx) + Math.abs(dy);
                self.azimuth -= dx * 0.006;
                self.polar = Math.min(Math.PI - 0.08, Math.max(0.08, self.polar - dy * 0.006));
              }
              touches[t.identifier] = { x: t.clientX, y: t.clientY };
            } else if (e.touches.length === 2) {
              var t0 = e.touches[0], t1 = e.touches[1];
              var d = Math.hypot(t0.clientX - t1.clientX, t0.clientY - t1.clientY);
              var mid = { x: (t0.clientX + t1.clientX) / 2, y: (t0.clientY + t1.clientY) / 2 };
              if (self.pinch) self.radius = Math.min(30, Math.max(0.3, self.radius * (self.pinch / d)));
              if (self.mid) {
                // two-finger drag pans the view
                var cam = self.el.object3D;
                var right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
                var up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
                var k = self.radius * 0.0012;
                self.target.addScaledVector(right, -(mid.x - self.mid.x) * k);
                self.target.addScaledVector(up, (mid.y - self.mid.y) * k);
              }
              self.pinch = d; self.mid = mid;
            }
            self.update3D();
          }, { passive: false });
          canvas.addEventListener('touchend', function (e) {
            touches = {};
            self.pinch = null; self.mid = null;
            if (e.touches.length) dragDist = 100;  // lifted one of two fingers — still not a tap
          });
        });
      },
      update3D: function () {
        var sp = Math.sin(this.polar), cp = Math.cos(this.polar);
        var pos = new THREE.Vector3(
          this.target.x + this.radius * sp * Math.sin(this.azimuth),
          this.target.y + this.radius * cp,
          this.target.z + this.radius * sp * Math.cos(this.azimuth)
        );
        this.el.object3D.position.copy(pos);
        // el.object3D is a Group: Group.lookAt points +Z at the target, but the camera
        // looks down -Z. Use camera-convention Matrix4.lookAt to orient -Z at the target.
        var m = new THREE.Matrix4().lookAt(pos, this.target, new THREE.Vector3(0, 1, 0));
        this.el.object3D.quaternion.setFromRotationMatrix(m);
      },
      setView: function (target, radius) {
        this.target.copy(target);
        if (radius) this.radius = radius;
        this.update3D();
      }
    });

    AFRAME.registerComponent('billboard', {
      tick: function () {
        var cam = this.el.sceneEl.camera;
        if (cam) this.el.object3D.quaternion.copy(cam.getWorldQuaternion(new THREE.Quaternion()));
      }
    });
  }

  // ---------- scene construction ----------
  function init(container, callbacks) {
    cb = callbacks || {};
    registerComponents();

    sceneEl = document.createElement('a-scene');
    sceneEl.setAttribute('embedded', '');
    sceneEl.setAttribute('vr-mode-ui', 'enabled: false');
    sceneEl.setAttribute('renderer', 'antialias: true; colorManagement: true');
    sceneEl.setAttribute('background', 'color: #22292e');

    sceneEl.innerHTML = [
      '<a-entity light="type: ambient; color: #ffffff; intensity: 0.55"></a-entity>',
      '<a-entity light="type: directional; color: #fff5e6; intensity: 0.9; castShadow: true" position="2.5 4 2"></a-entity>',
      '<a-entity light="type: directional; color: #cfe4ff; intensity: 0.3" position="-3 2 -2"></a-entity>',
      '<a-plane id="floor" rotation="-90 0 0" width="14" height="14" material="shader: standard; roughness: 1; color: #2e373d" position="0 -0.001 0"></a-plane>',
      '<a-entity id="grid"></a-entity>',
      '<a-entity id="partsRoot"></a-entity>',
      '<a-entity id="jointsRoot"></a-entity>',
      '<a-entity id="labelsRoot"></a-entity>',
      '<a-entity id="measureRoot"></a-entity>',
      '<a-entity id="cam" camera="fov: 50; near: 0.01; far: 200" orbit-cam></a-entity>',
      '<a-entity id="mouseCursor" cursor="rayOrigin: mouse; fuse: false" raycaster="objects: .pickable; interval: 80"></a-entity>'
    ].join('');

    container.appendChild(sceneEl);
    if (window.Debug) {
      Debug.log('info', 'viewer', 'Scene created (A-Frame ' + AFRAME.version + ', THREE r' + THREE.REVISION + ')');
      sceneEl.addEventListener('render-target-loaded', function () {
        var c = sceneEl.canvas;
        Debug.log(c && c.height > 10 ? 'ok' : 'error', 'viewer', 'Render canvas: ' + (c ? c.width + '×' + c.height : 'MISSING') + (c && c.height <= 10 ? ' — viewport has no height (CSS problem?)' : ''));
      });
      sceneEl.addEventListener('loaded', function () { Debug.log('ok', 'viewer', 'Scene loaded'); });
    }
    partsRoot = sceneEl.querySelector('#partsRoot');
    jointsRoot = sceneEl.querySelector('#jointsRoot');
    labelsRoot = sceneEl.querySelector('#labelsRoot');
    measureRoot = sceneEl.querySelector('#measureRoot');
    camEl = sceneEl.querySelector('#cam');

    buildGrid();

    // Deselect when clicking empty space (mouseup with tiny drag and no entity click).
    sceneEl.addEventListener('render-target-loaded', function () {
      sceneEl.canvas.addEventListener('mouseup', function () {
        if (dragDist < 6) {
          setTimeout(function () {
            if (!clickConsumed) { clearSelection(); if (cb.onPartInfo) cb.onPartInfo(null); }
            clickConsumed = false;
          }, 30);
        } else { clickConsumed = false; }
      });
    });
  }

  var clickConsumed = false;

  function buildGrid() {
    var grid = sceneEl.querySelector('#grid');
    var half = 5, step = 0.5;
    var lines = [];
    for (var i = -half; i <= half + 0.001; i += step) {
      lines.push('<a-entity line="start: ' + i + ' 0 ' + (-half) + '; end: ' + i + ' 0 ' + half + '; color: #3d474d"></a-entity>');
      lines.push('<a-entity line="start: ' + (-half) + ' 0 ' + i + '; end: ' + half + ' 0 ' + i + '; color: #3d474d"></a-entity>');
    }
    grid.innerHTML = lines.join('');
  }

  // ---------- design loading ----------
  function loadDesign(d) {
    design = d;
    mode = 'model';
    explodeF = 0;
    asmStep = 1;
    selected = {};
    hovered = null;
    clearRoots();
    if (cb.onSelect) cb.onSelect([]);
    if (cb.onPartInfo) cb.onPartInfo(null);
    if (!d) { if (window.Debug) Debug.log('info', 'viewer', 'Design cleared'); return; }

    d.parts.forEach(function (p) { partEls[p.id] = makePartEntity(p); });
    (d.plants || []).forEach(function (p) { plantEls[p.id] = makePlantEntity(p); });
    (d.joints || []).forEach(function (j) { if (j.position) jointEls[j.id] = makeJointEntity(j); });
    applyMode(true);
    fitView();
    if (window.Debug) Debug.log('ok', 'viewer', 'Design "' + d.meta.name + '" rendered: ' + d.parts.length + ' parts, ' + (d.plants || []).length + ' plants, ' + (d.joints || []).length + ' joints, ' + d.assembly.length + ' steps');
  }

  // Rebuild only the plant entities (e.g. after the plant-style setting changed).
  function refreshPlants() {
    if (!design) return;
    Object.keys(plantEls).forEach(function (id) {
      if (plantEls[id].parentNode) plantEls[id].parentNode.removeChild(plantEls[id]);
    });
    plantEls = {};
    (design.plants || []).forEach(function (p) { plantEls[p.id] = makePlantEntity(p); });
    applyMode(true);
  }

  function clearRoots() {
    [partsRoot, jointsRoot, labelsRoot, measureRoot].forEach(function (r) { while (r.firstChild) r.removeChild(r.firstChild); });
    partEls = {}; jointEls = {}; plantEls = {};
    measurePt = null;
  }

  function makePartEntity(p) {
    var el = document.createElement('a-entity');
    el.classList.add('pickable');
    el.dataset.partId = p.id;
    if (p.shape === 'cylinder') {
      el.setAttribute('geometry', { primitive: 'cylinder', radius: p.dimensions.radius * S, height: p.dimensions.height * S, segmentsRadial: 24 });
    } else {
      el.setAttribute('geometry', { primitive: 'box', width: p.dimensions.x * S, height: p.dimensions.y * S, depth: p.dimensions.z * S });
    }
    el.setAttribute('material', window.Materials.materialFor(p));
    el.setAttribute('shadow', 'cast: true; receive: true');
    setTransform(el, modelPos(p), p.rotation, false);

    // Cutouts: rendered as dark disks slightly proud of both faces (no CSG in A-Frame).
    (p.cutouts || []).forEach(function (co) {
      var h = document.createElement('a-entity');
      h.classList.add('pickable');   // so clicking the hole disc selects the part (events bubble)
      var th = ((p.dimensions[co.axis] || 10) + 2) * S;
      h.setAttribute('geometry', { primitive: 'cylinder', radius: co.diameter / 2 * S, height: th, segmentsRadial: 28 });
      h.setAttribute('material', { shader: 'flat', color: '#14181c' });
      h.setAttribute('position', (co.offset.x * S) + ' ' + (co.offset.y * S) + ' ' + (co.offset.z * S));
      if (co.axis === 'x') h.setAttribute('rotation', '0 0 90');
      else if (co.axis === 'z') h.setAttribute('rotation', '90 0 0');
      el.appendChild(h);   // child: follows the part through all modes/animations
    });

    el.addEventListener('mouseenter', function () { hovered = p.id; refreshVisual(p.id); if (cb.onHover) cb.onHover(p.id); });
    el.addEventListener('mouseleave', function () { if (hovered === p.id) hovered = null; refreshVisual(p.id); if (cb.onHover) cb.onHover(null); });
    el.addEventListener('click', function (evt) {
      if (dragDist >= 6) return;
      clickConsumed = true;
      if (measureMode) { addMeasurePoint(evt.detail && evt.detail.intersection); return; }
      var multi = evt.detail && evt.detail.mouseEvent && (evt.detail.mouseEvent.ctrlKey || evt.detail.mouseEvent.metaKey);
      selectPart(p.id, multi);
    });

    partsRoot.appendChild(el);
    return el;
  }

  function makeJointEntity(j) {
    var el = document.createElement('a-entity');
    el.classList.add('pickable');
    el.dataset.jointId = j.id;
    var isHinge = j.type === 'hinge';
    el.setAttribute('geometry', isHinge
      ? { primitive: 'cylinder', radius: 0.014, height: 0.06, segmentsRadial: 12 }
      : HOUSED_JOINTS[j.type]
        ? { primitive: 'box', width: 0.034, height: 0.014, depth: 0.034 }
        : { primitive: 'sphere', radius: 0.013, segmentsWidth: 12, segmentsHeight: 10 });
    el.setAttribute('material', { shader: 'standard', color: JOINT_COLORS[j.type] || '#90a4ae', metalness: 0.6, roughness: 0.35, emissive: JOINT_COLORS[j.type] || '#90a4ae', emissiveIntensity: 0.12 });
    el.setAttribute('position', vec(j.position));
    el.addEventListener('click', function () {
      if (dragDist >= 6) return;
      clickConsumed = true;
      if (cb.onJointInfo) cb.onJointInfo(j);
    });
    jointsRoot.appendChild(el);
    return el;
  }

  /* ---------- plants (garden mode) ---------- */
  // Deterministic pseudo-random in [0,1) from a string id (natural variation).
  function idRnd(id, salt) {
    var h = salt || 0;
    for (var i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
    return (h % 1000) / 1000;
  }

  function plantStyle() {
    var s = window.LLM ? LLM.settings().plantStyle : '';
    return s === 'billboard' ? 'billboard' : 'primitives';
  }

  // One mesh child of a plant. Standard shader → highlightable via emissive.
  // The child itself must be .pickable: the raycaster only collects meshes
  // registered on whitelisted entities (not descendants of an empty group).
  // Its click/hover events bubble up to the plant root's handlers.
  function plantMesh(parent, geom, color, pos, scale) {
    var e = document.createElement('a-entity');
    e.classList.add('pickable');
    e.setAttribute('geometry', geom);
    e.setAttribute('material', { shader: 'standard', color: color, roughness: 0.85, metalness: 0 });
    e.setAttribute('position', pos.x + ' ' + pos.y + ' ' + pos.z);
    if (scale) e.setAttribute('scale', scale.x + ' ' + scale.y + ' ' + scale.z);
    e.dataset.pm = '1';
    parent.appendChild(e);
    return e;
  }

  // Procedural plant shapes by growth habit. All sizes in meters.
  function buildPlantShape(wrap, p) {
    var h = Math.max(0.04, p.matureHeight * S);
    var r = Math.max(0.02, p.matureDiameter * S / 2);
    var green = HABIT_GREEN[p.habit] || '#4caf50';
    var accent = p.color || null;
    var stemCol = '#8d6e63';
    function sphere(rad) { return { primitive: 'sphere', radius: rad, segmentsWidth: 14, segmentsHeight: 10 }; }
    function cyl(rad, ht) { return { primitive: 'cylinder', radius: rad, height: ht, segmentsRadial: 10 }; }
    function cone(rad, ht) { return { primitive: 'cone', radiusBottom: rad, radiusTop: 0.001, height: ht, segmentsRadial: 10 }; }

    switch (p.habit) {
      case 'leafy':
        plantMesh(wrap, sphere(r), accent || green, { x: 0, y: h / 2, z: 0 }, { x: 1, y: h / (2 * r), z: 1 });
        plantMesh(wrap, sphere(r * 0.55), '#dcedc8', { x: 0, y: h * 0.62, z: 0 }, { x: 1, y: h / (2 * r) * 0.7, z: 1 });
        break;
      case 'root':
        plantMesh(wrap, cone(r * 0.55, h), green, { x: 0, y: h / 2, z: 0 });
        plantMesh(wrap, sphere(r * 0.45), green, { x: 0, y: h * 0.55, z: 0 }, { x: 1, y: 1.4, z: 1 });
        break;
      case 'herb':
        plantMesh(wrap, cyl(r * 0.06, h * 0.4), '#7a9e5f', { x: 0, y: h * 0.2, z: 0 });
        plantMesh(wrap, sphere(r * 0.55), green, { x: -r * 0.3, y: h * 0.55, z: r * 0.15 });
        plantMesh(wrap, sphere(r * 0.5), green, { x: r * 0.3, y: h * 0.6, z: -r * 0.1 });
        plantMesh(wrap, sphere(r * 0.5), accent || green, { x: 0, y: h * 0.78, z: 0 });
        break;
      case 'flower':
        plantMesh(wrap, cyl(Math.max(0.004, r * 0.05), h * 0.75), '#558b2f', { x: 0, y: h * 0.375, z: 0 });
        plantMesh(wrap, sphere(r * 0.42), green, { x: 0, y: h * 0.28, z: 0 }, { x: 1.4, y: 0.5, z: 1.4 });
        plantMesh(wrap, sphere(r * 0.38), accent || '#f06292', { x: 0, y: h * 0.88, z: 0 });
        break;
      case 'climbing':
        plantMesh(wrap, cyl(0.008, h), stemCol, { x: 0, y: h / 2, z: 0 });  // stake
        plantMesh(wrap, sphere(r * 0.5), green, { x: r * 0.15, y: h * 0.3, z: 0 });
        plantMesh(wrap, sphere(r * 0.45), green, { x: -r * 0.15, y: h * 0.58, z: r * 0.1 });
        plantMesh(wrap, sphere(r * 0.4), accent || green, { x: 0, y: h * 0.85, z: -r * 0.05 });
        break;
      case 'vining':
        plantMesh(wrap, sphere(r * 0.6), green, { x: -r * 0.5, y: h * 0.4, z: 0 }, { x: 1, y: h / (2 * r), z: 1 });
        plantMesh(wrap, sphere(r * 0.6), green, { x: r * 0.5, y: h * 0.45, z: r * 0.15 }, { x: 1, y: h / (2 * r), z: 1 });
        plantMesh(wrap, sphere(r * 0.55), accent || green, { x: 0, y: h * 0.55, z: -r * 0.2 });
        break;
      case 'tree':
        plantMesh(wrap, cyl(Math.max(0.012, r * 0.09), h * 0.45), '#795548', { x: 0, y: h * 0.225, z: 0 });
        plantMesh(wrap, sphere(r), green, { x: 0, y: h * 0.7, z: 0 }, { x: 1, y: (h * 0.6) / (2 * r), z: 1 });
        if (accent) {  // fruit tree: colored fruit dots on the canopy
          [[0.6, 0.72, 0.5], [-0.65, 0.62, 0.25], [0.1, 0.8, -0.6], [-0.3, 0.7, 0.65]].forEach(function (o) {
            plantMesh(wrap, sphere(Math.min(0.08, r * 0.12)), accent, { x: r * o[0], y: h * o[1], z: r * o[2] });
          });
        }
        break;
      case 'shrub':
        plantMesh(wrap, cyl(Math.max(0.008, r * 0.07), h * 0.25), '#795548', { x: 0, y: h * 0.125, z: 0 });
        plantMesh(wrap, sphere(r), accent || green, { x: 0, y: h * 0.55, z: 0 }, { x: 1, y: (h * 0.9) / (2 * r), z: 1 });
        break;
      case 'grass':
        plantMesh(wrap, cone(r * 0.5, h), green, { x: 0, y: h / 2, z: 0 });
        plantMesh(wrap, cone(r * 0.35, h * 0.8), '#aed581', { x: r * 0.25, y: h * 0.4, z: r * 0.1 });
        break;
      default: // bushy
        plantMesh(wrap, cyl(Math.max(0.006, r * 0.06), h * 0.5), '#7a9e5f', { x: 0, y: h * 0.25, z: 0 });
        plantMesh(wrap, sphere(r * 0.9), green, { x: 0, y: h * 0.6, z: 0 }, { x: 1, y: (h * 0.75) / (2 * r * 0.9), z: 1 });
        if (accent) {
          [[0.5, 0.5, 0.55], [-0.55, 0.62, 0.2], [0.15, 0.72, -0.55]].forEach(function (o) {
            plantMesh(wrap, sphere(Math.min(0.05, r * 0.22)), accent, { x: r * o[0], y: h * o[1], z: r * o[2] });
          });
        }
    }
  }

  // Camera-facing sprite with a species emoji (billboard style).
  var spriteCache = {};
  function spriteTexture(emoji) {
    if (spriteCache[emoji]) return spriteCache[emoji];
    var c = document.createElement('canvas');
    c.width = 128; c.height = 128;
    var ctx = c.getContext('2d');
    ctx.beginPath(); ctx.arc(64, 64, 61, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(27,58,30,0.82)'; ctx.fill();
    ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(139,195,74,0.9)'; ctx.stroke();
    ctx.font = '78px "Segoe UI Emoji", "Apple Color Emoji", serif';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(emoji, 64, 70);
    var url = c.toDataURL('image/png');
    spriteCache[emoji] = url;
    return url;
  }

  function makePlantEntity(p) {
    var el = document.createElement('a-entity');
    el.classList.add('pickable');
    el.dataset.plantId = p.id;
    el.setAttribute('position', vec(p.position));

    var h = Math.max(0.04, p.matureHeight * S);
    if (plantStyle() === 'billboard') {
      var side = Math.max(p.matureDiameter * S, h * 0.7);
      var b = document.createElement('a-entity');
      b.classList.add('pickable');   // sprite mesh lives on this child, see plantMesh note
      b.setAttribute('geometry', { primitive: 'plane', width: side, height: side });
      b.setAttribute('material', {
        shader: 'flat', transparent: true,
        src: spriteTexture(window.Garden ? Garden.emojiFor(p.species, p.habit) : '🌱')
      });
      b.setAttribute('position', '0 ' + (h / 2) + ' 0');
      b.setAttribute('billboard', '');
      b.dataset.pm = '1'; b.dataset.flat = '1';
      el.appendChild(b);
    } else {
      // slight per-plant rotation/scale variation so rows look organic
      var wrap = document.createElement('a-entity');
      wrap.setAttribute('rotation', '0 ' + Math.round(idRnd(p.id) * 360) + ' 0');
      var sc = 0.92 + idRnd(p.id, 7) * 0.16;
      wrap.setAttribute('scale', sc + ' ' + sc + ' ' + sc);
      buildPlantShape(wrap, p);
      el.appendChild(wrap);
    }

    // name label (always on)
    var label = document.createElement('a-entity');
    label.setAttribute('billboard', '');
    label.setAttribute('position', '0 ' + (h + 0.07) + ' 0');
    label.setAttribute('text', { value: p.name, align: 'center', color: '#dcedc8', width: 1.1, wrapCount: 18 });
    el.appendChild(label);

    el.addEventListener('mouseenter', function () { hovered = p.id; refreshVisual(p.id); if (cb.onHover) cb.onHover(p.id); });
    el.addEventListener('mouseleave', function () { if (hovered === p.id) hovered = null; refreshVisual(p.id); if (cb.onHover) cb.onHover(null); });
    el.addEventListener('click', function (evt) {
      if (dragDist >= 6) return;
      clickConsumed = true;
      if (measureMode) { addMeasurePoint(evt.detail && evt.detail.intersection); return; }
      var multi = evt.detail && evt.detail.mouseEvent && (evt.detail.mouseEvent.ctrlKey || evt.detail.mouseEvent.metaKey);
      selectPart(p.id, multi);
    });

    partsRoot.appendChild(el);
    return el;
  }

  function vec(p) { return (p.x * S) + ' ' + (p.y * S) + ' ' + (p.z * S); }

  function setTransform(el, posMM, rotDeg, animate) {
    var pos = vec(posMM);
    var rot = (rotDeg.x || 0) + ' ' + (rotDeg.y || 0) + ' ' + (rotDeg.z || 0);
    if (animate) {
      el.setAttribute('animation__pos', { property: 'position', to: pos, dur: 650, easing: 'easeInOutQuad' });
      el.setAttribute('animation__rot', { property: 'rotation', to: rot, dur: 650, easing: 'easeInOutQuad' });
    } else {
      el.removeAttribute('animation__pos');
      el.removeAttribute('animation__rot');
      el.setAttribute('position', pos);
      el.setAttribute('rotation', rot);
    }
  }

  // ---------- selection & visuals ----------
  function selectPart(id, multi) {
    if (!multi) {
      var was = selected[id] && Object.keys(selected).length === 1;
      Object.keys(selected).forEach(function (k) { delete selected[k]; refreshVisual(k); });
      if (!was) selected[id] = true;
    } else {
      if (selected[id]) delete selected[id]; else selected[id] = true;
    }
    refreshVisual(id);
    var ids = Object.keys(selected);
    if (cb.onSelect) cb.onSelect(ids);
    var last = ids.length ? ids[ids.length - 1] : null;
    var part = last && design.parts.find(function (p) { return p.id === last; });
    var plant = !part && last && (design.plants || []).find(function (p) { return p.id === last; });
    if (plant) { if (cb.onPlantInfo) cb.onPlantInfo(plant); }
    else if (cb.onPartInfo) cb.onPartInfo(part || null);
  }

  function clearSelection() {
    Object.keys(selected).forEach(function (k) { delete selected[k]; refreshVisual(k); });
    if (cb.onSelect) cb.onSelect([]);
  }

  function setSelection(ids) {
    clearSelection();
    (ids || []).forEach(function (id) { if (partEls[id] || plantEls[id]) { selected[id] = true; refreshVisual(id); } });
    if (cb.onSelect) cb.onSelect(Object.keys(selected));
  }

  // Highlight state on a plant: emissive on standard-shader meshes, tint on flat sprites.
  function refreshPlantVisual(id) {
    var el = plantEls[id];
    if (!el || !design) return;
    var isCurrentStep = mode === 'assembly' && partStep(id) === asmStep;
    var em = '#000000', emi = 0, tint = '#ffffff';
    if (selected[id]) { em = '#1e88e5'; emi = 0.45; tint = '#9ecbff'; }
    else if (hovered === id) { em = '#ffffff'; emi = 0.18; tint = '#d4e9ff'; }
    else if (isCurrentStep) { em = '#ff8f00'; emi = 0.35; tint = '#ffd180'; }
    el.querySelectorAll('[data-pm]').forEach(function (m) {
      if (m.dataset.flat) m.setAttribute('material', 'color', tint);
      else {
        m.setAttribute('material', 'emissive', em);
        m.setAttribute('material', 'emissiveIntensity', emi);
      }
    });
  }

  function refreshVisual(id) {
    if (plantEls[id]) { refreshPlantVisual(id); return; }
    var el = partEls[id];
    if (!el || !design) return;
    var p = design.parts.find(function (q) { return q.id === id; });
    if (!p) return;
    var stepIdx = partStep(id);
    var isCurrentStep = mode === 'assembly' && stepIdx === asmStep;
    el.removeAttribute('animation__pulse');
    if (selected[id]) {
      el.setAttribute('material', 'emissive', '#1e88e5');
      el.setAttribute('material', 'emissiveIntensity', 0.45);
    } else if (hovered === id) {
      el.setAttribute('material', 'emissive', '#ffffff');
      el.setAttribute('material', 'emissiveIntensity', 0.18);
    } else if (isCurrentStep) {
      el.setAttribute('material', 'emissive', '#ff8f00');
      el.setAttribute('material', 'emissiveIntensity', 0.35);
      el.setAttribute('animation__pulse', { property: 'material.emissiveIntensity', from: 0.15, to: 0.5, dir: 'alternate', loop: true, dur: 700, easing: 'easeInOutSine' });
    } else {
      el.setAttribute('material', 'emissive', '#000000');
      el.setAttribute('material', 'emissiveIntensity', 0);
    }
  }

  function refreshMaterials() {
    if (!design) return;
    design.parts.forEach(function (p) {
      var el = partEls[p.id];
      if (el) { el.setAttribute('material', window.Materials.materialFor(p)); refreshVisual(p.id); }
    });
  }

  // ---------- modes ----------
  function centroid() {
    var c = { x: 0, y: 0, z: 0 };
    design.parts.forEach(function (p) { c.x += p.position.x; c.y += p.position.y; c.z += p.position.z; });
    var n = Math.max(1, design.parts.length);
    return { x: c.x / n, y: c.y / n, z: c.z / n };
  }

  function modelPos(p) {
    if (explodeF <= 0.001) return p.position;
    var c = centroid();
    var f = 1 + explodeF * 1.4;
    return {
      x: c.x + (p.position.x - c.x) * f,
      y: Math.max(p.dimensions.y ? p.dimensions.y / 2 : 20, c.y + (p.position.y - c.y) * f),
      z: c.z + (p.position.z - c.z) * f
    };
  }

  function partStep(id) {
    if (!design) return 1;
    for (var i = 0; i < design.assembly.length; i++) {
      if (design.assembly[i].parts.indexOf(id) >= 0) return design.assembly[i].step;
    }
    return 1;
  }

  function setMode(m) {
    if (m === mode) return;
    mode = m;
    applyMode(false);
  }

  function applyMode(instant) {
    if (!design) return;
    labelsRoot.innerHTML = '';
    if (mode === 'prep') layoutPrep(instant);
    else if (mode === 'assembly') { layoutModel(instant); applyAssemblyVisibility(); }
    else { layoutModel(instant); showAllParts(); }
    // plants: hidden on the cut-prep workbench, per-step in assembly, all in model
    (design.plants || []).forEach(function (p) {
      var el = plantEls[p.id];
      if (!el) return;
      if (mode === 'prep') el.setAttribute('visible', false);
      else if (mode === 'assembly') el.setAttribute('visible', partStep(p.id) <= asmStep);
      else el.setAttribute('visible', true);
    });
    jointsRoot.setAttribute('visible', showJoints && mode !== 'prep');
    design.parts.forEach(function (p) { refreshVisual(p.id); });
    (design.plants || []).forEach(function (p) { refreshVisual(p.id); });
  }

  function layoutModel(instant) {
    design.parts.forEach(function (p) {
      var el = partEls[p.id];
      el.setAttribute('visible', true);
      setTransform(el, modelPos(p), p.rotation, !instant);
    });
  }

  function showAllParts() {
    design.parts.forEach(function (p) { partEls[p.id].setAttribute('visible', true); });
  }

  function setExplode(f) {
    explodeF = f;
    if (mode === 'model') layoutModel(false);
  }

  // Cut-prep mode: lay every part flat on the virtual workbench in a grid with labels.
  function layoutPrep(instant) {
    labelsRoot.innerHTML = '';   // avoid duplicate labels on re-layout (e.g. nudge in prep mode)
    var items = design.parts.map(function (p) {
      var fp = footprint(p);
      return { p: p, w: fp.w, d: fp.d, h: fp.h, rot: fp.rot };
    }).sort(function (a, b) { return (b.w * b.d) - (a.w * a.d); });

    var GAP = 120, MAXW = 4200;
    var x = 0, z = 0, rowD = 0, rows = [], row = [];
    items.forEach(function (it) {
      if (x + it.w > MAXW && row.length) { rows.push({ items: row, d: rowD }); row = []; x = 0; rowD = 0; }
      it.x0 = x; row.push(it);
      x += it.w + GAP;
      rowD = Math.max(rowD, it.d);
    });
    if (row.length) rows.push({ items: row, d: rowD });

    var totalD = rows.reduce(function (s, r) { return s + r.d + GAP; }, -GAP);
    var maxRowW = 0;
    rows.forEach(function (r) { maxRowW = Math.max(maxRowW, r.items[r.items.length - 1].x0 + r.items[r.items.length - 1].w); });
    var zCur = -totalD / 2;
    rows.forEach(function (r) {
      var rowW = r.items[r.items.length - 1].x0 + r.items[r.items.length - 1].w;
      r.items.forEach(function (it) {
        var px = it.x0 + it.w / 2 - rowW / 2;
        var pz = zCur + r.d / 2;
        var el = partEls[it.p.id];
        el.setAttribute('visible', true);
        setTransform(el, { x: px, y: it.h / 2 + 2, z: pz }, it.rot, !instant);
        addLabel(it.p, { x: px, y: it.h + 120, z: pz });
      });
      zCur += r.d + GAP;
    });
    if (camEl && camEl.components['orbit-cam']) {
      var oc = camEl.components['orbit-cam'];
      oc.polar = 0.5;      // look down at the workbench
      oc.setView(new THREE.Vector3(0, 0, 0), Math.max(2, Math.max(maxRowW, totalD) * S * 0.85));
    }
  }

  // Lay part flat: smallest dimension becomes vertical.
  function footprint(p) {
    if (p.shape === 'cylinder') {
      var d2 = p.dimensions.radius * 2;
      return { w: d2, d: p.dimensions.height, h: d2, rot: { x: 90, y: 0, z: 0 } }; // lying on side along z
    }
    var d = p.dimensions;
    var min = Math.min(d.x, d.y, d.z);
    if (min === d.y) return { w: d.x, d: d.z, h: d.y, rot: { x: 0, y: 0, z: 0 } };
    if (min === d.x) return { w: d.y, d: d.z, h: d.x, rot: { x: 0, y: 0, z: 90 } };
    return { w: d.x, d: d.y, h: d.z, rot: { x: 90, y: 0, z: 0 } };
  }

  function addLabel(p, posMM) {
    var el = document.createElement('a-entity');
    el.setAttribute('billboard', '');
    el.setAttribute('position', vec(posMM));
    el.setAttribute('text', {
      value: p.name + '\n' + window.Schema.dimsLabel(p),
      align: 'center', color: '#eceff1', width: 1.6, wrapCount: 28, baseline: 'bottom'
    });
    labelsRoot.appendChild(el);
  }

  // ---------- measure tool ----------
  function setMeasure(on) {
    measureMode = !!on;
    if (!on) clearMeasure();
  }

  function clearMeasure() {
    measurePt = null;
    while (measureRoot.firstChild) measureRoot.removeChild(measureRoot.firstChild);
  }

  function measureMarker(pt) {
    var m = document.createElement('a-entity');
    m.setAttribute('geometry', { primitive: 'sphere', radius: 0.009, segmentsWidth: 10, segmentsHeight: 8 });
    m.setAttribute('material', { shader: 'flat', color: '#00e5ff' });
    m.setAttribute('position', pt.x + ' ' + pt.y + ' ' + pt.z);
    measureRoot.appendChild(m);
  }

  function addMeasurePoint(inter) {
    if (!inter || !inter.point) return;
    var pt = inter.point.clone();
    if (!measurePt) {
      clearMeasure();           // start a fresh measurement
      measureMarker(pt);
      measurePt = pt;
      return;
    }
    measureMarker(pt);
    var a = measurePt, b = pt;
    var line = document.createElement('a-entity');
    line.setAttribute('line', { start: a.x + ' ' + a.y + ' ' + a.z, end: b.x + ' ' + b.y + ' ' + b.z, color: '#00e5ff' });
    measureRoot.appendChild(line);
    var distMM = Math.round(a.distanceTo(b) * 1000);
    var label = document.createElement('a-entity');
    label.setAttribute('billboard', '');
    label.setAttribute('position', ((a.x + b.x) / 2) + ' ' + ((a.y + b.y) / 2 + 0.04) + ' ' + ((a.z + b.z) / 2));
    label.setAttribute('text', { value: distMM + ' mm', align: 'center', color: '#00e5ff', width: 1.4 });
    measureRoot.appendChild(label);
    measurePt = null;
    if (cb.onMeasure) cb.onMeasure(distMM);
  }

  // ---------- assembly mode ----------
  function setStep(n) {
    if (!design) return;
    asmStep = Math.min(design.assembly.length, Math.max(1, n));
    applyAssemblyVisibility();
    design.parts.forEach(function (p) { refreshVisual(p.id); });
    (design.plants || []).forEach(function (p) { refreshVisual(p.id); });
    if (mode === 'assembly') animateStepIn();
    return design.assembly[asmStep - 1];
  }

  // Parts of the current step drop into place from above.
  function animateStepIn() {
    var cur = design.assembly[asmStep - 1];
    if (!cur) return;
    cur.parts.forEach(function (id) {
      var p = design.parts.find(function (q) { return q.id === id; }) ||
              (design.plants || []).find(function (q) { return q.id === id; });
      var el = partEls[id] || plantEls[id];
      if (!p || !el) return;
      el.removeAttribute('animation__pos');
      el.setAttribute('position', vec({ x: p.position.x, y: p.position.y + 250, z: p.position.z }));
      el.setAttribute('animation__pos', { property: 'position', to: vec(p.position), dur: 550, easing: 'easeOutQuad' });
    });
  }

  function applyAssemblyVisibility() {
    design.parts.forEach(function (p) {
      var st = partStep(p.id);
      partEls[p.id].setAttribute('visible', st <= asmStep);
    });
    (design.plants || []).forEach(function (p) {
      if (plantEls[p.id]) plantEls[p.id].setAttribute('visible', partStep(p.id) <= asmStep);
    });
    (design.joints || []).forEach(function (j) {
      if (!jointEls[j.id]) return;
      var cur = design.assembly[asmStep - 1];
      var inCur = cur && cur.joints && cur.joints.indexOf(j.id) >= 0;
      var done = false;
      for (var i = 0; i < asmStep; i++) {
        if (design.assembly[i].joints && design.assembly[i].joints.indexOf(j.id) >= 0) done = true;
      }
      jointEls[j.id].setAttribute('visible', showJoints && done);
      jointEls[j.id].setAttribute('material', 'emissiveIntensity', inCur ? 0.7 : 0.12);
    });
  }

  // ---------- misc ----------
  function fitView() {
    if (!design || !camEl || (!design.parts.length && !(design.plants || []).length)) return;
    var min = { x: 1e9, y: 1e9, z: 1e9 }, max = { x: -1e9, y: -1e9, z: -1e9 };
    design.parts.forEach(function (p) {
      var half = p.shape === 'cylinder'
        ? { x: p.dimensions.radius, y: p.dimensions.height / 2, z: p.dimensions.radius }
        : { x: p.dimensions.x / 2, y: p.dimensions.y / 2, z: p.dimensions.z / 2 };
      ['x', 'y', 'z'].forEach(function (a) {
        min[a] = Math.min(min[a], p.position[a] - half[a]);
        max[a] = Math.max(max[a], p.position[a] + half[a]);
      });
    });
    (design.plants || []).forEach(function (p) {
      var half = { x: p.matureDiameter / 2, z: p.matureDiameter / 2 };
      min.x = Math.min(min.x, p.position.x - half.x); max.x = Math.max(max.x, p.position.x + half.x);
      min.z = Math.min(min.z, p.position.z - half.z); max.z = Math.max(max.z, p.position.z + half.z);
      min.y = Math.min(min.y, p.position.y); max.y = Math.max(max.y, p.position.y + p.matureHeight);
    });
    var size = Math.max(max.x - min.x, max.y - min.y, max.z - min.z) * S;
    var c = new THREE.Vector3((min.x + max.x) / 2 * S, (min.y + max.y) / 2 * S, (min.z + max.z) / 2 * S);
    function apply() { camEl.components['orbit-cam'].setView(c, Math.max(1, size * 1.7)); }
    if (camEl.components['orbit-cam']) apply();
    else camEl.addEventListener('componentinitialized', function h(e) { if (e.detail.name === 'orbit-cam') { camEl.removeEventListener('componentinitialized', h); apply(); } });
  }

  function setShowJoints(v) {
    showJoints = v;
    jointsRoot.setAttribute('visible', v && mode !== 'prep');
  }

  function screenshot(w) {
    try {
      var canvas = sceneEl.canvas;
      // Without preserveDrawingBuffer the canvas is cleared after each frame:
      // force a fresh render right before reading pixels.
      if (sceneEl.renderer && sceneEl.camera) sceneEl.renderer.render(sceneEl.object3D, sceneEl.camera);
      var c2 = document.createElement('canvas');
      var scale = (w || 240) / canvas.width;
      c2.width = w || 240; c2.height = Math.round(canvas.height * scale);
      c2.getContext('2d').drawImage(canvas, 0, 0, c2.width, c2.height);
      return c2.toDataURL('image/jpeg', 0.7);
    } catch (e) { return null; }
  }

  /* Capture the design from several angles (for vision-model review).
   * Returns array of JPEG data URLs; camera state is restored afterwards. */
  function captureViews(width) {
    var oc = camEl && camEl.components['orbit-cam'];
    if (!oc || !design || !design.parts.length) return [];
    var saved = { az: oc.azimuth, po: oc.polar, r: oc.radius, t: oc.target.clone() };
    fitView();
    var shots = [];
    // front-left iso, back-right iso, low front (support/floor problems show here)
    [[Math.PI / 4, Math.PI / 3], [-3 * Math.PI / 4, Math.PI / 3], [0, Math.PI / 2.1]].forEach(function (v) {
      oc.azimuth = v[0]; oc.polar = v[1];
      oc.update3D();
      var shot = screenshot(width || 512);
      if (shot) shots.push(shot);
    });
    oc.azimuth = saved.az; oc.polar = saved.po; oc.radius = saved.r;
    oc.target.copy(saved.t);
    oc.update3D();
    return shots;
  }

  function focusPart(id) {
    if (!camEl.components['orbit-cam'] || !design) return;
    var p = design.parts.find(function (q) { return q.id === id; });
    var pl = !p && (design.plants || []).find(function (q) { return q.id === id; });
    var el = partEls[id] || plantEls[id];
    if ((!p && !pl) || !el) return;
    var wp = new THREE.Vector3();
    el.object3D.getWorldPosition(wp);
    var size = p
      ? (p.shape === 'cylinder' ? p.dimensions.height : Math.max(p.dimensions.x, p.dimensions.y, p.dimensions.z))
      : Math.max(pl.matureHeight, pl.matureDiameter);
    camEl.components['orbit-cam'].setView(wp, Math.max(0.6, size * S * 2.4));
  }

  // Re-apply one part's/plant's transform after external position changes (nudge tool).
  function updatePartTransform(id) {
    if (!design) return;
    var pl = (design.plants || []).find(function (q) { return q.id === id; });
    if (pl && plantEls[id]) {
      plantEls[id].setAttribute('animation__pos', { property: 'position', to: vec(pl.position), dur: 300, easing: 'easeInOutQuad' });
      return;
    }
    var p = design.parts.find(function (q) { return q.id === id; });
    var el = partEls[id];
    if (!p || !el) return;
    if (mode === 'prep') layoutPrep(false);
    else setTransform(el, modelPos(p), p.rotation, true);
  }

  window.Viewer = {
    init: init,
    loadDesign: loadDesign,
    setMeasure: setMeasure,
    updatePartTransform: updatePartTransform,
    setMode: setMode,
    getMode: function () { return mode; },
    setExplode: setExplode,
    setStep: setStep,
    getStep: function () { return asmStep; },
    setShowJoints: setShowJoints,
    setSelection: setSelection,
    clearSelection: clearSelection,
    getSelection: function () { return Object.keys(selected); },
    refreshMaterials: refreshMaterials,
    refreshPlants: refreshPlants,
    fitView: fitView,
    focusPart: focusPart,
    screenshot: screenshot,
    captureViews: captureViews
  };
})();
