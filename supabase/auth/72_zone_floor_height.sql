-- ==========================================
-- 72. 창고 배치도 구획의 바닥 높이 · 구획 회전 (components/Warehouse3D.js, services/warehouseZones.js)
-- ==========================================
-- 김포1공장 포장동(나동)의 한 구역을 1층·2층으로 나누면서 넣는다: 같은 자리에 구획 둘을 두고 2층 구획은 바닥 높이를 준다.
-- y: 구획 바닥 높이(m). 0 = 창고 바닥, 3.5 = 그 높이에 뜬 2층 바닥. 창고(kind WAREHOUSE) 줄은 0.
--   2026-10-02부터 창고 줄도 y를 쓴다: 층마다 창고코드가 다른 건물(도창동 본사 — 1층 본사1A · 2층 본사1B · 4층 본사1C)은
--   같은 자리에 창고를 층층이 놓고 위층 창고의 y에 그 층 바닥 높이(지면에서 잰 m)를 적는다. 그 안의 구획 y는 창고 바닥에서 잰 높이다(칸·제약은 그대로).
-- rot(71번에서 만든 칸)은 이제 구획도 쓴다: 구획의 (x, z) 모서리를 축으로 창고 기준에서 돌린 각도(도, 시계 방향)
--   — 창고동의 비스듬한 벽을 따라 놓인 파렛트랙. 값이 0이면 창고 벽과 나란하다.
-- 예전 앱이 저장해도 이 칸은 그대로 남는다(upsert는 보낸 칸만 바꾼다). 권한은 65·68번 그대로. 여러 번 실행해도 안전하다.
ALTER TABLE public.wms_warehouse_zones ADD COLUMN IF NOT EXISTS y numeric NOT NULL DEFAULT 0;
DO $$ BEGIN
    ALTER TABLE public.wms_warehouse_zones ADD CONSTRAINT wms_warehouse_zones_y_check CHECK (y >= 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
