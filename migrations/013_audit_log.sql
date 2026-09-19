-- ═══════════════════════════════════════════════════════════
-- 013 – Änderungsprotokoll (wer hat was geändert)
-- Im Supabase SQL-Editor ausführen.
--
-- Trigger auf members und relationships schreiben jede Änderung in
-- audit_log: Konto (auth.uid() der Sitzung; NULL = Service-Key/Skript),
-- Vorgang, betroffene Person(en) als Klartext und bei Bearbeitungen die
-- geänderten Spalten. Lesen dürfen nur Admins (RPC recent_changes), die
-- Nutzerverwaltung zeigt die letzten Einträge.
-- ═══════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.audit_log (
  id         BIGSERIAL PRIMARY KEY,
  at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_uid   UUID,
  table_name TEXT NOT NULL,           -- members | relationships
  op         TEXT NOT NULL,           -- INSERT | UPDATE | DELETE
  row_id     UUID,
  subject    TEXT,                    -- „Vorname Nachname" bzw. „A → B (Typ)"
  changed    TEXT[],                  -- geänderte Spalten (nur UPDATE)
  details    JSONB                    -- kleine Zusatzinfos (z.B. rel_type, is_former)
);
CREATE INDEX IF NOT EXISTS audit_log_at_idx ON public.audit_log (at DESC);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS audit_log_admin_read ON public.audit_log;
CREATE POLICY audit_log_admin_read ON public.audit_log
  FOR SELECT USING (public.is_admin());
-- Kein INSERT/UPDATE/DELETE per Policy: nur die Trigger (SECURITY DEFINER) schreiben.

-- Personen: Anlegen, Bearbeiten (mit geänderten Spalten), Löschen
CREATE OR REPLACE FUNCTION public.audit_members()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cols TEXT[];
  who  UUID := auth.uid();
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.audit_log (user_uid, table_name, op, row_id, subject)
    VALUES (who, 'members', 'INSERT', NEW.id, btrim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')));
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key ORDER BY n.key) INTO cols
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE to_jsonb(OLD) -> n.key IS DISTINCT FROM n.value
       AND n.key NOT IN ('updated_at');
    IF cols IS NULL THEN RETURN NEW; END IF;      -- nichts Sichtbares geändert
    INSERT INTO public.audit_log (user_uid, table_name, op, row_id, subject, changed)
    VALUES (who, 'members', 'UPDATE', NEW.id, btrim(COALESCE(NEW.first_name, '') || ' ' || COALESCE(NEW.last_name, '')), cols);
    RETURN NEW;
  ELSE
    INSERT INTO public.audit_log (user_uid, table_name, op, row_id, subject)
    VALUES (who, 'members', 'DELETE', OLD.id, btrim(COALESCE(OLD.first_name, '') || ' ' || COALESCE(OLD.last_name, '')));
    RETURN OLD;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS members_audit ON public.members;
CREATE TRIGGER members_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.members
  FOR EACH ROW EXECUTE FUNCTION public.audit_members();

-- Beziehungen: Anlegen, Ändern (z.B. getrennt), Löschen — mit Namen beider Seiten
CREATE OR REPLACE FUNCTION public.audit_relationships()
RETURNS TRIGGER
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r    public.relationships;
  a    TEXT; b TEXT;
  who  UUID := auth.uid();
  cols TEXT[];
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) INTO a FROM public.members WHERE id = r.from_id;
  SELECT btrim(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) INTO b FROM public.members WHERE id = r.to_id;
  IF TG_OP = 'UPDATE' THEN
    SELECT array_agg(n.key ORDER BY n.key) INTO cols
      FROM jsonb_each(to_jsonb(NEW)) n
     WHERE to_jsonb(OLD) -> n.key IS DISTINCT FROM n.value;
    IF cols IS NULL THEN RETURN NEW; END IF;
  END IF;
  INSERT INTO public.audit_log (user_uid, table_name, op, row_id, subject, changed, details)
  VALUES (who, 'relationships', TG_OP, r.id,
          COALESCE(a, '?') || ' → ' || COALESCE(b, '?'),
          cols,
          jsonb_build_object('rel_type', r.rel_type, 'is_former', r.is_former));
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS relationships_audit ON public.relationships;
CREATE TRIGGER relationships_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.relationships
  FOR EACH ROW EXECUTE FUNCTION public.audit_relationships();

-- Lesen (nur Admins): letzte n Einträge mit Konto-Anzeige
CREATE OR REPLACE FUNCTION public.recent_changes(p_limit INT DEFAULT 10)
RETURNS TABLE (
  id BIGINT, at TIMESTAMPTZ, table_name TEXT, op TEXT, row_id UUID, subject TEXT,
  changed TEXT[], details JSONB, user_email TEXT, user_name TEXT
)
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.id, l.at, l.table_name, l.op, l.row_id, l.subject, l.changed, l.details,
         u.email, u.display_name
    FROM public.audit_log l
    LEFT JOIN public.user_approvals u ON u.user_uid = l.user_uid
   WHERE public.is_admin()
   ORDER BY l.at DESC
   LIMIT LEAST(GREATEST(COALESCE(p_limit, 10), 1), 200);
$$;

REVOKE ALL ON FUNCTION public.recent_changes(INT) FROM public;
GRANT EXECUTE ON FUNCTION public.recent_changes(INT) TO authenticated;

-- Kontrolle (als Admin eingeloggt bzw. im SQL-Editor):
--   SELECT * FROM public.audit_log ORDER BY at DESC LIMIT 5;
