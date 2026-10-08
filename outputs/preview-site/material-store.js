(function (global) {
  'use strict';
  const domain = global.MaterialDomain;
  let database;
  function open() {
    if (!database) database = new Promise((resolve, reject) => {
      if (!global.indexedDB) { reject(new Error('当前环境不支持材料数据存储，请使用桌面版或现代浏览器。')); return; }
      const request = global.indexedDB.open('material-management-v1', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('state');
      request.onsuccess = () => {
        const db = request.result;
        db.onversionchange = () => { db.close(); database = null; };
        resolve(db);
      };
      request.onerror = () => { database = null; reject(new Error('无法打开材料数据库：' + request.error.message)); };
      request.onblocked = () => { database = null; reject(new Error('数据库被另一窗口占用，请关闭旧窗口后重试。')); };
    });
    return database;
  }
  async function transact(transform) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('state', transform ? 'readwrite' : 'readonly');
      const store = tx.objectStore('state');
      const request = store.get('current');
      let result, failure;
      request.onsuccess = () => {
        try {
          const current = domain.validate(request.result || domain.empty());
          // Read and write in one transaction so multiple windows cannot overwrite each other's changes.
          result = transform ? transform(current) : current;
          if (transform) store.put(domain.validate(result), 'current');
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(failure || new Error('材料数据保存失败：' + (tx.error?.message || '存储不可用')));
    });
  }
  global.MaterialStore = Object.freeze({
    read: () => transact(),
    save: (key, doc) => transact(state => domain.save(state, key, doc)),
    voidDocument: (key, id) => transact(state => domain.voidDocument(state, key, id)),
    restore: backup => transact(state => domain.merge(state, backup)),
    backup: async () => ({ format: 'material-management', version: 1, exportedAt: new Date().toISOString(), state: await transact() })
  });
})(window);
