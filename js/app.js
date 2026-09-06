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
  var lastUserText = '';     // last design request (context for the vision critic)
  var pendingVision = false; // run a vision review after the current turn settles
  var appMode = 'workshop';  // 'workshop' (furniture/DIY) | 'garden'
  var cardIsPlant = false;   // the part card currently shows a plant
  var sampleLoaded = null;   // 'bed' | 'garden' while the built-in sample is loaded unmodified
                             // (lets a language switch regenerate it in the new language)

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
      onPlantInfo: showPlantCard,
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
    var prevLang = I18n.getLang();
    I18n.setLang(l);
    var s = LLM.settings(); s.language = l; LLM.saveSettings(s);
    $('langSel').value = l;
    if (l !== prevLang && sampleLoaded && !dirty) {
      // Pristine built-in sample: regenerate it in the new language so plant
      // names, care texts, part names and steps switch too.
      setDesign(sampleLoaded === 'garden' ? Garden.sampleGarden() : Schema.sampleBed(),
        sampleLoaded === 'bed' ? 'Single bed (900×2000) — sample' : null);
      dirty = false;
      resetHistory();
    } else {
      renderCutList(); renderSteps(); renderFinishing(); renderPlantsTab(); renderCareTab();
    }
    setAppMode(appMode); // refresh mode button label + placeholder
    if (Viewer.getMode() === 'assembly') gotoStep(Viewer.getStep());
    // Non-sample design loaded: its texts stay as generated — offer an AI translation.
    if (l !== prevLang && currentDesign && !(sampleLoaded && !dirty)) offerTranslate(l);
    dbg('info', 'Language switched to ' + l);
  }

  // ---------- AI design translation ----------
  function offerTranslate(target) {
    var m = addMsg('ai', t('msg.translateOffer'));
    var b = document.createElement('button');
    b.className = 'qbtn';
    b.textContent = t('btn.translate');
    b.onclick = function () { b.disabled = true; runTranslate(target); };
    m.appendChild(b);
  }

  /* Ask the AI to translate all design texts, then merge ONLY the text fields
   * (Schema.mergeTexts) — geometry, ids and species keys cannot be affected. */
  function runTranslate(target) {
    if (!currentDesign || activeReq) return;
    var note = addMsg('sys', t('msg.translating'));
    $('btnSend').classList.add('hidden');
    $('btnStop').classList.remove('hidden');
    activeReq = LLM.chat(Prompts.buildTranslateMessages(currentDesign, target), null, { responseSchema: Schema.ENVELOPE });
    activeReq.promise.then(function (full) {
      finishReq();
      note.remove();
      var env = LLM.extractJSON(full);
      if (!env || env.type !== 'design' || !env.design) { addMsg('err', t('msg.translateFail')); return; }
      var v = Schema.validate(Schema.mergeTexts(currentDesign, env.design));
      if (!v.ok) { addMsg('err', t('msg.translateFail')); return; }
      setDesign(v.design, v.design.meta.name);
      sampleLoaded = null;
      markDirty();
      pushHistory();
      addMsg('ai', '🌐 ' + (env.summary || t('msg.translated')));
    }).catch(function (err) {
      finishReq();
      note.remove();
      if (err && err.name === 'AbortError') addMsg('sys', t('msg.stopped'));
      else addMsg('err', t('msg.translateFail'));
    });
  }

  // ---------- workshop / garden mode ----------
  function setAppMode(m) {
    appMode = m;
    $('btnMode').textContent = t(m === 'garden' ? 'btn.mode.workshop' : 'btn.mode.garden');
    $('btnMode').title = t('btn.mode.title');
    $('chatInput').placeholder = t(m === 'garden' ? 'chat.placeholder.garden' : 'chat.placeholder');
    document.querySelectorAll('.gardenTab').forEach(function (b) { b.classList.toggle('hidden', m !== 'garden'); });
    var active = document.querySelector('.tabBtn.active');
    if (m !== 'garden' && active && (active.dataset.tab === 'plants' || active.dataset.tab === 'care')) activateTab('cutlist');
  }

  $('btnMode').onclick = function () {
    if (!confirmDiscard()) return;
    if (activeReq) activeReq.abort();
    var toGarden = appMode !== 'garden';
    currentRecordId = null;
    chatHistory = [];
    dirty = false;
    clearChatLog();
    setDesign(toGarden ? Garden.sampleGarden() : Schema.sampleBed(),
      toGarden ? null : 'Single bed (900×2000) — sample');
    sampleLoaded = toGarden ? 'garden' : 'bed';
    dirty = false;
    resetHistory();
    addMsg('sys', t(toGarden ? 'msg.gardenLoaded' : 'msg.sampleLoaded'));
  };

  addMsg('sys', t('msg.welcome'));
  setDesign(Schema.sampleBed(), 'Single bed (900×2000) — sample');
  sampleLoaded = 'bed';
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

  // ---------- Blender bridge (optional, off by default) ----------
  function updateBridgeUI() {
    var on = Blender.enabled();
    ['btnRender', 'btnStl', 'btnGlb'].forEach(function (id) { $(id).classList.toggle('hidden', !on); });
  }
  updateBridgeUI();

  $('btnRender').onclick = function () {
    if (!currentDesign || !Blender.enabled()) return;
    var btn = this;
    btn.disabled = true;
    var note = addMsg('sys', t('msg.rendering'));
    Blender.render(currentDesign, { width: 1024, height: 768 }).then(function (imgs) {
      note.remove();
      var m = addMsg('ai', '📷 ' + (currentName || ''));
      var img = document.createElement('img');
      img.src = imgs[0];
      img.alt = 'Blender render';
      img.style.cssText = 'max-width:100%;border-radius:8px;cursor:pointer;margin-top:6px';
      img.onclick = function () {
        var w = window.open('', '_blank');
        if (w) w.document.write('<title>Render</title><img src="' + imgs[0] + '" style="max-width:100%">');
      };
      m.appendChild(img);
    }).catch(function (e) {
      note.remove();
      addMsg('err', t('err.blender', { e: e.message }));
    }).then(function () { btn.disabled = false; });
  };

  function bridgeDownload(kind, btn) {
    if (!currentDesign || !Blender.enabled()) return;
    btn.disabled = true;
    var note = addMsg('sys', t('msg.exporting', { f: kind.toUpperCase() }));
    Blender.download(kind, currentDesign, currentName).then(function () {
      note.remove();
    }).catch(function (e) {
      note.remove();
      addMsg('err', t('err.blender', { e: e.message }));
    }).then(function () { btn.disabled = false; });
  }
  $('btnStl').onclick = function () { bridgeDownload('stl', this); };
  $('btnGlb').onclick = function () { bridgeDownload('glb', this); };

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
    a.parts.concat(a.plants || []).forEach(function (p) { am[p.id] = JSON.stringify(p); });
    b.parts.concat(b.plants || []).forEach(function (p) { bm[p.id] = JSON.stringify(p); });
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

  function clearChatLog() { $('chatLog').innerHTML = ''; }

  // Rebuild the visible chat log from a restored chatHistory (library load / import).
  function renderChatHistory() {
    clearChatLog();
    chatHistory.forEach(function (m) {
      if (m.role === 'user') { addMsg('user', m.content); return; }
      try {
        var env = JSON.parse(m.content);
        if (env.type === 'chat') addMsg('ai', env.message || '');
        else if (env.type === 'clarify') addClarify(env.message, env.questions);
        else if (env.summary) addMsg('ai', env.summary);
      } catch (e) { /* non-JSON assistant entry — skip */ }
    });
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
    lastUserText = text;
    pendingVision = true;

    var thinking = addMsg('ai', '');
    thinking.classList.add('thinking');
    $('btnSend').classList.add('hidden');
    $('btnStop').classList.remove('hidden');

    var hist = chatHistory.slice(0, -1).slice(-10);
    // Two-pass for designs from scratch: plan in text first, then generate geometry.
    if (LLM.settings().twoPass !== false && !currentDesign) planStage(hist, text, thinking);
    else buildStage(hist, text, null, thinking);
  }

  // Stage 1: free-text build plan (or direct clarify/chat JSON — handled as usual).
  function planStage(hist, text, thinking) {
    thinking.textContent = t('chat.planning');
    activeReq = LLM.chat(Prompts.buildPlanMessages(hist, currentDesign, selectedIds, text, appMode), function (_d, full) {
      thinking.textContent = t('chat.planning') + ' (' + full.length + ')';
    }, { onReasoning: function (_d, chars) { thinking.textContent = t('chat.thinking') + ' (' + chars + ')'; } });
    activeReq.promise.then(function (full) {
      var env = LLM.extractJSON(full);
      if (env && (env.type === 'clarify' || env.type === 'chat')) {
        finishReq();
        thinking.remove();
        handleResponse(full);
        return;
      }
      var plan = LLM.stripThink(full);
      if (!plan) { finishReq(); thinking.remove(); addMsg('err', t('err.parse')); return; }
      addPlanMsg(plan);
      dbg('info', 'Plan stage done (' + plan.length + ' chars), starting build stage');
      buildStage(hist, text, plan, thinking);
    }).catch(function (err) { reqFailed(err, thinking); });
  }

  // Stage 2 (or single pass): produce/modify the design JSON.
  function buildStage(hist, text, plan, thinking) {
    thinking.textContent = t('chat.designing');
    var msgs = Prompts.buildMessages(hist, currentDesign, selectedIds, text, plan, appMode);
    activeReq = LLM.chat(msgs, function (_d, full) {
      thinking.textContent = t('chat.designing') + ' (' + full.length + ')';
    }, { responseSchema: Schema.ENVELOPE,
         onReasoning: function (_d, chars) { thinking.textContent = t('chat.thinking') + ' (' + chars + ')'; } });
    activeReq.promise.then(function (full) {
      finishReq();
      thinking.remove();
      handleResponse(full);
    }).catch(function (err) { reqFailed(err, thinking); });
  }

  function reqFailed(err, thinking) {
    finishReq();
    if (thinking) thinking.remove();
    if (err && err.name === 'AbortError') { addMsg('sys', t('msg.stopped')); return; }
    dbg('error', 'LLM request failed: ' + err.message);
    var m = addMsg('err', t('err.noai', { e: err.message }));
    var hint = document.createElement('details');
    hint.innerHTML = t('err.troubleshoot');
    m.appendChild(hint);
  }

  // Collapsible build-plan message.
  function addPlanMsg(plan) {
    var div = addMsg('ai', '');
    var det = document.createElement('details');
    var sum = document.createElement('summary');
    sum.textContent = '📋 ' + t('chat.planTitle');
    var pre = document.createElement('pre');
    pre.textContent = plan;
    det.appendChild(sum);
    det.appendChild(pre);
    div.appendChild(det);
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
      applyDesignEnvelope(env, Schema.validate(env.design), [], 0);
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
      applyDesignEnvelope(env, Schema.validate(pr.design), pr.notes, 0);
      return;
    }
    addMsg('err', t('err.unknownType', { t: env.type }));
  }

  // Shared handling for full-design and patch responses. depth = repair round.
  function applyDesignEnvelope(env, v, extraNotes, depth) {
    depth = depth || 0;
    if (!v.ok) {
      addMsg('err', t('err.invalid', { e: v.errors.join('; ') }));
      chatHistory.push({ role: 'assistant', content: 'Produced invalid design: ' + v.errors.join('; ') });
      return;
    }
    // A design generated in garden mode stays a garden design even before it has plants.
    if (appMode === 'garden') v.design.meta.mode = 'garden';
    // Deterministic geometry cleanup: round to 0.5mm, snap to floor, close small joint gaps.
    var snap = Schema.snapDesign(v.design);
    if (snap.floored || snap.gapsClosed) dbg('info', 'snap: ' + snap.floored + ' part(s) snapped to floor, ' + snap.gapsClosed + ' joint gap(s) closed');
    // Joint sanity: snap misplaced markers, warn about impossible joints.
    var audit = Schema.auditJoints(v.design);
    // Deterministic retarget: reattach no-touch joints to the nearest touching part.
    var retgt = audit.notouch.length ? Schema.retargetJoints(v.design, audit.notouch) : { fixed: [], remaining: [] };
    if (retgt.fixed.length) dbg('info', 'retargeted joints: ' + retgt.fixed.map(function (f) { return f.id + '→' + f.to; }).join(', '));
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
    sampleLoaded = null;   // AI touched it — no longer the pristine sample
    markDirty();
    pushHistory();
    var summary = (depth ? '🔧 ' : '') + (env.summary || v.design.meta.name);
    var nPlants = (v.design.plants || []).length;
    addMsg('ai', summary + '\n' + (nPlants
      ? t('msg.designStatsGarden', { p: v.design.parts.length, n: nPlants, s: v.design.assembly.length })
      : t('msg.designStats', { p: v.design.parts.length, s: v.design.assembly.length })));
    if (diffMsg) addMsg('sys', diffMsg);
    var warnBits = [];
    if (audit.moved) warnBits.push(t('audit.moved', { n: audit.moved }));
    retgt.fixed.forEach(function (f) { warnBits.push(t('audit.retargeted', { id: f.id, to: f.to })); });
    retgt.remaining.forEach(function (id) { warnBits.push(t('audit.notouch', { id: id })); });
    (extraNotes || []).forEach(function (n) { warnBits.push(n); });
    if (v.warnings.length) warnBits.push(v.warnings.slice(0, 2).join(' · '));
    if (warnBits.length) {
      var wm = addMsg('sys', '⚠ ' + warnBits.join('\n⚠ '));
      wm.title = v.warnings.concat(retgt.remaining).concat(extraNotes || []).join('\n');
    }
    // Keep history light: don't repeat the whole design (it is re-injected each turn).
    chatHistory.push({ role: 'assistant', content: JSON.stringify({ type: env.type, scope: env.scope || 'new', summary: summary }) });

    // Automatic repair loop: feed geometry lint findings back to the AI (max 2 rounds).
    var issues = Schema.lintDesign(v.design);
    retgt.remaining.forEach(function (id) {
      issues.push('Joint "' + id + '" connects parts that do not touch — reattach it to the parts it actually sits between (update_joint) or remove it (remove_joint).');
    });
    if (issues.length && depth < 2 && LLM.settings().autoRepair !== false) {
      dbg('info', 'lint: ' + issues.length + ' issue(s), starting repair round ' + (depth + 1));
      runRepair(issues, depth + 1);
    } else {
      if (issues.length) {
        var im = addMsg('sys', '⚠ ' + issues.slice(0, 4).join('\n⚠ ') + (issues.length > 4 ? '\n…' : ''));
        im.title = issues.join('\n');
      }
      maybeVisionReview();  // lint pipeline settled — let the vision model take a look
    }
  }

  // ---------- vision review (multimodal critique of the rendered design) ----------
  function maybeVisionReview() {
    if (!pendingVision) return;
    pendingVision = false;
    var s = LLM.settings();
    if (!s.visionReview || !currentDesign) return;
    // give the scene a moment to render the final design before capturing
    setTimeout(function () { runVisionReview(s); }, 700);
  }

  function runVisionReview(s) {
    if (activeReq || !currentDesign) return;
    // With the Blender bridge on, use proper renders (real shadows and cutouts
    // give the critic far better evidence); fall back to WebGL screenshots.
    var getShots = Blender.enabled()
      ? Blender.renderViews(currentDesign, 512).catch(function (e) {
          dbg('warn', 'vision: Blender render failed (' + e.message + '), using WebGL screenshots');
          return Viewer.captureViews(512);
        })
      : Promise.resolve(Viewer.captureViews(512));
    getShots.then(function (shots) { runVisionReviewWith(s, shots); });
  }

  function runVisionReviewWith(s, shots) {
    if (activeReq || !currentDesign) return;
    if (!shots.length) { dbg('error', 'vision: no screenshots captured (WebGL canvas unreadable?)'); return; }
    var kb = Math.round(shots.reduce(function (a, u) { return a + u.length; }, 0) * 0.75 / 1024);
    dbg('info', 'vision: sending ' + shots.length + ' renders (~' + kb + ' KB) to ' + ((s.visionEndpoint || '').trim() || 'main endpoint'));
    var note = addMsg('sys', t('msg.visionChecking'));
    $('btnSend').classList.add('hidden');
    $('btnStop').classList.remove('hidden');
    activeReq = LLM.chat(Prompts.buildVisionMessages(currentDesign, lastUserText, shots), null,
      { endpoint: (s.visionEndpoint || '').trim() || undefined });
    activeReq.promise.then(function (full) {
      finishReq();
      note.remove();
      var env = LLM.extractJSON(full);
      // Lenient critique parsing: models phrase this in many ways.
      var issues = null;
      if (env) {
        if (Array.isArray(env.issues)) issues = env.issues.map(function (x) { return String(x); });
        else if (typeof env.issues === 'string' && env.issues.trim() && !/^(none|no( real)? issues?|ok)\b/i.test(env.issues.trim())) issues = [env.issues.trim()];
        else if (env.type === 'critique') issues = [];
        else if (env.message) { addMsg('ai', '👁 ' + env.message); return; } // critic answered in prose — show it
      }
      if (issues === null) {
        dbg('error', 'vision: unusable reply: ' + String(full).slice(0, 300));
        visionFailMsg(full, shots[0]);
        return;
      }
      if (!issues.length) { addMsg('sys', t('msg.visionOk')); return; }
      var im = addMsg('sys', t('msg.visionIssues', { n: issues.length }) + '\n👁 ' + issues.join('\n👁 '));
      im.title = issues.join('\n');
      // Only act on issues that reference real part ids (hallucination filter), max 3.
      var known = currentDesign.parts.map(function (p) { return p.id; });
      var actionable = issues.filter(function (s) {
        return known.some(function (id) { return s.indexOf(id) >= 0; });
      }).slice(0, 3);
      if (!actionable.length) { addMsg('sys', t('msg.visionNoActionable')); return; }
      // One text-model fix round; depth 3 prevents further automatic loops.
      if (LLM.settings().autoRepair !== false) runRepair(actionable, 3, true);
    }).catch(function (err) {
      finishReq();
      note.remove();
      if (err && err.name === 'AbortError') { addMsg('sys', t('msg.stopped')); return; }
      dbg('error', 'vision: request failed: ' + err.message);
      visionFailMsg(err.message, shots[0]);
    });
  }

  // Failure message with diagnostics: the raw reply / server error and the
  // first render that was sent, so the cause is visible at a glance.
  function visionFailMsg(raw, shot) {
    var m = addMsg('sys', t('msg.visionFail'));
    var det = document.createElement('details');
    var sum = document.createElement('summary');
    sum.textContent = t('err.raw');
    det.appendChild(sum);
    if (raw) {
      var pre = document.createElement('pre');
      var txt = LLM.stripThink(String(raw));
      pre.textContent = (txt || String(raw)).slice(0, 1500);
      det.appendChild(pre);
    }
    if (shot) {
      var img = document.createElement('img');
      img.src = shot;
      img.alt = 'render sent to the vision model';
      img.style.maxWidth = '100%';
      img.style.borderRadius = '6px';
      det.appendChild(img);
    }
    m.appendChild(det);
  }

  // Silent AI round that fixes findings with a minimal patch. visual=true for
  // vision-critic findings. A quality gate refuses fixes that make the
  // geometry measurably worse than what we have.
  function runRepair(issues, depth, visual) {
    var baseline = Schema.lintDesign(currentDesign).length;
    var note = addMsg('sys', t('msg.repairing', { n: issues.length }));
    $('btnSend').classList.add('hidden');
    $('btnStop').classList.remove('hidden');
    activeReq = LLM.chat(Prompts.buildRepairMessages(currentDesign, issues, visual), null, { responseSchema: Schema.ENVELOPE });

    function gateAndApply(env, v, notes) {
      if (!v.ok) { addMsg('sys', t('msg.repairFail')); return; }
      if (Schema.lintDesign(v.design).length > baseline) {
        dbg('warn', 'repair rejected: candidate has more lint issues than baseline (' + Schema.lintDesign(v.design).length + ' > ' + baseline + ')');
        addMsg('sys', t('msg.repairSkipped'));
        return;
      }
      env.scope = 'modify';
      env.summary = env.summary || t('msg.repaired');
      applyDesignEnvelope(env, v, notes, depth);
    }

    activeReq.promise.then(function (full) {
      finishReq();
      note.remove();
      var env = LLM.extractJSON(full);
      if (env && env.type === 'patch' && currentDesign) {
        var pr = Schema.applyPatch(currentDesign, env.ops || []);
        gateAndApply(env, Schema.validate(pr.design), pr.notes);
      } else if (env && env.type === 'design') {
        gateAndApply(env, Schema.validate(env.design), []);
      } else if (env && (env.type === 'chat' || env.type === 'clarify') && env.message) {
        // The model answered in prose instead of fixing — show it so the user can react.
        addMsg('ai', env.message);
        addMsg('sys', t('msg.repairFail'));
      } else {
        addMsg('sys', t('msg.repairFail'));
      }
    }).catch(function (err) {
      finishReq();
      note.remove();
      addMsg('sys', (err && err.name === 'AbortError') ? t('msg.stopped') : t('msg.repairFail'));
    });
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
    if (d) setAppMode((d.meta && d.meta.mode === 'garden') ? 'garden' : 'workshop');
    Viewer.loadDesign(d);
    setModeUI('model');
    renderCutList();
    renderSteps();
    renderFinishing();
    renderPlantsTab();
    renderCareTab();
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

  // ---------- garden tabs ----------
  var CARE_ROWS = [['sun', '🌞', 'pc.sun'], ['water', '💧', 'pc.water'], ['soil', '🪴', 'pc.soil'],
    ['planting', '🌱', 'pc.planting'], ['harvest', '🧺', 'pc.harvest'], ['notes', '📝', 'pc.carenotes']];

  // Species keys are English matching keys; display them in the UI language.
  function spLabel(s) { return Garden.speciesLabel(s); }
  function spList(a) { return (a || []).map(spLabel).join(', '); }

  function plantGroups() {
    var groups = {};
    ((currentDesign && currentDesign.plants) || []).forEach(function (p) {
      if (!groups[p.species]) groups[p.species] = { species: p.species, sample: p, qty: 0, ids: [] };
      groups[p.species].qty++;
      groups[p.species].ids.push(p.id);
    });
    return Object.keys(groups).map(function (k) { return groups[k]; });
  }

  function renderPlantsTab() {
    var el = $('tab-plants');
    var groups = plantGroups();
    if (!groups.length) { el.innerHTML = '<i>' + t('pl.empty') + '</i>'; return; }
    var html = '<table class="cut"><tr><th>' + t('pl.qty') + '</th><th>' + t('pl.species') + '</th><th>' +
      t('pl.spacing') + '</th><th>' + t('pl.size') + '</th><th>' + t('pl.companions') + '</th><th>' + t('pl.avoid') + '</th></tr>';
    groups.forEach(function (g, i) {
      var p = g.sample;
      html += '<tr data-i="' + i + '"><td>' + g.qty + '×</td><td>' + Garden.emojiFor(p.species, p.habit) + ' ' + esc(spLabel(p.species)) +
        '</td><td>' + Math.round(p.spacing) + ' mm</td><td>Ø' + Math.round(p.matureDiameter) + ' × ' + Math.round(p.matureHeight) +
        ' mm</td><td>' + esc(spList(p.companions) || '—') + '</td><td>' + esc(spList(p.avoid) || '—') + '</td></tr>';
    });
    html += '</table>';
    el.innerHTML = html;
    el.querySelectorAll('tr[data-i]').forEach(function (tr) {
      tr.onclick = function () {
        var g = groups[Number(tr.dataset.i)];
        Viewer.setSelection(g.ids);
        showPlantCard(g.sample);
      };
    });
  }

  function renderCareTab() {
    var el = $('tab-care');
    var groups = plantGroups();
    if (!groups.length) { el.innerHTML = '<i>' + t('pl.empty') + '</i>'; return; }
    el.innerHTML = '';
    groups.forEach(function (g) {
      var p = g.sample;
      var care = Garden.resolveCare(p);
      var rows = '';
      CARE_ROWS.forEach(function (f) {
        if (care[f[0]]) rows += f[1] + ' <b>' + t(f[2]) + ':</b> ' + esc(care[f[0]]) + '<br>';
      });
      if (p.companions.length) rows += '✅ <b>' + t('pc.companions') + ':</b> ' + esc(spList(p.companions)) + '<br>';
      if (p.avoid.length) rows += '🚫 <b>' + t('pc.avoid') + ':</b> ' + esc(spList(p.avoid));
      var d = document.createElement('div');
      d.className = 'finRow';
      d.innerHTML = '<b>' + Garden.emojiFor(p.species, p.habit) + ' ' + esc(spLabel(p.species)) + '</b> (' + g.qty + '×)<br>' + rows;
      el.appendChild(d);
    });
  }

  // ---------- part card ----------
  var cardPart = null;
  // Finish controls make no sense for a plant — hide them there.
  function setCardControls(isPlant) {
    cardIsPlant = isPlant;
    ['pcColor', 'pcFinish', 'pcShineWrap', 'pcApply'].forEach(function (id) {
      $(id).classList.toggle('hidden', isPlant);
    });
  }

  function showPartCard(p) {
    cardPart = p;
    if (!p) { $('partCard').classList.add('hidden'); return; }
    setCardControls(false);
    $('pcName').textContent = p.name;
    var joints = (currentDesign.joints || []).filter(function (j) { return j.parts.indexOf(p.id) >= 0; });
    var html = '<div class="kv">' + t('pc.dimensions') + ': <b>' + Schema.dimsLabel(p) +
      ((p.cutouts && p.cutouts.length) ? ' · ' + p.cutouts.length + '× Ø' + Math.round(p.cutouts[0].diameter) + ' mm' : '') + '</b></div>' +
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

  // Plant card: how to care for this plant (data generated by the AI at design time).
  function showPlantCard(p) {
    cardPart = p;
    if (!p) { $('partCard').classList.add('hidden'); return; }
    setCardControls(true);
    $('pcName').textContent = Garden.emojiFor(p.species, p.habit) + ' ' + p.name;
    var html = '<div class="kv">' + t('pc.species') + ': <b>' + esc(spLabel(p.species)) + '</b> · ' +
      t('pc.habit') + ': ' + esc(t('habit.' + p.habit)) + '</div>' +
      '<div class="kv">' + t('pc.mature') + ': <b>Ø' + Math.round(p.matureDiameter) + ' × ' + Math.round(p.matureHeight) + ' mm</b> · ' +
      t('pc.spacing') + ': <b>' + Math.round(p.spacing) + ' mm</b></div>' +
      '<div class="kv" style="margin-top:6px"><b>' + t('pc.care') + '</b></div><ul>';
    var care = Garden.resolveCare(p);   // own texts + catalog fallback, in UI language
    CARE_ROWS.forEach(function (f) {
      if (care[f[0]]) html += '<li>' + f[1] + ' <b>' + t(f[2]) + ':</b> ' + esc(care[f[0]]) + '</li>';
    });
    html += '</ul>';
    if (p.companions.length) html += '<div class="kv">✅ ' + t('pc.companions') + ': ' + esc(spList(p.companions)) + '</div>';
    if (p.avoid.length) html += '<div class="kv">🚫 ' + t('pc.avoid') + ': ' + esc(spList(p.avoid)) + '</div>';
    html += '<div class="kv">' + t('pc.step') + ': ' + stepOf(p.id) + '</div>';
    $('pcBody').innerHTML = html;
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
    var p = currentDesign && (currentDesign.parts.find(function (q) { return q.id === id; }) ||
      (currentDesign.plants || []).find(function (q) { return q.id === id; }));
    return p ? p.name : id;
  }

  function stepOf(id) {
    var s = currentDesign.assembly.find(function (st) { return st.parts.indexOf(id) >= 0; });
    return s ? s.step + ' (' + s.title + ')' : '—';
  }

  $('pcClose').onclick = function () { $('partCard').classList.add('hidden'); Viewer.clearSelection(); };
  $('pcFocus').onclick = function () { if (cardPart) Viewer.focusPart(cardPart.id); };
  $('pcApply').onclick = function () {
    if (!cardPart || cardIsPlant) return;
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
        var p = currentDesign.parts.find(function (q) { return q.id === id; }) ||
                (currentDesign.plants || []).find(function (q) { return q.id === id; });
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
  function activateTab(tab) {
    document.querySelectorAll('.tabBtn').forEach(function (x) { x.classList.toggle('active', x.dataset.tab === tab); });
    document.querySelectorAll('.tabBody').forEach(function (x) { x.classList.toggle('active', x.id === 'tab-' + tab); });
  }
  document.querySelectorAll('.tabBtn').forEach(function (b) {
    b.onclick = function () { activateTab(b.dataset.tab); };
  });

  // ---------- top bar ----------
  $('btnNew').onclick = function () {
    if (!confirmDiscard()) return;
    if (activeReq) activeReq.abort();   // a late AI response must not overwrite the new design
    currentRecordId = null;
    chatHistory = [];          // fresh LLM context — nothing from the old session is sent
    dirty = false;
    sampleLoaded = null;
    setDesign(null, 'New design');
    resetHistory();
    clearChatLog();            // fresh chat window too
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
      sampleLoaded = null;
      dirty = false;
      resetHistory();
      renderChatHistory();
      addMsg('sys', t('msg.imported', { n: r.name }));
    }).catch(function (e) { addMsg('err', t('err.importFailed', { e: e.message })); });
    this.value = '';
  };

  // ---------- inventory ----------
  function invPartRow(p) {
    var tr = document.createElement('tr');
    tr.className = 'invRow';
    tr.innerHTML =
      '<td><input data-f="name" value="' + esc(p.name) + '"></td>' +
      '<td><input data-f="section" value="' + esc(p.section) + '" style="width:110px"></td>' +
      '<td><input data-f="maxLen" type="number" min="0" value="' + (p.maxLen || '') + '" style="width:72px"></td>' +
      '<td><input data-f="species" value="' + esc(p.species) + '" style="width:100px"></td>' +
      '<td><input data-f="priority" type="number" min="1" max="5" value="' + (p.priority || 3) + '" style="width:44px"></td>' +
      '<td><input data-f="complexity" type="number" min="1" max="5" value="' + (p.complexity || 1) + '" style="width:44px"></td>' +
      '<td><input data-f="use" value="' + esc(p.use) + '"></td>' +
      '<td><button class="invDel" title="' + esc(t('tip.remove')) + '">✕</button></td>';
    tr.querySelector('.invDel').onclick = function () { tr.remove(); };
    return tr;
  }

  function invCutRow(c) {
    var tr = document.createElement('tr');
    tr.className = 'invRow';
    tr.innerHTML =
      '<td><input data-f="name" value="' + esc(c.name) + '" style="width:170px"></td>' +
      '<td><input data-f="complexity" type="number" min="1" max="5" value="' + (c.complexity || 1) + '" style="width:44px"></td>' +
      '<td><input data-f="note" value="' + esc(c.note) + '"></td>' +
      '<td><button class="invDel" title="' + esc(t('tip.remove')) + '">✕</button></td>';
    tr.querySelector('.invDel').onclick = function () { tr.remove(); };
    return tr;
  }

  function renderInventory(inv) {
    var pt = $('invParts');
    pt.innerHTML = '<tr><th>' + [t('inv.hName'), t('inv.hSection'), t('inv.hMax'), t('inv.hSpecies'), 'P', 'C', t('inv.hUse'), ''].join('</th><th>') + '</th></tr>';
    inv.parts.forEach(function (p) { pt.appendChild(invPartRow(p)); });
    var ct = $('invCuts');
    ct.innerHTML = '<tr><th>' + [t('inv.hName'), 'C', t('inv.hNote'), ''].join('</th><th>') + '</th></tr>';
    inv.cuts.forEach(function (c) { ct.appendChild(invCutRow(c)); });
  }

  function collectInventory() {
    var inv = { parts: [], cuts: [] };
    function val(tr, f) { var el = tr.querySelector('[data-f=' + f + ']'); return el ? el.value.trim() : ''; }
    function num15(v, d) { return Math.min(5, Math.max(1, Number(v) || d)); }
    $('invParts').querySelectorAll('tr.invRow').forEach(function (tr) {
      var name = val(tr, 'name');
      if (!name) return;
      inv.parts.push({
        name: name, section: val(tr, 'section'), maxLen: Number(val(tr, 'maxLen')) || 0,
        species: val(tr, 'species'), priority: num15(val(tr, 'priority'), 3),
        complexity: num15(val(tr, 'complexity'), 1), use: val(tr, 'use')
      });
    });
    $('invCuts').querySelectorAll('tr.invRow').forEach(function (tr) {
      var name = val(tr, 'name');
      if (!name) return;
      inv.cuts.push({ name: name, complexity: num15(val(tr, 'complexity'), 1), note: val(tr, 'note') });
    });
    return inv;
  }

  // Plant catalog editor inside the Stock modal (garden mode). Editable like
  // the wood inventory: inline fields, add/delete, per-plant care texts in
  // BOTH languages (📝), persisted in the browser via PlantDB.save().
  function habitOptions(sel) {
    return PlantDB.HABITS.map(function (h) {
      return '<option value="' + h + '"' + (h === sel ? ' selected' : '') + '>' + esc(t('habit.' + h)) + '</option>';
    }).join('');
  }

  function removeCareEditor(tr) {
    var next = tr.nextElementSibling;
    if (next && next.className === 'invCareEdit') next.remove();
  }

  // Expandable editor row: one line per care field with EN + DE inputs bound to tr._care.
  function toggleCareEditor(tr) {
    var next = tr.nextElementSibling;
    if (next && next.className === 'invCareEdit') { next.remove(); return; }
    var d = document.createElement('tr');
    d.className = 'invCareEdit';
    d.appendChild(document.createElement('td'));   // spacer under the emoji column
    var td = document.createElement('td');
    td.colSpan = 10;
    CARE_ROWS.forEach(function (c) {
      var row = document.createElement('div');
      row.style.cssText = 'display:flex;gap:6px;align-items:center;margin:2px 0';
      var lbl = document.createElement('span');
      lbl.style.cssText = 'width:86px;flex:0 0 auto;color:var(--muted);font-size:12px';
      lbl.textContent = c[1] + ' ' + t(c[2]);
      row.appendChild(lbl);
      ['en', 'de'].forEach(function (lg) {
        var inp = document.createElement('input');
        inp.style.flex = '1';
        inp.placeholder = lg.toUpperCase();
        inp.value = tr._care[lg][c[0]] || '';
        inp.oninput = function () { tr._care[lg][c[0]] = inp.value; };
        row.appendChild(inp);
      });
      td.appendChild(row);
    });
    d.appendChild(td);
    tr.parentNode.insertBefore(d, tr.nextSibling);
  }

  function plantRow(e) {
    var tr = document.createElement('tr');
    tr.className = 'invRow';
    // Care texts live on the row object; the 📝 editor reads/writes them so
    // unsaved edits survive collapsing the editor or filtering.
    tr._care = JSON.parse(JSON.stringify(e.care || { en: {}, de: {} }));
    tr._care.en = tr._care.en || {}; tr._care.de = tr._care.de || {};
    tr.innerHTML =
      '<td>' + Garden.emojiFor(e.species, e.habit) + '</td>' +
      '<td><input data-f="species" value="' + esc(e.species) + '" style="width:100px"></td>' +
      '<td><input data-f="de" value="' + esc(e.de || '') + '" style="width:120px"></td>' +
      '<td><select data-f="habit">' + habitOptions(e.habit) + '</select></td>' +
      '<td><input data-f="height" type="number" min="20" value="' + (e.height || 300) + '" style="width:70px"></td>' +
      '<td><input data-f="dia" type="number" min="20" value="' + (e.dia || 250) + '" style="width:70px"></td>' +
      '<td><input data-f="spacing" type="number" min="10" value="' + (e.spacing || 250) + '" style="width:70px"></td>' +
      '<td><input data-f="companions" value="' + esc((e.companions || []).join(',')) + '"></td>' +
      '<td><input data-f="avoid" value="' + esc((e.avoid || []).join(',')) + '"></td>' +
      '<td><button class="invCareBtn" title="' + esc(t('inv.editCare')) + '">📝</button></td>' +
      '<td><button class="invDel" title="' + esc(t('tip.remove')) + '">✕</button></td>';
    tr.querySelector('.invDel').onclick = function () { removeCareEditor(tr); tr.remove(); };
    tr.querySelector('.invCareBtn').onclick = function () { toggleCareEditor(tr); };
    return tr;
  }

  function renderPlantCatalog() {
    var tbl = $('invPlants');
    tbl.innerHTML = '<tr><th></th><th>' + [t('inv.hKey'), t('inv.hDe'), t('pc.habit'), t('inv.hHeight'), 'Ø',
      t('pl.spacing'), t('pl.companions'), t('pl.avoid'), '', ''].join('</th><th>') + '</th></tr>';
    PlantDB.list().forEach(function (e) { tbl.appendChild(plantRow(e)); });
    applyPlantFilter();
  }

  // Filter hides rows instead of re-rendering, so pending edits survive.
  function applyPlantFilter() {
    var f = $('invPlantFilter').value.toLowerCase().trim();
    $('invPlants').querySelectorAll('tr.invRow').forEach(function (tr) {
      var hay = tr.querySelector('[data-f=species]').value + ' ' + tr.querySelector('[data-f=de]').value;
      var show = !f || hay.toLowerCase().indexOf(f) >= 0;
      tr.style.display = show ? '' : 'none';
      var next = tr.nextElementSibling;
      if (next && next.className === 'invCareEdit') next.style.display = show ? '' : 'none';
    });
  }
  $('invPlantFilter').oninput = applyPlantFilter;

  function collectPlantCatalog() {
    var out = [];
    $('invPlants').querySelectorAll('tr.invRow').forEach(function (tr) {
      function val(f) { var el = tr.querySelector('[data-f=' + f + ']'); return el ? el.value.trim() : ''; }
      var species = val('species').toLowerCase();
      if (!species) return;
      out.push({
        species: species, de: val('de'), habit: val('habit'),
        height: Number(val('height')), dia: Number(val('dia')), spacing: Number(val('spacing')),
        companions: val('companions'), avoid: val('avoid'),
        care: tr._care
      });
    });
    return out;
  }

  $('invAddPlant').onclick = function () {
    var tr = plantRow({ species: '', de: '', habit: 'bushy', height: 300, dia: 250, spacing: 250, companions: [], avoid: [], care: { en: {}, de: {} } });
    $('invPlants').appendChild(tr);
    tr.querySelector('[data-f=species]').focus();
  };
  $('invPlantReset').onclick = function () {
    if (confirm(t('inv.confirmPlantReset'))) { PlantDB.reset(); renderPlantCatalog(); }
  };

  $('btnInventory').onclick = function () {
    renderInventory(Inventory.get());
    var garden = appMode === 'garden';
    document.querySelectorAll('#inventoryModal .gardenOnly').forEach(function (el) { el.classList.toggle('hidden', !garden); });
    if (garden) renderPlantCatalog();
    $('inventoryModal').classList.remove('hidden');
  };
  $('invCancel').onclick = function () { $('inventoryModal').classList.add('hidden'); };
  $('invAddPart').onclick = function () {
    $('invParts').appendChild(invPartRow({ name: '', section: '', maxLen: 2400, species: '', priority: 3, complexity: 1, use: '' }));
  };
  $('invAddCut').onclick = function () {
    $('invCuts').appendChild(invCutRow({ name: '', complexity: 1, note: '' }));
  };
  $('invReset').onclick = function () {
    if (confirm(t('inv.confirmReset'))) renderInventory(Inventory.reset());
  };
  $('invSave').onclick = function () {
    var inv = collectInventory();
    Inventory.save(inv);
    // Plant catalog rows exist only after the table was rendered (garden mode).
    if ($('invPlants').querySelector('tr.invRow')) {
      var saved = PlantDB.save(collectPlantCatalog());
      renderPlantsTab(); renderCareTab();          // catalog-resolved care may have changed
      addMsg('sys', t('inv.savedPlants', { n: saved.length }));
    }
    $('inventoryModal').classList.add('hidden');
    addMsg('sys', t('inv.saved', { p: inv.parts.length, c: inv.cuts.length }));
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
            sampleLoaded = null;
            dirty = false;
            resetHistory();
            renderChatHistory();
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
    $('setReasoning').value = s.reasoningBudgetTokens;
    $('setStrict').value = s.strictJson || 'auto';
    $('setTwoPass').checked = s.twoPass !== false;
    $('setRepair').checked = s.autoRepair !== false;
    $('setVision').checked = !!s.visionReview;
    $('setVisionEP').value = s.visionEndpoint || '';
    $('setPlantStyle').value = s.plantStyle || 'primitives';
    $('setBlender').checked = !!s.blenderBridge;
    $('setBlenderURL').value = s.blenderURL || 'http://127.0.0.1:8800';
    $('blenderOpts').classList.toggle('hidden', !s.blenderBridge);
    $('setBlenderResult').textContent = '';
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
      reasoningBudgetTokens: $('setReasoning').value.trim() === '' ? '' : (Number($('setReasoning').value) || 0),
      aframeVersion: $('setAframe').value.trim() || '1.8.0',
      language: $('setLang').value,
      strictJson: $('setStrict').value,
      twoPass: $('setTwoPass').checked,
      autoRepair: $('setRepair').checked,
      visionReview: $('setVision').checked,
      visionEndpoint: $('setVisionEP').value.trim(),
      plantStyle: $('setPlantStyle').value,
      blenderBridge: $('setBlender').checked,
      blenderURL: $('setBlenderURL').value.trim() || 'http://127.0.0.1:8800'
    };
  }

  // Show the Blender requirements/instructions as soon as the option is ticked.
  $('setBlender').onchange = function () {
    $('blenderOpts').classList.toggle('hidden', !this.checked);
  };
  $('setBlenderTest').onclick = function () {
    $('setBlenderResult').textContent = t('set.testing');
    var saved = localStorage.getItem('diyw_settings');
    LLM.saveSettings(collectSettings());
    Blender.health().then(function (h) {
      $('setBlenderResult').textContent = t('set.blenderOk', { v: h.blender });
    }).catch(function (e) {
      $('setBlenderResult').textContent = '✖ ' + e.message;
      if (saved) localStorage.setItem('diyw_settings', saved);
    });
  };

  $('setSaveBtn').onclick = function () {
    var prev = LLM.settings();
    var prevVer = prev.aframeVersion;
    var s = collectSettings();
    LLM.saveSettings(s);
    $('settingsModal').classList.add('hidden');
    switchLanguage(s.language);
    testConn();
    if (s.plantStyle !== prev.plantStyle && currentDesign && (currentDesign.plants || []).length) {
      Viewer.refreshPlants();
    }
    updateBridgeUI();
    if (s.blenderBridge && !prev.blenderBridge) {
      // Just enabled: check the bridge and tell the user what is still needed.
      Blender.health().then(function (h) {
        addMsg('sys', t('msg.blenderOn', { v: h.blender }));
      }).catch(function () {
        addMsg('sys', t('msg.blenderMissing'));
      });
    }
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
      $('connDot').title = t('tip.connOk', { m: r.models[0] || '—' });
    }).catch(function (e) {
      $('connDot').className = 'dot err';
      $('connDot').title = t('tip.connErr', { e: e.message });
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
    if ((currentDesign.plants || []).length) {
      var pg = plantGroups();
      h += '<h2>' + t('print.plants') + '</h2><table><tr><th>' + t('pl.qty') + '</th><th>' + t('pl.species') + '</th><th>' +
        t('pl.spacing') + '</th><th>' + t('pl.companions') + '</th><th>' + t('pl.avoid') + '</th></tr>';
      pg.forEach(function (g) {
        h += '<tr><td>' + g.qty + '</td><td>' + esc(spLabel(g.species)) + '</td><td>' + Math.round(g.sample.spacing) + ' mm</td><td>' +
          esc(spList(g.sample.companions) || '—') + '</td><td>' + esc(spList(g.sample.avoid) || '—') + '</td></tr>';
      });
      h += '</table><h2>' + t('print.care') + '</h2>';
      pg.forEach(function (g) {
        var p = g.sample, rows = '', care = Garden.resolveCare(p);
        CARE_ROWS.forEach(function (f) { if (care[f[0]]) rows += '• ' + t(f[2]) + ': ' + esc(care[f[0]]) + '<br>'; });
        h += '<p><b>' + esc(spLabel(p.species)) + '</b> (' + g.qty + '×)<br>' + rows + '</p>';
      });
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
