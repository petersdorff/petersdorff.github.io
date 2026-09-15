-- ═══════════════════════════════════════════════════════════
-- 010 – Foto-Speicher absichern
-- Im Supabase SQL-Editor ausführen.
--
-- Befund (Sicherheits-Review 15.09.2026):
--  1. Der Bucket `photos` ist öffentlich UND hatte eine SELECT-Policy für
--     jedermann → Anonyme konnten die komplette Fotoliste abrufen
--     (storage/v1/object/list). Öffentliche Buckets liefern Dateien per
--     URL ohne RLS; die SELECT-Policy braucht nur, wer listen will.
--     → Policy entfernen: Listing weg, bekannte URLs funktionieren weiter.
--  2. Hochladen/Ändern/Löschen war für JEDEN eingeloggten Nutzer erlaubt,
--     auch noch nicht freigegebene → nur freigegebene Mitglieder.
-- ═══════════════════════════════════════════════════════════

DROP POLICY IF EXISTS "Public read access for photos" ON storage.objects;

DROP POLICY IF EXISTS "Authenticated users can upload photos" ON storage.objects;
CREATE POLICY "Approved users can upload photos"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'photos' AND public.is_approved());

DROP POLICY IF EXISTS "Authenticated users can update photos" ON storage.objects;
CREATE POLICY "Approved users can update photos"
ON storage.objects FOR UPDATE TO authenticated
USING (bucket_id = 'photos' AND public.is_approved());

DROP POLICY IF EXISTS "Authenticated users can delete photos" ON storage.objects;
CREATE POLICY "Approved users can delete photos"
ON storage.objects FOR DELETE TO authenticated
USING (bucket_id = 'photos' AND public.is_approved());

-- Freigegebene dürfen listen (für Upload mit upsert/remove nötig), Anonyme nicht
CREATE POLICY "Approved users can list photos"
ON storage.objects FOR SELECT TO authenticated
USING (bucket_id = 'photos' AND public.is_approved());
