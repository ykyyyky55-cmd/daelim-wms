-- ==========================================
-- 71. 창고 배치도 창고 모양: 돌아 앉은 각도 · 바닥 외곽선 (components/Warehouse3D.js, services/warehouseZones.js)
-- ==========================================
-- 김포1공장 배치도(건축물현황도)에 29° 돌아 앉은 동(다동)과 ㄱ자·계단 모양 동(가동·나동)이 있어 넣는다.
-- rot: 창고 왼쪽 위 모서리를 축으로 돌아 앉은 각도(도, 위에서 볼 때 시계 방향). 구획(kind ZONE)은 0 — 구획은 창고와 같이 돈다.
-- outline: 창고 바닥 외곽선 — 창고 왼쪽 위 모서리 기준 [x, z] m 점 목록(jsonb 배열). 비어 있으면 w × d 사각형.
-- 예전 앱(이 칸을 모르는 화면)이 저장해도 이 두 칸은 그대로 남는다(upsert는 보낸 칸만 바꾼다).
-- 권한은 65·68번 그대로(조회 VIEWER·경영자, 쓰기 MANAGER). 여러 번 실행해도 안전하다.
ALTER TABLE public.wms_warehouse_zones ADD COLUMN IF NOT EXISTS rot numeric NOT NULL DEFAULT 0;
ALTER TABLE public.wms_warehouse_zones ADD COLUMN IF NOT EXISTS outline jsonb NOT NULL DEFAULT '[]'::jsonb;
DO $$ BEGIN
    ALTER TABLE public.wms_warehouse_zones ADD CONSTRAINT wms_warehouse_zones_outline_array CHECK (jsonb_typeof(outline) = 'array');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
