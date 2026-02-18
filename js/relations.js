/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Relationship UI Management
   Rendering, searching, adding, deleting relationships
   ═══════════════════════════════════════════════════════════ */

const Relations = (() => {

  const REL_LABELS = Utils.REL_LABELS;

  // Shared state — selectedRelTarget and pendingFirstRelation are managed here
  // but consumed by Profile.save() via getters
  let selectedRelTarget = null;
  let pendingFirstRelation = null;

  /**
   * Create a relationship between two members based on the UI direction type.
   */
  async function createRelationByType(fromId, toId, relType) {
    if (relType === 'parent') {
      await DB.addRelationship(fromId, toId, Utils.REL_TYPES.PARENT_CHILD);
    } else if (relType === 'child') {
      await DB.addRelationship(toId, fromId, Utils.REL_TYPES.PARENT_CHILD);
    } else if (relType === 'spouse') {
      await DB.addRelationship(fromId, toId, Utils.REL_TYPES.SPOUSE);
    } else if (relType === 'sibling') {
      await DB.addRelationship(fromId, toId, Utils.REL_TYPES.SIBLING);
    }
  }

  /**
   * Render the relationships list in the profile view (read-only).
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

    const cachedMembers = App.getCachedMembers();
    const nameMap = new Map();
    for (const m of cachedMembers) {
      nameMap.set(m.id, `${m.firstName} ${m.lastName}`);
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

      const badge = Utils.createEl('span', { className: `rel-type-badge ${displayType}`, textContent: REL_LABELS[displayType] });
      const nameSpan = Utils.createEl('span', { className: 'rel-name', textContent: otherName });
      nameSpan.addEventListener('click', () => Profile.show(otherId));
      const item = Utils.createEl('div', { className: 'rel-item' }, [badge, nameSpan]);

      list.appendChild(item);
    }
  }

  /**
   * Render existing relationships in the edit view (with delete buttons).
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
    const cachedMembers = App.getCachedMembers();
    for (const m of cachedMembers) {
      nameMap.set(m.id, `${m.firstName} ${m.lastName}`);
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

      const badge = Utils.createEl('span', { className: `rel-type-badge ${displayType}`, textContent: REL_LABELS[displayType] });
      const nameSpan = Utils.createEl('span', { className: 'rel-name', textContent: otherName });
      const deleteBtn = Utils.createEl('button', { className: 'rel-delete', title: 'Verbindung löschen', textContent: '\u00d7' });
      const item = Utils.createEl('div', { className: 'rel-item' }, [badge, nameSpan, deleteBtn]);

      deleteBtn.addEventListener('click', async (e) => {
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
   * Search for a person to add as relation.
   */
  async function searchForRelation(query) {
    const resultsEl = document.getElementById('edit-rel-results');
    const editingMemberId = Profile.getEditingMemberId();

    if (!query || query.length < 2) {
      resultsEl.innerHTML = '';
      return;
    }

    const results = await DB.searchMembers(query);
    const filtered = results.filter(m => m.id !== editingMemberId);

    if (filtered.length > 0) {
      resultsEl.innerHTML = '';
      for (const m of filtered.slice(0, 5)) {
        const label = m.birthDate
          ? `${m.firstName} ${m.lastName} (* ${m.birthDate.substring(0, 4)})`
          : `${m.firstName} ${m.lastName}`;
        const item = Utils.createEl('div', { className: 'mini-result-item', textContent: label });
        item.dataset.id = m.id;
        item.addEventListener('click', () => {
          selectedRelTarget = m.id;
          document.getElementById('edit-rel-search').value = label.trim();
          resultsEl.innerHTML = '';
          if (!editingMemberId) updatePendingRelDisplay();
        });
        resultsEl.appendChild(item);
      }
    } else {
      showCreateNewPersonForm(query, false);
    }
  }

  /**
   * Show an inline mini-form to create a new person and link them.
   */
  function showCreateNewPersonForm(query, switchToProfile) {
    const parts = query.trim().split(' ');
    const preFirstName = parts[0] || '';
    const preLastName = parts.slice(1).join(' ') || '';

    const resultsEl = document.getElementById('edit-rel-results');
    resultsEl.innerHTML = '';

    const firstNameInput = Utils.createEl('input', { type: 'text', id: 'new-rel-firstname', placeholder: 'Vorname' });
    firstNameInput.value = preFirstName;
    const lastNameInput = Utils.createEl('input', { type: 'text', id: 'new-rel-lastname', placeholder: 'Nachname' });
    lastNameInput.value = preLastName;
    const birthDateInput = Utils.createEl('input', { type: 'date', id: 'new-rel-birthdate' });
    Utils.attachDateAutoCorrect(birthDateInput);
    const confirmBtn = Utils.createEl('button', {
      className: 'btn btn-primary btn-small',
      style: { width: '100%' },
      textContent: 'Anlegen & verbinden',
    });

    const formWrap = Utils.createEl('div', {
      className: 'create-new-inline',
      style: { padding: '12px', border: '2px solid var(--trace-faint)', borderRadius: '4px', marginTop: '4px' },
    }, [
      Utils.createEl('p', {
        style: { fontSize: '12px', color: 'var(--text-secondary)', marginBottom: '10px', fontWeight: '600' },
        textContent: 'Neue Person anlegen',
      }),
      Utils.createEl('div', { className: 'input-group', style: { marginBottom: '8px' } }, [
        Utils.createEl('label', { textContent: 'Vorname *' }), firstNameInput,
      ]),
      Utils.createEl('div', { className: 'input-group', style: { marginBottom: '8px' } }, [
        Utils.createEl('label', { textContent: 'Nachname *' }), lastNameInput,
      ]),
      Utils.createEl('div', { className: 'input-group', style: { marginBottom: '10px' } }, [
        Utils.createEl('label', { textContent: 'Geburtsdatum *' }), birthDateInput,
      ]),
      confirmBtn,
    ]);
    resultsEl.appendChild(formWrap);

    confirmBtn.addEventListener('click', async () => {
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
      const dateCheck = Utils.validateDate(birthDate);
      if (!dateCheck.valid) {
        App.toast(`Geburtsdatum: ${dateCheck.message}`, 'error');
        return;
      }

      const relType = document.getElementById('edit-rel-type').value;
      if (!relType) {
        App.toast('Bitte wähle zuerst einen Beziehungstyp', 'error');
        return;
      }

      let editingMemberId = Profile.getEditingMemberId();

      // If editing a new person that hasn't been saved yet, save first
      if (!editingMemberId) {
        await Profile.save();
        editingMemberId = Profile.getEditingMemberId();
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
          await createRelationByType(sourceId, newId, relType);
          await propagateLogicalRelations(sourceId, newId, relType);
          App.toast(`${firstName} ${lastName} angelegt & verbunden`, 'success');
        }

        await App.refreshTree();

        if (switchToProfile) {
          Profile.edit(newId);
        } else {
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
   * When adding a sibling, copy parent relationships from the existing sibling.
   * Kept as a convenience alias for backwards compatibility.
   */
  async function inheritParentsForSibling(existingSiblingId, newSiblingId) {
    await propagateLogicalRelations(existingSiblingId, newSiblingId, 'sibling');
  }

  /**
   * Propagate logically implied relationships after adding a new relation.
   * DB.addRelationship() already deduplicates, so we can call it freely.
   *
   * Rules:
   *  sibling(A,B):   B gets A's parents, A gets B's parents
   *  child(A→B):     A = parent, B = child.
   *                  B gets A's other children as siblings.
   *                  A gets B's existing siblings as own children.
   *  parent(A→B):    A = child, B = parent (stored as B→A parent_child).
   *                  A gets B's other children as siblings.
   *                  B gets A's existing siblings as own children.
   *  spouse(A,B):    B gets A's children as own children.
   *                  A gets B's children as own children.
   */
  async function propagateLogicalRelations(fromId, toId, relType) {
    const PC = 'parent_child';
    const SIB = 'sibling';

    if (relType === 'sibling') {
      // Both siblings share parents
      const relsA = await DB.getRelationshipsForMember(fromId);
      const relsB = await DB.getRelationshipsForMember(toId);
      const parentsA = relsA.filter(r => r.type === PC && r.toId === fromId).map(r => r.fromId);
      const parentsB = relsB.filter(r => r.type === PC && r.toId === toId).map(r => r.fromId);
      for (const pid of parentsA) await DB.addRelationship(pid, toId, PC);
      for (const pid of parentsB) await DB.addRelationship(pid, fromId, PC);

    } else if (relType === 'child') {
      // fromId = parent, toId = child (parent_child stored as fromId→toId)
      const parentId = fromId, childId = toId;
      const parentRels = await DB.getRelationshipsForMember(parentId);

      // Other children of this parent become siblings of the new child
      const otherChildren = parentRels
        .filter(r => r.type === PC && r.fromId === parentId && r.toId !== childId)
        .map(r => r.toId);
      for (const sibId of otherChildren) {
        await DB.addRelationship(childId, sibId, SIB);
      }

      // Existing siblings of the child become children of this parent
      const childRels = await DB.getRelationshipsForMember(childId);
      const childSiblings = childRels
        .filter(r => r.type === SIB)
        .map(r => r.fromId === childId ? r.toId : r.fromId);
      for (const sibId of childSiblings) {
        await DB.addRelationship(parentId, sibId, PC);
      }

    } else if (relType === 'parent') {
      // fromId = child, toId = parent (parent_child stored as toId→fromId)
      const parentId = toId, childId = fromId;
      const parentRels = await DB.getRelationshipsForMember(parentId);

      // Other children of this parent become siblings of the child
      const otherChildren = parentRels
        .filter(r => r.type === PC && r.fromId === parentId && r.toId !== childId)
        .map(r => r.toId);
      for (const sibId of otherChildren) {
        await DB.addRelationship(childId, sibId, SIB);
      }

      // Existing siblings of the child become children of this parent
      const childRels = await DB.getRelationshipsForMember(childId);
      const childSiblings = childRels
        .filter(r => r.type === SIB)
        .map(r => r.fromId === childId ? r.toId : r.fromId);
      for (const sibId of childSiblings) {
        await DB.addRelationship(parentId, sibId, PC);
      }

    } else if (relType === 'spouse') {
      // Both spouses share children
      const relsA = await DB.getRelationshipsForMember(fromId);
      const relsB = await DB.getRelationshipsForMember(toId);
      const childrenA = relsA.filter(r => r.type === PC && r.fromId === fromId).map(r => r.toId);
      const childrenB = relsB.filter(r => r.type === PC && r.fromId === toId).map(r => r.toId);
      for (const cid of childrenA) await DB.addRelationship(toId, cid, PC);
      for (const cid of childrenB) await DB.addRelationship(fromId, cid, PC);
    }
  }

  /**
   * Check for and remove conflicting relationships before adding a new one.
   */
  async function cleanConflictingRelations(memberId, targetId, newRelType) {
    const rels = await DB.getRelationshipsForMember(memberId);
    const toRemove = [];

    for (const r of rels) {
      const otherId = r.fromId === memberId ? r.toId : r.fromId;
      if (otherId !== targetId) continue;

      let existingType;
      if (r.type === 'parent_child') {
        existingType = r.fromId === memberId ? 'parent_of' : 'child_of';
      } else {
        existingType = r.type;
      }

      let newType;
      if (newRelType === 'parent') {
        newType = 'parent_of';
      } else if (newRelType === 'child') {
        newType = 'child_of';
      } else {
        newType = newRelType;
      }

      const conflictPairs = [
        ['parent_of', 'child_of'],
        ['parent_of', 'sibling'],
        ['child_of', 'sibling'],
        ['parent_of', 'spouse'],
        ['child_of', 'spouse'],
        ['sibling', 'spouse'],
      ];

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
   */
  function updatePendingRelDisplay() {
    const displayEl = document.getElementById('pending-rel-display');
    if (!displayEl) return;

    const relType = document.getElementById('edit-rel-type').value;
    const searchName = document.getElementById('edit-rel-search').value.trim();

    if (relType && selectedRelTarget && searchName) {
      pendingFirstRelation = { targetId: selectedRelTarget, relType };
      const label = REL_LABELS[relType] || relType;

      const badge = Utils.createEl('span', { className: `rel-type-badge ${relType}`, textContent: label });
      const nameSpan = Utils.createEl('span', { className: 'rel-name', textContent: searchName });
      const deleteBtn = Utils.createEl('button', { className: 'rel-delete', title: 'Entfernen', textContent: '\u00d7' });
      const relItem = Utils.createEl('div', { className: 'rel-item', style: { marginTop: '8px' } }, [badge, nameSpan, deleteBtn]);

      displayEl.innerHTML = '';
      displayEl.appendChild(relItem);

      deleteBtn.addEventListener('click', () => {
        pendingFirstRelation = null;
        selectedRelTarget = null;
        document.getElementById('edit-rel-search').value = '';
        document.getElementById('edit-rel-type').value = '';
        displayEl.innerHTML = '';
      });
    } else {
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

    const editingMemberId = Profile.getEditingMemberId();
    if (!editingMemberId || !selectedRelTarget) {
      App.toast('Bitte wähle eine Person aus', 'error');
      return;
    }

    try {
      const removed = await cleanConflictingRelations(editingMemberId, selectedRelTarget, relType);
      if (removed > 0) {
        App.toast(`${removed} widersprüchliche Verbindung${removed > 1 ? 'en' : ''} entfernt`, 'info');
      }

      await createRelationByType(editingMemberId, selectedRelTarget, relType);
      await propagateLogicalRelations(editingMemberId, selectedRelTarget, relType);

      App.toast('Verbindung hinzugefügt', 'success');
      document.getElementById('edit-rel-type').value = '';
      document.getElementById('edit-rel-search').value = '';
      document.getElementById('edit-rel-results').innerHTML = '';
      selectedRelTarget = null;

      await App.refreshTree();
      await renderEditRelations(editingMemberId);
    } catch (err) {
      console.error('Relation error:', err);
      App.toast('Fehler beim Hinzufügen', 'error');
    }
  }

  // ─── State Accessors (used by Profile.save) ───

  function getPendingFirstRelation() {
    return pendingFirstRelation;
  }

  function clearPendingFirstRelation() {
    pendingFirstRelation = null;
  }

  function resetState() {
    selectedRelTarget = null;
    pendingFirstRelation = null;
  }

  return {
    createRelationByType,
    renderProfileRelations,
    renderEditRelations,
    searchForRelation,
    addRelation,
    updatePendingRelDisplay,
    cleanConflictingRelations,
    inheritParentsForSibling,
    propagateLogicalRelations,
    getPendingFirstRelation,
    clearPendingFirstRelation,
    resetState,
  };
})();
