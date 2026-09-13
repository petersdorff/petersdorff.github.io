-- ═══════════════════════════════════════════════════════════
-- Migration 005: Admin-Rolle vergeben können
--
-- Neue Spalte user_approvals.role ('member' | 'admin'). is_admin() prüft
-- die Rolle; die fest hinterlegte E-Mail bleibt als Bootstrap, damit sich
-- der Hauptadmin nie aussperren kann. Legt für den Hauptadmin eine Zeile
-- an (approved/admin), damit er in der Nutzerverwaltung erscheint.
--
-- Im Supabase SQL Editor ausführen (nach 004).
-- ═══════════════════════════════════════════════════════════

ALTER TABLE user_approvals ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'member';
ALTER TABLE user_approvals DROP CONSTRAINT IF EXISTS user_approvals_role_check;
ALTER TABLE user_approvals ADD CONSTRAINT user_approvals_role_check
  CHECK (role IN ('member', 'admin'));

-- Admin = freigegebenes Konto mit Rolle 'admin' ODER Bootstrap-E-Mail
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS boolean LANGUAGE sql SECURITY DEFINER STABLE AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_approvals
    WHERE user_uid = auth.uid() AND status = 'approved' AND role = 'admin'
  )
  OR (auth.jwt() ->> 'email') = 'kaivonpetersdorff@me.com';
$$;

-- Zeile für den Hauptadmin (falls noch keine existiert)
INSERT INTO user_approvals (user_uid, email, display_name, status, role, reviewed_at)
SELECT u.id, u.email, 'Kai von Petersdorff-Campen', 'approved', 'admin', now()
FROM auth.users u
WHERE u.email = 'kaivonpetersdorff@me.com'
  AND NOT EXISTS (SELECT 1 FROM user_approvals a WHERE a.user_uid = u.id);

-- Bestehende Zeile des Hauptadmins ggf. auf admin heben
UPDATE user_approvals SET role = 'admin', status = 'approved'
WHERE email = 'kaivonpetersdorff@me.com';
