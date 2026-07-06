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
    const memberMap = new Map();
    for (const m of cachedMembers) {
      memberMap.set(m.id, m);
    }

    for (const r of rels) {
      const otherId = r.fromId === memberId ? r.toId : r.fromId;
      const other = memberMap.get(otherId);
      const otherName = other ? `${other.firstName} ${other.lastName}` : 'Unbekannt';

      let displayType;
      if (r.type === 'parent_child') {
        displayType = r.fromId === memberId ? 'child' : 'parent';
      } else {
        displayType = r.type;
      }

      const label = other ? Utils.genderedRelLabel(displayType, other.gender) : REL_LABELS[displayType];
      const badge = Utils.createEl('span', { className: `rel-type-badge ${displayType}`, textContent: label });
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

    const memberMap = new Map();
    const cachedMembers = App.getCachedMembers();
    for (const m of cachedMembers) {
      memberMap.set(m.id, m);
    }

    for (const r of rels) {
      const otherId = r.fromId === memberId ? r.toId : r.fromId;
      const other = memberMap.get(otherId);
      const otherName = other ? `${other.firstName} ${other.lastName}` : 'Unbekannt';

      let displayType;
      if (r.type === 'parent_child') {
        displayType = r.fromId === memberId ? 'child' : 'parent';
      } else {
        displayType = r.type;
      }

      const label = other ? Utils.genderedRelLabel(displayType, other.gender) : REL_LABELS[displayType];
      const badge = Utils.createEl('span', { className: `rel-type-badge ${displayType}`, textContent: label });
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
    const genderSelect = Utils.createEl('select', { id: 'new-rel-gender' });
    genderSelect.innerHTML = '<option value="">— Bitte auswählen —</option><option value="m">Männlich</option><option value="f">Weiblich</option><option value="d">Divers</option>';
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
      Utils.createEl('div', { className: 'input-group', style: { marginBottom: '8px' } }, [
        Utils.createEl('label', { textContent: 'Geschlecht *' }), genderSelect,
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
      const newGender = document.getElementById('new-rel-gender').value;
      const birthDate = document.getElementById('new-rel-birthdate').value;

      if (!firstName || !lastName) {
        App.toast('Vor- und Nachname sind Pflichtfelder', 'error');
        return;
      }
      if (!newGender) {
        App.toast('Geschlecht ist ein Pflichtfeld', 'error');
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
          gender: newGender,
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
          const auto = await propagateLogicalRelations(sourceId, newId, relType);
          App.toast(`${firstName} ${lastName} angelegt & verbunden`, 'success');
          if (auto > 0) {
            App.toast(`${auto} Verbindung${auto > 1 ? 'en' : ''} automatisch ergänzt`, 'info');
          }
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
   *
   * Kaskadierende Regel-Engine: Jede automatisch ergänzte Beziehung wird
   * selbst wieder geprüft (Kind→Mutter ⇒ Vater ⇒ Geschwister ⇒ …), bis
   * nichts sicher Ableitbares mehr übrig ist. Der Beziehungsgraph wird
   * dafür EINMAL geladen und in-memory fortgeschrieben.
   *
   * Nur eindeutig sichere Ergänzungen:
   *  parent_child(P→C):
   *    a) Hat P genau EINEN Partner S (nie mehrere Ehen erfasst), wird S
   *       zweites Elternteil von C. Bei mehreren Ehen: mehrdeutig → nichts.
   *    b) Andere Kinder von P werden Geschwister von C.
   *    c) Explizite Geschwister von C erben P als Elternteil.
   *  sibling(A,B): Eltern werden gegenseitig kopiert.
   *  spouse(A,B):  Kinder werden geteilt — nur wenn es für BEIDE die
   *                einzige Ehe ist (Stiefeltern-Schutz).
   *  Hart überall: nie ein drittes Elternteil pro Kind.
   *
   * @returns {number} Anzahl automatisch ergänzter Beziehungen
   */
  async function propagateLogicalRelations(fromId, toId, relType) {
    const PC = 'parent_child', SIB = 'sibling', SP = 'spouse';

    const all = await DB.getAllRelationships();
    const parentsOf = new Map(), childrenOf = new Map(),
          spousesOf = new Map(), siblingsOf = new Map();
    const keys = new Set();
    const keyOf = (f, t, type) =>
      type === PC ? `${type}:${f}>${t}` : `${type}:${[f, t].sort().join('~')}`;
    const get = (map, k) => map.get(k) || new Set();
    const index = (f, t, type) => {
      keys.add(keyOf(f, t, type));
      const push = (map, k, v) => { if (!map.has(k)) map.set(k, new Set()); map.get(k).add(v); };
      if (type === PC) { push(parentsOf, t, f); push(childrenOf, f, t); }
      else if (type === SP) { push(spousesOf, f, t); push(spousesOf, t, f); }
      else if (type === SIB) { push(siblingsOf, f, t); push(siblingsOf, t, f); }
    };
    for (const r of all) index(r.fromId, r.toId, r.type);

    // Die soeben manuell angelegte Beziehung ist der Ausgangspunkt der Kaskade
    const queue = [];
    if (relType === 'parent') queue.push({ f: fromId, t: toId, type: PC });
    else if (relType === 'child') queue.push({ f: toId, t: fromId, type: PC });
    else if (relType === 'spouse') queue.push({ f: fromId, t: toId, type: SP });
    else if (relType === 'sibling') queue.push({ f: fromId, t: toId, type: SIB });

    let added = 0;
    const addRel = async (f, t, type) => {
      if (f === t || keys.has(keyOf(f, t, type))) return;
      if (type === PC && get(parentsOf, t).size >= 2) return;
      await DB.addRelationship(f, t, type);
      index(f, t, type);
      queue.push({ f, t, type });
      added++;
    };

    while (queue.length) {
      const { f, t, type } = queue.shift();

      if (type === PC) {
        const parentId = f, childId = t;
        const spouses = get(spousesOf, parentId);
        if (spouses.size === 1) {
          await addRel([...spouses][0], childId, PC);
        }
        for (const k of get(childrenOf, parentId)) {
          if (k !== childId) await addRel(childId, k, SIB);
        }
        for (const g of get(siblingsOf, childId)) {
          await addRel(parentId, g, PC);
        }

      } else if (type === SIB) {
        for (const p of get(parentsOf, f)) await addRel(p, t, PC);
        for (const p of get(parentsOf, t)) await addRel(p, f, PC);

      } else if (type === SP) {
        if (get(spousesOf, f).size === 1 && get(spousesOf, t).size === 1) {
          for (const c of get(childrenOf, f)) await addRel(t, c, PC);
          for (const c of get(childrenOf, t)) await addRel(f, c, PC);
        }
      }
    }

    return added;
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
      const auto = await propagateLogicalRelations(editingMemberId, selectedRelTarget, relType);

      App.toast('Verbindung hinzugefügt', 'success');
      if (auto > 0) {
        App.toast(`${auto} Verbindung${auto > 1 ? 'en' : ''} automatisch ergänzt`, 'info');
      }
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
