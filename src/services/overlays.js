// ==========================================
// 화면을 덮는 창(모달 · 대화창 · 서랍) 공통 처리
// ==========================================
// 뒤로가기(머리글 ← · 브라우저/안드로이드 뒤로 · Alt+← · Backspace · 마우스 뒤로 단추)와 Esc가
// "맨 위에 열린 창 하나"를 닫을 때 쓴다 (main.js). 창마다 닫는 방법이 달라서(숨김 표시 · 요소 제거 · 닫을 때 정리할 것이 있는 창)
// 창이 가진 닫기 단추를 대신 눌러 준다 — 그래야 창이 하던 정리(카메라 끄기 · 저장 확인 · 기다리던 결과 돌려주기)가 그대로 돈다.
//
// 새 창을 만들 때 지킬 것:
//   - 덮개는 `fixed inset-0`로 만든다 (그래야 여기서 열린 창으로 알아본다).
//   - 닫기 단추에 `data-close`를 주거나, id·class 이름에 `close`를 넣는다(예: `xx-close`). 글자가 `닫기`·`취소`인 단추도 알아본다.
//     글자가 `×`뿐인 단추는 줄 지우기일 수 있어 닫기로 보지 않는다 — 꼭 `data-close`나 이름을 준다.
//   - 고르기 전에는 닫으면 안 되는 창은 덮개에 `data-back-lock`을 준다 (공용계정의 작업자 고르기 창).
//   - 자기 방문 기록 표시와 popstate 처리를 가진 편집기 창은 SELF_MANAGED에 넣는다 (여기서는 건드리지 않는다).

/** 스스로 방문 기록 표시를 넣고 뒤로가기를 처리하는 덮개: 혼합물 MSDS 작성 편집기 · 창고 평면도 편집기 */
const SELF_MANAGED = '#msds-editor-host, #w3-plan-host';
/** 이 폭 미만(스마트폰)에서는 떠 있는 창(할일 · 채팅 등)이 화면을 거의 덮으므로 뒤로가기로 닫는다 */
const FLOAT_AS_OVERLAY_MAX = 640;

/** @typedef {'none' | 'closed' | 'kept' | 'locked'} OverlayResult 열린 창 없음 · 닫음 · 닫지 못함(저장 확인을 취소했거나 닫는 방법을 모름) · 닫으면 안 되는 창 */

const isShown = (el) => {
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.pointerEvents === 'none' || Number(cs.opacity) === 0) return false;
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
};

/** 편집기 창(스스로 뒤로가기를 처리하는 창)이 열려 있는지 */
export const hasSelfManagedOverlay = () => [...document.querySelectorAll(SELF_MANAGED)].some(isShown);

const zOf = (el) => Number(getComputedStyle(el).zIndex) || 0;

/** 지금 열려 있는 창들 (편집기 창 제외) */
const openOverlays = () => {
    const list = [...document.querySelectorAll('.fixed.inset-0')].filter(el => !el.matches(SELF_MANAGED) && isShown(el));
    if (window.innerWidth < FLOAT_AS_OVERLAY_MAX) {
        document.querySelectorAll('#floating-tools .ft-head').forEach(head => { if (isShown(head.parentElement)) list.push(head.parentElement); });
    }
    return list;
};

/**
 * 맨 위에 열려 있는 창 (없으면 null). 위아래는 z-index, 같으면 문서에서 뒤에 있는 것이 위.
 * @returns {HTMLElement | null}
 */
export const topOverlay = () => openOverlays().reduce((top, el) => {
    if (!top) return el;
    const dz = zOf(el) - zOf(top);
    if (dz !== 0) return dz > 0 ? el : top;
    return (top.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING) ? el : top;
}, null);

/** 그 창이 아직 열려 있는지 (Esc를 창이 스스로 처리했는지 볼 때) */
export const isOverlayOpen = (el) => isShown(el);

