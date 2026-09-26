-- ==============================================================================
-- 팝업 할일 메모장 + 접속자 채팅 (파일 첨부)
-- ==============================================================================
-- wms_todos          : 내 할일 메모. 주인(owner = auth.uid())만 보고 고친다.
-- wms_chat_messages  : 채팅 메시지. room = 'ALL'(전체 대화) 또는 'dm_<uuid>_<uuid>'(1:1, uuid 정렬).
--                      전체 대화는 VIEWER 이상 모두, 1:1은 방 이름에 내 uuid가 있는 사람만 본다.
--                      realtime publication에 넣어 새 메시지를 바로 받는다(구독도 RLS를 따른다).
-- wms_chat_users()   : 채팅 상대 목록(승인된 사용자 이름·부서). 프로필 표는 MANAGER 이상만 보므로 함수로 준다.
-- Storage 버킷 wms-chat (비공개, 파일당 10MB): 경로 첫 폴더가 방 이름. 방을 볼 수 있는 사람만 읽는다.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_todos (
    id TEXT PRIMARY KEY,
    owner UUID NOT NULL DEFAULT auth.uid(),
    text TEXT NOT NULL,
    done BOOLEAN NOT NULL DEFAULT false,
    due_date DATE,
    starred BOOLEAN NOT NULL DEFAULT false,
    sort_order INTEGER NOT NULL DEFAULT 0,
    done_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wms_todos_owner ON public.wms_todos (owner, done, sort_order);
ALTER TABLE public.wms_todos ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "wms_todos_owner" ON public.wms_todos;
CREATE POLICY "wms_todos_owner" ON public.wms_todos FOR ALL TO authenticated
    USING (owner = auth.uid() AND public.wms_has_role('VIEWER'))
    WITH CHECK (owner = auth.uid() AND public.wms_has_role('VIEWER'));

CREATE TABLE IF NOT EXISTS public.wms_chat_messages (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room TEXT NOT NULL DEFAULT 'ALL',
    sender UUID NOT NULL DEFAULT auth.uid(),
    sender_name TEXT,
    body TEXT NOT NULL DEFAULT '',
    attachments JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT wms_chat_room_check CHECK (room = 'ALL' OR room ~ '^dm_[0-9a-f-]{36}_[0-9a-f-]{36}$'),
    CONSTRAINT wms_chat_body_len CHECK (char_length(body) <= 4000)
);
CREATE INDEX IF NOT EXISTS idx_wms_chat_room_time ON public.wms_chat_messages (room, created_at DESC);
ALTER TABLE public.wms_chat_messages ENABLE ROW LEVEL SECURITY;

-- 그 방을 볼 수 있는지: 전체 대화 또는 방 이름에 내 uuid
CREATE OR REPLACE FUNCTION public.wms_chat_can_see(p_room TEXT)
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY INVOKER SET search_path = public
AS $$
    SELECT public.wms_has_role('VIEWER')
       AND (p_room = 'ALL' OR (p_room LIKE 'dm\_%' AND position(auth.uid()::text IN p_room) > 0));
$$;

DROP POLICY IF EXISTS "wms_chat_select" ON public.wms_chat_messages;
DROP POLICY IF EXISTS "wms_chat_insert" ON public.wms_chat_messages;
DROP POLICY IF EXISTS "wms_chat_delete" ON public.wms_chat_messages;
CREATE POLICY "wms_chat_select" ON public.wms_chat_messages FOR SELECT TO authenticated
    USING (public.wms_chat_can_see(room));
CREATE POLICY "wms_chat_insert" ON public.wms_chat_messages FOR INSERT TO authenticated
    WITH CHECK (sender = auth.uid() AND public.wms_chat_can_see(room));
CREATE POLICY "wms_chat_delete" ON public.wms_chat_messages FOR DELETE TO authenticated
    USING (sender = auth.uid() OR public.wms_has_role('ADMIN'));

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wms_chat_messages') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.wms_chat_messages;
    END IF;
END $$;
-- DELETE 이벤트에도 id가 오도록
ALTER TABLE public.wms_chat_messages REPLICA IDENTITY FULL;

-- 채팅 상대 목록 (승인된 사용자)
CREATE OR REPLACE FUNCTION public.wms_chat_users()
RETURNS TABLE (id UUID, name TEXT, dept TEXT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT p.id, COALESCE(NULLIF(p.name, ''), split_part(p.email, '@', 1)), COALESCE(p.dept, '')
    FROM public.wms_profiles p
    WHERE public.wms_has_role('VIEWER')
      AND (p.role IS DISTINCT FROM 'PENDING'
           -- 마스터는 역할 칸이 아니라 master_email로 정해진다
           OR lower(p.email) = (SELECT lower(s.master_email) FROM public.wms_app_settings s LIMIT 1))
    ORDER BY 2;
$$;
REVOKE ALL ON FUNCTION public.wms_chat_users() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_chat_users() TO authenticated;

-- 첨부 파일 버킷 (비공개)
INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('wms-chat', 'wms-chat', false, 10485760)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = 10485760;

DROP POLICY IF EXISTS "wms_chat_files_select" ON storage.objects;
DROP POLICY IF EXISTS "wms_chat_files_insert" ON storage.objects;
DROP POLICY IF EXISTS "wms_chat_files_delete" ON storage.objects;
CREATE POLICY "wms_chat_files_select" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'wms-chat' AND public.wms_chat_can_see((storage.foldername(name))[1]));
CREATE POLICY "wms_chat_files_insert" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'wms-chat' AND public.wms_chat_can_see((storage.foldername(name))[1]));
CREATE POLICY "wms_chat_files_delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'wms-chat' AND (owner = auth.uid() OR public.wms_has_role('ADMIN')));
