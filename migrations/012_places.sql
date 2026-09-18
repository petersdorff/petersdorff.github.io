-- ═══════════════════════════════════════════════════════════
-- 012 – Wohnort als Geodaten (Kartenansicht)
-- Im Supabase SQL-Editor ausführen.
--
-- `location` bleibt der angezeigte Freitext. Für die Karte kommen dazu:
--   place_name  kanonischer Ortsname („Hamburg, Deutschland"), aus dem
--               Orts-Picker im Editor (Photon/OpenStreetMap) bzw. der
--               einmaligen Geokodierung der Altbestände (tools/geocode-locations.py)
--   place_lat / place_lng  Koordinaten des Orts (Stadt-Ebene, keine Anschrift)
-- Ohne Koordinaten erscheint eine Person nicht auf der Karte. Die App
-- verträgt fehlende Spalten (Speichern lässt sie weg), volle Funktion
-- erst nach dieser Migration.
-- ═══════════════════════════════════════════════════════════

ALTER TABLE public.members
  ADD COLUMN IF NOT EXISTS place_name TEXT,
  ADD COLUMN IF NOT EXISTS place_lat  DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS place_lng  DOUBLE PRECISION;

-- Gastmodus: Ortsfelder mitliefern (wie location unkritisch: Stadt-Ebene).
-- Definition wie 011 + place_*.
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
        'call_name', m.call_name,
        'birth_name', m.birth_name, 'gender', m.gender,
        'birth_date', m.birth_date, 'death_date', m.death_date,
        'is_deceased', m.is_deceased, 'is_placeholder', m.is_placeholder,
        'location', m.location, 'occupation', m.occupation,
        'place_name', m.place_name, 'place_lat', m.place_lat, 'place_lng', m.place_lng,
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

-- Kontrolle:
--   SELECT count(*) FILTER (WHERE place_lat IS NOT NULL) AS geokodiert,
--          count(*) FILTER (WHERE COALESCE(location,'') <> '') AS mit_wohnort
--     FROM public.members;
