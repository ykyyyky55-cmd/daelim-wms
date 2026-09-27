-- ==========================================
-- 35. 품목 약칭(별칭) → 품목코드 매핑
-- ==========================================
-- 업무일지(특히 본사 이동 줄)에 적는 약칭('카밈PRO+D', 'D40 공토트' 등)을 품목코드에 연결한다.
-- 앱은 본사 이동 반영(strictMasterMatch)과 업무일지 품목 매칭(getOrCreateMasterItem)에서 이 표를 먼저 찾는다.
-- alias_key: 약칭을 소문자로 바꾸고 공백·기호를 뺀 값 (앱의 normItemName과 같은 규칙) — 같은 약칭은 하나의 코드만.
-- 조회는 모두(VIEWER), 추가·수정·삭제는 MANAGER 이상.
CREATE TABLE IF NOT EXISTS public.wms_item_aliases (
    alias_key   text PRIMARY KEY,
    alias       text NOT NULL,
    code        text NOT NULL,
    note        text DEFAULT '',
    updated_by  uuid DEFAULT auth.uid(),
    updated_at  timestamptz DEFAULT now()
);

ALTER TABLE public.wms_item_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS wms_item_aliases_select ON public.wms_item_aliases;
DROP POLICY IF EXISTS wms_item_aliases_insert ON public.wms_item_aliases;
DROP POLICY IF EXISTS wms_item_aliases_update ON public.wms_item_aliases;
DROP POLICY IF EXISTS wms_item_aliases_delete ON public.wms_item_aliases;
CREATE POLICY wms_item_aliases_select ON public.wms_item_aliases FOR SELECT TO authenticated USING ((SELECT public.wms_has_role('VIEWER')));
CREATE POLICY wms_item_aliases_insert ON public.wms_item_aliases FOR INSERT TO authenticated WITH CHECK ((SELECT public.wms_has_role('MANAGER')));
CREATE POLICY wms_item_aliases_update ON public.wms_item_aliases FOR UPDATE TO authenticated USING ((SELECT public.wms_has_role('MANAGER'))) WITH CHECK ((SELECT public.wms_has_role('MANAGER')));
CREATE POLICY wms_item_aliases_delete ON public.wms_item_aliases FOR DELETE TO authenticated USING ((SELECT public.wms_has_role('MANAGER')));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_item_aliases TO authenticated;
