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
  //   mid  (< 1.1):  Vorname + Partner-Vornamen (kein Nachname)
  //   full:          Vor- und Nachname + Partner mit Geburtsname + Lebensdaten
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
  let ghostLayer = null;    // Plus-Chips „Kind / Geschwister anlegen"
  let phi = 0;              // Rotation des Fächers (rad), per Rändelrad
  let wheel = null;         // Rändelrad (HTML-Overlay rechts, bildschirmfix)
  let ghostFor = null;      // Segment-ID, für die Chips gezeigt werden (Hover/Auswahl)
  let canEdit = false;      // nur online mit Schreibrecht
  let colorMode = 'gender'; // 'gender' | 'year' (Geburtsjahr-Skala)
  let yearRange = { min: 1800, max: 2030 };
  let onAddCallback = null;
  let onConnectCallback = null;   // „Wie sind wir verwandt?"-Chip
  let selectedId = null;    // zuletzt angetippte Person (Chips bleiben bis zur nächsten Auswahl)
  let unreachable = [];     // IDs, die in keiner Familie vorkommen (Waisen-Ablage)
  let families = [];        // [{ rootId, name, short, root, assigned, size }]
  let activeFamilyId = null;
  let preferredFamilyId = null;
  let onFamilyChangeCallback = null;

  // Anzeigenamen der Familienzweige nach Nachname der Wurzel
  const FAMILY_NAMES = [
    { test: ln => /campen/i.test(ln), name: 'Märkische Familie (von Petersdorff-Campen)', short: 'Märkische Familie' },
    { test: ln => /petersdorff/i.test(ln), name: 'Pommersche Familie (von Petersdorff)', short: 'Pommersche Familie' },
  ];
  function familyLabel(root) {
    const hit = FAMILY_NAMES.find(f => f.test(root.lastName || ''));
    return hit ? { name: hit.name, short: hit.short } : { name: `Familie ${root.lastName}`, short: `Familie ${root.lastName}` };
  }
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
    ghostLayer = el('g', { class: 'fan-ghosts' });
    svg.appendChild(segLayer);
    svg.appendChild(hlLayer);
    svg.appendChild(labelLayer);
    svg.appendChild(ghostLayer);
    // Hover (Maus): Plus-Chips für das Segment unter dem Zeiger
    svg.addEventListener('pointerover', e => {
      if (e.pointerType !== 'mouse') return;
      const seg = e.target.closest && e.target.closest('.fan-seg');
      if (seg) showGhosts(seg.getAttribute('data-id'));
    });
    svg.addEventListener('pointerleave', () => { if (!selectedId) showGhosts(null); });
    container.appendChild(svg);
    attachPanZoom();
    attachWheel();
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
  function onAddRelative(cb) { onAddCallback = cb; }
  function onConnect(cb) { onConnectCallback = cb; }
  function setCanEdit(v) { canEdit = !!v; if (!canEdit) showGhosts(null); }
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

  /**
   * Familienzweige erkennen. Wurzel-Kandidat = keine Eltern, aber Kinder.
   * Angeheiratete (Partner hat dokumentierte Eltern) sind keine Wurzel;
   * ein Stammelternpaar (beide ohne Eltern) bildet EINE Familie mit dem
   * älteren Partner als Wurzel. Jede Familie bekommt ihren eigenen Baum.
   */
  function buildFamilies() {
    const byId = new Map(members.map(m => [m.id, m]));
    const parentsOf = new Map(), childrenOf = new Map(), spousesOf = new Map();
    const push = (mp, k, v) => { if (!mp.has(k)) mp.set(k, []); mp.get(k).push(v); };
    for (const r of relationships) {
      if (!byId.has(r.fromId) || !byId.has(r.toId)) continue;
      if (r.type === 'parent_child') { push(parentsOf, r.toId, r.fromId); push(childrenOf, r.fromId, r.toId); }
      else if (r.type === 'spouse') { push(spousesOf, r.fromId, r.toId); push(spousesOf, r.toId, r.fromId); }
    }
    const byBirth = (a, b) => (a.birthDate || '9999').localeCompare(b.birthDate || '9999');
    const formerKey = new Set(relationships.filter(r => r.type === 'spouse' && r.isFormer)
      .flatMap(r => [`${r.fromId}~${r.toId}`, `${r.toId}~${r.fromId}`]));

    const candidates = members.filter(m => !parentsOf.has(m.id) && childrenOf.has(m.id)).sort(byBirth);
    const heads = candidates.filter(m => !(spousesOf.get(m.id) || []).some(id => parentsOf.has(id)));
    const used = new Set();
    const roots = [];
    for (const h of heads) {
      if (used.has(h.id)) continue;
      used.add(h.id);
      for (const sp of (spousesOf.get(h.id) || [])) used.add(sp);
      roots.push(h);
    }

    // Bekannte Familie ohne Wurzel (z.B. frisch angelegter Platzhalter-
    // Stammvater ohne Kinder): ältester elternloser Namensträger, der nicht
    // in eine dokumentierte Linie eingeheiratet ist, wird ihre Wurzel.
    for (const fam of FAMILY_NAMES) {
      if (roots.some(r => familyLabel(r).name === fam.name)) continue;
      const seed = members
        .filter(m => familyLabel(m).name === fam.name && !parentsOf.has(m.id) && !used.has(m.id)
                  && !(spousesOf.get(m.id) || []).some(id => parentsOf.has(id)))
        .sort((a, b) => (childrenOf.has(b.id) - childrenOf.has(a.id)) || byBirth(a, b))[0];
      if (seed) { used.add(seed.id); roots.push(seed); }
    }

    // Jede Person genau einmal je Familie: Blutsverwandte als Segment,
    // deren Partner als Untertitel. Kinder hängen am ersten erreichten Elternteil.
    function makeNode(m, depth, branch, assigned) {
      const spouses = (spousesOf.get(m.id) || []).map(id => byId.get(id))
        .filter(sp => sp && !assigned.has(sp.id)).sort(byBirth)
        .map(sp => ({ ...sp, former: formerKey.has(`${m.id}~${sp.id}`) }));
      spouses.forEach(sp => assigned.add(sp.id));
      const kids = (childrenOf.get(m.id) || []).map(id => byId.get(id))
        .filter(k => k && !assigned.has(k.id)).sort(byBirth);
      kids.forEach(k => assigned.add(k.id));
      const node = { m, depth, branch, spouses, children: [] };
      node.children = kids.map((k, i) => makeNode(k, depth + 1, depth === 0 ? i : branch, assigned));
      node.weight = node.children.length
        ? node.children.reduce((sum, c) => sum + c.weight, 0)
        : 1;
      return node;
    }

    families = roots.map(rootMember => {
      const assigned = new Set([rootMember.id]);
      const root = makeNode(rootMember, 0, 0, assigned);
      return { rootId: rootMember.id, ...familyLabel(rootMember), root, assigned, size: assigned.size };
    }).sort((a, b) => b.size - a.size);
    // Zwei Wurzeln mit demselben Familiennamen (noch nicht verbunden):
    // im Umschalter per Vorname der Wurzel unterscheiden.
    for (const f of families) {
      if (families.filter(x => x.short === f.short).length > 1) {
        f.short = `${f.short} · ${f.root.m.firstName}`;
      }
    }

    const union = new Set();
    families.forEach(f => f.assigned.forEach(id => union.add(id)));
    const unassigned = members.filter(m => !union.has(m.id));
    unreachable = unassigned.map(m => m.id);
    if (unassigned.length) {
      console.info(`[Fan] ${unassigned.length} Personen in keiner Familie erreichbar:`,
        unassigned.map(m => `${m.firstName} ${m.lastName}`).join(', '));
    }
  }

  /** Aktive Familie wählen: bisherige → gewünschte → die des Nutzers → größte. */
  function pickFamily() {
    const valid = id => id && families.some(f => f.rootId === id);
    if (valid(activeFamilyId)) return activeFamilyId;
    if (valid(preferredFamilyId)) return preferredFamilyId;
    const me = (typeof Tree !== 'undefined' && Tree.getCurrentUser) ? Tree.getCurrentUser() : null;
    const mine = me && families.find(f => f.assigned.has(me));
    return mine ? mine.rootId : families[0].rootId;
  }

  function familyOf(memberId) {
    const f = families.find(x => x.assigned.has(memberId));
    return f ? f.rootId : null;
  }

  function getFamilies() {
    return families.map(f => ({ rootId: f.rootId, name: f.name, short: f.short, size: f.size, active: f.rootId === activeFamilyId }));
  }

  function setFamily(rootId) {
    if (!families.some(f => f.rootId === rootId) || rootId === activeFamilyId) return false;
    activeFamilyId = rootId;
    ghostFor = null;
    if (members.length) render(members, relationships);
    if (onFamilyChangeCallback) onFamilyChangeCallback(rootId);
    return true;
  }

  /** Vor dem Zentrieren/Markieren ggf. in die Familie der Person wechseln. */
  function ensureFamilyFor(memberId) {
    if (segById.has(memberId) || hostOf.has(memberId)) return;
    const fid = familyOf(memberId);
    if (fid && fid !== activeFamilyId) setFamily(fid);
  }

  // ═══════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════

  function render(memberData, relationshipData) {
    members = memberData;
    relationships = relationshipData;
    segLayer.innerHTML = ''; hlLayer.innerHTML = ''; labelLayer.innerHTML = '';
    segById = new Map(); hostOf = new Map(); labelSpecs = []; lodTier = null;
    ghostLayer.innerHTML = ''; ghostFor = null;

    buildFamilies();
    if (!families.length) return;
    activeFamilyId = pickFamily();
    const fam = families.find(f => f.rootId === activeFamilyId);
    computeYearRange(fam);
    const root = fam.root;
    rootId = root.m.id;

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

    applyRotation();
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
    const fill = segColor(m, node.depth);
    const stroke = isMe ? '#e63946' : (m.isPlaceholder ? 'none' : '#1a1a1a');
    const sw = isMe ? 3 : (m.isPlaceholder ? 0 : 1.6);
    const d = arcPath(r0, r1, a0, a0 + span, SEG_GAP);
    g.appendChild(el('path', { d, fill, stroke, 'stroke-width': sw, 'stroke-linejoin': 'round' }));

    // ── Label-Geometrie (Text selbst kommt aus renderLabels, je Zoomstufe) ──
    const rm = (r0 + r1) / 2;
    const arcLen = span * rm - 2 * SEG_GAP;
    const tangential = arcLen > thick * 1.15;
    const theta = a0 + span / 2;
    labelSpecs.push({
      m, spouses: node.spouses, familyName, isMe,
      theta, rm, tangential,
      along: (tangential ? arcLen : thick) - 12,
      across: (tangential ? thick : arcLen) - 6,
      lineH: 1.25,
    });

    segById.set(m.id, { x: rm * Math.cos(theta), y: rm * Math.sin(theta), shape: { d }, r0, r1, a0, a1: a0 + span, theta, spouses: node.spouses.length });
    node.spouses.forEach(sp => hostOf.set(sp.id, m.id));
    return g;
  }

  function drawCenter(root, familyName, isMe) {
    const m = root.m;
    const g = el('g', { class: 'fan-seg fan-center', 'data-id': m.id });
    g.appendChild(el('circle', {
      r: CENTER_R, fill: segColor(m, 0),
      stroke: isMe ? '#e63946' : (m.isPlaceholder ? 'none' : '#1a1a1a'),
      'stroke-width': isMe ? 3 : (m.isPlaceholder ? 0 : 1.6),
    }));
    labelSpecs.push({
      m, spouses: root.spouses, familyName, isMe, center: true,
      theta: 0, rm: 0, tangential: false,
      along: CENTER_R * 2 - 24, across: CENTER_R * 2 - 24, lineH: 1.3,
    });
    segLayer.appendChild(g);
    segById.set(m.id, { x: 0, y: 0, shape: { r: CENTER_R }, r0: 0, r1: CENTER_R, a0: -Math.PI / 2, a1: Math.PI * 1.5, theta: -Math.PI / 2, center: true, spouses: root.spouses.length });
    root.spouses.forEach(sp => hostOf.set(sp.id, m.id));
  }

  // ═══════════════════════════════════════════════════════════
  //  VERWANDTSCHAFTSPFAD (rote Linie direkt im Fächer)
  // ═══════════════════════════════════════════════════════════

  function highlightConnection(fromId, toId) {
    highlight = { fromId, toId };
    if (!members.length) return;
    ensureFamilyFor(toId);   // ggf. in die Familie der Zielperson wechseln (rendert neu)
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
      const p = rotPt(seg.x, seg.y);
      anchors.push({ id: segId, x: p.x, y: p.y, shape: seg.shape });
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
  function labelLines(spec, tier, k = 1) {
    const { m, spouses, familyName, isMe, along, center } = spec;
    const lines = [];
    const me = isMe ? '➤ ' : '';
    // Nahe Stufe: Größe in Einheiten, aber nie größer als `px` auf dem
    // Bildschirm — so bleibt beim Reinzoomen die Schrift konstant, während
    // das Segment weiter wächst, bis alle Zeilen Platz haben. Ab dem Zoom
    // kFit (alles passt) wird die Größe in Einheiten eingefroren, damit
    // die Schrift danach wieder mit dem Segment mitwächst.
    if (spec.kFit === undefined) spec.kFit = computeKFit(spec);
    const kEff = Math.min(k, spec.kFit);
    const cap = (units, px) => Math.min(units, px / kEff);
    // Zentrum (Stammvater) folgt demselben Muster wie die Segmente:
    // Vorname groß, Nachname eigene Zeile — nur nie ganz ohne Nachname.
    // Übersicht (fern/mittel): nur Vorname — Nachnamen erst auf der nahen Stufe
    const first = center ? m.firstName : me + m.firstName;
    if (tier === 'far') {
      // fern: überall nur der Vorname, auch im Zentrum
      lines.push({ ...fitText(me + m.firstName, along, 18, 6.5), weight: 600 });
    } else if (tier === 'mid') {
      lines.push({ ...fitText(first, along, 13, 6.5), weight: 600 });
      if (spouses.length) lines.push(...spouseLines(spouses, along, 9.5, 6, sp => sp.firstName));
    } else {
      // nah: voller Name — Nachname als eigene Zeile, damit er in die
      // Ringbreite passt; Geburtsname zuletzt (niedrigste Priorität)
      lines.push({ ...fitText(center ? `${m.firstName} ${m.lastName}` : me + m.firstName, along, cap(11, 15), cap(6.5, 11)), weight: 600 });
      // Nachname darf etwas dichter an den Rand und kleiner werden,
      // damit „von Petersdorff-Campen" auch radial in die Ringbreite passt
      if (m.lastName && !center) lines.push({ ...fitText(m.lastName, along + 6, cap(8.5, 12), cap(5.5, 10)), weight: 500 });
      if (spouses.length) lines.push(...spouseLines(spouses, along, cap(8.5, 12), cap(6, 10), spouseName));
      const yr = yearLabel(m);
      if (yr) lines.push({ ...fitText(yr, along, cap(8, 11), cap(6, 10)), weight: 400, dim: true });
      if (m.birthName) {
        const geb = /^geb\./i.test(m.birthName) ? m.birthName : `geb. ${m.birthName}`;
        lines.push({ ...fitText(geb, along, cap(7.5, 11), cap(6, 10)), weight: 400, dim: true });
      }
    }
    return lines;
  }

  /**
   * Zoom (px/Einheit), ab dem auf der nahen Stufe ALLE Zeilen eines
   * Segments ungekürzt passen — mit denselben Pixel-Deckeln wie in
   * labelLines. Darüber werden die Schriftgrößen eingefroren.
   */
  function computeKFit(spec) {
    const { m, spouses, isMe, along, across, lineH, center } = spec;
    const me = isMe ? '➤ ' : '';
    const items = [];
    if (center) {
      items.push({ text: `${m.firstName} ${m.lastName}`, px: 15, along });
    } else {
      items.push({ text: me + m.firstName, px: 15, along });
      if (m.lastName) items.push({ text: m.lastName, px: 12, along: along + 6 });
    }
    for (const sp of spouses) items.push({ text: (sp.former ? '⚮ ' : '∞ ') + spouseName(sp), px: 12, along });
    const yr = yearLabel(m);
    if (yr) items.push({ text: yr, px: 11, along });
    if (m.birthName) {
      items.push({ text: /^geb\./i.test(m.birthName) ? m.birthName : `geb. ${m.birthName}`, px: 11, along });
    }
    let k = 0;
    for (const it of items) k = Math.max(k, it.text.length * CHAR_W * it.px / Math.max(1, it.along));
    const stackPx = items.reduce((sum, it) => sum + it.px * lineH, 0);
    k = Math.max(k, stackPx / Math.max(1, across));
    // 8 % Reserve gegen Rundung (Zeilenpackung / Zeichenzahl an der Grenze)
    return Math.max(k * 1.08, 0.01);
  }

  /** Größtes kFit aller Segmente — bis dahin muss man zoomen können. */
  function maxKFit() {
    let mx = 0;
    for (const sp of labelSpecs) {
      if (sp.kFit === undefined) sp.kFit = computeKFit(sp);
      mx = Math.max(mx, sp.kFit);
    }
    return mx;
  }

  /** Eine Zeile je Partner/in: „∞ Name" bzw. „⚮ Name" (ehemalig), der
      Name ist klickbar (eigenes Profil). Gekürzt wird nur innerhalb des
      eigenen Namens — so bleibt jede Partnerin einzeln erreichbar. */
  function spouseLines(spouses, along, fs, minFs, nameFn) {
    return spouses.map(sp => {
      const glyph = sp.former ? '⚮ ' : '∞ ';
      const fit = fitText(glyph + nameFn(sp), along, fs, minFs);
      const name = fit.text.slice(glyph.length);
      return { fs: fit.fs, weight: 400, dim: true, parts: [{ text: glyph }, { text: name, id: sp.id }] };
    });
  }

  let labelK = 0;   // Zoom (px/Einheit), für den die Labels zuletzt gebaut wurden

  function renderLabels(force = false) {
    if (!svg) return;
    const tier = currentTier();
    const k = (svg.clientWidth || 1) / vb.w;
    // Nahe Stufe: Schriftdeckel hängt vom Zoom ab → bei >4 % Änderung neu
    // bauen — aber nur, solange noch ein Segment unter seinem kFit liegt
    // (darüber sind alle Größen eingefroren, Neubau wäre Verschwendung).
    const kAll = maxKFit();
    const zoomChanged = tier === 'full' && Math.abs(k - labelK) / (labelK || 1) > 0.04
      && !(k >= kAll && labelK >= kAll);
    if (!force && tier === lodTier && !zoomChanged) return;
    lodTier = tier; labelK = k;
    labelLayer.innerHTML = '';
    for (const spec of labelSpecs) {
      const lines = labelLines(spec, tier, k);
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
        transform: labelTransform(spec),
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
  //  ROTATION (Ring außen, Griff-Knopf)
  // ═══════════════════════════════════════════════════════════

  const WHEEL_PX_PER_TURN = 720;   // Fingerweg (px) für eine volle Umdrehung

  /** Punkt (x,y) um phi gedreht. */
  function rotPt(x, y) {
    const c = Math.cos(phi), s = Math.sin(phi);
    return { x: x * c - y * s, y: x * s + y * c };
  }

  /** Label-Transform je Pose, mit aktueller Rotation und Lesbarkeitsregel. */
  function labelTransform(spec) {
    if (spec.center) return 'translate(0,0)';
    const a = spec.theta + phi;
    const x = spec.rm * Math.cos(a), y = spec.rm * Math.sin(a);
    let rot = (spec.tangential ? a + Math.PI / 2 : a) * 180 / Math.PI;
    rot = ((rot + 90) % 360 + 360) % 360 - 90;   // lesbar: (-90, 90]
    if (rot > 90) rot -= 180;
    return `translate(${x.toFixed(2)},${y.toFixed(2)}) rotate(${rot.toFixed(2)})`;
  }

  function applyRotation() {
    const deg = (phi * 180 / Math.PI).toFixed(3);
    segLayer.setAttribute('transform', `rotate(${deg})`);
    hlLayer.setAttribute('transform', `rotate(${deg})`);
    for (const t of labelLayer.children) {
      const spec = labelSpecs.find(x => x.m.id === t.getAttribute('data-id'));
      if (spec) t.setAttribute('transform', labelTransform(spec));
    }
    if (ghostFor) renderGhosts();
    // Rillen des Rads laufen 1:1 mit dem Fingerweg
    if (wheel) wheel.style.backgroundPositionY = `${(phi / (2 * Math.PI) * WHEEL_PX_PER_TURN).toFixed(1)}px`;
  }

  /**
   * Rändelrad (wie die Krone einer Uhr von oben): HTML-Element rechts im
   * Container, bildschirmfix. Vertikales Ziehen dreht den Fächer, Mausrad
   * darüber ebenfalls.
   */
  function attachWheel() {
    wheel = document.createElement('div');
    wheel.className = 'fan-wheel';
    wheel.setAttribute('title', 'Ziehen zum Drehen');
    wheel.setAttribute('role', 'slider');
    wheel.setAttribute('aria-label', 'Fächer drehen');
    container.appendChild(wheel);

    let drag = null;   // { y, phi0 }
    wheel.addEventListener('pointerdown', e => {
      if (e.button !== undefined && e.button !== 0) return;
      drag = { y: e.clientY, phi0: phi };
      try { wheel.setPointerCapture(e.pointerId); } catch { /* synthetisch */ }
      wheel.classList.add('is-active');
      e.preventDefault();
    });
    wheel.addEventListener('pointermove', e => {
      if (!drag) return;
      phi = drag.phi0 + (e.clientY - drag.y) / WHEEL_PX_PER_TURN * 2 * Math.PI;
      applyRotation();
    });
    const end = e => {
      if (!drag) return;
      drag = null;
      wheel.classList.remove('is-active');
      try { wheel.releasePointerCapture(e.pointerId); } catch { /* egal */ }
      if (highlight) drawHighlight();   // Anker für Einpassen neu berechnen
    };
    wheel.addEventListener('pointerup', end);
    wheel.addEventListener('pointercancel', end);
    wheel.addEventListener('wheel', e => {
      e.preventDefault();
      e.stopPropagation();
      phi += e.deltaY / WHEEL_PX_PER_TURN * 2 * Math.PI;
      applyRotation();
      if (highlight) drawHighlight();
    }, { passive: false });
  }

  // ═══════════════════════════════════════════════════════════
  //  PLUS-CHIPS: Kind / Geschwister anlegen
  // ═══════════════════════════════════════════════════════════

  /** Chips für ein Segment zeigen (null = ausblenden). */
  function showGhosts(id) {
    ghostFor = id;
    renderGhosts();
  }

  function renderGhosts() {
    ghostLayer.innerHTML = '';
    if (!ghostFor) return;
    const seg = segById.get(ghostFor);
    if (!seg) return;
    const me = (typeof Tree !== 'undefined' && Tree.getCurrentUser) ? Tree.getCurrentUser() : null;
    const showConnect = !!onConnectCallback && ghostFor !== me;
    if (!canEdit && !showConnect) return;
    // Chips in Bildschirm-Pixeln konstant halten (unabhängig vom Zoom)
    const k = (svg.clientWidth || 1) / vb.w;   // px pro Einheit
    const r = 12 / k, off = 15 / k;
    const chip = (x, y, kind, title, glyph = '+') => {
      const g = el('g', { class: 'fan-ghost', 'data-id': ghostFor, 'data-add': kind, transform: `translate(${x.toFixed(2)},${y.toFixed(2)})` });
      g.appendChild(el('circle', { r, fill: '#ffffff', stroke: '#1a1a1a', 'stroke-width': 1.6 / k }));
      const t = el('text', { 'text-anchor': 'middle', 'dominant-baseline': 'central', 'font-size': ((glyph === '+' ? 16 : 13) / k).toFixed(2), 'font-weight': 600, fill: '#1a1a1a' });
      t.textContent = glyph;
      g.appendChild(t);
      const tt = el('title'); tt.textContent = title; g.appendChild(tt);
      ghostLayer.appendChild(g);
    };
    const rm = (seg.r0 + seg.r1) / 2;
    const theta = seg.theta + phi, a0 = seg.a0 + phi, a1 = seg.a1 + phi;   // mit Rotation
    if (canEdit) {
      // Kind: außen an der Segmentmitte
      const rc = seg.r1 + off;
      chip(rc * Math.cos(theta), rc * Math.sin(theta), 'child', 'Kind anlegen');
      if (!seg.center) {
        // Geschwister: seitlich am Ende des Segments
        const a = a1 + off / rm;
        chip(rm * Math.cos(a), rm * Math.sin(a), 'sibling', 'Geschwister anlegen');
        // Partner: innen an der Segmentmitte — nur, wenn noch keiner eingetragen ist
        if (!seg.spouses) {
          const ri = seg.r0 - off;
          chip(ri * Math.cos(theta), ri * Math.sin(theta), 'spouse', 'Partner anlegen', '∞');
        }
      } else if (!seg.spouses) {
        // Wurzel ohne Partner: Chip unten am Kreis
        const p = rotPt(0, seg.r1 + off);
        chip(p.x, p.y, 'spouse', 'Partner anlegen', '∞');
      }
    }
    if (showConnect) {
      // „Wie sind wir verwandt?": an der Anfangskante des Segments (die noch
      // freie Seite), bei der Wurzel links am Kreis
      if (!seg.center) {
        const a = a0 - off / rm;
        chip(rm * Math.cos(a), rm * Math.sin(a), 'connect', 'Wie sind wir verwandt?', '?');
      } else {
        const p = rotPt(-(seg.r1 + off), 0);
        chip(p.x, p.y, 'connect', 'Wie sind wir verwandt?', '?');
      }
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

  /** Männer hellblau, Frauen rosa, unbekannt neutral; Verstorbene entsättigt.
      Im Jahres-Modus: Geburtsjahr auf gemeinsamer Skala (alt → jung). */
  function segColor(m, depth) {
    if (colorMode === 'year') {
      const y = m.birthDate ? parseInt(m.birthDate.substring(0, 4), 10) : NaN;
      if (!isFinite(y)) return 'hsl(0 0% 88%)';
      const span = yearRange.max - yearRange.min;
      return yearColor(span > 0 ? (y - yearRange.min) / span : 0.5);
    }
    const [h, s] = m.gender === 'm' ? [207, 72] : m.gender === 'f' ? [340, 72] : [0, 0];
    const sat = m.isDeceased ? Math.round(s * 0.45) : s;
    const l = Math.min(93, (m.isDeceased ? 84 : 80) + depth * 2);
    return `hsl(${h} ${sat}% ${l}%)`;
  }

  /** Farbskala 0 (älteste) → 1 (jüngste): Blau → Türkis → Grün → Gelb → Orange. */
  function yearColor(t) {
    const h = 235 - Math.max(0, Math.min(1, t)) * 210;
    return `hsl(${Math.round(h)} 66% 80%)`;
  }

  /** Jahresbereich je Familienzweig: vom ältesten bis zum jüngsten Geburtsjahr
      der aktiven Familie (Märkisch: ab Hans Leo 1830), damit die Skala den
      Zweig ausfüllt und nicht von einem anderen Zweig gestaucht wird. */
  function computeYearRange(fam) {
    const pool = fam ? members.filter(m => fam.assigned.has(m.id)) : members;
    const years = pool.map(m => m.birthDate ? parseInt(m.birthDate.substring(0, 4), 10) : NaN).filter(isFinite);
    if (!years.length) return;
    yearRange = { min: Math.min(...years), max: Math.max(...years) };
  }

  function setColorMode(mode) {
    if (mode !== 'gender' && mode !== 'year') return;
    if (mode === colorMode) return;
    colorMode = mode;
    if (members.length) {
      // nur Farben tauschen, Geometrie bleibt
      for (const g of segLayer.children) {
        const id = g.getAttribute('data-id');
        const spec = labelSpecs.find(x => x.m.id === id);
        if (!spec) continue;
        const shape = g.querySelector('path, circle');
        const depth = Math.max(0, Math.round((segById.get(id).r0 - CENTER_R) / RING));
        if (shape) shape.setAttribute('fill', segColor(spec.m, depth));
      }
    }
  }

  function getYearScale() {
    return { min: yearRange.min, max: yearRange.max, stops: [0, 0.25, 0.5, 0.75, 1].map(yearColor) };
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
    if (ghostFor) renderGhosts();
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
    // Mindestens Platz für zwei Ringe, sonst füllt eine Ein-Personen-Familie den Bildschirm
    const R = Math.max(chartRadius, CENTER_R + 2 * RING) + PAD;
    let w = 2 * R, h = 2 * R;
    if (cw >= ch) w = h * cw / ch; else h = w * ch / cw;
    vb = { x: -w / 2, y: -h / 2, w, h };
    apply();
  }

  function zoomAt(client, f) {
    const rect = svg.getBoundingClientRect();
    const sx = vb.x + (client.x - rect.left) / rect.width * vb.w;
    const sy = vb.y + (client.y - rect.top) / rect.height * vb.h;
    // Weit genug rein, dass JEDES Segment sein kFit erreicht (alle Zeilen
    // sichtbar) — mindestens aber bis ein knapper halber Ring den Bildschirm füllt
    const minW = Math.min(RING * 0.4, (svg.clientWidth || 1) / (maxKFit() * 1.15));
    const maxW = (chartRadius + PAD) * 6;
    const nw = Math.min(maxW, Math.max(minW, vb.w / f));
    const rf = vb.w / nw;
    vb.x = sx - (sx - vb.x) / rf;
    vb.y = sy - (sy - vb.y) / rf;
    vb.w = nw; vb.h = vb.h / rf;
    apply();
  }

  function centerOn(memberId) {
    ensureFamilyFor(memberId);
    const s = segById.get(memberId) || segById.get(hostOf.get(memberId));
    if (!s) { fit(); return; }
    const cw = container.clientWidth || 1, ch = container.clientHeight || 1;
    const w = RING * 5.5, h = w * ch / cw;
    const p = rotPt(s.x, s.y);
    vb = { x: p.x - w / 2, y: p.y - h / 2, w, h };
    apply();
  }

  /** ID des Partner-Links im Label von segId, der pt (Client-Koordinaten)
      bis auf `pad` Pixel trifft — sonst null. */
  function spouseLinkNear(segId, pt, pad) {
    const label = labelLayer.querySelector(`.fan-label[data-id="${segId}"]`);
    if (!label) return null;
    // Im LOKALEN (ungedrehten) Koordinatensystem des Labels testen: bei
    // schräg gedrehtem Text überlappen sich die Bildschirm-Bounding-Boxen
    // benachbarter Links, und der erste („Karoline") gewann fälschlich.
    const ctm = label.getScreenCTM();
    if (!ctm) return null;
    const p = new DOMPoint(pt.x, pt.y).matrixTransform(ctm.inverse());
    const scale = Math.hypot(ctm.a, ctm.b) || 1;   // px je lokaler Einheit
    const padLocal = pad / scale;
    let best = null, bestDist = Infinity;
    for (const link of label.querySelectorAll('.fan-spouse-link')) {
      let b;
      try { b = link.getBBox(); } catch { continue; }
      const dx = Math.max(b.x - p.x, 0, p.x - (b.x + b.width));
      const dy = Math.max(b.y - p.y, 0, p.y - (b.y + b.height));
      const d = Math.hypot(dx, dy);
      if (d <= padLocal && d < bestDist) { best = link.getAttribute('data-id'); bestDist = d; }
    }
    return best;
  }

  /** Person in die Bildmitte holen, ohne den Zoom zu ändern. */
  function panTo(memberId) {
    ensureFamilyFor(memberId);
    const s = segById.get(memberId) || segById.get(hostOf.get(memberId));
    if (!s) return;
    const p = rotPt(s.x, s.y);
    vb.x = p.x - vb.w / 2;
    vb.y = p.y - vb.h / 2;
    apply();
  }

  function attachPanZoom() {
    const pts = new Map();
    let moved = 0, prevPinch = null;
    // Ziel beim Drücken merken: nach setPointerCapture ist e.target beim
    // pointerup das <svg>, nicht mehr das Segment unter dem Finger.
    let downTarget = null, downPt = null;

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
        downPt = { x: e.clientX, y: e.clientY };
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
        let id = downTarget.getAttribute('data-id');
        const add = downTarget.getAttribute('data-add');
        // Partner-Links sind klein: ein Tipp knapp daneben (±8px) im
        // Segment der Person gilt trotzdem als Link-Tipp.
        if (!add && !downTarget.classList.contains('fan-spouse-link') && downPt) {
          const near = spouseLinkNear(id, downPt, 8);
          if (near) id = near;
        }
        downTarget = null;
        if (add === 'connect') {
          if (onConnectCallback) onConnectCallback(id);
        } else if (add) {
          if (onAddCallback) onAddCallback(add, id);
        } else if (id && onTapCallback) {
          selectedId = id;
          showGhosts(id);          // Chips bleiben an der gewählten Person (Touch)
          onTapCallback(id);
        }
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

  return { init, onTap, onAddRelative, onConnect, setCanEdit, isActive, show, hide, toggle, render, fit, centerOn, panTo, highlightConnection, clearHighlight,
           getFamilies, setFamily, familyOf,
           setColorMode, getColorMode: () => colorMode, getYearScale,
           setPreferredFamily: (id) => { preferredFamilyId = id; },
           onFamilyChange: (cb) => { onFamilyChangeCallback = cb; },
           getUnreachable: () => unreachable.slice(),
           getRotation: () => phi, setRotation: (r) => { phi = r; applyRotation(); },
           getTier: () => lodTier,
           _spec: (id) => labelSpecs.find(x => x.m.id === id) };
})();
