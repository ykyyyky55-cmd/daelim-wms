-- =====================================================================
-- 43. 거점·창고 개편 (2026-09): 거점 2개(본사·김포공장) → 캠프 → 창고
-- =====================================================================
-- 새 구성 (앱 services/locations.js SITE_LAYOUT과 같다. 위치 문자열 = "거점" 또는 "거점 / 창고코드")
--   본사     도창동 본사 : 본사1A 1층 제조 포장실 · 본사1B 2층 창고 · 본사1C 4층 창고 · 본사1D 옥외저장소
--            방산캠프    : 본사2A 방산공장 제조소 · 본사2B 방산공장 창고동
--   김포공장 김포1공장   : 김포1A 생산동 · 김포1B 포장동 · 김포1C 창고동 · 김포1D 옥외저장소
--            김포2공장   : 김포2A A동 · 김포2B B동 · 김포2C 사무동
-- 옮기는 자료
--   재고·입출고 이력 위치 : '방산공장'(방산 창고) → '본사 / 본사2A', '김포2공장' → '김포공장',
--                           '방산공장 / X' → '본사 / X', '김포2공장 / X' → '김포공장 / X', '김포공장 / 김포1A동' → '김포공장 / 김포1A'
--                           (재고는 같은 품목·위치 행이 생기면 수량을 합친다)
--   제품·자재 수불부 위치 : 거점 단위 — 방산공장 → 본사, 김포2공장 → 김포공장. 합쳐진 품목·거점의 누적 재고(stock_qty)를 입력 순서(seq)대로 다시 계산
--   원료수불부 지역       : 방산 → 본사, 김포2 → 김포 (누적 재고는 앱이 불러올 때 recalcRawLedgerByDate가 수불일자 순으로 다시 계산해 저장)
--   위치 목록             : 예전 거점·건물 삭제, 새 거점·창고 13개 등록
-- 비고·업무일지·보고서 같은 자유 글자와 수불부 전표 id(동기화 키)는 그대로 둔다.
-- 실행 전 wms_backup 스키마에 바뀌는 표를 통째로 복사해 둔다(되돌릴 때 사용). 한 트랜잭션: 실패하면 전부 취소.

BEGIN;

-- 0) 백업
CREATE SCHEMA IF NOT EXISTS wms_backup;
DROP TABLE IF EXISTS wms_backup.inventory_before_43, wms_backup.history_logs_before_43, wms_backup.item_ledger_before_43,
                     wms_backup.raw_ledger_before_43, wms_backup.locations_before_43;
CREATE TABLE wms_backup.inventory_before_43 AS SELECT * FROM public.wms_inventory;
CREATE TABLE wms_backup.history_logs_before_43 AS SELECT * FROM public.wms_history_logs;
CREATE TABLE wms_backup.item_ledger_before_43 AS SELECT * FROM public.wms_item_ledger;
CREATE TABLE wms_backup.raw_ledger_before_43 AS SELECT * FROM public.wms_raw_ledger;
CREATE TABLE wms_backup.locations_before_43 AS SELECT * FROM public.wms_locations;

-- 1) 위치 이름 대응표 (재고·이력용: 창고 단위)
CREATE TEMP TABLE _loc_map ON COMMIT DROP AS
SELECT DISTINCT old_loc,
    CASE
        WHEN old_loc IN ('방산공장', '방산 창고') THEN '본사 / 본사2A'
        WHEN old_loc = '김포2공장' THEN '김포공장'
        WHEN old_loc LIKE '방산공장 / %' THEN '본사' || substr(old_loc, length('방산공장') + 1)
        WHEN old_loc LIKE '방산 창고 / %' THEN '본사' || substr(old_loc, length('방산 창고') + 1)
        WHEN old_loc LIKE '김포2공장 / %' THEN '김포공장' || substr(old_loc, length('김포2공장') + 1)
        WHEN old_loc ~ '^김포공장 / 김포[12][A-D]동$' THEN regexp_replace(old_loc, '동$', '')
        WHEN old_loc ~ '^김포[12]공장 [A-D]동$' THEN regexp_replace(old_loc, '^김포([12])공장 ([A-D])동$', '김포공장 / 김포\1\2') -- 예전 표기 '김포2공장 B동'
    END AS new_loc
