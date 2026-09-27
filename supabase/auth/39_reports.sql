-- ==============================================================================
-- 월간 실적 현황판 → 보고서 (wms_reports)
-- ==============================================================================
-- 만들어진 보고서를 모아 두는 표. 한 줄 = 보고서 하나.
--   kind MEETING : 월례회의 자료 (id = MEETING-<회의 월>-<보기>, 같은 회의 월·보기로 다시 만들면 덮어씀)
--                  files = [{ path, name, mime, size, type: 'pptx' | 'html' }] — 파일은 비공개 버킷 wms-files 의 reports/<id>/…
--                  content = { resultYm, planYm, dept, author, date, sections }
--   kind DOC     : 검토 보고서 (content.html = 본문 HTML, 앱 안에서 열람·인쇄)
-- 권한: 조회 VIEWER 이상·경영자 / 저장·수정 MANAGER 이상 / 삭제 MANAGER 이상.
--       파일 올리기는 wms-files 버킷 규칙(OPERATOR 이상, 36_file_store.sql)을 따른다. 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_reports (
    id               text PRIMARY KEY,
    kind             text NOT NULL CHECK (kind IN ('MEETING', 'DOC')),
    title            text NOT NULL DEFAULT '',
    period           text DEFAULT '',
    scope            text DEFAULT '',
    summary          text DEFAULT '',
    content          jsonb NOT NULL DEFAULT '{}'::jsonb,
    files            jsonb NOT NULL DEFAULT '[]'::jsonb,
    created_by       uuid DEFAULT auth.uid(),
    created_by_name  text DEFAULT '',
    created_at       timestamptz DEFAULT now(),
    updated_by_name  text DEFAULT '',
    updated_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_reports_kind_period_idx ON public.wms_reports (kind, period DESC);

ALTER TABLE public.wms_reports ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_reports FROM anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_reports TO authenticated;

DROP POLICY IF EXISTS wms_reports_select ON public.wms_reports;
DROP POLICY IF EXISTS wms_reports_insert ON public.wms_reports;
DROP POLICY IF EXISTS wms_reports_update ON public.wms_reports;
DROP POLICY IF EXISTS wms_reports_delete ON public.wms_reports;
CREATE POLICY wms_reports_select ON public.wms_reports FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_reports_insert ON public.wms_reports FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('MANAGER')));
CREATE POLICY wms_reports_update ON public.wms_reports FOR UPDATE TO authenticated
    USING ((SELECT public.wms_has_role('MANAGER'))) WITH CHECK ((SELECT public.wms_has_role('MANAGER')));
CREATE POLICY wms_reports_delete ON public.wms_reports FOR DELETE TO authenticated
    USING ((SELECT public.wms_has_role('MANAGER')));
