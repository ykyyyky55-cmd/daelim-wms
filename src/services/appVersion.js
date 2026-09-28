// ==========================================
// 웹 버전 표시 · 새 버전 알림
// ==========================================
// 빌드할 때 vite.config.js가 커밋 번호와 빌드 시각을 __APP_VERSION__으로 넣고 dist/version.json도 만든다.
// 열려 있는 화면(PC 앱·안드로이드 앱·브라우저)이 가끔 version.json을 확인해서, 새로 배포되었으면
// 아래쪽에 [새로고침] 안내를 띄운다. 개발 서버(commit 'dev')에서는 확인하지 않는다.
/* global __APP_VERSION__ */
export const APP_VERSION = typeof __APP_VERSION__ !== 'undefined' ? __APP_VERSION__ : { commit: 'dev', builtAt: '' };

const pad = (n) => String(n).padStart(2, '0');
const fmtTime = (iso) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return '';
    return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};

/** 예: 'f2da016 · 2026.09.28 22:37 배포' */
export const versionLabel = (v = APP_VERSION) => v.commit === 'dev' ? '개발 서버' : `${v.commit}${v.builtAt ? ` · ${fmtTime(v.builtAt)} 배포` : ''}`;

const CHECK_MS = 10 * 60 * 1000; // 10분마다, 그리고 창으로 돌아올 때
let lastCheck = 0;
let notified = false;

const showBanner = (latest) => {
    if (notified || document.getElementById('app-update-banner')) return;
    notified = true;
    const el = document.createElement('div');
    el.id = 'app-update-banner';
    el.className = 'fixed bottom-4 left-1/2 -translate-x-1/2 z-[95] w-[calc(100%-2rem)] max-w-md bg-slate-900 text-white rounded-2xl shadow-xl px-4 py-3 flex items-center gap-3 text-sm';
    el.innerHTML = `<div class="flex-1 min-w-0"><div class="font-bold">새 버전이 배포되었습니다</div><div class="text-xs text-slate-300 truncate">${versionLabel(latest)} · 작성 중인 내용을 저장한 뒤 새로고침하세요</div></div>
        <button type="button" data-reload class="px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-600 font-bold text-xs whitespace-nowrap">새로고침</button>
        <button type="button" data-later class="px-2 py-1.5 rounded-lg text-slate-300 hover:text-white text-xs whitespace-nowrap">나중에</button>`;
    el.addEventListener('click', (e) => {
        if (e.target.closest('[data-reload]')) location.reload();
        else if (e.target.closest('[data-later]')) el.remove();
    });
    document.body.appendChild(el);
};

/** 새 버전 확인 → 'new'(안내 띄움) | 'latest' | 'skip'(개발 서버) | 'error'. manual이면 [나중에]로 닫은 안내도 다시 띄운다. */
export const checkForUpdate = async ({ manual = false } = {}) => {
    if (APP_VERSION.commit === 'dev' || APP_VERSION.commit === 'local') return 'skip';
    if (!navigator.onLine) return 'error';
    lastCheck = Date.now();
    try {
        const res = await fetch(`./version.json?t=${Date.now()}`, { cache: 'no-store' });
        if (!res.ok) return 'error';
        const latest = await res.json();
        if (latest?.commit && latest.commit !== APP_VERSION.commit) {
            if (manual) notified = false;
            showBanner(latest);
            return 'new';
        }
        return 'latest';
    } catch { return 'error'; } // 오프라인 등: 다음에 다시 확인
};

export const startUpdateCheck = () => {
    if (APP_VERSION.commit === 'dev') return;
    setInterval(checkForUpdate, CHECK_MS);
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible' && Date.now() - lastCheck > 60 * 1000) checkForUpdate();
    });
};
