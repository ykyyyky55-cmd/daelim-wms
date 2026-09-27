-- ==========================================
-- 37. 포장작업표준서 (메뉴 생산업무 → 포장작업표준서, public/pack-standard/index.html)
-- ==========================================
-- 표준서 편집기(원래 단독 HTML)가 브라우저 localStorage에만 저장하던 문서를 회사 DB에 둔다.
-- content: { a4Html, historyHtml } — 편집기 화면 그대로(사진은 dataURL, 편집기가 긴 변 1400px JPEG로 줄여 넣음)
-- 권한: 조회 VIEWER·경영자 / 작성·수정·삭제 MANAGER 이상
CREATE TABLE IF NOT EXISTS public.wms_pack_standards (
    id               text PRIMARY KEY,
    title            text NOT NULL DEFAULT '',
    product          text NOT NULL DEFAULT '',
    buyer            text DEFAULT '',
    category         text DEFAULT '',
    content          jsonb NOT NULL DEFAULT '{}'::jsonb,
    updated_by       uuid DEFAULT auth.uid(),
    updated_by_name  text DEFAULT '',
    created_at       timestamptz DEFAULT now(),
    updated_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_pack_standards_updated_idx ON public.wms_pack_standards (updated_at DESC);

ALTER TABLE public.wms_pack_standards ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_pack_standards_select ON public.wms_pack_standards;
DROP POLICY IF EXISTS wms_pack_standards_insert ON public.wms_pack_standards;
DROP POLICY IF EXISTS wms_pack_standards_update ON public.wms_pack_standards;
DROP POLICY IF EXISTS wms_pack_standards_delete ON public.wms_pack_standards;
CREATE POLICY wms_pack_standards_select ON public.wms_pack_standards FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_pack_standards_insert ON public.wms_pack_standards FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('MANAGER')));
CREATE POLICY wms_pack_standards_update ON public.wms_pack_standards FOR UPDATE TO authenticated
    USING ((SELECT public.wms_has_role('MANAGER'))) WITH CHECK ((SELECT public.wms_has_role('MANAGER')));
CREATE POLICY wms_pack_standards_delete ON public.wms_pack_standards FOR DELETE TO authenticated
    USING ((SELECT public.wms_has_role('MANAGER')));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_pack_standards TO authenticated;
