// 현장 공용계정 만들기 · 비밀번호 바꾸기 (앱 services/auth.js createSharedAccount · resetSharedPassword가 부른다)
// 보안
//  - Supabase JWT 검사를 켠다(verify_jwt=true): 로그인한 사용자만 부를 수 있다.
//  - 부른 사람이 총괄 관리자 이상(wms_has_role('ADMIN'))인지 그 사람의 토큰으로 다시 확인한다.
//  - 계정은 서비스 키로 만든다(메일 인증 없이 바로 사용). 역할은 현장 작업자(OPERATOR)로 고정, wms_profiles.is_shared = true.
//  - 비밀번호 바꾸기는 공용계정(is_shared)만 — 개인 계정의 비밀번호는 이 함수로 바꿀 수 없다.
//  - 비밀번호는 Supabase Auth에만 저장하고 기록(log)에 남기지 않는다.
// 로그인 이메일 = wms.<아이디>@daelimoil.co.kr (앱 services/roles.js sharedEmailOf와 같은 규칙, 받는 메일함 없음)
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const SHARED_EMAIL_DOMAIN = 'daelimoil.co.kr';
const SHARED_ID_RE = /^[a-z0-9][a-z0-9._-]{2,19}$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 72;
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const passwordError = (password: string) =>
    password.length < MIN_PASSWORD ? `비밀번호는 ${MIN_PASSWORD}자 이상 입력해주세요.`
        : password.length > MAX_PASSWORD ? `비밀번호는 ${MAX_PASSWORD}자까지 쓸 수 있습니다.` : '';

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'POST만 받습니다.' }, 405);
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth) return json({ error: '로그인이 필요합니다.' }, 401);

    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
    const { data: allowed, error: roleErr } = await user.rpc('wms_has_role', { min_role: 'ADMIN' });
    if (roleErr || !allowed) return json({ error: '공용계정은 총괄 관리자 이상만 만들거나 바꿀 수 있습니다.' }, 403);
    const { data: caller } = await user.auth.getUser();
    const callerId = caller?.user?.id ?? null;

    let body: Record<string, unknown> = {};
    try { body = await req.json(); } catch { return json({ error: '요청 내용을 읽지 못했습니다.' }, 400); }
    const action = String(body.action ?? '');
    const password = String(body.password ?? '');
    const pwError = passwordError(password);
    if (pwError) return json({ error: pwError }, 400);

    const admin = createClient(URL_, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

    if (action === 'create') {
        const loginId = String(body.loginId ?? '').trim().toLowerCase();
        const name = String(body.name ?? '').trim().slice(0, 20);
        if (!SHARED_ID_RE.test(loginId)) return json({ error: '아이디는 영문 소문자·숫자로 3~20자입니다 (점·밑줄·하이픈 가능).' }, 400);
        if (!name) return json({ error: '계정 이름을 입력해주세요.' }, 400);
        const email = `wms.${loginId}@${SHARED_EMAIL_DOMAIN}`;

        const { data: created, error: createErr } = await admin.auth.admin.createUser({
            email, password, email_confirm: true, user_metadata: { name, shared: true }
        });
        if (createErr || !created?.user) {
            const message = createErr?.message ?? '';
            if (/already|registered|exists/i.test(message)) return json({ error: `이미 있는 아이디입니다: ${loginId}` }, 409);
            console.warn('[shared-account] 계정 만들기 실패', message);
            return json({ error: `계정을 만들지 못했습니다: ${message || '알 수 없는 오류'}` }, 502);
        }

        // 프로필 줄은 auth.users 트리거(wms_handle_new_user)가 만든다 — 공용계정 표시와 역할을 채운다
        const { data: profile, error: profileErr } = await admin.from('wms_profiles')
            .update({ name, role: 'OPERATOR', title: '현장 공용계정', is_shared: true, approved_at: new Date().toISOString(), approved_by: callerId })
            .eq('id', created.user.id).select('id').maybeSingle();
        if (profileErr || !profile) {
            // 반쯤 만들어진 계정을 남기지 않는다
            await admin.auth.admin.deleteUser(created.user.id);
            console.warn('[shared-account] 프로필 설정 실패', profileErr?.message);
            return json({ error: '계정 설정에 실패해 만들던 계정을 지웠습니다. 다시 시도하세요.' }, 502);
        }
        return json({ ok: true, id: created.user.id, loginId, name });
    }

    if (action === 'password') {
        const userId = String(body.userId ?? '');
        if (!userId) return json({ error: '계정이 지정되지 않았습니다.' }, 400);
        const { data: target } = await admin.from('wms_profiles').select('id, is_shared').eq('id', userId).maybeSingle();
        if (!target?.is_shared) return json({ error: '공용계정의 비밀번호만 바꿀 수 있습니다.' }, 403);
        const { error: updateErr } = await admin.auth.admin.updateUserById(userId, { password });
        if (updateErr) {
            console.warn('[shared-account] 비밀번호 변경 실패', updateErr.message);
            return json({ error: `비밀번호를 바꾸지 못했습니다: ${updateErr.message}` }, 502);
        }
        return json({ ok: true });
    }

    return json({ error: '알 수 없는 요청입니다.' }, 400);
});
