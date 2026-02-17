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

  async function showAdminPanel() {
    const listEl = document.getElementById('admin-pending-list');
    listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Lade...</p>';
    App.showView('view-admin-approve');

    try {
      const pending = await DB.getPendingApprovals();
      if (pending.length === 0) {
        listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;text-align:center;">Keine ausstehenden Anfragen.</p>';
        return;
      }

      listEl.innerHTML = '';
      for (const req of pending) {
        const displayName = req.display_name || 'Unbekannt';
        const dateStr = new Date(req.created_at).toLocaleDateString('de-DE');

        const btnApprove = Utils.createEl('button', { className: 'btn btn-primary btn-small', textContent: 'Freigeben' });
        const btnReject = Utils.createEl('button', { className: 'btn btn-danger btn-small', textContent: 'Ablehnen' });

        const card = Utils.createEl('div', { className: 'admin-user-card' }, [
          Utils.createEl('div', { className: 'user-name', textContent: displayName }),
          Utils.createEl('div', { className: 'user-email', textContent: req.email }),
          Utils.createEl('div', {
            className: 'user-date',
            style: { fontSize: '11px', color: 'var(--text-muted)', marginBottom: '8px' },
            textContent: `Registriert: ${dateStr}`,
          }),
          Utils.createEl('div', { className: 'admin-actions' }, [btnApprove, btnReject]),
        ]);

        btnApprove.addEventListener('click', async () => {
          const adminUser = Auth.getUser();
          await DB.approveUser(req.id, adminUser.id);
          App.toast(`${displayName} freigeschaltet`, 'success');
          showAdminPanel();
        });

        btnReject.addEventListener('click', async () => {
          if (!confirm(`${displayName} wirklich ablehnen?`)) return;
          const adminUser = Auth.getUser();
          await DB.rejectUser(req.id, adminUser.id);
          App.toast(`${displayName} abgelehnt`, 'info');
          showAdminPanel();
        });

        listEl.appendChild(card);
      }
    } catch (err) {
      console.error('Admin panel error:', err);
      listEl.innerHTML = '';
      listEl.appendChild(Utils.createEl('p', {
        style: { color: 'var(--red)', fontSize: '13px' },
        textContent: 'Fehler beim Laden.',
      }));
    }
  }

  /**
   * Send email notification to admin about new registration.
   * Uses EmailJS (free tier) if configured, otherwise logs to console.
   */
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
