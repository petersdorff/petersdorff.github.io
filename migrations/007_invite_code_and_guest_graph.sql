-- ═══════════════════════════════════════════════════════════
-- 007 – Familientag-Code: Sofort-Freigabe + Gastzugang aus der DB
-- Im Supabase SQL-Editor ausführen.
--
-- Hintergrund: Der öffentliche Daten-Snapshot (js/data-snapshot.js) ist
-- abgeschafft — nichts Persönliches liegt mehr in Repo oder Website.
-- Gäste (Familientag-Modus) lesen den Baum über guest_graph(code), das
-- nur mit gültigem, nicht abgelaufenem Code Daten liefert. Wer den Code
-- bei der Registrierung eingibt, ist sofort freigegeben (kein Warten
-- auf Admin). Annahme: Wer den Code kennt, gehört zur Familie.
-- Code und Ablaufdatum stehen in app_settings (nur Admins lesen/ändern).
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.app_settings (
  key         TEXT PRIMARY KEY,
  value       TEXT,
  valid_until TIMESTAMPTZ,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS app_settings_admin_all ON public.app_settings;
CREATE POLICY app_settings_admin_all ON public.app_settings
  FOR ALL USING (public.is_admin()) WITH CHECK (public.is_admin());

-- Familientag-Code, gültig bis einschließlich Sonntag, 20.09.2026 (Berlin)
INSERT INTO public.app_settings (key, value, valid_until)
VALUES ('invite_code', 'Familientag-2026-EGX9', '2026-09-20 23:59:59+02')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, valid_until = EXCLUDED.valid_until, updated_at = now();

-- Prüfung (ohne Groß/Klein, ohne Randleerzeichen); läuft mit Rechten des
-- Erstellers, damit anon/authenticated die Tabelle selbst nie lesen müssen.
CREATE OR REPLACE FUNCTION public.invite_code_valid(p_code TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_settings
    WHERE key = 'invite_code'
      AND COALESCE(value, '') <> ''
      AND lower(trim(value)) = lower(trim(COALESCE(p_code, '')))
      AND (valid_until IS NULL OR valid_until > now())
  );
$$;

-- Registrierung mit Code: eigene Freigabe-Zeile auf 'approved'.
-- Gesperrte/abgelehnte Konten bleiben gesperrt (nur pending/neu wird frei).
CREATE OR REPLACE FUNCTION public.redeem_invite_code(p_code TEXT, p_display_name TEXT DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  uid  UUID := auth.uid();
  mail TEXT := auth.jwt() ->> 'email';
BEGIN
  IF uid IS NULL THEN RETURN FALSE; END IF;
  IF NOT public.invite_code_valid(p_code) THEN RETURN FALSE; END IF;

  IF EXISTS (SELECT 1 FROM public.user_approvals WHERE user_uid = uid) THEN
    UPDATE public.user_approvals
      SET status = 'approved', reviewed_at = now()
      WHERE user_uid = uid AND status = 'pending';
  ELSE
    INSERT INTO public.user_approvals (user_uid, email, display_name, status, role, reviewed_at)
    VALUES (uid, COALESCE(mail, ''), COALESCE(p_display_name, mail, ''), 'approved', 'member', now());
  END IF;

  RETURN EXISTS (SELECT 1 FROM public.user_approvals WHERE user_uid = uid AND status = 'approved');
END;
$$;

-- Gastzugang: kompletter Baum für den Familientag-Modus — ohne Kontakt-
-- felder (contact, phone, email), die bleiben Mitgliedern vorbehalten.
CREATE OR REPLACE FUNCTION public.guest_graph(p_code TEXT)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.invite_code_valid(p_code) THEN
    RAISE EXCEPTION 'invalid_code' USING ERRCODE = 'P0001';
  END IF;
  RETURN jsonb_build_object(
    'members', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', m.id, 'first_name', m.first_name, 'last_name', m.last_name,
        'birth_name', m.birth_name, 'gender', m.gender,
        'birth_date', m.birth_date, 'death_date', m.death_date,
        'is_deceased', m.is_deceased, 'is_placeholder', m.is_placeholder,
        'location', m.location, 'occupation', m.occupation,
        'photo', m.photo, 'notes', m.notes,
        'claimed_by_uid', m.claimed_by_uid, 'created_at', m.created_at
      )), '[]'::jsonb) FROM public.members m
    ),
    'relationships', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'id', r.id, 'from_id', r.from_id, 'to_id', r.to_id, 'rel_type', r.rel_type,
        'is_former', r.is_former, 'marriage_date', r.marriage_date,
        'divorce_date', r.divorce_date, 'created_at', r.created_at
      )), '[]'::jsonb) FROM public.relationships r
    ),
    'generated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invite_code_valid(TEXT) FROM public;
REVOKE ALL ON FUNCTION public.redeem_invite_code(TEXT, TEXT) FROM public;
REVOKE ALL ON FUNCTION public.guest_graph(TEXT) FROM public;
GRANT EXECUTE ON FUNCTION public.invite_code_valid(TEXT) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.redeem_invite_code(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.guest_graph(TEXT) TO anon, authenticated;

-- Kontrolle:
--   SELECT public.invite_code_valid('Familientag-2026-EGX9');   -- true
--   SELECT jsonb_array_length(public.guest_graph('Familientag-2026-EGX9') -> 'members');
