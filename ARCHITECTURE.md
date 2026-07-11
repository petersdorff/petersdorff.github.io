# ARCHITECTURE.md — Stammbaum

Source of Truth für Architektur und Konventionen. Stand: Juli 2026.
(`SETUP.md` und `PLAN.md` stammen aus der Firebase-Ära des Prototyps und
sind **veraltet** — das Backend ist längst Supabase.)

## Überblick

PWA-Stammbaum für die Familie von Petersdorff-Campen (~116 Personen,
Gotha-Datenbasis). Vanilla HTML/CSS/JS ohne Build-Schritt, PCB-Ästhetik
(IBM Plex Mono). Zwei Betriebsarten:

- **Online (eingeloggt):** Lesen + Bearbeiten gegen Supabase.
- **Familientag-/Offline-Modus (Gast):** rein lesend aus dem gebündelten
  Snapshot `js/data-snapshot.js` — funktioniert komplett ohne Backend
  und ohne Konto (Identität wählen statt registrieren, QR-Codes,
  Verwandtschafts-Anzeige).

## Hosting & Deployment

- **GitHub Pages** direkt vom `main`-Branch, Root:
  https://kaiman22.github.io/stammbaum/ (Repo: Kaiman22/stammbaum, öffentlich).
- Deploy = push auf `main`. Build-Status:
  `gh api repos/Kaiman22/stammbaum/pages/builds/latest`.
- **Cache-Busting ist Pflicht bei jeder Änderung:**
  1. Versionsquery der geänderten Dateien in `index.html` erhöhen
     (`js/app.js?v=42` → `?v=43` usw.).
  2. `CACHE_NAME` in `sw.js` erhöhen (`stammbaum-v47` → `v48`).
  Ohne beides sehen PWA-Nutzer die Änderung nicht (Service Worker cached
  alles; neue Version greift erst beim zweiten Öffnen).

## Backend (Supabase)

- Projekt-Ref `ixdcyoivtapglllmwvut` (eu-central-1), URL + anon key oben in
  `js/app.js`. **Achtung:** Supabase pausiert/löscht Free-Tier-Projekte bei
  Inaktivität — Wiederherstellung/Neuaufbau ist in `RESTORE.md` beschrieben
  (Schema-Dateien, Migrationsreihenfolge, Datenimport, Snapshot-Refresh).
- Tabellen: `members`, `relationships`, `user_approvals`; Storage-Bucket
  `photos`. Schema: `supabase-schema.sql`, dann
  `supabase-migration-approvals.sql`, `migrations/002…`, `migrations/003…`.
- **Zugriffsmodell:** Registrierung per E-Mail → Admin-Freigabe
  (`user_approvals`, Admin ist hart codiert `kaivonpetersdorff@me.com` in
  `js/admin.js` und Migration 003). Nur Kai, Tabea, Stephan haben Konten
  (Stand Juli 2026); geclaimte Profile sind an `claimed_by_uid` erkennbar.
- **Offener Sicherheitspunkt (Stand Juli 2026):** Migration
  `003_enforce_approvals_rls.sql` muss nach der Projekt-Reaktivierung noch
  im SQL-Editor eingespielt werden — bis dahin ist die Freigabe nur ein
  Client-Check. Außerdem: Repo ist öffentlich inkl. Familiendaten; der alte
  service_role-Key stand bis Juli 2026 in der Git-Historie (folgenlos für
  das alte Projekt, aber: Keys nie committen; `fetch-db.sh`/`update-db.sh`
  sind lokal + gitignored und enthalten den service_role-Key).

## Datenmodell & Konventionen

`members`: Person mit `is_placeholder` (niemand hat das Profil beansprucht),
`claimed_by_uid` (Konto-Verknüpfung), `is_deceased`, `gender`, `gotha_code` …
Ein Profil gilt als „registriert" ⇔ `is_placeholder = false`; im Baum
durchgezogener Rahmen, sonst gestrichelt (Legende: ⓘ-Button).
**Badge-Logik in `profile.js` prüft nur `isPlaceholder`** — nie
`claimedByUid`, denn der ist im öffentlichen Snapshot immer `null`.

