-- ==========================================
-- 34. RLS 권한 검사를 조회당 한 번만 계산 (성능)
-- ==========================================
-- 문제: 정책의 wms_has_role('VIEWER') 같은 호출은 행마다 다시 실행된다(SECURITY DEFINER + SET search_path 함수라 인라인·캐시 안 됨).
--       wms_raw_ledger(약 7,800건) 건수 조회가 로그인 사용자 권한으로 5초 이상 걸려 statement_timeout(8초)에 취소되었고,
--       그 때문에 앱이 원료수불부를 불러오지 못해 업무일지 수불부 반영의 원료수불부 전표가 올라가지 않았다(2026-09-27).
-- 해결: 인자가 상수인 권한 함수와 auth.uid()를 ( SELECT … )로 감싸 InitPlan으로 조회당 한 번만 계산한다 (Supabase 권장 방식).
--       권한 규칙은 바뀌지 않는다. 이미 감싼 호출은 건너뛰므로 여러 번 실행해도 된다.
-- 새 정책을 만들 때도 ( SELECT wms_has_role('VIEWER') ) 처럼 감싸서 쓰세요.
DO $$
DECLARE
    p record;
    pat constant text := '(?<!SELECT )(auth\.uid\(\)|wms_is_executive\(\)|wms_has_worklog_access\(\)|wms_has_role\(''[A-Z]+''::text\))';
    q text;
    c text;
    sql text;
BEGIN
    FOR p IN
        SELECT policyname, tablename, qual, with_check FROM pg_policies
        WHERE schemaname = 'public'
          AND (coalesce(qual, '') || ' ' || coalesce(with_check, '')) ~ pat
    LOOP
        q := regexp_replace(p.qual, pat, '( SELECT \1)', 'g');
        c := regexp_replace(p.with_check, pat, '( SELECT \1)', 'g');
        sql := format('ALTER POLICY %I ON public.%I', p.policyname, p.tablename)
            || CASE WHEN q IS NOT NULL THEN ' USING (' || q || ')' ELSE '' END
            || CASE WHEN c IS NOT NULL THEN ' WITH CHECK (' || c || ')' ELSE '' END;
        EXECUTE sql;
    END LOOP;
END $$;
