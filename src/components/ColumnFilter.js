// ==========================================
// 엑셀 자동 필터처럼 표의 열마다 "값 선택" 필터를 제공하는 공통 모듈
// ==========================================
// 사용법
//   const colFilter = createColumnFilter('master', [
//       { id: 'code', label: '품목코드', value: row => row.code },
//       ...
//   ]);
//   1) 데이터 필터 단계에서: rows = colFilter.apply(rows)   ← 페이지 나누기 전에 적용 (전체 데이터 대상)
//   2) 표를 그린 뒤: colFilter.attach(tableRootEl, () => 다른 조건만 적용된 전체 rows, onChange)
//      - <th data-filter-col="code"> 처럼 열 제목에 data-filter-col을 달아 두면 ▼ 버튼이 붙는다.
//      - 값 목록은 엑셀처럼 "다른 열의 필터를 적용한 결과" 기준으로 보여 준다.
//      - onChange()에서 첫 페이지로 이동 후 표를 다시 그리면 된다.
// 필터 상태는 화면(key)별로 모듈에 보관되어 탭을 다시 그려도 유지된다.

const EMPTY_LABEL = '(빈 값)';
const registry = new Map(); // key -> Map(colId -> Set<string> | null)

const escapeHtml = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const collator = new Intl.Collator('ko', { numeric: true, sensitivity: 'base' });

let openPopover = null;
const closePopover = () => {
    if (openPopover) {
        openPopover.remove();
        openPopover = null;
        document.removeEventListener('mousedown', onOutsideClick, true);
        document.removeEventListener('keydown', onEscape, true);
    }
};
const onOutsideClick = (e) => {
    if (openPopover && !openPopover.contains(e.target) && !e.target.closest('.col-filter-btn')) closePopover();
};
const onEscape = (e) => {
    if (e.key === 'Escape') { e.stopPropagation(); closePopover(); }
};

