-- ==========================================
-- 62. 의견·개선 요청 접수함 (지원 → 의견·개선 요청, components/FeedbackBoard.js, services/feedback.js)
-- ==========================================
-- 어느 화면에서든 [💡 의견]으로 화면 캡처·설명을 접수 → 상태(접수→검토→개발 중→반영 완료→배포 완료)를 관리하고
-- 처리 상태가 바뀌면 처리자의 앱이 요청자에게 1:1 메시지를 보낸다.
-- 권한: 조회 = 승인된 사용자 모두(VIEWER·경영자), 등록 = 같음(본인 이름으로),
--       처리(상태·답변·우선순위·배포 버전) = MANAGER 이상, 본인은 '접수' 상태일 때 제목·내용만 고침,
--       삭제 = 본인('접수' 상태) 또는 ADMIN.
-- 첨부(화면 캡처·사진·파일)는 버킷 wms-files 의 feedback/<id>/… (조회 전용 사용자도 올릴 수 있게 정책 추가)

CREATE TABLE IF NOT EXISTS public.wms_feedback (
    id text PRIMARY KEY,
    reg_no text UNIQUE,
    kind text NOT NULL DEFAULT 'IMPROVE' CHECK (kind IN ('BUG', 'IMPROVE', 'NEW', 'QUESTION')),
    title text NOT NULL,
    body text NOT NULL DEFAULT '',
    tab text NOT NULL DEFAULT '',
    tab_label text NOT NULL DEFAULT '',
    app_version text NOT NULL DEFAULT '',
    device text NOT NULL DEFAULT '',
    files jsonb NOT NULL DEFAULT '[]'::jsonb,
    status text NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'ACCEPTED', 'WORK', 'DONE', 'DEPLOYED', 'HOLD', 'REJECTED')),
    priority text NOT NULL DEFAULT 'NORMAL' CHECK (priority IN ('HIGH', 'NORMAL', 'LOW')),
    reply text NOT NULL DEFAULT '',
    handler_name text NOT NULL DEFAULT '',
    deployed_version text NOT NULL DEFAULT '',
    history jsonb NOT NULL DEFAULT '[]'::jsonb,   -- [{ at, by, status, note }]
    created_by uuid DEFAULT auth.uid(),
    created_by_name text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_feedback_created_idx ON public.wms_feedback (created_at DESC);
ALTER TABLE public.wms_feedback ENABLE ROW LEVEL SECURITY;

-- 등록번호 의견-YYYY-0001, 작성자 = 로그인 계정
CREATE OR REPLACE FUNCTION public.wms_feedback_before_insert() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
    y text := to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY');
    n int;
BEGIN
    NEW.created_by := auth.uid();
    NEW.status := 'NEW';
    NEW.reply := ''; NEW.handler_name := ''; NEW.deployed_version := ''; NEW.priority := 'NORMAL';
    PERFORM pg_advisory_xact_lock(hashtext('wms_feedback_reg_no'));
    SELECT coalesce(max(substring(reg_no FROM '(\d+)$')::int), 0) + 1 INTO n
      FROM public.wms_feedback WHERE reg_no LIKE '의견-' || y || '-%';
    NEW.reg_no := '의견-' || y || '-' || lpad(n::text, 4, '0');
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wms_feedback_before_insert ON public.wms_feedback;
CREATE TRIGGER wms_feedback_before_insert BEFORE INSERT ON public.wms_feedback
FOR EACH ROW EXECUTE FUNCTION public.wms_feedback_before_insert();

-- 매니저 미만은 처리 칸을 바꿀 수 없다 (본인 글의 제목·내용·종류·첨부만)
CREATE OR REPLACE FUNCTION public.wms_feedback_before_update() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
    IF NOT public.wms_has_role('MANAGER') THEN
        NEW.status := OLD.status; NEW.reply := OLD.reply; NEW.handler_name := OLD.handler_name;
        NEW.deployed_version := OLD.deployed_version; NEW.priority := OLD.priority; NEW.history := OLD.history;
    END IF;
    NEW.id := OLD.id; NEW.reg_no := OLD.reg_no; NEW.created_by := OLD.created_by;
    NEW.created_by_name := OLD.created_by_name; NEW.created_at := OLD.created_at;
    NEW.updated_at := now();
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wms_feedback_before_update ON public.wms_feedback;
CREATE TRIGGER wms_feedback_before_update BEFORE UPDATE ON public.wms_feedback
FOR EACH ROW EXECUTE FUNCTION public.wms_feedback_before_update();

DROP POLICY IF EXISTS wms_feedback_select ON public.wms_feedback;
DROP POLICY IF EXISTS wms_feedback_insert ON public.wms_feedback;
DROP POLICY IF EXISTS wms_feedback_update ON public.wms_feedback;
DROP POLICY IF EXISTS wms_feedback_delete ON public.wms_feedback;
CREATE POLICY wms_feedback_select ON public.wms_feedback FOR SELECT TO authenticated
USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_feedback_insert ON public.wms_feedback FOR INSERT TO authenticated
WITH CHECK ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_feedback_update ON public.wms_feedback FOR UPDATE TO authenticated
USING ((SELECT public.wms_has_role('MANAGER')) OR (created_by = (SELECT auth.uid()) AND status = 'NEW'))
WITH CHECK ((SELECT public.wms_has_role('MANAGER')) OR created_by = (SELECT auth.uid()));
CREATE POLICY wms_feedback_delete ON public.wms_feedback FOR DELETE TO authenticated
USING ((SELECT public.wms_has_role('ADMIN')) OR (created_by = (SELECT auth.uid()) AND status = 'NEW'));

-- 첨부: 조회 전용·경영자도 feedback/ 폴더에는 올릴 수 있게 (나머지 경로는 36번 정책 그대로 OPERATOR 이상)
DROP POLICY IF EXISTS "wms_files_insert_feedback" ON storage.objects;
CREATE POLICY "wms_files_insert_feedback" ON storage.objects FOR INSERT TO authenticated
WITH CHECK (bucket_id = 'wms-files' AND (storage.foldername(name))[1] = 'feedback'
            AND ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive())));
