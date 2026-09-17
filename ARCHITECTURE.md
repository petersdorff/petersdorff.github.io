# ARCHITECTURE.md — Stammbaum

Source of Truth für Architektur und Konventionen. Stand: Juli 2026.
(`SETUP.md` und `PLAN.md` stammen aus der Firebase-Ära des Prototyps und
sind **veraltet** — das Backend ist längst Supabase.)

## Überblick

PWA-Stammbaum für die Familie von Petersdorff-Campen (~116 Personen,
Gotha-Datenbasis). Vanilla HTML/CSS/JS ohne Build-Schritt, PCB-Ästhetik
(IBM Plex Mono). Zwei Betriebsarten:

- **Online (eingeloggt):** Lesen + Bearbeiten gegen Supabase.
- **Familientag-Modus (Gast):** rein lesend, ohne Konto, aber **nur mit
  dem zeitlich begrenzten Familientag-Code**; der Baum kommt aus der
  DB-Funktion `guest_graph(code)` (Identität wählen statt registrieren,
  QR-Codes, Verwandtschafts-Anzeige). Es gibt **keinen öffentlichen
  Daten-Snapshot mehr** — seit 15.09.2026 liegt nichts Persönliches in
  Repo oder Website (History bereinigt). Ohne erreichbares Backend geht
  nur noch eine Fehlermeldung.

## Hosting & Deployment

- **GitHub Pages** direkt vom `main`-Branch, Root:
  **https://petersdorff.github.io/** (Repo `petersdorff/petersdorff.github.io`,
  öffentlich, Organisations-Site → Root von `main`). Seit 14.09.2026; vorher
  `Kaiman22/stammbaum` unter kaiman22.github.io/stammbaum — dort liegt jetzt
  nur noch ein Weiterleitungs-Repo (index.html + 404.html leiten inkl.
  `#connect/…`-Deep-Links weiter, damit gedruckte QR-Codes weiter gehen).
- Deploy = push auf `main`. Build-Status:
  `gh api repos/petersdorff/petersdorff.github.io/pages/builds/latest`.
- Supabase-Auth: Site URL / Redirect URLs im Dashboard müssen
  `https://petersdorff.github.io/**` enthalten (Passwort-Reset, Magic-Link);
  die App baut `redirectTo` und QR-Links aus `window.location`. Stand
  15.09.2026 verifiziert: Site URL = neue Domain, alte Domain noch in der
  Allowlist. Prüfen ohne Mailversand: `GET /auth/v1/verify?token=bogus
  &type=recovery&redirect_to=<URL>` — der Location-Header zeigt, ob die URL
  erlaubt ist (sonst Fallback auf die Site URL).
- **Mailzustellung (Passwort-Reset, Registrierung):** Supabase verschickt
  über den geteilten Absender `noreply@mail.app.supabase.io`. iCloud/Gmail
  liefern zu, **GMX und web.de sortieren in „Spamverdacht"** (15.09.2026,
  pdorff@gmx.de — Mail war da, nur im Spam). Ob eine Mail überhaupt
  rausging, steht in `recovery_sent_at` des Auth-Users (Admin-API). Erste
  Hilfe: Spam-Ordner + Absender freischalten, dann erneut anfordern (Link
  gilt 1 h). Ohne E-Mail: `POST /auth/v1/admin/generate_link`
  (type=recovery) erzeugt den Link direkt. Dauerhafte Lösung: eigener SMTP
  (Dashboard → Auth → SMTP), z.B. Gmail-SMTP mit App-Passwort.
  Bekannte Lücke: Ein abgelaufener Link (`#error=…otp_expired`) zeigt in
  der App keine Meldung, nur den Login-Screen.
- **Cache-Busting ist Pflicht bei jeder Änderung:**
  1. Versionsquery der geänderten Dateien in `index.html` erhöhen
     (`js/app.js?v=42` → `?v=43` usw.).
  2. `CACHE_NAME` in `sw.js` erhöhen (`stammbaum-v47` → `v48`).
  Ohne beides sehen PWA-Nutzer die Änderung nicht (Service Worker cached
  alles; neue Version greift erst beim zweiten Öffnen).

## Login-Seite (`#view-auth`)

Kopf: beide Familienwappen nebeneinander (`assets/img/wappen-petersdorff.png`
= Pommern, rot mit Muschelbalken; `wappen-petersdorff-campen.png` = Mark,
schwarz mit Dreieck; beide im SW-Precache, 120 px hoch), Titel „Digitaler
Stammbaum", Untertitel „Familien von Petersdorff und von
Petersdorff-Campen", Fußzeile „Feedback: kaivonpetersdorff@me.com"
(mailto). Die Karte zentriert sich über `margin: auto` im Spaltenlayout —
nicht über `justify-content: center`, das schneidet auf kleinen Screens
oben ab.

## Backend (Supabase)

- Projekt-Ref `ixdcyoivtapglllmwvut` (eu-central-1), URL + anon key oben in
  `js/app.js`. Supabase pausiert Free-Tier-Projekte nach 7 Tagen ohne
  API-Aufruf (Juli und September 2026 passiert). Dagegen läuft
  **`.github/workflows/supabase-keepalive.yml`**: täglicher REST-Ping, der
  bei Fehler den Lauf rot macht → GitHub mailt den Owner (= Health-Monitor).
  Caveat: GitHub schaltet Cron-Workflows nach 60 Tagen ohne Commit ab —
  dann manuell auslösen oder pushen. Falls das Projekt doch pausiert:
  Dashboard → Restore, dauert ~5 Min (DNS kommt vor der REST-API, die
  antwortet zwischenzeitlich 502/404). Neuaufbau nach Löschung: `RESTORE.md`.
- **Nach jedem Restore** prüfen: offene Freigaben im Admin-Panel (Mails
  gingen während der Pause ggf. unter).
- Tabellen: `members`, `relationships`, `user_approvals`; Storage-Bucket
  `photos`. Schema: `supabase-schema.sql`, dann
  `supabase-migration-approvals.sql`, `migrations/002…`, `migrations/003…`.
- **Migrationen 002, 004, 005, 006 eingespielt (13.09.2026, verifiziert):**
  `members.occupation` existiert, Foto-Policies gesetzt, `is_admin()`
  vorhanden, Status-Constraint aktiv, anonymes Lesen von `user_approvals`
  liefert `[]`. `db.js` behält den Fallback `writeWithColumnFallback`
  (lässt bei „Spalte fehlt" GENAU diese Spalte weg, Warnung in der
  Konsole) — nie wieder pauschal Spalten verwerfen, das hatte `gender`
  still verschluckt. Nach einem Neuaufbau des Projekts alle Migrationen
  in Reihenfolge 002 → 003 → 004 → 005 → 006 → 007 → 008 → 009 → 010 erneut ausführen.
