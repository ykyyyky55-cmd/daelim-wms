-- ==========================================
-- 67. 창고 배치도 라인 적재 시작 방향 (components/Warehouse3D.js, services/warehouseZones.js)
-- ==========================================
-- fill_from: START = 줄 시작 쪽(좌표 작은 쪽)부터, END = 반대쪽 끝(안쪽 벽 쪽)부터 파렛트 칸을 채운다.
ALTER TABLE public.wms_warehouse_zones ADD COLUMN IF NOT EXISTS fill_from text NOT NULL DEFAULT 'START';
DO $$ BEGIN
    ALTER TABLE public.wms_warehouse_zones ADD CONSTRAINT wms_warehouse_zones_fill_from_check CHECK (fill_from IN ('START', 'END'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
