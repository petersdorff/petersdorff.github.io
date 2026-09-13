/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Fan Chart (radiale Nachkommen-Ansicht)  v1
   Sunburst-Layout: Stammvater im Zentrum, jede Generation ein
   Ring, Winkelbreite ∝ Zahl der Nachkommen-Blätter. Angeheiratete
   Partner erscheinen als „∞ Name"-Untertitel im Segment des
   Blutsverwandten. Reines SVG, unabhängig von Cytoscape.
   ═══════════════════════════════════════════════════════════ */

const Fan = (() => {
  const RING = 88;         // Ringdicke (SVG-Einheiten)
  const CENTER_R = 82;     // Radius des Zentrums (Stammeltern)
  const PAD = 30;
  const CHAR_W = 0.6;      // IBM Plex Mono: Zeichenbreite in em
  const NS = 'http://www.w3.org/2000/svg';

  let container = null, svg = null, layer = null;
  let members = [], relationships = [];
  let active = false;
  let vb = { x: -500, y: -500, w: 1000, h: 1000 };
  let chartRadius = 400;
  let onTapCallback = null;
  let segments = [];        // { id, x, y, ... } für centerOn
  let rootId = null;

  // ═══════════════════════════════════════════════════════════
  //  INIT / STATE
  // ═══════════════════════════════════════════════════════════

  function init(containerId) {
    container = document.getElementById(containerId);
    svg = el('svg', { class: 'fan-svg' });
    layer = el('g');
    svg.appendChild(layer);
    container.appendChild(svg);
    attachPanZoom();
    if (window.ResizeObserver) {
      new ResizeObserver(() => { if (active) keepAspect(); }).observe(container);
    }
  }

  function onTap(cb) { onTapCallback = cb; }
  function isActive() { return active; }

  function show() {
    active = true;
    container.classList.remove('hidden');
    if (members.length) fit();
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
    layer.innerHTML = '';
    segments = [];

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
      if (isMe) deferred.push(g); else layer.appendChild(g);
    }
    drawCenter(root, familyName, root.m.id === currentUserId);
    deferred.forEach(g => layer.appendChild(g));

    if (active) fit();
  }

  function drawSegment({ node, a0, a1 }, familyName, isMe) {
    const r0 = CENTER_R + (node.depth - 1) * RING;
    const r1 = r0 + RING;
    const m = node.m;
    const span = Math.min(a1 - a0, Math.PI * 2 - 1e-4);

    const g = el('g', { class: 'fan-seg', 'data-id': m.id });
    const fill = segColor(m.gender, node.depth, m.isDeceased);
    const stroke = isMe ? '#e63946' : (m.isPlaceholder ? '#ffffff' : '#1a1a1a');
    const sw = isMe ? 3 : (m.isPlaceholder ? 1.2 : 1.6);
    g.appendChild(el('path', {
      d: arcPath(r0, r1, a0, a0 + span), fill, stroke, 'stroke-width': sw,
      'stroke-linejoin': 'round',
    }));

    // ── Label ──
    const rm = (r0 + r1) / 2;
    const arcLen = span * rm;
    const tangential = arcLen > RING * 1.15;
    const along = (tangential ? arcLen : RING) - 12;
    const across = (tangential ? RING : arcLen) - 6;
    const theta = a0 + span / 2;

    const lines = [];
    const nameTxt = (isMe ? '➤ ' : '') + displayName(m, familyName);
    const name = fitText(nameTxt, along, 11, 6.5);
    lines.push({ ...name, weight: 600 });
    if (node.spouses.length) {
      const sp = fitText('∞ ' + node.spouses.map(spouseName).join(' · '), along, 8.5, 6);
      lines.push({ ...sp, weight: 400, dim: true });
    }
    const yr = yearLabel(m);
    if (yr) lines.push({ ...fitText(yr, along, 8, 6), weight: 400, dim: true });

    // Zeilen greedy einpassen: Name zuerst, dann Partner, dann Jahre
    const kept = [];
    let h = 0;
    for (const ln of lines) {
      const lh = ln.fs * 1.25;
      if (h + lh > across) break;
      kept.push(ln); h += lh;
    }
    if (kept.length && across >= 7) {
      let rot = (tangential ? theta + Math.PI / 2 : theta) * 180 / Math.PI;
      rot = ((rot + 90) % 360 + 360) % 360 - 90;   // lesbar: (-90, 90]
      if (rot > 90) rot -= 180;
      const x = rm * Math.cos(theta), y = rm * Math.sin(theta);
      const text = el('text', {
        class: 'fan-label', 'text-anchor': 'middle',
        transform: `translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${rot.toFixed(2)})`,
        fill: m.isDeceased ? '#6b7280' : '#1a1a1a',
      });
      let cy = -h / 2;
      for (const ln of kept) {
        const lh = ln.fs * 1.25;
        const t = el('tspan', {
          x: 0, y: (cy + lh / 2).toFixed(2), 'font-size': ln.fs, 'font-weight': ln.weight,
          'dominant-baseline': 'central',
          ...(ln.dim ? { 'fill-opacity': 0.75 } : {}),
        });
        t.textContent = ln.text;
        text.appendChild(t);
        cy += lh;
      }
      g.appendChild(text);
    }

    segments.push({ id: m.id, x: rm * Math.cos(theta), y: rm * Math.sin(theta) });
    return g;
  }

  function drawCenter(root, familyName, isMe) {
    const m = root.m;
    const g = el('g', { class: 'fan-seg fan-center', 'data-id': m.id });
    g.appendChild(el('circle', {
      r: CENTER_R, fill: segColor(m.gender, 0, m.isDeceased),
      stroke: isMe ? '#e63946' : '#1a1a1a', 'stroke-width': isMe ? 3 : 1.6,
    }));
    const maxW = CENTER_R * 2 - 24;
    const lines = [{ ...fitText(`${m.firstName} ${m.lastName}`, maxW, 11, 7), weight: 600 }];
    if (root.spouses.length) {
      lines.push({ ...fitText('∞ ' + root.spouses.map(spouseName).join(' · '), maxW, 8.5, 6), weight: 400, dim: true });
    }
    const yr = yearLabel(m);
    if (yr) lines.push({ ...fitText(yr, maxW, 8, 6), weight: 400, dim: true });
    const h = lines.reduce((s, l) => s + l.fs * 1.3, 0);
    const text = el('text', { class: 'fan-label', 'text-anchor': 'middle', fill: '#1a1a1a' });
    let cy = -h / 2;
    for (const ln of lines) {
      const lh = ln.fs * 1.3;
      const t = el('tspan', {
        x: 0, y: (cy + lh / 2).toFixed(2), 'font-size': ln.fs, 'font-weight': ln.weight,
        'dominant-baseline': 'central', ...(ln.dim ? { 'fill-opacity': 0.75 } : {}),
      });
      t.textContent = ln.text;
      text.appendChild(t);
      cy += lh;
    }
    g.appendChild(text);
    layer.appendChild(g);
    segments.push({ id: m.id, x: 0, y: 0 });
  }

  // ═══════════════════════════════════════════════════════════
  //  HELFER
  // ═══════════════════════════════════════════════════════════

  function el(tag, attrs = {}) {
    const e = document.createElementNS(NS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    return e;
  }

  function arcPath(r0, r1, a0, a1) {
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const p = (r, a) => `${(r * Math.cos(a)).toFixed(2)},${(r * Math.sin(a)).toFixed(2)}`;
    return `M${p(r1, a0)} A${r1},${r1} 0 ${large} 1 ${p(r1, a1)} ` +
           `L${p(r0, a1)} A${r0},${r0} 0 ${large} 0 ${p(r0, a0)} Z`;
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
    const s = segments.find(x => x.id === memberId);
    if (!s) { fit(); return; }
    const cw = container.clientWidth || 1, ch = container.clientHeight || 1;
    const w = RING * 5.5, h = w * ch / cw;
    vb = { x: s.x - w / 2, y: s.y - h / 2, w, h };
    apply();
  }

  function attachPanZoom() {
    const pts = new Map();
    let moved = 0, prevPinch = null;

    svg.addEventListener('pointerdown', e => {
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      svg.setPointerCapture(e.pointerId);
      if (pts.size === 1) moved = 0;
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
      if (pts.size === 0 && moved < 6 && e.type === 'pointerup') {
        const seg = e.target.closest && e.target.closest('[data-id]');
        if (seg && onTapCallback) onTapCallback(seg.getAttribute('data-id'));
      }
    };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);

    svg.addEventListener('wheel', e => {
      e.preventDefault();
      zoomAt({ x: e.clientX, y: e.clientY }, Math.exp(-e.deltaY * 0.002));
    }, { passive: false });
  }

  return { init, onTap, isActive, show, hide, toggle, render, fit, centerOn };
})();
