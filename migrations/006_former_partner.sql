-- ═══════════════════════════════════════════════════════════
-- Migration 006: Ehemalige Partnerschaften
--
-- rel_type bleibt 'spouse' (Layout, Pfadsuche, Regel-Engine unverändert);
-- is_former markiert getrennte/geschiedene Partnerschaften. Anzeige im
-- Fächer als ⚮ statt ∞, in Listen als „Ehemalige/r Partner/in".
--
-- Im Supabase SQL Editor ausführen (nach 005).
-- ═══════════════════════════════════════════════════════════

ALTER TABLE relationships ADD COLUMN IF NOT EXISTS is_former BOOLEAN NOT NULL DEFAULT false;

-- Beispiel/Testfall: Stephan von Petersdorff-Campen ⚮ Beate Krischer
UPDATE relationships SET is_former = true
WHERE rel_type = 'spouse'
  AND ((from_id = '670f73b5-8209-54c7-9d94-8b6381a595eb' AND to_id = 'a135908e-5205-5048-a257-83ffe461d2bb')
    OR (from_id = 'a135908e-5205-5048-a257-83ffe461d2bb' AND to_id = '670f73b5-8209-54c7-9d94-8b6381a595eb'));
