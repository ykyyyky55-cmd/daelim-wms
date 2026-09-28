-- ==========================================
-- 47. 결재 문서 첨언 · 반려 · 참조/공유자는 검토·첨언만
-- ==========================================
-- wms_approval_comments : 문서(doc_key)마다 첨언 기록. kind COMMENT(첨언) · REJECT(반려 사유) · RESUBMIT(재상신)
--   첨언은 승인된 사용자 모두(조회 전용·경영자 포함, 참조·공유받은 사람도) 쓸 수 있고, 쓴 사람만 지운다.
--   작성자 id·이름은 트리거가 로그인 계정으로 채운다(다른 이름으로 못 씀). 반려·재상신 기록은 함수로만 남는다.
-- wms_approvals.status / rejected : 반려 상태('REJECTED')와 반려자·사유·시각. 반려된 문서는 재상신 전까지 서명할 수 없다.
-- 참조(cc)·공유(shares)로만 받은 사람(수신이 아닌)은 결재 서명·반려를 할 수 없고 검토·첨언만 한다 (wms_sign · wms_reject가 막음).

ALTER TABLE public.wms_approvals
    ADD COLUMN IF NOT EXISTS status   text NOT NULL DEFAULT '',
    ADD COLUMN IF NOT EXISTS rejected jsonb;

CREATE TABLE IF NOT EXISTS public.wms_approval_comments (
    id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_key    text NOT NULL,
    kind       text NOT NULL DEFAULT 'COMMENT' CHECK (kind IN ('COMMENT', 'REJECT', 'RESUBMIT')),
    body       text NOT NULL DEFAULT '' CHECK (length(body) <= 2000),
    uid        uuid DEFAULT auth.uid(),
    name       text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_approval_comments_key_idx ON public.wms_approval_comments (doc_key, created_at);

-- 작성자는 로그인 계정으로 고정
CREATE OR REPLACE FUNCTION public.wms_approval_comments_author()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
    IF auth.uid() IS NOT NULL THEN
        NEW.uid := auth.uid();
        SELECT coalesce(nullif(p.name, ''), split_part(p.email, '@', 1)) INTO NEW.name FROM public.wms_profiles p WHERE p.id = auth.uid();
        NEW.name := coalesce(NEW.name, '');
    END IF;
    NEW.created_at := now();
    RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.wms_approval_comments_author() FROM PUBLIC, anon, authenticated;
DROP TRIGGER IF EXISTS wms_approval_comments_author_trg ON public.wms_approval_comments;
CREATE TRIGGER wms_approval_comments_author_trg BEFORE INSERT ON public.wms_approval_comments
    FOR EACH ROW EXECUTE FUNCTION public.wms_approval_comments_author();

ALTER TABLE public.wms_approval_comments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_approval_comments_select ON public.wms_approval_comments;
DROP POLICY IF EXISTS wms_approval_comments_insert ON public.wms_approval_comments;
DROP POLICY IF EXISTS wms_approval_comments_delete ON public.wms_approval_comments;
CREATE POLICY wms_approval_comments_select ON public.wms_approval_comments FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_approval_comments_insert ON public.wms_approval_comments FOR INSERT TO authenticated
    WITH CHECK (kind = 'COMMENT' AND ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive())));
CREATE POLICY wms_approval_comments_delete ON public.wms_approval_comments FOR DELETE TO authenticated
    USING (kind = 'COMMENT' AND uid = (SELECT auth.uid()));
GRANT SELECT, INSERT, DELETE ON public.wms_approval_comments TO authenticated;

-- 참조·공유로만 받은 사람인지 (수신이면 결재 가능)
CREATE OR REPLACE FUNCTION public.wms_approval_review_only(p_key text)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT coalesce((
        SELECT (EXISTS (SELECT 1 FROM jsonb_array_elements(a.cc || a.shares) e WHERE e ->> 'uid' = auth.uid()::text)
            AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(a.recipients) e WHERE e ->> 'uid' = auth.uid()::text))
        FROM public.wms_approvals a WHERE a.doc_key = p_key), false);
