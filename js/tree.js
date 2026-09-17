/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Stammtafel (reines SVG, ohne Bibliothek)

   Verdichtete Nachfahrentafel im Stil von MacFamilyTree & Co.:
   - Person als Karte, Partner als schmalere Karten direkt darunter
     (eine „Einheit" pro Blutsverwandten) — wenig Breite, klare Paare
   - Kinderlose Geschwister werden zu Spalten gestapelt (Sammel-Linie
     links), nur Kinder mit eigenen Nachkommen bekommen eigene Teilbäume
   - Konturbasiertes Tidy-Layout: Teilbäume rücken so eng zusammen wie
     ihre Kontur es erlaubt, Eltern stehen mittig über ihren Kindern
   - Generationen als Bänder mit fixen Beschriftungen am linken Rand
   - Teilbäume ein-/ausklappbar (Chip unter der Einheit), Minimap
     rechts oben zum Springen, semantischer Zoom wie im Fächer
   ═══════════════════════════════════════════════════════════ */

const Tree = (() => {
  // ─── Geometrie (SVG-Einheiten) ───
  const CARD_W = 104, CARD_H = 40;    // Personenkarte
  const SP_H = 27, SP_GAP = 3;        // Partnerkarte (unter der Person)
  const H_GAP = 16;                   // Abstand zwischen Spalten
  const LEAF_GAP = 8;                 // Abstand gestapelter Geschwister
  const MAX_COL_H = 150;              // Stapel-Höhe, bevor eine neue Spalte beginnt (2 Paare / 3 Einzelne)
  const V_GAP = 60;                   // Abstand zwischen Generationen (Sammelschiene)
  const SPINE_DX = 9;                 // Sammel-Linie links neben gestapelter Spalte
  const PAD = 90;
  const LOD_MID = 0.55, LOD_FULL = 1.1;   // px je Einheit
  const CHAR_W = 0.6;                 // IBM Plex Mono
  const NS = 'http://www.w3.org/2000/svg';
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];

  // ─── Zustand ───
  let container = null, svg = null;
  let bandLayer = null, edgeLayer = null, cardLayer = null;
  let members = [], relationships = [];
  let root = null;                 // Wurzelknoten der aktiven Familie
  let units = new Map();           // id (Blutsverwandter) → { node, x, y, h, gen, col }
  let hostOf = new Map();          // Angeheiratete → id der Einheit
  let rows = [];                   // je Generation: { y, h, minYear }
  let bbox = { x: 0, y: 0, w: 1, h: 1 };
  let vb = { x: 0, y: 0, w: 1000, h: 1000 };
  let collapsed = new Set();       // eingeklappte Einheiten
  let currentUserId = null;
  let onNodeTapCallback = null, onBackgroundTapCallback = null;
  let highlight = null;            // { fromId, toId }
  let involved = null;             // Set der beteiligten Einheiten
  let lodTier = null;
  let minimap = null, genLabels = null;
  let animFrame = null;

  // ═══════════════════════════════════════════════════════════
  //  INIT
  // ═══════════════════════════════════════════════════════════

  function init(containerId) {
    container = document.getElementById(containerId);
    svg = el('svg', { class: 'tree-svg' });
    bandLayer = el('g', { class: 'tree-bands' });
    edgeLayer = el('g', { class: 'tree-edges' });
    cardLayer = el('g', { class: 'tree-cards' });
    svg.append(bandLayer, edgeLayer, cardLayer);
    container.appendChild(svg);
    attachPanZoom();
    attachMinimap();
    genLabels = document.createElement('div');
    genLabels.className = 'tree-genlabels';
    container.appendChild(genLabels);

    let lastW = 0;
    if (window.ResizeObserver) {
      new ResizeObserver(() => {
        const w = container.clientWidth;
        if (w > 0 && lastW === 0 && units.size) fitAll(false);
        else if (w > 0) keepAspect();
        lastW = w;
      }).observe(container);
    }
  }

  function onNodeTap(cb) { onNodeTapCallback = cb; }
  function onBackgroundTap(cb) { onBackgroundTapCallback = cb; }

  function setCurrentUser(id) {
    currentUserId = id;
    if (units.size) drawCards();
  }

  // ═══════════════════════════════════════════════════════════
  //  DATEN → LAYOUT
  // ═══════════════════════════════════════════════════════════

  /** Personen + Beziehungen des aktiven Zweigs (Auswahl macht die App). */
  function render(memberData, relationshipData) {
    members = memberData;
    relationships = relationshipData;
    const res = Fan.buildFamiliesFrom(members, relationships);
    root = res.families.length ? res.families[0].root : null;
    layout();
    draw();
    if (units.size && container.clientWidth > 0) {
      highlight && involved ? fitToHighlight() : fitAll(false);
    }
  }

  const unitH = node => CARD_H + node.spouses.length * (SP_GAP + SP_H);
  const birthKey = m => m.birthDate || '9999';
  const descendants = node => node.children.reduce((n, c) => n + 1 + descendants(c), 0);

  /**
   * Konturbasiertes Layout. Jeder Knoten liefert seine Kontur (linke/rechte
   * Ausdehnung je Generationsebene unter ihm, relativ zu seiner Mitte) und
   * die relativen x-Positionen seiner Kinder-Slots. Kinderlose Kinder
   * werden zu gestapelten Spalten zusammengefasst.
   */
  function layout() {
    units = new Map(); hostOf = new Map(); rows = [];
    if (!root) { bbox = { x: 0, y: 0, w: 1, h: 1 }; return; }

    function build(node) {
      node.h = unitH(node);
      node.slots = [];
      const kids = collapsed.has(node.m.id) ? [] : node.children;
      if (!kids.length) {
        node.L = [-CARD_W / 2]; node.R = [CARD_W / 2];
        return;
      }
      const slots = [];
      let col = null;
      for (const c of kids) {
        const hasKids = c.children.length && !collapsed.has(c.m.id);
        if (hasKids) {
          build(c);
          slots.push({ kind: 'node', node: c, L: c.L, R: c.R, birth: birthKey(c.m) });
          col = null;
        } else {
          c.L = [-CARD_W / 2]; c.R = [CARD_W / 2]; c.h = unitH(c); c.slots = [];
          const need = (col ? col.h + LEAF_GAP : 0) + c.h;
          if (!col || need > MAX_COL_H) {
            col = { kind: 'col', nodes: [], h: 0, L: [-CARD_W / 2], R: [CARD_W / 2], birth: birthKey(c.m) };
            slots.push(col);
          }
          col.nodes.push(c);
          col.h = col.h + (col.nodes.length > 1 ? LEAF_GAP : 0) + c.h;
        }
      }
      // Reihenfolge nach Geburt des jeweils ersten Mitglieds
      slots.sort((a, b) => a.birth.localeCompare(b.birth));

      // Slots von links nach rechts anlegen: jeder rückt so weit nach links,
      // wie es die Kontur des bisherigen „Waldes" auf allen Ebenen erlaubt.
      const pos = [];
      let FL = null, FR = null;
      slots.forEach((s, i) => {
        if (i === 0) { pos.push(0); FL = s.L.slice(); FR = s.R.slice(); return; }
        let shift = -Infinity;
        for (let l = 0; l < Math.min(FR.length, s.L.length); l++) shift = Math.max(shift, FR[l] - s.L[l] + H_GAP);
        pos.push(shift);
        for (let l = 0; l < s.L.length; l++) {
          FR[l] = s.R[l] + shift;
          if (l >= FL.length) FL[l] = s.L[l] + shift;
        }
      });
      const mid = (pos[0] + pos[pos.length - 1]) / 2;
      slots.forEach((s, i) => { s.rel = pos[i] - mid; });
      node.slots = slots;
      node.L = [-CARD_W / 2, ...FL.map(v => v - mid)];
      node.R = [CARD_W / 2, ...FR.map(v => v - mid)];
    }
    build(root);

    // Absolute Positionen (x) und Generationszeilen
    const rowH = [];
    const place = (node, x, gen, parent) => {
      node.parent = parent;
      units.set(node.m.id, { node, x, gen, h: node.h });
      node.spouses.forEach(sp => hostOf.set(sp.id, node.m.id));
      rowH[gen] = Math.max(rowH[gen] || 0, node.h);
      for (const s of node.slots) {
        if (s.kind === 'node') {
          place(s.node, x + s.rel, gen + 1, node);
        } else {
          rowH[gen + 1] = Math.max(rowH[gen + 1] || 0, s.h);
          let off = 0;
          s.nodes.forEach((c, i) => {
            c.parent = node;
            c.colIndex = i; c.col = s;
            units.set(c.m.id, { node: c, x: x + s.rel, gen: gen + 1, h: c.h, col: s, off });
            c.spouses.forEach(sp => hostOf.set(sp.id, c.m.id));
            off += c.h + LEAF_GAP;
          });
        }
      }
    };
    place(root, 0, 0, null);

    let y = 0;
    rows = rowH.map(h => { const r = { y, h, minYear: null }; y += h + V_GAP; return r; });
    let minX = Infinity, maxX = -Infinity, maxY = 0;
    for (const u of units.values()) {
      u.y = rows[u.gen].y + (u.off || 0);
      minX = Math.min(minX, u.x - CARD_W / 2); maxX = Math.max(maxX, u.x + CARD_W / 2);
      maxY = Math.max(maxY, u.y + u.h);
      const by = u.node.m.birthDate ? parseInt(u.node.m.birthDate.substring(0, 4), 10) : NaN;
      if (isFinite(by)) rows[u.gen].minYear = rows[u.gen].minYear == null ? by : Math.min(rows[u.gen].minYear, by);
    }
    bbox = { x: minX, y: 0, w: Math.max(1, maxX - minX), h: Math.max(1, maxY) };
  }

  // ═══════════════════════════════════════════════════════════
  //  ZEICHNEN
  // ═══════════════════════════════════════════════════════════

  function draw() {
    bandLayer.innerHTML = ''; edgeLayer.innerHTML = '';
    if (!units.size) { cardLayer.innerHTML = ''; updateMinimapShapes(); return; }
    // Generationsbänder (abwechselnd), über die volle Breite
    rows.forEach((r, g) => {
      bandLayer.appendChild(el('rect', {
        class: 'tree-band' + (g % 2 ? ' odd' : ''),
        x: bbox.x - PAD * 4, y: r.y - V_GAP / 2, width: bbox.w + PAD * 8, height: r.h + V_GAP,
      }));
    });
    // Verbindungen: Eltern-Einheit → Sammelschiene → Kind-Slots
    for (const u of units.values()) {
      const n = u.node;
      if (!n.slots.length) continue;
      const g = u.gen;
      const busY = rows[g + 1].y - V_GAP / 2;
      const px = u.x, pb = u.y + u.h;
      const involvedEdge = cid => involved && involved.has(n.m.id) && involved.has(cid);
      for (const s of n.slots) {
        const sx = u.x + s.rel, top = rows[g + 1].y;
        if (s.kind === 'node') {
          edgeLayer.appendChild(el('path', {
            class: 'tree-edge' + (involvedEdge(s.node.m.id) ? ' hl' : ''),
            d: `M${f(px)},${f(pb)} V${f(busY)} H${f(sx)} V${f(top)}`,
          }));
        } else if (s.nodes.length === 1) {
          edgeLayer.appendChild(el('path', {
            class: 'tree-edge' + (involvedEdge(s.nodes[0].m.id) ? ' hl' : ''),
            d: `M${f(px)},${f(pb)} V${f(busY)} H${f(sx)} V${f(top)}`,
          }));
        } else {
          // gestapelte Geschwister: Sammel-Linie links, Stichleitung je Karte
          const spineX = sx - CARD_W / 2 - SPINE_DX;
          const last = units.get(s.nodes[s.nodes.length - 1].m.id);
          const anyHl = s.nodes.some(c => involvedEdge(c.m.id));
          edgeLayer.appendChild(el('path', {
            class: 'tree-edge' + (anyHl ? ' hl' : ''),
            d: `M${f(px)},${f(pb)} V${f(busY)} H${f(spineX)} V${f(last.y + CARD_H / 2)}`,
          }));
          for (const c of s.nodes) {
            const cu = units.get(c.m.id);
            edgeLayer.appendChild(el('path', {
              class: 'tree-edge' + (involvedEdge(c.m.id) ? ' hl' : ''),
              d: `M${f(spineX)},${f(cu.y + CARD_H / 2)} H${f(sx - CARD_W / 2)}`,
            }));
          }
        }
      }
    }
    drawCards();
    updateMinimapShapes();
  }

  function currentTier() {
    const k = (svg.clientWidth || 1) / vb.w;
    return k >= LOD_FULL ? 'full' : k >= LOD_MID ? 'mid' : 'far';
  }

  /** Karten (Person + Partner) je Einheit, Text je Zoomstufe. */
  function drawCards() {
    cardLayer.innerHTML = '';
    const tier = lodTier = currentTier();
    for (const u of units.values()) {
      const n = u.node, m = n.m;
      const isMe = m.id === currentUserId;
      const dim = involved && !involved.has(m.id);
      const g = el('g', {
        class: 'tree-unit' + (dim ? ' tree-dim' : '') + (involved && involved.has(m.id) ? ' tree-hl' : ''),
        'data-id': m.id, transform: `translate(${f(u.x - CARD_W / 2)},${f(u.y)})`,
      });
      // Personenkarte
      const stroke = isMe ? '#e63946' : m.isPlaceholder ? 'none' : '#1a1a1a';
      const card = el('g', { class: 'tree-person', 'data-id': m.id });
      card.appendChild(el('rect', {
        width: CARD_W, height: CARD_H, rx: 5, fill: personColor(m),
        stroke, 'stroke-width': isMe ? 2.6 : 1.4,
      }));
      personText(card, m, tier, isMe);
      g.appendChild(card);
      // Partnerkarten darunter
      n.spouses.forEach((sp, i) => {
        const y = CARD_H + SP_GAP + i * (SP_H + SP_GAP);
        const sg = el('g', { class: 'tree-spouse', 'data-id': sp.id, transform: `translate(0,${f(y)})` });
        sg.appendChild(el('rect', {
          width: CARD_W, height: SP_H, rx: 4, fill: spouseColor(sp),
          stroke: sp.isPlaceholder ? 'none' : '#1a1a1a', 'stroke-width': 1, 'stroke-dasharray': sp.former ? '3 2' : null,
        }));
        spouseText(sg, sp, tier);
        g.appendChild(sg);
      });
      // Ein-/Ausklapp-Chip unter der Einheit
      if (n.children.length) {
        const isCol = collapsed.has(m.id);
        const t = el('g', { class: 'tree-toggle' + (isCol ? ' collapsed' : ''), 'data-toggle': m.id,
          transform: `translate(${f(CARD_W / 2)},${f(u.h + 11)})` });   // in der Lücke unter der Einheit, auf der Ableitung
        const label = isCol ? `+${descendants(n)}` : '−';
        const w = isCol ? Math.max(16, 6 + label.length * 6.5) : 16;
        t.appendChild(el('rect', { x: -w / 2, y: -8, width: w, height: 16, rx: 8, fill: '#fff', stroke: '#1a1a1a', 'stroke-width': 1.2 }));
        const tx = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': 10.5, 'font-weight': 600, fill: '#1a1a1a' });
        tx.textContent = label;
        t.appendChild(tx);
        const tt = el('title'); tt.textContent = isCol ? 'Nachkommen einblenden' : 'Nachkommen ausblenden'; t.appendChild(tt);
        g.appendChild(t);
      }
      cardLayer.appendChild(g);
    }
  }

  /** Textzeilen der Personenkarte je Zoomstufe: fern = Vorname, mittel =
      + Jahre, nah = + Nachname/Geburtsname und volle Daten. */
  function personText(g, m, tier, isMe) {
    const me = isMe ? '➤ ' : '';
    const maxW = CARD_W - 10;
    const lines = [];
    if (tier === 'far') {
      lines.push({ ...fitText(me + m.firstName, maxW, 13, 7), w: 600 });
    } else if (tier === 'mid') {
      lines.push({ ...fitText(me + m.firstName, maxW, 12, 7), w: 600 });
      const yr = yearLabel(m); if (yr) lines.push({ ...fitText(yr, maxW, 9, 6), w: 400, dim: true });
    } else {
      lines.push({ ...fitText(me + m.firstName, maxW, 11, 7), w: 600 });
      const ln = [m.lastName, m.birthName ? (/^geb\./i.test(m.birthName) ? m.birthName : `geb. ${m.birthName}`) : ''].filter(Boolean).join(' ');
      if (ln) lines.push({ ...fitText(ln, maxW, 8.5, 6), w: 500 });
      const d = dateLabel(m); if (d) lines.push({ ...fitText(d, maxW, 8, 6), w: 400, dim: true });
    }
    writeLines(g, lines, CARD_H, m.isDeceased ? '#4b5563' : '#1a1a1a');
  }

  function spouseText(g, sp, tier) {
    const glyph = sp.former ? '⚮ ' : '∞ ';
    const maxW = CARD_W - 10;
    const lines = [];
    if (tier === 'far') {
      lines.push({ ...fitText(glyph + sp.firstName, maxW, 10, 6.5), w: 500 });
    } else if (tier === 'mid') {
      const b = sp.birthDate ? ` (* ${sp.birthDate.substring(0, 4)})` : '';
      lines.push({ ...fitText(glyph + sp.firstName + b, maxW, 9.5, 6.5), w: 500 });
    } else {
      lines.push({ ...fitText(glyph + spouseName(sp), maxW, 8.5, 6), w: 500 });
      const d = dateLabel(sp); if (d) lines.push({ ...fitText(d, maxW, 7.5, 6), w: 400, dim: true });
    }
    writeLines(g, lines, SP_H, sp.isDeceased ? '#4b5563' : '#1a1a1a');
  }

  function writeLines(g, lines, boxH, fill) {
    const lh = 1.2;
    const total = lines.reduce((s, l) => s + l.fs * lh, 0);
    let cy = (boxH - total) / 2;
    for (const l of lines) {
      const t = el('text', {
        x: CARD_W / 2, y: f(cy + l.fs * lh / 2), 'text-anchor': 'middle', 'dominant-baseline': 'central',
        'font-size': l.fs, 'font-weight': l.w, fill, ...(l.dim ? { 'fill-opacity': 0.75 } : {}),
      });
      t.textContent = l.text;
      g.appendChild(t);
      cy += l.fs * lh;
    }
  }

  function fitText(text, maxPx, fs, minFs) {
    let fz = fs;
    while (fz > minFs && text.length * CHAR_W * fz > maxPx) fz -= 0.5;
    if (text.length * CHAR_W * fz > maxPx) {
      const n = Math.max(1, Math.floor(maxPx / (CHAR_W * fz)) - 1);
      text = text.slice(0, n) + '…';
    }
    return { text, fs: fz };
  }

  function spouseName(s) {
    const maiden = (s.birthName || '').replace(/^geb\.\s*/i, '').trim();
    return `${s.firstName} ${maiden || s.lastName}`.trim();
  }
  function yearLabel(m) {
    const b = m.birthDate ? m.birthDate.substring(0, 4) : '';
    if (m.deathDate) return `${b || '?'} – ${m.deathDate.substring(0, 4)}`;
    return b ? `* ${b}` : '';
  }
  function dateLabel(m) {
    const fmt = d => { const [y, mo, da] = d.split('-'); return da && mo ? `${da}.${mo}.${y}` : y; };
    const b = m.birthDate ? `* ${fmt(m.birthDate)}` : '';
    const d = m.deathDate ? `† ${fmt(m.deathDate)}` : (m.isDeceased ? '†' : '');
    return [b, d].filter(Boolean).join('  ');
  }

  /** Farben wie im Fächer: Männer hellblau, Frauen rosa, Verstorbene blass. */
  function personColor(m) {
    const [h, s] = m.gender === 'm' ? [207, 72] : m.gender === 'f' ? [340, 72] : [0, 0];
    const sat = m.isDeceased ? Math.round(s * 0.45) : s;
    return `hsl(${h} ${sat}% ${m.isDeceased ? 86 : 82}%)`;
  }
  function spouseColor(m) {
    const [h, s] = m.gender === 'm' ? [207, 60] : m.gender === 'f' ? [340, 60] : [0, 0];
    const sat = m.isDeceased ? Math.round(s * 0.45) : s;
    return `hsl(${h} ${sat}% 93%)`;
  }

  // ═══════════════════════════════════════════════════════════
  //  VERWANDTSCHAFTSPFAD
  // ═══════════════════════════════════════════════════════════

  function highlightConnection(fromId, toId) {
    highlight = { fromId, toId };
    const { expandedPath } = Relationship.getPathData(fromId, toId, members, relationships);
    if (!expandedPath || !expandedPath.length) { involved = null; draw(); return; }
    involved = new Set();
    for (const step of expandedPath) {
      const id = units.has(step.id) ? step.id : hostOf.get(step.id);
      if (id) involved.add(id);
    }
    // Eingeklappte Vorfahren beteiligter Personen aufklappen
    let reopened = false;
    for (const id of involved) {
      let p = units.get(id) && units.get(id).node.parent;
      while (p) { if (collapsed.delete(p.m.id)) reopened = true; p = p.parent; }
    }
    if (reopened) layout();
    draw();
    fitToHighlight();
  }

  function clearHighlight() {
    highlight = null; involved = null;
    if (units.size) draw();
  }

  function fitToHighlight() {
    if (!involved || !involved.size) return;
    const us = [...involved].map(id => units.get(id)).filter(Boolean);
    if (!us.length) return;
    const minX = Math.min(...us.map(u => u.x - CARD_W / 2)) - 40, maxX = Math.max(...us.map(u => u.x + CARD_W / 2)) + 40;
    const minY = Math.min(...us.map(u => u.y)) - 40, maxY = Math.max(...us.map(u => u.y + u.h)) + 40;
    fitRect(minX, minY, maxX - minX, maxY - minY, true, false);
  }

  // ═══════════════════════════════════════════════════════════
  //  PAN / ZOOM (viewBox)
  // ═══════════════════════════════════════════════════════════

  function apply() {
    svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);
    if (currentTier() !== lodTier && units.size) drawCards();
    updateGenLabels();
    updateMinimapView();
  }

  const unitsPerPx = () => vb.w / (svg.clientWidth || 1);

  function keepAspect() {
    const cw = container.clientWidth || 1, ch = container.clientHeight || 1;
    const cx = vb.x + vb.w / 2, cy = vb.y + vb.h / 2;
    vb.h = vb.w * ch / cw;
    vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2;
    apply();
  }

  /** Rechteck (Einheiten) einpassen; optional Platz für das Seitenpanel lassen. */
  function fitRect(x, y, w, h, panel, animate) {
    const cw = container.clientWidth || 1, ch = container.clientHeight || 1;
    const isDesktop = window.innerWidth >= 600;
    const panelW = panel && isDesktop ? Math.min(320, cw * 0.5) : 0;
    const panelH = panel && !isDesktop ? Math.min(window.innerHeight * 0.45, ch * 0.5) : 0;
    const availW = Math.max(50, cw - panelW), availH = Math.max(50, ch - panelH);
    let s = Math.min(availW / w, availH / h);        // px je Einheit
    s = Math.min(s, 1.6);                             // nicht absurd nah ranzoomen
    const nw = cw / s, nh = ch / s;
    const cx = x + w / 2 + (panelW / 2) / s, cy = y + h / 2 + (panelH / 2) / s;
    setView({ x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh }, animate);
  }

  function fitAll(animate = true) {
    if (!units.size) return;
    fitRect(bbox.x - PAD, bbox.y - PAD, bbox.w + 2 * PAD, bbox.h + 2 * PAD, false, animate);
  }

  function setView(target, animate) {
    if (animFrame) { cancelAnimationFrame(animFrame); animFrame = null; }
    if (!animate) { vb = { ...target }; apply(); return; }
    const from = { ...vb }, t0 = performance.now(), dur = 320;
    const step = now => {
      const t = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - t, 3);
      vb = { x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e,
             w: from.w + (target.w - from.w) * e, h: from.h + (target.h - from.h) * e };
      apply();
      if (t < 1) animFrame = requestAnimationFrame(step); else animFrame = null;
    };
    animFrame = requestAnimationFrame(step);
  }

  function zoomAt(client, fac) {
    const rect = svg.getBoundingClientRect();
    const sx = vb.x + (client.x - rect.left) / rect.width * vb.w;
    const sy = vb.y + (client.y - rect.top) / rect.height * vb.h;
    const minW = (svg.clientWidth || 1) / 3;          // max. 3 px je Einheit
    // Rauszoomen bis 3× die Tafel — aber mindestens bis die Karten klein
    // werden (0.35 px/Einheit, Stufe „fern"): bei einer Tafel aus nur dem
    // Stammvater lag die Grenze sonst ENGER als fitAll() und „rauszoomen"
    // sprang hinein.
    const maxW = Math.max(Math.max(bbox.w, bbox.h) * 3 + PAD * 2, (svg.clientWidth || 1) / 0.35);
    const nw = Math.min(maxW, Math.max(minW, vb.w / fac));
    const rf = vb.w / nw;
    vb.x = sx - (sx - vb.x) / rf; vb.y = sy - (sy - vb.y) / rf;
    vb.w = nw; vb.h = vb.h / rf;
    apply();
  }

  /**
   * Person in die Mitte holen. zoom: null = Zoom beibehalten, undefined =
   * lesbare Stufe (0.9 px/Einheit), Zahl = px je Einheit. Eingeklappte
   * Vorfahren werden aufgeklappt.
   */
  function centerOn(memberId, zoom, animate = true) {
    let u = units.get(memberId) || units.get(hostOf.get(memberId));
    if (!u) {
      // vielleicht eingeklappt: Vorfahren öffnen und neu layouten
      const target = findNode(root, memberId);
      if (!target) return false;
      let p = target.parent; let opened = false;
      while (p) { if (collapsed.delete(p.m.id)) opened = true; p = p.parent; }
      if (!opened) return false;
      layout(); draw();
      u = units.get(memberId) || units.get(hostOf.get(memberId));
      if (!u) return false;
    }
    const cw = container.clientWidth || 1, ch = container.clientHeight || 1;
    const k = zoom === null ? cw / vb.w : (typeof zoom === 'number' ? zoom : 0.9);
    const w = cw / k, h = ch / k;
    const cx = u.x, cy = u.y + u.h / 2;
    setView({ x: cx - w / 2, y: cy - h / 2, w, h }, animate);
    return true;
  }

  function findNode(node, id) {
    if (!node) return null;
    if (node.m.id === id || node.spouses.some(s => s.id === id)) return node;
    for (const c of node.children) { const r = findNode(c, id); if (r) return r; }
    return null;
  }

  function attachPanZoom() {
    const pts = new Map();
    let moved = 0, prevPinch = null, downTarget = null, downToggle = null;

    svg.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      if (e.isPrimary) pts.clear();
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 1) {
        moved = 0;
        downTarget = e.target.closest ? e.target.closest('[data-id]') : null;
        downToggle = e.target.closest ? e.target.closest('[data-toggle]') : null;
      } else { downTarget = null; downToggle = null; }
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
          vb.x -= (mid.x - prevPinch.mid.x) * s; vb.y -= (mid.y - prevPinch.mid.y) * s;
          zoomAt(mid, dist / (prevPinch.dist || dist));
        }
        prevPinch = { dist, mid };
      }
    });
    const up = e => {
      if (!pts.has(e.pointerId)) return;
      pts.delete(e.pointerId);
      try { svg.releasePointerCapture(e.pointerId); } catch { /* egal */ }
      if (pts.size === 0 && e.type === 'pointerup' && moved < 10) {
        if (downToggle) {
          toggleCollapse(downToggle.getAttribute('data-toggle'));
        } else if (downTarget) {
          if (onNodeTapCallback) onNodeTapCallback(downTarget.getAttribute('data-id'));
        } else if (onBackgroundTapCallback) {
          onBackgroundTapCallback();
        }
      }
      if (pts.size === 0) { downTarget = null; downToggle = null; }
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
    svg.addEventListener('wheel', e => {
      e.preventDefault();
      if (e.ctrlKey || !e.deltaX) {
        // Mausrad / Pinch am Trackpad: zoomen
        zoomAt({ x: e.clientX, y: e.clientY }, Math.exp(-e.deltaY * 0.002));
      } else {
        // Zwei-Finger-Wischen am Trackpad: schieben (die Tafel ist breit)
        const s = unitsPerPx();
        vb.x += e.deltaX * s; vb.y += e.deltaY * s;
        apply();
      }
    }, { passive: false });
  }

  /** Teilbaum ein-/ausklappen; Ansicht bleibt an derselben Stelle. */
  function toggleCollapse(id) {
    if (collapsed.has(id)) collapsed.delete(id); else collapsed.add(id);
    const u = units.get(id);
    const before = u ? { x: u.x, y: u.y } : null;
    layout(); draw();
    const after = units.get(id);
    if (before && after) {   // Einheit bleibt optisch, wo sie war
      vb.x += after.x - before.x; vb.y += after.y - before.y;
    }
    apply();
  }

  // ═══════════════════════════════════════════════════════════
  //  ORIENTIERUNG: Generationsbeschriftung + Minimap
  // ═══════════════════════════════════════════════════════════

  function updateGenLabels() {
    if (!genLabels) return;
    genLabels.innerHTML = '';
    if (!units.size) return;
    const k = (svg.clientWidth || 1) / vb.w;
    const ch = container.clientHeight || 1;
    rows.forEach((r, g) => {
      const top = (r.y - V_GAP / 2 - vb.y) * k, bottom = (r.y + r.h + V_GAP / 2 - vb.y) * k;
      if (bottom < 0 || top > ch) return;
      const bandPx = bottom - top;
      if (bandPx < 18) return;                    // weit draußen: Bänder zu schmal für Text
      const compact = bandPx < 34;                // nur die Ziffer
      const s = document.createElement('div');
      s.className = 'tree-genlabel' + (compact ? ' compact' : '');
      // Beschriftung am oberen Bandrand, bleibt aber im Bild, wenn das Band oben rausläuft
      const hgt = compact ? 16 : 24;
      s.style.top = `${Math.max(6, Math.min(top + (compact ? 1 : 6), bottom - hgt - 2))}px`;
      s.innerHTML = `<b>${ROMAN[g] || g + 1}</b>${!compact && r.minYear != null ? `<span>ab ${r.minYear}</span>` : ''}`;
      genLabels.appendChild(s);
    });
  }

  function attachMinimap() {
    const box = document.createElement('div');
    box.className = 'tree-minimap';
    const ms = el('svg', { class: 'tree-minimap-svg' });
    const shapes = el('g'); const view = el('rect', { class: 'tree-minimap-view' });
    ms.append(shapes, view);
    box.appendChild(ms);
    container.appendChild(box);
    minimap = { box, svg: ms, shapes, view };
    let dragging = false;
    const jump = e => {
      const r = ms.getBoundingClientRect();
      const fx = (e.clientX - r.left) / r.width, fy = (e.clientY - r.top) / r.height;
      const mb = minimapBox();
      const cx = mb.x + fx * mb.w, cy = mb.y + fy * mb.h;
      vb.x = cx - vb.w / 2; vb.y = cy - vb.h / 2;
      apply();
    };
    box.addEventListener('pointerdown', e => { dragging = true; try { box.setPointerCapture(e.pointerId); } catch { /* egal */ } jump(e); e.preventDefault(); e.stopPropagation(); });
    box.addEventListener('pointermove', e => { if (dragging) jump(e); });
    const end = () => { dragging = false; };
    box.addEventListener('pointerup', end); box.addEventListener('pointercancel', end);
  }

  function minimapBox() {
    const m = 30;
    return { x: bbox.x - m, y: bbox.y - m, w: bbox.w + 2 * m, h: bbox.h + 2 * m };
  }

  function updateMinimapShapes() {
    if (!minimap) return;
    minimap.shapes.innerHTML = '';
    if (!units.size) { minimap.box.hidden = true; return; }
    minimap.box.hidden = false;
    const mb = minimapBox();
    minimap.svg.setAttribute('viewBox', `${mb.x} ${mb.y} ${mb.w} ${mb.h}`);
    // Seitenverhältnis der Tafel übernehmen (Breite fix, Höhe folgt, gedeckelt)
    const W = 160, H = Math.max(36, Math.min(110, W * mb.h / mb.w));
    minimap.box.style.width = `${W}px`; minimap.box.style.height = `${H}px`;
    minimap.svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    for (const u of units.values()) {
      minimap.shapes.appendChild(el('rect', {
        x: u.x - CARD_W / 2, y: u.y, width: CARD_W, height: u.h,
        fill: involved && !involved.has(u.node.m.id) ? '#ddd' : (u.node.m.id === currentUserId ? '#e63946' : personColor(u.node.m)),
      }));
    }
    updateMinimapView();
  }

  function updateMinimapView() {
    if (!minimap || !units.size) return;
    minimap.view.setAttribute('x', vb.x); minimap.view.setAttribute('y', vb.y);
    minimap.view.setAttribute('width', vb.w); minimap.view.setAttribute('height', vb.h);
  }

  // ═══════════════════════════════════════════════════════════
  //  HELFER
  // ═══════════════════════════════════════════════════════════

  function el(tag, attrs = {}) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v !== null && v !== undefined) e.setAttribute(k, v);
    return e;
  }
  const f = v => (Math.round(v * 100) / 100).toString();

  function getNodePosition(id) {
    const u = units.get(id) || units.get(hostOf.get(id));
    return u ? { x: u.x, y: u.y + u.h / 2 } : null;
  }

  return {
    init, onNodeTap, onBackgroundTap, setCurrentUser, render,
    highlightConnection, clearHighlight, centerOn, fitAll,
    getZoom: () => (svg && svg.clientWidth ? svg.clientWidth / vb.w : null),
    getCurrentUser: () => currentUserId,
    getNodePosition,
    getTier: () => lodTier,
    getRows: () => rows.map(r => ({ ...r })),
    getBBox: () => ({ ...bbox }),
    collapse: (id, on = true) => { if (on) collapsed.add(id); else collapsed.delete(id); layout(); draw(); apply(); },
    isCollapsed: id => collapsed.has(id),
  };
})();
