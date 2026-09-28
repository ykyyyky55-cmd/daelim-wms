-- ==========================================
-- 45. 문서 첨부파일 · 결재란 추가 · 수신/참조/공유
-- ==========================================
-- (1) wms_attachments: 보고서·결재 문서(doc_key, 전자결재와 같은 키)마다 첨부파일 여러 개.
--     파일은 비공개 버킷 wms-files의 attach/<문서키>/<시각>_<파일명> (36_file_store.sql Storage 정책 그대로:
--     조회 VIEWER·경영자, 올리기 OPERATOR, 지우기 올린 사람·MANAGER). 여기 표도 같은 규칙에 경영자 올리기를 더함.
-- (2) wms_approvals에 결재선·수신참조·공유 칸 추가
--     base_roles   : 양식이 정한 기본 결재 칸 (결재선을 바꾼 기준)
--     custom_roles : 사용자가 칸을 더한 결재선 (NULL이면 기본 그대로). 서명이 있는 칸·기본 칸은 뺄 수 없다.
--     recipients / cc / shares : [{ uid, name, at, by }]  수신(결재 요청) · 참조 · 공유
--     바꾸기는 DB 함수 wms_approval_meta로만 한다 (현장 작업자 이상 또는 경영자).

CREATE TABLE IF NOT EXISTS public.wms_attachments (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_key          text NOT NULL,
    path             text NOT NULL UNIQUE,
    file_name        text NOT NULL DEFAULT '',
    mime             text DEFAULT '',
    size             bigint DEFAULT 0,
    uploaded_by      uuid DEFAULT auth.uid(),
    uploaded_by_name text DEFAULT '',
    created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_attachments_key_idx ON public.wms_attachments (doc_key);

ALTER TABLE public.wms_attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_attachments_select ON public.wms_attachments;
DROP POLICY IF EXISTS wms_attachments_insert ON public.wms_attachments;
DROP POLICY IF EXISTS wms_attachments_delete ON public.wms_attachments;
CREATE POLICY wms_attachments_select ON public.wms_attachments FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_attachments_insert ON public.wms_attachments FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('OPERATOR')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_attachments_delete ON public.wms_attachments FOR DELETE TO authenticated
    USING (uploaded_by = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER')));
GRANT SELECT, INSERT, DELETE ON public.wms_attachments TO authenticated;

-- 경영자도 첨부를 올리고(자기 파일은) 지울 수 있게 Storage 정책을 넓힌다
DROP POLICY IF EXISTS "wms_files_insert" ON storage.objects;
DROP POLICY IF EXISTS "wms_files_delete" ON storage.objects;
CREATE POLICY "wms_files_insert" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'wms-files' AND ((SELECT public.wms_has_role('OPERATOR'))
        OR ((SELECT public.wms_is_executive()) AND (storage.foldername(name))[1] = 'attach')));
CREATE POLICY "wms_files_delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'wms-files' AND (owner = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER'))));

-- ---------- 결재선 · 수신/참조/공유 ----------
ALTER TABLE public.wms_approvals
    ADD COLUMN IF NOT EXISTS base_roles   jsonb,
    ADD COLUMN IF NOT EXISTS custom_roles jsonb,
    ADD COLUMN IF NOT EXISTS recipients   jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS cc           jsonb NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS shares       jsonb NOT NULL DEFAULT '[]'::jsonb;

-- 결재 문서함에서 경영자도 볼 수 있게 (서명·수신은 경영자도 한다)
DROP POLICY IF EXISTS "wms_approvals_select" ON public.wms_approvals;
CREATE POLICY "wms_approvals_select" ON public.wms_approvals FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));

/**
 * 결재선·수신/참조/공유 저장. NULL로 준 항목은 그대로 둔다.
 * p_custom: 결재선 전체(기본 칸 포함, 순서대로). 빈 배열이면 기본 결재선으로 되돌린다.
 */
CREATE OR REPLACE FUNCTION public.wms_approval_meta(
    p_key text, p_type text, p_title text, p_date text, p_base jsonb,
    p_custom jsonb, p_recipients jsonb, p_cc jsonb, p_shares jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    v_slots jsonb;
    v_role  text;
    v_row   public.wms_approvals;
BEGIN
    IF auth.uid() IS NULL OR NOT (public.wms_has_role('OPERATOR') OR public.wms_is_executive()) THEN
        RAISE EXCEPTION '결재선·수신참조를 바꿀 권한이 없습니다 (현장 작업자 이상 또는 경영자).';
    END IF;
    IF coalesce(p_key, '') = '' THEN RAISE EXCEPTION '문서가 지정되지 않았습니다.'; END IF;
    IF p_base IS NULL OR jsonb_typeof(p_base) <> 'array' THEN RAISE EXCEPTION '기본 결재 칸이 올바르지 않습니다.'; END IF;

    INSERT INTO public.wms_approvals (doc_key, doc_type, doc_title, doc_date, roles, base_roles)
    VALUES (p_key, coalesce(p_type, ''), coalesce(p_title, ''), coalesce(p_date, ''), p_base, p_base)
    ON CONFLICT (doc_key) DO NOTHING;
    SELECT slots INTO v_slots FROM public.wms_approvals WHERE doc_key = p_key FOR UPDATE;

    IF p_custom IS NOT NULL THEN
        IF jsonb_typeof(p_custom) <> 'array' THEN RAISE EXCEPTION '결재선이 올바르지 않습니다.'; END IF;
        IF jsonb_array_length(p_custom) > 0 THEN
            IF jsonb_array_length(p_custom) > 10 THEN RAISE EXCEPTION '결재 칸은 10개까지입니다.'; END IF;
            FOR v_role IN SELECT jsonb_array_elements_text(p_base) LOOP
                IF NOT (p_custom ? v_role) THEN RAISE EXCEPTION '기본 결재 칸(%)은 뺄 수 없습니다.', v_role; END IF;
            END LOOP;
        END IF;
        FOR v_role IN SELECT jsonb_object_keys(coalesce(v_slots, '{}'::jsonb)) LOOP
            IF NOT ((CASE WHEN jsonb_array_length(p_custom) > 0 THEN p_custom ELSE p_base END) ? v_role) THEN
                RAISE EXCEPTION '서명이 있는 칸(%)은 뺄 수 없습니다. 먼저 서명을 취소하세요.', v_role;
            END IF;
        END LOOP;
    END IF;

    UPDATE public.wms_approvals SET
        base_roles   = p_base,
        custom_roles = CASE WHEN p_custom IS NULL THEN custom_roles WHEN jsonb_array_length(p_custom) = 0 THEN NULL ELSE p_custom END,
        roles        = CASE WHEN p_custom IS NULL THEN coalesce(custom_roles, p_base) WHEN jsonb_array_length(p_custom) = 0 THEN p_base ELSE p_custom END,
        recipients   = coalesce(p_recipients, recipients),
        cc           = coalesce(p_cc, cc),
        shares       = coalesce(p_shares, shares),
        doc_type     = coalesce(nullif(p_type, ''), doc_type),
        doc_title    = coalesce(nullif(p_title, ''), doc_title),
        doc_date     = coalesce(nullif(p_date, ''), doc_date),
        updated_at   = now()
     WHERE doc_key = p_key
     RETURNING * INTO v_row;
    RETURN to_jsonb(v_row);
END;
$$;
REVOKE ALL ON FUNCTION public.wms_approval_meta(text, text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_approval_meta(text, text, text, text, jsonb, jsonb, jsonb, jsonb, jsonb) TO authenticated;
