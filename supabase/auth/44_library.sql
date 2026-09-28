-- ==========================================
-- 44. 자료실 (메뉴 지원 → 자료실, 탭 library)
-- ==========================================
-- 회사 공용 자료(로고·CI, 양식·서식, 규정·지침, 교육 자료 등)를 분류별로 모아 두고 내려받는다.
-- 파일은 비공개 버킷 wms-files의 library/<자료id>/<시각>_<파일명> (36_file_store.sql의 Storage 정책 그대로:
-- 조회 VIEWER·경영자, 올리기 OPERATOR, 지우기 올린 사람·MANAGER).
-- files jsonb = [{ path, name, mime, size }] 또는 앱에 함께 배포된 공개 파일 [{ url, name, mime, size }] (url = 앱 기준 상대 경로)
-- 권한: 조회 VIEWER·경영자 / 올리기 OPERATOR 이상 / 고치기·지우기 올린 사람 또는 MANAGER 이상

CREATE TABLE IF NOT EXISTS public.wms_library (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    category         text NOT NULL DEFAULT '기타',
    title            text NOT NULL DEFAULT '',
    description      text DEFAULT '',
    files            jsonb NOT NULL DEFAULT '[]'::jsonb,
    pinned           boolean NOT NULL DEFAULT false,
    uploaded_by      uuid DEFAULT auth.uid(),
    uploaded_by_name text DEFAULT '',
    created_at       timestamptz DEFAULT now(),
    updated_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_library_category_idx ON public.wms_library (category);

ALTER TABLE public.wms_library ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_library_select ON public.wms_library;
DROP POLICY IF EXISTS wms_library_insert ON public.wms_library;
DROP POLICY IF EXISTS wms_library_update ON public.wms_library;
DROP POLICY IF EXISTS wms_library_delete ON public.wms_library;
CREATE POLICY wms_library_select ON public.wms_library FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_library_insert ON public.wms_library FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
CREATE POLICY wms_library_update ON public.wms_library FOR UPDATE TO authenticated
    USING (uploaded_by = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER')))
    WITH CHECK (uploaded_by = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER')));
CREATE POLICY wms_library_delete ON public.wms_library FOR DELETE TO authenticated
    USING (uploaded_by = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER')));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_library TO authenticated;

-- 첫 자료: 대림 로고 (앱과 함께 배포되는 public/ 파일을 가리킨다)
INSERT INTO public.wms_library (category, title, description, files, pinned, uploaded_by, uploaded_by_name)
SELECT '로고·CI', '대림 로고 (DAELIM since 1994)',
       E'홈페이지(daelimoil.co.kr) 로고를 선명한 벡터로 다시 그린 공식 로고입니다. 기본색 #1E3C96.\n'
       || E'· 밝은 바탕: 기본색 로고(logo) · 어두운 바탕: 흰색 로고(logo-white) — 둘 다 바탕 투명\n'
       || E'· 아이콘: 기본색 바탕 + 흰 로고 (icon, 앱 아이콘용 maskable 포함)\n'
       || E'· 인쇄·확대는 SVG, 문서·메신저 붙여넣기는 PNG(가로 1600px)를 쓰세요.',
       '[
          {"url":"logo.svg","name":"대림로고_기본색.svg","mime":"image/svg+xml","size":5766},
          {"url":"logo.png","name":"대림로고_기본색.png","mime":"image/png","size":65048},
          {"url":"logo-white.svg","name":"대림로고_흰색.svg","mime":"image/svg+xml","size":5766},
          {"url":"logo-white.png","name":"대림로고_흰색.png","mime":"image/png","size":34459},
          {"url":"icon.svg","name":"대림아이콘.svg","mime":"image/svg+xml","size":5889},
          {"url":"icon-512.png","name":"대림아이콘_512.png","mime":"image/png","size":17600},
          {"url":"icon-maskable-512.png","name":"대림아이콘_사각_512.png","mime":"image/png","size":11809}
        ]'::jsonb,
       true, NULL, '시스템'
WHERE NOT EXISTS (SELECT 1 FROM public.wms_library WHERE title = '대림 로고 (DAELIM since 1994)');
