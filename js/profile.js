/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Profile Management
   Show, edit, and save member profiles
   ═══════════════════════════════════════════════════════════ */

const Profile = (() => {
  let currentProfileId = null;
  let editingMemberId = null;

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
    photoEl.innerHTML = '';
    if (member.photo) {
      photoEl.appendChild(Utils.createEl('img', { src: member.photo, alt: member.firstName }));
    } else {
      const initials = `${member.firstName[0]}${member.lastName[0]}`.toUpperCase();
      photoEl.appendChild(Utils.createEl('span', {
        style: { fontSize: '36px', fontWeight: '600', color: '#9ca3af' },
        textContent: initials,
      }));
    }

    // Details
    birthdateEl.textContent = member.birthDate ? formatDate(member.birthDate) : '—';
    if (member.isDeceased && member.deathDate) {
      deathdateEl.textContent = formatDate(member.deathDate);
      deathdateRow.style.display = '';
    } else {
      deathdateRow.style.display = 'none';
    }

    // Gender
    const genderEl = document.getElementById('profile-gender');
    const genderRow = document.getElementById('profile-gender-row');
    const genderLabels = { m: 'Männlich', f: 'Weiblich', d: 'Divers' };
    if (member.gender) {
      genderEl.textContent = genderLabels[member.gender] || member.gender;
      genderRow.style.display = '';
    } else {
      genderRow.style.display = 'none';
    }

    locationEl.textContent = member.location || '—';
    contactEl.textContent = member.contact || member.email || '—';
    notesEl.textContent = member.notes || '—';

    // Badges
    badgesEl.innerHTML = '';
    if (member.isDeceased) {
      badgesEl.appendChild(Utils.createEl('span', { className: 'badge badge-deceased', textContent: '\u2020 Verstorben' }));
    }
    if (member.claimedByUid) {
      badgesEl.appendChild(Utils.createEl('span', { className: 'badge', textContent: '\u2713 Registriert' }));
    } else if (member.isPlaceholder) {
      badgesEl.appendChild(Utils.createEl('span', { className: 'badge badge-placeholder', textContent: '\u25cc Platzhalter' }));
    }

    // Everyone can edit any profile
    document.getElementById('btn-profile-edit').style.display = '';

    // Show/hide "How are we connected?" button
    const myMember = Auth.getMember();
    const showConnBtn = myMember && myMember.id !== memberId;
    document.getElementById('btn-show-connection').style.display = showConnBtn ? '' : 'none';

    // Show/hide delete button
    const isTruePlaceholder = member.isPlaceholder && !member.claimedByUid;
    const canDelete = isTruePlaceholder && (!myMember || myMember.id !== memberId);
    document.getElementById('btn-delete-member').style.display = canDelete ? '' : 'none';

    // Show existing relationships
    await Relations.renderProfileRelations(memberId);

    App.showView('view-profile');
  }

  /**
   * Open edit form for a member.
   */
  async function edit(memberId) {
    editingMemberId = memberId;
    Relations.resetState();

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
    document.getElementById('edit-gender').value = member?.gender || '';

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
      btnAddRel.style.display = 'none';
      const container = document.getElementById('edit-existing-rels');
      container.innerHTML = `
        <div class="rel-empty">
          Wähle unten eine Verbindung zu einer bestehenden Person (Pflichtfeld).
        </div>
        <div id="pending-rel-display"></div>
      `;
    } else {
      btnAddRel.style.display = '';
      await Relations.renderEditRelations(memberId);
    }

    App.showView('view-edit');
  }

  /**
   * Save profile changes.
   */
  async function save() {
    const firstName = Utils.sanitizeInput(document.getElementById('edit-firstname').value);
    const lastName = Utils.sanitizeInput(document.getElementById('edit-lastname').value);
    const birthDate = document.getElementById('edit-birthdate').value;

    if (!firstName || !lastName) {
      App.toast('Vor- und Nachname sind Pflichtfelder', 'error');
      return;
    }

    if (!Utils.validateLength(firstName, 100) || !Utils.validateLength(lastName, 100)) {
      App.toast('Name darf maximal 100 Zeichen lang sein', 'error');
      return;
    }

    if (!editingMemberId && !birthDate) {
      App.toast('Geburtsdatum ist Pflichtfeld für neue Personen', 'error');
      return;
    }

    const pendingFirstRelation = Relations.getPendingFirstRelation();
    if (!editingMemberId && !pendingFirstRelation) {
      App.toast('Bitte wähle eine Verbindung zu einer bestehenden Person', 'error');
      return;
    }

    const photoUrl = document.getElementById('edit-photo').value.trim();
    if (photoUrl && !Utils.isValidUrl(photoUrl)) {
      App.toast('Foto-URL muss mit https:// beginnen', 'error');
      return;
    }

    const email = document.getElementById('edit-email').value.trim();
    if (email && !Utils.isValidEmail(email)) {
      App.toast('Bitte gib eine gültige E-Mail-Adresse ein', 'error');
      return;
    }

    const notes = document.getElementById('edit-notes').value.trim();
    if (!Utils.validateLength(notes, 5000)) {
      App.toast('Notizen dürfen maximal 5000 Zeichen lang sein', 'error');
      return;
    }

    const saveBtn = document.getElementById('btn-edit-save');
    Utils.setButtonLoading(saveBtn, true);

    const data = {
      firstName,
      lastName,
      birthName: Utils.sanitizeInput(document.getElementById('edit-birthname').value),
      birthDate,
      deathDate: document.getElementById('edit-deathdate').value,
      isDeceased: !!document.getElementById('edit-deathdate').value,
      location: Utils.sanitizeInput(document.getElementById('edit-location').value),
      contact: email,
      phone: Utils.sanitizePhone(document.getElementById('edit-phone').value),
      photo: photoUrl,
      notes: Utils.sanitizeInput(notes),
      gender: document.getElementById('edit-gender').value || null,
    };

    try {
      if (editingMemberId) {
        await DB.updateMember(editingMemberId, data);
        App.toast('Profil gespeichert', 'success');
      } else {
        data.isPlaceholder = true;
        data.claimedByUid = null;
        data.createdBy = Auth.getUser()?.id || null;
        const newId = await DB.createMember(data);
        editingMemberId = newId;

        if (pendingFirstRelation) {
          const { targetId, relType } = pendingFirstRelation;
          await Relations.cleanConflictingRelations(newId, targetId, relType);
          await Relations.createRelationByType(newId, targetId, relType);
          if (relType === 'sibling') await Relations.inheritParentsForSibling(targetId, newId);
          Relations.clearPendingFirstRelation();
          App.toast('Person angelegt & verbunden', 'success');
        }
      }

      await App.refreshTree();

      if (editingMemberId) {
        show(editingMemberId);
      } else {
        App.showView('view-main');
      }
    } catch (err) {
      console.error('Save error:', err);
      App.toast('Fehler beim Speichern', 'error');
    } finally {
      Utils.setButtonLoading(saveBtn, false);
    }
  }

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
    getCurrentProfileId,
    getEditingMemberId,
  };
})();
