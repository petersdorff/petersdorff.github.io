# RESTORE.md — Backend wiederherstellen & Betrieb

**Stand Juli 2026: Das Supabase-Projekt `ixdcyoivtapglllmwvut` ist nicht mehr
erreichbar (DNS existiert nicht mehr).** Supabase pausiert Free-Tier-Projekte
nach ~1 Woche Inaktivität und löscht sie nach längerer Pause.

Die App funktioniert trotzdem: Ohne erreichbares Backend läuft sie automatisch
im **Offline-Modus** über den gebündelten Snapshot (`js/data-snapshot.js`) —
lesend, inkl. Familientag-Modus, QR-Codes und Verwandtschafts-Anzeige.
Nur Bearbeiten/Registrieren braucht das Backend.

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

## 4. Snapshot aktualisieren

Der gebündelte Offline-Datenbestand sollte nach Datenänderungen regelmäßig
neu erzeugt werden:

```bash
# aus der Live-DB (bevorzugt):
export SUPABASE_URL=... SUPABASE_SERVICE_KEY=...
python3 tools/generate-snapshot.py --from-db

# oder ohne Backend aus import_data.py:
python3 tools/generate-snapshot.py
```

Danach in `index.html` die Version von `js/data-snapshot.js` **und** in
`sw.js` den `CACHE_NAME` erhöhen, committen, pushen.

## 5. Sicherheit — unbedingt beachten

- **Der service_role-Key stand bis Juli 2026 im öffentlichen Repo**
  (`import_data.py`, Git-Historie). Für das alte, gelöschte Projekt ist das
  folgenlos. Für ein NEUES Projekt gilt: Keys nur als Umgebungsvariable,
  niemals committen. `fetch-db.sh`/`update-db.sh` stehen in `.gitignore`.
- **Das Repo ist öffentlich** und enthält die Familiendaten (Gotha-Auszug,
  Snapshot). Empfehlung: Repo auf **privat** stellen und für GitHub Pages
  entweder GitHub Pro nutzen oder auf einen Dienst mit Zugriffsschutz
  (z. B. Cloudflare Pages + Access) umziehen. Ein Passwort-Gate in der App
  wäre nur Show — die Daten lägen weiter offen im Repo.
- Nach Wiederherstellung des Backends: Migration 003 einspielen, sonst können
  nicht freigegebene Konten per REST-API alles lesen (die Freigabe war bisher
  nur ein Client-Check).

## 6. Familientag-Checkliste

1. `python3 tools/generate-snapshot.py --from-db` (aktueller Datenstand)
   → committen & deployen. Die App funktioniert dann auch bei schlechtem
   Empfang vollständig (Service Worker cached alles).
2. Namensschilder mit QR-Codes drucken: Jeder QR enthält
   `https://<pages-url>/#connect/<member-id>`. Die IDs stehen in
   `js/data-snapshot.js`; `gotha_code` hilft beim Zuordnen.
3. Ablauf für Gäste: QR scannen (native Kamera) → „Familientag: Ohne Konto
   ansehen" → eigenen Namen wählen → Verwandtschaft wird angezeigt.
   Kein Konto, keine Freigabe, kein Backend nötig.
