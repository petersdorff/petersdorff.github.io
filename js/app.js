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
  let viewApplied = false;
  // Familienzweige (aus Fan.buildFamiliesFrom), App-weit für alle Ansichten
  let families = [];
  let unreachableIds = [];
  let activeFamilyId = null;

  // ─── Initialize ───

  async function init() {
    const { createClient } = window.supabase;
    const supabaseClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

    // Init modules
    DB.init(supabaseClient);
    Search.init();
    Tree.init('tree-container');
    Article.init();
    Gotha.init('gotha-container');
    Gotha.onTap((memberId) => Profile.show(memberId));
    Fan.init('fan-container');
    Fan.onTap((memberId) => {
      Fan.panTo(memberId);
      Profile.show(memberId);
    });
    Fan.onAddRelative(addRelative);
    Fan.onConnect((memberId) => Connection.showConnectionTo(memberId));
    // Fächer wechselt intern die Familie (z.B. Zentrieren auf eine Person
    // des anderen Zweigs) → App-Zustand nachziehen
    Fan.onFamilyChange((rootId) => {
      activeFamilyId = rootId;
      try { localStorage.setItem('stammbaum_family', rootId); } catch { /* privat/blockiert */ }
      updateFamilySwitch();
      updateOrphanTray();
      updateLegendBlocks();   // Jahres-Skala ist je Zweig
    });
    Admin.initEmailJS();

    // Familientag-Aushang: der QR-Code trägt den Code als ?zugang=… — Gäste
    // landen ohne Tippen direkt im Stammbaum, bei der Registrierung ist das
    // Code-Feld vorausgefüllt. Einmal gelesen, dann aus der URL entfernt.
    // (Nicht ?code=, das ist bei Supabase für den PKCE-Login reserviert.)
    let urlCode = '';
    try {
      const params = new URLSearchParams(window.location.search);
      urlCode = (params.get('zugang') || '').trim();
      if (params.has('zugang')) {
        params.delete('zugang');
        const q = params.toString();
        window.history.replaceState(null, '', window.location.pathname + (q ? '?' + q : '') + window.location.hash);
      }
    } catch { /* egal */ }
    if (urlCode) {
      for (const id of ['guest-code', 'reg-code', 'pending-code']) {
        const el = document.getElementById(id);
        if (el) el.value = urlCode;
      }
    }

    // Register auth state listener BEFORE Auth.init()
    Auth.onAuthChange(async (user, member, event) => {
      if (event === 'TOKEN_REFRESHED') return;

      if (isInitialized && event === 'SIGNED_IN' && authHandled) return;
      authHandled = true;

      if (user) {
        // Bootstrap-E-Mail ist sofort Admin; alle anderen Rollen kommen aus
        // der Freigabe-Zeile (Status UND Rolle) — sie wird für jeden gelesen.
        let isAdmin = Admin.setCurrentRole(user, null);
        try {
          let approval = await DB.getApprovalStatus(user.id);
          // Familientag-Code aus der Registrierung: sofort freischalten
          const regCode = sessionStorage.getItem('reg_inviteCode') || '';
          if (regCode && (!approval || approval.status === 'pending')) {
            const displayName = user.user_metadata?.display_name || user.email || '';
            try {
              const ok = await DB.redeemInviteCode(regCode, displayName);
              if (ok) { approval = await DB.getApprovalStatus(user.id); toast('Familientag-Code erkannt – du bist freigeschaltet!', 'success'); }
              else toast('Familientag-Code ungültig oder abgelaufen – ein Administrator muss dich freischalten.', 'error');
            } catch (e) { console.error('[App] redeemInviteCode:', e); }
            sessionStorage.removeItem('reg_inviteCode');
          }
          isAdmin = Admin.setCurrentRole(user, approval);
          if (!isAdmin) {
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
            if (approval.status === 'revoked') {
              toast('Dein Zugang wurde gesperrt. Bitte kontaktiere den Administrator.', 'error');
              showView('view-pending');
              return;
            }
          }
        } catch (err) {
          // Backend nicht erreichbar (z.B. Projekt pausiert): klare Meldung,
          // zurück zum Login — einen Offline-Snapshot gibt es bewusst nicht mehr.
          console.error('[App] Approval check failed:', err);
          toast('Server nicht erreichbar – bitte später noch einmal versuchen', 'error');
          showView('view-auth');
          return;
        }

        if (!appOpenLogged) { appOpenLogged = true; DB.logEvent('app_open'); }
        if (member) {
          Tree.setCurrentUser(member.id);
          showView('loading-screen');
          await loadTree();
          showView('view-main');
          applyReadOnlyUI();
          Admin.updateAdminMenu(isAdmin && !DB.isOffline());
          // Auf mich zentrieren statt "Wand aus 113 Kästchen"
          ensureFamilyFor(member.id);
          if (Fan.isActive()) Fan.centerOn(member.id); else if (!Gotha.isActive()) Tree.centerOn(member.id, 0.9, false);
          const resolved = await Connection.resolvePendingConnect();
          if (resolved) return;
        } else {
          showView('view-claim');
        }
      } else {
        authHandled = false;
        // Code aus dem QR-Link (Aushang): sofort als Gast hinein; bei
        // ungültigem Code zeigt enter() die Code-Abfrage (vorausgefüllt).
        if (urlCode) {
          const code = urlCode; urlCode = '';
          if (await Guest.enter(code)) return;
          return;
        }
        // Familientag: wer schon mal als Gast drin war (Code gespeichert),
        // landet direkt wieder im Stammbaum statt auf dem Login — solange
        // der Code noch gilt (sonst zeigt enter() die Code-Abfrage).
        if (Guest.hasStoredCode()) {
          if (await Guest.enter()) return;
          return;
        }
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
    document.getElementById('btn-claim-new').addEventListener('click', () => Claim.showBranchChooser());
    document.getElementById('btn-claim-new-go').addEventListener('click', () => Claim.handleClaimNew());

    // Datenschutz-Seite (Login-Fußzeile + Menü); zurück zur vorherigen Ansicht
    let privacyReturn = 'view-auth';
    const openPrivacy = (e) => {
      e.preventDefault(); closeMenu();
      const cur = document.querySelector('.view.active');
      privacyReturn = cur && cur.id !== 'view-privacy' ? cur.id : 'view-auth';
      document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
      document.getElementById('view-privacy').classList.add('active');
    };
    document.getElementById('link-privacy').addEventListener('click', openPrivacy);
    document.getElementById('menu-privacy').addEventListener('click', openPrivacy);
    document.getElementById('btn-privacy-back').addEventListener('click', () => {
      document.getElementById('view-privacy').classList.remove('active');
      document.getElementById(privacyReturn).classList.add('active');
    });

    // Hinweis „Profil noch nicht verbunden" → eigenes Profil bearbeiten
    document.getElementById('btn-connect-hint').addEventListener('click', () => {
      const me = Auth.getMember();
      if (me) Profile.edit(me.id);
    });

    // Guest / Familientag mode (nur mit Code)
    document.getElementById('btn-guest').addEventListener('click', () => Guest.enter());
    document.getElementById('btn-guest-code').addEventListener('click', () => Guest.submitCode());
    document.getElementById('guest-code').addEventListener('keydown', (e) => { if (e.key === 'Enter') Guest.submitCode(); });
    document.getElementById('whoami-search').addEventListener('input',
      Utils.debounce(Guest.handleSearchInput, 150));
    document.getElementById('btn-whoami-skip').addEventListener('click', Guest.skipIdentity);
    document.getElementById('menu-whoami').addEventListener('click', (e) => {
      e.preventDefault(); closeMenu(); Guest.showIdentityPicker();
    });

    // Top bar
    document.getElementById('btn-menu').addEventListener('click', openMenu);
    document.querySelectorAll('#view-switch .view-btn').forEach(b => {
      b.addEventListener('click', () => applyView(b.dataset.view));
    });
    document.getElementById('btn-scan').addEventListener('click', openScanner);
    updateViewSwitch();

    // FABs
    document.getElementById('fab-add').addEventListener('click', () => Profile.edit(null));
    document.getElementById('fab-myqr').addEventListener('click', showMyQR);
    document.getElementById('fab-center').addEventListener('click', centerOnMe);
    document.getElementById('fab-legend').addEventListener('click', () => {
      document.getElementById('legend-panel').classList.toggle('hidden');
    });
    document.getElementById('legend-close').addEventListener('click', () => {
      document.getElementById('legend-panel').classList.add('hidden');
    });
    document.getElementById('orphan-toggle').addEventListener('click', () => {
      const list = document.getElementById('orphan-list');
      const open = list.classList.toggle('hidden') === false;
      document.getElementById('orphan-toggle').setAttribute('aria-expanded', String(open));
    });

    // Profile view
    document.getElementById('btn-profile-back').addEventListener('click', () => {
      const profileView = document.getElementById('view-profile');
      if (profileView.classList.contains('side-panel')) {
        profileView.classList.remove('side-panel', 'active');
        profileView.style.display = '';
        document.body.classList.remove('side-panel-open');
        return;
      }
      showView('view-main');
    });
    document.getElementById('btn-profile-edit').addEventListener('click', () => {
      Profile.edit(Profile.getCurrentProfileId());
    });
    document.getElementById('btn-profile-article').addEventListener('click', () => Article.show(Profile.getCurrentProfileId()));
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
        ensureFamilyFor(profileId);
        if (Gotha.isActive()) Gotha.scrollTo(profileId);
        else if (Fan.isActive()) Fan.centerOn(profileId);
        else setTimeout(() => Tree.centerOn(profileId), 300);
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
      e.preventDefault(); closeMenu();
      if (Guest.isActive()) {
        Guest.exit();
      } else {
        Auth.logout();
      }
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
    document.getElementById('btn-pending-code').addEventListener('click', async () => {
      const code = document.getElementById('pending-code').value.trim();
      if (!code) { toast('Bitte den Familientag-Code eingeben', 'error'); return; }
      const user = Auth.getUser();
      if (!user) return;
      try {
        const ok = await DB.redeemInviteCode(code, user.user_metadata?.display_name || user.email || '');
        if (ok) { toast('Freigeschaltet!', 'success'); window.location.reload(); }
        else toast('Code ungültig oder abgelaufen', 'error');
      } catch (err) {
        console.error('[App] redeemInviteCode:', err);
        toast('Fehler beim Einlösen. Bitte versuche es nochmal.', 'error');
      }
    });
    document.getElementById('btn-pending-guest').addEventListener('click', async () => {
      // Konto bleibt bestehen; Gastmodus braucht den Code (Abfrage auf der Login-Seite)
      await Auth.logout();
      Guest.showCodePrompt();
    });

    // Admin panel back button
    document.getElementById('btn-admin-back').addEventListener('click', () => showView('view-main'));

    // Tree node tap: center the person (instantly, at the current zoom —
    // an animation would be cut off by the view switch), then open profile
    Tree.onNodeTap((nodeId) => {
      Tree.centerOn(nodeId, null, false);
      Profile.show(nodeId);
    });

    // Tree background tap — close overlays and side panels
    Tree.onBackgroundTap(() => {
      Connection.closeOverlay();
      const profileView = document.getElementById('view-profile');
      if (profileView.classList.contains('side-panel')) {
        profileView.classList.remove('side-panel', 'active');
        profileView.style.display = '';
        document.body.classList.remove('side-panel-open');
      }
    });
  }

  // ─── Tree Loading ───

  async function loadTree() {
    try {
      const { members, relationships } = await DB.getFullGraph();
      cachedMembers = members;
      cachedRelationships = relationships;

      if (cachedMembers.length === 0) {
        toast('Demo-Daten werden geladen...', 'info');
        await DB.seedDemoData();
        const fresh = await DB.getFullGraph();
        cachedMembers = fresh.members;
        cachedRelationships = fresh.relationships;
      }

      renderTree();
      Search.setMembers(cachedMembers);
      updateMenuUser();
      updateOfflineBanner();
    } catch (err) {
      console.error('Load tree error:', err);
      toast('Fehler beim Laden des Stammbaums', 'error');
    }
  }

  function renderTree() {
    computeFamilies();
    const sub = familySubset();
    if (!viewApplied) {
      // Erster Render: gespeicherte Ansicht anwenden, Standard ist der Fächer.
      viewApplied = true;
      const name = getStoredView();
      const isFan = name.startsWith('fan');
      Tree.render(sub.members, sub.relationships);
      Fan.setColorMode(fanColorMode(name));
      setFanMode(isFan);
      Gotha.render(cachedMembers, cachedRelationships, { familyId: activeFamilyId });
      if (name === 'gotha') Gotha.show();
      updateViewSwitch();
      updateLegendBlocks();
      updateFamilySwitch();
      updateOrphanTray();
      return;
    }
    Tree.render(sub.members, sub.relationships);
    if (Fan.isActive()) Fan.render(cachedMembers, cachedRelationships);
    Gotha.render(cachedMembers, cachedRelationships, { familyId: activeFamilyId });
    updateFamilySwitch();
    updateOrphanTray();
  }

  // ─── Familienzweige: App-weiter Zustand für alle Ansichten ───

  /** Familien aus den Daten ableiten und die aktive wählen
      (gespeichert → die des Nutzers → größte). */
  function computeFamilies() {
    const res = Fan.buildFamiliesFrom(cachedMembers, cachedRelationships);
    families = res.families;
    unreachableIds = res.unreachable;
    const valid = id => id && families.some(f => f.rootId === id);
    if (!valid(activeFamilyId)) {
      let stored = null;
      try { stored = localStorage.getItem('stammbaum_family'); } catch { /* egal */ }
      const me = Auth.getMember()?.id;
      const mine = me && families.find(f => f.assigned.has(me));
      activeFamilyId = valid(stored) ? stored : (mine ? mine.rootId : (families[0]?.rootId || null));
    }
    Fan.setPreferredFamily(activeFamilyId);
  }

  /** Personen und Beziehungen des aktiven Zweigs (für Baum-Ansichten). */
  function familySubset() {
    const f = families.find(x => x.rootId === activeFamilyId);
    if (!f) return { members: cachedMembers, relationships: cachedRelationships };
    return {
      members: cachedMembers.filter(m => f.assigned.has(m.id)),
      relationships: cachedRelationships.filter(r => f.assigned.has(r.fromId) && f.assigned.has(r.toId)),
    };
  }

  function familyOf(memberId) {
    const f = families.find(x => x.assigned.has(memberId));
    return f ? f.rootId : null;
  }

  /** Zweig wechseln — in jeder Ansicht. */
  function setActiveFamily(rootId) {
    if (!rootId || rootId === activeFamilyId || !families.some(f => f.rootId === rootId)) return;
    activeFamilyId = rootId;
    try { localStorage.setItem('stammbaum_family', rootId); } catch { /* privat/blockiert */ }
    Fan.setPreferredFamily(rootId);
    if (Fan.isActive()) Fan.setFamily(rootId);   // rendert den Fächer selbst neu
    const sub = familySubset();
    Tree.render(sub.members, sub.relationships);
    Gotha.render(cachedMembers, cachedRelationships, { familyId: rootId });
    updateFamilySwitch();
    updateOrphanTray();
    updateLegendBlocks();
  }

  /** Vor dem Zentrieren ggf. in den Zweig der Person wechseln. */
  function ensureFamilyFor(memberId) {
    const fid = familyOf(memberId);
    if (fid && fid !== activeFamilyId) setActiveFamily(fid);
  }

  // ─── Familienzweige (Fächer) ───

  function updateFamilySwitch() {
    const sw = document.getElementById('family-switch');
    if (!sw) return;
    sw.classList.toggle('hidden', families.length < 2);
    sw.innerHTML = '';
    for (const f of families) {
      const active = f.rootId === activeFamilyId;
      const b = document.createElement('button');
      b.className = 'family-btn' + (active ? ' active' : '');
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(active));
      b.textContent = f.short;
      b.title = `${f.name} · ${f.size} Personen`;
      b.addEventListener('click', () => setActiveFamily(f.rootId));
      sw.appendChild(b);
    }
  }

  // ─── Waisen-Ablage: Profile ohne Anbindung an den Stammbaum ───

  /**
   * Im Fächer: alle, die nicht über die Wurzel erreichbar sind. Im Baum:
   * alle ohne jede Verbindung (nur die fehlen dort in der Darstellung).
   */
  /** Eigenes Profil noch unverbunden (Anschluss „noch unklar"): Hinweis oben. */
  function updateConnectHint(unreachable) {
    const el = document.getElementById('connect-hint');
    if (!el) return;
    const me = Auth.getMember();
    const show = !!me && !Guest.isActive() && !DB.isOffline() && unreachable.includes(me.id);
    el.classList.toggle('hidden', !show);
  }

  function updateOrphanTray() {
    const tray = document.getElementById('orphan-tray');
    if (!tray) return;
    const ids = unreachableIds;
    const byId = new Map(cachedMembers.map(m => [m.id, m]));
    // Nur die Waisen des aktiven Zweigs (family_hint = Zweig-Wurzel);
    // ohne Zuordnung (ältere Einträge) in jedem Zweig zeigen.
    const orphans = ids.map(id => byId.get(id)).filter(Boolean)
      .filter(m => !m.familyHint || !families.some(f => f.rootId === m.familyHint) || m.familyHint === activeFamilyId)
      .sort((a, b) => `${a.lastName} ${a.firstName}`.localeCompare(`${b.lastName} ${b.firstName}`));
    document.getElementById('orphan-count').textContent = orphans.length;
    tray.classList.toggle('hidden', orphans.length === 0);
    updateConnectHint(ids);
    const list = document.getElementById('orphan-list');
    list.innerHTML = '';
    if (!orphans.length) return;
    const hint = document.createElement('div');
    hint.className = 'orphan-hint';
    hint.textContent = 'Noch nicht mit diesem Zweig verbunden. Antippen → Profil → Bearbeiten → Verbindung hinzufügen.';
    list.appendChild(hint);
    for (const m of orphans) {
      const b = document.createElement('button');
      b.className = 'orphan-item';
      b.innerHTML = `${Utils.escapeHtml(m.firstName)} ${Utils.escapeHtml(m.lastName)}` +
        (m.birthDate ? `<small>* ${m.birthDate.substring(0, 4)}</small>` : '');
      b.addEventListener('click', () => Profile.show(m.id));
      list.appendChild(b);
    }
  }

  // ─── Neue Person mit vorbelegter Beziehung (Hover-Plus im Fächer) ───

  /**
   * Öffnet „Neue Person anlegen" mit der Beziehung zur Ausgangsperson
   * bereits gesetzt: relType 'child' = neue Person ist Kind von target,
   * 'sibling' = Geschwister von target. Nachname wird vorbelegt; die
   * Regel-Engine ergänzt beim Speichern zweites Elternteil / Geschwister.
   */
  async function addRelative(relType, targetId) {
    if (DB.isOffline()) { toast('Offline-Modus: Anlegen nicht möglich', 'error'); return; }
    const target = cachedMembers.find(m => m.id === targetId);
    if (!target) return;
    await Profile.edit(null);
    const year = target.birthDate ? ` (* ${target.birthDate.substring(0, 4)})` : '';
    Relations.presetRelation(relType, targetId, `${target.firstName} ${target.lastName}${year}`);
    // Nachname nur für Kind/Geschwister vorbelegen — ein Partner hat i.d.R. einen anderen
    const ln = document.getElementById('edit-lastname');
    if (!ln.value && relType !== 'spouse') ln.value = target.lastName || '';
    const title = document.querySelector('.edit-header h2');
    if (title) {
      title.textContent = {
        child: `Kind von ${target.firstName} anlegen`,
        sibling: `Geschwister von ${target.firstName} anlegen`,
        spouse: `Partner von ${target.firstName} anlegen`,
      }[relType] || 'Neue Person anlegen';
    }
    document.getElementById('edit-firstname').focus();
  }

  // ─── Ansichten: fan | fan-years | fan-name | gotha | tree (Stammtafel) ───

  let appOpenLogged = false;   // Nutzungsstatistik: ein App-Start je Seitenaufruf
  const VIEW_ORDER = ['fan', 'fan-years', 'fan-name', 'gotha', 'tree'];
  const fanColorMode = name => name === 'fan-years' ? 'year' : name === 'fan-name' ? 'name' : 'gender';

  function getStoredView() {
    let v = null;
    try { v = localStorage.getItem('stammbaum_view'); } catch { /* privat/blockiert */ }
    if (v === 'generational' || v === 'temporal') v = 'tree';   // alte Namen
    return VIEW_ORDER.includes(v) ? v : 'fan';
  }

  function getCurrentView() {
    if (Gotha.isActive()) return 'gotha';
    if (!Fan.isActive()) return 'tree';
    const m = Fan.getColorMode();
    return m === 'year' ? 'fan-years' : m === 'name' ? 'fan-name' : 'fan';
  }

  /** Ansicht umschalten und merken. */
  function applyView(name) {
    if (name === 'gotha') {
      setFanMode(false);
      Gotha.show();
    } else if (name.startsWith('fan')) {
      Gotha.hide();
      Fan.setColorMode(fanColorMode(name));
      setFanMode(true);
    } else {
      Gotha.hide();
      setFanMode(false);
    }
    try { localStorage.setItem('stammbaum_view', name); } catch { /* privat/blockiert */ }
    updateViewSwitch();
    updateLegendBlocks();
  }

  /** Legende passend zur Ansicht: Baum / Fächer (Geschlecht) / Fächer (Geburtsjahr). */
  function updateLegendBlocks() {
    const fan = Fan.isActive(), year = fan && Fan.getColorMode() === 'year', nameMode = fan && Fan.getColorMode() === 'name', gotha = Gotha.isActive();
    document.getElementById('legend-gotha').classList.toggle('hidden', !gotha);
    document.getElementById('legend-tree').classList.toggle('hidden', fan || gotha);
    document.getElementById('legend-fan').classList.toggle('hidden', !fan || year || nameMode);
    document.getElementById('legend-fan-name').classList.toggle('hidden', !nameMode);
    if (nameMode) document.getElementById('legend-name-surname').textContent = Fan.familySurname() || 'Familienname';
    const yl = document.getElementById('legend-fan-year');
    yl.classList.toggle('hidden', !year);
    if (year) {
      const sc = Fan.getYearScale();
      document.getElementById('legend-year-bar').style.background = `linear-gradient(90deg, ${sc.stops.join(', ')})`;
      document.getElementById('legend-year-min').textContent = sc.min;
      document.getElementById('legend-year-max').textContent = sc.max;
    }
  }

  /** Fächer-Overlay ein-/ausblenden inkl. passender Legende. */
  function setFanMode(on) {
    if (on) {
      Fan.render(cachedMembers, cachedRelationships);
      Fan.show();
    } else {
      Fan.hide();
    }
    updateLegendBlocks();
    if (cachedMembers.length) { updateFamilySwitch(); updateOrphanTray(); }
  }

  // ─── Offline banner & read-only UI ───

  function updateOfflineBanner() {
    const banner = document.getElementById('offline-banner');
    if (!banner) return;
    if (DB.isOffline()) {
      const textEl = document.getElementById('offline-banner-text');
      const date = DB.getGuestGraphDate();
      textEl.textContent = Guest.isActive()
        ? `Familientag-Modus · nur lesen${date ? ' · Stand ' + date : ''}`
        : `Nur lesen${date ? ' · Stand ' + date : ''}`;
      banner.classList.remove('hidden');
    } else {
      banner.classList.add('hidden');
    }
    // Zeitstrahl u.a. weichen der Status-Pille aus
    document.body.classList.toggle('has-status', !banner.classList.contains('hidden'));
  }

  /**
   * Hide all editing affordances when the data source is read-only
   * (guest mode or offline fallback).
   */
  function applyReadOnlyUI() {
    const readOnly = DB.isOffline();
    document.getElementById('fab-add').style.display = readOnly ? 'none' : '';
    Fan.setCanEdit(!readOnly);
    const whoamiItem = document.getElementById('menu-whoami-item');
    if (whoamiItem) whoamiItem.style.display = Guest.isActive() ? '' : 'none';
    updateOfflineBanner();
  }

  /**
   * Re-apply the current-user marking on the tree without a full reload
   * (used after picking an identity in guest mode).
   */
  function refreshTreeHighlight() {
    renderTree();
  }

  async function refreshTree() {
    await loadTree();
  }

  // ─── View Management ───

  // Auf dem Desktop öffnen Profil und Bearbeiten-Formular als Seitenpanel
  // über dem Baum/Fächer statt als Vollbild.
  const SIDE_PANEL_VIEWS = ['view-profile', 'view-edit'];

  function showView(viewId) {
    // Always close the connection overlay when switching views
    Connection.closeOverlay();

    const isDesktop = window.innerWidth >= 600;
    for (const id of SIDE_PANEL_VIEWS) {
      const v = document.getElementById(id);
      if (v) { v.classList.remove('side-panel'); v.style.display = ''; }
    }
    document.body.classList.remove('side-panel-open');

    if (SIDE_PANEL_VIEWS.includes(viewId) && isDesktop) {
      document.querySelectorAll('.view').forEach(v => {
        if (v.id !== 'view-main' && v.id !== viewId) v.classList.remove('active');
      });
      const panel = document.getElementById(viewId);
      panel.classList.add('side-panel', 'active');
      panel.style.display = 'flex';
      document.getElementById('view-main').classList.add('active');
      document.body.classList.add('side-panel-open');
      return;
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
      emailEl.textContent = user?.email || (Guest.isActive() ? 'Familientag-Modus' : '');

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
    } else {
      nameEl.textContent = 'Gast';
      emailEl.textContent = Guest.isActive() ? 'Familientag-Modus' : '';
      photoEl.textContent = 'G';
    }
  }

  // ─── QR & Scanner ───

  function showMyQR() {
    const member = Auth.getMember();
    if (!member) {
      if (Guest.isActive()) {
        toast('Wähle zuerst, wer du bist', 'info');
        Guest.showIdentityPicker();
      } else {
        toast('Bitte verknüpfe zuerst dein Profil', 'error');
      }
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

  /** Aktive Ansicht im Umschalter unten markieren. */
  function updateViewSwitch() {
    const mode = getCurrentView();
    document.querySelectorAll('#view-switch .view-btn').forEach(b => {
      const on = b.dataset.view === mode;
      b.classList.toggle('active', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    });
  }

  function centerOnMe() {
    const member = Auth.getMember();
    if (member) ensureFamilyFor(member.id);
    if (Gotha.isActive()) {
      if (!member || !Gotha.scrollTo(member.id)) toast('Wähle zuerst, wer du bist', 'info');
      return;
    }
    if (Fan.isActive()) {
      member ? Fan.centerOn(member.id) : Fan.fit();
      return;
    }
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
    applyView,
    setActiveFamily,
    ensureFamilyFor,
    familyInfo: (id) => { const f = families.find(x => x.assigned.has(id)); return f ? { rootId: f.rootId, short: f.short, name: f.name } : null; },
    getFamilies: () => families.map(f => ({ rootId: f.rootId, short: f.short, name: f.name })),
    getActiveFamilyId: () => activeFamilyId,
    addRelative,
    toast,
    refreshTree,
    loadTree,
    applyReadOnlyUI,
    refreshTreeHighlight,
    updateOfflineBanner,
    getCachedMembers() { return cachedMembers; },
    getCachedRelationships() { return cachedRelationships; },
  };
})();