- **Zugriffsmodell (4 Stufen):** Gast/Familientag (nur mit Code, nur
  lesen, ohne Kontaktfelder) · registriert-wartend (nichts, Warteseite;
  mit Code sofort freigeschaltet) · Mitglied `approved` (alles
  lesen, Personen/Beziehungen anlegen und ändern, Kernfelder beanspruchter
  Profile nur Inhaber/Admin) · Admin. **Admin = `user_approvals.role =
  'admin'`** (Migration 005, vergebbar in der Nutzerverwaltung durch jeden
  Admin) **oder die Bootstrap-E-Mail** `kaivonpetersdorff@me.com` (fest in
  `js/admin.js` und `is_admin()`; kann nicht ausgesperrt werden). Client:
  `Admin.setCurrentRole(user, approval)` beim Login, danach
  `Admin.isAdmin()`. Status in `user_approvals`: `pending | approved |
  rejected | revoked` (revoked = gesperrt, Konto bleibt). Profil ↔ Konto
  über `members.claimed_by_uid` (Nutzerverwaltung: verknüpfen / lösen).
- **Nutzerverwaltung** (Menü → Admin, `Admin.showAdminPanel`): alle Konten
  gruppiert nach Status mit verknüpftem Profil; Aktionen Freigeben /
  Ablehnen / Sperren / Entsperren / Profil-Verknüpfung lösen
  (`DB.setApprovalStatus`, `DB.unclaimMember`). Konten löschen nur im
  Supabase-Dashboard (Service-Rolle).
- **Migration 004 (`migrations/004_user_management_and_policy_fixes.sql`,
  eingespielt 13.09.2026):** ersetzt die ursprünglichen `USING (true)`-
  Policies (anonymes Lesen aller E-Mails, Selbst-Freigabe per REST) durch
  „eigene Zeile bzw. Admin", ergänzt `revoked`, spiegelt den Kernfeld-
  Schutz in RLS und beschränkt Löschen auf Platzhalter. Stand 13.09.2026:
  5 Konten, 3 Profile verknüpft.
- **Serverseitige Freigabe-Prüfung** (Migration 003) ist eingespielt —
  verifiziert September 2026: RLS-Policies laufen über `public.is_approved()`,
  nicht freigegebene Konten lesen nichts. Prüfen per
  `POST /rest/v1/rpc/is_approved` (200 = Funktion existiert; 404 = fehlt).
  Nach einem Neuaufbau des Projekts muss sie wieder eingespielt werden.
- **Offener Sicherheitspunkt:** Repo ist öffentlich inkl. Familiendaten
  (Namen, Geburts-/Sterbedaten); der Login schützt faktisch nur
  Kontaktdaten und den Schreibzugriff. Der alte service_role-Key stand bis
  Juli 2026 in der Git-Historie — Keys nie committen; `fetch-db.sh`/
  `update-db.sh` sind lokal + gitignored und enthalten den service_role-Key.
- Die Supabase-CLI auf dem MacBook ist mit einem *anderen* Konto eingeloggt
  (sieht nur Projekt `ktgchgljmybnzmzkmyfi`) — Migrationen für dieses
  Projekt daher über den SQL-Editor im Dashboard, nicht per CLI.

## Datenmodell & Konventionen

`members`: Person mit `is_placeholder` (niemand hat das Profil beansprucht),
`claimed_by_uid` (Konto-Verknüpfung), `is_deceased`, `gender`, `gotha_code` …
Ein Profil gilt als „registriert" ⇔ `is_placeholder = false`; im Baum
durchgezogener Rahmen, sonst gestrichelt (Legende: ⓘ-Button).
**Badge-Logik in `profile.js` prüft nur `isPlaceholder`** — nie
`claimedByUid` (historisch: im früheren Snapshot immer `null`).

`relationships`: gerichtete Kanten `from_id → to_id` mit `rel_type`:
- `parent_child` (Eltern → Kind; **hartes Limit: max. 2 Eltern pro Kind**)
- `spouse` (ungerichtet gespeichert, dedupe in beide Richtungen;
  bedeutet generisch „Partner", nicht zwingend verheiratet). **`is_former`**
  (Migration 006) markiert getrennte/geschiedene Partnerschaften — der
  Typ bleibt `spouse` (Layout, Pfadsuche, Regel-Engine unverändert); UI-
  Typ `ex_spouse` → `addRelationship(…, 'spouse', { isFormer: true })`,
  bestehende Kante wird nur umgeflaggt. Anzeige: Fächer ⚮ statt ∞, Baum
  gestrichelt, Begriff „Ehemalige/r Partner/in".
- `sibling` (ungerichtet; wird meist automatisch gepflegt)

## Modulstruktur (js/)

| Modul | Zuständigkeit |
|---|---|
| `app.js` | Init, Supabase-Client, Auth-Listener, Views, Toasts, FABs, Legende |
| `auth.js` | Login/Registrierung/Passwort-Reset, Fehler-Mapping (`mapAuthError`) |
| `db.js` | Alle Supabase-Zugriffe; Gastmodus liest aus `guestRows` (RPC `guest_graph`), Invite-Code-RPCs, `app_settings` |
| `tree.js` | **Stammtafel** (Ansicht `tree`): verdichtete Nachfahrentafel in reinem SVG — Kontur-Layout, gestapelte Geschwister, Partner unter der Person, Generationsbänder, Minimap, Ein-/Ausklappen. Seit Sept. 2026 ohne Cytoscape; `temporal` ist entfallen |
| `fan.js` | **Fächer-Ansicht (Standard)**: radialer Nachkommen-Sunburst in reinem SVG, s.u. |
| `gotha.js` | **Gotha-Verzeichnis**: eingerücktes, klappbares Textverzeichnis je Generation (`#gotha-container`), nutzt `Fan.buildFamiliesFrom` |
| `article.js` | **Artikelseite** (`view-article`): Properties wie Notion + ausführliche Vita als Markdown; Editiermodus mit Toolbar. Quelle: `members.notes` |
| `markdown.js` | Minimaler, XSS-sicherer Markdown-Renderer (`render`, `toPlain`, `excerpt`) — keine Bibliothek, offline |
| `relations.js` | Beziehungs-UI **und Auto-Vervollständigungs-Engine** (s.u.) |
| `relationship.js` | Verwandtschaftsgrad-Berechnung (Pfadsuche, Begriffe) |
| `profile.js` | Profile anzeigen/bearbeiten, Badges, Pflicht-Erstverbindung |
| `guest.js` | Familientag-Modus (Code-Abfrage, Identität wählen, nur lesen) |
| `connection.js` | „Wie sind wir verwandt?"-Panel, QR-Deep-Links `#connect/<id>` |
| `claim.js` | Profil beanspruchen nach Registrierung |
| `admin.js` | Freigabe-Panel, EmailJS-Benachrichtigung |
| `search.js`, `qr.js`, `utils.js` | Suche, QR-Codes, Helfer |

## Stammtafel (`tree.js`) — Ansicht `tree`

Komplett neu geschrieben (Sept. 2026, Branch `feature/tree-v2`), ohne
Cytoscape, gleiche Bau-Prinzipien wie der Fächer (viewBox-Pan/Zoom,
Pointer-Capture, Tap-Ziel beim `pointerdown` merken, semantischer Zoom).
Die Ansicht `temporal` (Y ∝ Geburtsjahr) wurde ersatzlos gestrichen.

- **Einheit = Blutsverwandter + Partner:** Personenkarte (104×40), darunter
  je Partner eine schmalere Karte (∞ / ⚮ ehemalig, gestrichelt); Karten
  sind einzeln antippbar (`data-id`) → eigenes Profil. Baum kommt aus
  `Fan.buildFamiliesFrom` (aktiver Zweig, App liefert die Teilmenge).
- **Verdichtung:** (1) kinderlose Geschwister werden zu **Spalten
  gestapelt** (bis `MAX_COL_H` = 150 Einheiten, dann neue Spalte) und an
  einer Sammel-Linie links mit Stichleitungen angebunden — nur Kinder mit
  eigenen Nachkommen bekommen eigene Teilbäume; (2) **konturbasiertes
  Tidy-Layout** (`layout → build`): je Knoten linke/rechte Kontur pro
  Ebene, Slots rücken so weit zusammen, wie die Kontur des bisherigen
  „Waldes" es auf allen Ebenen erlaubt (Teilbäume tucken unter breite
  Nachbarn), Eltern mittig über erstem/letztem Slot; Slots nach Geburt des
  ersten Mitglieds sortiert. Ergebnis Märkisch: ~3300 × 1170 Einheiten
  statt der alten zehntausend Pixel Breite.
