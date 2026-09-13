/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Gotha-Ansicht (Textverzeichnis)  v1
   Nachkommen als eingerücktes, auf-/zuklappbares Verzeichnis im Stil
   des Gothaischen Taschenbuchs: römische Generationsziffer je Zeile
   (I = Stammvater), Partner in Gotha-Notation (∞ / ⚮), beide Familien
   untereinander, nicht zugeordnete Personen am Ende.
   Nutzt dieselbe Familienstruktur wie der Fächer (Fan.buildFamiliesFrom).
   ═══════════════════════════════════════════════════════════ */

const Gotha = (() => {
  let container = null;
  let members = [], relationships = [];
  let active = false;
  let collapsed = new Set();       // IDs mit eingeklappten Kindern (Sitzung)
  let onTapCallback = null;
  let pathIds = null;              // markierte Zeilen (Verwandtschaftspfad)

  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
  const roman = n => ROMAN[n] || String(n + 1);

  function init(containerId) {
    container = document.getElementById(containerId);
    container.addEventListener('click', onClick);
  }

  function onTap(cb) { onTapCallback = cb; }
  function isActive() { return active; }

  function show() {
    active = true;
    container.classList.remove('hidden');
    if (members.length) render(members, relationships);
  }

  function hide() {
    active = false;
    container.classList.add('hidden');
  }

  // ═══════════════════════════════════════════════════════════
  //  RENDER
  // ═══════════════════════════════════════════════════════════

  function render(memberData, relationshipData) {
    members = memberData;
    relationships = relationshipData;
    if (!active) return;
    const me = (typeof Tree !== 'undefined' && Tree.getCurrentUser) ? Tree.getCurrentUser() : null;
    const { families, unreachable } = Fan.buildFamiliesFrom(members, relationships);
    const byId = new Map(members.map(m => [m.id, m]));

    const frag = document.createDocumentFragment();

    // Kopf mit Werkzeugen
    const tools = el('div', 'gotha-tools');
    tools.append(
      btn('Alle ausklappen', () => { collapsed = new Set(); render(members, relationships); }),
      btn('Bis Gen. III einklappen', () => { collapsed = new Set(); collapseBelow(families, 2); render(members, relationships); }),
    );
    frag.appendChild(tools);

    for (const fam of families) {
      const sec = el('section', 'gotha-family');
      const h = el('h2', 'gotha-title');
      h.textContent = fam.name;
      const sub = el('div', 'gotha-subtitle');
      sub.textContent = `${fam.size} Personen · ${countGenerations(fam.root)} Generationen`;
      sec.append(h, sub);
      sec.appendChild(renderNode(fam.root, me, byId));
      frag.appendChild(sec);
    }

    if (unreachable.length) {
      const sec = el('section', 'gotha-family gotha-orphans');
      const h = el('h2', 'gotha-title'); h.textContent = 'Nicht zugeordnet';
      const sub = el('div', 'gotha-subtitle'); sub.textContent = 'Noch ohne Verbindung zu einem Stammvater';
      sec.append(h, sub);
      const ul = el('ul', 'gotha-list');
      for (const id of unreachable) {
        const m = byId.get(id); if (!m) continue;
        const li = el('li', 'gotha-item');
        li.appendChild(renderRow(m, null, [], me, false));
        ul.appendChild(li);
      }
      sec.appendChild(ul);
      frag.appendChild(sec);
    }

    container.innerHTML = '';
    const doc = el('div', 'gotha-doc');
    doc.appendChild(frag);
    container.appendChild(doc);
    applyPath();
  }

  function renderNode(node, me, byId) {
    const ul = el('ul', 'gotha-list');
    ul.appendChild(renderItem(node, me, byId));
    return ul;
  }

  function renderItem(node, me, byId) {
    const li = el('li', 'gotha-item');
    li.dataset.id = node.m.id;
    const hasKids = node.children.length > 0;
    const isCollapsed = collapsed.has(node.m.id);
    li.appendChild(renderRow(node.m, node.depth, node.spouses, me, hasKids, isCollapsed));
    if (hasKids) {
      const kids = el('ul', 'gotha-list gotha-children');
      if (isCollapsed) kids.classList.add('hidden');
      for (const c of node.children) kids.appendChild(renderItem(c, me, byId));
      li.appendChild(kids);
    }
    return li;
  }

  /** Eine Zeile: [Toggle] [Gen] Name Nachname, * 1953 † 2001; ∞ Partner (* 1954) */
  function renderRow(m, depth, spouses, me, hasKids, isCollapsed) {
    const row = el('div', 'gotha-row');
    if (m.id === me) row.classList.add('is-me');
    if (!m.isPlaceholder) row.classList.add('is-registered');
    if (m.isDeceased) row.classList.add('is-deceased');

    const toggle = el('button', 'gotha-toggle');
    toggle.type = 'button';
    toggle.dataset.toggle = m.id;
    toggle.setAttribute('aria-label', isCollapsed ? 'Nachkommen ausklappen' : 'Nachkommen einklappen');
    toggle.textContent = hasKids ? (isCollapsed ? '▸' : '▾') : '';
    if (!hasKids) toggle.classList.add('is-leaf');
    row.appendChild(toggle);

    const gen = el('span', 'gotha-gen');
    gen.textContent = depth === null ? '–' : roman(depth);
    gen.title = depth === null ? 'ohne Zuordnung' : `${depth + 1}. Generation seit dem Stammvater`;
    row.appendChild(gen);

    const body = el('span', 'gotha-body');
    const name = el('a', 'gotha-name');
    name.href = '#';
    name.dataset.open = m.id;
    name.textContent = (m.id === me ? '➤ ' : '') + m.firstName;
    body.appendChild(name);
    const sur = el('span', 'gotha-surname'); sur.textContent = ' ' + (m.lastName || '');
    body.appendChild(sur);
    if (m.birthName) { const bn = el('span', 'gotha-muted'); bn.textContent = ` (${/^geb\./i.test(m.birthName) ? m.birthName : 'geb. ' + m.birthName})`; body.appendChild(bn); }
    const dates = yearLabel(m);
    if (dates) { const d = el('span', 'gotha-dates'); d.textContent = ', ' + dates; body.appendChild(d); }

    for (const sp of spouses || []) {
      const s = el('span', 'gotha-spouse');
      s.appendChild(document.createTextNode(`; ${sp.former ? '⚮' : '∞'} `));
      const a = el('a', 'gotha-name gotha-spouse-name');
      a.href = '#'; a.dataset.open = sp.id;
      a.textContent = `${sp.firstName} ${sp.birthName ? sp.birthName.replace(/^geb\.\s*/i, '') : sp.lastName}`;
      s.appendChild(a);
      const sd = yearLabel(sp);
      if (sd) s.appendChild(document.createTextNode(` (${sd})`));
      body.appendChild(s);
    }
    row.appendChild(body);
    return row;
  }

  // ═══════════════════════════════════════════════════════════
  //  INTERAKTION
  // ═══════════════════════════════════════════════════════════

  function onClick(e) {
    const t = e.target.closest('[data-toggle], [data-open]');
    if (!t) return;
    e.preventDefault();
    if (t.dataset.toggle) {
      const id = t.dataset.toggle;
      const li = container.querySelector(`.gotha-item[data-id="${id}"]`);
      const kids = li && li.querySelector(':scope > .gotha-children');
      if (!kids) return;
      const nowCollapsed = !kids.classList.contains('hidden');
      kids.classList.toggle('hidden', nowCollapsed);
      t.textContent = nowCollapsed ? '▸' : '▾';
      if (nowCollapsed) collapsed.add(id); else collapsed.delete(id);
    } else if (t.dataset.open && onTapCallback) {
      onTapCallback(t.dataset.open);
    }
  }

  /** Zeile einer Person sichtbar machen (Eltern ausklappen), kurz hervorheben. */
  function scrollTo(memberId) {
    const li = container.querySelector(`.gotha-item[data-id="${memberId}"]`);
    if (!li) return false;
    // alle eingeklappten Vorfahren öffnen
    let p = li.parentElement;
    while (p && p !== container) {
      if (p.classList.contains('gotha-children') && p.classList.contains('hidden')) {
        p.classList.remove('hidden');
        const parentLi = p.parentElement;
        collapsed.delete(parentLi.dataset.id);
        const tg = parentLi.querySelector(':scope > .gotha-row .gotha-toggle');
        if (tg) tg.textContent = '▾';
      }
      p = p.parentElement;
    }
    const row = li.querySelector(':scope > .gotha-row');
    row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    row.classList.add('is-flash');
    setTimeout(() => row.classList.remove('is-flash'), 1600);
    return true;
  }

  function highlightConnection(fromId, toId) {
    const { expandedPath } = Relationship.getPathData(fromId, toId, members, relationships);
    pathIds = new Set((expandedPath || []).map(p => p.id));
    applyPath();
    if (expandedPath && expandedPath.length) scrollTo(expandedPath[0].id);
  }

  function clearHighlight() {
    pathIds = null;
    applyPath();
  }

  function applyPath() {
    for (const row of container.querySelectorAll('.gotha-row')) {
      const li = row.parentElement;
      const id = li.dataset.id;
      const spouseIds = [...row.querySelectorAll('.gotha-spouse-name')].map(a => a.dataset.open);
      const hit = pathIds && (pathIds.has(id) || spouseIds.some(s => pathIds.has(s)));
      row.classList.toggle('is-path', !!hit);
      row.classList.toggle('is-off-path', !!pathIds && !hit);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  HELFER
  // ═══════════════════════════════════════════════════════════

  function collapseBelow(families, depth) {
    const walk = n => { if (n.depth >= depth && n.children.length) collapsed.add(n.m.id); n.children.forEach(walk); };
    families.forEach(f => walk(f.root));
  }

  function countGenerations(root) {
    let max = 0;
    const walk = n => { max = Math.max(max, n.depth); n.children.forEach(walk); };
    walk(root);
    return max + 1;
  }

  function yearLabel(m) {
    const b = m.birthDate ? m.birthDate.substring(0, 4) : '';
    if (m.deathDate) return `* ${b || '?'} † ${m.deathDate.substring(0, 4)}`;
    return b ? `* ${b}` : '';
  }

  function el(tag, cls) { const e = document.createElement(tag); if (cls) e.className = cls; return e; }
  function btn(label, fn) { const b = el('button', 'btn btn-small btn-secondary'); b.type = 'button'; b.textContent = label; b.addEventListener('click', fn); return b; }

  return { init, onTap, isActive, show, hide, render, scrollTo, highlightConnection, clearHighlight };
})();
