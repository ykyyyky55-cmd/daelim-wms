-- ==============================================================================
-- DAELIMOIL SMART WMS PRO - SUPABASE DATABASE SCHEMA & SEED DATA
-- ==============================================================================
-- Supabase 대시보드의 [SQL Editor]에 본 스크립트 전체를 복사하여 [RUN] 하시면
-- 모든 테이블, 관계, RLS 보안 정책 및 실시간 웹소켓(Realtime) 구독이 활성화됩니다.
-- ==============================================================================

-- 1. 확장 기능 활성화
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. 분류 마스터 (Categories)
CREATE TABLE IF NOT EXISTS public.wms_categories (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. 창고/거점 마스터 (Locations)
CREATE TABLE IF NOT EXISTS public.wms_locations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name TEXT UNIQUE NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 4. 작업자 마스터 (Workers)
CREATE TABLE IF NOT EXISTS public.wms_workers (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    dept TEXT,
    role TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. 시스템 사용자 계정 (Users)
CREATE TABLE IF NOT EXISTS public.wms_users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    username TEXT UNIQUE NOT NULL,
    password TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'OPERATOR',
    dept TEXT,
    title TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 6. 품목 마스터 (Master Items)
CREATE TABLE IF NOT EXISTS public.wms_master_items (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    category TEXT NOT NULL,
    supplier TEXT,
    spec TEXT,
    unit TEXT NOT NULL DEFAULT 'EA',
    safety NUMERIC NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 7. 창고별 실시간 재고 (Inventory)
CREATE TABLE IF NOT EXISTS public.wms_inventory (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL REFERENCES public.wms_master_items(code) ON UPDATE CASCADE ON DELETE CASCADE,
    location TEXT NOT NULL,
    quantity NUMERIC NOT NULL DEFAULT 0,
    status TEXT DEFAULT '정상 보관',
    last_updated TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_wms_inventory_code_location UNIQUE (code, location)
);

-- 8. 입출고/이동/실사 이력 로그 (History Logs)
CREATE TABLE IF NOT EXISTS public.wms_history_logs (
    id BIGSERIAL PRIMARY KEY,
    timestamp TIMESTAMPTZ DEFAULT NOW(),
    type TEXT NOT NULL, -- 'IN', 'OUT', 'USE', 'MOVE', 'AUDIT'
    code TEXT NOT NULL,
    name TEXT NOT NULL,
    qty NUMERIC NOT NULL,
    worker TEXT NOT NULL,
    from_loc TEXT DEFAULT '-',
    to_loc TEXT DEFAULT '-',
    reason TEXT
);

-- 9. 재고 실사 세션 (Audit Records)
CREATE TABLE IF NOT EXISTS public.wms_audit_records (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    code TEXT NOT NULL,
    location TEXT NOT NULL,
    book_qty NUMERIC NOT NULL,
    actual_qty NUMERIC NOT NULL,
    diff_qty NUMERIC NOT NULL,
    reason TEXT,
    worker TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. 일정 관리 (Schedules)
CREATE TABLE IF NOT EXISTS public.wms_schedules (
    id TEXT PRIMARY KEY,
    schedule_date DATE NOT NULL,
    type TEXT NOT NULL, -- 'IN_PLAN', 'OUT_PLAN', 'AUDIT', 'MAINTENANCE', 'ORDER_DEADLINE', 'TRAINING', 'OTHER'
    title TEXT NOT NULL,
    item_code TEXT,
    item_name TEXT,
    partner TEXT,
    worker TEXT,
    notes TEXT,
    status TEXT DEFAULT 'TODO', -- 'TODO', 'DONE'
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ==============================================================================
-- RLS (Row Level Security) 설정 (공용 익명 키 anon 허용)
-- ==============================================================================
ALTER TABLE public.wms_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_workers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_master_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_inventory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_history_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_audit_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.wms_schedules ENABLE ROW LEVEL SECURITY;

DO $$ 
BEGIN
    DROP POLICY IF EXISTS "Public full access for wms_schedules" ON public.wms_schedules;
    CREATE POLICY "Public full access for wms_schedules" ON public.wms_schedules FOR ALL USING (true) WITH CHECK (true);
    DROP POLICY IF EXISTS "Public full access for wms_categories" ON public.wms_categories;
    CREATE POLICY "Public full access for wms_categories" ON public.wms_categories FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Public full access for wms_locations" ON public.wms_locations;
    CREATE POLICY "Public full access for wms_locations" ON public.wms_locations FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Public full access for wms_workers" ON public.wms_workers;
    CREATE POLICY "Public full access for wms_workers" ON public.wms_workers FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Public full access for wms_users" ON public.wms_users;
    CREATE POLICY "Public full access for wms_users" ON public.wms_users FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Public full access for wms_master_items" ON public.wms_master_items;
    CREATE POLICY "Public full access for wms_master_items" ON public.wms_master_items FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Public full access for wms_inventory" ON public.wms_inventory;
    CREATE POLICY "Public full access for wms_inventory" ON public.wms_inventory FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Public full access for wms_history_logs" ON public.wms_history_logs;
    CREATE POLICY "Public full access for wms_history_logs" ON public.wms_history_logs FOR ALL USING (true) WITH CHECK (true);

    DROP POLICY IF EXISTS "Public full access for wms_audit_records" ON public.wms_audit_records;
    CREATE POLICY "Public full access for wms_audit_records" ON public.wms_audit_records FOR ALL USING (true) WITH CHECK (true);
END $$;

-- ==============================================================================
-- Realtime 활성화 (다중 사용자 실시간 동기화)
-- ==============================================================================
DO $$
BEGIN
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.wms_inventory;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.wms_history_logs;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.wms_master_items;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.wms_workers;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.wms_locations;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
    BEGIN
        ALTER PUBLICATION supabase_realtime ADD TABLE public.wms_categories;
    EXCEPTION WHEN duplicate_object THEN NULL;
    END;
END $$;

-- ==============================================================================
-- 초기 데모 시드 데이터 (SEED DATA)
-- ==============================================================================
INSERT INTO public.wms_categories (name) VALUES
    ('완제품'), ('원료'), ('부자재')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.wms_locations (name) VALUES
    ('김포공장 A동'), ('김포2공장 B동'), ('인천 물류센터'), ('화성 자재창고')
ON CONFLICT (name) DO NOTHING;

INSERT INTO public.wms_workers (id, name, dept, role) VALUES
    ('EMP-001', '홍길동', '물류관리팀', '관리자'),
    ('EMP-002', '김생산', '생산조립2팀', '생산기사'),
    ('EMP-003', '이물류', '자재운영팀', '반장'),
    ('EMP-004', '박품질', '품질보증팀', '주임')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.wms_users (id, name, username, password, role, dept, title) VALUES
    ('admin', '홍길동', 'admin', 'admin123', 'ADMIN', '물류관리팀', '총괄 관리자'),
    ('manager', '김물류', 'manager', 'manager123', 'MANAGER', '자재운영팀', '물류 반장'),
    ('worker', '이작업', 'worker', 'worker123', 'OPERATOR', '생산조립팀', '현장 기사'),
    ('viewer', '박게스트', 'viewer', 'viewer123', 'VIEWER', '경영기획팀', '조회 담당')
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.wms_master_items (code, name, category, supplier, spec, unit, safety) VALUES
    ('ITEM-1001', '스테인리스 육각볼트', '부자재', '(주)한국정밀', 'M8 x 25mm (SUS304)', 'EA', 50),
    ('ITEM-1002', '산업용 서보 모터', '완제품', '(주)모션테크', '400W AC220V', 'SET', 10),
    ('ITEM-1003', '에폭시 수지 수지액', '원료', '대한화학(주)', '고점도 투명 (Grade A)', 'KG', 100),
    ('ITEM-1004', '고무 실링 가스켓', '부자재', '태양실링(주)', 'OD 45mm x ID 30mm', 'EA', 80)
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.wms_inventory (code, location, quantity, status, last_updated) VALUES
    ('ITEM-1001', '김포공장 A동', 180, '정상 보관', NOW()),
    ('ITEM-1002', '김포2공장 B동', 8, '정상 보관', NOW()),
    ('ITEM-1003', '화성 자재창고', 240, '정상 보관', NOW()),
    ('ITEM-1004', '김포공장 A동', 45, '정상 보관', NOW())
ON CONFLICT (code, location) DO NOTHING;

INSERT INTO public.wms_history_logs (timestamp, type, code, name, qty, worker, from_loc, to_loc, reason) VALUES
    (NOW() - INTERVAL '2 hours', 'IN', 'ITEM-1001', '스테인리스 육각볼트', 80, '홍길동 (관리자)', '-', '김포공장 A동', '정기 구매 입고'),
    (NOW() - INTERVAL '5 hours', 'USE', 'ITEM-1002', '산업용 서보 모터', 2, '김생산 기사', '김포2공장 B동', '-', '생산 2라인 긴급 조립 투입'),
    (NOW() - INTERVAL '8 hours', 'MOVE', 'ITEM-1004', '고무 실링 가스켓', 25, '이물류 반장', '인천 물류센터', '김포공장 A동', '공장 간 재고 재배치');
