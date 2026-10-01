-- ==========================================
-- 69. 창고 배치도 라인 파렛트의 칸 위치 (services/warehouseZones.js zoneCellMap · saveZoneCells)
-- ==========================================
-- 품목이 그 라인에서 차지하는 파렛트(wms_zone_loads.pallets)마다 놓인 칸을 저장한다.
-- cells = [칸 키, …], 칸 키 = 줄 시작 쪽(좌표 작은 쪽)에서 센 칸 × 100 + 단 (0부터) — 예: 301 = 4번째 칸 2단.
-- 물리 위치로 저장하므로 채우는 방향(fill_from)을 바꿔도 파렛트는 제자리다.
-- 비어 있으면(예전 기록·입출고 화면에서 넣은 재고) 앱이 빈 칸에 차례로 놓인 것으로 본다.
-- 권한은 66·68번 그대로(조회 VIEWER·경영자, 쓰기 OPERATOR). 여러 번 실행해도 안전하다.
ALTER TABLE public.wms_zone_loads ADD COLUMN IF NOT EXISTS cells jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
    ALTER TABLE public.wms_zone_loads ADD CONSTRAINT wms_zone_loads_cells_array CHECK (jsonb_typeof(cells) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
