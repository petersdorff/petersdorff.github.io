-- ═══════════════════════════════════════════════════════════
-- 009 – Nutzungsstatistik für die Nutzerverwaltung
-- Im Supabase SQL-Editor ausführen.
--
-- Die App meldet schlanke Ereignisse (App-Start, Gast-Start,
-- Verwandtschaftsabfrage, neue Person, Profil-Bearbeitung, neue
-- Beziehung) über log_event(); die Nutzerverwaltung liest Tageszahlen
-- über usage_stats(). Keine Personen-IDs, keine Inhalte — nur Zähler.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.usage_events (
  id         BIGSERIAL PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_uid   UUID,                 -- NULL = Gast
  kind       TEXT NOT NULL,        -- app_open | guest_open | connection | member_create | member_update | relationship_add
  meta       JSONB
);
CREATE INDEX IF NOT EXISTS usage_events_created_idx ON public.usage_events (created_at);

ALTER TABLE public.usage_events ENABLE ROW LEVEL SECURITY;
-- Lesen nur Admins; Schreiben ausschließlich über log_event()
DROP POLICY IF EXISTS usage_events_admin_read ON public.usage_events;
CREATE POLICY usage_events_admin_read ON public.usage_events
  FOR SELECT USING (public.is_admin());

CREATE OR REPLACE FUNCTION public.log_event(p_kind TEXT, p_meta JSONB DEFAULT NULL)
RETURNS VOID
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_kind IS NULL OR length(p_kind) > 40 THEN RETURN; END IF;
  INSERT INTO public.usage_events (user_uid, kind, meta)
  VALUES (auth.uid(), p_kind, CASE WHEN p_meta IS NULL THEN NULL ELSE left(p_meta::text, 500)::jsonb END);
END;
$$;

-- Tageszahlen der letzten p_days Tage (Berlin) + Gesamtzahlen; nur Admins.
CREATE OR REPLACE FUNCTION public.usage_stats(p_days INT DEFAULT 14)
RETURNS JSONB
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  since TIMESTAMPTZ := (date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') - make_interval(days => GREATEST(p_days, 1) - 1)) AT TIME ZONE 'Europe/Berlin';
BEGIN
  IF NOT public.is_admin() THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN jsonb_build_object(
    'accounts_total',    (SELECT count(*) FROM public.user_approvals),
    'accounts_approved', (SELECT count(*) FROM public.user_approvals WHERE status = 'approved'),
    'accounts_pending',  (SELECT count(*) FROM public.user_approvals WHERE status = 'pending'),
    'profiles_claimed',  (SELECT count(*) FROM public.members WHERE claimed_by_uid IS NOT NULL),
    'members_total',     (SELECT count(*) FROM public.members),
    'relationships_total', (SELECT count(*) FROM public.relationships),
    'active_users_period', (SELECT count(DISTINCT user_uid) FROM public.usage_events WHERE created_at >= since AND user_uid IS NOT NULL),
    'days', (
      SELECT COALESCE(jsonb_agg(row ORDER BY row->>'day' DESC), '[]'::jsonb) FROM (
        SELECT jsonb_build_object(
          'day', d::date,
          'app_open',     count(*) FILTER (WHERE e.kind = 'app_open'),
          'active_users', count(DISTINCT e.user_uid) FILTER (WHERE e.kind = 'app_open'),
          'guest_open',   count(*) FILTER (WHERE e.kind = 'guest_open'),
          'connection',   count(*) FILTER (WHERE e.kind = 'connection'),
          'member_create',    count(*) FILTER (WHERE e.kind = 'member_create'),
          'member_update',    count(*) FILTER (WHERE e.kind = 'member_update'),
          'relationship_add', count(*) FILTER (WHERE e.kind = 'relationship_add')
        ) AS row
        FROM generate_series(date_trunc('day', since AT TIME ZONE 'Europe/Berlin'), date_trunc('day', now() AT TIME ZONE 'Europe/Berlin'), interval '1 day') AS d
        LEFT JOIN public.usage_events e
          ON date_trunc('day', e.created_at AT TIME ZONE 'Europe/Berlin') = d
        GROUP BY d
      ) t
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.log_event(TEXT, JSONB) FROM public;
REVOKE ALL ON FUNCTION public.usage_stats(INT) FROM public;
GRANT EXECUTE ON FUNCTION public.log_event(TEXT, JSONB) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.usage_stats(INT) TO authenticated;
