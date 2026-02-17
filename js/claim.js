/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Claim & Auth Handlers
   Login, register, forgot/reset password, profile claiming
   ═══════════════════════════════════════════════════════════ */

const Claim = (() => {

  // ─── Auth Handlers ───

  async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) {
      App.toast('Bitte fülle alle Felder aus', 'error');
      return;
    }
    const btn = document.getElementById('btn-login');
    Utils.setButtonLoading(btn, true);
    try {
      const result = await Auth.loginWithEmail(email, password);
      if (!result.success) App.toast(result.error, 'error');
    } finally {
      Utils.setButtonLoading(btn, false);
    }
  }

  async function handleRegister() {
    const firstName = document.getElementById('reg-firstname').value.trim();
    const lastName = document.getElementById('reg-lastname').value.trim();
    const email = document.getElementById('reg-email').value.trim();
    const password = document.getElementById('reg-password').value;

    if (!firstName || !lastName || !email || !password) {
      App.toast('Bitte fülle alle Pflichtfelder aus', 'error');
      return;
    }

    const btn = document.getElementById('btn-register');
    Utils.setButtonLoading(btn, true);

    const result = await Auth.registerWithEmail(email, password, `${firstName} ${lastName}`);
    if (!result.success) {
      App.toast(result.error, 'error');
      Utils.setButtonLoading(btn, false);
      return;
    }

    // Store registration data for claim flow
    sessionStorage.setItem('reg_firstName', firstName);
    sessionStorage.setItem('reg_lastName', lastName);
    sessionStorage.setItem('reg_birthName',
      document.getElementById('reg-birthname').value.trim());

    // Auto-login after registration
    const loginResult = await Auth.loginWithEmail(email, password);
    Utils.setButtonLoading(btn, false);
    if (!loginResult.success) {
      App.toast('Registrierung erfolgreich! Bitte bestätige deine E-Mail oder melde dich an.', 'success');
    } else {
      App.toast('Willkommen! Registrierung erfolgreich.', 'success');
    }
  }

  async function handleForgotPassword() {
    const email = document.getElementById('forgot-email').value.trim();
    if (!email) {
      App.toast('Bitte gib deine E-Mail-Adresse ein', 'error');
      return;
    }
    const result = await Auth.resetPassword(email);
    if (result.success) {
      App.toast('E-Mail zum Zurücksetzen gesendet! Prüfe deinen Posteingang.', 'success');
      document.getElementById('auth-forgot').classList.add('hidden');
      document.getElementById('auth-login').classList.remove('hidden');
    } else {
      App.toast(result.error, 'error');
    }
  }

  async function handleSetNewPassword() {
    const pw = document.getElementById('new-password').value;
    const pwConfirm = document.getElementById('new-password-confirm').value;
    if (!pw || pw.length < 6) {
      App.toast('Passwort muss mindestens 6 Zeichen lang sein', 'error');
      return;
    }
    if (pw !== pwConfirm) {
      App.toast('Passwörter stimmen nicht überein', 'error');
      return;
    }
    const result = await Auth.updatePassword(pw);
    if (result.success) {
      App.toast('Passwort erfolgreich geändert!', 'success');
      document.getElementById('auth-new-password').classList.add('hidden');
      const user = Auth.getUser();
      if (user) {
        const member = await DB.findMemberByUid(user.id);
        if (member) {
          Auth.setMember(member);
          Tree.setCurrentUser(member.id);
          await App.loadTree();
          App.showView('view-main');
        } else {
          App.showView('view-claim');
        }
      } else {
        document.getElementById('auth-login').classList.remove('hidden');
      }
    } else {
      App.toast(result.error, 'error');
    }
  }

  // ─── Claim Handlers ───

  const debouncedClaimSearch = Utils.debounce(async (query) => {
    const resultsEl = document.getElementById('claim-results');
    if (query.length < 2) {
      resultsEl.innerHTML = '';
      return;
    }

    const members = await DB.searchMembers(query);
    const unclaimed = members.filter(m => !m.claimedByUid || m.isPlaceholder);

    resultsEl.innerHTML = '';

    if (unclaimed.length === 0 && query.length >= 2) {
      resultsEl.appendChild(Utils.createEl('div', {
        style: { padding: '12px', color: 'var(--text-muted)', textAlign: 'center', fontSize: '13px' },
        textContent: 'Niemand mit diesem Namen gefunden.',
      }));
    }

    for (const m of unclaimed.slice(0, 5)) {
      const yearInfo = m.birthDate ? `* ${m.birthDate.substring(0, 4)}` : '';
      const loc = m.location || '';
      const info = [yearInfo, loc].filter(Boolean).join(' \u00b7 ');

      const nameEl = Utils.createEl('div', { className: 'name', textContent: `${m.firstName} ${m.lastName}` });
      const innerDiv = Utils.createEl('div', {}, [nameEl]);
      if (info) {
        innerDiv.appendChild(Utils.createEl('div', { className: 'info', textContent: info }));
      }

      const item = Utils.createEl('div', { className: 'claim-result-item' }, [innerDiv]);
      item.dataset.id = m.id;
      item.addEventListener('click', async () => {
        try {
          const user = Auth.getUser();
          await DB.claimMember(m.id, user.id);
          const member = await DB.getMember(m.id);
          Auth.setMember(member);
          Tree.setCurrentUser(m.id);
          App.toast('Profil erfolgreich verknüpft!', 'success');
          await App.loadTree();
          App.showView('view-main');
        } catch (err) {
          console.error('Claim error:', err);
          App.toast('Fehler beim Verknüpfen', 'error');
        }
      });
      resultsEl.appendChild(item);
    }
  }, 250);

  function handleClaimSearch() {
    const query = document.getElementById('claim-search').value.trim();
    debouncedClaimSearch(query);
  }

  async function handleClaimNew() {
    const user = Auth.getUser();
    const firstName = sessionStorage.getItem('reg_firstName') ||
      user.user_metadata?.display_name?.split(' ')[0] || 'Unbekannt';
    const lastName = sessionStorage.getItem('reg_lastName') ||
      user.user_metadata?.display_name?.split(' ').slice(1).join(' ') || 'Unbekannt';
    const birthName = sessionStorage.getItem('reg_birthName') || '';

    const memberId = await DB.createMember({
      firstName,
      lastName,
      birthName,
      birthDate: '',
      deathDate: '',
      isDeceased: false,
      isPlaceholder: false,
      claimedByUid: user.id,
      createdBy: user.id,
      location: '',
      contact: user.email || '',
      photo: user.user_metadata?.avatar_url || '',
      notes: '',
    });

    const member = await DB.getMember(memberId);
    Auth.setMember(member);
    Tree.setCurrentUser(memberId);

    sessionStorage.removeItem('reg_firstName');
    sessionStorage.removeItem('reg_lastName');
    sessionStorage.removeItem('reg_birthName');

    App.toast('Willkommen im Stammbaum!', 'success');
    await App.loadTree();
    App.showView('view-main');
  }

  return {
    handleLogin,
    handleRegister,
    handleForgotPassword,
    handleSetNewPassword,
    handleClaimSearch,
    handleClaimNew,
  };
})();
