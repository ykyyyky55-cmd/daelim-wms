-- ==========================================
-- 36. 파일 저장소: 품목 사진 · 접수/발행 문서
-- ==========================================
-- 비공개 Storage 버킷 wms-files (파일 1개 20MB까지, 볼 때는 서명 URL)
--   images/<품목코드>/<시각>_<파일명>  : 품목 사진 (품목마스터 대표 사진)
--   docs/<문서id>/<시각>_<파일명>      : 접수·발행 문서 첨부
-- wms_item_images: 품목코드별 사진 여러 장, is_primary = 품목마스터에 보이는 대표 사진 (품목당 하나)
-- wms_documents  : 접수(RECEIVED)·발행(ISSUED) 문서 대장. reg_no(접수-2026-0001 / 발행-2026-0001)는 DB가 매긴다.
-- 권한: 조회 VIEWER·경영자 / 올리기·고치기 OPERATOR 이상(고치기는 올린 사람 또는 MANAGER) / 삭제 올린 사람 또는 MANAGER

INSERT INTO storage.buckets (id, name, public, file_size_limit)
VALUES ('wms-files', 'wms-files', false, 20971520)
ON CONFLICT (id) DO UPDATE SET public = false, file_size_limit = EXCLUDED.file_size_limit;

DROP POLICY IF EXISTS "wms_files_select" ON storage.objects;
DROP POLICY IF EXISTS "wms_files_insert" ON storage.objects;
DROP POLICY IF EXISTS "wms_files_delete" ON storage.objects;
CREATE POLICY "wms_files_select" ON storage.objects FOR SELECT TO authenticated
    USING (bucket_id = 'wms-files' AND ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive())));
CREATE POLICY "wms_files_insert" ON storage.objects FOR INSERT TO authenticated
    WITH CHECK (bucket_id = 'wms-files' AND (SELECT public.wms_has_role('OPERATOR')));
