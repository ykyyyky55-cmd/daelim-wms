// ==========================================
// 앱 설치 (설치형 웹앱 PWA) — 윈도우(Edge·Chrome) · 안드로이드(Chrome) · 아이폰(Safari 안내)
// ==========================================
// 브라우저가 설치할 수 있다고 알려 주는 beforeinstallprompt 이벤트를 첫 화면 전에 잡아 두었다가
// [📲 앱 설치]를 누르면 설치 창을 띄운다. 이미 설치된 앱으로 열었으면(standalone) 버튼을 숨긴다.
// 아이폰·아이패드 Safari는 이 이벤트가 없어 '공유 → 홈 화면에 추가' 안내를 보여 준다.
let deferred = null;
const listeners = new Set();
const notify = () => listeners.forEach(fn => { try { fn(); } catch (e) { console.warn('[앱 설치] 알림 처리 실패:', e.message); } });

window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault(); // 브라우저 기본 배너 대신 앱의 버튼으로
    deferred = e;
    notify();
});
window.addEventListener('appinstalled', () => { deferred = null; notify(); });

/** 설치된 앱(독립 창)으로 실행 중인지 */
export const isStandalone = () => window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone === true
    || document.referrer.startsWith('android-app://'); // 안드로이드 APK(TWA)로 연 경우
const isIos = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/** 버튼을 보여 줄지: 'prompt'(바로 설치 창) · 'ios'(안내) · 'manual'(브라우저 메뉴 안내) · ''(숨김) */
export const installMode = () => {
    if (isStandalone()) return '';
    if (deferred) return 'prompt';
    if (isIos()) return 'ios';
    return 'manual';
};

/** 설치 상태가 바뀌면 알림 (버튼 다시 그리기) */
export const onInstallChange = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

/** 설치 창 띄우기 → 'accepted' | 'dismissed' | 'unavailable' */
export const promptInstall = async () => {
    if (!deferred) return 'unavailable';
    const ev = deferred;
    deferred = null;
    ev.prompt();
    const choice = await ev.userChoice.catch(() => ({ outcome: 'dismissed' }));
    notify();
    return choice?.outcome || 'dismissed';
};

/** 설치 방법 안내 창 (아이폰 또는 브라우저가 설치 창을 주지 않을 때) */
export const showInstallGuide = () => {
    document.getElementById('pwa-guide')?.remove();
    const ios = isIos();
    const wrap = document.createElement('div');
    wrap.id = 'pwa-guide';
    wrap.className = 'fixed inset-0 z-[90] bg-slate-900/60 flex items-end sm:items-center justify-center p-3';
    wrap.innerHTML = `<div class="bg-white rounded-2xl shadow-xl w-full max-w-md p-5 space-y-3 text-sm text-slate-700">
        <div class="flex items-center gap-3"><img src="./icon-192.png" alt="" class="w-12 h-12 rounded-xl" /><div><div class="font-black text-slate-900">대림오일 스마트 WMS 앱 설치</div><div class="text-xs text-slate-500">설치하면 아이콘으로 바로 열리고 주소창 없이 앱처럼 씁니다.</div></div></div>
        ${ios ? `<ol class="list-decimal pl-5 space-y-1.5">
            <li><b>Safari</b>로 이 주소를 엽니다 (다른 앱 안의 브라우저에서는 안 됩니다).</li>
            <li>아래(또는 위)의 <b>공유 버튼</b>(네모에서 위쪽 화살표 ⬆)을 누릅니다.</li>
            <li><b>홈 화면에 추가</b> → <b>추가</b>를 누르면 홈 화면에 대림 아이콘이 생깁니다.</li></ol>`
        : `<div class="space-y-2">
            <div><b>윈도우 PC (Edge·Chrome)</b>: 주소창 오른쪽의 <b>앱 설치 아이콘</b>(모니터 모양 ⊕)을 누르거나, 메뉴(⋯ / ⋮) → <b>앱</b> → <b>이 사이트를 앱으로 설치</b>. 시작 메뉴·작업표시줄에 대림 아이콘이 생깁니다.</div>
            <div><b>안드로이드 (Chrome)</b>: 메뉴(⋮) → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>. 회사에서 받은 <b>설치 파일(APK)</b>이 있으면 그 파일로 설치해도 됩니다.</div>
            <div class="text-xs text-slate-500">설치 버튼이 안 보이면 이미 설치되어 있거나, 시크릿 창·앱 안 브라우저(카카오톡 등)로 연 경우입니다. Chrome·Edge·Samsung 인터넷으로 다시 여세요.</div></div>`}
        <div class="flex justify-end"><button type="button" data-close class="px-4 py-2 rounded-lg bg-slate-800 text-white font-bold text-sm">확인</button></div>
    </div>`;
    document.body.appendChild(wrap);
    wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) wrap.remove(); });
};

/** [📲 앱 설치] 버튼 누름 처리 */
export const handleInstallClick = async (showToast = () => {}) => {
    if (installMode() === 'prompt') {
        const r = await promptInstall();
        if (r === 'accepted') showToast('📲 앱을 설치했습니다. 바탕화면·시작 메뉴(폰은 홈 화면)의 대림 아이콘으로 여세요.');
        else if (r === 'unavailable') showInstallGuide();
        return;
    }
    showInstallGuide();
};
