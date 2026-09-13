-- ═══════════════════════════════════════════════════════════
-- Migration 004: Nutzerverwaltung & Policy-Korrekturen
--
-- Behebt zwei Lücken aus supabase-migration-approvals.sql:
--   1. "Anon can read approvals" (USING true): jeder mit dem öffentlichen
--      anon-Key konnte alle registrierten E-Mail-Adressen lesen.
--   2. "Admin can update approvals" (USING true): jeder Registrierte
--      konnte seine eigene Zeile auf 'approved' setzen (Selbst-Freigabe).
-- Außerdem: Status 'revoked' (sperren ohne Konto zu löschen), Kernfeld-
-- Schutz beanspruchter Profile auch serverseitig, Admin-Helfer.
--
-- Im Supabase SQL Editor ausführen (nach 002 und 003).
-- ═══════════════════════════════════════════════════════════

-- Admin-Helfer (E-Mail wie in js/admin.js und is_approved())
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT (auth.jwt() ->> 'email') = 'kaivonpetersdorff@me.com';
$$;

-- ── user_approvals ──────────────────────────────────────────
DROP POLICY IF EXISTS "Anon can read approvals" ON user_approvals;
DROP POLICY IF EXISTS "Admin can update approvals" ON user_approvals;
DROP POLICY IF EXISTS "Users can read own approval" ON user_approvals;

-- Jeder liest nur die eigene Zeile, der Admin alle
CREATE POLICY "Read own approval or admin reads all" ON user_approvals
  FOR SELECT TO authenticated
  USING (user_uid = auth.uid() OR public.is_admin());

-- Nur der Admin ändert Status (Freigeben / Ablehnen / Sperren)
CREATE POLICY "Admin updates approvals" ON user_approvals
  FOR UPDATE TO authenticated
  USING (public.is_admin())
  WITH CHECK (public.is_admin());

-- Status-Werte absichern (inkl. neuem 'revoked')
ALTER TABLE user_approvals DROP CONSTRAINT IF EXISTS user_approvals_status_check;
ALTER TABLE user_approvals ADD CONSTRAINT user_approvals_status_check
  CHECK (status IN ('pending', 'approved', 'rejected', 'revoked'));

-- ── members: Kernfeld-Schutz serverseitig ───────────────────
-- Beanspruchte Profile darf nur der Inhaber oder der Admin ändern;
-- Platzhalter jedes freigegebene Mitglied. Löschen: nur Platzhalter,
-- nur durch freigegebene Mitglieder (oder Admin).
DROP POLICY IF EXISTS "Approved users can update members" ON members;
CREATE POLICY "Approved users update placeholders, owners their own" ON members
  FOR UPDATE TO authenticated
  USING (public.is_approved() AND (claimed_by_uid IS NULL OR claimed_by_uid = auth.uid() OR public.is_admin()));

DROP POLICY IF EXISTS "Authenticated users can delete members" ON members;
CREATE POLICY "Approved users delete placeholders" ON members
  FOR DELETE TO authenticated
  USING (public.is_approved() AND (claimed_by_uid IS NULL OR public.is_admin()));
