'use strict';
/*
 * Fotos para las marcas [IMAGEN], [JUGADOR] y [VS]: búsqueda en Wikimedia Commons (licencias libres)
 * o fotos propias. Se guardan en el navegador (IndexedDB) junto al proyecto.
 */
const ShortsImages = (() => {
  const FX = ShortsEffects;
  const S = ShortsStore;
  const API = 'https://commons.wikimedia.org/w/api.php';
  const OK_MIME = /^image\/(jpeg|png|webp)$/;

  const strip = html => String(html || '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();

  /** Busca en Commons y devuelve la mejor foto { url, title, credit, pageUrl } o null. */
  async function search(query, signal) {
    const params = new URLSearchParams({
      action: 'query', format: 'json', origin: '*', generator: 'search', gsrsearch: query + ' filetype:bitmap', gsrnamespace: '6', gsrlimit: '12',
      prop: 'imageinfo', iiprop: 'url|mime|size|extmetadata', iiurlwidth: '1280', iiextmetadatafilter: 'Artist|LicenseShortName|Restrictions'
    });
    const response = await fetch(API + '?' + params, { signal });
    if (!response.ok) throw Error('Commons respondió ' + response.status);
    const data = await response.json();
    const pages = Object.values(data?.query?.pages || {}).sort((a, b) => (a.index || 0) - (b.index || 0));
    for (const page of pages) {
      const info = page.imageinfo?.[0];
      if (!info || !OK_MIME.test(info.mime || '') || (info.width || 0) < 500 || (info.height || 0) < 400) continue;
      const meta = info.extmetadata || {};
      if (strip(meta.Restrictions?.value)) continue;
      const author = strip(meta.Artist?.value).slice(0, 60) || 'Autor desconocido';
      const license = strip(meta.LicenseShortName?.value) || 'Licencia libre';
      return { url: info.thumburl || info.url, title: String(page.title || '').replace(/^File:/, ''), pageUrl: info.descriptionurl || '', credit: 'Foto: ' + author + ' · ' + license + ' · Wikimedia Commons' };
    }
    return null;
  }

  async function saveBlob(project, query, blob, fields) {
    const key = project.id + ':photo:' + FX.photoKey(query) + ':' + Date.now();
    await S.putBlob(key, blob);
    project.photos ||= {};
    const old = project.photos[FX.photoKey(query)];
    if (old?.blob) S.deleteBlob(old.blob).catch(() => {});
    project.photos[FX.photoKey(query)] = { query, blob: key, at: new Date().toISOString(), ...fields };
  }

  /** Busca una foto en Commons para la consulta y la guarda. Devuelve true si la encontró. */
  async function find(project, query, signal) {
    const found = await search(query, signal);
    project.photos ||= {};
    if (!found) { project.photos[FX.photoKey(query)] = { query, source: 'ninguna', at: new Date().toISOString() }; return false; }
    const response = await fetch(found.url, { signal });
    if (!response.ok) throw Error('No se pudo descargar la foto (' + response.status + ')');
    const blob = await response.blob();
    await saveBlob(project, query, blob, { source: 'commons', credit: found.credit, title: found.title, pageUrl: found.pageUrl });
    return true;
  }

  /** Foto propia elegida por el usuario. */
  async function upload(project, query, file) {
    if (!/^image\//.test(file?.type || '')) throw Error('Elige una imagen (JPG, PNG o WebP)');
    await saveBlob(project, query, file, { source: 'propia', credit: '', title: file.name || 'Foto propia' });
  }

  function remove(project, query) {
    const entry = project.photos?.[FX.photoKey(query)];
    if (entry?.blob) S.deleteBlob(entry.blob).catch(() => {});
    if (project.photos) project.photos[FX.photoKey(query)] = { query, source: 'quitada', at: new Date().toISOString() };
  }

  const entry = (project, query) => project.photos?.[FX.photoKey(query)] || null;

  /** Busca las fotos que faltan (sin repetir las que no se encontraron ni las quitadas). */
  async function ensure(project, queries, { signal, onProgress = () => {} } = {}) {
    const missing = queries.filter(q => !entry(project, q));
    let found = 0;
    for (const [i, query] of missing.entries()) {
      if (signal?.aborted) break;
      onProgress(i / Math.max(1, missing.length), 'Buscando foto: ' + query);
      try { if (await find(project, query, signal)) found++; }
      catch (error) { if (error.name === 'AbortError') throw error; console.warn('Foto no disponible para «' + query + '»', error); }
    }
    return { searched: missing.length, found };
  }

  /** Carga las fotos del proyecto como imágenes listas para dibujar. */
  async function load(project, queries) {
    const out = new Map();
    for (const query of queries) {
      const e = entry(project, query);
      if (!e?.blob) continue;
      try {
        const blob = await S.getBlob(e.blob);
        if (!blob) continue;
        const image = await createImageBitmap(blob);
        out.set(FX.photoKey(query), { image, credit: e.credit || '' });
      } catch (error) { console.warn('No se pudo abrir la foto de «' + query + '»', error); }
    }
    return { get: query => out.get(FX.photoKey(query)) || null, size: out.size, close: () => { for (const p of out.values()) p.image.close?.(); } };
  }

  /** Créditos de las fotos de Commons, para pegar en la descripción. */
  const credits = project => Object.values(project.photos || {}).filter(p => p.source === 'commons' && p.credit).map(p => p.credit + (p.pageUrl ? ' (' + p.pageUrl + ')' : ''));

  return { search, find, upload, remove, ensure, load, entry, credits };
})();
