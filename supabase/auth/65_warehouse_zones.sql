-- ==========================================
-- 65. 창고 구획(존) 3D 배치도 (품목 및 재고관리 → 창고 배치도(3D), components/Warehouse3D.js, services/warehouseZones.js)
-- ==========================================
-- 창고(예: 김포2A) 바닥 크기와 그 안의 구획(라인, 예: 김포2A-01)의 위치·크기를 m 단위로 저장한다.
-- 재고 위치 문자열은 "거점 / 구획코드"(예: "김포공장 / 김포2A-01")라 재고·이력·수불부 로직은 그대로다.
-- 권한: 조회 VIEWER·경영자, 쓰기 MANAGER 이상

CREATE TABLE IF NOT EXISTS public.wms_warehouse_zones (
    id text PRIMARY KEY,                        -- 창고코드(kind WAREHOUSE) 또는 구획코드(kind ZONE, '김포2A-01')
    kind text NOT NULL CHECK (kind IN ('WAREHOUSE', 'ZONE')),
    warehouse text NOT NULL,                    -- 창고코드 (김포2A)
    site text NOT NULL DEFAULT '',              -- 거점 (김포공장)
    name text NOT NULL DEFAULT '',              -- 표시 이름 (1라인 · 원료 랙 …)
    zone_type text NOT NULL DEFAULT 'RACK',     -- RACK 랙 · FLOOR 바닥 적재 · TANK 탱크 · ETC
    x numeric NOT NULL DEFAULT 0,               -- 창고 왼쪽 위 모서리 기준 m
    z numeric NOT NULL DEFAULT 0,
    w numeric NOT NULL DEFAULT 1,               -- 가로(m)
    d numeric NOT NULL DEFAULT 1,               -- 세로(m)
    h numeric NOT NULL DEFAULT 1,               -- 높이(m)
    sort int NOT NULL DEFAULT 0,
    note text NOT NULL DEFAULT '',
    updated_by_name text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_warehouse_zones_wh_idx ON public.wms_warehouse_zones (warehouse);
ALTER TABLE public.wms_warehouse_zones ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wms_warehouse_zones_select ON public.wms_warehouse_zones;
DROP POLICY IF EXISTS wms_warehouse_zones_write ON public.wms_warehouse_zones;
CREATE POLICY wms_warehouse_zones_select ON public.wms_warehouse_zones FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_warehouse_zones_write ON public.wms_warehouse_zones FOR ALL TO authenticated
    USING ((SELECT public.wms_has_role('MANAGER'))) WITH CHECK ((SELECT public.wms_has_role('MANAGER')));
