// ==========================================
// 새 품목 빠른 등록 — 품목을 고르는 검색 목록 어디서나 [＋ 새 품목 추가]로 연다
// ==========================================
// 품명만 넣어 등록하면 임시코드(TM + 숫자·영문 4자리 = 6자리, 예: TM7K2A)를 발행해 품목 마스터에 넣고 바로 그 품목을 고른다.
// 임시코드 품목은 품목 마스터 관리에서 정식 코드 품목과 합치거나(품목 합치기) 정보를 채운다 (services/erpMap.js isTempItem이 임시코드로 본다).
import { state, createTempMasterItem, newTempItemCode } from '../services/db.js';
import { MASTER_CATEGORIES } from '../services/searchUtils.js';
import { ROLE_LEVEL } from '../services/auth.js';
import { esc } from '../services/html.js';

/** 새 품목을 등록할 수 있는지 (현장 작업자 이상 — 품목 마스터 추가 권한과 같다) */
export const canAddItem = () => (ROLE_LEVEL[state.currentUser?.role] || 0) >= ROLE_LEVEL.OPERATOR || !state.currentUser?.role;

const UNITS = ['EA', 'L', 'KG', 'BOX', 'SET', 'ROLL', 'M'];

/**
 * 새 품목 등록 창을 연다.
 * @param {{ name?: string, category?: string }} [init] 처음 채워 둘 품명·분류
 * @returns {Promise<object|null>} 등록한 품목 (취소하면 null)
 */
export const openQuickItemDialog = ({ name = '', category = '' } = {}) => new Promise((resolve) => {
    const code = newTempItemCode();
    const wrap = document.createElement('div');
    wrap.id = 'quick-item-dialog';
    wrap.className = 'fixed inset-0 z-[90] bg-black/50 flex items-center justify-center p-4';
    wrap.innerHTML = `<form class="bg-white rounded-xl shadow-xl max-w-sm w-full p-4 space-y-3 text-sm">
        <div class="font-black text-base">새 품목 추가</div>
        <div class="text-xs text-slate-500">임시코드 <b class="font-mono text-blue-600">${esc(code)}</b>로 품목 마스터에 등록하고 바로 씁니다. 나중에 품목 마스터 관리에서 정보를 채우거나 정식 품목과 합칠 수 있습니다.</div>
        <label class="block"><span class="font-bold text-slate-600">품명 *</span><input id="qi-name" value="${esc(name)}" maxlength="120" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" autocomplete="off" /></label>
        <div class="grid grid-cols-2 gap-2">
            <label class="block"><span class="font-bold text-slate-600">분류</span><select id="qi-cat" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5">${MASTER_CATEGORIES.map(c => `<option ${c === (category || '기타') ? 'selected' : ''}>${esc(c)}</option>`).join('')}</select></label>
            <label class="block"><span class="font-bold text-slate-600">단위</span><input id="qi-unit" list="qi-units" value="EA" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 uppercase" /><datalist id="qi-units">${UNITS.map(u => `<option value="${u}"></option>`).join('')}</datalist></label>
        </div>
        <label class="block"><span class="font-bold text-slate-600">규격 (선택)</span><input id="qi-spec" maxlength="80" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" autocomplete="off" /></label>
        <div id="qi-same" class="text-xs text-amber-700 font-bold"></div>
        <div class="flex justify-end gap-2"><button type="button" id="qi-cancel" class="px-3 py-1.5 border border-slate-300 rounded-lg font-bold">취소</button>
            <button type="submit" id="qi-ok" class="px-3 py-1.5 bg-blue-600 text-white rounded-lg font-bold">등록하고 사용</button></div>
    </form>`;
    document.body.appendChild(wrap);
    const $ = (sel) => wrap.querySelector(sel);
    const done = (item) => { wrap.remove(); resolve(item); };
    // 같은 이름의 품목이 이미 있으면 알려 준다 (그래도 등록은 할 수 있다)
    const showSame = () => {
        const text = $('#qi-name').value.trim().toLowerCase();
        const same = text ? state.master.filter(m => String(m.name || '').trim().toLowerCase() === text).slice(0, 3) : [];
        $('#qi-same').textContent = same.length ? `같은 이름의 품목이 이미 있습니다: ${same.map(m => `[${m.code}]`).join(' ')}` : '';
    };
    // 원료·원액은 L가 기준 단위
    $('#qi-cat').addEventListener('change', () => { const isLiquid = ['원료', '원액'].includes($('#qi-cat').value); if (isLiquid && $('#qi-unit').value.toUpperCase() === 'EA') $('#qi-unit').value = 'L'; });
    $('#qi-name').addEventListener('input', showSame);
    $('#qi-cancel').addEventListener('click', () => done(null));
    wrap.addEventListener('mousedown', (ev) => { if (ev.target === wrap) done(null); });
    wrap.addEventListener('keydown', (ev) => { ev.stopPropagation(); if (ev.key === 'Escape') done(null); });
    wrap.querySelector('form').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const itemName = $('#qi-name').value.trim();
        if (!itemName) { $('#qi-name').focus(); return; }
        $('#qi-ok').disabled = true;
        try {
            done(await createTempMasterItem({ code, name: itemName, category: $('#qi-cat').value, unit: $('#qi-unit').value.trim().toUpperCase() || 'EA', spec: $('#qi-spec').value.trim() }));
        } catch (err) {
            alert(err.message);
            $('#qi-ok').disabled = false;
        }
    });
    showSame();
    setTimeout(() => { $('#qi-name').focus(); $('#qi-name').select(); }, 30);
});

/**
 * 품목 검색 제안 목록(sg) 맨 아래에 [＋ 새 품목 추가]를 붙인다 — 목록을 다시 그릴 때마다 부른다.
 * @param {HTMLElement} box 제안 목록 칸 (숨겨져 있으면 보이게 한다)
 * @param {string} name 지금 검색어 (새 품목의 품명으로 채운다)
 * @param {(item: object) => void} onPick 등록한 품목을 고른 것처럼 처리할 함수
 */
export const appendNewItemButton = (box, name, onPick) => {
    if (!box || !canAddItem()) return;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'qi-new w-full text-left px-2.5 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold border-t border-blue-200 sticky bottom-0';
    btn.textContent = `＋ 새 품목 추가${String(name || '').trim() ? ` — "${String(name).trim().slice(0, 30)}"` : ''}`;
    btn.addEventListener('mousedown', (ev) => { ev.preventDefault(); ev.stopPropagation(); });
    btn.addEventListener('click', async (ev) => {
        ev.stopPropagation();
        box.classList.add('hidden');
        const item = await openQuickItemDialog({ name: String(name || '').trim() });
        if (item) onPick(item);
    });
    box.appendChild(btn);
    box.classList.remove('hidden');
};
