-- ==============================================================================
-- [1단계] Supabase Auth 전환 준비 (기존 앱 동작에 영향 없음)
-- ==============================================================================
-- Supabase 대시보드 [SQL Editor]에서 전체를 한 번 실행합니다. 여러 번 실행해도 안전합니다.
--
-- 추가되는 것
--   - wms_app_settings : master 계정 이메일 (단일 행)
--   - wms_profiles     : 로그인 사용자 프로필과 역할 (비밀번호 없음, 비밀번호는 Supabase Auth가 보관)
--   - 가입 시 프로필 자동 생성 트리거 (역할은 승인 대기 PENDING)
--   - 역할 판별 / 역할 변경 / master 이전 함수
--
-- 역할 체계: MASTER > ADMIN > MANAGER > OPERATOR > VIEWER > PENDING(승인 대기, 접근 불가)
--   - MASTER는 역할 칸에 저장하지 않는다. wms_app_settings.master_email과
--     "메일 인증이 끝난" 로그인 이메일이 같으면 MASTER로 판별한다.
--     (다른 사람이 같은 이메일로 먼저 가입해도 메일 인증 전에는 MASTER가 되지 않는다)
--   - 역할 변경은 "자기보다 낮은 역할의 사용자를, 자기보다 낮은 역할로만" 바꿀 수 있다.
-- ==============================================================================

