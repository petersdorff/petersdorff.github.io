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
    // Rufname nur zeigen, wenn er sich vom Vornamen unterscheidet
    // (bei einem einzigen Vornamen wäre die Zeile reine Wiederholung)
    const callRow = document.getElementById('profile-callname-row');
    const showCall = member.callName && member.callName !== member.firstName;
    callRow.style.display = showCall ? '' : 'none';
    document.getElementById('profile-callname').textContent = showCall ? member.callName : '';
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

    // Occupation
    const occupationEl = document.getElementById('profile-occupation');
    const occupationRow = document.getElementById('profile-occupation-row');
    if (member.occupation) {
      occupationEl.textContent = member.occupation;
      occupationRow.style.display = '';
    } else {
      occupationRow.style.display = 'none';
    }

    locationEl.textContent = member.location || '—';
    contactEl.textContent = member.contact || member.email || '—';
    // Vita: nur die ersten Sätze; der ganze Markdown-Artikel steht auf der Seite
    const ex = Markdown.excerpt(member.notes || '', 220);
    notesEl.textContent = ex.text || '—';
    const hasMore = ex.truncated || (member.notes || '').includes('\n');
    document.getElementById('btn-profile-article-label').textContent = hasMore ? 'Weiterlesen' : 'Ganze Seite öffnen';

    // Badges
    badgesEl.innerHTML = '';
    if (member.isDeceased) {
      badgesEl.appendChild(Utils.createEl('span', { className: 'badge badge-deceased', textContent: '\u2020 Verstorben' }));
    }
    if (member.isPlaceholder) {
      badgesEl.appendChild(Utils.createEl('span', { className: 'badge badge-placeholder', textContent: '\u25cc Platzhalter' }));
    } else {
      badgesEl.appendChild(Utils.createEl('span', { className: 'badge', textContent: '\u2713 Registriert' }));
    }

    // Everyone can edit any profile — except in read-only (guest/offline) mode
    const readOnly = DB.isOffline();
    document.getElementById('btn-profile-edit').style.display = readOnly ? 'none' : '';

    // Show/hide "How are we connected?" button. In guest mode it stays
    // visible even without identity — tapping it leads to the identity picker.
    const myMember = Auth.getMember();
    const showConnBtn = (myMember && myMember.id !== memberId) || (Guest.isActive() && !myMember);
    document.getElementById('btn-show-connection').style.display = showConnBtn ? '' : 'none';
    // „Wie ist Kai mit … verwandt?" — Suche über alle Personen, Ergebnis im Verwandtschafts-Overlay
    document.getElementById('btn-connect-other').textContent = `Wie ist ${member.callName || member.firstName} mit … verwandt?`;
    resetConnectOther();

    // Show/hide delete button
    const isTruePlaceholder = member.isPlaceholder && !member.claimedByUid;
    const canDelete = !readOnly && isTruePlaceholder && (!myMember || myMember.id !== memberId);
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
    document.getElementById('edit-callname').value = member?.callName || Utils.defaultCallName(member?.firstName);
    document.getElementById('edit-lastname').value = member?.lastName || '';
    document.getElementById('edit-birthname').value = member?.birthName || '';
    document.getElementById('edit-birthdate').value = member?.birthDate || '';
    document.getElementById('edit-deathdate').value = member?.deathDate || '';
    document.getElementById('edit-occupation').value = member?.occupation || '';
    document.getElementById('edit-location').value = member?.location || '';
    setPickedPlace(member?.placeName || '', member?.placeLat, member?.placeLng, member?.location || '');
    document.getElementById('edit-email').value = member?.contact || member?.email || '';
    document.getElementById('edit-phone').value = member?.phone || '';
    document.getElementById('edit-photo').value = member?.photo || '';
    document.getElementById('edit-photo-file').value = '';
    const photoPreview = document.getElementById('edit-photo-preview');
    if (member?.photo) {
      photoPreview.innerHTML = `<img src="${Utils.escapeHtml(member.photo)}" style="max-width:80px;max-height:80px;border-radius:4px;">`;
    } else {
      photoPreview.innerHTML = '';
    }
    document.getElementById('edit-notes').value = member?.notes || '';
    document.getElementById('edit-gender').value = member?.gender || '';

    // Attach live date auto-correction
    Utils.attachDateAutoCorrect(document.getElementById('edit-birthdate'));
    Utils.attachDateAutoCorrect(document.getElementById('edit-deathdate'));

    // Protect core fields on claimed profiles: only claimer or admin can edit
    const currentUser = Auth.getUser();
    const isAdmin = Admin.isAdmin();
    const isClaimer = member?.claimedByUid && currentUser?.id === member.claimedByUid;
    const coreEditable = !member?.claimedByUid || isClaimer || isAdmin;

    const coreFieldIds = [
      'edit-firstname', 'edit-callname', 'edit-lastname', 'edit-birthname', 'edit-gender',
      'edit-birthdate', 'edit-deathdate', 'edit-occupation', 'edit-location',
      'edit-email', 'edit-phone', 'edit-photo', 'edit-notes',
    ];
    for (const fid of coreFieldIds) {
      const el = document.getElementById(fid);
      if (el) el.disabled = !coreEditable;
    }

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

      // Show hint if member has zero relationships (orphan — not visible on tree)
      const rels = await DB.getRelationshipsForMember(memberId);
      if (rels.length === 0) {
        const container = document.getElementById('edit-existing-rels');
        const hint = document.createElement('div');
        hint.className = 'rel-empty';
        hint.textContent = 'Füge eine Verbindung hinzu, damit du im Stammbaum erscheinst – oder später: Bis dahin steht dein Profil in der Ablage „unverbunden".';
        container.prepend(hint);
      }
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

    const gender = document.getElementById('edit-gender').value;
    if (!gender) {
      App.toast('Geschlecht ist ein Pflichtfeld', 'error');
      return;
    }

    if (!birthDate) {
      App.toast('Geburtsdatum ist ein Pflichtfeld', 'error');
      return;
    }

    // Validate date fields
    const birthCheck = Utils.validateDate(birthDate);
    if (!birthCheck.valid) {
      App.toast(`Geburtsdatum: ${birthCheck.message}`, 'error');
      return;
    }
    const deathDate = document.getElementById('edit-deathdate').value;
    const deathCheck = Utils.validateDate(deathDate);
    if (!deathCheck.valid) {
      App.toast(`Sterbedatum: ${deathCheck.message}`, 'error');
      return;
    }

    const pendingFirstRelation = Relations.getPendingFirstRelation();
    if (!editingMemberId && !pendingFirstRelation) {
      App.toast('Bitte wähle eine Verbindung zu einer bestehenden Person', 'error');
      return;
    }

    const photoFile = document.getElementById('edit-photo-file').files[0];
    let photoUrl = document.getElementById('edit-photo').value.trim();

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

    // Rufname leer gelassen → erster Vorname (wie die Vorbelegung in der DB)
    const callName = Utils.sanitizeInput(document.getElementById('edit-callname').value) || Utils.defaultCallName(firstName);
    if (!Utils.validateLength(callName, 100)) {
      App.toast('Rufname darf maximal 100 Zeichen lang sein', 'error');
      Utils.setButtonLoading(saveBtn, false);
      return;
    }

    const data = {
      firstName,
      callName,
      lastName,
      birthName: Utils.sanitizeInput(document.getElementById('edit-birthname').value),
      birthDate,
      deathDate,
      isDeceased: !!deathDate,
      occupation: Utils.sanitizeInput(document.getElementById('edit-occupation').value),
      location: Utils.sanitizeInput(document.getElementById('edit-location').value),
      ...pickedPlaceData(),
      contact: email,
      phone: Utils.sanitizePhone(document.getElementById('edit-phone').value),
      photo: photoUrl,
      notes: Utils.sanitizeInput(notes),
      gender: gender || null,
    };

    try {
      // Upload photo file if selected
      if (photoFile && editingMemberId) {
        try {
          photoUrl = await DB.uploadPhoto(editingMemberId, photoFile);
          data.photo = photoUrl;
        } catch (uploadErr) {
          console.error('Photo upload error:', uploadErr);
          App.toast('Foto-Upload fehlgeschlagen', 'error');
        }
      }

      if (editingMemberId) {
        await DB.updateMember(editingMemberId, data);
        App.toast('Profil gespeichert', 'success');
      } else {
        data.isPlaceholder = true;
        data.claimedByUid = null;
        data.createdBy = Auth.getUser()?.id || null;
        const newId = await DB.createMember(data);
        editingMemberId = newId;

        // Upload photo for newly created member
        if (photoFile && newId) {
          try {
            const url = await DB.uploadPhoto(newId, photoFile);
            await DB.updateMember(newId, { photo: url });
          } catch (uploadErr) {
            console.error('Photo upload error:', uploadErr);
          }
        }

        if (pendingFirstRelation) {
          const { targetId, relType } = pendingFirstRelation;
          await Relations.cleanConflictingRelations(newId, targetId, relType);
          await Relations.createRelationByType(newId, targetId, relType);
          const auto = await Relations.propagateLogicalRelations(newId, targetId, relType);
          Relations.clearPendingFirstRelation();
          App.toast('Person angelegt & verbunden', 'success');
          if (auto > 0) {
            App.toast(`${auto} Verbindung${auto > 1 ? 'en' : ''} automatisch ergänzt`, 'info');
          }
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

  // ─── Verwandtschaft zu einer beliebigen anderen Person ───
  //
  // Unter „Wie sind wir verwandt?": Suchfeld über alle Personen; Tipp auf
  // einen Treffer öffnet das Overlay zwischen der Profilperson und dem
  // Treffer (Texte dort in dritter Person). Funktioniert auch als Gast.

  function resetConnectOther() {
    const box = document.getElementById('connect-other-box');
    box.classList.add('hidden');
    document.getElementById('connect-other-search').value = '';
    document.getElementById('connect-other-results').innerHTML = '';
  }

  function toggleConnectOther() {
    const box = document.getElementById('connect-other-box');
    box.classList.toggle('hidden');
    if (!box.classList.contains('hidden')) setTimeout(() => document.getElementById('connect-other-search').focus(), 50);
  }

  function onConnectOtherInput() {
    const q = document.getElementById('connect-other-search').value.trim().toLowerCase();
    const box = document.getElementById('connect-other-results');
    box.innerHTML = '';
    if (q.length < 2 || !currentProfileId) return;
    const norm = s => (s || '').toLowerCase();
    const scored = [];
    for (const m of App.getCachedMembers()) {
      if (m.id === currentProfileId) continue;
      const full = `${m.firstName} ${m.lastName}`, call = `${m.callName || ''} ${m.lastName}`;
      const hay = [full, call, m.birthName].map(norm);
      if (!hay.some(h => h.includes(q))) continue;
      // Treffer am Wortanfang zuerst, dann alphabetisch
      const starts = hay.some(h => h.split(/\s+/).some(w => w.startsWith(q)));
      scored.push({ m, key: `${starts ? 0 : 1}${full}` });
    }
    scored.sort((a, b) => a.key.localeCompare(b.key, 'de'));
    for (const { m } of scored.slice(0, 8)) {
      const fam = App.familyInfo(m.id);
      const yr = m.birthDate ? ` · * ${m.birthDate.substring(0, 4)}` : '';
      const item = Utils.createEl('div', { className: 'mini-result-item' });
      item.appendChild(document.createTextNode(`${m.firstName} ${m.lastName}${m.isDeceased ? ' †' : ''}`));
      item.appendChild(Utils.createEl('span', { className: 'place-sub', textContent: `${fam ? fam.short : 'ohne Zweig'}${yr}` }));
      item.addEventListener('click', () => {
        const fromId = currentProfileId;
        resetConnectOther();
        // Wie showConnectionTo: erst zur Hauptansicht — auf dem Handy ist das
        // Profil eine Vollbild-Ansicht und würde das Overlay sonst verdecken
        App.showView('view-main');
        Connection.showOverlay(fromId, m.id);
      });
      box.appendChild(item);
    }
    if (!scored.length) box.appendChild(Utils.createEl('div', { className: 'mini-result-item is-taken', textContent: 'Niemand gefunden' }));
  }

  // ─── Orts-Picker (Wohnort → Stadt mit Koordinaten, Photon/OpenStreetMap) ───
  //
  // Der Freitext bleibt, was der Nutzer sieht; auf der Karte landet nur,
  // wer einen Vorschlag gewählt hat (placeName/placeLat/placeLng). Wird der
  // Text nach der Auswahl geändert, verfallen die Koordinaten wieder.

  const PHOTON = 'https://photon.komoot.io/api/';
  let placeTimer = null, placeAbort = null, pickedText = '';

  function setPickedPlace(name, lat, lng, text) {
    document.getElementById('edit-place-name').value = name || '';
    document.getElementById('edit-place-lat').value = typeof lat === 'number' ? String(lat) : '';
    document.getElementById('edit-place-lng').value = typeof lng === 'number' ? String(lng) : '';
    pickedText = name ? (text || '') : '';
    updatePlaceHint();
  }

  function pickedPlaceData() {
    const name = document.getElementById('edit-place-name').value;
    const lat = parseFloat(document.getElementById('edit-place-lat').value);
    const lng = parseFloat(document.getElementById('edit-place-lng').value);
    const text = document.getElementById('edit-location').value.trim();
    // Text geändert oder geleert → Koordinaten verfallen
    if (!name || !text || text !== pickedText || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return { placeName: null, placeLat: null, placeLng: null };
    }
    return { placeName: name, placeLat: lat, placeLng: lng };
  }

  function updatePlaceHint() {
    const hint = document.getElementById('edit-location-hint');
    const text = document.getElementById('edit-location').value.trim();
    const p = pickedPlaceData();
    hint.className = 'input-hint';
    if (!text) { hint.textContent = ''; return; }
    if (p.placeName) { hint.classList.add('ok'); hint.textContent = `✓ auf der Karte: ${p.placeName}`; }
    else { hint.classList.add('warn'); hint.textContent = 'Nicht auf der Karte – Ort aus der Vorschlagsliste wählen.'; }
  }

  /** Anzeigeform: deutsche Orte nur der Name, sonst „Ort, Land". */
  function placeDisplay(props) {
    const name = props.name || '';
    const country = props.country || '';
    return country && !/^(Deutschland|Germany)$/i.test(country) ? `${name}, ${country}` : name;
  }

  async function searchPlaces(q) {
    if (placeAbort) placeAbort.abort();
    placeAbort = new AbortController();
    const url = PHOTON + '?' + new URLSearchParams({ q, limit: '6', lang: 'de', lat: '51', lon: '10' })
      + '&osm_tag=place:city&osm_tag=place:town&osm_tag=place:village&osm_tag=place:hamlet';
    const res = await fetch(url, { signal: placeAbort.signal });
    if (!res.ok) throw new Error(String(res.status));
    const data = await res.json();
    // Doppelte (gleicher Name + Land + Bundesland) einmal
    const seen = new Set(); const out = [];
    for (const f of data.features || []) {
      const p = f.properties || {};
      const key = `${p.name}|${p.state || ''}|${p.country || ''}`;
      if (!p.name || seen.has(key)) continue;
      seen.add(key);
      out.push({ name: p.name, state: p.state || '', country: p.country || '', kind: p.osm_value || '',
                 lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
    }
    // Städte vor Dörfern/Weilern (Photon setzt sonst „Hamb" vor „Hamburg"); Reihenfolge sonst wie geliefert
    const rank = { city: 0, town: 1 };
    return out.map((p, i) => ({ p, i })).sort((a, b) => ((rank[a.p.kind] ?? 2) - (rank[b.p.kind] ?? 2)) || (a.i - b.i)).map(x => x.p);
  }

  function renderPlaceResults(list) {
    const box = document.getElementById('edit-location-results');
    box.innerHTML = '';
    for (const p of list) {
      const item = Utils.createEl('div', { className: 'mini-result-item' });
      item.appendChild(document.createTextNode(p.name));
      const sub = [p.state, p.country].filter(Boolean).join(', ');
      if (sub) item.appendChild(Utils.createEl('span', { className: 'place-sub', textContent: sub }));
      item.addEventListener('click', () => {
        const text = placeDisplay(p);
        document.getElementById('edit-location').value = text;
        setPickedPlace(`${p.name}, ${p.country || ''}`.replace(/, $/, ''), p.lat, p.lng, text);
        box.innerHTML = '';
      });
      box.appendChild(item);
    }
  }

  function onLocationInput() {
    const q = document.getElementById('edit-location').value.trim();
    updatePlaceHint();
    clearTimeout(placeTimer);
    const box = document.getElementById('edit-location-results');
    if (q.length < 2 || q === pickedText) { box.innerHTML = ''; return; }
    placeTimer = setTimeout(async () => {
      try { renderPlaceResults(await searchPlaces(q)); }
      catch (err) { if (err.name !== 'AbortError') box.innerHTML = ''; }
    }, 250);
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
    onLocationInput,
    toggleConnectOther,
    onConnectOtherInput,
    getCurrentProfileId,
    getEditingMemberId,
  };
})();
