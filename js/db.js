/* ═══════════════════════════════════════════════════════════
   STAMMBAUM – Database Layer (Supabase)
   ═══════════════════════════════════════════════════════════ */

const DB = (() => {
  let supabase = null;

  function init(supabaseClient) {
    supabase = supabaseClient;
  }

  // ─── Members ───

  async function getAllMembers() {
    const { data, error } = await supabase
      .from('members')
      .select('*')
      .order('last_name');
    if (error) throw error;
    return data.map(mapMember);
  }

  async function getMember(id) {
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
    if (!q) return getAllMembers();

    // Escape PostgREST filter special characters to prevent filter syntax injection
    const escaped = q.replace(/[%_\\,.()"']/g, ch => '\\' + ch);

    const { data, error } = await supabase
      .from('members')
      .select('*')
      .or(`first_name.ilike.%${escaped}%,last_name.ilike.%${escaped}%,birth_name.ilike.%${escaped}%`);
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

  async function createMember(memberData) {
    const row = unmapMember(memberData);
    const { data, error } = await supabase
      .from('members')
      .insert(row)
      .select()
      .single();
    if (error) {
      // Retry without unknown columns (e.g. gender before migration)
      if (error.code === 'PGRST204' && error.message.includes('gender')) {
        delete row.gender;
        const { data: d2, error: e2 } = await supabase.from('members').insert(row).select().single();
        if (e2) throw e2;
        return d2.id;
      }
      throw error;
    }
    return data.id;
  }

  async function updateMember(id, memberData) {
    const row = unmapMember(memberData);
    delete row.id;
    delete row.created_at;
    const { error } = await supabase
      .from('members')
      .update(row)
      .eq('id', id);
    if (error) {
      // Retry without unknown columns (e.g. gender before migration)
      if (error.code === 'PGRST204' && error.message.includes('gender')) {
        delete row.gender;
        const { error: retryErr } = await supabase.from('members').update(row).eq('id', id);
        if (retryErr) throw retryErr;
        return;
      }
      throw error;
    }
  }

  async function claimMember(memberId, uid) {
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
    // Relationships cascade on delete via FK constraint
    const { error } = await supabase
      .from('members')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  // ─── Relationships ───

  async function getAllRelationships() {
    const { data, error } = await supabase
      .from('relationships')
      .select('*');
    if (error) throw error;
    return data.map(mapRelationship);
  }

  async function addRelationship(fromId, toId, type, metadata = {}) {
    // Check for existing
    const { data: existing } = await supabase
      .from('relationships')
      .select('id')
      .eq('from_id', fromId)
      .eq('to_id', toId)
      .eq('rel_type', type)
      .limit(1);

    if (existing && existing.length > 0) return existing[0].id;

    // Check reverse for spouse or sibling (bidirectional)
    if (type === 'spouse' || type === 'sibling') {
      const { data: reverse } = await supabase
        .from('relationships')
        .select('id')
        .eq('from_id', toId)
        .eq('to_id', fromId)
        .eq('rel_type', type)
        .limit(1);
      if (reverse && reverse.length > 0) return reverse[0].id;
    }

    const row = {
      from_id: fromId,
      to_id: toId,
      rel_type: type,
    };
    if (metadata.marriageDate) row.marriage_date = metadata.marriageDate;
    if (metadata.divorceDate) row.divorce_date = metadata.divorceDate;

    const { data, error } = await supabase
      .from('relationships')
      .insert(row)
      .select()
      .single();
    if (error) throw error;
    return data.id;
  }

  async function removeRelationship(id) {
    const { error } = await supabase
      .from('relationships')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  async function getRelationshipsForMember(memberId) {
    const { data, error } = await supabase
      .from('relationships')
      .select('*')
      .or(`from_id.eq.${memberId},to_id.eq.${memberId}`);
    if (error) throw error;
    return data.map(mapRelationship);
  }

  // ─── Full Graph ───

  async function getFullGraph() {
    const [members, relationships] = await Promise.all([
      getAllMembers(),
      getAllRelationships(),
    ]);
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
    return {
      id: row.id,
      firstName: row.first_name,
      lastName: row.last_name,
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
      notes: row.notes || '',
      gender: row.gender || null,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  function unmapMember(m) {
    const row = {};
    if (m.firstName !== undefined) row.first_name = m.firstName;
    if (m.lastName !== undefined) row.last_name = m.lastName;
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
    if (m.notes !== undefined) row.notes = m.notes;
    if (m.gender !== undefined) row.gender = m.gender || null;
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
      createdAt: row.created_at,
    };
  }

  return {
    init,
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
    seedDemoData,
    createApprovalRequest,
    getApprovalStatus,
    getPendingApprovals,
    approveUser,
    rejectUser,
  };
})();
