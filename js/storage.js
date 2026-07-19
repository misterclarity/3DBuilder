/* storage.js — IndexedDB persistence for designs + JSON export/import. Exposes window.Store. */
(function () {
  'use strict';

  var DB_NAME = 'diy-workshop', STORE = 'designs', db = null;

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise(function (resolve, reject) {
      var req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = function (e) {
        var d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) {
          var os = d.createObjectStore(STORE, { keyPath: 'id' });
          os.createIndex('updatedAt', 'updatedAt');
        }
      };
      req.onsuccess = function () { db = req.result; resolve(db); };
      req.onerror = function () { reject(req.error); };
    });
  }

  function tx(mode) {
    return open().then(function (d) { return d.transaction(STORE, mode).objectStore(STORE); });
  }

  function reqP(getReq) {
    return new Promise(function (resolve, reject) {
      getReq.onsuccess = function () { resolve(getReq.result); };
      getReq.onerror = function () { reject(getReq.error); };
    });
  }

  function save(record) {
    // record: {id?, name, design, thumbnail?, chat?}
    record.id = record.id || ('d_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7));
    record.updatedAt = Date.now();
    return tx('readwrite').then(function (os) { return reqP(os.put(record)); }).then(function () { return record; });
  }

  function list() {
    return tx('readonly').then(function (os) { return reqP(os.getAll()); }).then(function (all) {
      all = all || [];
      all.sort(function (a, b) { return b.updatedAt - a.updatedAt; });
      // Return light records (no full design) for listing.
      return all.map(function (r) {
        return { id: r.id, name: r.name, updatedAt: r.updatedAt, thumbnail: r.thumbnail,
          partCount: r.design ? (r.design.parts || []).length + (r.design.plants || []).length : 0 };
      });
    });
  }

  function get(id) { return tx('readonly').then(function (os) { return reqP(os.get(id)); }); }
  function remove(id) { return tx('readwrite').then(function (os) { return reqP(os.delete(id)); }); }

  function exportJSON(record) {
    var blob = new Blob([JSON.stringify({ app: 'diy-workshop', schemaVersion: window.Schema.VERSION, name: record.name, design: record.design, chat: record.chat || [] }, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (record.name || 'design').replace(/[^\w\-]+/g, '_') + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 5000);
  }

  function importJSON(file) {
    return file.text().then(function (t) {
      var j = JSON.parse(t);
      var design = j.design || j; // accept bare design JSON too
      var v = window.Schema.validate(design);
      if (!v.ok) throw new Error('Invalid design file: ' + v.errors.join('; '));
      return { name: j.name || v.design.meta.name, design: v.design, chat: j.chat || [] };
    });
  }

  window.Store = { save: save, list: list, get: get, remove: remove, exportJSON: exportJSON, importJSON: importJSON };
})();
