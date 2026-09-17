/* Headless-Test der deutschen Verwandtschaftsbezeichnungen (js/relationship.js).
     node tools/test-terms.js        # ohne Geschwister-Kanten
     node tools/test-terms.js sib    # mit Geschwister-Kanten (wie die Regel-Engine sie anlegt)
   Synthetischer Baum, Erwartungen nach Wikipedia „Verwandtschaftsbeziehung":
   Cousin n. Grades = gemeinsame Vorfahren (n+1) Generationen zurück;
   Onkel/Neffe n. Grades = Cousin (n-1). Grades eines Elternteils bzw. Kind
   eines Cousins (n-1). Grades; Groß-/Ur- je weiterer Generation Abstand. */
const fs = require('fs');
const src = fs.readFileSync('' + __dirname + '/../js/relationship.js', 'utf8');
const Relationship = new Function(src + '\nreturn Relationship;')();   // IIFE-Global ohne Browser
// Synthetischer Stammbaum: R ∞ Rw → A(m), B(f); A → A1(m), A2(f); B → B1(m); A1 → A1a(m); B1 → B1a(f); A1a → A1aa(m); B1a → B1aa(f); A1 ∞ W(f)
const P = {}; const members = []; const rels = []; let rid = 0;
const add = (id, gender, first = id) => { const m = { id, firstName: first, lastName: 'T', gender, birthDate: '', isDeceased: false }; members.push(m); P[id] = m; };
const pc = (p, c) => rels.push({ id: 'r' + (rid++), fromId: p, toId: c, type: 'parent_child' });
const sp = (a, b) => rels.push({ id: 'r' + (rid++), fromId: a, toId: b, type: 'spouse' });
['R','A','A1','A1a','A1aa','B1','X'].forEach(i => add(i, 'm')); ['Rw','B','A2','B1a','B1aa','W','Xw','Aw','Bw'].forEach(i => add(i, 'f'));
sp('R','Rw'); [['R','A'],['Rw','A'],['R','B'],['Rw','B'],['A','A1'],['A','A2'],['B','B1'],['A1','A1a'],['B1','B1a'],['A1a','A1aa'],['B1a','B1aa']].forEach(([p,c]) => pc(p,c));
sp('A1','W'); sp('A','Aw'); pc('Aw','A1'); pc('Aw','A2'); // W angeheiratet; Aw Mutter von A1/A2
// Halbgeschwister: X ist Sohn von A mit zweiter Frau Xw
sp('A','Xw'); pc('A','X'); pc('Xw','X');
const withSib = process.argv[2] === 'sib'; if (withSib) { const sib = (a, b) => rels.push({ id: 'r' + (rid++), fromId: a, toId: b, type: 'sibling' }); sib('A1','A2'); sib('A1','X'); sib('A2','X'); sib('A','B'); }
const t = (a, b) => Relationship.getConnection(a, b, members, rels).term;
const cases = [
  ['A1','A2','Schwester'], ['A2','A1','Bruder'], ['A1','B1','Cousin'], ['B1','A2','Cousine'],
  ['A1','B','Tante'], ['B','A1','Neffe'], ['A1','B1a','Nichte 2. Grades'], ['B1a','A1','Onkel 2. Grades'],
  ['A1a','B1a','Cousine 2. Grades'], ['A1aa','B1aa','Cousine 3. Grades'], ['A1aa','B1a','Tante 3. Grades'], ['B1a','A1aa','Neffe 3. Grades'],
  ['A1a','B','Großtante'], ['B','A1a','Großneffe'], ['A1aa','B','Urgroßtante'], ['B','A1aa','Urgroßneffe'],
  ['R','A1aa','Ururenkelsohn'], ['A1aa','R','Ururgroßvater'], ['A1aa','Rw','Ururgroßmutter'], ['A','A1a','Enkelsohn'], ['A1a','A','Großvater'],
  ['A2','W','Schwägerin'], ['W','A2','Schwägerin'], ['A','W','Schwiegertochter'], ['W','A','Schwiegervater'], ['B1','W','Cousine (angeheiratet)'],
  ['A1aa','B1aa','Cousine 3. Grades'], ['A1','X','Halbbruder'], ['X','A2','Halbschwester'], ['W','A','Schwiegervater'], ['W','Aw','Schwiegermutter'], ['A','W','Schwiegertochter'], ['W','A1a','Stiefsohn'], ['A1a','W','Stiefmutter'], ['W','B1','Cousin (angeheiratet)'], ['W','B','Tante (angeheiratet)'], ['B','W','Nichte (angeheiratet)'], ['A1a','B1aa','Nichte 3. Grades'],
  ['B1aa','A1a','Onkel 3. Grades'], ['A1aa','B1','Großonkel 2. Grades'], ['B1','A1aa','Großneffe 2. Grades'],
];
let bad = 0;
for (const [a, b, exp] of cases) { const got = t(a, b); const ok = got === exp; if (!ok) bad++; console.log((ok ? '  ok ' : '  !! ') + a + ' → ' + b + ': ' + got + (ok ? '' : '   (erwartet: ' + exp + ')')); }
console.log(bad ? bad + ' Abweichungen' : 'alle ' + cases.length + ' Fälle ok');
