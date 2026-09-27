-- ==============================================================================
-- 전자결재 · 전자서명
-- ==============================================================================
-- wms_signatures : 계정마다 전자서명 하나 (자동 발급 원형 도장 / 도장 이미지 / 직접 그린 서명, PNG dataURL)
-- wms_approvals  : 문서 하나(doc_key)의 결재 칸별 서명 기록. slots = { "칸 이름": {uid, name, title, sig, at} }
--   doc_key 예) PLAN:<계획id>, PLANDAY:<날짜>, REQ:<요청서id>, SLIP:<전표번호>, LOG:<HQ|GIMPO>:<날짜>, LEDGER:<...>
-- 서명은 wms_sign 함수로만 한다: 서명자 이름은 로그인 계정의 프로필, 서명 이미지는 그 계정의 등록 서명, 시각은 서버 시각.
-- 다른 사람이 서명한 칸은 덮어쓸 수 없고, 서명 취소는 본인 또는 MANAGER 이상만 한다.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_signatures (
    user_id    UUID PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
    name       TEXT NOT NULL DEFAULT '',
    kind       TEXT NOT NULL DEFAULT 'AUTO' CHECK (kind IN ('AUTO', 'IMAGE', 'DRAW')),
    image      TEXT NOT NULL CHECK (length(image) < 300000),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE public.wms_signatures ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "wms_signatures_select" ON public.wms_signatures;
DROP POLICY IF EXISTS "wms_signatures_insert" ON public.wms_signatures;
DROP POLICY IF EXISTS "wms_signatures_update" ON public.wms_signatures;
DROP POLICY IF EXISTS "wms_signatures_delete" ON public.wms_signatures;
CREATE POLICY "wms_signatures_select" ON public.wms_signatures FOR SELECT TO authenticated
    USING (user_id = auth.uid() OR public.wms_has_role('MANAGER'));
CREATE POLICY "wms_signatures_insert" ON public.wms_signatures FOR INSERT TO authenticated
    WITH CHECK (user_id = auth.uid() AND public.wms_has_role('VIEWER'));
CREATE POLICY "wms_signatures_update" ON public.wms_signatures FOR UPDATE TO authenticated
    USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "wms_signatures_delete" ON public.wms_signatures FOR DELETE TO authenticated
    USING (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.wms_approvals (
    doc_key    TEXT PRIMARY KEY,
    doc_type   TEXT NOT NULL DEFAULT '',
    doc_title  TEXT NOT NULL DEFAULT '',
    doc_date   TEXT NOT NULL DEFAULT '',
    roles      JSONB NOT NULL DEFAULT '[]'::jsonb,
    slots      JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_wms_approvals_updated ON public.wms_approvals (updated_at DESC);
ALTER TABLE public.wms_approvals ENABLE ROW LEVEL SECURITY;

-- 조회는 승인된 사용자 모두, 쓰기는 아래 함수로만
DROP POLICY IF EXISTS "wms_approvals_select" ON public.wms_approvals;
CREATE POLICY "wms_approvals_select" ON public.wms_approvals FOR SELECT TO authenticated
    USING (public.wms_has_role('VIEWER'));

-- 서명
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
    IF v_uid IS NULL OR NOT public.wms_has_role('OPERATOR') THEN
        RAISE EXCEPTION '결재 서명 권한이 없습니다 (현장 작업자 이상).';
    END IF;
    IF coalesce(p_key, '') = '' OR coalesce(p_role, '') = '' THEN
        RAISE EXCEPTION '문서 또는 결재 칸이 지정되지 않았습니다.';
    END IF;
    IF jsonb_typeof(p_roles) <> 'array' OR NOT (p_roles ? p_role) THEN
        RAISE EXCEPTION '결재 칸(%)이 이 문서의 결재라인에 없습니다.', p_role;
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

-- 서명 취소 (본인 또는 MANAGER 이상)
CREATE OR REPLACE FUNCTION public.wms_unsign(p_key TEXT, p_role TEXT)
RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_uid   UUID := auth.uid();
    v_old   JSONB;
    v_slots JSONB;
BEGIN
    IF v_uid IS NULL OR NOT public.wms_has_role('OPERATOR') THEN
        RAISE EXCEPTION '권한이 없습니다.';
    END IF;
    SELECT slots -> p_role INTO v_old FROM public.wms_approvals WHERE doc_key = p_key FOR UPDATE;
    IF v_old IS NULL THEN
        SELECT slots INTO v_slots FROM public.wms_approvals WHERE doc_key = p_key;
        RETURN coalesce(v_slots, '{}'::jsonb);
    END IF;
    IF (v_old ->> 'uid') IS DISTINCT FROM v_uid::text AND NOT public.wms_has_role('MANAGER') THEN
        RAISE EXCEPTION '다른 사람의 서명은 자재 관리자 이상만 취소할 수 있습니다.';
    END IF;
    UPDATE public.wms_approvals SET slots = slots - p_role, updated_at = now()
     WHERE doc_key = p_key RETURNING slots INTO v_slots;
    RETURN v_slots;
END;
$$;
REVOKE ALL ON FUNCTION public.wms_unsign(TEXT, TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_unsign(TEXT, TEXT) TO authenticated;
