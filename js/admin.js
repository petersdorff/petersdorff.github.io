/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Admin Panel
   Approval management and admin notifications
   ═══════════════════════════════════════════════════════════ */

const Admin = (() => {

  // Admin email — this user can approve/reject new registrations
  const ADMIN_EMAIL = 'kaivonpetersdorff@me.com';

  // Email to receive approval notifications
  const NOTIFICATION_EMAIL = 'kaivonpetersdorff@gmail.com';

  // EmailJS config (free tier, client-side emails)
  const EMAILJS_PUBLIC_KEY = 'DUarAtNJocWYAECRq';
  const EMAILJS_SERVICE_ID = 'service_ml2fcxt';
  const EMAILJS_TEMPLATE_ID = 'template_6fcntlg';

  function initEmailJS() {
    if (typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY) {
      emailjs.init(EMAILJS_PUBLIC_KEY);
    }
  }

  function getAdminEmail() {
    return ADMIN_EMAIL;
  }

  // Aktuelle Rolle: aus der Freigabe-Zeile beim Login gesetzt.
  // Die Bootstrap-E-Mail ist immer Admin (spiegelt is_admin() in der DB).
  let currentIsAdmin = false;

  function setCurrentRole(user, approval) {
    currentIsAdmin = !!user && (
      user.email === ADMIN_EMAIL ||
      (approval && approval.status === 'approved' && approval.role === 'admin')
    );
    return currentIsAdmin;
  }

  function isAdmin() { return currentIsAdmin; }

  function isBootstrapAdmin(email) { return email === ADMIN_EMAIL; }

  function updateAdminMenu(isAdmin) {
    const adminItem = document.getElementById('menu-admin-item');
    if (adminItem) {
      adminItem.style.display = isAdmin ? '' : 'none';
    }
  }

  const STATUS_LABEL = { pending: 'wartet', approved: 'freigegeben', rejected: 'abgelehnt', revoked: 'gesperrt' };

  /**
   * Nutzerverwaltung: alle Konten mit Status, verknüpftem Profil und Aktionen.
   * Gruppiert in offene Anträge, freigegebene Mitglieder, abgelehnt/gesperrt.
   */
  /** Familientag-Code laden/anzeigen (app_settings, nur Admins). */
  async function loadInviteCode() {
    const codeEl = document.getElementById('admin-invite-code');
    const untilEl = document.getElementById('admin-invite-until');
    const statusEl = document.getElementById('admin-invite-status');
    if (!codeEl) return;
    try {
      const { code, validUntil } = await DB.getInviteCode();
      codeEl.value = code;
      // Ablauf als Berliner Kalendertag anzeigen
      untilEl.value = validUntil ? new Date(validUntil).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }) : '';
      const expired = validUntil && new Date(validUntil) < new Date();
      statusEl.textContent = !code ? 'Kein Code gesetzt.' : expired ? 'Abgelaufen.' : validUntil ? `Aktiv bis ${new Date(validUntil).toLocaleDateString('de-DE', { timeZone: 'Europe/Berlin' })}.` : 'Aktiv (ohne Ablauf).';
    } catch (err) {
      console.error('[Admin] invite code:', err);
      statusEl.textContent = 'Konnte den Code nicht laden (Migration 007 ausgeführt?).';
    }
  }

  async function saveInviteCode() {
    const code = document.getElementById('admin-invite-code').value.trim();
    const until = document.getElementById('admin-invite-until').value;
    // „bis einschließlich“ Tag X → Ablauf am Ende des Tages (Berlin, Sommerzeit +02)
    const validUntil = until ? `${until}T23:59:59+02:00` : null;
    try {
      await DB.setInviteCode(code, validUntil);
      App.toast('Familientag-Code gespeichert', 'success');
      loadInviteCode();
    } catch (err) {
      console.error('[Admin] save invite code:', err);
      App.toast('Speichern fehlgeschlagen', 'error');
    }
  }

  /** Nutzungsstatistik: Gesamtzahlen + Tagestabelle (usage_stats, nur Admins). */
  async function loadUsage() {
    const box = document.getElementById('admin-usage');
    if (!box) return;
    try {
      const st = await DB.getUsageStats(14);
      box.innerHTML = '';
      const tiles = [
        ['Konten', st.accounts_total, `${st.accounts_approved} freigegeben · ${st.accounts_pending} offen`],
        ['Verknüpfte Profile', st.profiles_claimed, `von ${st.members_total} Personen`],
        ['Aktive Konten', st.active_users_period, 'mit App-Start in 14 Tagen'],
        ['Beziehungen', st.relationships_total, 'gesamt'],
      ];
      const tileRow = Utils.createEl('div', { className: 'usage-tiles' });
      for (const [label, val, sub] of tiles) {
        tileRow.appendChild(Utils.createEl('div', { className: 'usage-tile' }, [
          Utils.createEl('div', { className: 'usage-val', textContent: String(val ?? 0) }),
          Utils.createEl('div', { className: 'usage-label', textContent: label }),
          Utils.createEl('div', { className: 'usage-sub', textContent: sub }),
        ]));
      }
      box.appendChild(tileRow);
      const cols = [
        ['day', 'Tag'], ['app_open', 'App-Starts'], ['active_users', 'Konten'], ['guest_open', 'Gäste'],
        ['connection', 'Abfragen'], ['member_create', 'Neue Pers.'], ['member_update', 'Änderungen'], ['relationship_add', 'Beziehungen'],
      ];
      const table = Utils.createEl('table', { className: 'usage-table' });
      const thead = Utils.createEl('thead'); const hr = Utils.createEl('tr');
      for (const [, label] of cols) hr.appendChild(Utils.createEl('th', { textContent: label }));
      thead.appendChild(hr); table.appendChild(thead);
      const tbody = Utils.createEl('tbody');
      const fmtDay = d => { const [y, m, dd] = String(d).split('-'); return `${dd}.${m}.`; };
      const totals = {};
      for (const row of (st.days || [])) {
        const tr = Utils.createEl('tr');
        for (const [key] of cols) {
          const v = key === 'day' ? fmtDay(row.day) : (row[key] || 0);
          if (key !== 'day') totals[key] = (totals[key] || 0) + (row[key] || 0);
          tr.appendChild(Utils.createEl('td', { className: key === 'day' ? 'usage-day' : (v ? '' : 'usage-zero'), textContent: String(v) }));
        }
        tbody.appendChild(tr);
      }
      const tr = Utils.createEl('tr', { className: 'usage-total' });
      for (const [key] of cols) tr.appendChild(Utils.createEl('td', { textContent: key === 'day' ? 'Σ 14 Tage' : key === 'active_users' ? '' : String(totals[key] || 0) }));
      tbody.appendChild(tr);
      table.appendChild(tbody);
      box.appendChild(Utils.createEl('div', { className: 'usage-table-wrap' }, [table]));
      box.appendChild(Utils.createEl('p', { className: 'admin-hint', textContent: 'App-Starts = Seitenaufrufe mit Konto; Konten = verschiedene Konten an dem Tag; Gäste = Familientag-Starts; Abfragen = Verwandtschaftsabfragen; Änderungen = gespeicherte Profil-Bearbeitungen. Es werden nur Zähler gespeichert, keine Inhalte.' }));
    } catch (err) {
      console.error('[Admin] usage:', err);
      box.innerHTML = '<p class="admin-hint">Nutzungsdaten nicht verfügbar (Migration 009 ausgeführt?).</p>';
    }
  }

  async function showAdminPanel() {
    App.showView('view-admin-approve');
    bindSearch();
    loadInviteCode();
    loadUsage();
    const lists = {
      pending: document.getElementById('admin-pending-list'),
      approved: document.getElementById('admin-approved-list'),
      blocked: document.getElementById('admin-blocked-list'),
    };
    for (const el of Object.values(lists)) el.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Lade...</p>';

    try {
      const rows = await DB.getAllApprovals();
      const members = App.getCachedMembers();
      const claimedBy = new Map(members.filter(m => m.claimedByUid).map(m => [m.claimedByUid, m]));

      const groups = { pending: [], approved: [], blocked: [] };
      for (const r of rows) groups[r.status === 'pending' ? 'pending' : r.status === 'approved' ? 'approved' : 'blocked'].push(r);

      for (const [key, el] of Object.entries(lists)) {
        el.innerHTML = '';
        const countEl = document.getElementById(`admin-${key}-count`);
        if (countEl) countEl.textContent = groups[key].length ? `(${groups[key].length})` : '';
        // Fallback: eingeloggter (Bootstrap-)Admin ohne eigene Zeile (vor Migration 005)
        if (key === 'approved' && !rows.some(r => r.user_uid === Auth.getUser()?.id)) el.appendChild(adminCard());
        if (!groups[key].length && key !== 'approved') {
          el.appendChild(Utils.createEl('p', { style: { color: 'var(--text-muted)', fontSize: '13px' }, textContent: key === 'pending' ? 'Keine offenen Anträge.' : 'Niemand.' }));
          continue;
        }
        for (const r of groups[key]) el.appendChild(userCard(r, claimedBy.get(r.user_uid)));
      }
      applySearch();
      const hasOwnRow = rows.some(r => r.user_uid === Auth.getUser()?.id);
      const extra = hasOwnRow ? 0 : 1;
      const summary = document.getElementById('admin-summary');
      if (summary) summary.textContent = `${rows.length + extra} Konten · ${groups.approved.length + extra} mit Zugriff · ${rows.filter(r => r.role === 'admin').length + (hasOwnRow ? 0 : 1)} Admins · ${groups.pending.length} offen`;
    } catch (err) {
      console.error('Admin panel error:', err);
      for (const el of Object.values(lists)) {
        el.innerHTML = '';
        el.appendChild(Utils.createEl('p', { style: { color: 'var(--red)', fontSize: '13px' }, textContent: 'Fehler beim Laden.' }));
      }
    }
  }

  /**
   * Konten-Suche: jedes Wort muss in Kontoname, Profilname (inkl.
   * Geburtsname) oder E-Mail vorkommen (Groß/Klein egal). Rein
   * clientseitig über data-search an den Karten; leere Listen zeigen
   * „keine Treffer" statt zu verschwinden.
   */
  function applySearch() {
    const input = document.getElementById('admin-search');
    const words = (input ? input.value : '').toLowerCase().split(/\s+/).filter(Boolean);
    let shown = 0, total = 0;
    for (const key of ['pending', 'approved', 'blocked']) {
      const list = document.getElementById(`admin-${key}-list`);
      if (!list) continue;
      let visible = 0;
      for (const card of list.querySelectorAll('.admin-user-card')) {
        total++;
        const hay = card.dataset.search || '';
        const hit = words.every(w => hay.includes(w));
        card.classList.toggle('is-filtered', !hit);
        if (hit) visible++;
      }
      shown += visible;
      let empty = list.querySelector('.admin-no-hit');
      if (words.length && !visible && list.querySelector('.admin-user-card')) {
        if (!empty) list.appendChild(Utils.createEl('p', { className: 'admin-no-hit admin-hint', textContent: 'Keine Treffer.' }));
      } else if (empty) empty.remove();
    }
    const count = document.getElementById('admin-search-count');
    if (count) count.textContent = words.length ? `${shown} von ${total}` : '';
  }
  let searchBound = false;
  function bindSearch() {
    if (searchBound) return;
    const input = document.getElementById('admin-search');
    if (input) { input.addEventListener('input', applySearch); searchBound = true; }
  }

  function adminCard() {
    const me = Auth.getUser();
    const myMember = Auth.getMember();
    const meta = Utils.createEl('div', { className: 'user-meta' });
    meta.append('Administrator (fest hinterlegt) · ');
    if (myMember) meta.appendChild(profileLink(myMember)); else meta.append('kein Profil verknüpft');
    const children = [
      Utils.createEl('div', { className: 'user-name' }, [
        document.createTextNode(myMember ? `${myMember.firstName} ${myMember.lastName}` : 'Admin'),
        Utils.createEl('span', { className: 'status-badge approved', textContent: 'Admin' }),
      ]),
      Utils.createEl('div', { className: 'user-email', textContent: me?.email || ADMIN_EMAIL }),
      meta,
    ];
    if (!myMember && me) children.push(Utils.createEl('div', { className: 'admin-actions' }, [linkWidget(me.id, 'Admin')]));
    const card = Utils.createEl('div', { className: 'admin-user-card is-admin' }, children);
    card.dataset.search = [me?.email || ADMIN_EMAIL, myMember && `${myMember.firstName} ${myMember.lastName}`, 'admin'].filter(Boolean).join(' ').toLowerCase();
    return card;
  }

  /**
   * „Profil verknüpfen": Namenssuche über die geladenen Mitglieder, nur
   * noch nicht beanspruchte Profile. Auswahl → claimMember (Profil wird
   * „registriert" und hängt am Konto).
   */
  function linkWidget(uid, displayName) {
    const wrap = Utils.createEl('div', { className: 'admin-link' });
    const btn = Utils.createEl('button', { className: 'btn btn-small btn-secondary', textContent: 'Profil verknüpfen' });
    const box = Utils.createEl('div', { className: 'admin-link-box hidden' });
    const input = Utils.createEl('input', { type: 'text', placeholder: 'Name im Stammbaum suchen…', autocomplete: 'off' });
    const results = Utils.createEl('div', { className: 'mini-results' });
    box.append(input, results);
    wrap.append(btn, box);

    btn.addEventListener('click', () => {
      box.classList.toggle('hidden');
      if (!box.classList.contains('hidden')) input.focus();
    });

    input.addEventListener('input', () => {
      const q = input.value.trim().toLowerCase();
      results.innerHTML = '';
      if (q.length < 2) return;
      const hits = App.getCachedMembers()
        .filter(m => `${m.firstName} ${m.lastName} ${m.birthName || ''}`.toLowerCase().includes(q))
        .sort((a, b) => (a.birthDate || '9999').localeCompare(b.birthDate || '9999'))
        .slice(0, 8);
      if (!hits.length) {
        results.appendChild(Utils.createEl('div', { className: 'mini-result-item', textContent: 'Keine Treffer' }));
        return;
      }
      for (const m of hits) {
        const year = m.birthDate ? ` (* ${m.birthDate.substring(0, 4)})` : '';
        const taken = !!m.claimedByUid;
        const item = Utils.createEl('div', {
          className: 'mini-result-item' + (taken ? ' is-taken' : ''),
          textContent: `${m.firstName} ${m.lastName}${year}` + (taken ? ' — bereits verknüpft' : ''),
        });
        if (!taken) {
          item.addEventListener('click', async () => {
            if (!confirm(`„${m.firstName} ${m.lastName}“ mit dem Konto von ${displayName} verknüpfen? Das Profil gilt danach als registriert.`)) return;
            try {
              await DB.claimMember(m.id, uid);
              // Ist es das eigene Konto (Admin ohne Profil): Sitzung nachziehen
              if (Auth.getUser()?.id === uid) {
                const fresh = await DB.getMember(m.id);
                Auth.setMember(fresh);
                Tree.setCurrentUser(m.id);
              }
              App.toast(`Profil verknüpft: ${m.firstName} ${m.lastName}`, 'success');
              await App.refreshTree();
              showAdminPanel();
            } catch (err) {
              console.error('Link error:', err);
              App.toast('Verknüpfen fehlgeschlagen', 'error');
            }
          });
        }
        results.appendChild(item);
      }
    });
    return wrap;
  }

  function profileLink(member) {
    const a = Utils.createEl('span', { className: 'user-link', textContent: `Profil: ${member.firstName} ${member.lastName}` });
    a.addEventListener('click', () => Profile.show(member.id));
    return a;
  }

  function userCard(req, member) {
    const displayName = req.display_name || 'Unbekannt';
    const registered = new Date(req.created_at).toLocaleDateString('de-DE');
    const reviewed = req.reviewed_at ? ` · Entscheidung: ${new Date(req.reviewed_at).toLocaleDateString('de-DE')}` : '';

    const meta = Utils.createEl('div', { className: 'user-meta' });
    meta.append(`Registriert: ${registered}${reviewed} · `);
    if (member) meta.appendChild(profileLink(member)); else meta.append('kein Profil verknüpft');

    const actions = Utils.createEl('div', { className: 'admin-actions' });
    const act = (label, cls, status, confirmText) => {
      const b = Utils.createEl('button', { className: `btn btn-small ${cls}`, textContent: label });
      b.addEventListener('click', async () => {
        if (confirmText && !confirm(confirmText)) return;
        try {
          await DB.setApprovalStatus(req.id, status, Auth.getUser().id);
          App.toast(`${displayName}: ${STATUS_LABEL[status]}`, status === 'approved' ? 'success' : 'info');
          showAdminPanel();
        } catch (err) {
          console.error('Status error:', err);
          App.toast('Änderung fehlgeschlagen', 'error');
        }
      });
      return b;
    };
    const isSelf = req.user_uid === Auth.getUser()?.id;
    const bootstrap = isBootstrapAdmin(req.email);
    const roleBtn = (label, role, confirmText) => {
      const b = Utils.createEl('button', { className: 'btn btn-small btn-secondary', textContent: label });
      b.addEventListener('click', async () => {
        if (confirmText && !confirm(confirmText)) return;
        try {
          await DB.setApprovalRole(req.id, role);
          App.toast(`${displayName}: ${role === 'admin' ? 'ist jetzt Administrator' : 'Admin-Rechte entzogen'}`, 'success');
          showAdminPanel();
        } catch (err) {
          console.error('Role error:', err);
          App.toast('Änderung fehlgeschlagen', 'error');
        }
      });
      return b;
    };
    if (req.status === 'pending') {
      actions.append(act('Freigeben', 'btn-primary', 'approved'), act('Ablehnen', 'btn-danger', 'rejected', `${displayName} wirklich ablehnen?`));
    } else if (req.status === 'approved') {
      if (!isSelf && !bootstrap) {
        actions.append(act('Sperren', 'btn-danger', 'revoked', `${displayName} sperren? Der Zugriff endet sofort, das Konto bleibt bestehen.`));
      }
      if (req.role === 'admin') {
        // Eigene Rechte und die des Hauptadmins sind nicht entziehbar (kein Aussperren)
        if (!isSelf && !bootstrap) actions.append(roleBtn('Admin-Rechte entziehen', 'member', `${displayName} die Admin-Rechte entziehen?`));
      } else {
        actions.append(roleBtn('Zum Admin machen', 'admin', `${displayName} zum Administrator machen? Kann dann Konten freigeben, sperren und Admins ernennen.`));
      }
    } else {
      actions.append(act('Freigeben', 'btn-primary', 'approved'));
    }
    if (!member && req.status !== 'rejected' && req.status !== 'revoked') {
      actions.appendChild(linkWidget(req.user_uid, displayName));
    }
    if (member) {
      const unlink = Utils.createEl('button', { className: 'btn btn-small btn-secondary', textContent: 'Profil-Verknüpfung lösen' });
      unlink.addEventListener('click', async () => {
        if (!confirm(`Verknüpfung von ${displayName} mit dem Profil „${member.firstName} ${member.lastName}“ lösen? Das Profil wird wieder Platzhalter; das Konto bleibt.`)) return;
        try {
          await DB.unclaimMember(member.id);
          App.toast('Verknüpfung gelöst', 'info');
          await App.refreshTree();
          showAdminPanel();
        } catch (err) {
          console.error('Unclaim error:', err);
          App.toast('Lösen fehlgeschlagen', 'error');
        }
      });
      actions.appendChild(unlink);
    }

    const badges = [Utils.createEl('span', { className: `status-badge ${req.status}`, textContent: STATUS_LABEL[req.status] || req.status })];
    if (req.role === 'admin' || bootstrap) badges.push(Utils.createEl('span', { className: 'status-badge admin', textContent: bootstrap ? 'Admin · fest' : 'Admin' }));
    const card = Utils.createEl('div', { className: 'admin-user-card' + (req.role === 'admin' || bootstrap ? ' is-admin' : '') }, [
      Utils.createEl('div', { className: 'user-name' }, [document.createTextNode(displayName), ...badges]),
      Utils.createEl('div', { className: 'user-email', textContent: req.email }),
      meta,
      actions,
    ]);
    card.dataset.search = [displayName, req.email, member && `${member.firstName} ${member.lastName} ${member.birthName || ''}`, STATUS_LABEL[req.status]]
      .filter(Boolean).join(' ').toLowerCase();
    return card;
  }

  function sendAdminNotification(userEmail, displayName) {
    if (!EMAILJS_PUBLIC_KEY || !EMAILJS_SERVICE_ID || !EMAILJS_TEMPLATE_ID) {
      console.log(`[ADMIN NOTIFICATION] Neue Registrierung: ${displayName} (${userEmail})`);
      console.log('EmailJS ist nicht konfiguriert. Bitte EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID und EMAILJS_TEMPLATE_ID in admin.js setzen.');
      return;
    }

    if (typeof emailjs !== 'undefined') {
      const adminUrl = window.location.origin + window.location.pathname + '#admin';
      const now = new Date().toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
      emailjs.send(EMAILJS_SERVICE_ID, EMAILJS_TEMPLATE_ID, {
        name: displayName,
        time: now,
        message: `Neue Registrierung im Stammbaum:\n\nName: ${displayName}\nE-Mail: ${userEmail}\n\nBitte prüfe und genehmige den Zugang:\n${adminUrl}`,
      }, EMAILJS_PUBLIC_KEY).then(
        () => console.log('Admin notification sent'),
        (err) => console.error('EmailJS error:', err)
      );
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    const b = document.getElementById('btn-admin-invite-save');
    if (b) b.addEventListener('click', saveInviteCode);
  });

  return {
    initEmailJS,
    getAdminEmail,
    setCurrentRole,
    isAdmin,
    updateAdminMenu,
    showAdminPanel,
    sendAdminNotification,
  };
})();
