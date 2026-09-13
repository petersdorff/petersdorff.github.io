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
  `js/app.js`. Supabase pausiert Free-Tier-Projekte nach 7 Tagen ohne
  API-Aufruf (Juli und September 2026 passiert). Dagegen läuft
  **`.github/workflows/supabase-keepalive.yml`**: täglicher REST-Ping, der
  bei Fehler den Lauf rot macht → GitHub mailt den Owner (= Health-Monitor).
  Caveat: GitHub schaltet Cron-Workflows nach 60 Tagen ohne Commit ab —
  dann manuell auslösen oder pushen. Falls das Projekt doch pausiert:
  Dashboard → Restore, dauert ~5 Min (DNS kommt vor der REST-API, die
  antwortet zwischenzeitlich 502/404). Neuaufbau nach Löschung: `RESTORE.md`.
- **Nach jedem Restore** prüfen: offene Freigaben im Admin-Panel (Mails
  gingen während der Pause ggf. unter) und ob die DB neuer ist als der
  Snapshot (`updated_at` vs. `snapshot_date`) → ggf. Snapshot neu erzeugen.
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
  in Reihenfolge 002 → 003 → 004 → 005 → 006 erneut ausführen.
- **Zugriffsmodell (4 Stufen):** Gast/Familientag (Snapshot, nur lesen) ·
  registriert-wartend (nichts, Warteseite) · Mitglied `approved` (alles
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
  5 Konten (Kai, Tabea, Stephan, Lea Sophia, Anne), 3 Profile verknüpft.
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
`claimedByUid`, denn der ist im öffentlichen Snapshot immer `null`.

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
| `db.js` | Alle Supabase-Zugriffe + Offline-Fallback auf `LocalSnapshot` |
| `tree.js` | **Stammtafel** (Ansicht `tree`): verdichtete Nachfahrentafel in reinem SVG — Kontur-Layout, gestapelte Geschwister, Partner unter der Person, Generationsbänder, Minimap, Ein-/Ausklappen. Seit Sept. 2026 ohne Cytoscape; `temporal` ist entfallen |
| `fan.js` | **Fächer-Ansicht (Standard)**: radialer Nachkommen-Sunburst in reinem SVG, s.u. |
| `gotha.js` | **Gotha-Verzeichnis**: eingerücktes, klappbares Textverzeichnis je Generation (`#gotha-container`), nutzt `Fan.buildFamiliesFrom` |
| `article.js` | **Artikelseite** (`view-article`): Properties wie Notion + ausführliche Vita als Markdown; Editiermodus mit Toolbar. Quelle: `members.notes` |
| `markdown.js` | Minimaler, XSS-sicherer Markdown-Renderer (`render`, `toPlain`, `excerpt`) — keine Bibliothek, offline |
| `relations.js` | Beziehungs-UI **und Auto-Vervollständigungs-Engine** (s.u.) |
| `relationship.js` | Verwandtschaftsgrad-Berechnung (Pfadsuche, Begriffe) |
| `profile.js` | Profile anzeigen/bearbeiten, Badges, Pflicht-Erstverbindung |
| `guest.js` | Familientag-Modus (Identität wählen, offline) |
| `connection.js` | „Wie sind wir verwandt?"-Panel, QR-Deep-Links `#connect/<id>` |
| `claim.js` | Profil beanspruchen nach Registrierung |
| `admin.js` | Freigabe-Panel, EmailJS-Benachrichtigung |
| `search.js`, `qr.js`, `utils.js` | Suche, QR-Codes, Helfer |
| `data-snapshot.js` | GENERIERT — nicht von Hand bearbeiten |

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
  heller), Rahmen: registriert dunkel, Platzhalter ohne, Du rot.
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

- **Vier Ansichten** über den Umschalter oben rechts (`btn-view-toggle`,
  Zyklus Fächer (Geschlecht) → Fächer nach Geburtsjahr → **Gotha-
  Verzeichnis** → **Stammtafel**), gemerkt in
  `localStorage.stammbaum_view` (`fan`, `fan-years`, `gotha`, `tree`;
  alte Werte `generational`/`temporal` werden auf `tree` gemappt);
  `Fan.setColorMode('gender'|'year')` tauscht nur Füllfarben (Skala je
  Familienzweig vom ältesten bis jüngsten Geburtsjahr, Blau → Orange;
  Legende mit Farbbalken, wird beim Zweigwechsel nachgezogen);
  ohne Eintrag ist der Fächer Standard. `App.applyView(name)` ist die
  zentrale Stelle (Fan-Overlay ein/aus, Tree-Modus, Legende, Button-Icon).
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
  Person. Waisen-Ablage = in keiner Familie erreichbar (einheitlich). Namen per `FAMILY_NAMES` nach
  Nachname der Wurzel („…-Campen" → Märkische, „Petersdorff" → Pommersche,
  sonst „Familie <Nachname>"). Eine bekannte Familie ohne Wurzel bekommt
  als Wurzel den ältesten elternlosen, nicht eingeheirateten Namensträger —
  so reicht ein Platzhalter-Stammvater ohne Kinder, um den Zweig zu
  starten (Pommersche Linie: Platzhalter „Stammvater von Petersdorff",
  angelegt 13.09.2026). Kein Zweig-Feld in der DB — Zweige sind aus den
  Beziehungen abgeleitet. `centerOn`/`panTo`/`highlightConnection`
  wechseln bei Bedarf automatisch in die Familie der Person. Heiraten
  zwischen Zweigen erscheinen in beiden Fächern als „∞"-Partner.
  Waisen-Ablage = in keiner Familie erreichbar.
- **Layout:** Sunburst. Wurzel = Stammvater der aktiven Familie, jede
  Generation ein Ring (`RING`), Winkelbreite ∝ Zahl der
  Nachkommen-Blätter, Geschwister nach Geburtsjahr. Blutsverwandte
  bekommen Segmente; **Angeheiratete stehen als „∞ Name" im Segment des
  Partners** (`hostOf`-Map) und sind dort als blauer Link antippbar
  (Hover: rot) → eigenes Profil. Lücken: `SEG_GAP` (konstante Breite, je Radius in Winkel
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
  erreichbar. `Fan._spec(id)` liefert die Label-Geometrie zum Debuggen.
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
  Play startet **immer von vorn**, Pause hält an; Ziehen, Mausrad,
  Ansichts-/Familienwechsel und `Fan.hide()` stoppen). Jede echte Geburt (`tlBirths`, nur mit Datum) in
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
  iOS: Stummschalter dämpft Web Audio.
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
- Kein Framework, kein Bundler, keine npm-Abhängigkeiten, keine
  Visualisierungs-Bibliothek mehr (Fächer, Stammtafel, Gotha sind reines
  SVG/DOM). UI-Sprache: Deutsch.
- Branches: `main` = live; `feature/multi-spouse` (gemerged-Stand prüfen),
  `feature/temporal-view` (nur lokal) sind historische Feature-Branches.
- `gotha-data-extract.md` ist die Quell-Transkription (Gotha S. 293–306),
  `import_data.py` der zugehörige Importer (IDs deterministisch aus
  `gotha_code` → `make_id`).