FROM (
    SELECT location AS old_loc FROM public.wms_inventory
    UNION SELECT name FROM public.wms_locations
    UNION SELECT from_loc FROM public.wms_history_logs
    UNION SELECT to_loc FROM public.wms_history_logs
) s
WHERE old_loc IN ('방산공장', '방산 창고', '김포2공장')
   OR old_loc LIKE '방산공장 / %' OR old_loc LIKE '방산 창고 / %' OR old_loc LIKE '김포2공장 / %'
   OR old_loc ~ '^김포공장 / 김포[12][A-D]동$' OR old_loc ~ '^김포[12]공장 [A-D]동$';

-- 2) 재고: 새 위치에 같은 품목이 있으면 더하고 예전 행 삭제, 없으면 이름만 변경
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

-- 3) 입출고 이력
UPDATE public.wms_history_logs h SET from_loc = m.new_loc FROM _loc_map m WHERE h.from_loc = m.old_loc;
UPDATE public.wms_history_logs h SET to_loc = m.new_loc FROM _loc_map m WHERE h.to_loc = m.old_loc;

-- 4) 제품·자재 수불부 (거점 단위) + 합쳐진 품목·거점의 누적 재고 다시 계산
CREATE TEMP TABLE _ledger_touched ON COMMIT DROP AS
SELECT DISTINCT kind, code, CASE WHEN location IN ('방산공장', '방산 창고') THEN '본사' ELSE '김포공장' END AS location
FROM public.wms_item_ledger
WHERE location IN ('방산공장', '방산 창고', '김포2공장');

UPDATE public.wms_item_ledger
SET location = CASE WHEN location IN ('방산공장', '방산 창고') THEN '본사' ELSE '김포공장' END, updated_at = NOW()
WHERE location IN ('방산공장', '방산 창고', '김포2공장');

UPDATE public.wms_item_ledger e
SET stock_qty = s.run, updated_at = NOW()
FROM (
    SELECT l.id, round(sum(coalesce(l.in_qty, 0) - coalesce(l.out_qty, 0)) OVER (PARTITION BY l.kind, l.code, l.location ORDER BY l.seq, l.id), 6) AS run
    FROM public.wms_item_ledger l
    JOIN _ledger_touched t ON t.kind = l.kind AND t.code = l.code AND t.location = l.location
) s
WHERE e.id = s.id AND e.stock_qty IS DISTINCT FROM s.run;

-- 5) 원료수불부 지역
UPDATE public.wms_raw_ledger SET location = '본사' WHERE location = '방산';
UPDATE public.wms_raw_ledger SET location = '김포' WHERE location = '김포2';

-- 6) 위치 목록: 예전 이름 삭제, 새 거점·창고 등록
DELETE FROM public.wms_locations l USING _loc_map m WHERE l.name = m.old_loc;
INSERT INTO public.wms_locations (name) VALUES
    ('본사'), ('본사 / 본사1A'), ('본사 / 본사1B'), ('본사 / 본사1C'), ('본사 / 본사1D'), ('본사 / 본사2A'), ('본사 / 본사2B'),
    ('김포공장'), ('김포공장 / 김포1A'), ('김포공장 / 김포1B'), ('김포공장 / 김포1C'), ('김포공장 / 김포1D'),
    ('김포공장 / 김포2A'), ('김포공장 / 김포2B'), ('김포공장 / 김포2C')
ON CONFLICT (name) DO NOTHING;

COMMIT;

-- 확인용 (모두 0이어야 한다)
-- SELECT
--   (SELECT count(*) FROM public.wms_inventory WHERE location ~ '방산공장|김포2공장|방산 창고|김포[12][A-D]동') AS inventory_left,
--   (SELECT count(*) FROM public.wms_history_logs WHERE from_loc ~ '방산공장|김포2공장|김포[12][A-D]동' OR to_loc ~ '방산공장|김포2공장|김포[12][A-D]동') AS history_left,
--   (SELECT count(*) FROM public.wms_item_ledger WHERE location IN ('방산공장', '김포2공장', '방산 창고')) AS item_ledger_left,
--   (SELECT count(*) FROM public.wms_raw_ledger WHERE location IN ('방산', '김포2')) AS raw_left,
--   (SELECT count(*) FROM public.wms_locations WHERE name ~ '방산공장|김포2공장|김포[12][A-D]동') AS locations_left;
-- 되돌리기: wms_backup.*_before_43 표를 원래 표로 다시 넣는다.
