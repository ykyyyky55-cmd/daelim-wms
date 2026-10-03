-- 83. 창고 배치도 구획 색 (2026-10-03)
-- 구획마다 3D·평면도에 칠할 색(#rrggbb). 비우면('') 종류별 기본색(랙 주황 · 바닥 라인 노랑 · 옥외 구역 하늘색 …)
-- 앱: services/warehouseZones.js cleanZoneColor · fromDb/toDb, 평면도 편집기 구획 속성의 '색'
-- 정책은 그대로(65번: 조회 VIEWER·경영자, 쓰기 MANAGER) — 칸만 더한다.

alter table public.wms_warehouse_zones
    add column if not exists color text not null default '';

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'wms_warehouse_zones_color_check') then
        alter table public.wms_warehouse_zones
            add constraint wms_warehouse_zones_color_check check (color = '' or color ~ '^#[0-9a-f]{6}$');
    end if;
end $$;