`relationships`: gerichtete Kanten `from_id → to_id` mit `rel_type`:
- `parent_child` (Eltern → Kind; **hartes Limit: max. 2 Eltern pro Kind**)
- `spouse` (ungerichtet gespeichert, dedupe in beide Richtungen;
  bedeutet generisch „Partner", nicht zwingend verheiratet)
- `sibling` (ungerichtet; wird meist automatisch gepflegt)

## Modulstruktur (js/)

| Modul | Zuständigkeit |
|---|---|
| `app.js` | Init, Supabase-Client, Auth-Listener, Views, Toasts, FABs, Legende |
| `auth.js` | Login/Registrierung/Passwort-Reset, Fehler-Mapping (`mapAuthError`) |
| `db.js` | Alle Supabase-Zugriffe + Offline-Fallback auf `LocalSnapshot` |
| `tree.js` | Cytoscape-Visualisierung (Layout, Semantic Zoom, Highlights) |
| `relations.js` | Beziehungs-UI **und Auto-Vervollständigungs-Engine** (s.u.) |
| `relationship.js` | Verwandtschaftsgrad-Berechnung (Pfadsuche, Begriffe) |
| `profile.js` | Profile anzeigen/bearbeiten, Badges, Pflicht-Erstverbindung |
| `guest.js` | Familientag-Modus (Identität wählen, offline) |
| `connection.js` | „Wie sind wir verwandt?"-Panel, QR-Deep-Links `#connect/<id>` |
| `claim.js` | Profil beanspruchen nach Registrierung |
| `admin.js` | Freigabe-Panel, EmailJS-Benachrichtigung |
| `search.js`, `qr.js`, `utils.js` | Suche, QR-Codes, Helfer |
| `data-snapshot.js` | GENERIERT — nicht von Hand bearbeiten |

## Baum-Visualisierung (`tree.js`)

- **Layout:** eigener Bottom-up-Tidy-Tree (Reingold-Tilford-Prinzip):
  Kinder zuerst, Eltern zentriert darüber. Paare werden als Einheit mit
  unsichtbarem Mittelpunktknoten (`couple-midpoint`) gelegt; Mehrfach-Ehen
  über `multiCoupleMap`. Zwei Modi: `generational` (Reihen) und `temporal`
  (Y ∝ Geburtsjahr), Umschalter in der Top-Bar.
- **Semantic Zoom (LOD),** `applyLod()` mit Schwellen `LOD_MID = 0.55`,
  `LOD_FAR = 0.28`: nah = Vor-+Nachname+Daten, mittel = Vorname+Geburtsjahr,
  fern = nur Vorname (nie ganz ohne Label). Klassen `lod-mid`/`lod-far`
  werden nur bei Stufenwechsel getauscht.
- **Rahmen-Semantik:** durchgezogen = registriert, gestrichelt = Platzhalter,
  grau = verstorben, rot/dick = Du / Auswahl / Verwandtschaftspfad.
- **Tap auf Person:** sofortiges Zentrieren beim aktuellen Zoom
  (`centerOn(id, null, false)` — `zoom=null` heißt „Zoom beibehalten"),
  dann Profil. Wichtig: nicht animieren, der View-Wechsel würde die
  Animation abbrechen.
- Debug-Helfer: `Tree.getZoom()`, `Tree.getEffectiveLabel(id)`.

## Beziehungs-Automatik (`relations.js → propagateLogicalRelations`)

Kaskadierende Regel-Engine: Graph wird EINMAL geladen, in-memory
fortgeschrieben; jede automatisch ergänzte Kante wird selbst wieder
geprüft, bis nichts sicher Ableitbares mehr übrig ist. Wird bei jedem
manuellen Hinzufügen aufgerufen (drei Pfade: Beziehung zwischen
Bestehenden, neue Person im Bearbeiten-Dialog, neue Person mit
Pflicht-Erstverbindung). Ergebnis-Toast: „n Verbindungen automatisch ergänzt".

Regeln (nur eindeutig sichere Ergänzungen):
1. `parent_child(P→C)`: (a) hat P genau EINEN erfassten Partner, wird der
   zweites Elternteil; (b) andere Kinder von P ⇒ Geschwister von C;
   (c) explizite Geschwister von C erben P; (d) hat C zwei Eltern ⇒ diese
   werden Partner (auch unverheiratet/getrennt — Eltern gemeinsamer Kinder).
2. `sibling(A,B)`: Eltern gegenseitig kopieren.
3. `spouse(A,B)`: Kinder teilen — nur wenn beidseitig einzige Partnerschaft.

Bewusst NICHT automatisiert: zweites Elternteil bei mehreren Ehen
(mehrdeutig), Kinder-Teilung in Zweitehen (Stiefeltern-Falle), jemals ein
drittes Elternteil.

**Tests:** `node tools/test-propagate.js js/relations.js` — 12 Szenarien
headless mit Mock-DB, nach jeder Änderung an der Engine ausführen.
Widersprüche beim manuellen Anlegen räumt `cleanConflictingRelations` ab.

## Offline-Snapshot & Familientag

- `tools/generate-snapshot.py` erzeugt `js/data-snapshot.js`:
  bevorzugt `--from-db` (braucht `SUPABASE_URL`+`SUPABASE_SERVICE_KEY` als
  Env-Vars), sonst Fallback aus `import_data.py` (Gotha-Stand Feb 2026 —
  Achtung: setzt dann ALLE als Platzhalter). Auth-IDs/Kontaktdaten werden
  für den öffentlichen Snapshot entfernt.
- Nach dem Generieren: Version von `data-snapshot.js` in `index.html` und
  `CACHE_NAME` in `sw.js` erhöhen, committen, pushen.
- `db.js` schaltet automatisch auf den Snapshot, wenn Supabase nicht
  erreichbar ist (`getFullGraph` mit Timeout); Schreiben wirft dann
  `Offline-Modus: Änderungen sind zurzeit nicht möglich.`
- Familientag-Checkliste und QR-Namensschilder: siehe `RESTORE.md` §6.

## Entwicklung & Betrieb

- Lokal: statischer Server reicht (`python3 -m http.server -d .`);
  in Claude Code über `.claude/launch.json`-Eintrag `stammbaum`.
- Kein Framework, kein Bundler, keine npm-Abhängigkeiten; Cytoscape & Co.
  liegen als Vendor-Dateien bzw. CDN-frei im Repo. UI-Sprache: Deutsch.
- Branches: `main` = live; `feature/multi-spouse` (gemerged-Stand prüfen),
  `feature/temporal-view` (nur lokal) sind historische Feature-Branches.
- `gotha-data-extract.md` ist die Quell-Transkription (Gotha S. 293–306),
  `import_data.py` der zugehörige Importer (IDs deterministisch aus
  `gotha_code` → `make_id`).
