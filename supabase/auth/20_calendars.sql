-- ==============================================================================
-- 캘린더 개편: 본사 / 김포 / 개인 캘린더, 시간, 첨부 파일, 전표 연결
-- ==============================================================================
-- wms_schedules
--   calendar     : 'HQ'(본사) · 'GIMPO'(김포) · 'PERSONAL'(개인). 통합 캘린더 = 본사 + 김포 + 내 개인 일정
--   owner        : 개인 일정 주인 (auth.uid()). 개인 일정은 주인만 보고 고친다.
--   start_time / end_time : 'HH:MM' (비우면 종일)
--   attachments  : [{ name, path, type, size }]  파일은 Storage 버킷 wms-calendar (비공개)
--   slip_nos     : 연결한 WMS 전표번호 (TR-/RQ-/WT-…)
-- Storage 버킷 wms-calendar: 조회 VIEWER 이상, 올리기·지우기 OPERATOR 이상 (파일당 10MB)
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

ALTER TABLE public.wms_schedules ADD COLUMN IF NOT EXISTS calendar TEXT NOT NULL DEFAULT 'HQ';
ALTER TABLE public.wms_schedules ADD COLUMN IF NOT EXISTS owner UUID DEFAULT auth.uid();
ALTER TABLE public.wms_schedules ADD COLUMN IF NOT EXISTS owner_name TEXT;
ALTER TABLE public.wms_schedules ADD COLUMN IF NOT EXISTS start_time TEXT;
ALTER TABLE public.wms_schedules ADD COLUMN IF NOT EXISTS end_time TEXT;
ALTER TABLE public.wms_schedules ADD COLUMN IF NOT EXISTS attachments JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE public.wms_schedules ADD COLUMN IF NOT EXISTS slip_nos TEXT[];
ALTER TABLE public.wms_schedules DROP CONSTRAINT IF EXISTS wms_schedules_calendar_check;
ALTER TABLE public.wms_schedules ADD CONSTRAINT wms_schedules_calendar_check CHECK (calendar IN ('HQ', 'GIMPO', 'PERSONAL'));
CREATE INDEX IF NOT EXISTS idx_wms_schedules_cal_date ON public.wms_schedules (calendar, schedule_date);

-- 개인 일정은 주인만 (역할과 무관하게 로그인 사용자는 자기 개인 일정을 쓸 수 있다)
DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wms_schedules' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.wms_schedules', p.policyname);
    END LOOP;
END $$;

CREATE POLICY "wms_schedules_select" ON public.wms_schedules FOR SELECT TO authenticated
    USING (CASE WHEN calendar = 'PERSONAL' THEN owner = auth.uid() AND public.wms_has_role('VIEWER') ELSE public.wms_has_role('VIEWER') END);
CREATE POLICY "wms_schedules_insert" ON public.wms_schedules FOR INSERT TO authenticated
    WITH CHECK (CASE WHEN calendar = 'PERSONAL' THEN owner = auth.uid() AND public.wms_has_role('VIEWER') ELSE public.wms_has_role('OPERATOR') END);
CREATE POLICY "wms_schedules_update" ON public.wms_schedules FOR UPDATE TO authenticated
    USING (CASE WHEN calendar = 'PERSONAL' THEN owner = auth.uid() ELSE public.wms_has_role('OPERATOR') END)
    WITH CHECK (CASE WHEN calendar = 'PERSONAL' THEN owner = auth.uid() AND public.wms_has_role('VIEWER') ELSE public.wms_has_role('OPERATOR') END);
CREATE POLICY "wms_schedules_delete" ON public.wms_schedules FOR DELETE TO authenticated
    USING (CASE WHEN calendar = 'PERSONAL' THEN owner = auth.uid() ELSE public.wms_has_role('OPERATOR') END);

-- 첨부 파일 버킷 (비공개)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('wms-calendar', 'wms-calendar', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

DROP POLICY IF EXISTS "wms_calendar_files_select" ON storage.objects;
DROP POLICY IF EXISTS "wms_calendar_files_insert" ON storage.objects;
DROP POLICY IF EXISTS "wms_calendar_files_delete" ON storage.objects;
CREATE POLICY "wms_calendar_files_select" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'wms-calendar' AND public.wms_has_role('VIEWER'));
CREATE POLICY "wms_calendar_files_insert" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'wms-calendar' AND public.wms_has_role('VIEWER'));
CREATE POLICY "wms_calendar_files_delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'wms-calendar' AND (owner = auth.uid() OR public.wms_has_role('MANAGER')));
