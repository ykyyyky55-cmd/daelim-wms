// ==========================================
// 끌어서 옮기기 (창고 배치도) — 마우스·터치 공용 pointer 이벤트
// ==========================================
// · 끌기 후보는 부르는 쪽이 정한다(begin): 3D에서 고른 칸, 오른쪽 목록의 품목 줄(터치는 손잡이).
// · 누른 채 6px 넘게 움직이면 끌기 시작. 이동·놓기는 window에서 받는다
//   (터치는 누른 요소로 계속 이벤트가 오고, 마우스는 캔버스 밖 창고 칸 위에서도 받아야 하므로).
// · 놓을 곳은 targetAt(x, y, source)이 정한다 — 3D 라인(광선) 또는 data-drop-loc 요소(창고 칸·구획 목록).
// · 끄는 동안 손가락·커서 옆에 품목과 놓을 곳을 적은 꼬리표가 따라다닌다.

const START_PX = 6;

/**
 * @typedef {{ fromLoc: string, codes: string[], label: string, cell: number }} DragSource
 *   cell = 끌어 온 칸 번호 (목록의 품목 줄이면 -1)
 * @typedef {{ loc: string, label: string, zoneId: string, slot: number, cellIndex: number, ok: boolean, note: string, whId?: string }} DropTarget
 *   slot = 놓을 칸(채우는 쪽에서 센 칸, 0부터 — 칸을 가리키지 않았으면 -1), cellIndex = 놓일 칸 번호(-1 = 정해지지 않음),
 *   whId = 라인이 없는 동의 바닥에 놓을 때 그 창고 (3D에서 동 전체에 테두리를 그린다)
 * @typedef {{
 *   targetAt: (x: number, y: number, source: DragSource) => DropTarget|null,
 *   onDrop: (source: DragSource, target: DropTarget) => void,
 *   onStart?: (source: DragSource) => void,
 *   onMove?: (target: DropTarget|null, x: number, y: number) => void,
 *   onEnd?: (wasDragging: boolean) => void
 * }} DragHooks
 */

/** @param {DragHooks} hooks */
export const createDragDrop = (hooks) => {
    /** @type {{ source: DragSource, pointerId: number, isTouch: boolean, x0: number, y0: number, dragging: boolean, tag: HTMLElement|null }|null} */
    let cur = null;

    const makeTag = (source) => {
        const el = document.createElement('div');
        // 위치 관련 스타일은 직접 준다 (Tailwind CDN이 클래스를 만들기 전 한 프레임 동안 본문 아래에 끼지 않게)
        Object.assign(el.style, { position: 'fixed', left: '0px', top: '0px', zIndex: '95', pointerEvents: 'none', maxWidth: '260px' });
        el.className = 'px-3 py-2 rounded-xl shadow-xl text-xs font-bold bg-slate-900 text-white border-2 border-slate-500';
        el.innerHTML = '<div class="truncate">📦 <span data-tag="label"></span></div><div data-tag="to" class="font-normal mt-0.5"></div>';
        el.querySelector('[data-tag="label"]').textContent = source.label;
        document.body.appendChild(el);
        return el;
    };

    const placeTag = (x, y, target) => {
        const { tag, isTouch } = cur;
        const to = tag.querySelector('[data-tag="to"]');
        to.textContent = !target ? '놓을 칸·창고로 끌어가세요 (화면 가장자리로 끌면 더 넓게 봅니다)' : target.ok ? `→ ${target.label}` : (target.note || '여기에는 놓을 수 없습니다');
        tag.style.borderColor = target?.ok ? '#34d399' : target ? '#f87171' : '';
        // 터치는 손가락에 가리지 않게 위쪽, 마우스는 커서 오른쪽 아래. 화면 밖으로 나가지 않게 맞춘다
        const w = tag.offsetWidth, h = tag.offsetHeight;
        const left = Math.min(Math.max(8, isTouch ? x - w / 2 : x + 16), window.innerWidth - w - 8);
        const top = Math.min(Math.max(8, isTouch ? y - h - 28 : y + 18), window.innerHeight - h - 8);
        tag.style.left = `${left}px`;
        tag.style.top = `${top}px`;
    };

    const update = (x, y) => {
        const target = hooks.targetAt(x, y, cur.source);
        placeTag(x, y, target);
        hooks.onMove?.(target, x, y);
    };

    const finish = () => {
        if (!cur) return false;
        const wasDragging = cur.dragging;
        cur.tag?.remove();
        cur = null;
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        window.removeEventListener('pointercancel', onCancel);
        window.removeEventListener('keydown', onKey);
        window.removeEventListener('blur', onCancel);
        document.body.style.userSelect = '';
        hooks.onEnd?.(wasDragging);
        return wasDragging;
    };

    function onMove(ev) {
        if (!cur || ev.pointerId !== cur.pointerId) return;
        // 창 밖에서 마우스 버튼을 떼어 pointerup을 못 받은 경우
        if (!cur.isTouch && ev.buttons === 0) { finish(); return; }
        if (!cur.dragging) {
            if (Math.hypot(ev.clientX - cur.x0, ev.clientY - cur.y0) < START_PX) return;
            cur.dragging = true;
            cur.tag = makeTag(cur.source);
            window.getSelection?.()?.removeAllRanges();
            hooks.onStart?.(cur.source);
        }
        update(ev.clientX, ev.clientY);
    }
    function onUp(ev) {
        if (!cur || ev.pointerId !== cur.pointerId) return;
        const { source, dragging } = cur;
        const target = dragging ? hooks.targetAt(ev.clientX, ev.clientY, source) : null;
        finish();
        if (target) hooks.onDrop(source, target);
    }
    function onCancel() { finish(); }
    function onKey(ev) { if (ev.key === 'Escape') finish(); }

    /**
     * 끌기 후보 등록 (pointerdown에서 부른다). 움직이지 않고 떼면 아무 일도 없다(누르기는 원래 처리대로).
     * @param {PointerEvent} ev
     * @param {DragSource} source
     */
    const begin = (ev, source) => {
        finish();
        cur = { source, pointerId: ev.pointerId, isTouch: ev.pointerType !== 'mouse', x0: ev.clientX, y0: ev.clientY, dragging: false, tag: null };
        // 커서가 창 밖으로 나가도 이동·놓기를 받게 잡아 둔다 (터치는 원래 누른 요소로 온다). 놓을 곳은 좌표로 찾으므로 영향 없음
        try { ev.target.setPointerCapture?.(ev.pointerId); } catch (e) { console.warn('[끌어서 옮기기] 포인터 잡기 실패', e.message); }
        document.body.style.userSelect = 'none'; // 끄는 동안 글자가 선택되지 않게
        window.addEventListener('pointermove', onMove);
        window.addEventListener('pointerup', onUp);
        window.addEventListener('pointercancel', onCancel);
        window.addEventListener('keydown', onKey);
        window.addEventListener('blur', onCancel);
    };

    return { begin, cancel: finish, isActive: () => !!cur, isDragging: () => !!cur?.dragging };
};
