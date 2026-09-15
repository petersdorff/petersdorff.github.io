/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Familientag-Modus (Gast ohne Konto)
   Identität wählen statt registrieren. Zugang nur mit dem
   Familientag-Code (zeitlich begrenzt); der Baum kommt lesend aus der
   Datenbank (guest_graph), nichts liegt mehr öffentlich im Repo.
   ═══════════════════════════════════════════════════════════ */

const Guest = (() => {
  const STORAGE_KEY = 'stammbaum_guestMemberId';
  const CODE_KEY = 'stammbaum_guestCode';
  let active = false;

  function getStoredCode() {
    try { return localStorage.getItem(CODE_KEY) || ''; } catch { return ''; }
  }
  function storeCode(code) {
    try {
      if (code) localStorage.setItem(CODE_KEY, code);
      else localStorage.removeItem(CODE_KEY);
    } catch { /* private mode */ }
  }
  function hasStoredCode() { return !!getStoredCode(); }

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
   * Gastmodus betreten (lesend). Ohne Konto, ohne Freigabe — aber nur mit
   * gültigem Familientag-Code: der Baum wird per guest_graph(code) geladen.
   * Ohne Code-Argument wird der gespeicherte Code versucht; fehlt er oder
   * ist er abgelaufen, erscheint die Code-Abfrage auf der Login-Seite.
   * Gibt true zurück, wenn der Gastmodus aktiv ist.
   */
  async function enter(code) {
    const useCode = (code || getStoredCode()).trim();
    if (!useCode) { showCodePrompt(); return false; }
    App.showView('loading-screen');
    try {
      await DB.loadGuestGraph(useCode);
    } catch (err) {
      App.showView('view-auth');
      if (String(err.message) === 'invalid_code') {
        storeCode(null);
        App.toast('Familientag-Code ungültig oder abgelaufen', 'error');
        showCodePrompt();
      } else {
        console.error('[Guest] guest_graph:', err);
        App.toast('Server nicht erreichbar – bitte später noch einmal versuchen', 'error');
      }
      return false;
    }
    storeCode(useCode);
    active = true;
    DB.setOffline(true);
    DB.logEvent('guest_open');
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
      if (Fan.isActive()) Fan.centerOn(member.id); else Tree.centerOn(member.id, 0.9, false);
      Connection.resolvePendingConnect();
    } else {
      showIdentityPicker();
    }
    return true;
  }

  /** Code-Feld unter dem Familientag-Knopf auf der Login-Seite einblenden. */
  function showCodePrompt() {
    App.showView('view-auth');
    const box = document.getElementById('guest-code-box');
    if (!box) return;
    box.classList.remove('hidden');
    const input = document.getElementById('guest-code');
    setTimeout(() => input && input.focus(), 150);
  }

  async function submitCode() {
    const input = document.getElementById('guest-code');
    const code = (input ? input.value : '').trim();
    if (!code) { App.toast('Bitte den Familientag-Code eingeben', 'error'); return; }
    await enter(code);
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
    if (Fan.isActive()) Fan.centerOn(member.id); else Tree.centerOn(member.id, 0.9, false);
    Connection.resolvePendingConnect();
  }

  function skipIdentity() {
    storeIdentityId(null);
    Auth.setMember(null);
    Tree.setCurrentUser(null);
    App.showView('view-main');
    App.applyReadOnlyUI();
    App.refreshTreeHighlight();
    if (Fan.isActive()) Fan.fit(); else Tree.fitAll();
  }

  function exit() {
    active = false;
    DB.setOffline(false);
    storeIdentityId(null); // don't auto-resume after explicit exit
    storeCode(null);
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
    hasStoredCode,
    showCodePrompt,
    submitCode,
    enter,
    showIdentityPicker,
    handleSearchInput,
    pickIdentity,
    skipIdentity,
    exit,
  };
})();
