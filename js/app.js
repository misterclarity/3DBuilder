/* app.js — UI wiring: chat, tabs, settings, library, i18n, dirty tracking. Loaded after A-Frame. */
(function () {
  'use strict';

  var currentDesign = null;
  var currentRecordId = null;
  var currentName = null;
  var chatHistory = [];      // [{role, content}] for LLM context (trimmed)
  var activeReq = null;
  var selectedIds = [];
  var dirty = false;         // unsaved changes to the current design
  var history = [], hIndex = -1, lastPlan = null;   // undo/redo snapshots + last cutting plan

  var $ = function (id) { return document.getElementById(id); };
  var t = function (k, v) { return window.I18n ? I18n.t(k, v) : k; };

  // ---------- boot ----------
  function dbg(level, msg) { if (window.Debug) Debug.log(level, 'app', msg); }
  dbg('info', 'app.js starting');
  $('aframeLoading').remove();
  try {
    Viewer.init($('viewport'), {
      onSelect: onSelectionChanged,
      onPartInfo: showPartCard,
      onJointInfo: showJointCard,
      onMeasure: function (d) { addMsg('sys', t('msg.measured', { d: d })); }
    });
  } catch (e) {
    dbg('error', 'Viewer.init failed: ' + e.message);
    throw e;
  }

  // language selectors
  $('langSel').value = I18n.getLang();
  $('langSel').onchange = function () { switchLanguage(this.value); };
  function switchLanguage(l) {
    I18n.setLang(l);
    var s = LLM.settings(); s.language = l; LLM.saveSettings(s);
    $('langSel').value = l;
    renderCutList(); renderSteps(); renderFinishing();
    if (Viewer.getMode() === 'assembly') gotoStep(Viewer.getStep());
    dbg('info', 'Language switched to ' + l);
  }

  addMsg('sys', t('msg.welcome'));
  setDesign(Schema.sampleBed(), 'Single bed (900×2000) — sample');
  dirty = false;
  resetHistory();
  addMsg('sys', t('msg.sampleLoaded'));
  testConn();

  window.addEventListener('beforeunload', function (e) {
    if (dirty) { e.preventDefault(); e.returnValue = ''; }
  });

  function markDirty() { dirty = true; }
  function confirmDiscard() { return !dirty || confirm(t('confirm.unsaved')); }

  // ---------- undo / redo ----------
  function snapshot() { return { design: JSON.parse(JSON.stringify(currentDesign)), name: currentName }; }
  function resetHistory() {
    history = currentDesign ? [snapshot()] : [];
    hIndex = history.length - 1;
    updateUndoUI();
  }
  function pushHistory() {
    if (!currentDesign) return;
    history = history.slice(0, hIndex + 1);
    history.push(snapshot());
    if (history.length > 25) history.shift();
    hIndex = history.length - 1;
    updateUndoUI();
  }
  function restoreHistory(i) {
    if (i < 0 || i >= history.length || i === hIndex) return;
    hIndex = i;
    var snap = history[i];
    setDesign(JSON.parse(JSON.stringify(snap.design)), snap.name);
    dirty = true;
    updateUndoUI();
  }
  function updateUndoUI() {
    $('btnUndo').disabled = hIndex <= 0;
    $('btnRedo').disabled = hIndex >= history.length - 1;
  }
  $('btnUndo').onclick = function () { restoreHistory(hIndex - 1); };
  $('btnRedo').onclick = function () { restoreHistory(hIndex + 1); };
  window.addEventListener('keydown', function (e) {
    if (e.target && (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
    if (e.ctrlKey && !e.shiftKey && e.key.toLowerCase() === 'z') { e.preventDefault(); restoreHistory(hIndex - 1); }
    else if ((e.ctrlKey && e.key.toLowerCase() === 'y') || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'z')) { e.preventDefault(); restoreHistory(hIndex + 1); }
  });

  // ---------- measure tool ----------
  var measuring = false;
  $('btnMeasure').onclick = function () {
    measuring = !measuring;
    Viewer.setMeasure(measuring);
    this.classList.toggle('activeTool', measuring);
    if (measuring) addMsg('sys', t('msg.measureOn'));
  };

  // ---------- OBJ export ----------
  $('btnObj').onclick = function () {
    if (currentDesign) Export3D.exportOBJ(currentDesign, currentName);
  };

  // ---------- PDF plans export ----------
  $('btnPdf').onclick = function () {
    if (!currentDesign) { addMsg('sys', t('msg.nothingToSave')); return; }
    var btn = this;
    btn.disabled = true;
    Plans.exportPDF(currentDesign, currentName, t, lastPlan)
      .then(function () { addMsg('sys', t('msg.pdfDone')); })
      .catch(function (e) { addMsg('err', t('err.pdf', { e: e.message })); })
      .then(function () { btn.disabled = false; });
  };

  // ---------- part-level diff for AI modifications ----------
  function diffDesigns(a, b) {
    var am = {}, bm = {};
    a.parts.forEach(function (p) { am[p.id] = JSON.stringify(p); });
    b.parts.forEach(function (p) { bm[p.id] = JSON.stringify(p); });
    var added = 0, removed = 0, modified = 0;
    Object.keys(bm).forEach(function (id) { if (!am[id]) added++; else if (am[id] !== bm[id]) modified++; });
    Object.keys(am).forEach(function (id) { if (!bm[id]) removed++; });
    if (!added && !removed && !modified) return null;
    return t('diff.summary', { a: added, r: removed, m: modified });
  }

  // ---------- chat ----------
  function addMsg(kind, text) {
    var div = document.createElement('div');
    div.className = 'msg ' + kind;
    div.textContent = text;
    $('chatLog').appendChild(div);
    $('chatLog').scrollTop = $('chatLog').scrollHeight;
    return div;
  }

  function addClarify(message, questions) {
    var div = addMsg('ai', message || t('chat.clarifyIntro'));
    (questions || []).forEach(function (q) {
      var b = document.createElement('button');
      b.className = 'qbtn';
      b.textContent = q;
      b.onclick = function () {
        $('chatInput').value = q + '\n→ ';
        $('chatInput').focus();
        $('chatInput').selectionStart = $('chatInput').value.length;
      };
      div.appendChild(b);
    });
  }

  function send() {
    var text = $('chatInput').value.trim();
    if (!text || activeReq) return;
    $('chatInput').value = '';
    addMsg('user', text);
    chatHistory.push({ role: 'user', content: text });

    var thinking = addMsg('ai', '');
    thinking.classList.add('thinking');
    thinking.textContent = t('chat.designing');
    $('btnSend').classList.add('hidden');
    $('btnStop').classList.remove('hidden');

    var msgs = Prompts.buildMessages(chatHistory.slice(0, -1).slice(-10), currentDesign, selectedIds, text);
    activeReq = LLM.chat(msgs, function (_d, full) {
      thinking.textContent = t('chat.designing') + ' (' + full.length + ')';
    }, { responseSchema: Schema.ENVELOPE });

    activeReq.promise.then(function (full) {
      finishReq();
      thinking.remove();
      handleResponse(full);
    }).catch(function (err) {
      finishReq();
      thinking.remove();
      if (err && err.name === 'AbortError') { addMsg('sys', t('msg.stopped')); return; }
      dbg('error', 'LLM request failed: ' + err.message);
      var m = addMsg('err', t('err.noai', { e: err.message }));
      var hint = document.createElement('details');
      hint.innerHTML = t('err.troubleshoot');
      m.appendChild(hint);
    });
  }

  function finishReq() {
    activeReq = null;
    $('btnSend').classList.remove('hidden');
    $('btnStop').classList.add('hidden');
  }

  function handleResponse(full) {
    var env = LLM.extractJSON(full);
    dbg(env ? 'info' : 'error', 'AI response: ' + full.length + ' chars, parsed type=' + (env && env.type));
    if (!env || !env.type) {
      var m = addMsg('err', t('err.parse'));
      var det = document.createElement('details');
      det.innerHTML = '<summary>' + t('err.raw') + '</summary>';
      var pre = document.createElement('pre'); pre.textContent = full.slice(0, 4000);
      det.appendChild(pre); m.appendChild(det);
      chatHistory.push({ role: 'assistant', content: full.slice(0, 500) });
      return;
    }
    if (env.type === 'clarify') {
      addClarify(env.message, env.questions);
      chatHistory.push({ role: 'assistant', content: JSON.stringify({ type: 'clarify', message: env.message, questions: env.questions }) });
      return;
    }
    if (env.type === 'chat') {
      addMsg('ai', env.message || '…');
      chatHistory.push({ role: 'assistant', content: JSON.stringify({ type: 'chat', message: env.message }) });
      return;
    }
    if (env.type === 'design') {
      applyDesignEnvelope(env, Schema.validate(env.design), []);
      return;
    }
    if (env.type === 'patch') {
      if (!currentDesign) {
        addMsg('err', t('err.patchNoDesign'));
        chatHistory.push({ role: 'assistant', content: 'Sent a patch but there is no current design.' });
        return;
      }
      var pr = Schema.applyPatch(currentDesign, env.ops || []);
      env.scope = 'modify';
      applyDesignEnvelope(env, Schema.validate(pr.design), pr.notes);
      return;
    }
    addMsg('err', t('err.unknownType', { t: env.type }));
  }

  // Shared handling for full-design and patch responses.
  function applyDesignEnvelope(env, v, extraNotes) {
    if (!v.ok) {
      addMsg('err', t('err.invalid', { e: v.errors.join('; ') }));
      chatHistory.push({ role: 'assistant', content: 'Produced invalid design: ' + v.errors.join('; ') });
      return;
    }
    // Joint sanity: snap misplaced markers, warn about impossible joints.
    var audit = Schema.auditJoints(v.design);
    var diffMsg = (currentDesign && env.scope !== 'new') ? diffDesigns(currentDesign, v.design) : null;
    var isNewProject = env.scope === 'new' && currentDesign && v.design.meta.name !== currentDesign.meta.name;
    if (isNewProject && dirty) {
      // Don't lose unsaved work: silently back it up to the library first.
      var backupName = (currentName || currentDesign.meta.name);
      Store.save({ name: backupName, design: currentDesign, chat: chatHistory.slice(-14), thumbnail: Viewer.screenshot(240) })
        .then(function () { addMsg('sys', t('msg.autosaved', { n: backupName })); })
        .catch(function () {});
      currentRecordId = null;
    }
    // Patches keep the user's chosen name; new designs adopt the design name.
    setDesign(v.design, (env.type === 'patch' && currentName) ? currentName : v.design.meta.name);
    markDirty();
    pushHistory();
    var summary = env.summary || v.design.meta.name;
    addMsg('ai', summary + '\n' + t('msg.designStats', { p: v.design.parts.length, s: v.design.assembly.length }));
    if (diffMsg) addMsg('sys', diffMsg);
    var warnBits = [];
    if (audit.moved) warnBits.push(t('audit.moved', { n: audit.moved }));
    audit.notouch.forEach(function (id) { warnBits.push(t('audit.notouch', { id: id })); });
    (extraNotes || []).forEach(function (n) { warnBits.push(n); });
    if (v.warnings.length) warnBits.push(v.warnings.slice(0, 2).join(' · '));
    if (warnBits.length) {
      var wm = addMsg('sys', '⚠ ' + warnBits.join('\n⚠ '));
      wm.title = v.warnings.concat(audit.notouch).concat(extraNotes || []).join('\n');
    }
    // Keep history light: don't repeat the whole design (it is re-injected each turn).
    chatHistory.push({ role: 'assistant', content: JSON.stringify({ type: env.type, scope: env.scope || 'new', summary: summary }) });
  }

  setInterval(function () {
    if (chatHistory.length > 14) chatHistory = chatHistory.slice(-14);
  }, 5000);

  $('btnSend').onclick = send;
  $('btnStop').onclick = function () { if (activeReq) activeReq.abort(); };
  $('chatInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  });

  // ---------- design / tabs ----------
  function setDesign(d, name) {
    currentDesign = d;
    currentName = name || (d && d.meta.name) || 'Untitled';
    Viewer.loadDesign(d);
    setModeUI('model');
    renderCutList();
    renderSteps();
    renderFinishing();
    document.title = currentName + ' — DIY Workshop';
  }

  function renderCutList() {
    var el = $('tab-cutlist');
    if (!currentDesign) { el.innerHTML = '<i>' + t('cut.empty') + '</i>'; return; }
    var groups = Schema.cutList(currentDesign);
    var html = '<table class="cut"><tr><th>' + t('cut.qty') + '</th><th>' + t('cut.part') + '</th><th>' + t('cut.dims') + '</th><th>' + t('cut.stock') + '</th><th>' + t('cut.mat') + '</th></tr>';
    groups.forEach(function (g, i) {
      html += '<tr data-i="' + i + '"><td>' + g.qty + '×</td><td>' + esc(g.name) + '</td><td>' + g.dims + '</td><td>' + esc(g.stock || '—') + '</td><td>' + esc(g.species) + '</td></tr>';
    });
    html += '</table>';
    if (currentDesign.hardware.length) {
      html += '<h4 style="margin:10px 0 4px">' + t('cut.hardware') + '</h4><table class="cut">';
      currentDesign.hardware.forEach(function (h) {
        html += '<tr><td>' + h.quantity + '×</td><td>' + esc(h.name) + '</td><td colspan="3">' + esc(h.note || '') + '</td></tr>';
      });
      html += '</table>';
    }
    el.innerHTML = html;
    el.querySelectorAll('tr[data-i]').forEach(function (tr) {
      tr.onclick = function () {
        var g = groups[Number(tr.dataset.i)];
        Viewer.setSelection(g.ids);
        showPartCard(currentDesign.parts.find(function (p) { return p.id === g.ids[0]; }));
      };
    });
    // Board/sheet optimization diagrams + cost estimate
    lastPlan = Optimizer.plan(currentDesign);
    var optDiv = document.createElement('div');
    optDiv.innerHTML = Optimizer.renderHTML(lastPlan, t);
    el.appendChild(optDiv);
    el.appendChild(renderCost(lastPlan));
  }

  // ---------- cost estimate ----------
  function loadPrices() {
    try { return JSON.parse(localStorage.getItem('diyw_prices') || '{}'); } catch (e) { return {}; }
  }

  function renderCost(plan) {
    var prices = loadPrices();
    var rows = [];
    plan.boardGroups.forEach(function (g) { rows.push({ key: g.key, qty: g.boards.length }); });
    plan.sheetGroups.forEach(function (g) { rows.push({ key: g.key + ' (' + t('opt.sheet') + ')', qty: g.sheets.length }); });
    (currentDesign.hardware || []).forEach(function (h) { rows.push({ key: h.name, qty: h.quantity }); });
    var div = document.createElement('div');
    var h = '<h4 style="margin:14px 0 4px">' + t('cost.title') + '</h4><table class="cut costT"><tr><th>' +
      t('cost.qty') + '</th><th>' + t('cost.item') + '</th><th>' + t('cost.unit') + '</th><th>' + t('cost.sum') + '</th></tr>';
    rows.forEach(function (r) {
      var pr = prices[r.key] != null ? prices[r.key] : '';
      h += '<tr><td>' + r.qty + '×</td><td>' + esc(r.key) + '</td><td><input type="number" step="0.5" min="0" data-k="' + esc(r.key) + '" data-q="' + r.qty + '" value="' + pr + '" style="width:80px"></td><td class="sum">—</td></tr>';
    });
    h += '<tr><td colspan="3" style="text-align:right"><b>' + t('cost.total') + '</b></td><td class="costTotal"><b>—</b></td></tr></table>' +
      '<small style="color:#90a0aa">' + t('cost.hint') + '</small>';
    div.innerHTML = h;
    function recalc() {
      var tot = 0, any = false;
      div.querySelectorAll('input[data-k]').forEach(function (inp) {
        var v = parseFloat(inp.value);
        var cell = inp.closest('tr').querySelector('.sum');
        if (isFinite(v)) { any = true; var s = v * Number(inp.dataset.q); tot += s; cell.textContent = s.toFixed(2); }
        else cell.textContent = '—';
      });
      div.querySelector('.costTotal').innerHTML = '<b>' + (any ? tot.toFixed(2) : '—') + '</b>';
    }
    div.addEventListener('input', function (ev) {
      if (ev.target.dataset.k == null) return;
      var p = loadPrices();
      var v = parseFloat(ev.target.value);
      if (isFinite(v)) p[ev.target.dataset.k] = v; else delete p[ev.target.dataset.k];
      localStorage.setItem('diyw_prices', JSON.stringify(p));
      recalc();
    });
    recalc();
    return div;
  }

  function renderSteps() {
    var el = $('tab-steps');
    if (!currentDesign) { el.innerHTML = ''; return; }
    el.innerHTML = '';
    currentDesign.assembly.forEach(function (s) {
      var d = document.createElement('div');
      d.className = 'stepItem';
      d.dataset.step = s.step;
      d.innerHTML = '<b>' + t('steps.step') + ' ' + s.step + ': ' + esc(s.title) + '</b>' + esc(s.instruction) +
        '<small>' + t('steps.partcount', { n: s.parts.length }) + (s.joints && s.joints.length ? ' · ' + t('steps.joints') + s.joints.map(function (j) { return jointLabel(j); }).join(', ') : '') + '</small>';
      d.onclick = function () { setModeUI('assembly'); gotoStep(s.step); };
      el.appendChild(d);
    });
  }

  function jointLabel(jid) {
    var j = currentDesign.joints.find(function (q) { return q.id === jid; });
    return j ? j.type.replace(/_/g, ' ') : jid;
  }

  function renderFinishing() {
    var el = $('tab-finishing');
    if (!currentDesign) { el.innerHTML = ''; return; }
    var html = '';
    if (currentDesign.finishing.length) {
      currentDesign.finishing.forEach(function (f) {
        html += '<div class="finRow"><b>' + f.step + '. ' + esc(f.title) + '</b><br>' + esc(f.instruction) + '</div>';
      });
    } else {
      html += '<i>' + t('fin.none') + '</i>';
    }
    html += '<h4 style="margin:12px 0 2px">' + t('fin.quick', { t: (selectedIds.length ? t('fin.selected') : t('fin.all')) }) + '</h4><div class="finPresets" id="finPresets"></div>';
    el.innerHTML = html;
    var wrap = $('finPresets');
    Materials.STAIN_PRESETS.forEach(function (pr, i) {
      var b = document.createElement('button');
      b.textContent = t('preset' + i);
      if (pr.color) { b.style.borderColor = pr.color; }
      b.onclick = function () { applyFinish(pr, t('preset' + i)); };
      wrap.appendChild(b);
    });
  }

  function applyFinish(preset, label) {
    if (!currentDesign) return;
    var targets = selectedIds.length ? selectedIds : currentDesign.parts.map(function (p) { return p.id; });
    currentDesign.parts.forEach(function (p) {
      if (targets.indexOf(p.id) < 0) return;
      p.material.color = preset.color;
      p.material.finish = preset.finish;
      p.material.shine = preset.shine;
    });
    Viewer.refreshMaterials();
    markDirty();
    pushHistory();
    addMsg('sys', t('msg.applied', { n: label, c: targets.length }));
  }

  // ---------- part card ----------
  var cardPart = null;
  function showPartCard(p) {
    cardPart = p;
    if (!p) { $('partCard').classList.add('hidden'); return; }
    $('pcName').textContent = p.name;
    var joints = (currentDesign.joints || []).filter(function (j) { return j.parts.indexOf(p.id) >= 0; });
    var html = '<div class="kv">' + t('pc.dimensions') + ': <b>' + Schema.dimsLabel(p) + '</b></div>' +
      '<div class="kv">' + t('pc.stock') + ': ' + esc(p.stock || '—') + ' · ' + t('pc.material') + ': ' + esc(p.material.species) + ' (' + esc(p.material.finish) + ')</div>' +
      '<div class="kv" style="margin-top:6px"><b>' + t('pc.prep') + '</b></div><ul>';
    p.prep.operations.forEach(function (o) { html += '<li><b>' + esc(o.type) + '</b> — ' + esc(o.instruction) + '</li>'; });
    html += '</ul>';
    if (p.prep.notes) html += '<div class="kv">' + t('pc.notes') + ': ' + esc(p.prep.notes) + '</div>';
    if (joints.length) {
      html += '<div class="kv"><b>' + t('pc.connections') + '</b></div><ul>';
      joints.forEach(function (j) {
        var other = j.parts.filter(function (x) { return x !== p.id; }).map(partName).join(', ');
        html += '<li>' + esc(j.type.replace(/_/g, ' ')) + (other ? ' → ' + esc(other) : '') + (j.note ? ' (' + esc(j.note) + ')' : '') + '</li>';
      });
      html += '</ul>';
    }
    html += '<div class="kv">' + t('pc.step') + ': ' + stepOf(p.id) + '</div>';
    $('pcBody').innerHTML = html;
    $('pcColor').value = p.material.color || '#d9b380';
    $('pcFinish').value = p.material.finish;
    $('pcShine').value = Math.round((p.material.shine || 0) * 100);
    $('partCard').classList.remove('hidden');
  }

  function showJointCard(j) {
    if (!j) return;
    $('pcName').textContent = t('pc.joint') + ': ' + j.type.replace(/_/g, ' ');
    $('pcBody').innerHTML = '<div class="kv">' + t('pc.connects') + ': ' + j.parts.map(partName).map(esc).join(' + ') + '</div>' +
      (j.note ? '<div class="kv">' + esc(j.note) + '</div>' : '');
    $('partCard').classList.remove('hidden');
  }

  function partName(id) {
    var p = currentDesign && currentDesign.parts.find(function (q) { return q.id === id; });
    return p ? p.name : id;
  }

  function stepOf(id) {
    var s = currentDesign.assembly.find(function (st) { return st.parts.indexOf(id) >= 0; });
    return s ? s.step + ' (' + s.title + ')' : '—';
  }

  $('pcClose').onclick = function () { $('partCard').classList.add('hidden'); Viewer.clearSelection(); };
  $('pcFocus').onclick = function () { if (cardPart) Viewer.focusPart(cardPart.id); };
  $('pcApply').onclick = function () {
    if (!cardPart) return;
    var targets = selectedIds.length ? selectedIds : [cardPart.id];
    targets.forEach(function (id) {
      var p = currentDesign.parts.find(function (q) { return q.id === id; });
      if (!p) return;
      p.material.color = $('pcColor').value;
      p.material.finish = $('pcFinish').value;
      p.material.shine = Number($('pcShine').value) / 100;
    });
    Viewer.refreshMaterials();
    markDirty();
    pushHistory();
    addMsg('sys', t('msg.updated', { c: targets.length }));
  };

  // ---------- part nudge (move) ----------
  var moveTimer = null;
  document.querySelectorAll('#pcMove button[data-axis]').forEach(function (b) {
    b.onclick = function () {
      if (!cardPart || !currentDesign) return;
      var step = Number($('pcStep').value) * Number(b.dataset.dir);
      var targets = selectedIds.length ? selectedIds : [cardPart.id];
      targets.forEach(function (id) {
        var p = currentDesign.parts.find(function (q) { return q.id === id; });
        if (!p) return;
        p.position[b.dataset.axis] += step;
        Viewer.updatePartTransform(id);
      });
      markDirty();
      clearTimeout(moveTimer);
      moveTimer = setTimeout(pushHistory, 800);
    };
  });

  function onSelectionChanged(ids) {
    selectedIds = ids;
    if (ids.length) {
      $('selChipText').textContent = t('sel.prefix') + ids.map(partName).join(', ');
      $('selChip').classList.remove('hidden');
    } else {
      $('selChip').classList.add('hidden');
    }
    renderFinishing();
  }
  $('selChipClear').onclick = function () { Viewer.clearSelection(); };

  // ---------- viewer toolbar ----------
  function setModeUI(m) {
    document.querySelectorAll('.modeBtn').forEach(function (b) { b.classList.toggle('active', b.dataset.mode === m); });
    Viewer.setMode(m);
    $('explodeWrap').style.visibility = (m === 'model') ? 'visible' : 'hidden';
    if (m === 'assembly') { $('asmBar').classList.remove('hidden'); gotoStep(Viewer.getStep()); }
    else $('asmBar').classList.add('hidden');
  }
  document.querySelectorAll('.modeBtn').forEach(function (b) {
    b.onclick = function () { setModeUI(b.dataset.mode); };
  });
  $('explodeSlider').oninput = function () { Viewer.setExplode(Number(this.value) / 100); };
  $('chkJoints').onchange = function () { Viewer.setShowJoints(this.checked); };
  $('btnFit').onclick = function () { Viewer.fitView(); };

  function gotoStep(n) {
    var s = Viewer.setStep(n);
    if (!s) return;
    $('asmTitle').textContent = t('asm.step', { a: s.step, b: currentDesign.assembly.length }) + s.title;
    $('asmText').textContent = s.instruction;
    document.querySelectorAll('.stepItem').forEach(function (el) { el.classList.toggle('cur', Number(el.dataset.step) === s.step); });
  }
  $('asmPrev').onclick = function () { gotoStep(Viewer.getStep() - 1); };
  $('asmNext').onclick = function () { gotoStep(Viewer.getStep() + 1); };

  // ---------- tabs ----------
  document.querySelectorAll('.tabBtn').forEach(function (b) {
    b.onclick = function () {
      document.querySelectorAll('.tabBtn').forEach(function (x) { x.classList.toggle('active', x === b); });
      document.querySelectorAll('.tabBody').forEach(function (x) { x.classList.toggle('active', x.id === 'tab-' + b.dataset.tab); });
    };
  });

  // ---------- top bar ----------
  $('btnNew').onclick = function () {
    if (!confirmDiscard()) return;
    if (activeReq) activeReq.abort();   // a late AI response must not overwrite the new design
    currentRecordId = null;
    chatHistory = [];
    dirty = false;
    setDesign(null, 'New design');
    resetHistory();
    addMsg('sys', t('msg.newStarted'));
  };

  $('btnSave').onclick = function () {
    if (!currentDesign) { addMsg('sys', t('msg.nothingToSave')); return; }
    var name = prompt(t('save.prompt'), currentName || currentDesign.meta.name);
    if (!name) return;
    currentName = name;
    Store.save({ id: currentRecordId || undefined, name: name, design: currentDesign, chat: chatHistory.slice(-14), thumbnail: Viewer.screenshot(240) })
      .then(function (rec) { currentRecordId = rec.id; dirty = false; addMsg('sys', t('msg.saved', { n: name })); })
      .catch(function (e) { addMsg('err', t('err.saveFailed', { e: e.message })); });
  };

  $('btnExport').onclick = function () {
    if (!currentDesign) return;
    Store.exportJSON({ name: currentName, design: currentDesign, chat: chatHistory.slice(-14) });
  };

  $('btnImport').onclick = function () { $('fileImport').click(); };
  $('fileImport').onchange = function () {
    var f = this.files[0];
    if (!f) return;
    if (!confirmDiscard()) { this.value = ''; return; }
    if (activeReq) activeReq.abort();
    Store.importJSON(f).then(function (r) {
      currentRecordId = null;
      chatHistory = r.chat || [];
      setDesign(r.design, r.name);
      dirty = false;
      resetHistory();
      addMsg('sys', t('msg.imported', { n: r.name }));
    }).catch(function (e) { addMsg('err', t('err.importFailed', { e: e.message })); });
    this.value = '';
  };

  // ---------- library ----------
  $('btnLibrary').onclick = function () { openLibrary(); };
  $('libClose').onclick = function () { $('libraryModal').classList.add('hidden'); };

  function openLibrary() {
    Store.list().then(function (items) {
      var el = $('libList');
      el.innerHTML = items.length ? '' : '<i>' + t('lib.empty') + '</i>';
      items.forEach(function (it) {
        var d = document.createElement('div');
        d.className = 'libItem';
        d.innerHTML = (it.thumbnail ? '<img src="' + it.thumbnail + '">' : '<div class="noThumb">🪵</div>') +
          '<div class="libMeta"><b>' + esc(it.name) + '</b><small>' + t('lib.parts', { n: it.partCount }) + ' · ' + new Date(it.updatedAt).toLocaleString() + '</small></div>' +
          '<div class="libBtns"><button data-a="load" class="primary">' + t('btn.load') + '</button><button data-a="del">' + t('btn.delete') + '</button></div>';
        d.querySelector('[data-a=load]').onclick = function () {
          if (!confirmDiscard()) return;
          if (activeReq) activeReq.abort();
          Store.get(it.id).then(function (rec) {
            currentRecordId = rec.id;
            chatHistory = rec.chat || [];
            setDesign(rec.design, rec.name);
            dirty = false;
            resetHistory();
            $('libraryModal').classList.add('hidden');
            addMsg('sys', t('msg.loaded', { n: rec.name }));
          });
        };
        d.querySelector('[data-a=del]').onclick = function () {
          if (confirm(t('confirm.delete', { n: it.name }))) Store.remove(it.id).then(openLibrary);
        };
        el.appendChild(d);
      });
      $('libraryModal').classList.remove('hidden');
    });
  }

  // ---------- settings ----------
  // Fill the model <select>: keep the "Auto" option, add the saved model (if
  // any), then whatever the endpoint reports on /models.
  function populateModels(current) {
    var sel = $('setModel');
    while (sel.options.length > 1) sel.remove(1);
    if (current) {
      var o = document.createElement('option');
      o.value = current; o.textContent = current;
      sel.appendChild(o);
    }
    sel.value = current || '';
    LLM.listModels().then(function (models) {
      models.forEach(function (id) {
        if (id === current) return;
        var o = document.createElement('option');
        o.value = id; o.textContent = id;
        sel.appendChild(o);
      });
    }).catch(function () { /* endpoint unreachable — Auto still works later */ });
  }

  $('btnSettings').onclick = function () {
    var s = LLM.settings();
    $('setEndpoint').value = s.endpoint;
    populateModels(s.model);
    $('setTemp').value = s.temperature;
    $('setMaxTok').value = s.maxTokens;
    $('setStrict').value = s.strictJson || 'auto';
    $('setAframe').value = s.aframeVersion;
    $('setLang').value = s.language || I18n.getLang();
    $('setTestResult').textContent = '';
    $('settingsModal').classList.remove('hidden');
  };
  $('setCancel').onclick = function () { $('settingsModal').classList.add('hidden'); };

  function collectSettings() {
    return {
      endpoint: $('setEndpoint').value.trim(),
      model: $('setModel').value,
      temperature: $('setTemp').value.trim() === '' ? '' : (Number($('setTemp').value) || 0.4),
      maxTokens: $('setMaxTok').value.trim() === '' ? '' : (Number($('setMaxTok').value) || 16384),
      aframeVersion: $('setAframe').value.trim() || '1.8.0',
      language: $('setLang').value,
      strictJson: $('setStrict').value
    };
  }

  $('setSaveBtn').onclick = function () {
    var prevVer = LLM.settings().aframeVersion;
    var s = collectSettings();
    LLM.saveSettings(s);
    $('settingsModal').classList.add('hidden');
    switchLanguage(s.language);
    testConn();
    if (s.aframeVersion !== prevVer) {
      // User already confirmed the reload — don't let the unsaved-changes guard block it too.
      if (confirm(t('set.reload'))) { dirty = false; location.reload(); }
    }
  };
  $('setTest').onclick = function () {
    $('setTestResult').textContent = t('set.testing');
    var saved = localStorage.getItem('diyw_settings');
    LLM.saveSettings(collectSettings());
    LLM.testConnection().then(function (r) {
      $('setTestResult').textContent = t('set.connected', { m: r.models.join(', ') || '—' });
      $('connDot').className = 'dot ok';
      populateModels($('setModel').value); // refresh list for the (possibly new) endpoint
    }).catch(function (e) {
      $('setTestResult').textContent = '✖ ' + e.message;
      $('connDot').className = 'dot err';
      if (saved) localStorage.setItem('diyw_settings', saved);
    });
  };

  function testConn() {
    LLM.testConnection().then(function (r) {
      $('connDot').className = 'dot ok';
      $('connDot').title = 'AI connected' + (r.models.length ? ' — ' + r.models[0] : '');
    }).catch(function (e) {
      $('connDot').className = 'dot err';
      $('connDot').title = 'AI not reachable: ' + e.message;
    });
  }

  // ---------- print ----------
  $('btnPrint').onclick = function () {
    if (!currentDesign) return;
    var old = $('printSheet');
    if (old) old.remove();
    var d = document.createElement('div');
    d.id = 'printSheet';
    var groups = Schema.cutList(currentDesign);
    var h = '<h1>' + esc(currentName) + '</h1><p>' + esc(currentDesign.meta.description || '') + '</p>';
    h += '<h2>' + t('print.cutlist') + '</h2><table><tr><th>' + t('cut.qty') + '</th><th>' + t('cut.part') + '</th><th>' + t('cut.dims') + '</th><th>' + t('cut.stock') + '</th><th>' + t('cut.mat') + '</th></tr>';
    groups.forEach(function (g) { h += '<tr><td>' + g.qty + '</td><td>' + esc(g.name) + '</td><td>' + g.dims + '</td><td>' + esc(g.stock || '') + '</td><td>' + esc(g.species) + '</td></tr>'; });
    h += '</table>';
    h += '<h2>' + t('print.prep') + '</h2>';
    currentDesign.parts.forEach(function (p) {
      h += '<p><b>' + esc(p.name) + '</b> (' + Schema.dimsLabel(p) + ')<br>' + p.prep.operations.map(function (o) { return '• ' + esc(o.type) + ': ' + esc(o.instruction); }).join('<br>') + '</p>';
    });
    if (currentDesign.hardware.length) {
      h += '<h2>' + t('print.hardware') + '</h2><table><tr><th>' + t('cut.qty') + '</th><th></th><th></th></tr>';
      currentDesign.hardware.forEach(function (hw) { h += '<tr><td>' + hw.quantity + '</td><td>' + esc(hw.name) + '</td><td>' + esc(hw.note || '') + '</td></tr>'; });
      h += '</table>';
    }
    h += '<h2>' + t('print.assembly') + '</h2>';
    currentDesign.assembly.forEach(function (s) { h += '<p><b>' + t('steps.step') + ' ' + s.step + ': ' + esc(s.title) + '</b><br>' + esc(s.instruction) + '</p>'; });
    if (currentDesign.finishing.length) {
      h += '<h2>' + t('print.finishing') + '</h2>';
      currentDesign.finishing.forEach(function (f) { h += '<p><b>' + f.step + '. ' + esc(f.title) + '</b><br>' + esc(f.instruction) + '</p>'; });
    }
    if (lastPlan) h += Optimizer.renderHTML(lastPlan, t);
    d.innerHTML = h;
    document.body.appendChild(d);
    window.print();
    setTimeout(function () { d.remove(); }, 500);
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; });
  }
})();
