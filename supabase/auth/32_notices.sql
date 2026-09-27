-- ==============================================================================
-- 지원 → 공지사항
-- ==============================================================================
-- wms_notices : 공지 한 건 = 한 줄 (지우기 전까지 누적 보관)
--   조회: 승인된 사용자 모두(VIEWER 이상) / 등록: 매니저 이상 / 수정: 쓴 사람 또는 관리자(ADMIN) 이상 / 삭제: 관리자(ADMIN) 이상
-- realtime publication에 넣어, 새 공지가 올라오면 접속한 모든 사람의 앱이 바로 알림을 띄운다.
-- 등록할 때 앱이 전체 대화(채팅 ALL)에도 공지 메시지를 보낸다.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_notices (
    id          TEXT PRIMARY KEY,
    title       TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
    body        TEXT NOT NULL DEFAULT '' CHECK (char_length(body) <= 10000),
    important   BOOLEAN NOT NULL DEFAULT false,
    pinned      BOOLEAN NOT NULL DEFAULT false,
    author      UUID DEFAULT auth.uid(),
    author_name TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wms_notices_created ON public.wms_notices (created_at DESC);
ALTER TABLE public.wms_notices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wms_notices_select" ON public.wms_notices;
DROP POLICY IF EXISTS "wms_notices_insert" ON public.wms_notices;
DROP POLICY IF EXISTS "wms_notices_update" ON public.wms_notices;
DROP POLICY IF EXISTS "wms_notices_delete" ON public.wms_notices;
CREATE POLICY "wms_notices_select" ON public.wms_notices FOR SELECT TO authenticated
    USING (public.wms_has_role('VIEWER'));
CREATE POLICY "wms_notices_insert" ON public.wms_notices FOR INSERT TO authenticated
    WITH CHECK (public.wms_has_role('MANAGER') AND author = auth.uid());
CREATE POLICY "wms_notices_update" ON public.wms_notices FOR UPDATE TO authenticated
    USING ((author = auth.uid() AND public.wms_has_role('MANAGER')) OR public.wms_has_role('ADMIN'))
    WITH CHECK ((author = auth.uid() AND public.wms_has_role('MANAGER')) OR public.wms_has_role('ADMIN'));
CREATE POLICY "wms_notices_delete" ON public.wms_notices FOR DELETE TO authenticated
    USING (public.wms_has_role('ADMIN'));

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wms_notices') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.wms_notices;
    END IF;
END $$;
ALTER TABLE public.wms_notices REPLICA IDENTITY FULL;
