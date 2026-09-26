-- ==============================================================================
-- 구글 챗 → 일정 받은함 (wms_chat_inbox)
-- ==============================================================================
-- 구글 챗 앱(Edge Function google-chat-webhook)이 스페이스에서 받은 메시지를 그대로 쌓는다.
-- 앱의 수불·입출고 캘린더에서 사람이 확인·수정해 일정(wms_schedules)으로 등록하거나 무시한다.
-- 쓰기(INSERT)는 Edge Function(서비스 키)만 한다. 로그인 사용자는 조회·처리(UPDATE)만.
-- 규칙: 조회·처리 OPERATOR 이상, 삭제 MANAGER 이상, 익명 차단. 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_chat_inbox (
    id TEXT PRIMARY KEY,                        -- 구글 챗 메시지 이름 (spaces/…/messages/…), 중복 수신 방지
    space_name TEXT,
    space_title TEXT,
    sender_name TEXT,
    sender_email TEXT,
    text TEXT NOT NULL,
    sent_at TIMESTAMPTZ,
    received_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    status TEXT NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'DONE', 'IGNORED')),
    schedule_ids TEXT[],                        -- 이 메시지로 등록한 일정 id
    handled_by UUID,
    handled_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_wms_chat_inbox_status ON public.wms_chat_inbox (status, received_at DESC);

ALTER TABLE public.wms_chat_inbox ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_chat_inbox FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER, INSERT ON public.wms_chat_inbox FROM authenticated;
GRANT SELECT, UPDATE, DELETE ON public.wms_chat_inbox TO authenticated;

DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wms_chat_inbox' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.wms_chat_inbox', p.policyname);
    END LOOP;
END $$;

CREATE POLICY "wms_chat_inbox_select" ON public.wms_chat_inbox
    FOR SELECT TO authenticated USING (public.wms_has_role('OPERATOR'));
CREATE POLICY "wms_chat_inbox_update" ON public.wms_chat_inbox
    FOR UPDATE TO authenticated USING (public.wms_has_role('OPERATOR')) WITH CHECK (public.wms_has_role('OPERATOR'));
CREATE POLICY "wms_chat_inbox_delete" ON public.wms_chat_inbox
    FOR DELETE TO authenticated USING (public.wms_has_role('MANAGER'));
