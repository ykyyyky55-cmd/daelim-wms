-- ==========================================
-- 66. 창고 배치도 라인 파렛트 칸 · 적재 파렛트 수 (components/Warehouse3D.js, services/warehouseZones.js)
-- ==========================================
-- · 구획(라인)마다 파렛트 칸: slots(한 줄에 놓는 파렛트 수) × tiers(단) = 칸 수 (예: 6 × 2 = 12칸)
-- · 라인에 물건을 넣을 때 파렛트 수를 적으면 wms_zone_loads에 (라인, 품목)별로 남기고,
--   3D는 라인의 파렛트 합계만큼 1번 칸부터 차례로 칠한다(정확한 칸 위치는 고르지 않음).
-- 권한: 조회 VIEWER·경영자, 적재 기록 OPERATOR 이상(재고 이동과 같음), 칸 수는 배치 편집(MANAGER)

ALTER TABLE public.wms_warehouse_zones ADD COLUMN IF NOT EXISTS slots int NOT NULL DEFAULT 0;
ALTER TABLE public.wms_warehouse_zones ADD COLUMN IF NOT EXISTS tiers int NOT NULL DEFAULT 1;

CREATE TABLE IF NOT EXISTS public.wms_zone_loads (
    id text PRIMARY KEY,                        -- '<구획코드>|<품목코드>'
    zone_id text NOT NULL,
    code text NOT NULL,
    pallets numeric NOT NULL DEFAULT 0 CHECK (pallets >= 0),
    updated_by_name text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_zone_loads_zone_idx ON public.wms_zone_loads (zone_id);
ALTER TABLE public.wms_zone_loads ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wms_zone_loads_select ON public.wms_zone_loads;
DROP POLICY IF EXISTS wms_zone_loads_write ON public.wms_zone_loads;
CREATE POLICY wms_zone_loads_select ON public.wms_zone_loads FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_zone_loads_write ON public.wms_zone_loads FOR ALL TO authenticated
    USING ((SELECT public.wms_has_role('OPERATOR'))) WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
