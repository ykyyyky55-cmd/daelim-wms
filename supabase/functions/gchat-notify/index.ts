// WMS → 구글 챗 스페이스 알림 (아침 알림 요약 등, 앱 services/morningDigest.js가 부른다)
// 보안
//  - Supabase JWT 검사를 켠다(verify_jwt=true): 로그인한 사용자만 부를 수 있다.
//  - 부른 사람이 현장 작업자 이상(wms_has_role('OPERATOR'))인지 그 사람의 토큰으로 다시 확인한다.
//  - 웹훅 주소는 비밀 표 wms_notify_secret(사용자 정책 없음)에만 있고, 이 함수가 서비스 키로 읽는다. 앱에는 주소를 돌려주지 않는다.
//  - 보내는 곳은 https://chat.googleapis.com/ 웹훅뿐(저장 함수 wms_set_gchat_webhook가 검사), 글은 4,000자까지.
import { createClient } from 'npm:@supabase/supabase-js@2';

const URL_ = Deno.env.get('SUPABASE_URL') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const CORS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

Deno.serve(async (req) => {
    if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
    if (req.method !== 'POST') return json({ error: 'POST만 받습니다.' }, 405);
    const auth = req.headers.get('Authorization') ?? '';
    if (!auth) return json({ error: '로그인이 필요합니다.' }, 401);
    const user = createClient(URL_, ANON, { global: { headers: { Authorization: auth } } });
    const { data: allowed, error: roleErr } = await user.rpc('wms_has_role', { min_role: 'OPERATOR' });
    if (roleErr || !allowed) return json({ error: '보낼 권한이 없습니다 (현장 작업자 이상).' }, 403);

    let text = '';
    try { text = String((await req.json())?.text ?? '').trim(); } catch { /* 빈 글 */ }
    if (!text) return json({ error: '보낼 글이 없습니다.' }, 400);
    if (text.length > 4000) text = `${text.slice(0, 3990)}\n…(생략)`;

    const admin = createClient(URL_, SERVICE);
    const { data: secret } = await admin.from('wms_notify_secret').select('value').eq('id', 'GCHAT_WEBHOOK').maybeSingle();
    const hook = String(secret?.value ?? '');
    if (!/^https:\/\/chat\.googleapis\.com\//.test(hook)) return json({ error: '구글 챗 웹훅이 설정되지 않았습니다.' }, 404);

    const res = await fetch(hook, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ text }) });
    if (!res.ok) {
        const detail = (await res.text()).slice(0, 300);
        console.warn('[gchat-notify] 구글 챗 응답', res.status, detail);
        return json({ error: `구글 챗이 받지 않았습니다 (${res.status}).` }, 502);
    }
    return json({ ok: true });
});