-- 1. 앱 설정 (master 이메일, 단일 행)
CREATE TABLE IF NOT EXISTS public.wms_app_settings (
    id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (id),
    master_email TEXT NOT NULL,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
INSERT INTO public.wms_app_settings (id, master_email)
VALUES (TRUE, 'ps05@daelimoil.co.kr')
ON CONFLICT (id) DO NOTHING;

-- 2. 사용자 프로필
CREATE TABLE IF NOT EXISTS public.wms_profiles (
    id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
    email TEXT NOT NULL,
    name TEXT NOT NULL,
    dept TEXT,
    title TEXT,
    role TEXT NOT NULL DEFAULT 'PENDING'
        CHECK (role IN ('PENDING', 'VIEWER', 'OPERATOR', 'MANAGER', 'ADMIN')),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    approved_at TIMESTAMPTZ,
    approved_by UUID
);

-- 3. 가입(auth.users 생성) 시 프로필 자동 생성, 이메일 변경 시 동기화
CREATE OR REPLACE FUNCTION public.wms_handle_new_user()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    INSERT INTO public.wms_profiles (id, email, name, dept)
    VALUES (
        NEW.id,
        NEW.email,
        COALESCE(
            NULLIF(NEW.raw_user_meta_data->>'name', ''),
            NULLIF(NEW.raw_user_meta_data->>'full_name', ''),   -- Google 로그인
            split_part(NEW.email, '@', 1)
        ),
        NULLIF(NEW.raw_user_meta_data->>'dept', '')
    )
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wms_on_auth_user_created ON auth.users;
CREATE TRIGGER wms_on_auth_user_created
    AFTER INSERT ON auth.users
    FOR EACH ROW EXECUTE FUNCTION public.wms_handle_new_user();

CREATE OR REPLACE FUNCTION public.wms_handle_user_email_change()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
BEGIN
    UPDATE public.wms_profiles SET email = NEW.email WHERE id = NEW.id;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wms_on_auth_user_email_changed ON auth.users;
CREATE TRIGGER wms_on_auth_user_email_changed
    AFTER UPDATE OF email ON auth.users
    FOR EACH ROW WHEN (OLD.email IS DISTINCT FROM NEW.email)
    EXECUTE FUNCTION public.wms_handle_user_email_change();

-- 4. 역할 판별 함수
-- 현재 로그인 사용자의 유효 역할 (비로그인: NULL)
CREATE OR REPLACE FUNCTION public.wms_current_role()
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT CASE
        WHEN auth.uid() IS NULL THEN NULL
        WHEN EXISTS (
            SELECT 1 FROM auth.users u, public.wms_app_settings s
            WHERE u.id = auth.uid()
              AND u.email_confirmed_at IS NOT NULL
              AND lower(u.email) = lower(s.master_email)
        ) THEN 'MASTER'
        ELSE (SELECT role FROM public.wms_profiles WHERE id = auth.uid())
    END;
$$;

CREATE OR REPLACE FUNCTION public.wms_role_level(r TEXT)
RETURNS INT
LANGUAGE sql IMMUTABLE
AS $$
    SELECT CASE r
        WHEN 'MASTER' THEN 5
        WHEN 'ADMIN' THEN 4
        WHEN 'MANAGER' THEN 3
        WHEN 'OPERATOR' THEN 2
        WHEN 'VIEWER' THEN 1
        ELSE 0
    END;
$$;

-- 현재 사용자가 min_role 이상인지
CREATE OR REPLACE FUNCTION public.wms_has_role(min_role TEXT)
RETURNS BOOLEAN
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT public.wms_role_level(public.wms_current_role()) >= public.wms_role_level(min_role);
$$;

-- 특정 사용자의 유효 역할 (역할 변경 권한 판단용)
CREATE OR REPLACE FUNCTION public.wms_role_of(target UUID)
RETURNS TEXT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT CASE
        WHEN EXISTS (
            SELECT 1 FROM auth.users u, public.wms_app_settings s
            WHERE u.id = target
              AND u.email_confirmed_at IS NOT NULL
              AND lower(u.email) = lower(s.master_email)
        ) THEN 'MASTER'
        ELSE (SELECT role FROM public.wms_profiles WHERE id = target)
    END;
$$;

-- 5. 내 프로필 (로그인 직후 앱이 호출. 승인 대기 사용자도 호출 가능)
CREATE OR REPLACE FUNCTION public.wms_my_profile()
RETURNS JSON
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
    SELECT json_build_object(
        'id', p.id,
        'email', p.email,
        'name', p.name,
        'dept', p.dept,
        'title', p.title,
        'role', public.wms_current_role(),
        'isMaster', public.wms_current_role() = 'MASTER',
        'masterEmail', (SELECT master_email FROM public.wms_app_settings)
    )
    FROM public.wms_profiles p
    WHERE p.id = auth.uid();
$$;

-- 6. 역할 변경 / 승인 (자기보다 낮은 역할의 사용자를, 자기보다 낮은 역할로만)
CREATE OR REPLACE FUNCTION public.wms_set_user_role(
    target UUID,
    new_role TEXT,
    new_dept TEXT DEFAULT NULL,
    new_title TEXT DEFAULT NULL
)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    caller_level INT := public.wms_role_level(public.wms_current_role());
    target_level INT := public.wms_role_level(public.wms_role_of(target));
    result JSON;
BEGIN
    IF auth.uid() IS NULL THEN
        RAISE EXCEPTION '로그인이 필요합니다.';
    END IF;
    IF target = auth.uid() THEN
        RAISE EXCEPTION '자기 자신의 역할은 변경할 수 없습니다.';
    END IF;
    IF new_role NOT IN ('PENDING', 'VIEWER', 'OPERATOR', 'MANAGER', 'ADMIN') THEN
        RAISE EXCEPTION '알 수 없는 역할입니다: %', new_role;
    END IF;
    IF caller_level < public.wms_role_level('MANAGER') THEN
        RAISE EXCEPTION '역할을 변경할 권한이 없습니다.';
    END IF;
    IF target_level >= caller_level THEN
        RAISE EXCEPTION '자신과 같거나 높은 역할의 사용자는 변경할 수 없습니다.';
    END IF;
    IF public.wms_role_level(new_role) >= caller_level THEN
        RAISE EXCEPTION '자신과 같거나 높은 역할은 부여할 수 없습니다.';
    END IF;

    UPDATE public.wms_profiles
    SET role = new_role,
        dept = COALESCE(new_dept, dept),
        title = COALESCE(new_title, title),
        approved_at = CASE WHEN role = 'PENDING' AND new_role <> 'PENDING' THEN NOW() ELSE approved_at END,
        approved_by = CASE WHEN role = 'PENDING' AND new_role <> 'PENDING' THEN auth.uid() ELSE approved_by END
    WHERE id = target
    RETURNING json_build_object('id', id, 'email', email, 'name', name, 'role', role, 'dept', dept, 'title', title)
    INTO result;

    IF result IS NULL THEN
        RAISE EXCEPTION '사용자를 찾을 수 없습니다.';
    END IF;
    RETURN result;
END;
$$;

-- 7. master 이전 (현재 master만 가능. 받는 계정은 메일 인증이 끝난 가입 계정이어야 함)
--    이전 후 기존 master는 ADMIN으로 남는다.
CREATE OR REPLACE FUNCTION public.wms_transfer_master(new_master_email TEXT)
RETURNS JSON
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
    new_master_id UUID;
    old_master_id UUID := auth.uid();
BEGIN
    IF public.wms_current_role() IS DISTINCT FROM 'MASTER' THEN
        RAISE EXCEPTION 'master 계정만 master를 이전할 수 있습니다.';
    END IF;

    SELECT id INTO new_master_id
    FROM auth.users
    WHERE lower(email) = lower(trim(new_master_email))
      AND email_confirmed_at IS NOT NULL;

    IF new_master_id IS NULL THEN
        RAISE EXCEPTION '메일 인증을 마친 가입 계정을 찾을 수 없습니다: %', new_master_email;
    END IF;
    IF new_master_id = old_master_id THEN
        RAISE EXCEPTION '이미 master 계정입니다.';
    END IF;

    UPDATE public.wms_app_settings SET master_email = lower(trim(new_master_email)), updated_at = NOW();
    -- 받는 쪽이 승인 전이었더라도 master로 즉시 동작하며, 기존 master는 ADMIN으로 남긴다
    UPDATE public.wms_profiles SET role = 'ADMIN', approved_at = COALESCE(approved_at, NOW())
    WHERE id IN (old_master_id, new_master_id);

    RETURN json_build_object('masterEmail', lower(trim(new_master_email)));
END;
$$;

-- 8. 접근 권한
-- 프로필: 본인 행 또는 MANAGER 이상만 조회. 본인은 이름·부서만 직접 수정 가능 (역할은 함수로만 변경)
ALTER TABLE public.wms_profiles ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_profiles FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.wms_profiles FROM authenticated;
GRANT SELECT ON public.wms_profiles TO authenticated;
GRANT UPDATE (name, dept) ON public.wms_profiles TO authenticated;

DROP POLICY IF EXISTS "wms_profiles_select" ON public.wms_profiles;
CREATE POLICY "wms_profiles_select" ON public.wms_profiles
    FOR SELECT TO authenticated
    USING (id = auth.uid() OR public.wms_has_role('MANAGER'));

DROP POLICY IF EXISTS "wms_profiles_update_own" ON public.wms_profiles;
CREATE POLICY "wms_profiles_update_own" ON public.wms_profiles
    FOR UPDATE TO authenticated
    USING (id = auth.uid()) WITH CHECK (id = auth.uid());

-- 앱 설정: 로그인 사용자만 조회, 변경은 wms_transfer_master 함수로만
ALTER TABLE public.wms_app_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.wms_app_settings FROM anon;
REVOKE INSERT, UPDATE, DELETE ON public.wms_app_settings FROM authenticated;
GRANT SELECT ON public.wms_app_settings TO authenticated;

DROP POLICY IF EXISTS "wms_app_settings_select" ON public.wms_app_settings;
CREATE POLICY "wms_app_settings_select" ON public.wms_app_settings
    FOR SELECT TO authenticated USING (true);

-- 함수 실행 권한: 로그인 사용자만
REVOKE EXECUTE ON FUNCTION public.wms_my_profile() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wms_set_user_role(UUID, TEXT, TEXT, TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wms_transfer_master(TEXT) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.wms_role_of(UUID) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.wms_my_profile() TO authenticated;
GRANT EXECUTE ON FUNCTION public.wms_set_user_role(UUID, TEXT, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wms_transfer_master(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.wms_role_of(UUID) TO authenticated;
-- wms_current_role / wms_has_role은 RLS 정책에서 쓰이므로 anon도 실행 가능해야 한다 (비로그인은 NULL/false 반환)
GRANT EXECUTE ON FUNCTION public.wms_current_role() TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.wms_has_role(TEXT) TO anon, authenticated;
