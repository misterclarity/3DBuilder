/* i18n.js — English/German UI translation. Exposes window.I18n.
 * Static HTML is translated via [data-i18n], [data-i18n-html], [data-i18n-ph] (placeholder),
 * [data-i18n-title] attributes; dynamic strings via I18n.t(key, vars).
 */
(function () {
  'use strict';

  var dict = {
    en: {
      'app.subtitle': 'AI 3D design assistant',
      'btn.new': 'New', 'btn.save': 'Save', 'btn.library': 'Library', 'btn.export': 'Export', 'btn.import': 'Import',
      'btn.settings': '⚙ Settings', 'btn.print': '🖨 Print', 'btn.send': 'Send', 'btn.stop': 'Stop',
      'btn.cancel': 'Cancel', 'btn.close': 'Close', 'btn.apply': 'Apply', 'btn.focus': 'Focus',
      'btn.load': 'Load', 'btn.delete': 'Delete',
      'mode.model': 'Model', 'mode.prep': 'Cut & Prep', 'mode.assembly': 'Assembly',
      'viewer.explode': 'Explode', 'viewer.joints': 'Joints', 'viewer.fit': '⤢ Fit',
      'viewer.hint': 'drag = orbit · wheel = zoom · right-drag = pan · click part = info · Ctrl+click = multi-select',
      'tab.cutlist': 'Cut list', 'tab.steps': 'Assembly steps', 'tab.finishing': 'Finishing',
      'chat.placeholder': 'Describe what you want to build, or ask for changes…\ne.g. “A single bed out of wood for a 90×200 cm mattress” or “split the selected piece in 2 and connect them via hinge”',
      'chat.designing': 'Designing', 'chat.clarifyIntro': 'I need a bit more information:',
      'msg.welcome': 'Welcome! Describe what you want to build and the AI will design it — parts, cut list, assembly steps and finishing. Click any part in 3D for details. Ctrl+click selects multiple parts.',
      'msg.sampleLoaded': 'A sample design (single bed) is loaded. Ask the AI to modify it or start something new.',
      'msg.stopped': 'Stopped.', 'msg.newStarted': 'New design started. Describe what you want to build.',
      'msg.saved': 'Saved "{n}".', 'msg.loaded': 'Loaded "{n}".', 'msg.imported': 'Imported "{n}".',
      'msg.applied': 'Applied "{n}" to {c} part(s).', 'msg.updated': 'Updated finish on {c} part(s).',
      'msg.designStats': '({p} parts, {s} assembly steps)',
      'msg.autosaved': 'Previous design was auto-saved to the library as "{n}".',
      'msg.nothingToSave': 'Nothing to save yet.',
      'err.parse': 'The AI response could not be parsed as a design. You can try again or rephrase.',
      'err.raw': 'Raw response', 'err.invalid': 'The AI produced an invalid design: {e}. Ask it to try again.',
      'err.noai': 'Could not reach the AI: {e}', 'err.saveFailed': 'Save failed: {e}', 'err.importFailed': 'Import failed: {e}',
      'err.unknownType': 'Unknown response type from AI: {t}',
      'err.troubleshoot': '<summary>Troubleshooting</summary><pre>1. Is the LLM server running at the endpoint in Settings?\n2. If this page is HTTPS and the endpoint is HTTP, allow "insecure content" for this site (see Settings).\n3. The server must allow CORS.</pre>',
      'confirm.unsaved': 'You have unsaved changes. Discard them?',
      'confirm.delete': 'Delete "{n}"?',
      'sel.prefix': 'Selected: ',
      'cut.qty': 'Qty', 'cut.part': 'Part', 'cut.dims': 'Dimensions (mm)', 'cut.stock': 'Stock', 'cut.mat': 'Material',
      'cut.hardware': 'Hardware', 'cut.empty': 'No design yet — describe what you want to build in the chat.',
      'steps.step': 'Step', 'steps.partcount': '{n} part(s)', 'steps.joints': 'joints: ',
      'fin.none': 'No finishing steps in this design. Ask the AI, e.g. “stain it walnut and add two coats of varnish”.',
      'fin.quick': 'Quick finish (applies to {t})', 'fin.selected': 'selected part(s)', 'fin.all': 'ALL parts',
      'pc.dimensions': 'Dimensions', 'pc.stock': 'Stock', 'pc.material': 'Material', 'pc.prep': 'Preparation:',
      'pc.connections': 'Connections:', 'pc.step': 'Assembly step', 'pc.notes': 'Notes', 'pc.joint': 'Joint', 'pc.connects': 'Connects',
      'fin.raw': 'Raw', 'fin.painted': 'Painted', 'fin.stained': 'Stained', 'fin.varnished': 'Varnished', 'pc.shine': 'Shine',
      'set.title': 'Settings', 'set.endpoint': 'AI endpoint (OpenAI-compatible base URL)', 'set.model': 'Model',
      'set.modelAuto': 'Auto — use the model the server is serving',
      'set.temp': 'Temperature', 'set.maxtok': 'Max tokens', 'set.aframe': 'A-Frame version', 'set.lang': 'Language',
      'set.aframeNote': 'Loaded from <code>aframe.io/releases/&lt;version&gt;/aframe.min.js</code>. Check <a href="https://github.com/aframevr/aframe/releases" target="_blank" rel="noopener">releases</a>. Change requires reload.',
      'set.mixed': '<b>Mixed content:</b> when this site is served over HTTPS (GitHub Pages) and your AI endpoint is plain HTTP, the browser blocks the request. Fixes: in Chrome/Edge click the lock icon → Site settings → Insecure content → <i>Allow</i> for this site. In Firefox: lock icon → disable protection for this page. Alternatively serve your LLM over HTTPS (e.g. <code>tailscale cert</code> + <code>tailscale serve</code>) or run this site locally (<code>python -m http.server</code>). Your llama.cpp/vLLM server must also send CORS headers.',
      'set.llmNote': 'Sent with each request — they override the llama.cpp/server defaults. Leave empty to use the server\'s settings.',
      'set.test': 'Test connection', 'set.testing': 'Testing…', 'set.connected': '✔ Connected. Models: {m}',
      'set.reload': 'A-Frame version changed. Reload the page now to apply it? (Save your design first if needed.)',
      'lib.title': 'Design library', 'lib.empty': 'No saved designs yet. Use Save after generating one.', 'lib.parts': '{n} parts',
      'save.prompt': 'Design name:',
      'asm.step': 'Step {a}/{b}: ',
      'print.cutlist': 'Cut list', 'print.prep': 'Part preparation', 'print.hardware': 'Hardware', 'print.assembly': 'Assembly', 'print.finishing': 'Finishing',
      'audit.notouch': 'Joint "{id}" connects parts that do not touch — ask the AI to fix its placement.',
      'audit.moved': 'Moved {n} joint marker(s) onto the actual contact area between their parts.',
      'btn.obj': 'OBJ', 'btn.undo': 'Undo (Ctrl+Z)', 'btn.redo': 'Redo (Ctrl+Y)', 'viewer.measure': '📏 Measure',
      'msg.measureOn': 'Measure mode: click two points on parts in the 3D view. Click the button again to exit.',
      'msg.measured': 'Distance: {d} mm',
      'opt.title': 'Board & sheet optimization', 'opt.kerf': '4 mm kerf · sheets 2500×1250 · standard lengths up to 4 m',
      'opt.board': 'board(s)', 'opt.sheet': 'sheet(s)', 'opt.waste': 'waste', 'opt.used': 'used',
      'opt.oversize': 'Oversized parts (no standard stock fits)',
      'cost.title': 'Cost estimate', 'cost.qty': 'Qty', 'cost.item': 'Item', 'cost.unit': 'Unit price',
      'cost.sum': 'Sum', 'cost.total': 'Total', 'cost.hint': 'Prices are editable and saved in your browser.',
      'pc.move': 'Move (mm)',
      'diff.summary': 'Changes: {a} part(s) added, {r} removed, {m} modified',
      'preset0': 'Natural (clear)', 'preset1': 'Golden oak', 'preset2': 'Teak', 'preset3': 'Walnut', 'preset4': 'Mahogany', 'preset5': 'Ebony', 'preset6': 'White wash'
    },
    de: {
      'app.subtitle': 'KI-3D-Designassistent',
      'btn.new': 'Neu', 'btn.save': 'Speichern', 'btn.library': 'Bibliothek', 'btn.export': 'Exportieren', 'btn.import': 'Importieren',
      'btn.settings': '⚙ Einstellungen', 'btn.print': '🖨 Drucken', 'btn.send': 'Senden', 'btn.stop': 'Stopp',
      'btn.cancel': 'Abbrechen', 'btn.close': 'Schließen', 'btn.apply': 'Anwenden', 'btn.focus': 'Fokus',
      'btn.load': 'Laden', 'btn.delete': 'Löschen',
      'mode.model': 'Modell', 'mode.prep': 'Zuschnitt', 'mode.assembly': 'Montage',
      'viewer.explode': 'Explosion', 'viewer.joints': 'Verbindungen', 'viewer.fit': '⤢ Einpassen',
      'viewer.hint': 'Ziehen = Drehen · Rad = Zoom · Rechts-Ziehen = Verschieben · Klick = Info · Strg+Klick = Mehrfachauswahl',
      'tab.cutlist': 'Schnittliste', 'tab.steps': 'Montageschritte', 'tab.finishing': 'Oberfläche',
      'chat.placeholder': 'Beschreibe, was du bauen möchtest, oder bitte um Änderungen…\nz. B. „Ein Einzelbett aus Holz für eine 90×200-cm-Matratze“ oder „teile das ausgewählte Teil in 2 und verbinde sie mit einem Scharnier“',
      'chat.designing': 'Entwerfe', 'chat.clarifyIntro': 'Ich brauche noch ein paar Informationen:',
      'msg.welcome': 'Willkommen! Beschreibe, was du bauen möchtest – die KI entwirft es: Teile, Schnittliste, Montageschritte und Oberflächenbehandlung. Klicke ein Teil im 3D-Modell für Details. Strg+Klick wählt mehrere Teile aus.',
      'msg.sampleLoaded': 'Ein Beispieldesign (Einzelbett) ist geladen. Bitte die KI um Änderungen oder starte etwas Neues.',
      'msg.stopped': 'Gestoppt.', 'msg.newStarted': 'Neues Design gestartet. Beschreibe, was du bauen möchtest.',
      'msg.saved': '„{n}“ gespeichert.', 'msg.loaded': '„{n}“ geladen.', 'msg.imported': '„{n}“ importiert.',
      'msg.applied': '„{n}“ auf {c} Teil(e) angewendet.', 'msg.updated': 'Oberfläche von {c} Teil(en) aktualisiert.',
      'msg.designStats': '({p} Teile, {s} Montageschritte)',
      'msg.autosaved': 'Das vorherige Design wurde automatisch als „{n}“ in der Bibliothek gesichert.',
      'msg.nothingToSave': 'Noch nichts zu speichern.',
      'err.parse': 'Die KI-Antwort konnte nicht als Design interpretiert werden. Versuche es erneut oder formuliere um.',
      'err.raw': 'Rohantwort', 'err.invalid': 'Die KI hat ein ungültiges Design erzeugt: {e}. Bitte sie, es erneut zu versuchen.',
      'err.noai': 'Die KI ist nicht erreichbar: {e}', 'err.saveFailed': 'Speichern fehlgeschlagen: {e}', 'err.importFailed': 'Import fehlgeschlagen: {e}',
      'err.unknownType': 'Unbekannter Antworttyp der KI: {t}',
      'err.troubleshoot': '<summary>Fehlersuche</summary><pre>1. Läuft der LLM-Server unter dem Endpunkt in den Einstellungen?\n2. Wenn diese Seite HTTPS ist und der Endpunkt HTTP, erlaube „unsichere Inhalte“ für diese Seite (siehe Einstellungen).\n3. Der Server muss CORS erlauben.</pre>',
      'confirm.unsaved': 'Du hast ungespeicherte Änderungen. Verwerfen?',
      'confirm.delete': '„{n}“ löschen?',
      'sel.prefix': 'Ausgewählt: ',
      'cut.qty': 'Anz.', 'cut.part': 'Teil', 'cut.dims': 'Maße (mm)', 'cut.stock': 'Ausgangsmaterial', 'cut.mat': 'Werkstoff',
      'cut.hardware': 'Beschläge', 'cut.empty': 'Noch kein Design – beschreibe im Chat, was du bauen möchtest.',
      'steps.step': 'Schritt', 'steps.partcount': '{n} Teil(e)', 'steps.joints': 'Verbindungen: ',
      'fin.none': 'Keine Oberflächenschritte in diesem Design. Bitte die KI, z. B. „beize es in Nussbaum und trage zwei Schichten Lack auf“.',
      'fin.quick': 'Schnell-Finish (gilt für {t})', 'fin.selected': 'ausgewählte Teile', 'fin.all': 'ALLE Teile',
      'pc.dimensions': 'Maße', 'pc.stock': 'Ausgangsmaterial', 'pc.material': 'Werkstoff', 'pc.prep': 'Vorbereitung:',
      'pc.connections': 'Verbindungen:', 'pc.step': 'Montageschritt', 'pc.notes': 'Hinweise', 'pc.joint': 'Verbindung', 'pc.connects': 'Verbindet',
      'fin.raw': 'Roh', 'fin.painted': 'Lackiert', 'fin.stained': 'Gebeizt', 'fin.varnished': 'Versiegelt', 'pc.shine': 'Glanz',
      'set.title': 'Einstellungen', 'set.endpoint': 'KI-Endpunkt (OpenAI-kompatible Basis-URL)', 'set.model': 'Modell',
      'set.modelAuto': 'Auto — vom Server bereitgestelltes Modell verwenden',
      'set.temp': 'Temperatur', 'set.maxtok': 'Max. Tokens', 'set.aframe': 'A-Frame-Version', 'set.lang': 'Sprache',
      'set.aframeNote': 'Geladen von <code>aframe.io/releases/&lt;version&gt;/aframe.min.js</code>. Siehe <a href="https://github.com/aframevr/aframe/releases" target="_blank" rel="noopener">Releases</a>. Änderung erfordert Neuladen.',
      'set.mixed': '<b>Mixed Content:</b> Wenn diese Seite über HTTPS läuft (GitHub Pages) und dein KI-Endpunkt nur HTTP ist, blockiert der Browser die Anfrage. Lösung: In Chrome/Edge auf das Schloss-Symbol klicken → Website-Einstellungen → Unsichere Inhalte → <i>Zulassen</i>. In Firefox: Schloss-Symbol → Schutz für diese Seite deaktivieren. Alternativ den LLM-Server über HTTPS bereitstellen (z. B. <code>tailscale cert</code> + <code>tailscale serve</code>) oder die Seite lokal ausführen (<code>python -m http.server</code>). Der llama.cpp/vLLM-Server muss außerdem CORS-Header senden.',
      'set.llmNote': 'Werden mit jeder Anfrage gesendet und überschreiben die Server-Vorgaben (llama.cpp). Leer lassen, um die Servereinstellungen zu verwenden.',
      'set.test': 'Verbindung testen', 'set.testing': 'Teste…', 'set.connected': '✔ Verbunden. Modelle: {m}',
      'set.reload': 'A-Frame-Version geändert. Seite jetzt neu laden? (Design vorher speichern, falls nötig.)',
      'lib.title': 'Design-Bibliothek', 'lib.empty': 'Noch keine gespeicherten Designs. Nutze „Speichern“, nachdem eines erstellt wurde.', 'lib.parts': '{n} Teile',
      'save.prompt': 'Designname:',
      'asm.step': 'Schritt {a}/{b}: ',
      'print.cutlist': 'Schnittliste', 'print.prep': 'Teilevorbereitung', 'print.hardware': 'Beschläge', 'print.assembly': 'Montage', 'print.finishing': 'Oberflächenbehandlung',
      'audit.notouch': 'Verbindung „{id}“ verbindet Teile, die sich nicht berühren – bitte die KI, die Platzierung zu korrigieren.',
      'audit.moved': '{n} Verbindungsmarker auf die tatsächliche Kontaktfläche zwischen den Teilen verschoben.',
      'btn.obj': 'OBJ', 'btn.undo': 'Rückgängig (Strg+Z)', 'btn.redo': 'Wiederholen (Strg+Y)', 'viewer.measure': '📏 Messen',
      'msg.measureOn': 'Messmodus: klicke zwei Punkte auf Teilen im 3D-Modell. Zum Beenden erneut auf die Schaltfläche klicken.',
      'msg.measured': 'Abstand: {d} mm',
      'opt.title': 'Zuschnitt-Optimierung', 'opt.kerf': '4 mm Sägeblatt · Platten 2500×1250 · Standardlängen bis 4 m',
      'opt.board': 'Brett(er)', 'opt.sheet': 'Platte(n)', 'opt.waste': 'Verschnitt', 'opt.used': 'genutzt',
      'opt.oversize': 'Übergroße Teile (kein Standardmaterial passt)',
      'cost.title': 'Kostenschätzung', 'cost.qty': 'Anz.', 'cost.item': 'Position', 'cost.unit': 'Einzelpreis',
      'cost.sum': 'Summe', 'cost.total': 'Gesamt', 'cost.hint': 'Preise sind editierbar und werden im Browser gespeichert.',
      'pc.move': 'Verschieben (mm)',
      'diff.summary': 'Änderungen: {a} Teil(e) hinzugefügt, {r} entfernt, {m} geändert',
      'preset0': 'Natur (klar)', 'preset1': 'Eiche hell', 'preset2': 'Teak', 'preset3': 'Nussbaum', 'preset4': 'Mahagoni', 'preset5': 'Ebenholz', 'preset6': 'Weiß lasiert'
    }
  };

  var lang = 'en';
  try {
    var s = JSON.parse(localStorage.getItem('diyw_settings') || '{}');
    if (s.language === 'de' || s.language === 'en') lang = s.language;
    else if ((navigator.language || '').toLowerCase().indexOf('de') === 0) lang = 'de';
  } catch (e) {}

  function t(key, vars) {
    var s = (dict[lang] && dict[lang][key]) || dict.en[key] || key;
    if (vars) Object.keys(vars).forEach(function (k) { s = s.split('{' + k + '}').join(vars[k]); });
    return s;
  }

  function apply() {
    document.documentElement.lang = lang;
    document.querySelectorAll('[data-i18n]').forEach(function (el) { el.textContent = t(el.dataset.i18n); });
    document.querySelectorAll('[data-i18n-html]').forEach(function (el) { el.innerHTML = t(el.dataset.i18nHtml); });
    document.querySelectorAll('[data-i18n-ph]').forEach(function (el) { el.placeholder = t(el.dataset.i18nPh); });
    document.querySelectorAll('[data-i18n-title]').forEach(function (el) { el.title = t(el.dataset.i18nTitle); });
  }

  function setLang(l) {
    if (l !== 'en' && l !== 'de') l = 'en';
    lang = l;
    apply();
  }

  document.addEventListener('DOMContentLoaded', apply);

  window.I18n = { t: t, apply: apply, setLang: setLang, getLang: function () { return lang; } };
})();
