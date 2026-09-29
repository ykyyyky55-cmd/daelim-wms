-- ==============================================================================
-- 61. 아침 알림 요약 (services/morningDigest.js, 종합현황판의 '확인할 일'을 매일 아침 한 번 보냄)
-- ==============================================================================
-- wms_notify_config  설정 (id 'MORNING': 사용 여부·시각·받는 사람·전체 대화방) — 조회 현장 작업자 이상, 저장 매니저 이상
-- wms_notify_log     보낸 기록 (id 'MORNING:<날짜>' — 하루 한 번만: 먼저 넣은 기기가 보낸다) — 조회·기록 현장 작업자 이상
-- wms_notify_secret  구글 챗 웹훅 주소 (비밀) — 사용자 정책 없음(RLS만 켬). 앱은 아래 함수로 저장·설정 여부만 알 수 있고,
--                    보내기는 Edge Function gchat-notify(서비스 키)가 읽어 구글 챗으로 보낸다.
-- ==============================================================================
CREATE TABLE IF NOT EXISTS public.wms_notify_config (
    id TEXT PRIMARY KEY,
    data JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ DEFAULT now(),
    updated_by TEXT
);
ALTER TABLE public.wms_notify_config ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_notify_config_select ON public.wms_notify_config;
CREATE POLICY wms_notify_config_select ON public.wms_notify_config FOR SELECT USING ((SELECT public.wms_has_role('OPERATOR')));
DROP POLICY IF EXISTS wms_notify_config_insert ON public.wms_notify_config;
CREATE POLICY wms_notify_config_insert ON public.wms_notify_config FOR INSERT WITH CHECK ((SELECT public.wms_has_role('MANAGER')));
DROP POLICY IF EXISTS wms_notify_config_update ON public.wms_notify_config;
CREATE POLICY wms_notify_config_update ON public.wms_notify_config FOR UPDATE USING ((SELECT public.wms_has_role('MANAGER'))) WITH CHECK ((SELECT public.wms_has_role('MANAGER')));

CREATE TABLE IF NOT EXISTS public.wms_notify_log (
    id TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    sent_at TIMESTAMPTZ DEFAULT now(),
    sent_by UUID DEFAULT auth.uid(),
    sent_by_name TEXT,
    summary JSONB NOT NULL DEFAULT '{}'::jsonb
);
ALTER TABLE public.wms_notify_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_notify_log_select ON public.wms_notify_log;
CREATE POLICY wms_notify_log_select ON public.wms_notify_log FOR SELECT USING ((SELECT public.wms_has_role('OPERATOR')));
DROP POLICY IF EXISTS wms_notify_log_insert ON public.wms_notify_log;
CREATE POLICY wms_notify_log_insert ON public.wms_notify_log FOR INSERT WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
DROP POLICY IF EXISTS wms_notify_log_update ON public.wms_notify_log;
CREATE POLICY wms_notify_log_update ON public.wms_notify_log FOR UPDATE USING ((SELECT public.wms_has_role('OPERATOR'))) WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));

CREATE TABLE IF NOT EXISTS public.wms_notify_secret (
    id TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT now()
);
ALTER TABLE public.wms_notify_secret ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_notify_secret FROM anon, authenticated;

-- 구글 챗 웹훅 저장 (매니저 이상, https://chat.googleapis.com/ 주소만). 빈 값이면 지운다.
CREATE OR REPLACE FUNCTION public.wms_set_gchat_webhook(p_url TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF NOT public.wms_has_role('MANAGER') THEN RAISE EXCEPTION '매니저 이상만 설정할 수 있습니다.'; END IF;
    IF p_url IS NULL OR btrim(p_url) = '' THEN
        DELETE FROM public.wms_notify_secret WHERE id = 'GCHAT_WEBHOOK';
        RETURN FALSE;
    END IF;
    IF btrim(p_url) !~ '^https://chat\.googleapis\.com/' THEN RAISE EXCEPTION '구글 챗 웹훅 주소(https://chat.googleapis.com/...)만 저장할 수 있습니다.'; END IF;
    INSERT INTO public.wms_notify_secret (id, value, updated_at) VALUES ('GCHAT_WEBHOOK', btrim(p_url), now())
    ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.wms_set_gchat_webhook(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_set_gchat_webhook(TEXT) TO authenticated;

-- 웹훅이 설정돼 있는지만 알려 준다 (주소는 돌려주지 않음)
CREATE OR REPLACE FUNCTION public.wms_gchat_webhook_set()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT public.wms_has_role('OPERATOR') AND EXISTS (SELECT 1 FROM public.wms_notify_secret WHERE id = 'GCHAT_WEBHOOK');
$$;
REVOKE ALL ON FUNCTION public.wms_gchat_webhook_set() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_gchat_webhook_set() TO authenticated;
