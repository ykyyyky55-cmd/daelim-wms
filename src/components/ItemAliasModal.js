import { state, saveItemAlias, deleteItemAlias, itemAliasKey } from '../services/db.js';
import { searchMasterItems } from '../services/searchUtils.js';
import { canPerformAction } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';

// 품목마스터 → 약칭 관리: 업무일지에 적는 약칭('카밈PRO+D', 'D40 공토트' 등)을 품목코드에 연결한다.
// 본사 이동 반영과 업무일지 품목 매칭이 이 약칭을 먼저 찾는다 (db.js aliasMasterOf). 쓰기는 자재 관리자 이상.
export const openItemAliasModal = ({ showToast = () => {}, initialAlias = '' } = {}) => {
    document.getElementById('modal-item-alias')?.remove();
    const canEdit = canPerformAction('EDIT_MASTER');
    let editKey = '';      // 고치는 중인 약칭의 키 ('' = 새로 추가)
    let pickedCode = '';
    let query = '';

    const wrap = document.createElement('div');
    wrap.id = 'modal-item-alias';
    wrap.className = 'fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4';
    wrap.innerHTML = `
        <div class="bg-white w-full max-w-3xl rounded-2xl shadow-2xl overflow-hidden border border-slate-100 flex flex-col max-h-[88vh]">
            <div class="px-5 py-4 bg-slate-800 text-white flex justify-between items-center">
                <div class="flex items-center gap-2"><i data-lucide="tags" class="w-5 h-5"></i><h3 class="font-bold text-sm">품목 약칭 관리</h3></div>
                <button type="button" data-close class="text-slate-300 hover:text-white text-lg">&times;</button>
            </div>
            <div class="p-5 space-y-3 overflow-y-auto flex-1 text-xs">
                <p class="text-slate-500">업무일지에 품목명 대신 적는 약칭을 품목코드에 연결합니다. 업무일지를 수불부에 반영할 때 이 약칭을 먼저 찾습니다. (대소문자·띄어쓰기·기호는 구분하지 않음)</p>
                ${canEdit ? `
                <div class="border border-blue-200 bg-blue-50/50 rounded-xl p-3 space-y-2">
                    <div class="font-black text-slate-800" id="ia-form-title">새 약칭 추가</div>
                    <div class="grid grid-cols-1 md:grid-cols-12 gap-2 items-start">
                        <input id="ia-alias" class="md:col-span-3 border border-slate-300 rounded-lg px-2.5 py-2" placeholder="약칭 (예: 카밈PRO+D)" />
                        <div class="md:col-span-5 relative">
                            <input id="ia-item" class="w-full border border-slate-300 rounded-lg px-2.5 py-2" placeholder="품목코드·품목명 검색" autocomplete="off" />
                            <div id="ia-item-results" class="hidden absolute z-10 left-0 right-0 mt-1 bg-white border border-slate-200 rounded-lg shadow-lg max-h-56 overflow-y-auto"></div>
                        </div>
                        <input id="ia-note" class="md:col-span-2 border border-slate-300 rounded-lg px-2.5 py-2" placeholder="메모" />
                        <div class="md:col-span-2 flex gap-1">
                            <button type="button" id="ia-save" class="flex-1 px-3 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-bold">저장</button>
                            <button type="button" id="ia-cancel" class="hidden px-2.5 py-2 bg-slate-200 hover:bg-slate-300 rounded-lg font-bold">취소</button>
                        </div>
                    </div>
                    <div id="ia-picked" class="text-[11px] text-slate-500">품목을 검색해서 고르세요.</div>
                </div>` : '<div class="text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">약칭 추가·수정은 자재 관리자 이상만 할 수 있습니다.</div>'}
                <div class="flex items-center gap-2">
                    <input id="ia-search" class="flex-1 border border-slate-300 rounded-lg px-2.5 py-2" placeholder="약칭·품목코드·품목명으로 찾기" />
                    <span id="ia-count" class="text-slate-400 font-bold whitespace-nowrap"></span>
                </div>
                <div class="border border-slate-200 rounded-xl overflow-auto">
                    <table class="w-full">
                        <thead class="bg-slate-50 text-slate-600 sticky top-0"><tr><th class="p-2 text-left">약칭</th><th class="p-2 text-left">품목코드</th><th class="p-2 text-left">품목명</th><th class="p-2 text-left">분류</th><th class="p-2 text-left">메모</th>${canEdit ? '<th class="p-2 w-24"></th>' : ''}</tr></thead>
                        <tbody id="ia-list" class="divide-y divide-slate-100"></tbody>
                    </table>
                </div>
            </div>
        </div>`;
    document.body.appendChild(wrap);
    const $ = (s) => wrap.querySelector(s);
    const masterOf = (code) => state.master.find(m => m.code === code);

    const renderList = () => {
        const q = itemAliasKey(query);
        const rows = (state.itemAliases || []).filter(a => {
            if (!q) return true;
            const m = masterOf(a.code);
            return a.key.includes(q) || itemAliasKey(a.code).includes(q) || itemAliasKey(m?.name).includes(q);
        });
        $('#ia-count').textContent = `${rows.length} / ${(state.itemAliases || []).length}개`;
        $('#ia-list').innerHTML = rows.length ? rows.map(a => {
            const m = masterOf(a.code);
            return `<tr class="${editKey === a.key ? 'bg-blue-50' : ''}">
                <td class="p-2 font-black">${esc(a.alias)}</td>
                <td class="p-2 font-mono">${esc(a.code)}</td>
                <td class="p-2 ${m ? '' : 'text-rose-600 font-bold'}">${m ? esc(m.name) : '품목 마스터에 없음'}</td>
                <td class="p-2 text-slate-500">${esc(m?.category || '')}</td>
                <td class="p-2 text-slate-500">${esc(a.note)}</td>
                ${canEdit ? `<td class="p-2 text-right whitespace-nowrap"><button type="button" data-edit="${esc(a.key)}" class="px-2 py-1 rounded bg-slate-100 hover:bg-slate-200 font-bold">수정</button> <button type="button" data-del="${esc(a.key)}" class="px-2 py-1 rounded bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold">삭제</button></td>` : ''}
            </tr>`;
        }).join('') : `<tr><td colspan="6" class="p-6 text-center text-slate-400">${(state.itemAliases || []).length ? '찾는 약칭이 없습니다.' : '등록된 약칭이 없습니다.'}</td></tr>`;
    };

    const setPicked = (code) => {
        pickedCode = code;
        const m = masterOf(code);
        $('#ia-picked').innerHTML = m ? `선택: <b class="font-mono">${esc(m.code)}</b> ${esc(m.name)} <span class="text-slate-400">(${esc(m.category || '')})</span>` : '품목을 검색해서 고르세요.';
    };
    const resetForm = () => {
        editKey = '';
        $('#ia-alias').value = '';
        $('#ia-item').value = '';
        $('#ia-note').value = '';
        $('#ia-form-title').textContent = '새 약칭 추가';
        $('#ia-cancel').classList.add('hidden');
        setPicked('');
        renderList();
    };

    wrap.addEventListener('click', async (e) => {
        if (e.target === wrap || e.target.closest('[data-close]')) { wrap.remove(); return; }
        const pick = e.target.closest('[data-pick]');
        if (pick) {
            setPicked(pick.dataset.pick);
            $('#ia-item').value = '';
            $('#ia-item-results').classList.add('hidden');
            return;
        }
        const ed = e.target.closest('[data-edit]');
        if (ed) {
            const a = state.itemAliases.find(x => x.key === ed.dataset.edit);
            if (!a) return;
            editKey = a.key;
            $('#ia-alias').value = a.alias;
            $('#ia-note').value = a.note;
            $('#ia-form-title').textContent = `약칭 수정: ${a.alias}`;
            $('#ia-cancel').classList.remove('hidden');
            setPicked(a.code);
            renderList();
            return;
        }
        const del = e.target.closest('[data-del]');
        if (del) {
            const a = state.itemAliases.find(x => x.key === del.dataset.del);
            if (!a || !confirm(`'${a.alias}' 약칭을 삭제할까요?`)) return;
            try { await deleteItemAlias(a.key); showToast('약칭을 삭제했습니다.', 'success'); if (editKey === a.key) resetForm(); else renderList(); }
            catch (err) { showToast(err.message, 'error'); }
        }
    });

    $('#ia-search').addEventListener('input', (e) => { query = e.target.value; renderList(); });
    if (canEdit) {
        $('#ia-item').addEventListener('input', (e) => {
            const box = $('#ia-item-results');
            const v = e.target.value.trim();
            if (!v) { box.classList.add('hidden'); return; }
            const found = searchMasterItems(v, 30);
            box.innerHTML = found.length ? found.map(m => `<button type="button" data-pick="${esc(m.code)}" class="block w-full text-left px-2.5 py-1.5 hover:bg-blue-50"><span class="font-mono font-bold">${esc(m.code)}</span> ${esc(m.name)} <span class="text-slate-400">${esc(m.category || '')}</span></button>`).join('') : '<div class="px-2.5 py-2 text-slate-400">찾는 품목이 없습니다.</div>';
            box.classList.remove('hidden');
        });
        $('#ia-cancel').addEventListener('click', resetForm);
        $('#ia-save').addEventListener('click', async () => {
            if (!pickedCode) { showToast('연결할 품목을 고르세요.', 'error'); return; }
            try {
                const row = await saveItemAlias({ alias: $('#ia-alias').value, code: pickedCode, note: $('#ia-note').value }, editKey);
                showToast(`'${row.alias}' → [${row.code}] 저장했습니다.`, 'success');
                resetForm();
            } catch (err) { showToast(err.message, 'error'); }
        });
        if (initialAlias) $('#ia-alias').value = initialAlias;
    }
    renderList();
    createIcons({ icons });
};
