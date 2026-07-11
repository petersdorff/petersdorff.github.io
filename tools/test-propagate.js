/* Headless-Test für Relations.propagateLogicalRelations (js/relations.js).
   Läuft ohne Browser und ohne echte Datenbank:
     node tools/test-propagate.js js/relations.js
   Nach jeder Änderung an der Beziehungs-Automatik ausführen. */
const fs = require('fs');

// ─── Mock-Umgebung ───
let rels = [];
let nextId = 1;

const DB = {
  async getAllRelationships() { return rels.map(r => ({ ...r })); },
  async getRelationshipsForMember(id) {
    return rels.filter(r => r.fromId === id || r.toId === id).map(r => ({ ...r }));
  },
  async addRelationship(fromId, toId, type) {
    // wie echte DB: dedupe inkl. Gegenrichtung bei spouse/sibling
    const dup = rels.find(r => r.fromId === fromId && r.toId === toId && r.type === type);
    if (dup) return dup.id;
    if (type === 'spouse' || type === 'sibling') {
      const rev = rels.find(r => r.fromId === toId && r.toId === fromId && r.type === type);
      if (rev) return rev.id;
    }
    const r = { id: `r${nextId++}`, fromId, toId, type };
    rels.push(r);
    return r.id;
  },
  async removeRelationship(id) { rels = rels.filter(r => r.id !== id); },
  async searchMembers() { return []; },
};
const App = { toast: () => {}, getCachedMembers: () => [], refreshTree: async () => {} };
const Utils = {
  REL_LABELS: {}, REL_TYPES: { PARENT_CHILD: 'parent_child', SPOUSE: 'spouse', SIBLING: 'sibling' },
  genderedRelLabel: () => '', createEl: () => ({ appendChild: () => {}, addEventListener: () => {} }),
  attachDateAutoCorrect: () => {}, validateDate: () => ({ valid: true }), debounce: f => f,
};
const Profile = { getEditingMemberId: () => null, save: async () => {}, edit: () => {}, show: () => {} };
const Auth = { getUser: () => null };
const document = { getElementById: () => ({ value: '', innerHTML: '', appendChild: () => {}, style: {} }) };

// relations.js laden
const src = fs.readFileSync(process.argv[2] || 'js/relations.js', 'utf8');
const factory = new Function('DB', 'App', 'Utils', 'Profile', 'Auth', 'document',
  src.replace('const Relations =', 'return'));
const Relations = factory(DB, App, Utils, Profile, Auth, document);

// ─── Test-Helfer ───
const has = (f, t, type) => rels.some(r =>
  (r.fromId === f && r.toId === t && r.type === type) ||
  ((type === 'spouse' || type === 'sibling') && r.fromId === t && r.toId === f && r.type === type));
const count = () => rels.length;
const reset = () => { rels = []; nextId = 1; };
let failures = 0;
const assert = (cond, msg) => {
  if (cond) console.log(`  ✓ ${msg}`);
  else { console.log(`  ✗ FEHLER: ${msg}`); failures++; }
};

