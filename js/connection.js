/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Connection Overlay & Deep Links
   "How are we connected?" feature, QR scan result, deep links
   ═══════════════════════════════════════════════════════════ */

const Connection = (() => {

  async function showConnectionToMe() {
    const profileId = Profile.getCurrentProfileId();
    const myMember = Auth.getMember();
    if (!profileId || !myMember) return;

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
      Profile.show(memberId);
      return;
    }

    App.showView('view-main');
    await showOverlay(myMember.id, memberId);
  }

  // ─── Deep Links ───

  function handleDeepLink() {
    const hash = window.location.hash;
    if (hash.startsWith('#connect/')) {
      const memberId = hash.replace('#connect/', '');
      const checkAuth = setInterval(() => {
        const myMember = Auth.getMember();
        if (myMember) {
          clearInterval(checkAuth);
          showOverlay(myMember.id, memberId);
        }
      }, 500);
      setTimeout(() => clearInterval(checkAuth), 10000);
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
  };
})();
