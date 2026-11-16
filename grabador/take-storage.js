'use strict';
(() => {
  const request = result => new Promise((resolve, reject) => {
    result.onsuccess = () => resolve(result.result);
    result.onerror = () => reject(result.error);
  });

  async function open() {
    const opening = indexedDB.open('11-records-mobile', 1);
    opening.onupgradeneeded = () => {
      const db = opening.result;
      db.createObjectStore('takes', { keyPath: 'id' }).createIndex('pair', 'pair');
      db.createObjectStore('parts', { keyPath: ['id', 'offset'] });
    };
    const db = await request(opening);
    const takes = ['takes', 'parts'];
    const range = id => IDBKeyRange.bound([id, 0], [id, Number.MAX_SAFE_INTEGER]);

    function write(change) {
      return new Promise((resolve, reject) => {
        const tx = db.transaction(takes, 'readwrite');
        tx.oncomplete = () => resolve();
        tx.onabort = () => reject(tx.error || Error('No se pudo guardar la toma en el celular'));
        change(tx.objectStore('takes'), tx.objectStore('parts'));
      });
    }

    return {
      async latest(pair) {
        const records = await request(db.transaction('takes').objectStore('takes').index('pair').getAll(pair));
        return records.sort((a, b) => b.at - a.at)[0] || null;
      },
      put(take) {
        return write(records => records.put(take));
      },
      add(take, offset, blob) {
        return write((records, parts) => {
          parts.put({ id: take.id, offset, blob });
          records.put(take);
        });
      },
      part(id, offset) {
        return new Promise((resolve, reject) => {
          const cursor = db.transaction('parts').objectStore('parts')
            .openCursor(IDBKeyRange.bound([id, 0], [id, offset]), 'prev');
          cursor.onsuccess = () => resolve(cursor.result?.value || null);
          cursor.onerror = () => reject(cursor.error);
        });
      },
      async file(take) {
        const parts = await request(db.transaction('parts').objectStore('parts').getAll(range(take.id)));
        return new Blob(parts.map(part => part.blob), { type: 'video/' + take.format });
      },
      remove(id) {
        return write((records, parts) => { records.delete(id); parts.delete(range(id)); });
      }
    };
  }

  window.RecordsTakeStorage = { open };
})();
