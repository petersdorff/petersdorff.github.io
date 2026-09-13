/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Fan Chart (radiale Nachkommen-Ansicht)  v1
   Sunburst-Layout: Stammvater im Zentrum, jede Generation ein
   Ring, Winkelbreite ∝ Zahl der Nachkommen-Blätter. Angeheiratete
   Partner erscheinen als „∞ Name"-Untertitel im Segment des
   Blutsverwandten. Reines SVG, unabhängig von Cytoscape.
   ═══════════════════════════════════════════════════════════ */

const Fan = (() => {
  const RING = 88;         // Ringabstand (SVG-Einheiten), inkl. Lücke
  const RING_GAP = 6;      // radiale Lücke zwischen Generationsringen
  const SEG_GAP = 4;       // Lücke zwischen Tortenstücken (konstante Breite)
  const CENTER_R = 82;     // Radius des Zentrums (Stammeltern)
  const PAD = 30;
  const CHAR_W = 0.6;      // IBM Plex Mono: Zeichenbreite in em
  // Semantic Zoom: Schwellen in Pixel pro SVG-Einheit.
  //   far  (< 0.55): nur Vorname, groß
  //   mid  (< 1.1):  Vorname + Partner-Vornamen
  //   full:          Vorname + Partner mit Geburtsname + Lebensdaten
  const LOD_MID = 0.55, LOD_FULL = 1.1;
  const NS = 'http://www.w3.org/2000/svg';

  let container = null, svg = null;
  let segLayer = null, hlLayer = null, labelLayer = null;   // z-Reihenfolge
  let members = [], relationships = [];
  let active = false;
  let vb = { x: -500, y: -500, w: 1000, h: 1000 };
  let chartRadius = 400;
  let onTapCallback = null;
  let segById = new Map();  // id → { x, y, shape } (Blutlinie, hat Segment)
  let hostOf = new Map();   // Angeheiratete → id des Partner-Segments
  let highlight = null;     // { fromId, toId } — Verwandtschaftspfad
  let labelSpecs = [];      // Geometrie je Segment, Labels werden je Zoomstufe neu gesetzt
  let hlAnchors = [];       // Ankerpunkte des aktiven Pfads (für fitToHighlight)
  let involved = null;      // Set der beteiligten Segment-IDs; alle anderen werden gedimmt
  let lodTier = null;
  let rootId = null;

  // ═══════════════════════════════════════════════════════════
  //  INIT / STATE
  // ═══════════════════════════════════════════════════════════

  function init(containerId) {
    container = document.getElementById(containerId);
    svg = el('svg', { class: 'fan-svg' });
    segLayer = el('g', { class: 'fan-segs' });
    hlLayer = el('g', { class: 'fan-hl' });
    labelLayer = el('g', { class: 'fan-labels' });
    svg.appendChild(segLayer);
    svg.appendChild(hlLayer);
    svg.appendChild(labelLayer);
    container.appendChild(svg);
    attachPanZoom();
    // Wird der Container erst sichtbar (0 → Breite), einpassen; sonst nur
    // das Seitenverhältnis nachziehen (z.B. Rotation des Handys).
    let lastW = 0;
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        if (!active) return;
        const w = container.clientWidth;
        if (w > 0 && lastW === 0 && members.length) {
          highlight && hlAnchors.length ? fitToHighlight() : fit();
        } else if (w > 0) {
          keepAspect();
        }
        lastW = w;
      }).observe(container);
    }
  }

  function onTap(cb) { onTapCallback = cb; }
  function isActive() { return active; }

  function show() {
    active = true;
    container.classList.remove('hidden');
    if (!members.length) return;
    if (highlight && hlAnchors.length) fitToHighlight(); else fit();
  }

  function hide() {
    active = false;
    container.classList.add('hidden');
  }

  function toggle() { active ? hide() : show(); return active; }

  // ═══════════════════════════════════════════════════════════
  //  DATENMODELL → BAUM
  // ═══════════════════════════════════════════════════════════

  function buildTree() {
    const byId = new Map(members.map(m => [m.id, m]));
    const parentsOf = new Map(), childrenOf = new Map(), spousesOf = new Map();
    const push = (mp, k, v) => { if (!mp.has(k)) mp.set(k, []); mp.get(k).push(v); };
    for (const r of relationships) {
      if (!byId.has(r.fromId) || !byId.has(r.toId)) continue;
      if (r.type === 'parent_child') { push(parentsOf, r.toId, r.fromId); push(childrenOf, r.fromId, r.toId); }
      else if (r.type === 'spouse') { push(spousesOf, r.fromId, r.toId); push(spousesOf, r.toId, r.fromId); }
    }
    const byBirth = (a, b) => (a.birthDate || '9999').localeCompare(b.birthDate || '9999');

    // Wurzel: ältester Elternlose mit Kindern (Stammvater)
    const roots = members.filter(m => !parentsOf.has(m.id) && childrenOf.has(m.id)).sort(byBirth);
    if (!roots.length) return null;
    const rootMember = roots[0];
    rootId = rootMember.id;

    // Jede Person genau einmal: Blutsverwandte als Segment, deren
    // Partner als Untertitel. Kinder hängen am ersten erreichten Elternteil.
    const assigned = new Set([rootMember.id]);
    function makeNode(m, depth, branch) {
      const spouses = (spousesOf.get(m.id) || []).map(id => byId.get(id))
        .filter(s => s && !assigned.has(s.id)).sort(byBirth);
      spouses.forEach(s => assigned.add(s.id));
      const kids = (childrenOf.get(m.id) || []).map(id => byId.get(id))
        .filter(k => k && !assigned.has(k.id)).sort(byBirth);
      kids.forEach(k => assigned.add(k.id));
      const node = { m, depth, branch, spouses, children: [] };
      node.children = kids.map((k, i) => makeNode(k, depth + 1, depth === 0 ? i : branch));
      node.weight = node.children.length
        ? node.children.reduce((s, c) => s + c.weight, 0)
        : 1;
      return node;
    }
    const root = makeNode(rootMember, 0, 0);

    const unassigned = members.filter(m => !assigned.has(m.id));
    if (unassigned.length) {
      console.info(`[Fan] ${unassigned.length} Personen nicht über ${rootMember.firstName} erreichbar:`,
        unassigned.map(m => `${m.firstName} ${m.lastName}`).join(', '));
    }
    return root;
  }

  // ═══════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════

  function render(memberData, relationshipData) {
    members = memberData;
    relationships = relationshipData;
    segLayer.innerHTML = ''; hlLayer.innerHTML = ''; labelLayer.innerHTML = '';
    segById = new Map(); hostOf = new Map(); labelSpecs = []; lodTier = null;

    const root = buildTree();
    if (!root) return;

    let maxDepth = 0;
    const currentUserId = (typeof Tree !== 'undefined' && Tree.getCurrentUser) ? Tree.getCurrentUser() : null;
    const familyName = root.m.lastName;

    // Winkel rekursiv zuweisen (Start oben, im Uhrzeigersinn)
    const TWO_PI = Math.PI * 2;
    const items = [];
    function assign(node, a0, a1) {
      if (node.depth > 0) items.push({ node, a0, a1 });
      maxDepth = Math.max(maxDepth, node.depth);
      let a = a0;
      for (const c of node.children) {
        const span = (a1 - a0) * (c.weight / node.weight);
        assign(c, a, a + span);
        a += span;
      }
    }
    assign(root, -Math.PI / 2, -Math.PI / 2 + TWO_PI);
    chartRadius = CENTER_R + maxDepth * RING;

    // Segmente (innere Ringe zuerst, aktueller Nutzer zuletzt = oben)
    items.sort((p, q) => p.node.depth - q.node.depth);
    const deferred = [];
    for (const it of items) {
      const isMe = it.node.m.id === currentUserId;
      const g = drawSegment(it, familyName, isMe);
      if (isMe) deferred.push(g); else segLayer.appendChild(g);
    }
    drawCenter(root, familyName, root.m.id === currentUserId);
    deferred.forEach(g => segLayer.appendChild(g));

    if (highlight) drawHighlight();
    if (active) { highlight && hlAnchors.length ? fitToHighlight() : fit(); }
    renderLabels(true);
  }

  function drawSegment({ node, a0, a1 }, familyName, isMe) {
    const r0 = CENTER_R + RING_GAP + (node.depth - 1) * RING;
    const r1 = r0 + RING - RING_GAP;
    const thick = r1 - r0;
    const m = node.m;
    const span = Math.min(a1 - a0, Math.PI * 2 - 1e-4);

    const g = el('g', { class: 'fan-seg', 'data-id': m.id });
    const fill = segColor(m.gender, node.depth, m.isDeceased);
    const stroke = isMe ? '#e63946' : (m.isPlaceholder ? 'none' : '#1a1a1a');
    const sw = isMe ? 3 : (m.isPlaceholder ? 0 : 1.6);
    const d = arcPath(r0, r1, a0, a0 + span, SEG_GAP);
    g.appendChild(el('path', { d, fill, stroke, 'stroke-width': sw, 'stroke-linejoin': 'round' }));

    // ── Label-Geometrie (Text selbst kommt aus renderLabels, je Zoomstufe) ──
    const rm = (r0 + r1) / 2;
    const arcLen = span * rm - 2 * SEG_GAP;
    const tangential = arcLen > thick * 1.15;
    const theta = a0 + span / 2;
    let rot = (tangential ? theta + Math.PI / 2 : theta) * 180 / Math.PI;
    rot = ((rot + 90) % 360 + 360) % 360 - 90;   // lesbar: (-90, 90]
    if (rot > 90) rot -= 180;
    labelSpecs.push({
      m, spouses: node.spouses, familyName, isMe,
      x: rm * Math.cos(theta), y: rm * Math.sin(theta), rot,
      along: (tangential ? arcLen : thick) - 12,
      across: (tangential ? thick : arcLen) - 6,
      lineH: 1.25,
    });

    segById.set(m.id, { x: rm * Math.cos(theta), y: rm * Math.sin(theta), shape: { d } });
    node.spouses.forEach(sp => hostOf.set(sp.id, m.id));
    return g;
  }

  function drawCenter(root, familyName, isMe) {
    const m = root.m;
    const g = el('g', { class: 'fan-seg fan-center', 'data-id': m.id });
    g.appendChild(el('circle', {
      r: CENTER_R, fill: segColor(m.gender, 0, m.isDeceased),
      stroke: isMe ? '#e63946' : '#1a1a1a', 'stroke-width': isMe ? 3 : 1.6,
    }));
    labelSpecs.push({
      m, spouses: root.spouses, familyName, isMe, center: true,
      x: 0, y: 0, rot: 0, along: CENTER_R * 2 - 24, across: CENTER_R * 2 - 24, lineH: 1.3,
    });
    segLayer.appendChild(g);
    segById.set(m.id, { x: 0, y: 0, shape: { r: CENTER_R } });
    root.spouses.forEach(sp => hostOf.set(sp.id, m.id));
  }

  // ═══════════════════════════════════════════════════════════
  //  VERWANDTSCHAFTSPFAD (rote Linie direkt im Fächer)
  // ═══════════════════════════════════════════════════════════

  function highlightConnection(fromId, toId) {
    highlight = { fromId, toId };
    if (!members.length) return;
    drawHighlight();
    if (active) fitToHighlight();
  }

  function clearHighlight() {
    highlight = null;
    hlAnchors = []; involved = null;
    if (hlLayer) hlLayer.innerHTML = '';
    if (segLayer) applyDim();
  }

  /** Pfadknoten → Ankerpunkt im Fächer. Angeheiratete liegen im Segment
      ihres Partners; aufeinanderfolgende gleiche Anker werden verschmolzen. */
  function pathAnchors(expandedPath) {
    const anchors = [];
    for (const step of expandedPath) {
      const segId = segById.has(step.id) ? step.id : hostOf.get(step.id);
      if (!segId) continue;
      if (anchors.length && anchors[anchors.length - 1].id === segId) continue;
      const seg = segById.get(segId);
      anchors.push({ id: segId, x: seg.x, y: seg.y, shape: seg.shape });
    }
    return anchors;
  }

  function drawHighlight() {
    hlLayer.innerHTML = '';
    hlAnchors = []; involved = null;
    if (!highlight) { applyDim(); return; }
    const { expandedPath } = Relationship.getPathData(highlight.fromId, highlight.toId, members, relationships);
    if (!expandedPath || !expandedPath.length) { applyDim(); return; }
    const anchors = pathAnchors(expandedPath);
    if (!anchors.length) { applyDim(); return; }
    const RED = '#e63946';

    // Beteiligte Segmente rot umranden, alle anderen ausgrauen
    for (const a of anchors) {
      hlLayer.appendChild(a.shape.d
        ? el('path', { d: a.shape.d, fill: 'none', stroke: RED, 'stroke-width': 3, 'stroke-linejoin': 'round' })
        : el('circle', { r: a.shape.r, fill: 'none', stroke: RED, 'stroke-width': 3 }));
    }
    hlAnchors = anchors;
    involved = new Set(anchors.map(a => a.id));
    applyDim();
  }

  /** Dimm-Klasse auf Segmente und Labels anwenden (oder entfernen). */
  function applyDim() {
    for (const g of segLayer.children) {
      g.classList.toggle('fan-dim', !!involved && !involved.has(g.getAttribute('data-id')));
    }
    for (const t of labelLayer.children) {
      t.classList.toggle('fan-dim', !!involved && !involved.has(t.getAttribute('data-id')));
    }
  }

  /** Viewport auf den Pfad einpassen; lässt Platz für das Verbindungs-Panel
      (rechts auf Desktop, unten auf Mobile) wie die Baumansicht. */
  function fitToHighlight() {
    const pts = hlAnchors;
    if (!pts.length) return;
    const pad = RING * 0.8;
    const minX = Math.min(...pts.map(p => p.x)) - pad, maxX = Math.max(...pts.map(p => p.x)) + pad;
    const minY = Math.min(...pts.map(p => p.y)) - pad, maxY = Math.max(...pts.map(p => p.y)) + pad;
    const cw = container.clientWidth || 1, ch = container.clientHeight || 1;
    const isDesktop = window.innerWidth >= 600;
    const panelW = isDesktop ? Math.min(320, cw * 0.5) : 0;
    const panelH = isDesktop ? 0 : Math.min(window.innerHeight * 0.45, ch * 0.5);
    const margin = 40;
    const availW = Math.max(50, cw - panelW - 2 * margin);
    const availH = Math.max(50, ch - panelH - 2 * margin);
    // Einheiten pro Pixel; nicht näher ran als bei centerOn
    const s = Math.max((maxX - minX) / availW, (maxY - minY) / availH, (RING * 5.5) / cw);
    vb.w = cw * s; vb.h = ch * s;
    const bcx = (minX + maxX) / 2, bcy = (minY + maxY) / 2;
    vb.x = bcx - ((cw - panelW) / 2) * s;
    vb.y = bcy - ((ch - panelH) / 2) * s;
    apply();
  }

  // ═══════════════════════════════════════════════════════════
  //  LABELS / SEMANTIC ZOOM
  // ═══════════════════════════════════════════════════════════

  function currentTier() {
    const k = (svg.clientWidth || 1) / vb.w;   // Pixel pro SVG-Einheit
    return k < LOD_MID ? 'far' : (k < LOD_FULL ? 'mid' : 'full');
  }

  /** Zeilen für ein Segment je Zoomstufe. Partner werden mitgeführt:
      fern gar nicht, mittel als Vornamen, nah mit Geburtsnamen. */
  function labelLines(spec, tier) {
    const { m, spouses, familyName, isMe, along, center } = spec;
    const lines = [];
    const me = isMe ? '➤ ' : '';
    if (tier === 'far') {
      const txt = center ? `${m.firstName} ${m.lastName}` : me + m.firstName;
      lines.push({ ...fitText(txt, along, center ? 13 : 18, 6.5), weight: 600 });
      if (center && spouses.length) {
        lines.push({ ...fitText('∞ ' + spouses.map(s => s.firstName).join(' · '), along, 10, 6), weight: 400, dim: true });
      }
    } else if (tier === 'mid') {
      const txt = center ? `${m.firstName} ${m.lastName}` : me + displayName(m, familyName);
      lines.push({ ...fitText(txt, along, center ? 12 : 13, 6.5), weight: 600 });
      if (spouses.length) lines.push(spouseLine(spouses, along, 9.5, 6, sp => sp.firstName));
    } else {
      const txt = center ? `${m.firstName} ${m.lastName}` : me + displayName(m, familyName);
      lines.push({ ...fitText(txt, along, 11, 6.5), weight: 600 });
      if (spouses.length) lines.push(spouseLine(spouses, along, 8.5, 6, spouseName));
      const yr = yearLabel(m);
      if (yr) lines.push({ ...fitText(yr, along, 8, 6), weight: 400, dim: true });
    }
    return lines;
  }

  /** „∞ Name · Name" als klickbare Teile: jeder Partner-Name trägt seine
      ID und öffnet beim Antippen das eigene Profil. Passt Schriftgröße
      an und kürzt notfalls den letzten Namen. */
  function spouseLine(spouses, along, fs, minFs, nameFn) {
    const names = spouses.map(sp => ({ text: nameFn(sp), id: sp.id }));
    const full = '∞ ' + names.map(n => n.text).join(' · ');
    const fit = fitText(full, along, fs, minFs);
    const maxChars = Math.max(1, Math.floor(along / (CHAR_W * fit.fs)));
    const parts = [{ text: '∞ ' }];
    let used = 2;
    for (let i = 0; i < names.length; i++) {
      const sep = i > 0 ? ' · ' : '';
      let text = names[i].text;
      if (used + sep.length + text.length > maxChars) {
        const room = maxChars - used - sep.length - 1;
        if (room < 2) break;
        text = text.slice(0, room) + '…';
        if (sep) parts.push({ text: sep });
        parts.push({ text, id: names[i].id });
        break;
      }
      if (sep) parts.push({ text: sep });
      parts.push({ text, id: names[i].id });
      used += sep.length + text.length;
    }
    return { fs: fit.fs, weight: 400, dim: true, parts };
  }

  function renderLabels(force = false) {
    if (!svg) return;
    const tier = currentTier();
    if (!force && tier === lodTier) return;
    lodTier = tier;
    labelLayer.innerHTML = '';
    for (const spec of labelSpecs) {
      const lines = labelLines(spec, tier);
      // Zeilen greedy einpassen: Name zuerst, dann Partner, dann Jahre
      const kept = [];
      let h = 0;
      for (const ln of lines) {
        const lh = ln.fs * spec.lineH;
        if (h + lh > spec.across) break;
        kept.push(ln); h += lh;
      }
      if (!kept.length || spec.across < 7) continue;
      const dim = involved && !involved.has(spec.m.id);
      const text = el('text', {
        class: 'fan-label' + (dim ? ' fan-dim' : ''), 'data-id': spec.m.id, 'text-anchor': 'middle',
        transform: `translate(${spec.x.toFixed(2)},${spec.y.toFixed(2)}) rotate(${spec.rot.toFixed(2)})`,
        fill: spec.m.isDeceased ? '#6b7280' : '#1a1a1a',
      });
      let cy = -h / 2;
      for (const ln of kept) {
        const lh = ln.fs * spec.lineH;
        const base = { 'font-size': ln.fs, 'font-weight': ln.weight, 'dominant-baseline': 'central',
                       ...(ln.dim ? { 'fill-opacity': 0.75 } : {}) };
        const parts = ln.parts || [{ text: ln.text }];
        parts.forEach((part, i) => {
          // Nur der erste tspan einer Zeile ist absolut positioniert; die
          // folgenden fließen inline, text-anchor zentriert den Block.
          const attrs = i === 0 ? { x: 0, y: (cy + lh / 2).toFixed(2), ...base } : { ...base };
          if (part.id) { attrs.class = 'fan-spouse-link'; attrs['data-id'] = part.id; }
          const t = el('tspan', attrs);
          t.textContent = part.text;
          text.appendChild(t);
        });
        cy += lh;
      }
      labelLayer.appendChild(text);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  HELFER
  // ═══════════════════════════════════════════════════════════

  function el(tag, attrs = {}) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  /** Ringsegment; `gap` ist eine konstante lineare Lücke, die je Radius in
      einen Winkel umgerechnet wird (innen und außen gleich breit). */
  function arcPath(r0, r1, a0, a1, gap = 0) {
    const span = a1 - a0;
    const pi = Math.min(gap / 2 / r0, span * 0.25);
    const po = Math.min(gap / 2 / r1, span * 0.25);
    const i0 = a0 + pi, i1 = a1 - pi, o0 = a0 + po, o1 = a1 - po;
    const largeO = (o1 - o0) > Math.PI ? 1 : 0;
    const largeI = (i1 - i0) > Math.PI ? 1 : 0;
    const p = (r, a) => `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
    return `M${p(r1, o0)} A${r1},${r1} 0 ${largeO} 1 ${p(r1, o1)} ` +
           `L${p(r0, i1)} A${r0},${r0} 0 ${largeI} 0 ${p(r0, i0)} Z`;
  }

  /** Männer hellblau, Frauen rosa, unbekannt neutral; Verstorbene entsättigt. */
  function segColor(gender, depth, deceased) {
    const [h, s] = gender === 'm' ? [207, 72] : gender === 'f' ? [340, 72] : [0, 0];
    const sat = deceased ? Math.round(s * 0.45) : s;
    const l = Math.min(93, (deceased ? 84 : 80) + depth * 2);
    return `hsl(${h} ${sat}% ${l}%)`;
  }

  /** Vorname; Nachname nur, wenn er vom Familiennamen abweicht (Ausgeheiratete). */
  function displayName(m, familyName) {
    return m.lastName && m.lastName !== familyName
      ? `${m.firstName} ${m.lastName}`
      : m.firstName;
  }

  /** Angeheiratete: Vorname + Geburtsname (falls vorhanden), sonst Nachname. */
  function spouseName(s) {
    const maiden = (s.birthName || '').replace(/^geb\.\s*/i, '').trim();
    return `${s.firstName} ${maiden || s.lastName}`.trim();
  }

  function yearLabel(m) {
    const b = m.birthDate ? m.birthDate.substring(0, 4) : '';
    if (m.deathDate) return `* ${b || '?'}  † ${m.deathDate.substring(0, 4)}`;
    return b ? `* ${b}` : '';
  }

  function fitText(text, maxPx, fs, minFs) {
    let f = fs;
    while (f > minFs && text.length * CHAR_W * f > maxPx) f -= 0.5;
    if (text.length * CHAR_W * f > maxPx) {
      const n = Math.max(1, Math.floor(maxPx / (CHAR_W * f)) - 1);
      text = text.slice(0, n) + '…';
    }
    return { text, fs: f };
  }

  // ═══════════════════════════════════════════════════════════
  //  PAN / ZOOM (viewBox)
  // ═══════════════════════════════════════════════════════════

  function apply() {
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    renderLabels();
  }

  function unitsPerPx() { return vb.w / (svg.clientWidth || 1); }

  function keepAspect() {
    const cw = container.clientWidth || 1, ch = container.clientHeight || 1;
    const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
    vb.h = vb.w * ch / cw;
    vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2;
    apply();
  }

  function fit() {
    const cw = container.clientWidth || 1, ch = container.clientHeight || 1;
    const R = chartRadius + PAD;
    let w = 2 * R, h = 2 * R;
    if (cw >= ch) w = h * cw / ch; else h = w * ch / cw;
    vb = { x: -w / 2, y: -h / 2, w, h };
    apply();
  }

  function zoomAt(client, f) {
    const rect = svg.getBoundingClientRect();
    const sx = vb.x + (client.x - rect.left) / rect.width * vb.w;
    const sy = vb.y + (client.y - rect.top) / rect.height * vb.h;
    const minW = RING * 2.5, maxW = (chartRadius + PAD) * 6;
    const nw = Math.min(maxW, Math.max(minW, vb.w / f));
    const rf = vb.w / nw;
    vb.x = sx - (sx - vb.x) / rf;
    vb.y = sy - (sy - vb.y) / rf;
    vb.w = nw; vb.h = vb.h / rf;
    apply();
  }

  function centerOn(memberId) {
    const s = segById.get(memberId) || segById.get(hostOf.get(memberId));
    if (!s) { fit(); return; }
    const cw = container.clientWidth || 1, ch = container.clientHeight || 1;
    const w = RING * 5.5, h = w * ch / cw;
    vb = { x: s.x - w / 2, y: s.y - h / 2, w, h };
    apply();
  }

  /** Person in die Bildmitte holen, ohne den Zoom zu ändern. */
  function panTo(memberId) {
    const s = segById.get(memberId) || segById.get(hostOf.get(memberId));
    if (!s) return;
    vb.x = s.x - vb.w / 2;
    vb.y = s.y - vb.h / 2;
    apply();
  }

  function attachPanZoom() {
    const pts = new Map();
    let moved = 0, prevPinch = null;
    // Ziel beim Drücken merken: nach setPointerCapture ist e.target beim
    // pointerup das <svg>, nicht mehr das Segment unter dem Finger.
    let downTarget = null;

    svg.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      // Primärer Kontakt (Maus / erster Finger): verwaiste Einträge räumen,
      // falls ein pointerup verloren ging — sonst gälte der nächste Tap
      // fälschlich als zweiter Finger (Pinch) und würde ignoriert.
      if (e.isPrimary) pts.clear();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        moved = 0;
        downTarget = e.target.closest ? e.target.closest('[data-id]') : null;
      } else {
        downTarget = null;   // zweiter Finger → Pinch, kein Tap
      }
      try { svg.setPointerCapture(e.pointerId); } catch { /* synthetisch */ }
      prevPinch = null;
    });

    svg.addEventListener('pointermove', e => {
      if (!pts.has(e.pointerId)) return;
      const p = pts.get(e.pointerId);
      const dx = e.clientX - p.x, dy = e.clientY - p.y;
      moved += Math.abs(dx) + Math.abs(dy);
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });

      if (pts.size === 1) {
        const s = unitsPerPx();
        vb.x -= dx * s; vb.y -= dy * s;
        apply();
      } else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
        if (prevPinch) {
          const s = unitsPerPx();
          vb.x -= (mid.x - prevPinch.mid.x) * s;
          vb.y -= (mid.y - prevPinch.mid.y) * s;
          zoomAt(mid, dist / (prevPinch.dist || dist));
        }
        prevPinch = { dist, mid };
      }
    });

    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      try { svg.releasePointerCapture(e.pointerId); } catch { /* egal */ }
      if (pts.size === 0 && e.type === 'pointerup' && moved < 10 && downTarget) {
        const id = downTarget.getAttribute('data-id');
        downTarget = null;
        if (id && onTapCallback) onTapCallback(id);
      }
      if (pts.size === 0) downTarget = null;
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);

    svg.addEventListener('wheel', e => {
      e.preventDefault();
      zoomAt({ x: e.clientX, y: e.clientY }, Math.exp(-e.deltaY * 0.002));
    }, { passive: false });
  }

  return { init, onTap, isActive, show, hide, toggle, render, fit, centerOn, panTo, highlightConnection, clearHighlight,
           getTier: () => lodTier };
})();
