-- ==========================================
-- 73. 창고 배치도 공장별 주변 표시 (평면도 편집기 components/warehouse3d/planEditor.js, services/warehouseZones.js)
-- ==========================================
-- 창고·구획이 아닌 것 — 참고 건물(사무실동)·바닥 표시(도로·출입구)·화살표·건물 부속·출입문·장비(지게차) — 은
-- 코드에 기본값(PLANT_EXTRAS)이 있고, 평면도 편집기에서 고쳐 저장하면 공장마다 한 줄(JSON)로 여기에 들어간다.
-- 줄이 없는 공장은 코드의 기본값을 쓴다. 재고 위치가 아니라 3D·평면도에 그리는 참고 표시일 뿐이다.
-- data = { buildings, doors, arrows, floorMarks, annexes, props, facilities, homeView, labelSide, floorHeight, boundaries }
--   (buildings의 y = 참고 건물의 바닥 높이 — 층으로 쌓은 건물에서 창고코드가 없는 층, 2026-10-02)
-- 권한: 조회 VIEWER·경영자, 쓰기 MANAGER (65·68번과 같음). 여러 번 실행해도 안전하다.
CREATE TABLE IF NOT EXISTS public.wms_plant_extras (
    id text PRIMARY KEY,                        -- 공장(캠프) 이름: 김포1공장 · 김포2공장 · 도창동 본사
    data jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_by_name text NOT NULL DEFAULT '',
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT wms_plant_extras_data_object CHECK (jsonb_typeof(data) = 'object')
);
ALTER TABLE public.wms_plant_extras ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wms_plant_extras_select ON public.wms_plant_extras;
DROP POLICY IF EXISTS wms_plant_extras_insert ON public.wms_plant_extras;
DROP POLICY IF EXISTS wms_plant_extras_update ON public.wms_plant_extras;
DROP POLICY IF EXISTS wms_plant_extras_delete ON public.wms_plant_extras;
CREATE POLICY wms_plant_extras_select ON public.wms_plant_extras FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_plant_extras_insert ON public.wms_plant_extras FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('MANAGER')));
CREATE POLICY wms_plant_extras_update ON public.wms_plant_extras FOR UPDATE TO authenticated
    USING ((SELECT public.wms_has_role('MANAGER'))) WITH CHECK ((SELECT public.wms_has_role('MANAGER')));
CREATE POLICY wms_plant_extras_delete ON public.wms_plant_extras FOR DELETE TO authenticated
    USING ((SELECT public.wms_has_role('MANAGER')));
