-- ==============================================================================
-- 라벨 만들기: 사용자 라벨 양식 (wms_label_templates)
-- ==============================================================================
-- 라벨 메뉴 → '라벨 만들기'에서 만든 양식을 저장한다.
-- paper: 라벨 용지 규격 (폼텍 코드 또는 사용자 정의 크기·칸 수·여백·간격)
-- elements: 라벨 위 개체 목록 (글자·필드·바코드·QR·이미지·선·도형, 위치·크기는 mm)
-- 규칙: 조회 VIEWER 이상, 작성·수정 OPERATOR 이상, 삭제 MANAGER 이상, 익명 차단.
-- 여러 번 실행해도 안전하다.
-- ==============================================================================

CREATE TABLE IF NOT EXISTS public.wms_label_templates (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT,
    paper JSONB NOT NULL,
    elements JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID DEFAULT auth.uid(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wms_label_templates_name ON public.wms_label_templates (category, name);

ALTER TABLE public.wms_label_templates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_label_templates FROM anon;
REVOKE TRUNCATE, REFERENCES, TRIGGER ON public.wms_label_templates FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_label_templates TO authenticated;

DO $$
DECLARE
    p RECORD;
BEGIN
    FOR p IN SELECT policyname FROM pg_policies WHERE schemaname = 'public' AND tablename = 'wms_label_templates' LOOP
        EXECUTE format('DROP POLICY IF EXISTS %I ON public.wms_label_templates', p.policyname);
    END LOOP;
END $$;

CREATE POLICY "wms_label_templates_select" ON public.wms_label_templates
    FOR SELECT TO authenticated USING (public.wms_has_role('VIEWER'));
CREATE POLICY "wms_label_templates_insert" ON public.wms_label_templates
    FOR INSERT TO authenticated WITH CHECK (public.wms_has_role('OPERATOR'));
CREATE POLICY "wms_label_templates_update" ON public.wms_label_templates
    FOR UPDATE TO authenticated USING (public.wms_has_role('OPERATOR')) WITH CHECK (public.wms_has_role('OPERATOR'));
CREATE POLICY "wms_label_templates_delete" ON public.wms_label_templates
    FOR DELETE TO authenticated USING (public.wms_has_role('MANAGER'));
