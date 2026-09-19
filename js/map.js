/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Kartenansicht (Wohnorte)

   Leaflet + OpenStreetMap-Kacheln, erst beim ersten Öffnen nachgeladen
   (gepinnte Version mit SRI). Grundlage sind die geokodierten Ortsfelder
   `placeLat`/`placeLng`/`placeName` (Migration 012) — Freitext ohne
   Auswahl aus dem Orts-Picker erscheint nicht.

   - Alle Zweige zugleich, Farbe je Zweig; der Zweig-Umschalter oben wirkt
     hier als Mehrfach-Filter (App setzt setFilter()).
   - Standard: nur Lebende; Schalter „auch Verstorbene" (letzter Wohnort).
   - Ehepaare (aktuelle Partner) als EIN Eintrag, wenn beide am selben Ort
     wohnen oder nur bei einem ein Ort steht.
   - Eigene Bündelung je Zoomstufe (Rasterzellen in Bildschirm-Pixeln):
     Kreis mit Personenzahl → Tipp zoomt hinein; ein Ort → Pin mit Zahl,
     Tipp öffnet die Personenliste, Tipp auf eine Person das Profil.
   ═══════════════════════════════════════════════════════════ */

const MapView = (() => {
  const LEAFLET = {
    js:  'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.js',
    jsSri:  'sha512-BwHfrr4c9kmRkLw6iXFdzcdWV/PGkVgiIyIWLLlTSXzWQzxuSg4DiQUCpauz/EWjgk5TYQqX/kvn9pG1NpYfqg==',
    css: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.css',
    cssSri: 'sha512-Zcn6bjR/8RZbLEpLIeOwNtzREBAJnUKESxces60Mpoj+2okopSAcSUIUOseddDm0cxnGQzxIR7vJgsLZbdLE3w==',
  };
  const TILES = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
  const ATTRIB = '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>-Mitwirkende';
  const CELL = 64;              // Rasterzelle der Bündelung (px)
  const SAME_PLACE_KM = 2;      // Partner „am selben Ort": Abstand unter …
  const BRANCH_COLORS = ['#457b9d', '#e63946', '#2a9d8f', '#e9a03b', '#8e6bbf'];
  const OTHER_COLOR = '#9ca3af';
  const HOME = { lat: 51.2, lng: 10.4, zoom: 5 };   // Deutschland, wenn nichts da ist

  let container = null, mapEl = null, toolsEl = null, listEl = null, emptyEl = null;
  let map = null, layer = null;
  let active = false, leafletReady = null;
  let members = [], relationships = [], families = [];
  let filter = null;            // Set von Zweig-Wurzeln (null = alle)
  let showDeceased = false;
  let onTapCallback = null;
  let onBackgroundTapCallback = null;
  let entries = [];             // berechnete Karteneinträge (Person/Paar)
  let fitted = false;           // erste Einpassung erledigt
  let openPlace = null;         // Ort, dessen Liste offen ist (Schlüssel)

  // ═══════════════════════════════════════════════════════════
  //  INIT / LADEN
  // ═══════════════════════════════════════════════════════════

  function init(containerId) {
    container = document.getElementById(containerId);
    mapEl = Utils.createEl('div', { className: 'map-canvas' });
    toolsEl = Utils.createEl('div', { className: 'map-tools' });
    const toggle = Utils.createEl('button', { className: 'map-toggle', type: 'button', textContent: 'auch Verstorbene' });
    toggle.setAttribute('aria-pressed', 'false');
    toggle.addEventListener('click', () => {
      showDeceased = !showDeceased;
      toggle.classList.toggle('active', showDeceased);
      toggle.setAttribute('aria-pressed', String(showDeceased));
      closeList();
      render(true);
    });
    toolsEl.appendChild(toggle);
    listEl = Utils.createEl('div', { className: 'map-list hidden' });
    emptyEl = Utils.createEl('div', { className: 'map-empty hidden' });
    container.append(mapEl, toolsEl, listEl, emptyEl);
  }

  /** Leaflet einmalig nachladen (CSS + JS, mit Integritätsprüfung). */
  function ensureLeaflet() {
    if (window.L) return Promise.resolve();
    if (leafletReady) return leafletReady;
    leafletReady = new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet'; link.href = LEAFLET.css; link.integrity = LEAFLET.cssSri; link.crossOrigin = 'anonymous';
      document.head.appendChild(link);
      const s = document.createElement('script');
      s.src = LEAFLET.js; s.integrity = LEAFLET.jsSri; s.crossOrigin = 'anonymous';
      s.onload = () => resolve();
      s.onerror = () => { leafletReady = null; reject(new Error('Leaflet konnte nicht geladen werden')); };
      document.head.appendChild(s);
    });
    return leafletReady;
  }

  function createMap() {
    if (map) return;
    map = L.map(mapEl, { zoomControl: false, attributionControl: true, worldCopyJump: true });
    map.attributionControl.setPrefix('');
    L.tileLayer(TILES, { maxZoom: 18, attribution: ATTRIB }).addTo(map);
    L.control.zoom({ position: 'bottomright' }).addTo(map);
    layer = L.layerGroup().addTo(map);
    map.setView([HOME.lat, HOME.lng], HOME.zoom);
    map.on('zoomend', () => render(false));
    map.on('click', () => { closeList(); if (onBackgroundTapCallback) onBackgroundTapCallback(); });
  }

  function show() {
    active = true;
    container.classList.remove('hidden');
    ensureLeaflet().then(() => {
      if (!active) return;
      createMap();
      map.invalidateSize();
      render(true);
    }).catch(err => {
      console.error('[Map]', err);
      emptyEl.textContent = 'Karte konnte nicht geladen werden (keine Verbindung?).';
      emptyEl.classList.remove('hidden');
    });
  }

  function hide() {
    active = false;
    container.classList.add('hidden');
    closeList();
  }

  // ═══════════════════════════════════════════════════════════
  //  DATEN → EINTRÄGE
  // ═══════════════════════════════════════════════════════════

  let onlyAssigned = false;     // temporäre Stammperson: nur Personen ihres Teilbaums
  function setData(memberData, relationshipData, familyData, opts = {}) {
    members = memberData; relationships = relationshipData; families = familyData || [];
    onlyAssigned = !!opts.onlyAssigned;
    fitted = false;
    if (active && map) render(true);
  }

  /** Zweig-Filter (Set von Wurzel-IDs); null = alle. */
  function setFilter(set) {
    filter = set ? new Set(set) : null;
    closeList();
    if (active && map) render(true);   // Einträge neu filtern (kein Neu-Einpassen, das passiert nur einmal)
  }

  function branchOf(id) {
    const f = families.find(x => x.assigned && x.assigned.has(id));
    return f ? f.rootId : null;
  }
  function branchColor(rootId) {
    const i = families.findIndex(f => f.rootId === rootId);
    return i < 0 ? OTHER_COLOR : BRANCH_COLORS[i % BRANCH_COLORS.length];
  }
  function hasPlace(m) { return typeof m.placeLat === 'number' && typeof m.placeLng === 'number'; }
  function kmBetween(a, b) {
    const toRad = d => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * 6371 * Math.asin(Math.sqrt(s));
  }
  const nameOf = m => `${m.callName || m.firstName} ${m.lastName}`.trim();

  /**
   * Personen/Paare mit Ort, nach Filtern. Ein Paar (aktuelle Partner) wird
   * ein Eintrag, wenn beide am selben Ort wohnen oder nur einer einen Ort
   * hat — sonst zwei Einträge („Adressen explizit unterschiedlich").
   */
  function buildEntries() {
    const byId = new Map(members.map(m => [m.id, m]));
    const spouseOf = new Map();
    for (const r of relationships) {
      if (r.type !== 'spouse' || r.isFormer) continue;
      if (!byId.has(r.fromId) || !byId.has(r.toId)) continue;
      if (!spouseOf.has(r.fromId)) spouseOf.set(r.fromId, []);
      if (!spouseOf.has(r.toId)) spouseOf.set(r.toId, []);
      spouseOf.get(r.fromId).push(r.toId); spouseOf.get(r.toId).push(r.fromId);
    }
    const visible = m => {
      if (!showDeceased && m.isDeceased) return false;
      const b = branchOf(m.id);
      if (onlyAssigned && !b) return false;
      if (filter && b && !filter.has(b)) return false;
      return true;
    };
    const out = [];
    const used = new Set();
    const sorted = members.filter(m => hasPlace(m) && visible(m))
      .sort((a, b) => nameOf(a).localeCompare(nameOf(b), 'de'));
    for (const m of sorted) {
      if (used.has(m.id)) continue;
      used.add(m.id);
      const me = { lat: m.placeLat, lng: m.placeLng };
      let partner = null;
      for (const sid of (spouseOf.get(m.id) || [])) {
        const s = byId.get(sid);
        if (!s || used.has(s.id) || !visible(s)) continue;
        if (!hasPlace(s) || kmBetween(me, { lat: s.placeLat, lng: s.placeLng }) <= SAME_PLACE_KM) { partner = s; break; }
      }
      if (partner) used.add(partner.id);
      const persons = partner ? [m, partner] : [m];
      // Zweig des Eintrags: Blutlinien-Mitglied bevorzugt (Angeheiratete sind
      // per assigned ebenfalls im Zweig, aber der erste Treffer reicht)
      const branch = persons.map(p => branchOf(p.id)).find(Boolean) || null;
      let label;
      if (partner) {
        label = m.lastName === partner.lastName
          ? `${m.callName || m.firstName} & ${partner.callName || partner.firstName} ${m.lastName}`
          : `${nameOf(m)} & ${nameOf(partner)}`;
      } else label = nameOf(m);
      out.push({ ids: persons.map(p => p.id), persons, label, lat: me.lat, lng: me.lng,
                 place: m.placeName || m.location || '', branch, deceased: persons.every(p => p.isDeceased) });
    }
    return out;
  }

  // ═══════════════════════════════════════════════════════════
  //  BÜNDELUNG + RENDER
  // ═══════════════════════════════════════════════════════════

  /** Einträge in Rasterzellen (Bildschirm-Pixel) der aktuellen Zoomstufe bündeln. */
  function clusterEntries(list) {
    const z = map.getZoom();
    const cells = new Map();
    for (const e of list) {
      const p = map.project([e.lat, e.lng], z);
      const key = `${Math.floor(p.x / CELL)}:${Math.floor(p.y / CELL)}`;
      if (!cells.has(key)) cells.set(key, { entries: [], sumLat: 0, sumLng: 0 });
      const c = cells.get(key);
      c.entries.push(e); c.sumLat += e.lat; c.sumLng += e.lng;
    }
    return [...cells.values()].map(c => {
      const places = new Set(c.entries.map(e => e.place));
      const persons = c.entries.reduce((n, e) => n + e.ids.length, 0);
      return { entries: c.entries, persons, lat: c.sumLat / c.entries.length, lng: c.sumLng / c.entries.length,
               single: places.size === 1, place: places.size === 1 ? c.entries[0].place : null };
    });
  }

  function render(recompute) {
    if (!map) return;
    if (recompute || !entries.length) entries = buildEntries();
    layer.clearLayers();
    const clusters = clusterEntries(entries);
    for (const c of clusters) {
      const color = dominantColor(c.entries);
      if (c.single) {
        // Ein Ort: Pin mit Personenzahl, darunter der Ortsname
        const html = `<div class="map-pin${c.entries.every(e => e.deceased) ? ' is-deceased' : ''}" style="--pin:${color}">`
          + `<span class="map-pin-count">${c.persons}</span></div>`
          + `<div class="map-pin-label">${Utils.escapeHtml(shortPlace(c.place))}</div>`;
        const icon = L.divIcon({ className: 'map-marker', html, iconSize: [0, 0], iconAnchor: [0, 0] });
        const mk = L.marker([c.lat, c.lng], { icon, keyboard: false });
        mk.on('click', ev => { L.DomEvent.stopPropagation(ev); openList(c); });
        mk.addTo(layer);
      } else {
        // Mehrere Orte: Kreis mit Zahl, Tipp zoomt auf die enthaltenen Orte
        const size = 34 + Math.min(26, Math.round(Math.sqrt(c.persons) * 5));
        const html = `<div class="map-cluster" style="--pin:${color};width:${size}px;height:${size}px">${c.persons}</div>`;
        const icon = L.divIcon({ className: 'map-marker', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
        const mk = L.marker([c.lat, c.lng], { icon, keyboard: false });
        mk.on('click', ev => {
          L.DomEvent.stopPropagation(ev);
          const b = L.latLngBounds(c.entries.map(e => [e.lat, e.lng]));
          map.fitBounds(b, { padding: [60, 60], maxZoom: 13, animate: true });
        });
        mk.addTo(layer);
      }
    }
    emptyEl.classList.toggle('hidden', entries.length > 0);
    if (!entries.length) emptyEl.textContent = members.some(hasPlace)
      ? 'Keine Personen für die gewählten Zweige' + (showDeceased ? '.' : ' (nur Lebende — Schalter „auch Verstorbene").')
      : 'Noch keine Wohnorte mit Koordinaten. Im Profil-Editor den Ort aus der Vorschlagsliste wählen, dann erscheint er hier.';
    if (recompute && !fitted && entries.length) { fitAll(false); fitted = true; }
  }

  function dominantColor(list) {
    const count = new Map();
    for (const e of list) count.set(e.branch, (count.get(e.branch) || 0) + e.ids.length);
    let best = null, n = -1;
    for (const [b, k] of count) if (k > n) { best = b; n = k; }
    return branchColor(best);
  }

  /** „Hamburg, Deutschland" → „Hamburg"; sonst mit Land (Ausland bleibt erkennbar) */
  function shortPlace(place) {
    const parts = String(place || '').split(',').map(s => s.trim()).filter(Boolean);
    if (parts.length >= 2 && /^(Deutschland|Germany)$/i.test(parts[parts.length - 1])) return parts.slice(0, -1).join(', ');
    return parts.join(', ');
  }

  /**
   * Alles einpassen — aber Ausreißer (Neuseeland, Südafrika) nicht die
   * Karte auf Weltgröße zwingen: liegt der Großteil in einem Umkreis von
   * 1500 km um den Schwerpunkt, wird nur dieser Kern eingepasst.
   */
  function fitAll(animate = true) {
    if (!map) return;
    if (!entries.length) { map.setView([HOME.lat, HOME.lng], HOME.zoom); return; }
    let core = entries;
    if (entries.length > 2) {
      const c = { lat: entries.reduce((s, e) => s + e.lat, 0) / entries.length, lng: entries.reduce((s, e) => s + e.lng, 0) / entries.length };
      // Schwerpunkt robuster: der Eintrag mit der kleinsten Summe der Abstände
      const medoid = entries.reduce((best, e) => {
        const d = entries.reduce((s, o) => s + kmBetween(e, o), 0);
        return !best || d < best.d ? { e, d } : best;
      }, null).e;
      const near = entries.filter(e => kmBetween(e, medoid) <= 1500);
      const persons = list => list.reduce((n, e) => n + e.ids.length, 0);
      if (persons(near) >= 0.6 * persons(entries)) core = near;
    }
    const b = L.latLngBounds(core.map(e => [e.lat, e.lng]));
    // Ränder frei halten: oben Zweig-Umschalter, unten Status-Pille + Ansichts-Umschalter
    map.fitBounds(b, { paddingTopLeft: [30, 110], paddingBottomRight: [30, 120], maxZoom: 11, animate });
  }

  // ═══════════════════════════════════════════════════════════
  //  PERSONENLISTE EINES ORTS
  // ═══════════════════════════════════════════════════════════

  function openList(cluster) {
    openPlace = cluster.place;
    listEl.innerHTML = '';
    const head = Utils.createEl('div', { className: 'map-list-head' });
    head.append(
      Utils.createEl('span', { className: 'map-list-title', textContent: shortPlace(cluster.place) }),
      Utils.createEl('span', { className: 'map-list-count', textContent: `${cluster.persons} ${cluster.persons === 1 ? 'Person' : 'Personen'}` }),
      Utils.createEl('button', { className: 'map-list-close', type: 'button', textContent: '×', 'aria-label': 'Schließen' }),
    );
    head.querySelector('.map-list-close').addEventListener('click', closeList);
    listEl.appendChild(head);
    const ul = Utils.createEl('div', { className: 'map-list-items' });
    const sorted = cluster.entries.slice().sort((a, b) => a.label.localeCompare(b.label, 'de'));
    for (const e of sorted) {
      const fam = families.find(f => f.rootId === e.branch);
      const row = Utils.createEl('button', { className: 'map-list-item' + (e.deceased ? ' is-deceased' : ''), type: 'button' });
      row.append(
        Utils.createEl('span', { className: 'map-list-dot', style: { background: branchColor(e.branch) } }),
        Utils.createEl('span', { className: 'map-list-name', textContent: e.label + (e.deceased ? ' †' : '') }),
        Utils.createEl('span', { className: 'map-list-branch', textContent: fam ? fam.short : '' }),
      );
      row.addEventListener('click', () => { if (onTapCallback) onTapCallback(e.ids[0]); });
      ul.appendChild(row);
    }
    listEl.appendChild(ul);
    listEl.classList.remove('hidden');
  }

  function closeList() {
    openPlace = null;
    if (listEl) listEl.classList.add('hidden');
  }

  // ═══════════════════════════════════════════════════════════
  //  API
  // ═══════════════════════════════════════════════════════════

  /** Farben je Zweig für die Legende. */
  function getLegend() {
    return families.map(f => ({ rootId: f.rootId, short: f.short, color: branchColor(f.rootId) }))
      .concat([{ rootId: null, short: 'ohne Zweig', color: OTHER_COLOR }]);
  }

  /** Ort einer Person zeigen (z.B. aus dem Profil). */
  function centerOn(memberId) {
    const e = entries.find(x => x.ids.includes(memberId));
    if (!e || !map) return false;
    map.setView([e.lat, e.lng], Math.max(map.getZoom(), 10), { animate: true });
    return true;
  }

  return {
    init, show, hide, isActive: () => active,
    setData, setFilter, getFilter: () => (filter ? new Set(filter) : null),
    setShowDeceased: (b) => { showDeceased = !!b; render(true); },
    onTap: (cb) => { onTapCallback = cb; },
    onBackgroundTap: (cb) => { onBackgroundTapCallback = cb; },
    fitAll, centerOn, getLegend,
    getEntries: () => entries.slice(),
  };
})();
