/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Main App Controller (Supabase)
   ═══════════════════════════════════════════════════════════ */

const App = (() => {
  // ─── Supabase Config ───
  const SUPABASE_URL = 'https://ixdcyoivtapglllmwvut.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4ZGN5b2l2dGFwZ2xsbG13dnV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNDQwMzcsImV4cCI6MjA4NjcyMDAzN30.9bwk1HrmsWz6Hk5RxqnpZiqt7-0YhNjzyev_tpIwLqU';

  // Admin email — this user can approve/reject new registrations
  const ADMIN_EMAIL = 'kaivonpetersdorff@me.com';

  // Email to receive approval notifications
  const NOTIFICATION_EMAIL = 'kaivonpetersdorff@gmail.com';

  // EmailJS config (free tier, client-side emails)
  const EMAILJS_PUBLIC_KEY = 'DUarAtNJocWYAECRq';
  const EMAILJS_SERVICE_ID = 'service_ml2fcxt';
  const EMAILJS_TEMPLATE_ID = 'template_6fcntlg';

  let cachedMembers = [];
  let cachedRelationships = [];
  let isInitialized = false;
  let authHandled = false; // Prevent duplicate auth processing on page load

  // ─── Initialize ───

  async function init() {
    // Init Supabase client
    const { createClient } = window.supabase;
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Init modules
    DB.init(supabaseClient);
    Search.init();
    Tree.init('tree-container');

    // Init EmailJS
    if (typeof emailjs !== 'undefined' && EMAILJS_PUBLIC_KEY) {
      emailjs.init(EMAILJS_PUBLIC_KEY);
    }

    // Register auth state listener BEFORE Auth.init() so we don't miss
    // the initial onAuthStateChange event that fires immediately
    Auth.onAuthChange(async (user, member, event) => {
      // Ignore token refreshes (tab regaining focus) – not a real login
      if (event === 'TOKEN_REFRESHED') {
        return;
      }

      // On page load, checkSession (event=undefined) and onAuthStateChange
      // (event=SIGNED_IN) both fire. Deduplicate but always run approval check.
      if (isInitialized && event === 'SIGNED_IN' && authHandled) {
        return;
      }
      authHandled = true;

      if (user) {
        // Check approval status (admin bypasses)
        const isAdmin = user.email === ADMIN_EMAIL;

        if (!isAdmin) {
          try {
            const approval = await DB.getApprovalStatus(user.id);
            if (!approval) {
              // No approval request exists — create one
              const displayName = user.user_metadata?.display_name || user.email || '';
              await DB.createApprovalRequest(user.id, user.email, displayName);
              sendAdminNotification(user.email, displayName);
              showView('view-pending');
              return;
            }
            if (approval.status === 'pending') {
              showView('view-pending');
              return;
            }
            if (approval.status === 'rejected') {
              toast('Dein Zugang wurde abgelehnt. Bitte kontaktiere den Administrator.', 'error');
              showView('view-pending');
              return;
            }
            // approval.status === 'approved' → continue normally
          } catch (err) {
            console.error('[App] Approval check failed:', err);
            showView('view-pending');
            return;
          }
        }

        if (member) {
          // User has a linked profile → go to tree
          Tree.setCurrentUser(member.id);
          await loadTree();
          showView('view-main');
          updateAdminMenu(isAdmin);
        } else {
          // User logged in but no profile → claim flow
          showView('view-claim');
        }
      } else {
        // Not logged in — reset authHandled so next login triggers properly
        authHandled = false;
        showView('view-auth');
      }
    });

    // Listen for password recovery event (user clicked reset link in email)
    Auth.onPasswordRecovery(() => {
      // Show the "set new password" form
      document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
      document.getElementById('auth-new-password').classList.remove('hidden');
      showView('view-auth');
    });

    // Now init auth – this triggers onAuthStateChange immediately
    Auth.init(supabaseClient);

    // Bind UI events
    bindEvents();

    // Handle deep links (e.g. #connect/MEMBER_ID)
    handleDeepLink();

    isInitialized = true;
  }

  // ─── Event Bindings ───

  function bindEvents() {
    // Auth - Login
    document.getElementById('btn-login').addEventListener('click', handleLogin);
    document.getElementById('show-register').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('auth-login').classList.add('hidden');
      document.getElementById('auth-register').classList.remove('hidden');
    });

    // Auth - Forgot Password
    document.getElementById('show-forgot').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('auth-login').classList.add('hidden');
      document.getElementById('auth-forgot').classList.remove('hidden');
    });
    document.getElementById('show-login-from-forgot').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('auth-forgot').classList.add('hidden');
      document.getElementById('auth-login').classList.remove('hidden');
    });
    document.getElementById('btn-forgot-send').addEventListener('click', handleForgotPassword);
    document.getElementById('forgot-email').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleForgotPassword();
    });

    // Auth - Set New Password (after clicking reset link in email)
    document.getElementById('btn-set-new-password').addEventListener('click', handleSetNewPassword);
    document.getElementById('new-password-confirm').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleSetNewPassword();
    });

    // Auth - Register
    document.getElementById('btn-register').addEventListener('click', handleRegister);
    document.getElementById('show-login').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('auth-register').classList.add('hidden');
      document.getElementById('auth-login').classList.remove('hidden');
    });

    // Enter key on login fields
    document.getElementById('login-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleLogin();
    });
    document.getElementById('reg-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleRegister();
    });

    // Claim view
    document.getElementById('claim-search').addEventListener('input', handleClaimSearch);
    document.getElementById('btn-claim-new').addEventListener('click', handleClaimNew);

    // Top bar
    document.getElementById('btn-menu').addEventListener('click', openMenu);
    document.getElementById('btn-view-toggle').addEventListener('click', handleViewToggle);
    document.getElementById('btn-scan').addEventListener('click', openScanner);

    // Restore toggle button state from current view mode
    updateToggleButton();

    // FABs
    document.getElementById('fab-add').addEventListener('click', () => Profile.edit(null));
    document.getElementById('fab-myqr').addEventListener('click', showMyQR);
    document.getElementById('fab-center').addEventListener('click', centerOnMe);

    // Profile view
    document.getElementById('btn-profile-back').addEventListener('click', () => {
      const profileView = document.getElementById('view-profile');
      // If in side panel mode, just close it
      if (profileView.classList.contains('side-panel')) {
        profileView.classList.remove('side-panel', 'active');
        profileView.style.display = '';
        return;
      }
      showView('view-main');
    });
    document.getElementById('btn-profile-edit').addEventListener('click', () => {
      Profile.edit(Profile.getCurrentProfileId());
    });
    document.getElementById('btn-show-connection').addEventListener('click', showConnectionToMe);
    document.getElementById('btn-show-qr').addEventListener('click', () => {
      const profileId = Profile.getCurrentProfileId();
      if (profileId) {
        QR.generate('qr-code-canvas', profileId);
        showView('view-qr');
      }
    });
    document.getElementById('btn-show-in-tree').addEventListener('click', () => {
      const profileId = Profile.getCurrentProfileId();
      if (profileId) {
        showView('view-main');
        setTimeout(() => Tree.centerOn(profileId), 300);
      }
    });

    // Edit view
    document.getElementById('btn-edit-cancel').addEventListener('click', () => {
      const profileId = Profile.getEditingMemberId();
      if (profileId) {
        Profile.show(profileId);
      } else {
        showView('view-main');
      }
    });
    document.getElementById('btn-edit-save').addEventListener('click', Profile.save);
    const debouncedRelSearch = Utils.debounce((query) => {
      Profile.searchForRelation(query);
    }, 200);
    document.getElementById('edit-rel-search').addEventListener('input', (e) => {
      debouncedRelSearch(e.target.value.trim());
    });
    document.getElementById('btn-add-relation').addEventListener('click', Profile.addRelation);
    // Rel type change — update pending display for new person mode
    document.getElementById('edit-rel-type').addEventListener('change', () => {
      if (!Profile.getEditingMemberId()) Profile.updatePendingRelDisplay();
    });

    // QR views
    document.getElementById('btn-qr-back').addEventListener('click', () => showView('view-main'));
    document.getElementById('btn-scanner-back').addEventListener('click', () => {
      QR.stopScanner();
      showView('view-main');
    });

    // Connection overlay
    document.getElementById('close-connection').addEventListener('click', closeConnection);

    // Delete placeholder member
    document.getElementById('btn-delete-member').addEventListener('click', handleDeleteMember);

    // Side menu
    document.getElementById('menu-backdrop').addEventListener('click', closeMenu);
    document.getElementById('menu-tree').addEventListener('click', (e) => {
      e.preventDefault(); closeMenu(); showView('view-main');
    });
    document.getElementById('menu-profile').addEventListener('click', (e) => {
      e.preventDefault(); closeMenu();
      const member = Auth.getMember();
      if (member) Profile.show(member.id);
    });
    document.getElementById('menu-qr').addEventListener('click', (e) => {
      e.preventDefault(); closeMenu(); showMyQR();
    });
    document.getElementById('menu-scan').addEventListener('click', (e) => {
      e.preventDefault(); closeMenu(); openScanner();
    });
    document.getElementById('menu-logout').addEventListener('click', (e) => {
      e.preventDefault(); closeMenu(); Auth.logout();
    });
    document.getElementById('menu-admin').addEventListener('click', (e) => {
      e.preventDefault(); closeMenu(); showAdminPanel();
    });

    // Pending approval – refresh status / logout
    document.getElementById('btn-pending-refresh').addEventListener('click', async () => {
      const user = Auth.getUser();
      if (!user) return;
      try {
        const approval = await DB.getApprovalStatus(user.id);
        if (approval && approval.status === 'approved') {
          toast('Zugang freigeschaltet!');
          window.location.reload();
        } else {
          toast('Dein Zugang wird noch geprüft…');
        }
      } catch (err) {
        toast('Fehler beim Prüfen. Bitte versuche es nochmal.', 'error');
      }
    });
    document.getElementById('btn-pending-logout').addEventListener('click', () => Auth.logout());

    // Admin panel back button
    document.getElementById('btn-admin-back').addEventListener('click', () => showView('view-main'));

    // Tree node tap
    Tree.onNodeTap((nodeId) => {
      Profile.show(nodeId);
    });

    // Tree background tap — close overlays and side panels
    Tree.onBackgroundTap(() => {
      closeConnection();
      // Close profile side panel if open
      const profileView = document.getElementById('view-profile');
      if (profileView.classList.contains('side-panel')) {
        profileView.classList.remove('side-panel', 'active');
        profileView.style.display = '';
      }
    });
  }

  // ─── Auth Handlers ───

  async function handleLogin() {
    const email = document.getElementById('login-email').value.trim();
    const password = document.getElementById('login-password').value;
    if (!email || !password) {
      toast('Bitte f\u00fclle alle Felder aus', 'error');
      return;
    }
    const btn = document.getElementById('btn-login');
    Utils.setButtonLoading(btn, true);
    try {
      const result = await Auth.loginWithEmail(email, password);
      if (!result.success) toast(result.error, 'error');
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
      toast('Bitte f\u00fclle alle Pflichtfelder aus', 'error');
      return;
    }

    const btn = document.getElementById('btn-register');
    Utils.setButtonLoading(btn, true);

    const result = await Auth.registerWithEmail(email, password, `${firstName} ${lastName}`);
    if (!result.success) {
      toast(result.error, 'error');
      Utils.setButtonLoading(btn, false);
      return;
    }

    // Store registration data for claim flow
    sessionStorage.setItem('reg_firstName', firstName);
    sessionStorage.setItem('reg_lastName', lastName);
    sessionStorage.setItem('reg_birthName',
      document.getElementById('reg-birthname').value.trim());

    // Auto-login after registration: Supabase signUp may already create a session,
    // but if email confirmation is required, we try to sign in explicitly.
    // The onAuthStateChange listener will handle the rest.
    const loginResult = await Auth.loginWithEmail(email, password);
    Utils.setButtonLoading(btn, false);
    if (!loginResult.success) {
      toast('Registrierung erfolgreich! Bitte best\u00e4tige deine E-Mail oder melde dich an.', 'success');
    } else {
      toast('Willkommen! Registrierung erfolgreich.', 'success');
    }
  }

  async function handleForgotPassword() {
    const email = document.getElementById('forgot-email').value.trim();
    if (!email) {
      toast('Bitte gib deine E-Mail-Adresse ein', 'error');
      return;
    }
    const result = await Auth.resetPassword(email);
    if (result.success) {
      toast('E-Mail zum Zurücksetzen gesendet! Prüfe deinen Posteingang.', 'success');
      // Switch back to login form
      document.getElementById('auth-forgot').classList.add('hidden');
      document.getElementById('auth-login').classList.remove('hidden');
    } else {
      toast(result.error, 'error');
    }
  }

  async function handleSetNewPassword() {
    const pw = document.getElementById('new-password').value;
    const pwConfirm = document.getElementById('new-password-confirm').value;
    if (!pw || pw.length < 6) {
      toast('Passwort muss mindestens 6 Zeichen lang sein', 'error');
      return;
    }
    if (pw !== pwConfirm) {
      toast('Passwörter stimmen nicht überein', 'error');
      return;
    }
    const result = await Auth.updatePassword(pw);
    if (result.success) {
      toast('Passwort erfolgreich geändert!', 'success');
      // Hide form
      document.getElementById('auth-new-password').classList.add('hidden');
      // Recovery mode is now cleared inside Auth.updatePassword().
      // The user is already signed in (Supabase signed them in via recovery token).
      // Trigger the normal auth flow to navigate them into the app.
      const user = Auth.getUser();
      if (user) {
        const member = await DB.findMemberByUid(user.id);
        if (member) {
          Auth.setMember(member);
          Tree.setCurrentUser(member.id);
          await loadTree();
          showView('view-main');
        } else {
          showView('view-claim');
        }
      } else {
        // Shouldn't happen, but fallback to login
        document.getElementById('auth-login').classList.remove('hidden');
      }
    } else {
      toast(result.error, 'error');
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
          toast('Profil erfolgreich verkn\u00fcpft!', 'success');
          await loadTree();
          showView('view-main');
        } catch (err) {
          console.error('Claim error:', err);
          toast('Fehler beim Verkn\u00fcpfen', 'error');
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

    // Clear session storage
    sessionStorage.removeItem('reg_firstName');
    sessionStorage.removeItem('reg_lastName');
    sessionStorage.removeItem('reg_birthName');

    toast('Willkommen im Stammbaum!', 'success');
    await loadTree();
    showView('view-main');
  }

  // ─── Tree Loading ───

  async function loadTree() {
    try {
      const { members, relationships } = await DB.getFullGraph();
      cachedMembers = members;
      cachedRelationships = relationships;

      // Seed demo data if empty
      if (members.length === 0) {
        toast('Demo-Daten werden geladen...', 'info');
        await DB.seedDemoData();
        const data = await DB.getFullGraph();
        cachedMembers = data.members;
        cachedRelationships = data.relationships;
      }

      Tree.render(cachedMembers, cachedRelationships);
      Search.setMembers(cachedMembers);

      // Update menu
      updateMenuUser();
    } catch (err) {
      console.error('Load tree error:', err);
      toast('Fehler beim Laden des Stammbaums', 'error');
    }
  }

  async function refreshTree() {
    await loadTree();
  }

  // ─── View Management ───

  function showView(viewId) {
    const isDesktop = window.innerWidth >= 600;
    const profileView = document.getElementById('view-profile');

    // If showing profile on desktop → side panel mode (don't hide tree)
    if (viewId === 'view-profile' && isDesktop) {
      // First: deactivate ALL views except main and profile
      document.querySelectorAll('.view').forEach(v => {
        if (v.id !== 'view-main' && v.id !== 'view-profile') {
          v.classList.remove('active');
        }
      });
      profileView.classList.add('side-panel', 'active');
      profileView.style.display = 'flex';
      // Keep tree visible
      document.getElementById('view-main').classList.add('active');
      return;
    }

    // Otherwise: close profile side panel if open
    if (profileView) {
      profileView.classList.remove('side-panel');
      profileView.style.display = '';
    }

    document.querySelectorAll('.view').forEach(v => {
      v.classList.remove('active');
    });
    const view = document.getElementById(viewId);
    if (view) {
      view.classList.add('active');
    }
  }

  // ─── Menu ───

  function openMenu() {
    document.getElementById('side-menu').classList.remove('hidden');
  }

  function closeMenu() {
    document.getElementById('side-menu').classList.add('hidden');
  }

  function updateMenuUser() {
    const member = Auth.getMember();
    const user = Auth.getUser();

    const nameEl = document.getElementById('menu-name');
    const emailEl = document.getElementById('menu-email');
    const photoEl = document.getElementById('menu-photo');

    if (member) {
      nameEl.textContent = `${member.firstName} ${member.lastName}`;
      emailEl.textContent = user?.email || '';

      if (member.photo) {
        photoEl.innerHTML = '';
        const img = Utils.createEl('img', { src: member.photo, alt: '' });
        photoEl.appendChild(img);
      } else {
        const initials = `${member.firstName[0]}${member.lastName[0]}`.toUpperCase();
        photoEl.textContent = initials;
      }
    } else if (user) {
      const displayName = user.user_metadata?.display_name || user.email || 'Unbekannt';
      nameEl.textContent = displayName;
      emailEl.textContent = user.email || '';
      photoEl.textContent = (displayName || 'U')[0];
    }
  }

  // ─── QR & Scanner ───

  function showMyQR() {
    const member = Auth.getMember();
    if (!member) {
      toast('Bitte verknüpfe zuerst dein Profil', 'error');
      return;
    }
    QR.generate('qr-code-canvas', member.id);
    showView('view-qr');
  }

  function openScanner() {
    showView('view-scanner');
    QR.startScanner('qr-reader', handleQRScanned);
  }

  async function handleQRScanned(memberId) {
    toast('QR-Code erkannt!', 'success');

    // Verify the member exists — try cache first, then fresh DB lookup
    let member = cachedMembers.find(m => m.id === memberId);
    if (!member) {
      member = await DB.getMember(memberId);
      if (!member) {
        toast('Person nicht im Stammbaum gefunden', 'error');
        showView('view-main');
        return;
      }
      // Refresh tree to include this member in cache
      await loadTree();
    }

    // Show connection between me and scanned person
    const myMember = Auth.getMember();
    if (!myMember) {
      Profile.show(memberId);
      return;
    }

    showView('view-main');
    await showConnectionOverlay(myMember.id, memberId);
  }

  // ─── Connection Feature ───

  async function showConnectionToMe() {
    const profileId = Profile.getCurrentProfileId();
    const myMember = Auth.getMember();
    if (!profileId || !myMember) return;

    showView('view-main');
    await showConnectionOverlay(myMember.id, profileId);
  }

  async function showConnectionOverlay(fromId, toId) {
    const memberA = cachedMembers.find(m => m.id === fromId);
    const memberB = cachedMembers.find(m => m.id === toId);

    if (!memberA || !memberB) {
      toast('Person nicht im Stammbaum gefunden', 'error');
      return;
    }

    // Calculate connection
    const connection = Relationship.getConnection(
      fromId, toId, cachedMembers, cachedRelationships
    );

    // Fill overlay
    const personA = document.getElementById('conn-person-a');
    const personB = document.getElementById('conn-person-b');
    const relationEl = document.getElementById('conn-relation');
    const dnaEl = document.getElementById('conn-dna');
    const pathEl = document.getElementById('conn-path');

    personA.innerHTML = '';
    personA.appendChild(Utils.createEl('div', { className: 'conn-avatar', textContent: getInitials(memberA) }));
    personA.appendChild(Utils.createEl('div', { className: 'conn-name', textContent: memberA.firstName }));

    personB.innerHTML = '';
    personB.appendChild(Utils.createEl('div', { className: 'conn-avatar', textContent: getInitials(memberB) }));
    personB.appendChild(Utils.createEl('div', { className: 'conn-name', textContent: memberB.firstName }));

    const ancestorEl = document.getElementById('conn-ancestor');

    relationEl.textContent = connection.term || 'Unbekannt';
    dnaEl.textContent = connection.sharedDNA ? `~${connection.sharedDNA}%` : '—';
    pathEl.textContent = connection.pathLength !== null
      ? `${connection.pathLength} Verbindung${connection.pathLength !== 1 ? 'en' : ''}`
      : 'Kein Pfad';
    ancestorEl.textContent = connection.commonAncestor || '—';

    // Show overlay
    document.getElementById('connection-overlay').classList.remove('hidden');

    // Highlight path in tree
    Tree.highlightConnection(fromId, toId);
  }

  function closeConnection() {
    document.getElementById('connection-overlay').classList.add('hidden');
    Tree.clearHighlight();
  }

  async function handleDeleteMember() {
    const memberId = Profile.getCurrentProfileId();
    if (!memberId) return;

    const member = cachedMembers.find(m => m.id === memberId);
    if (!member) return;

    // Safety: only allow deleting true placeholders (not claimed)
    if (!member.isPlaceholder || member.claimedByUid) {
      toast('Nur nicht-registrierte Platzhalter können gelöscht werden', 'error');
      return;
    }

    const name = `${member.firstName} ${member.lastName}`;
    if (!confirm(`"${name}" wirklich löschen?\n\nAlle Verbindungen dieser Person werden ebenfalls entfernt.`)) {
      return;
    }

    try {
      await DB.deleteMember(memberId);
      toast(`${name} gelöscht`, 'success');
      await loadTree();
      showView('view-main');
    } catch (err) {
      console.error('Delete error:', err);
      toast('Fehler beim Löschen', 'error');
    }
  }

  // ─── View Toggle ───

  function handleViewToggle() {
    const current = Tree.getViewMode();
    const next = current === 'generational' ? 'temporal' : 'generational';
    Tree.setViewMode(next);
    updateToggleButton();
  }

  function updateToggleButton() {
    const btn = document.getElementById('btn-view-toggle');
    if (!btn) return;
    const mode = Tree.getViewMode();
    if (mode === 'temporal') {
      btn.classList.add('mode-temporal');
      btn.title = 'Zeitliche Ansicht aktiv – klicken für Generationen-Ansicht';
    } else {
      btn.classList.remove('mode-temporal');
      btn.title = 'Generationen-Ansicht aktiv – klicken für zeitliche Ansicht';
    }
  }

  function centerOnMe() {
    const member = Auth.getMember();
    if (member) {
      Tree.centerOn(member.id);
    } else {
      Tree.fitAll();
    }
  }

  // ─── Deep Links ───

  function handleDeepLink() {
    const hash = window.location.hash;
    if (hash.startsWith('#connect/')) {
      const memberId = hash.replace('#connect/', '');
      // Wait for auth, then show connection
      const checkAuth = setInterval(() => {
        const myMember = Auth.getMember();
        if (myMember) {
          clearInterval(checkAuth);
          showConnectionOverlay(myMember.id, memberId);
        }
      }, 500);
      // Timeout after 10 seconds
      setTimeout(() => clearInterval(checkAuth), 10000);
    } else if (hash === '#admin') {
      // Admin deep link — wait for auth, then show admin panel
      const checkAdmin = setInterval(() => {
        const user = Auth.getUser();
        if (user) {
          clearInterval(checkAdmin);
          if (user.email === ADMIN_EMAIL) {
            showAdminPanel();
          }
          window.location.hash = '';
        }
      }, 500);
      setTimeout(() => clearInterval(checkAdmin), 10000);
    }
  }

  // ─── Toast Notifications ───

  function toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const el = document.createElement('div');
    el.className = `toast ${type}`;
    el.textContent = message;
    container.appendChild(el);

    setTimeout(() => {
      el.classList.add('out');
      setTimeout(() => el.remove(), 200);
    }, 3000);
  }

  // ─── Admin Functions ───

  function updateAdminMenu(isAdmin) {
    const adminItem = document.getElementById('menu-admin-item');
    if (adminItem) {
      adminItem.style.display = isAdmin ? '' : 'none';
    }
  }

  async function showAdminPanel() {
    const listEl = document.getElementById('admin-pending-list');
    listEl.innerHTML = '<p style="color:var(--text-muted);font-size:13px;">Lade...</p>';
    showView('view-admin-approve');

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
          toast(`${displayName} freigeschaltet`, 'success');
          showAdminPanel();
        });

        btnReject.addEventListener('click', async () => {
          if (!confirm(`${displayName} wirklich ablehnen?`)) return;
          const adminUser = Auth.getUser();
          await DB.rejectUser(req.id, adminUser.id);
          toast(`${displayName} abgelehnt`, 'info');
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
      console.log('EmailJS ist nicht konfiguriert. Bitte EMAILJS_PUBLIC_KEY, EMAILJS_SERVICE_ID und EMAILJS_TEMPLATE_ID in app.js setzen.');
      return;
    }

    // EmailJS loaded via CDN
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

  // ─── Helpers ───

  function getInitials(member) {
    return `${(member.firstName || '?')[0]}${(member.lastName || '?')[0]}`.toUpperCase();
  }

  // ─── Start ───
  document.addEventListener('DOMContentLoaded', init);

  function getCachedMembers() {
    return cachedMembers;
  }

  function getCachedRelationships() {
    return cachedRelationships;
  }

  return {
    showView,
    toast,
    refreshTree,
    loadTree,
    showConnectionOverlay,
    getCachedMembers,
    getCachedRelationships,
  };
})();
