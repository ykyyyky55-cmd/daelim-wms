-- ==============================================================================
-- 77. 혼합물 MSDS 작성 (GHS · 고용노동부고시 제2026-26호) — 품질관리 → MSDS관리 → 혼합물 MSDS 작성
-- ==============================================================================
-- wms_chem_substances  CAS 번호별 물질 정보 (분류·급성독성값·노출기준·규제 — 안전보건공단 MSDS 조회 API·PubChem에서 받은 것과 직접 넣은 것)
-- wms_msds_docs        혼합물 MSDS 작성 문서 (구성성분의 정확한 함유량 = 배합 자료, 내용은 data JSONB)
--                      id 'CFG:SUPPLIER' 한 줄은 공급자 정보(회사명·주소·긴급전화번호) 기본값
-- 접근: 두 표 모두 마스터 + 작업일지 관리자만 (wms_has_worklog_access, 08번 원액 작업지시서와 같은 특별보안).
--   어떤 물질을 쓰는지(물질 목록)와 함유량은 배합 자료이기 때문이다.
--   발행한 MSDS(함유량은 ±5%P 범위로 적은 문서)는 MSDS 대장(wms_qc_records kind MSDS)의 첨부 파일로 올려 모두가 본다.
-- 안전보건공단 MSDS 조회 API 인증키(공공데이터포털에서 받는 무료 키): 비밀 표 wms_notify_secret(id 'KOSHA_API_KEY', 사용자 정책 없음)에 두고
--   Edge Function kosha-msds(서비스 키)만 읽는다. 앱은 아래 함수로 저장하고 설정 여부만 안다.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_chem_substances (
    cas             TEXT PRIMARY KEY,
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by      UUID DEFAULT auth.uid(),
    updated_by_name TEXT DEFAULT '',
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.wms_msds_docs (
    id              TEXT PRIMARY KEY,
    product_name    TEXT NOT NULL DEFAULT '',
    status          TEXT NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'FINAL', 'CFG')),
    data            JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_by      UUID DEFAULT auth.uid(),
    created_by_name TEXT DEFAULT '',
    updated_by_name TEXT DEFAULT '',
    created_at      TIMESTAMPTZ DEFAULT now(),
    updated_at      TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_msds_docs_updated_idx ON public.wms_msds_docs (updated_at DESC);

DO $$
DECLARE
    t TEXT;
    p RECORD;
BEGIN
    FOREACH t IN ARRAY ARRAY['wms_chem_substances', 'wms_msds_docs'] LOOP
        EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('REVOKE ALL ON public.%I FROM anon', t);
        EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON public.%I TO authenticated', t);
        FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = t LOOP
            EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', p.policyname, t);
        END LOOP;
        -- 조회·쓰기를 나눠 만든다(FOR ALL은 SELECT에 두 번 걸린다 — 68번), 권한 함수는 (SELECT …)로 감싼다(34번)
        EXECUTE format('CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING ((SELECT public.wms_has_worklog_access()))', t || '_select', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK ((SELECT public.wms_has_worklog_access()))', t || '_insert', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING ((SELECT public.wms_has_worklog_access())) WITH CHECK ((SELECT public.wms_has_worklog_access()))', t || '_update', t);
        EXECUTE format('CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING ((SELECT public.wms_has_worklog_access()))', t || '_delete', t);
    END LOOP;
END $$;

-- 안전보건공단 MSDS 조회 API 인증키 저장 (마스터·작업일지 관리자). 빈 값이면 지운다.
CREATE OR REPLACE FUNCTION public.wms_set_kosha_key(p_key TEXT)
RETURNS BOOLEAN LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
    k TEXT := btrim(COALESCE(p_key, ''));
BEGIN
    IF NOT public.wms_has_worklog_access() THEN RAISE EXCEPTION '마스터 또는 작업일지 관리자만 설정할 수 있습니다.'; END IF;
    IF k = '' THEN
        DELETE FROM public.wms_notify_secret WHERE id = 'KOSHA_API_KEY';
        RETURN FALSE;
    END IF;
    IF length(k) < 20 OR length(k) > 400 OR k ~ '\s' THEN RAISE EXCEPTION '인증키 모양이 올바르지 않습니다 (공공데이터포털의 일반 인증키를 그대로 붙여 넣으세요).'; END IF;
    INSERT INTO public.wms_notify_secret (id, value, updated_at) VALUES ('KOSHA_API_KEY', k, now())
    ON CONFLICT (id) DO UPDATE SET value = EXCLUDED.value, updated_at = now();
    RETURN TRUE;
END $$;
REVOKE ALL ON FUNCTION public.wms_set_kosha_key(TEXT) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_set_kosha_key(TEXT) TO authenticated;

-- 인증키가 설정돼 있는지만 알려 준다 (키는 돌려주지 않음)
CREATE OR REPLACE FUNCTION public.wms_kosha_key_set()
RETURNS BOOLEAN LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
    SELECT public.wms_has_worklog_access() AND EXISTS (SELECT 1 FROM public.wms_notify_secret WHERE id = 'KOSHA_API_KEY');
$$;
REVOKE ALL ON FUNCTION public.wms_kosha_key_set() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_kosha_key_set() TO authenticated;
