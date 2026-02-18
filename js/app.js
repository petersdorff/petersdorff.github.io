/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Main App Controller (Supabase)
   Core init, view management, tree loading, menu, toast
   ═══════════════════════════════════════════════════════════ */

const App = (() => {
  // ─── Supabase Config ───
  const SUPABASE_URL = 'https://ixdcyoivtapglllmwvut.supabase.co';
  const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Iml4ZGN5b2l2dGFwZ2xsbG13dnV0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzExNDQwMzcsImV4cCI6MjA4NjcyMDAzN30.9bwk1HrmsWz6Hk5RxqnpZiqt7-0YhNjzyev_tpIwLqU';

  let cachedMembers = [];
  let cachedRelationships = [];
  let isInitialized = false;
  let authHandled = false;

  // ─── Initialize ───

  async function init() {
    const { createClient } = window.supabase;
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Init modules
    DB.init(supabaseClient);
    Search.init();
    Tree.init('tree-container');
    Admin.initEmailJS();

    // Register auth state listener BEFORE Auth.init()
    Auth.onAuthChange(async (user, member, event) => {
      if (event === 'TOKEN_REFRESHED') return;

      if (isInitialized && event === 'SIGNED_IN' && authHandled) return;
      authHandled = true;

      if (user) {
        const isAdmin = user.email === Admin.getAdminEmail();

        if (!isAdmin) {
          try {
            const approval = await DB.getApprovalStatus(user.id);
            if (!approval) {
              const displayName = user.user_metadata?.display_name || user.email || '';
              await DB.createApprovalRequest(user.id, user.email, displayName);
              Admin.sendAdminNotification(user.email, displayName);
              showView('view-pending');
              return;
            }
            if (approval.status === 'pending') { showView('view-pending'); return; }
            if (approval.status === 'rejected') {
              toast('Dein Zugang wurde abgelehnt. Bitte kontaktiere den Administrator.', 'error');
              showView('view-pending');
              return;
            }
          } catch (err) {
            console.error('[App] Approval check failed:', err);
            showView('view-pending');
            return;
          }
        }

        if (member) {
          Tree.setCurrentUser(member.id);
          await loadTree();
          showView('view-main');
          Admin.updateAdminMenu(isAdmin);
        } else {
          showView('view-claim');
        }
      } else {
        authHandled = false;
        showView('view-auth');
      }
    });

    // Listen for password recovery event
    Auth.onPasswordRecovery(() => {
      document.querySelectorAll('.auth-form').forEach(f => f.classList.add('hidden'));
      document.getElementById('auth-new-password').classList.remove('hidden');
      showView('view-auth');
    });

    Auth.init(supabaseClient);
    bindEvents();
    Connection.handleDeepLink();
    isInitialized = true;
  }

  // ─── Event Bindings ───

  function bindEvents() {
    // Auth - Login
    document.getElementById('btn-login').addEventListener('click', Claim.handleLogin);
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
    document.getElementById('btn-forgot-send').addEventListener('click', Claim.handleForgotPassword);
    document.getElementById('forgot-email').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') Claim.handleForgotPassword();
    });

    // Auth - Set New Password
    document.getElementById('btn-set-new-password').addEventListener('click', Claim.handleSetNewPassword);
    document.getElementById('new-password-confirm').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') Claim.handleSetNewPassword();
    });

    // Auth - Register
    document.getElementById('btn-register').addEventListener('click', Claim.handleRegister);
    document.getElementById('show-login').addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('auth-register').classList.add('hidden');
      document.getElementById('auth-login').classList.remove('hidden');
    });

    // Enter key on login fields
    document.getElementById('login-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') Claim.handleLogin();
    });
    document.getElementById('reg-password').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') Claim.handleRegister();
    });

    // Claim view
    document.getElementById('claim-search').addEventListener('input', Claim.handleClaimSearch);
    document.getElementById('btn-claim-new').addEventListener('click', Claim.handleClaimNew);

    // Top bar
    document.getElementById('btn-menu').addEventListener('click', openMenu);
    document.getElementById('btn-view-toggle').addEventListener('click', handleViewToggle);
    document.getElementById('btn-scan').addEventListener('click', openScanner);
    updateToggleButton();

    // FABs
    document.getElementById('fab-add').addEventListener('click', () => Profile.edit(null));
    document.getElementById('fab-myqr').addEventListener('click', showMyQR);
    document.getElementById('fab-center').addEventListener('click', centerOnMe);

    // Profile view
    document.getElementById('btn-profile-back').addEventListener('click', () => {
      const profileView = document.getElementById('view-profile');
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
    document.getElementById('btn-show-connection').addEventListener('click', Connection.showConnectionToMe);
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
      Relations.searchForRelation(query);
    }, 200);
    document.getElementById('edit-rel-search').addEventListener('input', (e) => {
      debouncedRelSearch(e.target.value.trim());
    });
    document.getElementById('btn-add-relation').addEventListener('click', Relations.addRelation);
    document.getElementById('edit-rel-type').addEventListener('change', () => {
      if (!Profile.getEditingMemberId()) Relations.updatePendingRelDisplay();
    });

    // QR views
    document.getElementById('btn-qr-back').addEventListener('click', () => showView('view-main'));
    document.getElementById('btn-scanner-back').addEventListener('click', () => {
      QR.stopScanner();
      showView('view-main');
    });

    // Connection overlay
    document.getElementById('close-connection').addEventListener('click', Connection.closeOverlay);

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
      e.preventDefault(); closeMenu(); Admin.showAdminPanel();
    });

    // Pending approval
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
      Connection.closeOverlay();
      const profileView = document.getElementById('view-profile');
      if (profileView.classList.contains('side-panel')) {
        profileView.classList.remove('side-panel', 'active');
        profileView.style.display = '';
      }
    });
  }

  // ─── Tree Loading ───

  async function loadTree() {
    try {
      const { members, relationships } = await DB.getFullGraph();
      cachedMembers = members;
      cachedRelationships = relationships;

      if (members.length === 0) {
        toast('Demo-Daten werden geladen...', 'info');
        await DB.seedDemoData();
        const data = await DB.getFullGraph();
        cachedMembers = data.members;
        cachedRelationships = data.relationships;
      }

      Tree.render(cachedMembers, cachedRelationships);
      Search.setMembers(cachedMembers);
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
    // Always close the connection overlay when switching views
    Connection.closeOverlay();

    const isDesktop = window.innerWidth >= 600;
    const profileView = document.getElementById('view-profile');

    if (viewId === 'view-profile' && isDesktop) {
      document.querySelectorAll('.view').forEach(v => {
        if (v.id !== 'view-main' && v.id !== 'view-profile') {
          v.classList.remove('active');
        }
      });
      profileView.classList.add('side-panel', 'active');
      profileView.style.display = 'flex';
      document.getElementById('view-main').classList.add('active');
      return;
    }

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
    QR.startScanner('qr-reader', Connection.handleQRScanned);
  }

  // ─── Delete Member ───

  async function handleDeleteMember() {
    const memberId = Profile.getCurrentProfileId();
    if (!memberId) return;

    const member = cachedMembers.find(m => m.id === memberId);
    if (!member) return;

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

  // ─── Start ───
  document.addEventListener('DOMContentLoaded', init);

  return {
    showView,
    toast,
    refreshTree,
    loadTree,
    getCachedMembers() { return cachedMembers; },
    getCachedRelationships() { return cachedRelationships; },
  };
})();
