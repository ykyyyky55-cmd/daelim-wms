// ==========================================
// 현황판 전체화면 보기 (월간 실적 현황판 · 월간 불량률 현황 공용)
// ==========================================
// 상단 메뉴·사이드바·떠 있는 버튼을 숨기고 화면 가득 (브라우저 전체화면 + body.an-full).
// ESC(브라우저 전체화면 해제) · [✕ 전체화면 닫기] · 다른 메뉴로 이동하면 원래대로.
let ownerHash = ''; // 전체화면을 켠 화면의 탭 해시 (예: '#analytics') — 다른 탭으로 가면 끈다

const ensureSetup = () => {
    if (document.getElementById('an-full-css')) return;
    const st = document.createElement('style');
    st.id = 'an-full-css';
    st.textContent = `body.an-full #header-container, body.an-full #sidebar-container, body.an-full #floating-tools, body.an-full #btn-scroll-top { display: none !important; }
        body.an-full #main-content { max-width: none !important; padding-top: 12px !important; }
        #an-full-exit { display: none; } body.an-full #an-full-exit { display: flex; }`;
    document.head.appendChild(st);
    document.addEventListener('fullscreenchange', () => { if (!document.fullscreenElement) setBoardFullscreen(false); });
    // 브라우저 전체화면이 막혀 화면만 넓힌 경우에도 ESC로 복원
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && document.body.classList.contains('an-full')) setBoardFullscreen(false); });
    window.addEventListener('hashchange', () => { if (ownerHash && !location.hash.startsWith(ownerHash)) setBoardFullscreen(false); });
    const b = document.createElement('button');
    b.id = 'an-full-exit';
    b.type = 'button';
    b.className = 'fixed top-3 right-3 z-[80] px-3 py-1.5 rounded-lg bg-slate-900/80 hover:bg-slate-900 text-white text-xs font-bold items-center gap-1.5 shadow-lg no-print';
    b.innerHTML = '✕ 전체화면 닫기 <span class="opacity-70">(ESC)</span>';
    b.addEventListener('click', () => setBoardFullscreen(false));
    document.body.appendChild(b);
};

/**
 * 전체화면 켜기·끄기
 * @param on    true = 켜기
 * @param hash  켜는 화면의 탭 해시 (다른 탭으로 이동하면 자동으로 끔)
 */
export const setBoardFullscreen = (on, hash = location.hash.split('?')[0] || '') => {
    ensureSetup();
    const was = document.body.classList.contains('an-full');
    if (on) ownerHash = hash;
    document.body.classList.toggle('an-full', on);
    if (on && !was) {
        document.documentElement.requestFullscreen?.().catch(() => { /* 막히면 화면만 넓힘 (ESC로 복원) */ });
        window.scrollTo({ top: 0 });
    } else if (!on && document.fullscreenElement) {
        document.exitFullscreen?.().catch(() => {});
    }
    window.dispatchEvent(new Event('resize')); // 그래프 크기 다시 맞춤
};

export const isBoardFullscreen = () => document.body.classList.contains('an-full');

/** [전체화면] 버튼 HTML (id 지정) */
export const fullscreenButtonHtml = (id) => `<button type="button" id="${id}" class="px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm" title="상단 메뉴를 숨기고 현황판만 전체화면으로 (ESC로 복원)"><i data-lucide="maximize" class="w-4 h-4"></i>전체화면</button>`;
