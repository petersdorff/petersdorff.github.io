/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Database Layer (Supabase)
   ═══════════════════════════════════════════════════════════ */

const DB = (() => {
  let supabase = null;
  let offlineMode = false;

  function init(supabaseClient) {
    supabase = supabaseClient;
  }

  // ─── Gastmodus (Familientag): lesend aus dem Gast-Graphen ───
  // Gäste ohne Konto dürfen per RLS nichts lesen; der komplette Baum kommt
  // stattdessen aus der SECURITY-DEFINER-Funktion guest_graph(code), die
  // nur mit gültigem, nicht abgelaufenem Familientag-Code Daten liefert.
  // Es gibt keinen gebündelten Snapshot mehr — nichts Persönliches liegt
  // in Repo oder Website. "offlineMode" heißt hier: nur lesen, aus guestRows.

  let guestRows = null;   // { members: [rows], relationships: [rows], generated_at }
  let callNameSupported = false;   // Spalte call_name vorhanden (Migration 011)? Aus geladenen Zeilen erkannt.

  function isOffline() {
    return offlineMode;
  }

  function setOffline(value) {
    offlineMode = value;
  }

  /** Gast-Graph mit Code laden. Wirft Error('invalid_code') bei falschem/abgelaufenem Code. */
  async function loadGuestGraph(code) {
    const { data, error } = await withTimeout(
      supabase.rpc('guest_graph', { p_code: code || '' }), 12000, 'guest_graph');
    if (error) {
      const msg = String(error.message || '');
      const err = new Error(/invalid_code/.test(msg) ? 'invalid_code' : msg);
      throw err;
    }
    if (!data || !Array.isArray(data.members)) throw new Error('invalid_code');
    guestRows = data;
    return { members: data.members.length, relationships: data.relationships.length };
  }

  function guestGraphLoaded() {
    return !!(guestRows && Array.isArray(guestRows.members) && guestRows.members.length);
  }

  function getGuestGraph() {
    return {
      members: guestRows.members.map(mapMember),
      relationships: guestRows.relationships.map(mapRelationship),
    };
  }

  function getGuestGraphDate() {
    return guestRows && guestRows.generated_at ? String(guestRows.generated_at).substring(0, 10) : '';
  }

  /** Nutzungsereignis melden (Zähler, keine Inhalte); Fehler werden verschluckt. */
  function logEvent(kind, meta) {
    if (!supabase) return;
    try {
      supabase.rpc('log_event', { p_kind: kind, p_meta: meta || null }).then(({ error }) => {
        if (error) console.debug('[DB] log_event:', error.message);
      }, () => {});
    } catch { /* egal */ }
  }

  /** Admin: Tageszahlen + Gesamtzahlen der letzten n Tage. */
  async function getUsageStats(days = 14) {
    const { data, error } = await supabase.rpc('usage_stats', { p_days: days });
    if (error) throw error;
    return data;
  }

  /** Familientag-Code bei der Registrierung einlösen → sofort freigegeben. */
  async function redeemInviteCode(code, displayName) {
    const { data, error } = await supabase.rpc('redeem_invite_code', { p_code: code || '', p_display_name: displayName || null });
    if (error) throw error;
    return !!data;
  }

  /** Admin: aktuellen Code + Ablauf lesen / setzen (RLS: nur Admins). */
  async function getInviteCode() {
    const { data, error } = await supabase.from('app_settings').select('value, valid_until').eq('key', 'invite_code').maybeSingle();
    if (error) throw error;
    return data ? { code: data.value || '', validUntil: data.valid_until } : { code: '', validUntil: null };
  }
  async function setInviteCode(code, validUntil) {
    const { error } = await supabase.from('app_settings')
      .upsert({ key: 'invite_code', value: code || '', valid_until: validUntil || null, updated_at: new Date().toISOString() });
    if (error) throw error;
  }

  function assertWritable() {
    if (offlineMode) {
      const err = new Error('offline');
      err.userMessage = 'Offline-Modus: Änderungen sind zurzeit nicht möglich.';
      throw err;
    }
  }

  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) => setTimeout(() => reject(new Error(`${label || 'DB'} Timeout nach ${ms}ms`)), ms)),
    ]);
  }

  // ─── Members ───

  /**
   * Alle Zeilen einer Tabelle — PostgREST liefert pro Anfrage höchstens 1000
   * (Supabase-Voreinstellung). Seit dem Pommern-Import gibt es über 1000
   * Beziehungen; ohne Seitenweise-Laden fehlten 66 Kanten und der Baum
   * zerfiel in Dutzende „Familien". Der Gastmodus (guest_graph-RPC) ist
   * davon nicht betroffen.
   */
  async function fetchAll(table, order) {
    const PAGE = 1000;
    const rows = [];
    for (let from = 0; ; from += PAGE) {
      let q = supabase.from(table).select('*').range(from, from + PAGE - 1);
      if (order) q = q.order(order);
      const { data, error } = await q;
      if (error) throw error;
      rows.push(...data);
      if (data.length < PAGE) return rows;
    }
  }

  async function getAllMembers() {
    const data = await fetchAll('members', 'last_name');
    return data.map(mapMember);
  }

  async function getMember(id) {
    if (offlineMode) {
      const row = guestRows.members.find(m => m.id === id);
      return row ? mapMember(row) : null;
    }
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('id', id)
      .single();
    if (error) return null;
    return mapMember(data);
  }

  async function searchMembers(query) {
    const q = query.toLowerCase().trim();
    if (offlineMode) {
      const all = guestRows.members.map(mapMember);
      if (!q) return all;
      return all.filter(m =>
        `${m.firstName} ${m.callName || ''} ${m.lastName} ${m.birthName || ''}`.toLowerCase().includes(q));
    }
    if (!q) return getAllMembers();

    // Escape PostgREST filter special characters to prevent filter syntax injection
    const escaped = q.replace(/[%_\\,.()"']/g, ch => '\\' + ch);

    const { data, error } = await supabase
      .from('members')
      .select('*')
      .or(`first_name.ilike.%${escaped}%,${callNameSupported ? `call_name.ilike.%${escaped}%,` : ''}last_name.ilike.%${escaped}%,birth_name.ilike.%${escaped}%`);
    if (error) throw error;
    return data.map(mapMember);
  }

  async function findMemberByUid(uid) {
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .eq('claimed_by_uid', uid)
      .limit(1)
      .maybeSingle();
    if (error || !data) return null;
    return mapMember(data);
  }

  /**
   * Fehlt eine Spalte in der DB (Migration noch nicht eingespielt), nennt
   * PostgREST sie in der Fehlermeldung. Gibt den Spaltennamen zurück oder null.
   */
  function missingColumn(error) {
    const msg = (error && error.message) || '';
    const m = msg.match(/column \w+\.(\w+) does not exist/i)
           || msg.match(/Could not find the '(\w+)' column/i);
    return m ? m[1] : null;
  }

  /** Schreibt row; lässt bei „Spalte fehlt" GENAU diese Spalte weg und
      versucht es erneut — nie mehr als nötig (früher flogen gender UND
      occupation zusammen raus, wodurch das Geschlecht still verloren ging). */
  async function writeWithColumnFallback(row, exec) {
    for (let attempt = 0; attempt < 4; attempt++) {
      const { data, error } = await exec(row);
      if (!error) return data;
      const col = missingColumn(error);
      if (!col || !(col in row)) throw error;
      console.warn(`[DB] Spalte "${col}" fehlt in der Datenbank – Wert wird nicht gespeichert. Migration nachziehen (siehe RESTORE.md).`);
      delete row[col];
    }
    throw new Error('Speichern fehlgeschlagen: zu viele fehlende Spalten');
  }

  async function createMember(memberData) {
    assertWritable();
    // Rufname nie leer lassen: Vorbelegung wie Migration 011 (erster Vorname)
    if (!memberData.callName) memberData = { ...memberData, callName: Utils.defaultCallName(memberData.firstName) };
    const row = unmapMember(memberData);
    const data = await writeWithColumnFallback(row, r =>
      supabase.from('members').insert(r).select().single());
    logEvent('member_create');
    return data.id;
  }

  async function updateMember(id, memberData) {
    assertWritable();
    const row = unmapMember(memberData);
    delete row.id;
    delete row.created_at;
    await writeWithColumnFallback(row, r =>
      supabase.from('members').update(r).eq('id', id));
    logEvent('member_update');
  }

  async function claimMember(memberId, uid) {
    assertWritable();
    const { error } = await supabase
      .from('members')
      .update({
        claimed_by_uid: uid,
        is_placeholder: false,
      })
      .eq('id', memberId);
    if (error) throw error;
  }

  async function deleteMember(id) {
    assertWritable();
    // Relationships cascade on delete via FK constraint
    const { error } = await supabase
      .from('members')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  // ─── Relationships ───

  async function getAllRelationships() {
    const data = await fetchAll('relationships', 'id');
    return data.map(mapRelationship);
  }

  async function addRelationship(fromId, toId, type, metadata = {}) {
    assertWritable();
    // Check for existing
    const { data: existing } = await supabase
      .from('relationships')
      .select('id')
      .eq('from_id', fromId)
      .eq('to_id', toId)
      .eq('rel_type', type)
      .limit(1);

    // Bestehende Kante (auch Gegenrichtung bei spouse/sibling): nur das
    // „ehemalig"-Flag nachziehen, statt zu duplizieren
    let found = existing && existing.length > 0 ? existing[0].id : null;
    if (!found && (type === 'spouse' || type === 'sibling')) {
      const { data: reverse } = await supabase
        .from('relationships')
        .select('id')
        .eq('from_id', toId)
        .eq('to_id', fromId)
        .eq('rel_type', type)
        .limit(1);
      if (reverse && reverse.length > 0) found = reverse[0].id;
    }
    if (found) {
      if (type === 'spouse' && metadata.isFormer !== undefined) {
        await writeWithColumnFallback({ is_former: !!metadata.isFormer }, r =>
          supabase.from('relationships').update(r).eq('id', found));
      }
      return found;
    }

    const row = {
      from_id: fromId,
      to_id: toId,
      rel_type: type,
    };
    if (metadata.marriageDate) row.marriage_date = metadata.marriageDate;
    if (metadata.divorceDate) row.divorce_date = metadata.divorceDate;
    if (type === 'spouse' && metadata.isFormer) row.is_former = true;

    const data = await writeWithColumnFallback(row, r =>
      supabase.from('relationships').insert(r).select().single());
    logEvent('relationship_add', { type });
    return data.id;
  }

  async function removeRelationship(id) {
    assertWritable();
    const { error } = await supabase
      .from('relationships')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  async function getRelationshipsForMember(memberId) {
    if (offlineMode) {
      return guestRows.relationships
        .filter(r => r.from_id === memberId || r.to_id === memberId)
        .map(mapRelationship);
    }
    const { data, error } = await supabase
      .from('relationships')
      .select('*')
      .or(`from_id.eq.${memberId},to_id.eq.${memberId}`);
    if (error) throw error;
    return data.map(mapRelationship);
  }

  // ─── Full Graph ───

  async function getFullGraph() {
    if (offlineMode) return getGuestGraph();
    const [members, relationships] = await withTimeout(
      Promise.all([getAllMembers(), getAllRelationships()]),
      8000, 'getFullGraph'
    );
    return { members, relationships };
  }

  // ─── Seed Demo Data ───

  async function seedDemoData() {
    const { data: existing } = await supabase
      .from('members')
      .select('id')
      .limit(1);
    if (existing && existing.length > 0) return false;

    const membersData = [
      { first_name: 'Friedrich', last_name: 'von Stammberg', birth_date: '1920-03-15', death_date: '1995-08-22', is_deceased: true, is_placeholder: true, location: 'Schloss Stammberg', notes: 'Familienoberhaupt, Gründer des Familientags' },
      { first_name: 'Elisabeth', last_name: 'von Stammberg', birth_name: 'geb. von Hohenfeld', birth_date: '1924-07-03', death_date: '2001-12-10', is_deceased: true, is_placeholder: true, location: 'Schloss Stammberg' },
      { first_name: 'Heinrich', last_name: 'von Stammberg', birth_date: '1948-05-20', is_placeholder: true, location: 'München', notes: 'Ältester Sohn, leitet den Familienbetrieb' },
      { first_name: 'Maria', last_name: 'von Stammberg', birth_name: 'geb. Freifrau von Linden', birth_date: '1950-11-08', is_placeholder: true, location: 'München' },
      { first_name: 'Wilhelm', last_name: 'von Stammberg', birth_date: '1952-02-14', is_placeholder: true, location: 'Berlin', notes: 'Diplomat, lebte lange im Ausland' },
      { first_name: 'Charlotte', last_name: 'Bergmann', birth_name: 'geb. von Stammberg', birth_date: '1955-09-30', is_placeholder: true, location: 'Hamburg', notes: 'Ausgeheiratet in Familie Bergmann' },
      { first_name: 'Thomas', last_name: 'Bergmann', birth_date: '1953-04-18', is_placeholder: true, location: 'Hamburg' },
      { first_name: 'Alexander', last_name: 'von Stammberg', birth_date: '1975-08-12', is_placeholder: true, location: 'München', notes: 'Rechtsanwalt, organisiert den Familientag' },
      { first_name: 'Sophie', last_name: 'von Stammberg', birth_name: 'geb. Fischer', birth_date: '1978-03-25', is_placeholder: true, location: 'München' },
      { first_name: 'Maximilian', last_name: 'von Stammberg', birth_date: '1977-11-05', is_placeholder: true, location: 'Wien', notes: 'Kunsthistoriker' },
      { first_name: 'Katharina', last_name: 'von Stammberg', birth_date: '1980-06-15', is_placeholder: true, location: 'Berlin', notes: 'Ärztin' },
      { first_name: 'Julia', last_name: 'Meier', birth_name: 'geb. Bergmann', birth_date: '1982-01-20', is_placeholder: true, location: 'Hamburg', notes: 'Ausgeheiratet' },
      { first_name: 'Felix', last_name: 'Bergmann', birth_date: '1985-07-08', is_placeholder: true, location: 'Köln' },
      { first_name: 'Luisa', last_name: 'von Stammberg', birth_date: '2005-04-03', is_placeholder: true, location: 'München', notes: 'Studentin' },
      { first_name: 'Moritz', last_name: 'von Stammberg', birth_date: '2008-09-17', is_placeholder: true, location: 'München' },
      { first_name: 'Anna', last_name: 'von Stammberg', birth_date: '2003-12-24', is_placeholder: true, location: 'Wien' },
    ];

    const { data: inserted, error } = await supabase
      .from('members')
      .insert(membersData)
      .select('id');

    if (error) throw error;
    const ids = inserted.map(r => r.id);

    const relRows = [];
    // Parent-child
    const parentChild = [
      [0, 2], [0, 4], [0, 5],
      [1, 2], [1, 4], [1, 5],
      [2, 7], [2, 9], [2, 10],
      [3, 7], [3, 9], [3, 10],
      [5, 11], [5, 12],
      [6, 11], [6, 12],
      [7, 13], [7, 14],
      [8, 13], [8, 14],
      [9, 15],
    ];
    for (const [p, c] of parentChild) {
      relRows.push({ from_id: ids[p], to_id: ids[c], rel_type: 'parent_child' });
    }
    // Spouses
    const spouses = [[0, 1], [2, 3], [5, 6], [7, 8]];
    for (const [a, b] of spouses) {
      relRows.push({ from_id: ids[a], to_id: ids[b], rel_type: 'spouse' });
    }

    const { error: relError } = await supabase
      .from('relationships')
      .insert(relRows);
    if (relError) throw relError;

    return true;
  }

  // ─── Photo Upload ───

  async function uploadPhoto(memberId, file) {
    assertWritable();
    const ext = file.name.split('.').pop().toLowerCase();
    const path = `${memberId}.${ext}`;

    // Remove old photo if exists (ignore errors)
    await supabase.storage.from('photos').remove([path]);

    const { error } = await supabase.storage
      .from('photos')
      .upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw error;

    const { data } = supabase.storage.from('photos').getPublicUrl(path);
    // Append cache-buster to force reload after re-upload
    return data.publicUrl + '?t=' + Date.now();
  }

  // ─── User Approvals ───

  async function createApprovalRequest(userUid, email, displayName) {
    const { data: existing } = await supabase
      .from('user_approvals')
      .select('id, status')
      .eq('user_uid', userUid)
      .maybeSingle();

    if (existing) return existing; // Already exists

    const { data, error } = await supabase
      .from('user_approvals')
      .insert({
        user_uid: userUid,
        email: email,
        display_name: displayName,
        status: 'pending',
      })
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function getApprovalStatus(userUid) {
    const { data, error } = await supabase
      .from('user_approvals')
      .select('*')
      .eq('user_uid', userUid)
      .maybeSingle();
    if (error || !data) return null;
    return data;
  }

  async function getPendingApprovals() {
    const { data, error } = await supabase
      .from('user_approvals')
      .select('*')
      .eq('status', 'pending')
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  /** Alle Freigabe-Zeilen (Admin). Liest der Admin, sonst per RLS nur die eigene. */
  async function getAllApprovals() {
    const { data, error } = await supabase
      .from('user_approvals')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  }

  /** Status setzen: 'approved' | 'rejected' | 'revoked' | 'pending'. */
  async function setApprovalStatus(approvalId, status, adminUid) {
    const { error } = await supabase
      .from('user_approvals')
      .update({ status, reviewed_at: new Date().toISOString(), reviewed_by: adminUid })
      .eq('id', approvalId);
    if (error) throw error;
  }

  /** Rolle setzen: 'admin' | 'member' (nur Admins, per RLS). */
  async function setApprovalRole(approvalId, role) {
    const { error } = await supabase
      .from('user_approvals')
      .update({ role })
      .eq('id', approvalId);
    if (error) throw error;
  }

  /** Profil-Verknüpfung eines Kontos lösen: Profil wird wieder Platzhalter. */
  async function unclaimMember(memberId) {
    assertWritable();
    const { error } = await supabase
      .from('members')
      .update({ claimed_by_uid: null, is_placeholder: true })
      .eq('id', memberId);
    if (error) throw error;
  }

  async function approveUser(approvalId, adminUid) {
    const { error } = await supabase
      .from('user_approvals')
      .update({
        status: 'approved',
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminUid,
      })
      .eq('id', approvalId);
    if (error) throw error;
  }

  async function rejectUser(approvalId, adminUid) {
    const { error } = await supabase
      .from('user_approvals')
      .update({
        status: 'rejected',
        reviewed_at: new Date().toISOString(),
        reviewed_by: adminUid,
      })
      .eq('id', approvalId);
    if (error) throw error;
  }

  // ─── Mapping: snake_case (DB) ↔ camelCase (App) ───

  function mapMember(row) {
    if (!row) return null;
    if ('call_name' in row) callNameSupported = true;
    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
      callName: row.call_name || '',
      birthName: row.birth_name || '',
      birthDate: row.birth_date || '',
      deathDate: row.death_date || '',
      isDeceased: row.is_deceased || false,
      isPlaceholder: row.is_placeholder || false,
      claimedByUid: row.claimed_by_uid,
      createdBy: row.created_by,
      photo: row.photo || '',
      contact: row.contact || '',
      phone: row.phone || '',
      email: row.email || '',
      location: row.location || '',
      placeName: row.place_name || '',
      placeLat: typeof row.place_lat === 'number' ? row.place_lat : null,
      placeLng: typeof row.place_lng === 'number' ? row.place_lng : null,
      notes: row.notes || '',
      gender: row.gender || null,
      occupation: row.occupation || '',
      familyHint: row.family_hint || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function unmapMember(m) {
    const row = {};
    if (m.firstName !== undefined) row.first_name = m.firstName;
    if (m.lastName !== undefined) row.last_name = m.lastName;
    if (m.callName !== undefined) row.call_name = m.callName || null;
    if (m.birthName !== undefined) row.birth_name = m.birthName;
    if (m.birthDate !== undefined) row.birth_date = m.birthDate || null;
    if (m.deathDate !== undefined) row.death_date = m.deathDate || null;
    if (m.isDeceased !== undefined) row.is_deceased = m.isDeceased;
    if (m.isPlaceholder !== undefined) row.is_placeholder = m.isPlaceholder;
    if (m.claimedByUid !== undefined) row.claimed_by_uid = m.claimedByUid;
    if (m.createdBy !== undefined) row.created_by = m.createdBy;
    if (m.photo !== undefined) row.photo = m.photo;
    if (m.contact !== undefined) row.contact = m.contact;
    if (m.phone !== undefined) row.phone = m.phone;
    if (m.email !== undefined) row.email = m.email;
    if (m.location !== undefined) row.location = m.location;
    if (m.placeName !== undefined) row.place_name = m.placeName || null;
    if (m.placeLat !== undefined) row.place_lat = typeof m.placeLat === 'number' ? m.placeLat : null;
    if (m.placeLng !== undefined) row.place_lng = typeof m.placeLng === 'number' ? m.placeLng : null;
    if (m.notes !== undefined) row.notes = m.notes;
    if (m.gender !== undefined) row.gender = m.gender || null;
    if (m.occupation !== undefined) row.occupation = m.occupation || '';
    if (m.familyHint !== undefined) row.family_hint = m.familyHint || null;
    return row;
  }

  function mapRelationship(row) {
    if (!row) return null;
    return {
      id: row.id,
      fromId: row.from_id,
      toId: row.to_id,
      type: row.rel_type,
      marriageDate: row.marriage_date,
      divorceDate: row.divorce_date,
      isFormer: !!row.is_former,
      createdAt: row.created_at,
    };
  }

  return {
    init,
    isOffline,
    setOffline,
    loadGuestGraph,
    guestGraphLoaded,
    getGuestGraph,
    getGuestGraphDate,
    redeemInviteCode,
    getInviteCode,
    setInviteCode,
    logEvent,
    getUsageStats,
    getAllMembers,
    getMember,
    searchMembers,
    findMemberByUid,
    createMember,
    updateMember,
    claimMember,
    deleteMember,
    getAllRelationships,
    addRelationship,
    removeRelationship,
    getRelationshipsForMember,
    getFullGraph,
    hasCallName: () => callNameSupported,
    seedDemoData,
    createApprovalRequest,
    getApprovalStatus,
    getPendingApprovals,
    uploadPhoto,
    approveUser,
    getAllApprovals,
    setApprovalStatus,
    setApprovalRole,
    unclaimMember,
    rejectUser,
  };
})();
