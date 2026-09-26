-- =====================================================================
-- 25. 보관거점 '본사 창고' → '본사', 원료·원액 단위 → L (원료수불부 기준)
-- =====================================================================
-- 1) 거점명: 위치 문자열 "본사 창고" / "본사 창고 / 건물" → "본사" / "본사 / 건물"
--    재고(같은 품목이 새 위치에 있으면 수량 합산)·입출고 이력·제품/자재 수불부 위치·위치 목록을 옮기고,
--    전표 비고·합치기 되돌리기 자료 안의 이름도 바꾼다. (제품/자재 수불부 전표 id는 동기화 키라서 그대로 둔다)
--    앱은 기기에 남은 예전 이름을 불러올 때 '본사'로 바꾼다(locations.js LEGACY_SITE_MAP).
-- 2) 원료·원액 품목의 단위가 EA/KG로 잘못 들어가 있지만 재고 수량은 원료수불부 재고량(L)과 같다.
--    단위를 L로 고친다(화면은 L과 kg = L × 비중을 함께 보여 준다).
-- 여러 번 실행해도 안전하다. 한 트랜잭션으로 실행되며 실패하면 전부 취소된다.

BEGIN;

INSERT INTO public.wms_locations (name) VALUES ('본사') ON CONFLICT (name) DO NOTHING;

CREATE TEMP TABLE _loc_map ON COMMIT DROP AS
SELECT DISTINCT old_loc, '본사' || substr(old_loc, length('본사 창고') + 1) AS new_loc
FROM (
    SELECT location AS old_loc FROM public.wms_inventory
    UNION SELECT name FROM public.wms_locations
    UNION SELECT from_loc FROM public.wms_history_logs
    UNION SELECT to_loc FROM public.wms_history_logs
    UNION SELECT location FROM public.wms_item_ledger
) s
WHERE old_loc = '본사 창고' OR old_loc LIKE '본사 창고 / %';

-- 재고: 새 위치에 같은 품목이 있으면 더하고 예전 행 삭제, 없으면 이름만 변경
UPDATE public.wms_inventory t
SET quantity = t.quantity + o.quantity, last_updated = NOW()
FROM public.wms_inventory o
JOIN _loc_map m ON m.old_loc = o.location
WHERE t.code = o.code AND t.location = m.new_loc;

DELETE FROM public.wms_inventory o
USING _loc_map m
WHERE o.location = m.old_loc
  AND EXISTS (SELECT 1 FROM public.wms_inventory t WHERE t.code = o.code AND t.location = m.new_loc);

UPDATE public.wms_inventory o SET location = m.new_loc FROM _loc_map m WHERE o.location = m.old_loc;

-- 입출고 이력
UPDATE public.wms_history_logs h SET from_loc = m.new_loc FROM _loc_map m WHERE h.from_loc = m.old_loc;
UPDATE public.wms_history_logs h SET to_loc = m.new_loc FROM _loc_map m WHERE h.to_loc = m.old_loc;

-- 제품·자재 수불부 위치와 비고, 원료수불부 비고
UPDATE public.wms_item_ledger e SET location = m.new_loc, updated_at = NOW() FROM _loc_map m WHERE e.location = m.old_loc;
UPDATE public.wms_item_ledger SET notes = replace(notes, '본사 창고', '본사') WHERE notes LIKE '%본사 창고%';
UPDATE public.wms_raw_ledger SET notes = replace(notes, '본사 창고', '본사') WHERE notes LIKE '%본사 창고%';

-- 품목 합치기 되돌리기 자료 (되돌리면 예전 이름으로 재고가 생기지 않게)
UPDATE public.wms_merge_logs SET changes = replace(changes::text, '"본사 창고', '"본사')::jsonb WHERE changes::text LIKE '%본사 창고%';

-- 위치 목록
INSERT INTO public.wms_locations (name) SELECT DISTINCT new_loc FROM _loc_map ON CONFLICT (name) DO NOTHING;
DELETE FROM public.wms_locations l USING _loc_map m WHERE l.name = m.old_loc;

-- 원료·원액 단위 → L
UPDATE public.wms_master_items
SET unit = 'L'
WHERE category IN ('원료', '원액') AND (unit IS NULL OR btrim(unit) = '' OR upper(unit) IN ('EA', 'KG'));

COMMIT;

-- 확인용 (모두 0이어야 한다)
-- SELECT
--   (SELECT count(*) FROM public.wms_inventory WHERE location LIKE '본사 창고%') AS inventory_left,
--   (SELECT count(*) FROM public.wms_history_logs WHERE from_loc LIKE '본사 창고%' OR to_loc LIKE '본사 창고%') AS history_left,
--   (SELECT count(*) FROM public.wms_item_ledger WHERE location LIKE '본사 창고%') AS item_ledger_left,
--   (SELECT count(*) FROM public.wms_locations WHERE name LIKE '본사 창고%') AS locations_left,
--   (SELECT count(*) FROM public.wms_master_items WHERE category IN ('원료','원액') AND upper(coalesce(unit,'')) <> 'L') AS raw_not_l;
