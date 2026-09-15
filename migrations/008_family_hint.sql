-- ═══════════════════════════════════════════════════════════
-- 008 – Zweig-Zuordnung für unverbundene Profile
-- Im Supabase SQL-Editor ausführen.
--
-- Wer sich mit „Anschluss noch unklar" anlegt, hat noch keine Beziehung —
-- damit das Profil trotzdem in der Waisen-Ablage des richtigen Zweigs
-- (Märkisch / Pommersch) erscheint, merkt family_hint die ID der
-- Zweig-Wurzel. Sobald eine Verbindung besteht, ist der Hinweis egal.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.members ADD COLUMN IF NOT EXISTS family_hint UUID;

-- guest_graph liefert das Feld mit (sonst fehlt die Zuordnung im Gastmodus)
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
        'photo', m.photo, 'notes', m.notes, 'family_hint', m.family_hint,
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
