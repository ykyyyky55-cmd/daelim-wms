-- ==============================================================================
-- 59. 업무일지 → 구글 시트 보내기 설정 (services/worklogSheets.js, 앱 업무일지 [구글 시트로 보내기])
-- ==============================================================================
-- 구글 Apps Script 웹 앱(public/tools/worklog-sheets.gs)을 회사 구글 계정에 배포하고,
-- 그 주소·토큰과 거점별 기준 시트(처음 한 번, 이번 달 업무일지 구글 시트) 링크를 여기에 둔다.
-- 토큰은 웹 앱을 아무나 부르지 못하게 하는 값이라 조회도 현장 작업자(OPERATOR) 이상만, 바꾸기는 MANAGER 이상.
-- 거점별 월 파일(시트 ID)은 Apps Script의 스크립트 속성(FILE_<HQ|GIMPO>_<YYYY-MM>)에 스크립트가 직접 기억한다.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.wms_worklog_sheet_config (
    id          TEXT PRIMARY KEY DEFAULT 'default',
    script_url  TEXT NOT NULL DEFAULT '',
    token       TEXT NOT NULL DEFAULT '',
    seeds       JSONB NOT NULL DEFAULT '{}'::jsonb,   -- { HQ: 구글 시트 링크, GIMPO: 구글 시트 링크 }
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by  TEXT NOT NULL DEFAULT ''
);

ALTER TABLE public.wms_worklog_sheet_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_worklog_sheet_config_select ON public.wms_worklog_sheet_config;
CREATE POLICY wms_worklog_sheet_config_select ON public.wms_worklog_sheet_config FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('OPERATOR')));
DROP POLICY IF EXISTS wms_worklog_sheet_config_insert ON public.wms_worklog_sheet_config;
CREATE POLICY wms_worklog_sheet_config_insert ON public.wms_worklog_sheet_config FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('MANAGER')));
DROP POLICY IF EXISTS wms_worklog_sheet_config_update ON public.wms_worklog_sheet_config;
CREATE POLICY wms_worklog_sheet_config_update ON public.wms_worklog_sheet_config FOR UPDATE TO authenticated
    USING ((SELECT public.wms_has_role('MANAGER'))) WITH CHECK ((SELECT public.wms_has_role('MANAGER')));