$$;
REVOKE ALL ON FUNCTION public.wms_approval_review_only(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_approval_review_only(text) TO authenticated;

-- 서명: 반려된 문서·참조/공유만 받은 사람은 막는다 (나머지는 30·33번 규칙 그대로)
CREATE OR REPLACE FUNCTION public.wms_sign(
    p_key TEXT, p_type TEXT, p_title TEXT, p_date TEXT, p_roles JSONB, p_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid   UUID := auth.uid();
    v_name  TEXT;
    v_title TEXT;
    v_sig   TEXT;
    v_slots JSONB;
    v_old   JSONB;
BEGIN
    IF v_uid IS NULL OR NOT (public.wms_has_role('OPERATOR') OR public.wms_is_executive()) THEN
        RAISE EXCEPTION '결재 서명 권한이 없습니다 (현장 작업자 이상 또는 경영자).';
    END IF;
    IF coalesce(p_key, '') = '' OR coalesce(p_role, '') = '' THEN
        RAISE EXCEPTION '문서 또는 결재 칸이 지정되지 않았습니다.';
    END IF;
    IF jsonb_typeof(p_roles) <> 'array' OR NOT (p_roles ? p_role) THEN
        RAISE EXCEPTION '결재 칸(%)이 이 문서의 결재라인에 없습니다.', p_role;
    END IF;
    IF public.wms_approval_review_only(p_key) THEN
        RAISE EXCEPTION '참조·공유로 받은 문서는 검토·첨언만 할 수 있습니다 (결재 서명 불가).';
    END IF;
    IF EXISTS (SELECT 1 FROM public.wms_approvals WHERE doc_key = p_key AND status = 'REJECTED') THEN
        RAISE EXCEPTION '반려된 문서입니다. 재상신한 뒤 서명하세요.';
    END IF;
    SELECT coalesce(nullif(p.name, ''), split_part(p.email, '@', 1)), coalesce(p.title, '')
      INTO v_name, v_title
      FROM public.wms_profiles p WHERE p.id = v_uid;
    SELECT s.image INTO v_sig FROM public.wms_signatures s WHERE s.user_id = v_uid;
    IF v_sig IS NULL THEN
        RAISE EXCEPTION '등록된 전자서명이 없습니다. 전자결재 → 내 전자서명에서 먼저 등록하세요.';
    END IF;
    INSERT INTO public.wms_approvals (doc_key, doc_type, doc_title, doc_date, roles)
    VALUES (p_key, coalesce(p_type, ''), coalesce(p_title, ''), coalesce(p_date, ''), p_roles)
    ON CONFLICT (doc_key) DO NOTHING;
    SELECT slots INTO v_slots FROM public.wms_approvals WHERE doc_key = p_key FOR UPDATE;
    v_old := v_slots -> p_role;
    IF v_old IS NOT NULL AND (v_old ->> 'uid') IS DISTINCT FROM v_uid::text THEN
        RAISE EXCEPTION '이미 %님이 서명한 칸입니다.', v_old ->> 'name';
    END IF;
    UPDATE public.wms_approvals
       SET slots = slots || jsonb_build_object(p_role, jsonb_build_object(
               'uid', v_uid, 'name', coalesce(v_name, ''), 'title', coalesce(v_title, ''),
               'sig', v_sig, 'at', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS'))),
           roles = p_roles,
           doc_type = coalesce(nullif(p_type, ''), doc_type),
           doc_title = coalesce(nullif(p_title, ''), doc_title),
           doc_date = coalesce(nullif(p_date, ''), doc_date),
           updated_at = now()
     WHERE doc_key = p_key
     RETURNING slots INTO v_slots;
    RETURN v_slots;
END;
$$;
REVOKE ALL ON FUNCTION public.wms_sign(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_sign(TEXT, TEXT, TEXT, TEXT, JSONB, TEXT) TO authenticated;

/**
 * 반려 / 재상신. p_reason이 있으면 반려(사유 필수), NULL이면 재상신(반려 풀기, p_note = 재상신 메모).
 * 결재할 수 있는 사람(현장 작업자 이상·경영자, 참조·공유만 받은 사람 제외)만. 기록은 첨언(REJECT/RESUBMIT)으로도 남긴다.
 */
CREATE OR REPLACE FUNCTION public.wms_reject(
    p_key text, p_type text, p_title text, p_date text, p_roles jsonb, p_reason text, p_note text DEFAULT '')
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid  uuid := auth.uid();
    v_name text;
    v_row  public.wms_approvals;
BEGIN
    IF v_uid IS NULL OR NOT (public.wms_has_role('OPERATOR') OR public.wms_is_executive()) THEN
        RAISE EXCEPTION '반려·재상신 권한이 없습니다 (현장 작업자 이상 또는 경영자).';
    END IF;
    IF coalesce(p_key, '') = '' THEN RAISE EXCEPTION '문서가 지정되지 않았습니다.'; END IF;
    IF public.wms_approval_review_only(p_key) THEN
        RAISE EXCEPTION '참조·공유로 받은 문서는 검토·첨언만 할 수 있습니다 (반려 불가).';
    END IF;
    SELECT coalesce(nullif(p.name, ''), split_part(p.email, '@', 1)) INTO v_name FROM public.wms_profiles p WHERE p.id = v_uid;

    INSERT INTO public.wms_approvals (doc_key, doc_type, doc_title, doc_date, roles, base_roles)
    VALUES (p_key, coalesce(p_type, ''), coalesce(p_title, ''), coalesce(p_date, ''), coalesce(p_roles, '[]'::jsonb), p_roles)
    ON CONFLICT (doc_key) DO NOTHING;

    IF p_reason IS NOT NULL THEN
        IF length(trim(p_reason)) = 0 THEN RAISE EXCEPTION '반려 사유를 입력하세요.'; END IF;
        UPDATE public.wms_approvals SET status = 'REJECTED',
               rejected = jsonb_build_object('uid', v_uid, 'name', coalesce(v_name, ''), 'reason', left(trim(p_reason), 1000),
                                             'at', to_char(now() AT TIME ZONE 'Asia/Seoul', 'YYYY-MM-DD"T"HH24:MI:SS')),
               doc_type = coalesce(nullif(p_type, ''), doc_type), doc_title = coalesce(nullif(p_title, ''), doc_title),
               doc_date = coalesce(nullif(p_date, ''), doc_date), updated_at = now()
         WHERE doc_key = p_key RETURNING * INTO v_row;
        INSERT INTO public.wms_approval_comments (doc_key, kind, body) VALUES (p_key, 'REJECT', left(trim(p_reason), 2000));
    ELSE
        UPDATE public.wms_approvals SET status = '', rejected = NULL, updated_at = now()
         WHERE doc_key = p_key RETURNING * INTO v_row;
        INSERT INTO public.wms_approval_comments (doc_key, kind, body) VALUES (p_key, 'RESUBMIT', left(coalesce(trim(p_note), ''), 2000));
    END IF;
    RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.wms_reject(text, text, text, text, jsonb, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_reject(text, text, text, text, jsonb, text, text) TO authenticated;
