/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Profile Management
   ═══════════════════════════════════════════════════════════ */

const Profile = (() => {
  let currentProfileId = null;
  let editingMemberId = null;
  let selectedRelTarget = null;
  let pendingFirstRelation = null;

  // ─── German labels for relationship types ───
  const REL_LABELS = {
    parent: 'Elternteil',
    child: 'Kind',
    spouse: 'Partner',
    sibling: 'Geschwister',
  };

  /**
   * Show a member's profile.
   */
  async function show(memberId) {
    currentProfileId = memberId;
    const member = await DB.getMember(memberId);
    if (!member) {
      App.toast('Profil nicht gefunden', 'error');
      return;
    }

    // Fill profile view
    const nameEl = document.getElementById('profile-name');
    const birthnameEl = document.getElementById('profile-birthname');
    const photoEl = document.getElementById('profile-photo');
    const birthdateEl = document.getElementById('profile-birthdate');
    const deathdateEl = document.getElementById('profile-deathdate');
    const deathdateRow = document.getElementById('profile-deathdate-row');
    const locationEl = document.getElementById('profile-location');
    const contactEl = document.getElementById('profile-contact');
    const notesEl = document.getElementById('profile-notes');
    const badgesEl = document.getElementById('profile-badges');

    nameEl.textContent = `${member.firstName} ${member.lastName}`;
    birthnameEl.textContent = member.birthName || '';
    birthnameEl.style.display = member.birthName ? '' : 'none';

    // Photo
    if (member.photo) {
      photoEl.innerHTML = `<img src="${member.photo}" alt="${member.firstName}">`;
    } else {
      const initials = `${member.firstName[0]}${member.lastName[0]}`.toUpperCase();
      photoEl.innerHTML = `<span style="font-size:36px;font-weight:600;color:#9ca3af">${initials}</span>`;
    }

    // Details
    birthdateEl.textContent = member.birthDate ? formatDate(member.birthDate) : '—';
    if (member.isDeceased && member.deathDate) {
      deathdateEl.textContent = formatDate(member.deathDate);
      deathdateRow.style.display = '';
    } else {
      deathdateRow.style.display = 'none';
    }
    locationEl.textContent = member.location || '—';
    contactEl.textContent = member.contact || member.email || '—';
    notesEl.textContent = member.notes || '—';

    // Badges
    badgesEl.innerHTML = '';
    if (member.isDeceased) {
      badgesEl.innerHTML += '<span class="badge badge-deceased">✝ Verstorben</span>';
    }
    if (member.claimedByUid) {
      // Claimed members are registered, never show "Platzhalter"
      badgesEl.innerHTML += '<span class="badge">✓ Registriert</span>';
    } else if (member.isPlaceholder) {
      badgesEl.innerHTML += '<span class="badge badge-placeholder">◌ Platzhalter</span>';
    }

    // Everyone can edit any profile (for adding/removing relationships)
    const user = Auth.getUser();
    const myMember = Auth.getMember();
    document.getElementById('btn-profile-edit').style.display = '';

    // Show/hide "How are we connected?" button
    const showConnBtn = myMember && myMember.id !== memberId;
    document.getElementById('btn-show-connection').style.display = showConnBtn ? '' : 'none';

    // Show/hide delete button: only for true placeholders (not claimed), and not own profile
    const isTruePlaceholder = member.isPlaceholder && !member.claimedByUid;
    const canDelete = isTruePlaceholder && (!myMember || myMember.id !== memberId);
    document.getElementById('btn-delete-member').style.display = canDelete ? '' : 'none';

    // Show existing relationships
    await renderProfileRelations(memberId);

    App.showView('view-profile');
  }

  /**
   * Render the relationships list in the profile view.
   */
  async function renderProfileRelations(memberId) {
    const section = document.getElementById('profile-relations');
    const list = document.getElementById('profile-relations-list');

    const rels = await DB.getRelationshipsForMember(memberId);
    if (rels.length === 0) {
      section.style.display = 'none';
      return;
    }

    section.style.display = '';
    list.innerHTML = '';

    // We need member names for display
    const memberIds = new Set();
    for (const r of rels) {
      memberIds.add(r.fromId);
      memberIds.add(r.toId);
    }
    memberIds.delete(memberId);

    // Get names from cached data (via App) or fetch individually
    const nameMap = new Map();
    for (const id of memberIds) {
      const m = await DB.getMember(id);
      if (m) nameMap.set(id, `${m.firstName} ${m.lastName}`);
    }

    for (const r of rels) {
      const otherId = r.fromId === memberId ? r.toId : r.fromId;
      const otherName = nameMap.get(otherId) || 'Unbekannt';

      // Determine the readable type from this member's perspective
      let displayType;
      if (r.type === 'parent_child') {
        displayType = r.fromId === memberId ? 'child' : 'parent';
        // fromId is parent, toId is child
        // So if fromId === memberId, this member IS the parent → the other is their child
        // If toId === memberId, this member IS the child → the other is their parent
      } else {
        displayType = r.type; // 'spouse' or 'sibling'
      }

      const item = document.createElement('div');
      item.className = 'rel-item';
      item.innerHTML = `
        <span class="rel-type-badge ${displayType}">${REL_LABELS[displayType]}</span>
        <span class="rel-name">${otherName}</span>
      `;

      // Click on name → go to that person's profile
      item.querySelector('.rel-name').addEventListener('click', () => {
        show(otherId);
      });

      list.appendChild(item);
    }
  }

  /**
   * Open edit form for a member.
   */
  async function edit(memberId) {
    editingMemberId = memberId;
    selectedRelTarget = null;
    pendingFirstRelation = null;

    let member = null;
    if (memberId) {
      member = await DB.getMember(memberId);
    }

    // Fill form
    document.getElementById('edit-firstname').value = member?.firstName || '';
    document.getElementById('edit-lastname').value = member?.lastName || '';
    document.getElementById('edit-birthname').value = member?.birthName || '';
    document.getElementById('edit-birthdate').value = member?.birthDate || '';
    document.getElementById('edit-deathdate').value = member?.deathDate || '';
    document.getElementById('edit-location').value = member?.location || '';
    document.getElementById('edit-email').value = member?.contact || member?.email || '';
    document.getElementById('edit-phone').value = member?.phone || '';
    document.getElementById('edit-photo').value = member?.photo || '';
    document.getElementById('edit-notes').value = member?.notes || '';

    // Clear relation search
    document.getElementById('edit-rel-type').value = '';
    document.getElementById('edit-rel-search').value = '';
    document.getElementById('edit-rel-results').innerHTML = '';

    const btnAddRel = document.getElementById('btn-add-relation');

    // Update header text
    const editTitle = document.querySelector('.edit-header h2');
    if (editTitle) {
      editTitle.textContent = memberId ? 'Profil bearbeiten' : 'Neue Person anlegen';
    }

    // Mark birthdate as required for new persons
    const birthLabel = document.querySelector('#edit-birthdate')?.closest('.input-group')?.querySelector('label');
    if (birthLabel) {
      birthLabel.textContent = memberId ? 'Geburtsdatum' : 'Geburtsdatum *';
    }

    if (!memberId) {
      // New person mode: hide "Verbindung hinzufügen" button, show pending display
      btnAddRel.style.display = 'none';
      const container = document.getElementById('edit-existing-rels');
      container.innerHTML = `
        <div class="rel-empty">
          Wähle unten eine Verbindung zu einer bestehenden Person (Pflichtfeld).
        </div>
        <div id="pending-rel-display"></div>
      `;
    } else {
      // Existing person: show button, render existing relationships
      btnAddRel.style.display = '';
      await renderEditRelations(memberId);
    }

    App.showView('view-edit');
  }

  /**
   * Render existing relationships in the edit view.
   */
  async function renderEditRelations(memberId) {
    const container = document.getElementById('edit-existing-rels');
    if (!memberId) {
      container.innerHTML = '<div class="rel-empty">Noch keine Verbindungen. Speichere zuerst das Profil.</div>';
      return;
    }

    const rels = await DB.getRelationshipsForMember(memberId);
    if (rels.length === 0) {
      container.innerHTML = '<div class="rel-empty">Noch keine Verbindungen vorhanden.</div>';
      return;
    }

    container.innerHTML = '';

    const nameMap = new Map();
    const ids = new Set();
    for (const r of rels) {
      ids.add(r.fromId);
      ids.add(r.toId);
    }
    ids.delete(memberId);
    for (const id of ids) {
      const m = await DB.getMember(id);
      if (m) nameMap.set(id, `${m.firstName} ${m.lastName}`);
    }

    for (const r of rels) {
      const otherId = r.fromId === memberId ? r.toId : r.fromId;
      const otherName = nameMap.get(otherId) || 'Unbekannt';

      let displayType;
      if (r.type === 'parent_child') {
        displayType = r.fromId === memberId ? 'child' : 'parent';
      } else {
        displayType = r.type;
      }

      const item = document.createElement('div');
      item.className = 'rel-item';
      item.innerHTML = `
        <span class="rel-type-badge ${displayType}">${REL_LABELS[displayType]}</span>
        <span class="rel-name">${otherName}</span>
        <button class="rel-delete" title="Verbindung löschen">&times;</button>
      `;

      item.querySelector('.rel-delete').addEventListener('click', async (e) => {
        e.stopPropagation();
        const typeName = REL_LABELS[displayType];
        if (!confirm(`Verbindung "${typeName}: ${otherName}" wirklich löschen?`)) return;
        try {
          await DB.removeRelationship(r.id);
          App.toast('Verbindung gelöscht', 'success');
          await App.refreshTree();
          await renderEditRelations(memberId);
        } catch (err) {
          console.error('Delete relation error:', err);
          App.toast('Fehler beim Löschen', 'error');
        }
      });

      container.appendChild(item);
    }
  }

  /**
   * Save profile changes.
   */
  async function save() {
    const firstName = document.getElementById('edit-firstname').value.trim();
    const lastName = document.getElementById('edit-lastname').value.trim();
    const birthDate = document.getElementById('edit-birthdate').value;

    if (!firstName || !lastName) {
      App.toast('Vor- und Nachname sind Pflichtfelder', 'error');
      return;
    }

    // Birthdate is mandatory for NEW persons (so they can be placed correctly)
    if (!editingMemberId && !birthDate) {
      App.toast('Geburtsdatum ist Pflichtfeld für neue Personen', 'error');
      return;
    }

    // New person: must have a relationship
    if (!editingMemberId && !pendingFirstRelation) {
      App.toast('Bitte wähle eine Verbindung zu einer bestehenden Person', 'error');
      return;
    }

    const data = {
      firstName,
      lastName,
      birthName: document.getElementById('edit-birthname').value.trim(),
      birthDate,
      deathDate: document.getElementById('edit-deathdate').value,
      isDeceased: !!document.getElementById('edit-deathdate').value,
      location: document.getElementById('edit-location').value.trim(),
      contact: document.getElementById('edit-email').value.trim(),
      phone: document.getElementById('edit-phone').value.trim(),
      photo: document.getElementById('edit-photo').value.trim(),
      notes: document.getElementById('edit-notes').value.trim(),
    };

    try {
      if (editingMemberId) {
        await DB.updateMember(editingMemberId, data);
        App.toast('Profil gespeichert', 'success');
      } else {
        // Creating new member
        data.isPlaceholder = true;
        data.claimedByUid = null;
        data.createdBy = Auth.getUser()?.id || null;
        const newId = await DB.createMember(data);
        editingMemberId = newId;

        // Create pending first relation (guaranteed to exist by validation above)
        if (pendingFirstRelation) {
          const { targetId, relType } = pendingFirstRelation;
          await cleanConflictingRelations(newId, targetId, relType);
          if (relType === 'parent') {
            await DB.addRelationship(newId, targetId, 'parent_child');
          } else if (relType === 'child') {
            await DB.addRelationship(targetId, newId, 'parent_child');
          } else if (relType === 'spouse') {
            await DB.addRelationship(newId, targetId, 'spouse');
          } else if (relType === 'sibling') {
            await DB.addRelationship(newId, targetId, 'sibling');
            await inheritParentsForSibling(targetId, newId);
          }
          pendingFirstRelation = null;
          App.toast('Person angelegt & verbunden', 'success');
        }
      }

      // Reload tree
      await App.refreshTree();

      // Go back to profile
      if (editingMemberId) {
        show(editingMemberId);
      } else {
        App.showView('view-main');
      }
    } catch (err) {
      console.error('Save error:', err);
      App.toast('Fehler beim Speichern', 'error');
    }
  }

  /**
   * Search for a person to add as relation.
   */
  async function searchForRelation(query) {
    const resultsEl = document.getElementById('edit-rel-results');
    if (!query || query.length < 2) {
      resultsEl.innerHTML = '';
      return;
    }

    const results = await DB.searchMembers(query);
    // Filter out self
    const filtered = results.filter(m => m.id !== editingMemberId);

    if (filtered.length > 0) {
      // Show matching results
      resultsEl.innerHTML = filtered.slice(0, 5).map(m => `
        <div class="mini-result-item" data-id="${m.id}">
          ${m.firstName} ${m.lastName}
          ${m.birthDate ? ` (* ${m.birthDate.substring(0, 4)})` : ''}
        </div>
      `).join('');

      resultsEl.querySelectorAll('.mini-result-item').forEach(el => {
        el.addEventListener('click', () => {
          selectedRelTarget = el.dataset.id;
          document.getElementById('edit-rel-search').value = el.textContent.trim();
          resultsEl.innerHTML = '';
          // If new person mode, update pending relation display
          if (!editingMemberId) updatePendingRelDisplay();
        });
      });
    } else {
      // No results — show inline creation form with mandatory fields
      showCreateNewPersonForm(query, false);
    }
  }

  /**
   * Show an inline mini-form in the search results area to create a new person.
   * Requires: first name, last name, birthdate (all mandatory).
   * Then links them with the selected relationship type.
   * @param {string} query - The typed name (used to pre-fill)
   * @param {boolean} switchToProfile - If true, navigate to the new person's edit form after creation
   */
  function showCreateNewPersonForm(query, switchToProfile) {
    const parts = query.trim().split(' ');
    const preFirstName = parts[0] || '';
    const preLastName = parts.slice(1).join(' ') || '';

    const resultsEl = document.getElementById('edit-rel-results');
    resultsEl.innerHTML = `
      <div class="create-new-inline" style="padding:12px; border:2px solid var(--trace-faint); border-radius:4px; margin-top:4px;">
        <p style="font-size:12px; color:var(--text-secondary); margin-bottom:10px; font-weight:600;">
          Neue Person anlegen
        </p>
        <div class="input-group" style="margin-bottom:8px;">
          <label>Vorname *</label>
          <input type="text" id="new-rel-firstname" value="${preFirstName}" placeholder="Vorname">
        </div>
        <div class="input-group" style="margin-bottom:8px;">
          <label>Nachname *</label>
          <input type="text" id="new-rel-lastname" value="${preLastName}" placeholder="Nachname">
        </div>
        <div class="input-group" style="margin-bottom:10px;">
          <label>Geburtsdatum *</label>
          <input type="date" id="new-rel-birthdate">
        </div>
        <button class="btn btn-primary btn-small btn-confirm-create" style="width:100%;">Anlegen & verbinden</button>
      </div>
    `;

    resultsEl.querySelector('.btn-confirm-create').addEventListener('click', async () => {
      const firstName = document.getElementById('new-rel-firstname').value.trim();
      const lastName = document.getElementById('new-rel-lastname').value.trim();
      const birthDate = document.getElementById('new-rel-birthdate').value;

      if (!firstName || !lastName) {
        App.toast('Vor- und Nachname sind Pflichtfelder', 'error');
        return;
      }
      if (!birthDate) {
        App.toast('Geburtsdatum ist Pflichtfeld', 'error');
        return;
      }

      const relType = document.getElementById('edit-rel-type').value;
      if (!relType) {
        App.toast('Bitte wähle zuerst einen Beziehungstyp', 'error');
        return;
      }

      // If editing a new person that hasn't been saved yet, save first
      if (!editingMemberId) {
        await save();
        if (!editingMemberId) return; // save failed
      }

      const sourceId = editingMemberId;

      try {
        const newId = await DB.createMember({
          firstName,
          lastName,
          birthName: '',
          birthDate,
          deathDate: '',
          isDeceased: false,
          isPlaceholder: true,
          claimedByUid: null,
          createdBy: Auth.getUser()?.id || null,
          location: '',
          contact: '',
          photo: '',
          notes: '',
        });

        if (sourceId) {
          await cleanConflictingRelations(sourceId, newId, relType);
          if (relType === 'parent') {
            await DB.addRelationship(sourceId, newId, 'parent_child');
          } else if (relType === 'child') {
            await DB.addRelationship(newId, sourceId, 'parent_child');
          } else if (relType === 'spouse') {
            await DB.addRelationship(sourceId, newId, 'spouse');
          } else if (relType === 'sibling') {
            await DB.addRelationship(sourceId, newId, 'sibling');
            await inheritParentsForSibling(sourceId, newId);
          }
          App.toast(`${firstName} ${lastName} angelegt & verbunden`, 'success');
        }

        await App.refreshTree();

        if (switchToProfile) {
          edit(newId);
        } else {
          // Clear search and refresh relations list
          document.getElementById('edit-rel-search').value = '';
          resultsEl.innerHTML = '';
          await renderEditRelations(editingMemberId);
        }
      } catch (err) {
        console.error('Create person error:', err);
        App.toast('Fehler beim Anlegen', 'error');
      }
    });
  }

  /**
   * When adding a sibling, copy parent relationships from the existing sibling
   * so the new person is placed correctly in the tree layout.
   * The layout positions people based on parent-child edges, so a sibling-only
   * connection would leave the new person floating as a disconnected root.
   */
  async function inheritParentsForSibling(existingSiblingId, newSiblingId) {
    const rels = await DB.getRelationshipsForMember(existingSiblingId);
    for (const r of rels) {
      if (r.type !== 'parent_child') continue;
      // existingSibling is child → fromId is parent, toId is existingSibling
      if (r.toId === existingSiblingId) {
        const parentId = r.fromId;
        // Check if this parent-child link already exists
        const existingRels = await DB.getRelationshipsForMember(newSiblingId);
        const alreadyLinked = existingRels.some(
          er => er.type === 'parent_child' && er.fromId === parentId && er.toId === newSiblingId
        );
        if (!alreadyLinked) {
          await DB.addRelationship(parentId, newSiblingId, 'parent_child');
        }
      }
    }
  }

  /**
   * Check for and remove conflicting relationships before adding a new one.
   *
   * Rules:
   * - Can't be both parent-of AND child-of same person
   * - Can't be both parent-of AND sibling-of same person
   * - Can't be both child-of AND sibling-of same person
   * - Can't have duplicate spouse edges
   * - Can't be parent AND spouse of same person
   * - Can't be child AND spouse of same person
   * - Can't be sibling AND spouse of same person
   *
   * When adding a new connection, conflicting old ones are removed.
   */
  async function cleanConflictingRelations(memberId, targetId, newRelType) {
    const rels = await DB.getRelationshipsForMember(memberId);
    const toRemove = [];

    for (const r of rels) {
      const otherId = r.fromId === memberId ? r.toId : r.fromId;
      if (otherId !== targetId) continue;

      // Determine the type from memberId's perspective
      let existingType;
      if (r.type === 'parent_child') {
        existingType = r.fromId === memberId ? 'parent_of' : 'child_of';
      } else {
        existingType = r.type; // 'spouse' or 'sibling'
      }

      // Determine the new type from memberId's perspective
      let newType;
      if (newRelType === 'parent') {
        newType = 'parent_of'; // memberId is parent of target
      } else if (newRelType === 'child') {
        newType = 'child_of'; // memberId is child of target
      } else {
        newType = newRelType; // 'spouse' or 'sibling'
      }

      // Check conflicts — any existing relationship between the same two people
      // that conflicts with the new one should be removed
      const conflictPairs = [
        ['parent_of', 'child_of'],   // can't be parent AND child of same person
        ['parent_of', 'sibling'],    // can't be parent AND sibling of same person
        ['child_of', 'sibling'],     // can't be child AND sibling of same person
        ['parent_of', 'spouse'],     // can't be parent AND spouse of same person
        ['child_of', 'spouse'],      // can't be child AND spouse of same person
        ['sibling', 'spouse'],       // can't be sibling AND spouse of same person
      ];

      // If it's a duplicate of the same type, also conflict
      if (existingType === newType) {
        toRemove.push(r);
        continue;
      }

      for (const [a, b] of conflictPairs) {
        if ((existingType === a && newType === b) ||
            (existingType === b && newType === a)) {
          toRemove.push(r);
          break;
        }
      }
    }

    // Remove conflicting relationships
    for (const r of toRemove) {
      try {
        await DB.removeRelationship(r.id);
      } catch (err) {
        console.error('Failed to remove conflicting relation:', err);
      }
    }

    return toRemove.length;
  }

  /**
   * Update the pending first-relation preview chip (new person mode only).
   * Called when user selects a search result or changes the relation type.
   */
  function updatePendingRelDisplay() {
    const displayEl = document.getElementById('pending-rel-display');
    if (!displayEl) return;

    const relType = document.getElementById('edit-rel-type').value;
    const searchName = document.getElementById('edit-rel-search').value.trim();

    if (relType && selectedRelTarget && searchName) {
      pendingFirstRelation = { targetId: selectedRelTarget, relType };
      const label = REL_LABELS[relType] || relType;
      displayEl.innerHTML = `
        <div class="rel-item" style="margin-top:8px;">
          <span class="rel-type-badge ${relType}">${label}</span>
          <span class="rel-name">${searchName}</span>
          <button class="rel-delete" title="Entfernen">&times;</button>
        </div>
      `;
      displayEl.querySelector('.rel-delete').addEventListener('click', () => {
        pendingFirstRelation = null;
        selectedRelTarget = null;
        document.getElementById('edit-rel-search').value = '';
        document.getElementById('edit-rel-type').value = '';
        displayEl.innerHTML = '';
      });
    } else {
      // Not enough data yet — clear display but don't reset selection
      pendingFirstRelation = null;
      displayEl.innerHTML = '';
    }
  }

  /**
   * Add a relationship between the editing member and selected target.
   */
  async function addRelation() {
    const relType = document.getElementById('edit-rel-type').value;
    if (!relType) {
      App.toast('Bitte wähle zuerst einen Beziehungstyp', 'error');
      return;
    }

    if (!editingMemberId || !selectedRelTarget) {
      App.toast('Bitte wähle eine Person aus', 'error');
      return;
    }

    try {
      // Clean conflicting relationships first
      const removed = await cleanConflictingRelations(editingMemberId, selectedRelTarget, relType);
      if (removed > 0) {
        App.toast(`${removed} widersprüchliche Verbindung${removed > 1 ? 'en' : ''} entfernt`, 'info');
      }

      if (relType === 'parent') {
        // This member is parent of target
        await DB.addRelationship(editingMemberId, selectedRelTarget, 'parent_child');
      } else if (relType === 'child') {
        // This member is child of target (target is parent)
        await DB.addRelationship(selectedRelTarget, editingMemberId, 'parent_child');
      } else if (relType === 'spouse') {
        await DB.addRelationship(editingMemberId, selectedRelTarget, 'spouse');
      } else if (relType === 'sibling') {
        await DB.addRelationship(editingMemberId, selectedRelTarget, 'sibling');
        // Copy parents in both directions so both siblings share the same parents
        await inheritParentsForSibling(editingMemberId, selectedRelTarget);
        await inheritParentsForSibling(selectedRelTarget, editingMemberId);
      }

      App.toast('Verbindung hinzugefügt', 'success');
      document.getElementById('edit-rel-type').value = '';
      document.getElementById('edit-rel-search').value = '';
      document.getElementById('edit-rel-results').innerHTML = '';
      selectedRelTarget = null;

      await App.refreshTree();
      // Refresh the existing relations list in the edit view
      await renderEditRelations(editingMemberId);
    } catch (err) {
      console.error('Relation error:', err);
      App.toast('Fehler beim Hinzufügen', 'error');
    }
  }

  // addNewPersonAndRelate has been replaced by showCreateNewPersonForm

  function getCurrentProfileId() {
    return currentProfileId;
  }

  function getEditingMemberId() {
    return editingMemberId;
  }

  // ─── Helpers ───

  function formatDate(dateStr) {
    if (!dateStr) return '';
    try {
      const date = new Date(dateStr + 'T00:00:00');
      return date.toLocaleDateString('de-DE', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
      });
    } catch {
      return dateStr;
    }
  }

  return {
    show,
    edit,
    save,
    searchForRelation,
    addRelation,
    updatePendingRelDisplay,
    getCurrentProfileId,
    getEditingMemberId,
  };
})();
