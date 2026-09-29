-- ==============================================================================
-- 55. 구글 챗 받은함 실시간 (메시지 접수 알림)
-- ==============================================================================
-- 구글 챗에서 WMS 앱을 @멘션해 보낸 '[제품 생산 요청]' 같은 양식 메시지가 wms_chat_inbox에 들어오면
-- 접속한 사람의 앱(FloatingTools · services/msgIntake.js)이 바로 알림 카드를 띄우고 등록 화면으로 보낸다.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_publication_tables WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'wms_chat_inbox') THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.wms_chat_inbox;
    END IF;
END $$;
