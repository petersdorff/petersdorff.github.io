-- ═══════════════════════════════════════════════════════════
-- Migration 003: Freigabe-Prüfung serverseitig durchsetzen
--
-- Bisher war die Freigabe (user_approvals) nur ein Client-Check:
-- Jeder authentifizierte Nutzer konnte per REST-API alle Daten
-- lesen, auch ohne Admin-Freigabe. Diese Migration verlagert die
-- Prüfung in Row Level Security.
--
-- Im Supabase SQL Editor ausführen (nach Neuanlage des Projekts).
-- ═══════════════════════════════════════════════════════════

-- Hilfsfunktion: ist der aktuelle Nutzer freigegeben (oder Admin)?
CREATE OR REPLACE FUNCTION public.is_approved()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_approvals
    WHERE user_uid = auth.uid() AND status = 'approved'
  )
  OR (auth.jwt() ->> 'email') = 'kaivonpetersdorff@me.com';  -- Admin
$$;

-- members: Lesen/Schreiben nur für freigegebene Nutzer
DROP POLICY IF EXISTS "Authenticated users can read members" ON members;
CREATE POLICY "Approved users can read members"
  ON members FOR SELECT TO authenticated
  USING (public.is_approved());

DROP POLICY IF EXISTS "Authenticated users can insert members" ON members;
CREATE POLICY "Approved users can insert members"
  ON members FOR INSERT TO authenticated
  WITH CHECK (public.is_approved());

DROP POLICY IF EXISTS "Authenticated users can update members" ON members;
CREATE POLICY "Approved users can update members"
  ON members FOR UPDATE TO authenticated
  USING (public.is_approved());

-- relationships: analog
DROP POLICY IF EXISTS "Authenticated users can read relationships" ON relationships;
CREATE POLICY "Approved users can read relationships"
  ON relationships FOR SELECT TO authenticated
  USING (public.is_approved());

DROP POLICY IF EXISTS "Authenticated users can insert relationships" ON relationships;
CREATE POLICY "Approved users can insert relationships"
  ON relationships FOR INSERT TO authenticated
  WITH CHECK (public.is_approved());

DROP POLICY IF EXISTS "Authenticated users can update relationships" ON relationships;
CREATE POLICY "Approved users can update relationships"
  ON relationships FOR UPDATE TO authenticated
  USING (public.is_approved());

DROP POLICY IF EXISTS "Authenticated users can delete relationships" ON relationships;
CREATE POLICY "Approved users can delete relationships"
  ON relationships FOR DELETE TO authenticated
  USING (public.is_approved());

-- Hinweis: user_approvals selbst braucht Policies, die (a) jedem Nutzer
-- erlauben, den EIGENEN Antrag zu lesen/anzulegen, und (b) nur dem Admin,
-- Status zu ändern. Falls noch nicht vorhanden:
--
-- ALTER TABLE user_approvals ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "read own approval" ON user_approvals FOR SELECT
--   TO authenticated USING (user_uid = auth.uid() OR (auth.jwt() ->> 'email') = 'kaivonpetersdorff@me.com');
-- CREATE POLICY "create own approval" ON user_approvals FOR INSERT
--   TO authenticated WITH CHECK (user_uid = auth.uid());
-- CREATE POLICY "admin updates approvals" ON user_approvals FOR UPDATE
--   TO authenticated USING ((auth.jwt() ->> 'email') = 'kaivonpetersdorff@me.com');
