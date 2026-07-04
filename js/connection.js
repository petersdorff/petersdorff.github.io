/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Connection Overlay & Deep Links
   "Wie sind wir verwandt?", QR-Scan-Ergebnis, Deep Links,
   Schritt-für-Schritt-Erklärung des Verwandtschaftswegs
   ═══════════════════════════════════════════════════════════ */

const Connection = (() => {

  // Deep-link target that waits until the user's identity is known
  // (after login OR after picking an identity in guest mode).
  let pendingConnectId = null;

  async function showConnectionToMe() {
    const profileId = Profile.getCurrentProfileId();
    const myMember = Auth.getMember();
    if (!profileId) return;
    if (!myMember) {
      // No identity yet (guest without selection) → let them pick first
      pendingConnectId = profileId;
      if (Guest.isActive()) {
        App.toast('Wähle zuerst, wer du bist', 'info');
        Guest.showIdentityPicker();
      } else {
        App.toast('Bitte verknüpfe zuerst dein Profil', 'error');
      }
      return;
    }

    App.showView('view-main');
    await showOverlay(myMember.id, profileId);
  }

  async function showOverlay(fromId, toId) {
    const cachedMembers = App.getCachedMembers();
    const memberA = cachedMembers.find(m => m.id === fromId);
    const memberB = cachedMembers.find(m => m.id === toId);

    if (!memberA || !memberB) {
      App.toast('Person nicht im Stammbaum gefunden', 'error');
      return;
    }

    // Calculate connection
    const cachedRelationships = App.getCachedRelationships();
    const connection = Relationship.getConnection(
      fromId, toId, cachedMembers, cachedRelationships
    );

    // Fill overlay
    const personA = document.getElementById('conn-person-a');
    const personB = document.getElementById('conn-person-b');
    const relationEl = document.getElementById('conn-relation');
    const dnaEl = document.getElementById('conn-dna');

    personA.innerHTML = '';
    personA.appendChild(Utils.createEl('div', { className: 'conn-avatar', textContent: getInitials(memberA) }));
    personA.appendChild(Utils.createEl('div', { className: 'conn-name', textContent: memberA.firstName }));

    personB.innerHTML = '';
    personB.appendChild(Utils.createEl('div', { className: 'conn-avatar', textContent: getInitials(memberB) }));
    personB.appendChild(Utils.createEl('div', { className: 'conn-name', textContent: memberB.firstName }));

    const ancestorEl = document.getElementById('conn-ancestor');

    relationEl.textContent = connection.term || 'Unbekannt';
    dnaEl.textContent = connection.sharedDNA !== null && connection.sharedDNA !== undefined
      ? `~${connection.sharedDNA}%` : '—';
    ancestorEl.textContent = connection.commonAncestor || '—';

    // Step-by-step explanation of the path
    renderSteps(fromId, toId, cachedMembers, cachedRelationships);

    // Show overlay
    document.getElementById('connection-overlay').classList.remove('hidden');

    // Highlight path in tree
    Tree.highlightConnection(fromId, toId);
  }

  /**
   * Render the connection path as a plain-language step list:
   * each hop explains who the person is relative to the previous one.
   */
  function renderSteps(fromId, toId, members, relationships) {
    const stepsEl = document.getElementById('conn-steps');
    stepsEl.innerHTML = '';

    const { expandedPath } = Relationship.getPathData(fromId, toId, members, relationships);
    if (!expandedPath || expandedPath.length === 0) {
      stepsEl.appendChild(Utils.createEl('div', {
        className: 'conn-step-hint',
        textContent: 'Kein Verwandtschaftsweg gefunden.',
      }));
      return;
    }

    const byId = new Map(members.map(m => [m.id, m]));
    const myMember = Auth.getMember();

    const hopLabel = (edgeType, person, prev) => {
      const g = person.gender;
      const prevName = prev.firstName;
      switch (edgeType) {
        case 'parent':
          return `${g === 'm' ? 'Vater' : g === 'f' ? 'Mutter' : 'Elternteil'} von ${prevName}`;
        case 'child':
          return `${g === 'm' ? 'Sohn' : g === 'f' ? 'Tochter' : 'Kind'} von ${prevName}`;
        case 'spouse':
          return `verheiratet mit ${prevName}`;
        case 'sibling':
          return `${g === 'm' ? 'Bruder' : g === 'f' ? 'Schwester' : 'Geschwister'} von ${prevName}`;
        default:
          return '';
      }
    };

    for (let i = 0; i < expandedPath.length; i++) {
      const step = expandedPath[i];
      const person = byId.get(step.id);
      if (!person) continue;

      let sub = '';
      if (i === 0) {
        sub = myMember && person.id === myMember.id ? 'Das bist du' : 'Start';
      } else {
        const prev = byId.get(expandedPath[i - 1].id);
        sub = prev ? hopLabel(step.edgeType, person, prev) : '';
      }

      const nameEl = Utils.createEl('div', {
        className: 'conn-step-name',
        textContent: `${person.firstName} ${person.lastName}`,
      });
      const subEl = Utils.createEl('div', { className: 'conn-step-sub', textContent: sub });
      const dot = Utils.createEl('div', { className: 'conn-step-dot' });
      const body = Utils.createEl('div', { className: 'conn-step-body' }, [nameEl, subEl]);
      const item = Utils.createEl('div', { className: 'conn-step' }, [dot, body]);
      item.addEventListener('click', () => Profile.show(person.id));
      stepsEl.appendChild(item);
    }
  }

  function closeOverlay() {
    document.getElementById('connection-overlay').classList.add('hidden');
    Tree.clearHighlight();
  }

  // ─── QR Scan Handler ───

  async function handleQRScanned(memberId) {
    App.toast('QR-Code erkannt!', 'success');

    // Verify the member exists — try cache first, then fresh DB lookup
    const cachedMembers = App.getCachedMembers();
    let member = cachedMembers.find(m => m.id === memberId);
    if (!member) {
      member = await DB.getMember(memberId);
      if (!member) {
        App.toast('Person nicht im Stammbaum gefunden', 'error');
        App.showView('view-main');
        return;
      }
      // Refresh tree to include this member in cache
      await App.loadTree();
    }

    // Show connection between me and scanned person
    const myMember = Auth.getMember();
    if (!myMember) {
      if (Guest.isActive()) {
        pendingConnectId = memberId;
        App.toast('Wähle zuerst, wer du bist', 'info');
        Guest.showIdentityPicker();
      } else {
        Profile.show(memberId);
      }
      return;
    }

    App.showView('view-main');
    await showOverlay(myMember.id, memberId);
  }

  // ─── Deep Links ───

  /**
   * Remember a connect target from a deep link; it is resolved as soon
   * as the user's identity is known (login or guest identity pick).
   */
  function setPendingConnect(memberId) {
    pendingConnectId = memberId;
  }

  async function resolvePendingConnect() {
    if (!pendingConnectId) return false;
    const myMember = Auth.getMember();
    if (!myMember) return false;
    const targetId = pendingConnectId;
    pendingConnectId = null;
    if (targetId === myMember.id) return false;
    App.showView('view-main');
    await showOverlay(myMember.id, targetId);
    return true;
  }

  function handleDeepLink() {
    const hash = window.location.hash;
    if (hash.startsWith('#connect/')) {
      const memberId = hash.replace('#connect/', '');
      setPendingConnect(memberId);
      // Clean the hash so reloads don't re-trigger
      if (window.history.replaceState) {
        window.history.replaceState(null, '', window.location.pathname + window.location.search);
      }
    } else if (hash === '#admin') {
      const checkAdmin = setInterval(() => {
        const user = Auth.getUser();
        if (user) {
          clearInterval(checkAdmin);
          if (user.email === Admin.getAdminEmail()) {
            Admin.showAdminPanel();
          }
          window.location.hash = '';
        }
      }, 500);
      setTimeout(() => clearInterval(checkAdmin), 10000);
    }
  }

  function hasPendingConnect() {
    return !!pendingConnectId;
  }

  // ─── Helpers ───

  function getInitials(member) {
    return `${(member.firstName || '?')[0]}${(member.lastName || '?')[0]}`.toUpperCase();
  }

  return {
    showConnectionToMe,
    showOverlay,
    closeOverlay,
    handleQRScanned,
    handleDeepLink,
    setPendingConnect,
    resolvePendingConnect,
    hasPendingConnect,
  };
})();