- **Generationen:** feste Zeilen (`rows[g] = {y, h, minYear}`, Höhe = höchste
  Einheit/Spalte der Generation), abwechselnd hinterlegte Bänder im SVG
  und **bildschirmfixe Labels links** (`.tree-genlabels`, römisch + „ab
  Jahr", bei schmalen Bändern nur die Ziffer, unter 18 px keine).
- **Verbindungen:** orthogonal — Ableitung aus der Einheit, Sammelschiene
  in der Zeilenlücke (`V_GAP` = 60), Abgänge zu den Slots.
- **Ein-/Ausklappen:** Chip unter jeder Einheit mit Kindern (`data-toggle`,
  „−" bzw. „+n" Nachkommen); `toggleCollapse` layoutet neu und hält die
  Einheit optisch an Ort und Stelle. Pfad-Highlight und `centerOn` klappen
  eingeklappte Vorfahren automatisch auf. Zustand nur in der Sitzung.
- **Minimap** rechts oben (`.tree-minimap`, unter dem Familien-Umschalter
  auf schmalen Screens): alle Einheiten als Rechtecke, roter Rahmen =
  Ausschnitt, Klick/Ziehen springt.
- **Semantic Zoom** nach px/Einheit: fern (< 0.55) Vorname, mittel
  Vorname + Jahre bzw. „∞ Vorname (* Jahr)", nah (≥ 1.1) voller Name,
  Geburtsname, Daten. Schrift schrumpft bis Minimum, dann Ellipse. Farben
  wie im Fächer (Männer hellblau, Frauen rosa, Verstorbene blass; Partner
  heller), Rahmen: registriert dunkel, Platzhalter ohne, Du rot. Zoom:
  `fitAll` höchstens 1.6 px/Einheit, rein bis 3, raus bis 3× die Tafel —
  mindestens aber bis 0.35 px/Einheit, damit auch eine Tafel aus einer
  Karte (neuer Zweig) die Stufen fern/mittel erreicht statt beim
  Rauszoomen hineinzuspringen.
- **Pfad-Highlight:** beteiligte Einheiten `.tree-hl` (roter Rahmen),
  Kanten dazwischen `.tree-edge.hl`, alle anderen `.tree-dim`; danach
  `fitToHighlight` mit Platz fürs Panel (rechts Desktop / unten Mobil).
- **API** (von App/Guest/Connection genutzt): `init, render, centerOn(id,
  zoom, animate)` — `zoom`: `null` = beibehalten, `undefined` = 0.9
  px/Einheit, Zahl = px/Einheit —, `fitAll, highlightConnection,
  clearHighlight, setCurrentUser, onNodeTap, onBackgroundTap, collapse,
  isCollapsed, getZoom, getTier, getRows, getBBox`. Mausrad zoomt,
  Zwei-Finger-Wischen am Trackpad schiebt (deltaX ≠ 0).

## Fächer-Ansicht (`fan.js`) — Standardansicht

- **Fünf Ansichten** über den **Umschalter unten mittig** (`#view-switch`,
  Pille mit 5 Icons — Fächer (Geschlecht), Fächer nach Geburtsjahr,
  **Fächer nach Familienname** (`fan-name`: `Fan.setColorMode('name')`,
  nur wer aktuell den Nachnamen der Zweig-Wurzel trägt (`carriesName`,
  exakter Vergleich mit `lastName`) behält Farbe, alle anderen grau bzw.
  Labels/Partner-Zeilen `.fan-muted`; Legende nennt den Namen — die
  Aussagekraft hängt davon ab, dass verheiratete Töchter mit ihrem
  Ehenamen in `lastName` und dem Geburtsnamen in `birthName` erfasst sind),
  **Gotha-Verzeichnis**, **Stammtafel**; aktive Ansicht dunkel, gleiche
  Optik wie der Familien-Umschalter oben; der alte Zyklus-Button in der
  Top-Bar ist seit 14.09.2026 weg), gemerkt in
  `localStorage.stammbaum_view` (`fan`, `fan-years`, `fan-name`, `gotha`, `tree`;
  alte Werte `generational`/`temporal` werden auf `tree` gemappt).
  Stapel unten mittig von unten nach oben: Ansichts-Pille (16 px) →
  Gast-/Offline-Pille (66 px, nur wenn sichtbar; `body.has-status`) →
  Zeitstrahl (62 px, mit Status-Pille 112 px; Mobil 110 px). Offenes
  Seitenpanel (Desktop, `body.side-panel-open`) schiebt Ansichts- und
  Status-Pille in die Mitte der freien linken Hälfte;
  Der app-weite Zweig (`App.setActiveFamily` → `Fan.setPreferredFamily`)
  hat in `Fan.pickFamily` Vorrang vor dem zuletzt im Fächer gezeigten
  Zweig — sonst zeigte der Fächer nach einem Zweigwechsel in Gotha/Tafel
  noch den alten Zweig. `Fan.setColorMode('gender'|'year')` tauscht nur Füllfarben (Skala je
  Familienzweig vom ältesten bis jüngsten Geburtsjahr, Blau → Orange;
  Legende mit Farbbalken, wird beim Zweigwechsel nachgezogen);
  ohne Eintrag ist der Fächer Standard. `App.applyView(name)` ist die
  zentrale Stelle (Fan-Overlay ein/aus, Gotha, Legende, `updateViewSwitch`).
- **Familienzweige:** `buildFamilies()` erkennt Wurzeln automatisch:
  Person ohne Eltern mit Kindern, die nicht in eine dokumentierte Linie
  eingeheiratet ist (Partner hat Eltern); ein Stammelternpaar = eine
  Familie (ältester Partner ist Wurzel). Jede Familie bekommt ihren
  eigenen Fächer. **Die Zweig-Auswahl ist App-weit** (`app.js`:
  `computeFamilies`, `activeFamilyId`, `setActiveFamily`, `ensureFamilyFor`,
  `familySubset`) und gilt in allen fünf Ansichten: Umschalter
  `#family-switch` oben (nur bei ≥2), Auswahl in
  `localStorage.stammbaum_family`; Baum-Ansichten bekommen nur die
  Personen/Beziehungen des aktiven Zweigs, Gotha rendert nur ihn, der
  Fächer wählt ihn per `setPreferredFamily`/`setFamily` (interner
  Auto-Wechsel meldet über `onFamilyChange` zurück). Zentrieren/„Im
  Stammbaum zeigen"/Verwandtschaft wechseln bei Bedarf in den Zweig der
  Person. Waisen-Ablage = in keiner Familie erreichbar (einheitlich). Namen per `FAMILY_NAMES`,
  erkannt an der **Wurzel** (Tests bekommen das Member-Objekt): „…-Campen"
  → Märkische Familie; die Pommersche Familie hat **zwei Stammväter**
  (beide „von Petersdorff"), darum je Linie ein Test auf Stammsitz im
  `location`-Feld oder Vorname des Stammvaters — „Jacobsdorf"/„Dahme…" →
  **Jacobsdorf (Pomm)**, „Großenhagen"/„Jannike…" → **Großenhagen (Pomm)**;
  sonst „Familie <Nachname>". Angelegt 17.09.2026 (Platzhalter „Stammvater
  von Petersdorff" von 2026-09-13 gelöscht): Dahme (Daniel) von Petersdorff,
  * 1464, Jacobsdorf (Pommern), ID `bed5c986-…`; Jannike der Jüngere
  (Johannes) von Petersdorff, * 1470, Großenhagen (Pommern), ID
  `6f3dce22-…` — Jahreszahlen als `YYYY-01-01` (Konvention für „nur Jahr
  bekannt"), `is_deceased`, ohne Kinder. Eine bekannte Familie ohne Wurzel
  bekommt als Wurzel den ältesten elternlosen, nicht eingeheirateten
  Namensträger — so reicht ein Stammvater ohne Kinder, um den Zweig zu
  starten; Nachkommen kommen über „+ Kind" im Fächer. Kein Zweig-Feld in
  der DB — Zweige sind aus den Beziehungen abgeleitet. Drei Zweige → im
  Umschalter steht der Klammerzusatz „(Pomm)" in `.family-btn-suffix`, der
  unter 480 px ausgeblendet wird (dann „Jacobsdorf"/„Großenhagen", alles
  einzeilig); zur Sicherheit `width: max-content; flex-wrap` (ein absolut
  positioniertes Element mit `left: 50%` sähe sonst nur die halbe Breite
  und bräche jeden Knopf in eine eigene Zeile). `Fan.setFamily` setzt auch `preferredFamilyId`, sonst
  zieht `render()` → `pickFamily()` den alten Wunsch-Zweig zurück (Fächer
  und Umschalter zeigten verschiedene Zweige, wenn der Fächer beim
  Zentrieren selbst gewechselt hat).
- **Datenbestand Pommern (Import 17.09.2026):** beide Linien stammen aus
  der Gotha-Abschrift `vPetersdorff-Pom5.xlsx` (GHdA-Grundausgabe + Nachtrag
  einer neueren Ausgabe, 396 Zeilen), importiert per
  `stammbaum-private/pommern-import/import_pommern.py` (`--plan` /
  `--apply` / `--rollback`, IDs in `import_ids.json`; idempotent über feste
  UUIDv5 aus der Blattnummer). Übernommen: Blutlinie + Ehepartner (335
  Personen, davon 20 schon von Hand vorhanden und nur ergänzt), **nicht**
  übernommen: Schwiegereltern (stehen als Text beim Partner), Adressen,
  drei nicht angebundene Namensträger durch Adoption. Konventionen: Namen
  „v." → „von"; Ehefrauen/verheiratete Töchter vor 1980 tragen den Namen
  des (letzten) Mannes, eigener Name in `birth_name` (außer „führt den
  Geburtsnamen"); Jahr-nur-Daten als `YYYY-01-01`; `is_deceased` bei
  Sterbedatum oder Geburt vor 1925; Beruf aus dem Gotha-Text, Rest in
  `notes` (mit `Quelle: Gotha-Abschrift (Familientag 2026), Nr. N`);
  Geschlecht aus Eltern-/Partnerrolle, sonst Vornamen-Heuristik.
  **Lücken** (Stammvater 1464/1470 → erste Belegte 1746/1693, Kurt 1695 →
  1797, Johann Albrecht 1752 → 1863) überbrückt je ein Platzhalter
  „… unbekannte Generationen" (blaugrau, verstorben) — wer Zwischenglieder
  kennt, hängt sie dort ein und löscht den Platzhalter. Beim Import
  korrigiert (Notiz „Korrigiert beim Import" im Profil): Axel Paul Julius →
  Sohn von Bernd Julius Friedrich; Johann Albrecht → Bruder statt Sohn von
  Christian Friedrich; Renate Charlotte → Tochter von Joachim & Adele; Fritz
  Hugo Max * 1834 (Handeingabe hatte 1862). Nicht auflösbar, mit „⚠ Prüfen"
  in der Notiz und „(?)" im Vornamen: Adolf (1808–1840) als Vater eines 1862
  Geborenen; Jacob Ernst (* 1693) als Vater von 1771/1773 Geborenen. Drei
  Abschrift-interne Dubletten (Nachtrag wiederholt Hauptteil) wurden
  zusammengeführt. Tägliches Backup vor dem Import: `57236a4`. `centerOn`/`panTo`/`highlightConnection`
  wechseln bei Bedarf automatisch in die Familie der Person. Heiraten
  zwischen Zweigen erscheinen in beiden Fächern als „∞"-Partner.
  Waisen-Ablage = in keiner Familie erreichbar.
- **Layout:** Sunburst. Wurzel = Stammvater der aktiven Familie, jede
  Generation ein Ring (`RING`), Winkelbreite ∝ Zahl der
  Nachkommen-Blätter, Geschwister nach Geburtsjahr. Blutsverwandte
  bekommen Segmente; **Angeheiratete stehen als „∞ Name" im Segment des
  Partners** (`hostOf`-Map) und sind dort als blauer Link antippbar
  (Hover: rot) → eigenes Profil. **Treffer per Geometrie, nicht per
  DOM-Hit-Test** (`spouseLinkAt` → `linkInkBox`: Glyphenzellen des
  ersten/letzten Zeichens per `getExtentOfChar` — nicht `getBBox`, das
  liefert in WebKit für tspans die Box des ganzen `<text>` —, daraus die
  Grundlinie über die Plex-Mono-Metrik (Zelle 1,3 em = 1,025 Ober- +
  0,275 Unterlänge) und die Tinte von Versalhöhe (Grundlinie − 0,72 em)
  bis Grundlinie + 0,15 em; Maus 0 px Toleranz, Finger 6 px) — WebKit
  ignoriert `pointer-events` auf `<tspan>`, deshalb waren Links auf dem
  iPhone sonst gar nicht antippbar; `.fan-spouse-link` hat darum
  `pointer-events: none`. Der Maus-Hover (`updateLinkHover`, Klasse
  `is-hover`, Hand-Cursor) nutzt dieselbe Funktion, damit Hervorhebung und
  Klickziel exakt übereinstimmen. Der Rest des Feldes führt zur Person.
  Lücken: `SEG_GAP` (konstante Breite, je Radius in Winkel
  umgerechnet) und `RING_GAP`.
- **Farben:** Männer hellblau, Frauen rosa, unbekannt grau, Verstorbene
  entsättigt; registrierte Profile dunkler Rand, aktueller Nutzer rot.
- **Semantic Zoom** nach Pixel pro SVG-Einheit (`LOD_MID`/`LOD_FULL`):
  fern = Vorname groß, mittel = Vorname + Partner-Vornamen, nah = Name +
  Partner mit Geburtsname + Jahre. Auf der nahen Stufe sind Schriftgrößen
  in Einheiten, aber **mit Pixel-Deckel** (`cap(units, px)`, z.B. Name
  max. 15 px): beim Reinzoomen wächst das Segment weiter, der Text nicht →
  irgendwann passen alle Zeilen auch in schmale Außensegmente. Je Segment
  wird `kFit` (Zoom, ab dem alles ungekürzt passt, +8 % Reserve) berechnet;
  **darüber sind die Größen in Einheiten eingefroren** (`kEff = min(k,
  kFit)`), die Schrift wächst dann wieder mit dem Segment. Labels werden bei
  Stufenwechsel und auf der nahen Stufe bei >4 % Zoomänderung neu gebaut
  (nicht mehr, sobald alle Segmente über ihrem kFit sind). Maximal-Zoom
  `minW = min(RING*0.4, Breite / (max kFit · 1.15))` — jedes Segment ist
  erreichbar. Minimal-Zoom `maxW = fitRadius() · 6` mit demselben
  Mindestradius wie `fit()` (zwei Ringe) — bei einem Zweig aus nur dem
  Stammvater lag die Grenze sonst enger als die Einpassung und „rauszoomen"
  sprang hinein; so erreichen auch Ein-Personen-Zweige fern/mittel/nah
  (Desktop bis 0.59 px/Einheit = mittel, Handy bis 0.22 = fern).
  `Fan._spec(id)` liefert die Label-Geometrie zum Debuggen.
- **Verwandtschaftspfad:** `Fan.highlightConnection` (wird von
  `connection.js` parallel zu `Tree.highlightConnection` gerufen) umrandet
  Beteiligte rot und dimmt alle anderen (`.fan-dim`) — keine Linie, kein
  Umsortieren; Viewport lässt Platz fürs Panel (rechts Desktop / Bottom-
  Sheet Mobile). Schritt-Liste im Panel zeigt ↑/↓/↔ je Hop, gemeinsamer
  Vorfahre = Scheitel des Pfads, blau mit Stern.
- **Rotation:** Rändelrad (`.fan-wheel`, HTML-Overlay rechts im
  Container, bildschirmfix): vertikal ziehen oder Mausrad darüber dreht
  den Fächer (`phi`, 720 px = eine Umdrehung). Segmente/Highlight drehen
  per Gruppen-Transform, Labels werden über `labelTransform(spec)` aus
  ihrer Pose (`theta`, `rm`, `tangential`) neu ausgerichtet, damit die
  Lesbarkeitsregel für den absoluten Winkel gilt; Chips, `centerOn`/
  `panTo` und Highlight-Anker rechnen mit `rotPt()`. Rotation wird nicht
  gespeichert. Nur in den Fächer-Ansichten sichtbar. `.fan-wheel` selbst
  ist nur der unsichtbare Griffbereich (34 px, Touch 42 px — bewusst
  knapp, alles darunter ist sonst unerreichbar), die sichtbare Leiste
  (20 px, Touch 28 px) zeichnet `::before` — die Ausblend-Maske muss auf
  `::before` liegen, weil Chrome maskierte Bereiche beim Hit-Test
  ignoriert. Ein **Tipp ohne Ziehen** auf das Rad wird an das Element
  darunter weitergereicht (`tapThrough`: Segment, Partner-Link, Chip),
  damit das Rad nichts verdeckt. Unter 768 px Breite sitzt das Rad im
  oberen Drittel (`top: 15%`), damit es nicht mit dem FAB-Stapel
  kollidiert.
- **Zeitstrahl (nur Geburtsjahr-Ansicht):** horizontales Rändelrad unten
  mittig (`.fan-timeline`, `attachTimeline`): Streifen mit einem Strich je
  Jahr (Dekaden höher + beschriftet) läuft unter einer festen roten Marke
  mit Jahreszahl durch; ziehen (6 px/Jahr), Mausrad (3 Jahre/Raste) oder
  Antippen (springt zum angetippten Jahr). Personen mit Geburtsjahr nach
  dem Stichjahr bekommen `.fan-future` (Segment + Label: `opacity: 0`,
  Partner-Zeile: `visibility: hidden`) — die Geometrie bleibt, der Fächer
  „wächst" beim Vorwärtsscrollen (`applyTimeline`, auch nach jedem
  Label-Neubau). Fehlende Geburtsjahre werden geschätzt (`computeYearOf`:
  Partner, sonst ältestes Kind − 28, sonst jüngster Elternteil + 30,
  iterativ), damit niemand grundlos ewig sichtbar/unsichtbar ist. Bereich
  je Familienzweig: ältestes Geburtsjahr bis heute (`computeTimelineRange`);
  Start = heute (alles sichtbar), Stichjahr bleibt beim Wechsel der
  Ansicht/Familie erhalten (geklemmt). Unter 600 px sitzt der Streifen
  höher (über Waisen-Ablage/Gast-Hinweis, neben dem FAB-Stapel).
  Bereich beginnt ein Jahr **vor** der ältesten Geburt.
- **Abspielen (Spaßfunktion):** Play/Pause-Taste links am Streifen
  (`startPlayback`/`stopPlayback`, rAF-Schleife, `TL_YEARS_PER_SEC` = 4;
  Play läuft ab der aktuellen Stelle weiter (am Ende von vorn), Pause
  hält an; Ziehen, Mausrad,
  Ansichts-/Familienwechsel und `Fan.hide()` stoppen). Jede echte Geburt
  (`tlBirths`: nur Blutsverwandte mit Datum, keine Angeheirateten) in
  (vorheriges, neues Stichjahr] löst `BabyCry.play(id, n·0.12 s)` aus.
  `js/babycry.js` (Web Audio, Kontext erst bei der Nutzergeste): jede
  Geburt ist eine eigene Stimme, Überlagerungen werden nie abgebrochen —
  es wird lauter und wilder (nur ein milder Kompressor gegen Clipping).
  Standard ist die Aufnahme `assets/sounds/baby-cry.mp3` (Kais WAV
  „baby cries at birth #4", auf 1 s mono 96 kbit/s ≈ 13 KB gewandelt;
  **genau einmal je Geburt** (~1 s), Tonhöhe je Person deterministisch
  leicht anders, im SW-Precache). Die MP3 wird beim Seitenstart
  vorgeholt (`prefetch`, ohne AudioContext) und beim ersten Ruf
  dekodiert; Rufe warten auf das Dekodieren, statt anders zu klingen —
  es gibt keinen synthetischen Ersatz mehr (der hatte auf der Live-Seite
  die ersten Geburten vor dem Laden der Datei anders klingen lassen).
  **iOS-Stummschalter:** Web Audio läuft in WebKits „Ambient"-Kategorie
  und ist bei gesetztem Stummschalter lautlos. Deshalb startet die
  Play-Taste zusätzlich ein stilles, loopendes HTML-`<audio>` (Data-URI,
  `BabyCry.unlock()`, muss in der Nutzergeste passieren) — das schaltet
  die Session auf „Playback", und Web Audio ist trotz Stummschalter
  hörbar; `stopPlayback` → `release()` pausiert es wieder. Kontext wird
  bei Zustand ≠ `running` (auch `interrupted`) erneut geweckt.
- **Hover:** Kopie des Segments zuoberst mit 12-px-Rand in Segmentfarbe
  plus 1,5-px weißem Saum außen (`showHoverHalo`, `vector-effect:
  non-scaling-stroke`) — wirkt größer, verschiebt nichts; gedimmte
  Segmente bleiben ruhig. Hover-Zustand (Halo + Chips) gilt für Segment,
  Label inkl. Partner-Links und Chips derselben Person (`hoverIdOf`);
  verlässt die Maus die Person in Leerraum, verschwinden Halo + Chips
  nach 220 ms (Gnadenfrist zum Erreichen der Chips). Touch: Chips bleiben
  an der zuletzt angetippten Person, Tipp auf Leerraum löscht sie.
- **Interaktion:** Tippen zentriert die Person (Zoom bleibt) und öffnet das
  Profil; Rad/Pinch zoomt, Ziehen verschiebt; „Auf mich zentrieren" und
  „Im Stammbaum zeigen" respektieren die aktive Ansicht. Container
  bekommt erst Größe, wenn `view-main` sichtbar ist — der ResizeObserver
  passt beim Sichtbarwerden ein.
- **Hover-Chips:** bei Maus-Hover bzw. an der zuletzt angetippten Person
  erscheint „?" (Anfangskante; „Wie sind wir verwandt?" →
  `Connection.showConnectionTo`, auch im Gastmodus mit Identität, nie am
  eigenen Segment) und — nur mit Schreibrecht (`Fan.setCanEdit`) — „+ Kind"
  (außen), „+ Geschwister" (Endkante) und „∞ Partner" (innen; nur ohne
  eingetragenen Partner). Klick → `App.addRelative(relType, id)` öffnet
  „Neue Person anlegen" als Seitenpanel mit vorbelegter Beziehung
  (`Relations.presetRelation`) und Nachname; die Regel-Engine ergänzt
  beim Speichern zweites Elternteil/Geschwister.
- **Waisen-Ablage** (`#orphan-tray`, `App.updateOrphanTray`): Pill unten
  links mit allen Profilen, die im Fächer nicht über die Wurzel erreichbar
  sind (im Baum: ohne jede Verbindung); Klick öffnet das Profil.
- Desktop: Profil UND Bearbeiten-Formular öffnen als Seitenpanel
  (`SIDE_PANEL_VIEWS` in app.js), mit ×-Schließen rechts.
- Nicht über die Wurzel erreichbare Personen fehlen im Fächer und werden
  in der Konsole gelistet (`[Fan] … nicht erreichbar`).
- **Zwei Fallen, die schon einmal zugeschlagen haben:** (1) `#fan-container`
  muss ein *Geschwister* von `#tree-container` sein (Wrapper `#tree-area`),
  nie ein Kind — der Baum darunter bindet seine Pointer-Listener an sein
  eigenes SVG; als Kind würde jeder Fächer-Klick zusätzlich gegen die
  Baum-Karten ausgewertet (falsches Profil / Profil schließt sofort).
  (2) Nach `setPointerCapture` ist `e.target` beim `pointerup` das `<svg>`;
  das getroffene Segment wird deshalb beim `pointerdown` gemerkt. Tests
  dafür immer mit **echten** Klicks (Computer-Tool) machen — synthetische
  Events bubbeln nicht durch die Capture und verdecken beide Fehler.

## Gotha-Verzeichnis (`gotha.js`)

Textansicht im Stil des Gothaischen Taschenbuchs: je Familie (alle
untereinander, kein Umschalter) ein verschachteltes `<ul>` mit einer
Zeile pro Person — römische Generationsziffer (I = Stammvater), Name,
Lebensdaten, Partner als `; ∞ Name (* Jahr)` bzw. `⚮` für ehemalige;
Geschwister nach Geburtsjahr. Zeilen mit Kindern sind klappbar (▾/▸,
Zustand pro Sitzung in `collapsed`), Werkzeuge „Alle ausklappen" / „Bis
Gen. III einklappen". Namen öffnen das Profil; Du = roter Balken,
registriert = fett. `scrollTo(id)` klappt Vorfahren auf und blinkt die
Zeile (genutzt von „Auf mich zentrieren" und „Im Stammbaum zeigen");
`highlightConnection` markiert Pfad-Zeilen und dämpft den Rest. Nicht
zugeordnete Personen zeigt die Waisen-Ablage (wie in allen Ansichten);
der Familien-Umschalter oben wählt den gezeigten Zweig.

## Artikelseite & Vita (`article.js`, `markdown.js`)

`members.notes` ist die Markdown-Quelle der ausführlichen Vita (TEXT-
Spalte, keine Migration). Profil-Seitenpanel zeigt nur den Auszug
(`Markdown.excerpt`, erste Sätze ohne Überschriften); darunter im
Vita-Abschnitt der Button `#btn-profile-article` (⤢ „Weiterlesen", wenn
mehr Text existiert, sonst „Ganze Seite öffnen") — kein Icon mehr im
Profil-Header. Er öffnet `Article.show(id)`: Kopf mit
Foto/Name, Property-Zeilen (Daten, Beruf, Wohnort, Kontakt, Status-Badges
und Beziehungen mit **denselben `.rel-item`/`.rel-type-badge`-Styles wie im
Profil**), darunter der gerenderte Artikel. „Vita bearbeiten" (gleiche
Rechte wie Kernfelder) öffnet Textarea + Toolbar (H1/H2/B/I/Listen/Zitat/
Link/Trennlinie fügen Markdown am Cursor ein), „Vorschau", Speichern via
`DB.updateMember`. Renderer unterstützt `#`–`###`, Absätze, `-`/`1.`-Listen,
`>`, `---`, `**`, `*`, `[Text](https://…)`; alles andere wird escaped.

## Verbindungsliste (`relations.js → sortedDisplayRelations`)

Profil-Seitenpanel und Bearbeiten-Formular zeigen Verbindungen immer in
fester Kategorie-Reihenfolge **Eltern → Partner → ehem. Partner → Kinder →
Geschwister**, innerhalb der Kategorie nach Geburtsdatum (unbekannt
zuletzt), dann Vorname — nie Geschwister und Eltern im Wechsel. Die
Artikelseite (`article.js → renderRelations`) gruppiert nach denselben
Kategorien in derselben Reihenfolge.

## Verwandtschafts-Overlay über Zweiggrenzen (`connection.js`)

Stammen Start und Ziel aus verschiedenen Familienzweigen (`App.familyInfo`
liefert unterschiedliche `rootId`s — z.B. Märkischer scannt pommerschen
QR-Code), zeigt `showOverlay` „Verschiedene Zweige" mit Hinweistext und
einem Button „Zweig … ansehen" statt der Schrittliste; DNA/Vorfahre „—",
kein Pfad-Highlight, und **der aktive Zweig wird nicht umgeschaltet**
(sonst würde `ensureFamilyFor(toId)` den fremden Zweig öffnen). Gleicher
Zweig ohne Pfad (Waise): weiterhin „Keine Verbindung gefunden".

## Sicherheit & Datenschutz — Stand nach Review 15.09.2026

- **Wer sieht was:** Anonym: nichts (alle Tabellen RLS, anon-Probe liefert
  `[]`/401). Gast mit Code: Baum ohne Kontakt/Telefon/E-Mail (`guest_graph`).
  Mitglied `approved`: alles inkl. Kontaktfelder; ändern darf es Platzhalter
  und unbeanspruchte Profile, eigene nur der Inhaber/Admin; **löschen**
  darf jedes freigegebene Mitglied jedes unbeanspruchte Profil (Kaskade auf
  Beziehungen) — bewusst kollaborativ, aber ohne Undo. Admin: alles.
- **Fotos** (Bucket `photos`, öffentlich): Dateien sind per URL abrufbar
  (`<member-id>.<ext>`, UUID nicht erratbar), seit Migration 010 aber nicht
  mehr anonym **listbar**; hochladen/ändern/löschen nur freigegebene
  Mitglieder (vorher jeder Eingeloggte, auch Wartende).
- **Client-Härtung:** supabase-js von jsdelivr **exakt gepinnt + SRI**
  (`integrity`), keine weiteren Fremdskripte; `<meta name="robots"
  content="noindex, nofollow">` (Login-Seite soll nicht in Suchmaschinen);
  Markdown-Renderer erlaubt nur `http(s)`-Links, Nutzertexte gehen über
  `textContent`/`escapeHtml`; HTTPS erzwungen.
- **Backup:** Supabase Free hat keine automatischen Backups. Deshalb
  privates Repo **`petersdorff/stammbaum-backup`** mit GitHub Action
  (täglich 06:41 Berlin + manuell): `export.sh` zieht alle Tabellen als
  JSON und die Fotos, committet nur bei Änderung — jede Version bleibt in
  der History. Secret `SUPABASE_SERVICE_KEY` liegt nur dort. Lokaler Klon
  in `~/Documents/ClaudeCode/stammbaum-private/stammbaum-backup`.
- **Datenschutz-Seite** (`#view-privacy`, Link in Login-Fußzeile und Menü):
  Zweck, Wer-sieht-was, Datenarten, Speicherort (Supabase Frankfurt),
  Rechte, Ansprechpartner.
- **Offene Entscheidungen** (siehe Review-Notiz an Kai): Geburtsdaten
  Lebender für Gäste nur als Jahr; Kontaktfelder nur vom Profil-Inhaber
  editierbar; Löschrecht auf Ersteller/Admin beschränken; längerer
  Familientag-Code gegen Durchprobieren (`invite_code_valid` ist anonym
  aufrufbar, ohne Rate-Limit); Vita (`notes`) im Gastmodus.

## Nutzungsstatistik (Migration 009)

Tabelle `usage_events` (`created_at`, `user_uid` NULL = Gast, `kind`,
`meta`), Schreiben nur über `log_event(kind, meta)` (SECURITY DEFINER,
anon+authenticated), Lesen nur Admins. Ereignisse: `app_open` (einmal je
Seitenaufruf mit Konto, Auth-Listener), `guest_open` (`Guest.enter`),
`connection` (`Connection.showOverlay`), `member_create`/`member_update`
(`DB.createMember`/`updateMember`), `relationship_add` (nur neue Kante).
Keine Personen-IDs, keine Inhalte. `usage_stats(p_days)` (nur Admins)
liefert Gesamtzahlen (Konten, freigegeben/offen, verknüpfte Profile,
Personen, Beziehungen, aktive Konten im Zeitraum) und Tageszeilen (Berlin)
— Nutzerverwaltung → Block „Nutzung" (`Admin.loadUsage`): Kacheln +
Tabelle 14 Tage mit Summenzeile.

## Beziehungs-Automatik (`relations.js → propagateLogicalRelations`)

Kaskadierende Regel-Engine: Graph wird EINMAL geladen, in-memory
fortgeschrieben; jede automatisch ergänzte Kante wird selbst wieder
geprüft, bis nichts sicher Ableitbares mehr übrig ist. Wird bei jedem
manuellen Hinzufügen aufgerufen (drei Pfade: Beziehung zwischen
Bestehenden, neue Person im Bearbeiten-Dialog, neue Person mit
Pflicht-Erstverbindung). Ergebnis-Toast: „n Verbindungen automatisch ergänzt".

Seit Sept. 2026 läuft jeder Lauf über den **gesamten** Graphen (Seed =
neue Kante + alle bestehenden), damit auch rückwirkend alles Ableitbare
entsteht (Kind zuerst erfasst, Ehefrau später → Mutter-Kind-Kante).
Einmaliger Volllauf gegen die Live-DB am 13.09.2026: 79 Geschwister-Kanten.

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

## Familientag-Code, Gastzugang & Konto↔Profil (Migration 007)

- **Tabelle `app_settings`** (`key`, `value`, `valid_until`; RLS nur
  Admins): Zeile `invite_code`. Aktueller Code seit 15.09.2026:
  `Familientag-2026-EGX9`, gültig **bis einschließlich So 20.09.2026**
  (Berlin). Ändern/verlängern in der Nutzerverwaltung (Block ganz oben;
  Datum = „gültig bis einschließlich", wird als 23:59:59+02 gespeichert).
  Leerer Code = kein Gast- und kein Sofort-Zugang.
- **`invite_code_valid(code)`** (SECURITY DEFINER, anon+authenticated):
  Vergleich ohne Groß/Klein, prüft Ablauf.
- **`redeem_invite_code(code, display_name)`** (authenticated): legt die
  eigene `user_approvals`-Zeile als `approved` an bzw. hebt `pending` auf
  `approved`; `rejected`/`revoked` bleiben gesperrt. Client: Code aus dem
  Registrierungsformular wandert nach `sessionStorage.reg_inviteCode` und
  wird im Auth-Listener **vor** der Freigabeprüfung eingelöst; auf der
  Warteseite gibt es ein Code-Feld für Nachzügler.
- **`guest_graph(code)`** (anon+authenticated): kompletter Baum als JSON
  **ohne `contact`/`phone`/`email`**; wirft `invalid_code`. `Guest.enter(code)`
  lädt ihn (`DB.loadGuestGraph`), merkt den Code in
  `localStorage.stammbaum_guestCode` (Auto-Wiedereinstieg beim nächsten
  Öffnen, bis der Code abläuft), `DB.isOffline()` = „nur lesen aus
  guestRows". Login-Seite: Familientag-Knopf blendet das Code-Feld ein.
- **QR-Link mit Code:** `https://petersdorff.github.io/?zugang=<Code>`
  (Aushang, Namensschilder). `App.init` liest `zugang` einmal aus der URL,
  entfernt ihn per `replaceState`, füllt `#guest-code`/`#reg-code`/
  `#pending-code` vor und geht ohne Session direkt per `Guest.enter(code)`
  in den Gastmodus (ungültig → Login mit vorausgefülltem Code-Feld).
  Bewusst nicht `?code=` — das nutzt Supabase für den PKCE-Login. Der
  DIN-A4-Aushang liegt privat unter `stammbaum-private/aushang/`
  (`aushang.html` + `render.js` → `Aushang-Familientag-2026.pdf`; enthält
  Code und Screenshots mit Namen, darum nicht im Repo).
- **Jedes Konto hängt an genau einem Profil:** nach der Freigabe zeigt der
  Login ohne verknüpftes Profil zwingend die Willkommen-Seite (kein
  Überspringen) mit zwei Wegen — bestehendes Profil verknüpfen oder
  **„Neues Profil erstellen"** (`Claim.handleClaimNew`): Pflicht-Auswahl
  des Familienzweigs (`members.family_hint` = Wurzel-ID, Migration 008),
  Profil wird sofort angelegt und geclaimt, Zweig aktiviert, eigener Editor
  öffnet sich — erste Verbindung jetzt eintragen oder abbrechen und später.
  Bis dahin steht das Profil in der Waisen-Ablage des gewählten Zweigs (die
  Ablage zeigt nur Waisen mit passendem bzw. ohne `family_hint`) und der
  Inhaber sieht oben die rote Leiste `#connect-hint` „Verbindung
  hinzufügen", bis er die Lücke beim letzten bekannten Vorfahren per + Kind
  zugebaut und sich eingehängt hat. Löst ein Admin die Verknüpfung, kommt beim nächsten
  Login wieder die Willkommen-Seite. Rote Umrandung/„?"-Chip brauchen
  dieses eigene Profil. Nach jedem Verknüpfen ruft `claim.js`
  `App.applyReadOnlyUI()` + `Admin.updateAdminMenu()` — sonst bleiben
  +-Chips/FAB im Anfangszustand (nur „?"), wie beim ersten Test gesehen.
- Familientag-Checkliste und QR-Namensschilder: siehe `RESTORE.md` §6.

## Entwicklung & Betrieb

- Lokal: statischer Server reicht (`python3 -m http.server -d .`);
  in Claude Code über `.claude/launch.json`-Eintrag `stammbaum`.
- Kein Framework, kein Bundler, keine npm-Abhängigkeiten, keine
  Visualisierungs-Bibliothek mehr (Fächer, Stammtafel, Gotha sind reines
  SVG/DOM). UI-Sprache: Deutsch.
- Branches: `main` = live; `feature/multi-spouse` (gemerged-Stand prüfen),
  `feature/temporal-view` (nur lokal) sind historische Feature-Branches.
- **Persönliche Daten liegen nicht im Repo.** Gotha-Transkription,
  Importer, Konsolen-Skripte und der frühere Snapshot wurden am 15.09.2026
  aus Repo und Git-History entfernt (`git filter-repo`) und liegen lokal in
  `~/Documents/ClaudeCode/stammbaum-private/` (samt History-Bundle von
  vor der Bereinigung). Namen gehören auch nicht in Commit-Messages.
