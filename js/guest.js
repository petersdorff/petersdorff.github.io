/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Familientag-Modus (Gast ohne Konto)
   Identität wählen statt registrieren; funktioniert komplett
   offline über den gebündelten Daten-Snapshot.
   ═══════════════════════════════════════════════════════════ */

const Guest = (() => {
  const STORAGE_KEY = 'stammbaum_guestMemberId';
  let active = false;

  function isActive() {
    return active;
  }

  function getStoredIdentityId() {
    try { return localStorage.getItem(STORAGE_KEY); } catch { return null; }
  }

  function storeIdentityId(memberId) {
    try {
      if (memberId) localStorage.setItem(STORAGE_KEY, memberId);
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* private mode */ }
  }

  /**
   * Enter guest mode: read-only view on the bundled snapshot.
   * Works without backend, without account, without approval.
   */
  async function enter() {
    if (!DB.snapshotAvailable()) {
      App.toast('Keine lokalen Daten verfügbar', 'error');
      return;
    }
    active = true;
    DB.setOffline(true);

    App.showView('loading-screen');
    await App.loadTree();

    // Restore previously chosen identity if it still exists
    const storedId = getStoredIdentityId();
    const member = storedId
      ? App.getCachedMembers().find(m => m.id === storedId)
      : null;

    if (member) {
      Auth.setMember(member);
      Tree.setCurrentUser(member.id);
      App.showView('view-main');
      App.applyReadOnlyUI();
      App.refreshTreeHighlight();
      Tree.centerOn(member.id, 0.9, false);
      Connection.resolvePendingConnect();
    } else {
      showIdentityPicker();
    }
  }

  /**
   * "Wer bist du?" – choose your own entry from the family list.
   */
  function showIdentityPicker() {
    const input = document.getElementById('whoami-search');
    input.value = '';
    renderResults('');
    App.showView('view-whoami');
    // Focus after view transition
    setTimeout(() => input.focus(), 250);
  }

  function handleSearchInput() {
    renderResults(document.getElementById('whoami-search').value.trim());
  }

  function renderResults(query) {
    const resultsEl = document.getElementById('whoami-results');
    resultsEl.innerHTML = '';

    const members = App.getCachedMembers()
      .filter(m => !m.isDeceased);
    const q = query.toLowerCase();
    const matches = (q.length === 0
      ? [] // don't show the full list unprompted — type at least a letter
      : members.filter(m =>
          `${m.firstName} ${m.lastName} ${m.birthName || ''}`.toLowerCase().includes(q))
    ).slice(0, 8);

    if (q.length === 0) {
      resultsEl.appendChild(Utils.createEl('div', {
        className: 'whoami-hint',
        textContent: 'Tippe deinen Vor- oder Nachnamen ein.',
      }));
      return;
    }

    if (matches.length === 0) {
      resultsEl.appendChild(Utils.createEl('div', {
        className: 'whoami-hint',
        textContent: 'Niemand gefunden. Du kannst auch unten ohne Auswahl fortfahren.',
      }));
      return;
    }

    for (const m of matches) {
      const yearInfo = m.birthDate ? `* ${m.birthDate.substring(0, 4)}` : '';
      const sub = [yearInfo, m.birthName].filter(Boolean).join(' · ');
      const nameEl = Utils.createEl('div', { className: 'name', textContent: `${m.firstName} ${m.lastName}` });
      const inner = Utils.createEl('div', {}, [nameEl]);
      if (sub) inner.appendChild(Utils.createEl('div', { className: 'info', textContent: sub }));
      const item = Utils.createEl('div', { className: 'claim-result-item' }, [inner]);
      item.addEventListener('click', () => pickIdentity(m));
      resultsEl.appendChild(item);
    }
  }

  function pickIdentity(member) {
    storeIdentityId(member.id);
    Auth.setMember(member);
    Tree.setCurrentUser(member.id);
    App.toast(`Willkommen, ${member.firstName}!`, 'success');
    App.showView('view-main');
    App.applyReadOnlyUI();
    App.refreshTreeHighlight();
    Tree.centerOn(member.id, 0.9, false);
    Connection.resolvePendingConnect();
  }

  function skipIdentity() {
    storeIdentityId(null);
    Auth.setMember(null);
    Tree.setCurrentUser(null);
    App.showView('view-main');
    App.applyReadOnlyUI();
    Tree.fitAll();
  }

  function exit() {
    active = false;
    DB.setOffline(false);
    storeIdentityId(null); // don't auto-resume after explicit exit
    Auth.setMember(null);
    Tree.setCurrentUser(null);
    App.showView('view-auth');
  }

  function hasStoredIdentity() {
    return !!getStoredIdentityId();
  }

  return {
    isActive,
    hasStoredIdentity,
    enter,
    showIdentityPicker,
    handleSearchInput,
    pickIdentity,
    skipIdentity,
    exit,
  };
})();
