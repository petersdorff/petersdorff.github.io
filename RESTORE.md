# RESTORE.md — Backend wiederherstellen & Betrieb

**Stand Juli 2026: Das Supabase-Projekt `ixdcyoivtapglllmwvut` ist nicht mehr
erreichbar (DNS existiert nicht mehr).** Supabase pausiert Free-Tier-Projekte
nach ~1 Woche Inaktivität und löscht sie nach längerer Pause.

**Seit 15.09.2026 gibt es keinen gebündelten Offline-Snapshot mehr** (nichts
Persönliches liegt im öffentlichen Repo). Ohne erreichbares Backend zeigt die
App nur noch eine Fehlermeldung — der Familientag-Modus liest über die
DB-Funktion `guest_graph(code)`. Vor jedem Familientag also sicherstellen, dass
das Projekt aktiv ist (Keep-alive-Workflow läuft, `RESTORE.md` §1).

---

## 1. Prüfen, ob das alte Projekt noch existiert

1. Auf https://supabase.com/dashboard einloggen.
2. Ist das Projekt nur **pausiert** → „Restore project" klicken. Nach ein paar
   Minuten ist die alte Datenbank (inkl. aller App-Bearbeitungen, Fotos,
   Konten) wieder da. Weiter mit Schritt 3.
3. Ist das Projekt **gelöscht** → neues Projekt anlegen (Schritt 2).

## 2. Neues Projekt aufsetzen (nur falls gelöscht)

1. Neues Projekt erstellen (Region `eu-central-1`/Frankfurt), Name egal.
2. SQL Editor: `supabase-schema.sql` ausführen,
   dann `supabase-migration-approvals.sql`,
   dann `migrations/002_add_occupation_and_storage.sql`,
   dann `migrations/003_enforce_approvals_rls.sql`.
3. Storage: Bucket `photos` anlegen (public).
4. Authentication → Provider → E-Mail aktivieren.
5. Daten importieren:
   ```bash
   export SUPABASE_URL="https://<neue-projekt-ref>.supabase.co"
   export SUPABASE_SERVICE_KEY="<service-role-key aus den API-Settings>"
   pip3 install requests
   python3 import_data.py
   ```
   ⚠️ Der Import enthält den Stand des Gotha-Imports (Feb 2026). Änderungen,
   die danach nur in der alten DB gemacht wurden, sind verloren, falls das
   Projekt gelöscht wurde.

## 3. App auf das Projekt zeigen lassen

In `js/app.js` oben `SUPABASE_URL` und `SUPABASE_ANON_KEY` durch die Werte des
Projekts ersetzen (Dashboard → Settings → API → **anon public** Key — niemals
den service_role Key!). Danach Versionsnummer von `js/app.js` in `index.html`
erhöhen und pushen.

## 4. Familientag-Code

Code und Ablaufdatum stehen in `app_settings` (Migration 007) und werden in
der Nutzerverwaltung (Block „Familientag-Code") gepflegt. Aktuell:
`Familientag-2026-EGX9`, gültig bis einschließlich 20.09.2026. Nach dem Fest
Code leeren oder Datum auslaufen lassen — dann gibt es weder Gast- noch
Sofort-Zugang.

## 4b. Backup zurückspielen

Das private Repo `petersdorff/stammbaum-backup` enthält täglich `data/*.json`
(Tabellenzeilen im PostgREST-Format) und `photos/`. Wiederherstellen in ein
leeres Schema: Reihenfolge members → relationships → user_approvals →
app_settings; je Datei `curl -X POST "$URL/rest/v1/<tabelle>" -H "apikey: $KEY"
-H "Authorization: Bearer $KEY" -H "Content-Type: application/json"
--data-binary @data/<tabelle>.json`; Fotos per Storage-Upload
(`/storage/v1/object/photos/<name>`).

## 5. Sicherheit — unbedingt beachten

- **Der service_role-Key stand bis Juli 2026 im öffentlichen Repo**
  (`import_data.py`, Git-Historie). Für das alte, gelöschte Projekt ist das
  folgenlos. Für ein NEUES Projekt gilt: Keys nur als Umgebungsvariable,
  niemals committen. `fetch-db.sh`/`update-db.sh` stehen in `.gitignore`.
- **Das Repo ist öffentlich — deshalb liegen keine Familiendaten mehr darin**
  (Gotha-Auszug, Importer, Skripte und Snapshot am 15.09.2026 aus Repo und
  History entfernt; privat unter `~/Documents/ClaudeCode/stammbaum-private/`).
  Ein privates Repo hätte nichts gebracht: GitHub Pages ist immer öffentlich,
  und für Pages aus einem privaten Org-Repo wäre GitHub Team fällig.
  Daten kommen nur noch aus der DB: Mitglieder per Login, Gäste per Code.
- Nach Wiederherstellung des Backends: Migration 003 einspielen, sonst können
  nicht freigegebene Konten per REST-API alles lesen (die Freigabe war bisher
  nur ein Client-Check).

## 6. Familientag-Checkliste

1. Backend aktiv? (Dashboard; Keep-alive-Workflow läuft wöchentlich.) Code
   und Ablaufdatum in der Nutzerverwaltung prüfen; Code auf den Aushang.
2. Namensschilder mit QR-Codes drucken: Jeder QR enthält
   `https://petersdorff.github.io/#connect/<member-id>` (im Profil unter
   „Mein QR-Code" bzw. per `fetch-db.sh` exportierbar).
3. Ablauf für Gäste: QR scannen (native Kamera) → „Familientag: Ohne Konto
   ansehen" → Code eingeben → eigenen Namen wählen → Verwandtschaft wird
   angezeigt. Kein Konto, keine Freigabe — aber Netz und Code nötig.
4. Wer mitarbeiten will: Registrieren mit Code → sofort freigeschaltet →
   eigenes Profil verknüpfen oder anlegen.
