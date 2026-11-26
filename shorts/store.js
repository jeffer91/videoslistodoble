'use strict';
/* Almacenamiento local de los Shorts (IndexedDB). Nada sale del dispositivo. */
const ShortsStore = (() => {
  const NAME = 'shorts-11-records';
  let opening = null;

  function open() {
    if (!opening) {
      opening = new Promise((resolve, reject) => {
        const request = indexedDB.open(NAME, 1);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains('projects')) db.createObjectStore('projects', { keyPath: 'id' });
          if (!db.objectStoreNames.contains('blobs')) db.createObjectStore('blobs');
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || Error('No se pudo abrir el almacenamiento del navegador.'));
      });
    }
    return opening;
  }

  async function run(storeName, mode, action) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let result;
      const request = action(store);
      if (request) request.onsuccess = () => { result = request.result; };
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error || Error('Error de almacenamiento'));
      tx.onabort = () => reject(tx.error || Error('Almacenamiento lleno o no disponible.'));
    });
  }

  const newId = () => (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2));

  function create(fields = {}) {
    const now = new Date().toISOString();
    return {
      id: newId(), title: '', script: { hook: '', body: '', closing: '' }, takes: {},
      options: { cutSilences: true, captions: true, captionQuality: 'base', stamp: true, logo: true,
        effects: true, captionStyle: 'limpio', titleStyle: 'caja', zoom: true, sfx: true, progress: true, grade: true, loop: false, recHook: false },
      output: null, captions: null, photos: {},
      createdAt: now, updatedAt: now, ...fields
    };
  }

  const list = async () => ((await run('projects', 'readonly', s => s.getAll())) || [])
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
  const get = id => run('projects', 'readonly', s => s.get(id));
  async function save(project) {
    project.updatedAt = new Date().toISOString();
    await run('projects', 'readwrite', s => s.put(project));
    return project;
  }
  const putBlob = (key, blob) => run('blobs', 'readwrite', s => s.put(blob, key));
  const getBlob = key => run('blobs', 'readonly', s => s.get(key));
  const deleteBlob = key => run('blobs', 'readwrite', s => s.delete(key));

  async function remove(id) {
    const project = await get(id);
    if (project) {
      for (const take of Object.values(project.takes || {})) if (take?.blob) await deleteBlob(take.blob);
      if (project.output?.blob) await deleteBlob(project.output.blob);
      for (const photo of Object.values(project.photos || {})) if (photo?.blob) await deleteBlob(photo.blob);
    }
    await run('projects', 'readwrite', s => s.delete(id));
  }

  async function persist() {
    try { if (navigator.storage?.persist) return await navigator.storage.persist(); } catch {}
    return false;
  }

  return { create, list, get, save, remove, putBlob, getBlob, deleteBlob, persist, newId };
})();
