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
  async function showAdminPanel() {
    App.showView('view-admin-approve');
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
        if (key === 'approved') el.appendChild(adminCard());   // der Admin selbst, ohne Antragszeile
        if (!groups[key].length && key !== 'approved') {
          el.appendChild(Utils.createEl('p', { style: { color: 'var(--text-muted)', fontSize: '13px' }, textContent: key === 'pending' ? 'Keine offenen Anträge.' : 'Niemand.' }));
          continue;
        }
        for (const r of groups[key]) el.appendChild(userCard(r, claimedBy.get(r.user_uid)));
      }
      const summary = document.getElementById('admin-summary');
      if (summary) summary.textContent = `${rows.length + 1} Konten · ${groups.approved.length + 1} mit Zugriff · ${groups.pending.length} offen`;
    } catch (err) {
      console.error('Admin panel error:', err);
      for (const el of Object.values(lists)) {
        el.innerHTML = '';
        el.appendChild(Utils.createEl('p', { style: { color: 'var(--red)', fontSize: '13px' }, textContent: 'Fehler beim Laden.' }));
      }
    }
  }

  function adminCard() {
    const me = Auth.getUser();
    const myMember = Auth.getMember();
    const meta = Utils.createEl('div', { className: 'user-meta' });
    meta.append('Administrator (fest hinterlegt) · ');
    if (myMember) meta.appendChild(profileLink(myMember)); else meta.append('kein Profil verknüpft');
    return Utils.createEl('div', { className: 'admin-user-card is-admin' }, [
      Utils.createEl('div', { className: 'user-name' }, [
        document.createTextNode(myMember ? `${myMember.firstName} ${myMember.lastName}` : 'Admin'),
        Utils.createEl('span', { className: 'status-badge approved', textContent: 'Admin' }),
      ]),
      Utils.createEl('div', { className: 'user-email', textContent: me?.email || ADMIN_EMAIL }),
      meta,
    ]);
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
    if (req.status === 'pending') {
      actions.append(act('Freigeben', 'btn-primary', 'approved'), act('Ablehnen', 'btn-danger', 'rejected', `${displayName} wirklich ablehnen?`));
    } else if (req.status === 'approved') {
      actions.append(act('Sperren', 'btn-danger', 'revoked', `${displayName} sperren? Der Zugriff endet sofort, das Konto bleibt bestehen.`));
    } else {
      actions.append(act('Freigeben', 'btn-primary', 'approved'));
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

    return Utils.createEl('div', { className: 'admin-user-card' }, [
      Utils.createEl('div', { className: 'user-name' }, [
        document.createTextNode(displayName),
        Utils.createEl('span', { className: `status-badge ${req.status}`, textContent: STATUS_LABEL[req.status] || req.status }),
      ]),
      Utils.createEl('div', { className: 'user-email', textContent: req.email }),
      meta,
      actions,
    ]);
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

  return {
    initEmailJS,
    getAdminEmail,
    updateAdminMenu,
    showAdminPanel,
    sendAdminNotification,
  };
})();
