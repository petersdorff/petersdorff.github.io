/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Artikel-Ansicht (Vollseite pro Person)  v1
   Oben die Eigenschaften als Property-Zeilen (wie Notion), darunter die
   ausführliche Vita als Markdown-Artikel. Editiermodus mit kleiner
   Formatierungs-Leiste; Quelle ist members.notes (Markdown).
   ═══════════════════════════════════════════════════════════ */

const Article = (() => {
  let currentId = null;
  let editing = false;

  function init() {
    document.getElementById('btn-article-back').addEventListener('click', close);
    document.getElementById('btn-article-edit').addEventListener('click', () => startEdit());
    document.getElementById('btn-article-cancel').addEventListener('click', () => { editing = false; setMode('read'); });
    document.getElementById('btn-article-save').addEventListener('click', save);
    document.getElementById('btn-article-preview').addEventListener('click', togglePreview);
    document.getElementById('article-toolbar').addEventListener('click', e => {
      const b = e.target.closest('[data-md]');
      if (b) { e.preventDefault(); applyFormat(b.dataset.md); }
    });
    document.getElementById('btn-article-profile-edit').addEventListener('click', () => Profile.edit(currentId));
  }

  async function show(memberId) {
    currentId = memberId;
    const m = await DB.getMember(memberId);
    if (!m) { App.toast('Profil nicht gefunden', 'error'); return; }
    editing = false;

    document.getElementById('article-name').textContent = `${m.firstName} ${m.lastName}`;
    document.getElementById('article-birthname').textContent = m.birthName ? (/^geb\./i.test(m.birthName) ? m.birthName : `geb. ${m.birthName}`) : '';

    // Foto / Initialen
    const photo = document.getElementById('article-photo');
    photo.innerHTML = '';
    if (m.photo) photo.appendChild(Utils.createEl('img', { src: m.photo, alt: m.firstName }));
    else photo.textContent = `${m.firstName[0] || ''}${(m.lastName || '')[0] || ''}`.toUpperCase();

    renderProperties(m);
    await renderRelations(memberId);
    renderBody(m.notes || '');

    // Rechte: Vita ist Kernfeld → nur Inhaber/Admin bei beanspruchten Profilen
    const user = Auth.getUser();
    const canEdit = !DB.isOffline() && (!m.claimedByUid || user?.id === m.claimedByUid || Admin.isAdmin());
    document.getElementById('btn-article-edit').style.display = canEdit ? '' : 'none';
    document.getElementById('btn-article-profile-edit').style.display = DB.isOffline() ? 'none' : '';
    setMode('read');
    App.showView('view-article');
    document.getElementById('view-article').scrollTop = 0;
  }

  function close() {
    editing = false;
    Profile.show(currentId);
  }

  // ═══════════════════════════════════════════════════════════
  //  PROPERTIES (oben, wie Notion)
  // ═══════════════════════════════════════════════════════════

  function renderProperties(m) {
    const grid = document.getElementById('article-props');
    grid.innerHTML = '';
    const fmt = d => d ? new Date(d + 'T00:00:00').toLocaleDateString('de-DE') : '';
    const gender = { m: 'Männlich', f: 'Weiblich', d: 'Divers' }[m.gender] || '';
    const status = [
      m.isDeceased ? '† Verstorben' : null,
      m.isPlaceholder ? '◌ Platzhalter' : '✓ Registriert',
    ].filter(Boolean).join(' · ');
    const rows = [
      ['Geboren', fmt(m.birthDate)],
      ['Gestorben', m.isDeceased ? fmt(m.deathDate) : ''],
      ['Geschlecht', gender],
      ['Beruf', m.occupation],
      ['Wohnort', m.location],
      ['Kontakt', m.contact || m.email],
      ['Status', status],
    ];
    for (const [k, v] of rows) {
      if (!v) continue;
      grid.append(
        Utils.createEl('div', { className: 'article-prop-key', textContent: k }),
        Utils.createEl('div', { className: 'article-prop-val', textContent: v }),
      );
    }
  }

  async function renderRelations(memberId) {
    const grid = document.getElementById('article-props');
    const rels = await DB.getRelationshipsForMember(memberId);
    if (!rels.length) return;
    const byId = new Map(App.getCachedMembers().map(x => [x.id, x]));
    const groups = new Map();   // Label → [member]
    for (const r of rels) {
      const otherId = r.fromId === memberId ? r.toId : r.fromId;
      const other = byId.get(otherId); if (!other) continue;
      let type = r.type === 'parent_child' ? (r.fromId === memberId ? 'child' : 'parent') : (r.type === 'spouse' && r.isFormer ? 'ex_spouse' : r.type);
      const label = { parent: 'Eltern', child: 'Kinder', spouse: 'Partner', ex_spouse: 'Ehemalige Partner', sibling: 'Geschwister' }[type] || type;
      if (!groups.has(label)) groups.set(label, []);
      groups.get(label).push(other);
    }
    for (const label of ['Eltern', 'Partner', 'Ehemalige Partner', 'Kinder', 'Geschwister']) {
      const list = groups.get(label); if (!list) continue;
      const val = Utils.createEl('div', { className: 'article-prop-val article-chips' });
      for (const p of list.sort((a, b) => (a.birthDate || '').localeCompare(b.birthDate || ''))) {
        const chip = Utils.createEl('button', { className: 'article-chip', textContent: `${p.firstName} ${p.lastName}` });
        chip.addEventListener('click', () => show(p.id));
        val.appendChild(chip);
      }
      grid.append(Utils.createEl('div', { className: 'article-prop-key', textContent: label }), val);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  VITA (Markdown)
  // ═══════════════════════════════════════════════════════════

  function renderBody(md) {
    const body = document.getElementById('article-body');
    if (md.trim()) {
      body.innerHTML = Markdown.render(md);
      body.classList.remove('is-empty');
    } else {
      body.textContent = 'Noch keine Vita. Über „Vita bearbeiten" kannst du einen ausführlichen Text mit Überschriften und Listen anlegen.';
      body.classList.add('is-empty');
    }
  }

  function setMode(mode) {
    const isEdit = mode === 'edit';
    document.getElementById('article-body').classList.toggle('hidden', isEdit);
    document.getElementById('article-editor').classList.toggle('hidden', !isEdit);
    document.getElementById('article-read-actions').classList.toggle('hidden', isEdit);
    document.getElementById('article-edit-actions').classList.toggle('hidden', !isEdit);
    document.getElementById('article-preview').classList.add('hidden');
    document.getElementById('article-textarea').classList.remove('hidden');
    document.getElementById('btn-article-preview').textContent = 'Vorschau';
  }

  async function startEdit() {
    const m = await DB.getMember(currentId);
    const ta = document.getElementById('article-textarea');
    ta.value = m?.notes || '';
    editing = true;
    setMode('edit');
    ta.focus();
  }

  function togglePreview() {
    const ta = document.getElementById('article-textarea');
    const pv = document.getElementById('article-preview');
    const showing = !pv.classList.contains('hidden');
    if (showing) {
      pv.classList.add('hidden'); ta.classList.remove('hidden');
      document.getElementById('btn-article-preview').textContent = 'Vorschau';
    } else {
      pv.innerHTML = Markdown.render(ta.value);
      pv.classList.remove('hidden'); ta.classList.add('hidden');
      document.getElementById('btn-article-preview').textContent = 'Weiter bearbeiten';
    }
  }

  async function save() {
    const ta = document.getElementById('article-textarea');
    const notes = Utils.sanitizeInput(ta.value);
    const btn = document.getElementById('btn-article-save');
    Utils.setButtonLoading(btn, true);
    try {
      await DB.updateMember(currentId, { notes });
      const cached = App.getCachedMembers().find(x => x.id === currentId);
      if (cached) cached.notes = notes;
      App.toast('Vita gespeichert', 'success');
      editing = false;
      renderBody(notes);
      setMode('read');
    } catch (err) {
      console.error('Vita save error:', err);
      App.toast(err.userMessage || 'Speichern fehlgeschlagen', 'error');
    } finally {
      Utils.setButtonLoading(btn, false);
    }
  }

  /** Formatierung an der Cursorposition einfügen/umschließen. */
  function applyFormat(kind) {
    const ta = document.getElementById('article-textarea');
    if (ta.classList.contains('hidden')) return;
    const { selectionStart: s, selectionEnd: e, value: v } = ta;
    const sel = v.slice(s, e);
    const lineStart = v.lastIndexOf('\n', s - 1) + 1;
    let ins, cs, ce;
    const prefixLine = p => {
      const before = v.slice(0, lineStart), rest = v.slice(lineStart);
      const nl = before.length && !before.endsWith('\n\n') && !before.endsWith('\n') ? '\n' : '';
      ta.value = before + nl + p + rest;
      const pos = lineStart + nl.length + p.length;
      ta.setSelectionRange(pos + (e - lineStart), pos + (e - lineStart));
    };
    switch (kind) {
      case 'h1': prefixLine('# '); break;
      case 'h2': prefixLine('## '); break;
      case 'ul': prefixLine('- '); break;
      case 'ol': prefixLine('1. '); break;
      case 'quote': prefixLine('> '); break;
      case 'bold': ins = `**${sel || 'fett'}**`; cs = s + 2; ce = cs + (sel || 'fett').length; break;
      case 'italic': ins = `*${sel || 'kursiv'}*`; cs = s + 1; ce = cs + (sel || 'kursiv').length; break;
      case 'link': ins = `[${sel || 'Text'}](https://)`; cs = s + 1; ce = cs + (sel || 'Text').length; break;
      case 'hr': ins = '\n---\n'; cs = ce = s + ins.length; break;
    }
    if (ins !== undefined) {
      ta.value = v.slice(0, s) + ins + v.slice(e);
      ta.setSelectionRange(cs, ce);
    }
    ta.focus();
  }

  return { init, show, close, getCurrentId: () => currentId };
})();
