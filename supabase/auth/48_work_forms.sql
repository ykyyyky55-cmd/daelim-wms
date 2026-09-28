-- ==========================================
-- 48. 생산 작업 양식: 초·중·종물 검사 및 작업일지 · 포장수율표 (메뉴 생산업무)
-- ==========================================
-- wms_work_forms 한 줄 = 한 날짜·한 작업장(site)의 양식 한 장. 내용은 data JSONB (앱 services/workForms.js)
--   kind INSPECT_LOG : 초·중·종물 검사 및 작업일지 (라인·작업자·제품·원액 LOT·비중·기준중량·중량 3회×3단계·상태·제품 LOT·양품/불량)
--   kind YIELD       : 포장수율표 (작업조건 온습도, 포장 공정별 시간·인원, 라벨작업, 기타작업)
-- 권한: 조회 VIEWER·경영자 / 작성·수정 OPERATOR 이상 / 삭제 쓴 사람 또는 MANAGER 이상

CREATE TABLE IF NOT EXISTS public.wms_work_forms (
    id              text PRIMARY KEY,
    kind            text NOT NULL CHECK (kind IN ('INSPECT_LOG', 'YIELD')),
    site            text NOT NULL DEFAULT '',
    form_date       date NOT NULL,
    data            jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_by      uuid DEFAULT auth.uid(),
    created_by_name text DEFAULT '',
    created_at      timestamptz DEFAULT now(),
    updated_at      timestamptz DEFAULT now(),
    UNIQUE (kind, site, form_date)
);
CREATE INDEX IF NOT EXISTS wms_work_forms_kind_date_idx ON public.wms_work_forms (kind, form_date DESC);

ALTER TABLE public.wms_work_forms ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_work_forms_select ON public.wms_work_forms;
DROP POLICY IF EXISTS wms_work_forms_insert ON public.wms_work_forms;
DROP POLICY IF EXISTS wms_work_forms_update ON public.wms_work_forms;
DROP POLICY IF EXISTS wms_work_forms_delete ON public.wms_work_forms;
CREATE POLICY wms_work_forms_select ON public.wms_work_forms FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_work_forms_insert ON public.wms_work_forms FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
CREATE POLICY wms_work_forms_update ON public.wms_work_forms FOR UPDATE TO authenticated
    USING ((SELECT public.wms_has_role('OPERATOR'))) WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
CREATE POLICY wms_work_forms_delete ON public.wms_work_forms FOR DELETE TO authenticated
    USING (created_by = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER')));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_work_forms TO authenticated;