(async () => {
  // ── S1: Kind via Mutter, Mutter hat genau einen Ehemann ──
  console.log('S1: Kind via Mutter → Vater automatisch');
  reset();
  await DB.addRelationship('vater', 'mutter', 'spouse');
  await DB.addRelationship('mutter', 'kind1', 'parent_child');   // manueller Add (wie createRelationByType)
  let n = await Relations.propagateLogicalRelations('kind1', 'mutter', 'child');
  assert(has('vater', 'kind1', 'parent_child'), 'Vater→Kind1 ergänzt');
  assert(n === 1, `genau 1 Ergänzung (war ${n})`);

  // ── S2: zweites Kind via Mutter → Vater + Geschwister ──
  console.log('S2: zweites Kind via Mutter → Vater + Geschwister');
  await DB.addRelationship('mutter', 'kind2', 'parent_child');
  n = await Relations.propagateLogicalRelations('kind2', 'mutter', 'child');
  assert(has('vater', 'kind2', 'parent_child'), 'Vater→Kind2 ergänzt');
  assert(has('kind1', 'kind2', 'sibling'), 'Geschwister Kind1–Kind2 ergänzt');
  assert(n === 2, `genau 2 Ergänzungen (war ${n})`);

  // ── S3: Mutter mit ZWEI Ehemännern → kein Auto-Vater ──
  console.log('S3: zwei Ehemänner → kein automatischer Vater');
  reset();
  await DB.addRelationship('m1', 'mutter', 'spouse');
  await DB.addRelationship('m2', 'mutter', 'spouse');
  await DB.addRelationship('mutter', 'kind', 'parent_child');
  n = await Relations.propagateLogicalRelations('kind', 'mutter', 'child');
  assert(!has('m1', 'kind', 'parent_child') && !has('m2', 'kind', 'parent_child'),
    'kein Ehemann automatisch als Vater');
  assert(n === 0, `keine Ergänzung (war ${n})`);

  // ── S4: Geschwister-Add → Eltern kopiert + Kaskade zu weiteren Geschwistern ──
  console.log('S4: neues Geschwister → Eltern + Kaskade');
  reset();
  await DB.addRelationship('vater', 'mutter', 'spouse');
  await DB.addRelationship('vater', 'a', 'parent_child');
  await DB.addRelationship('mutter', 'a', 'parent_child');
  await DB.addRelationship('vater', 'b', 'parent_child');
  await DB.addRelationship('mutter', 'b', 'parent_child');
  await DB.addRelationship('a', 'b', 'sibling');
  await DB.addRelationship('neu', 'a', 'sibling');              // manueller Add
  n = await Relations.propagateLogicalRelations('neu', 'a', 'sibling');
  assert(has('vater', 'neu', 'parent_child'), 'Vater→Neu ergänzt');
  assert(has('mutter', 'neu', 'parent_child'), 'Mutter→Neu ergänzt');
  assert(has('neu', 'b', 'sibling'), 'Kaskade: Geschwister Neu–B ergänzt');

  // ── S5: Erstehe → Kinder geteilt + Geschwisterlinks ──
  console.log('S5: Erstehe teilt Kinder');
  reset();
  await DB.addRelationship('anna', 'k1', 'parent_child');
  await DB.addRelationship('bernd', 'k2', 'parent_child');
  await DB.addRelationship('anna', 'bernd', 'spouse');           // manueller Add
  n = await Relations.propagateLogicalRelations('anna', 'bernd', 'spouse');
  assert(has('bernd', 'k1', 'parent_child'), 'Bernd→K1 ergänzt');
  assert(has('anna', 'k2', 'parent_child'), 'Anna→K2 ergänzt');
  assert(has('k1', 'k2', 'sibling'), 'Kaskade: Geschwister K1–K2');

  // ── S6: Zweitehe → KEINE Kinder-Teilung (Stiefeltern-Schutz) ──
  console.log('S6: Zweitehe teilt keine Kinder');
  reset();
  await DB.addRelationship('anna', 'ex', 'spouse');
  await DB.addRelationship('anna', 'k1', 'parent_child');
  await DB.addRelationship('anna', 'neuer', 'spouse');           // manueller Add
  n = await Relations.propagateLogicalRelations('anna', 'neuer', 'spouse');
  assert(!has('neuer', 'k1', 'parent_child'), 'Stiefvater NICHT als Elternteil');
  assert(n === 0, `keine Ergänzung (war ${n})`);

  // ── S7: Kind hat schon 2 Eltern → nie ein drittes ──
  console.log('S7: nie ein drittes Elternteil');
  reset();
  await DB.addRelationship('p1', 'kind', 'parent_child');
  await DB.addRelationship('p2', 'kind', 'parent_child');
  await DB.addRelationship('p3', 'stief', 'spouse');
  await DB.addRelationship('kind', 'stief', 'sibling');          // manueller Add: Halbgeschwister
  n = await Relations.propagateLogicalRelations('kind', 'stief', 'sibling');
  const parentsKind = rels.filter(r => r.type === 'parent_child' && r.toId === 'kind').length;
  assert(parentsKind === 2, `Kind behält 2 Eltern (hat ${parentsKind})`);

  // ── S8: Idempotenz — gleicher Add zweimal ergänzt nichts doppelt ──
  console.log('S8: Idempotenz');
  reset();
  await DB.addRelationship('vater', 'mutter', 'spouse');
  await DB.addRelationship('mutter', 'kind1', 'parent_child');
  await Relations.propagateLogicalRelations('kind1', 'mutter', 'child');
  const before = count();
  n = await Relations.propagateLogicalRelations('kind1', 'mutter', 'child');
  assert(count() === before && n === 0, 'zweiter Durchlauf ergänzt nichts');

  // ── S9: Vollkaskade — Kind via Vater, Mutter + 2 bestehende Kinder ──
  console.log('S9: Vollkaskade Kind via Vater');
  reset();
  await DB.addRelationship('vater', 'mutter', 'spouse');
  await DB.addRelationship('vater', 'a', 'parent_child');
  await DB.addRelationship('mutter', 'a', 'parent_child');
  await DB.addRelationship('vater', 'b', 'parent_child');
  await DB.addRelationship('mutter', 'b', 'parent_child');
  await DB.addRelationship('a', 'b', 'sibling');
  await DB.addRelationship('vater', 'c', 'parent_child');        // manueller Add: Kind via VATER
  n = await Relations.propagateLogicalRelations('vater', 'c', 'parent');
  assert(has('mutter', 'c', 'parent_child'), 'Mutter→C ergänzt');
  assert(has('c', 'a', 'sibling') && has('c', 'b', 'sibling'), 'Geschwister C–A und C–B');
  assert(n === 3, `genau 3 Ergänzungen (war ${n})`);

  // ── S10: Partner aus gemeinsamem Kind ableiten ──
  console.log('S10: gemeinsames Kind → Eltern werden Partner');
  reset();
  await DB.addRelationship('p1', 'c', 'parent_child');
  n = await Relations.propagateLogicalRelations('p1', 'c', 'parent');
  assert(n === 0, `1. Elternteil: keine Ergänzung (war ${n})`);
  await DB.addRelationship('p2', 'c', 'parent_child');
  n = await Relations.propagateLogicalRelations('p2', 'c', 'parent');
  assert(has('p1', 'p2', 'spouse'), 'Partner p1–p2 aus gemeinsamem Kind ergänzt');
  assert(n === 1, `genau 1 Ergänzung (war ${n})`);

  // ── S11: Partner-Kaskade — Partnerschaft teilt danach weitere Kinder ──
  console.log('S11: abgeleitete Partnerschaft teilt bestehende Kinder');
  reset();
  await DB.addRelationship('p1', 'x', 'parent_child');   // p1 hat schon Kind x (1 Elternteil)
  await DB.addRelationship('p1', 'c', 'parent_child');
  await DB.addRelationship('p2', 'c', 'parent_child');   // manueller Add
  n = await Relations.propagateLogicalRelations('p2', 'c', 'parent');
  assert(has('p1', 'p2', 'spouse'), 'Partner p1–p2 ergänzt');
  assert(has('p2', 'x', 'parent_child'), 'Kaskade: p2 wird zweites Elternteil von x');
  assert(has('c', 'x', 'sibling'), 'Kaskade: Geschwister c–x');

  // ── S12: kein Partner-Link bei nur einem Elternteil ──
  console.log('S12: ein Elternteil → kein Partner-Link');
  reset();
  await DB.addRelationship('solo', 'kind', 'parent_child');
  n = await Relations.propagateLogicalRelations('solo', 'kind', 'parent');
  assert(rels.filter(r => r.type === 'spouse').length === 0, 'keine Partner-Kante entstanden');

  console.log(failures === 0 ? '\nALLE TESTS BESTANDEN' : `\n${failures} TEST(S) FEHLGESCHLAGEN`);
  process.exit(failures === 0 ? 0 : 1);
})();
