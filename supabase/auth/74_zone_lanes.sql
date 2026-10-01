-- ==========================================
-- 74. 창고 구획의 줄 수 (구역·라인에 줄 × 칸 — services/warehouseZones.js zoneDims, components/Warehouse3D.js · warehouse3d/planEditor.js)
-- ==========================================
-- 구획의 파렛트 칸 = 한 줄 칸 수(slots, 66번) × 줄 수(lanes) × 단 수(tiers).
-- 지금까지는 구획 하나가 한 줄뿐이었다(lanes 1). 넓은 구역에 가로 × 세로로 파렛트 자리를 잡을 수 있게 줄 수를 더한다.
-- 칸은 구획의 긴 변을 따라 놓이고 줄은 짧은 변 쪽으로 늘어선다.
-- 적재 기록(wms_zone_loads.cells, 69번)의 칸 키 = 줄 × 10000 + 줄 안의 칸 × 100 + 단 — 줄이 하나면 예전 값(칸 × 100 + 단) 그대로라 옮길 자료가 없다.
-- 권한은 65·68번 그대로. 여러 번 실행해도 안전하다.
ALTER TABLE public.wms_warehouse_zones
    ADD COLUMN IF NOT EXISTS lanes integer NOT NULL DEFAULT 1;

ALTER TABLE public.wms_warehouse_zones DROP CONSTRAINT IF EXISTS wms_warehouse_zones_lanes_range;
ALTER TABLE public.wms_warehouse_zones
    ADD CONSTRAINT wms_warehouse_zones_lanes_range CHECK (lanes >= 1 AND lanes <= 99);
