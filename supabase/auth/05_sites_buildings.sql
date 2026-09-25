-- =====================================================================
-- 05. 거점 개편: 방산 창고 → 방산공장, 대림오일 창고 → 본사 창고 통합, 김포2공장 추가
-- =====================================================================
-- 앱의 위치 문자열은 "거점" 또는 "거점 / 건물" 형식이다. (예: "김포공장 / 2동")
-- 건물은 환경설정 화면에서 거점별로 등록하며 wms_locations에 "거점 / 건물" 이름으로 저장된다.
-- 이 스크립트는 예전 거점명으로 저장된 클라우드 데이터를 새 거점명으로 옮긴다.
-- 여러 번 실행해도 안전하다. (한 트랜잭션으로 실행되며 실패하면 전부 취소된다)

BEGIN;

-- 1. 기본 4대 거점 등록
INSERT INTO public.wms_locations (name)
VALUES ('본사 창고'), ('김포공장'), ('방산공장'), ('김포2공장')
ON CONFLICT (name) DO NOTHING;

-- 2. 예전 거점명 → 새 거점명 매핑 (건물이 붙은 위치 "방산 창고 / 1동"도 함께 처리)
CREATE TEMP TABLE _loc_map ON COMMIT DROP AS
SELECT old_loc,
       CASE
           WHEN old_loc LIKE '방산 창고%' THEN '방산공장' || substr(old_loc, length('방산 창고') + 1)
           WHEN old_loc LIKE '대림오일 창고%' THEN '본사 창고' || substr(old_loc, length('대림오일 창고') + 1)
       END AS new_loc
FROM (
    SELECT location AS old_loc FROM public.wms_inventory
    UNION SELECT name FROM public.wms_locations
    UNION SELECT from_loc FROM public.wms_history_logs
    UNION SELECT to_loc FROM public.wms_history_logs
) s
WHERE old_loc = '방산 창고' OR old_loc LIKE '방산 창고 / %'
   OR old_loc = '대림오일 창고' OR old_loc LIKE '대림오일 창고 / %';

-- 3. 재고: 같은 품목이 새 위치에 이미 있으면 수량을 더하고 예전 행 삭제
UPDATE public.wms_inventory t
SET quantity = t.quantity + o.quantity,
    last_updated = NOW()
FROM public.wms_inventory o
JOIN _loc_map m ON m.old_loc = o.location
WHERE t.code = o.code AND t.location = m.new_loc;

DELETE FROM public.wms_inventory o
USING _loc_map m
WHERE o.location = m.old_loc
  AND EXISTS (SELECT 1 FROM public.wms_inventory t WHERE t.code = o.code AND t.location = m.new_loc);

-- 새 위치에 같은 품목이 없으면 위치명만 변경
UPDATE public.wms_inventory o
SET location = m.new_loc
FROM _loc_map m
WHERE o.location = m.old_loc;

-- 4. 입출고 이력의 출발/도착 위치명 변경
UPDATE public.wms_history_logs h SET from_loc = m.new_loc FROM _loc_map m WHERE h.from_loc = m.old_loc;
UPDATE public.wms_history_logs h SET to_loc = m.new_loc FROM _loc_map m WHERE h.to_loc = m.old_loc;

-- 5. 위치 목록: 예전 건물 위치는 새 이름으로 등록하고 예전 이름 삭제
INSERT INTO public.wms_locations (name)
SELECT DISTINCT new_loc FROM _loc_map
ON CONFLICT (name) DO NOTHING;

DELETE FROM public.wms_locations l
USING _loc_map m
WHERE l.name = m.old_loc;

COMMIT;

-- 확인용: 예전 거점명이 남아 있지 않아야 한다 (모두 0)
-- SELECT
--   (SELECT count(*) FROM public.wms_inventory WHERE location LIKE '방산 창고%' OR location LIKE '대림오일 창고%') AS inventory_left,
--   (SELECT count(*) FROM public.wms_history_logs WHERE from_loc LIKE '방산 창고%' OR to_loc LIKE '방산 창고%' OR from_loc LIKE '대림오일 창고%' OR to_loc LIKE '대림오일 창고%') AS history_left,
--   (SELECT count(*) FROM public.wms_locations WHERE name LIKE '방산 창고%' OR name LIKE '대림오일 창고%') AS locations_left;