// ---------- 닫기 단추 찾기 ----------
const EXPLICIT_CLOSE = '[data-dlg-close], [data-close], [data-x], .btn-close-modal, [aria-label="닫기"], [title="닫기"]';
const CLICKABLE = 'button, a, [role="button"]';
const X_MARKS = /[×✕✖✗]/g;
/** 닫기 단추에 붙이던 짧은 이름 (`ph-x` · `md-x` …). Tailwind의 `border-x` · `divide-x` 같은 이름과 겹치지 않게 앞 토막을 4자까지만 본다 */
const X_NAME = /^[a-z][a-z0-9]{0,3}-x$/;

const namesOf = (el) => `${el.id || ''} ${el.getAttribute('class') || ''}`.split(/\s+/).filter(Boolean);
/** id·class 이름 가운데 하이픈으로 나눈 한 토막이 그 낱말인 것이 있는지 (`xx-close` ○ · `n-closed` ×) */
const hasNamePart = (el, word) => namesOf(el).some(name => name.toLowerCase().split(/[-_]/).includes(word));
const hasXName = (el) => el.tagName === 'BUTTON' && namesOf(el).some(name => X_NAME.test(name));
const labelOf = (el) => (el.textContent || '').replace(/\s+/g, '');
/** 글자가 '닫기' · '✕ 닫기' · '닫기 (ESC)'인 단추. 글자가 ×뿐인 단추는 줄 지우기일 수 있어 이름·표시가 있을 때만 닫기로 본다 */
const isCloseLabel = (el) => ['닫기', '창닫기'].includes(labelOf(el).replace(X_MARKS, '').replace(/\(esc\)/i, ''));

/**
 * 그 창의 닫기 단추. 닫기(명시한 표시 → 이름 → 글자) 다음에 취소(표시 → 이름 → 글자) 순으로 찾는다.
 * 창 안에 겹쳐 있는 다른 창의 단추, 꺼져 있거나 보이지 않는 단추는 뺀다.
 */
const findCloseControl = (overlay) => {
    const isMine = (ctl) => {
        const owner = ctl.closest('.fixed.inset-0');
        return (!owner || owner === overlay || !overlay.contains(owner)) && !ctl.disabled && ctl.getClientRects().length > 0;
    };
    const pick = (selector, test = () => true) => [...overlay.querySelectorAll(selector)].find(ctl => isMine(ctl) && test(ctl)) || null;
    return pick(EXPLICIT_CLOSE)
        || pick('[id*="close" i], [class*="close" i]', ctl => hasNamePart(ctl, 'close'))
        || pick('button[class*="-x"]', hasXName)
        || pick(CLICKABLE, isCloseLabel)
        || pick('[data-cancel]')
        || pick('[id*="cancel" i], [class*="cancel" i]', ctl => hasNamePart(ctl, 'cancel'))
        || pick(CLICKABLE, ctl => labelOf(ctl) === '취소');
};

/**
 * 창 하나를 닫는다.
 * @param {HTMLElement} overlay
 * @returns {OverlayResult}
 */
export const closeOverlay = (overlay) => {
    if (!isShown(overlay)) return 'none';
    if (overlay.matches('[data-back-lock]')) return 'locked';
    const control = findCloseControl(overlay);
    if (control) {
        control.click();
        return isShown(overlay) ? 'kept' : 'closed'; // 남아 있으면: 저장 확인을 취소했거나 곧 닫힌다 — 다른 방법으로 억지로 닫지 않는다
    }
    // 닫기 단추가 없는 창: 덮개 바깥을 누른 것처럼 (배경을 누르면 닫히는 창 · 스마트폰 메뉴 서랍 · 아무 곳이나 누르면 닫히는 크게 보기)
    ['mousedown', 'mouseup', 'click'].forEach(type => overlay.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window })));
    if (!isShown(overlay)) return 'closed';
    // 화면과 함께 다시 그려지는 창(본문 안)은 숨겨도 다음에 열 때 다시 채워진다. 본문 밖의 창은 정리할 것이 있을 수 있어 그대로 둔다
    if (overlay.closest('#app')) {
        overlay.classList.add('hidden');
        overlay.classList.remove('flex');
        return 'closed';
    }
    return 'kept';
};

/**
 * 맨 위에 열린 창 하나를 닫는다.
 * @returns {OverlayResult}
 */
export const closeTopOverlay = () => {
    const top = topOverlay();
    return top ? closeOverlay(top) : 'none';
};