CREATE POLICY "wms_files_delete" ON storage.objects FOR DELETE TO authenticated
    USING (bucket_id = 'wms-files' AND (owner = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER'))));

-- ---------- 품목 사진 ----------
CREATE TABLE IF NOT EXISTS public.wms_item_images (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    item_code        text NOT NULL,
    path             text NOT NULL UNIQUE,
    file_name        text NOT NULL DEFAULT '',
    mime             text DEFAULT '',
    size             bigint DEFAULT 0,
    is_primary       boolean NOT NULL DEFAULT false,
    memo             text DEFAULT '',
    uploaded_by      uuid DEFAULT auth.uid(),
    uploaded_by_name text DEFAULT '',
    created_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_item_images_code_idx ON public.wms_item_images (item_code);
CREATE UNIQUE INDEX IF NOT EXISTS wms_item_images_one_primary ON public.wms_item_images (item_code) WHERE is_primary;

ALTER TABLE public.wms_item_images ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_item_images_select ON public.wms_item_images;
DROP POLICY IF EXISTS wms_item_images_insert ON public.wms_item_images;
DROP POLICY IF EXISTS wms_item_images_update ON public.wms_item_images;
DROP POLICY IF EXISTS wms_item_images_delete ON public.wms_item_images;
CREATE POLICY wms_item_images_select ON public.wms_item_images FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_item_images_insert ON public.wms_item_images FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
CREATE POLICY wms_item_images_update ON public.wms_item_images FOR UPDATE TO authenticated
    USING ((SELECT public.wms_has_role('OPERATOR'))) WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
CREATE POLICY wms_item_images_delete ON public.wms_item_images FOR DELETE TO authenticated
    USING (uploaded_by = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER')));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_item_images TO authenticated;

-- 대표 사진 지정 (같은 품목의 다른 사진은 대표 해제) — 한 번에 처리
CREATE OR REPLACE FUNCTION public.wms_set_primary_image(p_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_code text;
BEGIN
    IF NOT public.wms_has_role('OPERATOR') THEN RAISE EXCEPTION '권한이 없습니다.'; END IF;
    SELECT item_code INTO v_code FROM public.wms_item_images WHERE id = p_id;
    IF v_code IS NULL THEN RAISE EXCEPTION '사진을 찾을 수 없습니다.'; END IF;
    UPDATE public.wms_item_images SET is_primary = false WHERE item_code = v_code AND is_primary AND id <> p_id;
    UPDATE public.wms_item_images SET is_primary = true WHERE id = p_id;
END $$;
GRANT EXECUTE ON FUNCTION public.wms_set_primary_image(uuid) TO authenticated;

-- ---------- 접수·발행 문서 ----------
CREATE TABLE IF NOT EXISTS public.wms_documents (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reg_no           text UNIQUE,
    direction        text NOT NULL CHECK (direction IN ('RECEIVED', 'ISSUED')),
    doc_date         date NOT NULL DEFAULT current_date,
    doc_type         text DEFAULT '',
    doc_no           text DEFAULT '',
    party            text DEFAULT '',
    title            text NOT NULL DEFAULT '',
    assignee_name    text DEFAULT '',
    memo             text DEFAULT '',
    files            jsonb NOT NULL DEFAULT '[]'::jsonb,
    uploaded_by      uuid DEFAULT auth.uid(),
    uploaded_by_name text DEFAULT '',
    created_at       timestamptz DEFAULT now(),
    updated_at       timestamptz DEFAULT now()
);
CREATE INDEX IF NOT EXISTS wms_documents_date_idx ON public.wms_documents (doc_date DESC);

-- 접수번호: 접수-YYYY-0001 / 발행-YYYY-0001 (구분·문서일자의 연도별 일련번호)
CREATE OR REPLACE FUNCTION public.wms_documents_reg_no()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_prefix text; v_next int;
BEGIN
    IF NEW.reg_no IS NOT NULL AND NEW.reg_no <> '' THEN RETURN NEW; END IF;
    v_prefix := (CASE WHEN NEW.direction = 'RECEIVED' THEN '접수' ELSE '발행' END) || '-' || to_char(NEW.doc_date, 'YYYY') || '-';
    PERFORM pg_advisory_xact_lock(hashtext('wms_documents_reg_no:' || v_prefix));
    SELECT coalesce(max(substring(reg_no FROM length(v_prefix) + 1)::int), 0) + 1 INTO v_next
      FROM public.wms_documents WHERE reg_no LIKE v_prefix || '%' AND substring(reg_no FROM length(v_prefix) + 1) ~ '^\d+$';
    NEW.reg_no := v_prefix || lpad(v_next::text, 4, '0');
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS wms_documents_reg_no_trg ON public.wms_documents;
CREATE TRIGGER wms_documents_reg_no_trg BEFORE INSERT ON public.wms_documents FOR EACH ROW EXECUTE FUNCTION public.wms_documents_reg_no();

ALTER TABLE public.wms_documents ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS wms_documents_select ON public.wms_documents;
DROP POLICY IF EXISTS wms_documents_insert ON public.wms_documents;
DROP POLICY IF EXISTS wms_documents_update ON public.wms_documents;
DROP POLICY IF EXISTS wms_documents_delete ON public.wms_documents;
CREATE POLICY wms_documents_select ON public.wms_documents FOR SELECT TO authenticated
    USING ((SELECT public.wms_has_role('VIEWER')) OR (SELECT public.wms_is_executive()));
CREATE POLICY wms_documents_insert ON public.wms_documents FOR INSERT TO authenticated
    WITH CHECK ((SELECT public.wms_has_role('OPERATOR')));
CREATE POLICY wms_documents_update ON public.wms_documents FOR UPDATE TO authenticated
    USING (uploaded_by = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER')))
    WITH CHECK (uploaded_by = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER')));
CREATE POLICY wms_documents_delete ON public.wms_documents FOR DELETE TO authenticated
    USING (uploaded_by = (SELECT auth.uid()) OR (SELECT public.wms_has_role('MANAGER')));
GRANT SELECT, INSERT, UPDATE, DELETE ON public.wms_documents TO authenticated;