export const createColumnFilter = (key, columns) => {
    if (!registry.has(key)) registry.set(key, new Map());
    const selections = registry.get(key);
    const colById = new Map(columns.map(c => [c.id, c]));

    const valueOf = (col, row) => {
        const v = col.value(row);
        return v === null || v === undefined || String(v).trim() === '' ? EMPTY_LABEL : String(v).trim();
    };

    // exceptId 열을 제외한 나머지 열 필터를 모두 통과하는지
    const matches = (row, exceptId = null) => {
        for (const [id, set] of selections) {
            if (id === exceptId || !set) continue;
            const col = colById.get(id);
            if (col && !set.has(valueOf(col, row))) return false;
        }
        return true;
    };

    const activeCount = () => [...selections.entries()].filter(([id, set]) => set && colById.has(id)).length;

    const api = {
        apply: (rows) => (activeCount() ? rows.filter(r => matches(r)) : rows),
        isActive: () => activeCount() > 0,
        activeCount,
        clear: () => selections.clear(),

        /**
         * 열 제목에 필터 버튼을 붙이고 상태 표시를 갱신한다 (여러 번 호출해도 안전).
         * @param {HTMLElement} root 표를 포함한 요소
         * @param {() => Array} getRows 열 필터를 제외한 다른 조건(검색·분류 등)만 적용된 전체 행
         * @param {() => void} onChange 필터가 바뀌면 호출 (첫 페이지로 이동 후 다시 그리기)
         * @param {{ clearHost?: HTMLElement }} [options] 필터 해제 칩을 표시할 요소
         */
        attach(root, getRows, onChange, options = {}) {
            if (!root) return;
            root.querySelectorAll('th[data-filter-col]').forEach(th => {
                const colId = th.getAttribute('data-filter-col');
                if (!colById.has(colId)) return;
                let btn = th.querySelector(':scope > .col-filter-btn');
                if (!btn) {
                    btn = document.createElement('button');
                    btn.type = 'button';
                    btn.className = 'col-filter-btn no-print';
                    btn.setAttribute('aria-label', `${colById.get(colId).label} 필터`);
                    btn.addEventListener('click', (e) => {
                        e.preventDefault();
                        e.stopPropagation(); // 열 제목의 정렬 클릭 등과 분리
                        if (openPopover && openPopover.dataset.col === `${key}:${colId}`) { closePopover(); return; }
                        showPopover(btn, colId, getRows, onChange);
                    });
                    th.appendChild(btn);
                }
                const active = !!selections.get(colId);
                btn.textContent = active ? '▼' : '▾';
                btn.title = active ? `${colById.get(colId).label}: 필터 적용 중 (클릭하여 변경)` : `${colById.get(colId).label} 값으로 거르기`;
                btn.style.cssText = `margin-left:4px;padding:0 5px;border-radius:5px;font-size:10px;line-height:16px;vertical-align:middle;cursor:pointer;border:1px solid ${active ? '#2563eb' : '#cbd5e1'};background:${active ? '#2563eb' : '#fff'};color:${active ? '#fff' : '#64748b'};`;
            });

            const host = options.clearHost;
            if (host) {
                const n = activeCount();
                host.innerHTML = n ? `<button type="button" class="col-filter-clear no-print" style="padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:700;background:#eff6ff;color:#1d4ed8;border:1px solid #bfdbfe;cursor:pointer;">열 필터 ${n}개 적용 중 · 모두 해제 ✕</button>` : '';
                host.querySelector('.col-filter-clear')?.addEventListener('click', () => {
                    selections.clear();
                    closePopover();
                    onChange();
                });
            }
        }
    };

    const showPopover = (btn, colId, getRows, onChange) => {
        closePopover();
        const col = colById.get(colId);
        // 다른 열 필터를 적용한 행 기준의 값 목록과 개수
        const counts = new Map();
        for (const row of getRows()) {
            if (!matches(row, colId)) continue;
            const v = valueOf(col, row);
            counts.set(v, (counts.get(v) || 0) + 1);
        }
        const values = [...counts.keys()].sort((a, b) => (a === EMPTY_LABEL) - (b === EMPTY_LABEL) || collator.compare(a, b));
        const current = selections.get(colId);
        const checked = new Set(current ? values.filter(v => current.has(v)) : values);

        const pop = document.createElement('div');
        pop.dataset.col = `${key}:${colId}`;
        pop.className = 'col-filter-popover no-print';
        pop.style.cssText = 'position:fixed;z-index:9999;width:270px;max-width:calc(100vw - 16px);max-height:calc(100vh - 16px);background:#fff;border:1px solid #cbd5e1;border-radius:12px;box-shadow:0 12px 32px rgba(15,23,42,.25);font-size:12px;color:#0f172a;display:flex;flex-direction:column;';
        pop.innerHTML = `
            <div style="padding:8px 10px;border-bottom:1px solid #e2e8f0;font-weight:800;">${escapeHtml(col.label)} 필터</div>
            <div style="padding:8px 10px;">
                <input type="search" class="cf-search" placeholder="값 검색" style="width:100%;border:1px solid #cbd5e1;border-radius:8px;padding:5px 8px;font-size:12px;" />
            </div>
            <label style="display:flex;align-items:center;gap:6px;padding:4px 12px;font-weight:700;border-bottom:1px solid #f1f5f9;cursor:pointer;">
                <input type="checkbox" class="cf-all" /> <span>(모두 선택)</span>
            </label>
            <div class="cf-list" style="flex:1 1 auto;min-height:48px;max-height:260px;overflow-y:auto;padding:4px 0;"></div>
            <div style="display:flex;gap:6px;padding:8px 10px;border-top:1px solid #e2e8f0;">
                <button type="button" class="cf-clear" style="flex:1;padding:5px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;font-weight:700;cursor:pointer;">필터 해제</button>
                <button type="button" class="cf-cancel" style="flex:1;padding:5px;border-radius:8px;border:1px solid #cbd5e1;background:#fff;font-weight:700;cursor:pointer;">취소</button>
                <button type="button" class="cf-ok" style="flex:1;padding:5px;border-radius:8px;border:0;background:#2563eb;color:#fff;font-weight:800;cursor:pointer;">확인</button>
            </div>`;
        document.body.appendChild(pop);

        const listEl = pop.querySelector('.cf-list');
        const allEl = pop.querySelector('.cf-all');
        const searchEl = pop.querySelector('.cf-search');
        let shown = values;

        const renderList = () => {
            const q = searchEl.value.trim().toLowerCase();
            shown = q ? values.filter(v => v.toLowerCase().includes(q)) : values;
            listEl.innerHTML = shown.length
                ? shown.map((v, i) => `
                    <label style="display:flex;align-items:center;gap:6px;padding:3px 12px;cursor:pointer;">
                        <input type="checkbox" data-i="${i}" ${checked.has(v) ? 'checked' : ''} />
                        <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHtml(v)}">${escapeHtml(v)}</span>
                        <span style="color:#94a3b8;font-size:11px;">${counts.get(v).toLocaleString()}</span>
                    </label>`).join('')
                : '<div style="padding:10px 12px;color:#94a3b8;">일치하는 값이 없습니다.</div>';
            const shownChecked = shown.filter(v => checked.has(v)).length;
            allEl.checked = shown.length > 0 && shownChecked === shown.length;
            allEl.indeterminate = shownChecked > 0 && shownChecked < shown.length;
        };
        listEl.addEventListener('change', (e) => {
            const i = e.target.getAttribute('data-i');
            if (i === null) return;
            const v = shown[Number(i)];
            if (e.target.checked) checked.add(v); else checked.delete(v);
            renderList();
        });
        allEl.addEventListener('change', () => {
            shown.forEach(v => (allEl.checked ? checked.add(v) : checked.delete(v)));
            renderList();
        });
        searchEl.addEventListener('input', renderList);

        const commit = (selection) => {
            if (selection) selections.set(colId, selection); else selections.delete(colId);
            closePopover();
            onChange();
        };
        pop.querySelector('.cf-ok').addEventListener('click', () => {
            // 검색어가 있으면 엑셀처럼 "검색 결과 중 체크한 값"만 남긴다
            const picked = searchEl.value.trim() ? shown.filter(v => checked.has(v)) : values.filter(v => checked.has(v));
            if (picked.length === 0) { alert('하나 이상의 값을 선택하세요.'); return; }
            commit(picked.length === values.length ? null : new Set(picked)); // 전부 선택 = 필터 없음
        });
        pop.querySelector('.cf-clear').addEventListener('click', () => commit(null));
        pop.querySelector('.cf-cancel').addEventListener('click', closePopover);

        renderList();

        // 버튼 아래에 배치 (화면 밖으로 나가지 않게)
        const r = btn.getBoundingClientRect();
        const w = pop.offsetWidth, h = pop.offsetHeight;
        let left = Math.min(r.left, window.innerWidth - w - 8);
        let top = r.bottom + 4;
        if (top + h > window.innerHeight - 8) top = Math.max(8, r.top - h - 4);
        pop.style.left = `${Math.max(8, left)}px`;
        pop.style.top = `${top}px`;

        openPopover = pop;
        setTimeout(() => {
            document.addEventListener('mousedown', onOutsideClick, true);
            document.addEventListener('keydown', onEscape, true);
            searchEl.focus();
        }, 0);
    };

    return api;
};

// 탭 전환 등으로 화면이 바뀔 때 열린 필터 창 닫기
export const closeColumnFilterPopover = closePopover;
