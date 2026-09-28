import { createIcons, icons } from '../../services/icons.js';
import { esc } from '../../services/html.js';
import { localDateStr } from '../../services/searchUtils.js';
import { listQc, saveQc, deleteQc, GHS, msdsReviewDate, daysUntil, canWriteQc, canDeleteQc } from '../../services/quality.js';
import { countAttachments, removeAllAttachments } from '../../services/attachments.js';
import { attachItemPicker, btn } from '../plans/planCommon.js';
import { mountAttachmentPanel } from '../AttachmentPanel.js';

// 품질관리 → MSDS관리: 물질안전보건자료 대장 (품목·공급처·개정일·다음 검토일·유해성 그림문자) + MSDS 파일 첨부(문서 키 MSDS:<id>)
// 다음 검토일이 지났거나 90일 안이면 표시하고, 파일이 없는 MSDS도 따로 거른다.
const SIGNAL = { DANGER: '위험', WARNING: '경고', NONE: '해당 없음' };
const LANGS = ['한국어', '영어', '한국어·영어', '기타'];
const STATUS_F = [['', '전체'], ['OVER', '검토일 지남'], ['SOON', '90일 안 검토'], ['NOFILE', '파일 없음'], ['OK', '정상']];

export const renderQualityMsds = (container, { showToast = () => {} } = {}) => {
    const canWrite = canWriteQc();
    let list = [];
    let files = new Map();
    let q = '';
    let statusF = '';

    container.innerHTML = `
    <section class="space-y-4">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-emerald-700 flex items-center gap-1"><i data-lucide="shield-check" class="w-3.5 h-3.5"></i>품질관리 › MSDS관리</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="flask-conical" class="w-5 h-5 text-emerald-600"></i>MSDS관리 (물질안전보건자료)</h2>
                    <p class="text-xs text-slate-500 mt-1">원료·제품의 MSDS를 품목별로 등록하고 파일을 첨부합니다. 다음 검토일을 비워 두면 <b>개정일 + 3년</b>으로 보여 주므로, 회사 기준에 맞게 직접 입력하세요.</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    ${canWrite ? `<button type="button" id="ms-new" class="${btn('bg-emerald-600 hover:bg-emerald-700 text-white')}"><i data-lucide="plus" class="w-4 h-4"></i>MSDS 등록</button>` : ''}
                    <button type="button" id="ms-xlsx" class="${btn()}"><i data-lucide="file-spreadsheet" class="w-4 h-4"></i>엑셀</button>
                </div>
            </div>
            <div id="ms-kpi" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl">${STATUS_F.map(([k, l]) => `<button type="button" data-f="${k}" class="ms-f px-3 py-1.5 rounded-lg font-black">${l}</button>`).join('')}</div>
                <input type="search" id="ms-q" placeholder="품목·물질명·공급처·CAS 검색" class="border border-slate-300 rounded-lg px-2 py-1 w-56" />
            </div>
        </div>
        <div id="ms-body"></div>
    </section>
    <div id="ms-modal" class="hidden fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-3"></div>`;
    const $ = (s) => container.querySelector(s);
    const statusOf = (m) => {
        const n = daysUntil(msdsReviewDate(m));
        if (n !== null && n < 0) return 'OVER';
        if (n !== null && n <= 90) return 'SOON';
        if (!files.get(`MSDS:${m.id}`)) return 'NOFILE';
        return 'OK';
    };
    const reviewBadge = (m) => {
        const d = msdsReviewDate(m);
        const n = daysUntil(d);
        if (n === null) return '<span class="text-slate-300">-</span>';
        const auto = !m.reviewDate ? '<span class="text-[10px] text-slate-400"> (자동)</span>' : '';
        if (n < 0) return `<span class="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black">${esc(d)} 지남</span>${auto}`;
        if (n <= 90) return `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-black">${esc(d)} · ${n}일</span>${auto}`;
        return `<span class="text-slate-600">${esc(d)}</span>${auto}`;
    };

    const render = () => {
        container.querySelectorAll('.ms-f').forEach(b => { b.className = `ms-f px-3 py-1.5 rounded-lg font-black ${b.dataset.f === statusF ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`; });
        const st = list.map(m => statusOf(m));
        const card = (l, v, cls = 'text-slate-900') => `<div class="p-3 rounded-xl border border-slate-200 bg-slate-50/50"><div class="text-[11px] font-bold text-slate-500">${l}</div><div class="text-xl font-black ${cls}">${v}</div></div>`;
        const over = st.filter(s => s === 'OVER').length, soon = st.filter(s => s === 'SOON').length, nofile = list.filter(m => !files.get(`MSDS:${m.id}`)).length;
        $('#ms-kpi').innerHTML = card('등록 MSDS', `${list.length}건`) + card('검토일 지남', `${over}건`, over ? 'text-rose-600' : 'text-slate-900')
            + card('90일 안 검토', `${soon}건`, soon ? 'text-amber-600' : 'text-slate-900') + card('파일 없음', `${nofile}건`, nofile ? 'text-amber-600' : 'text-slate-900');
        const needle = q.trim().toLowerCase();
        const rows = list.filter(m => (!statusF || (statusF === 'NOFILE' ? !files.get(`MSDS:${m.id}`) : statusOf(m) === statusF))
            && (!needle || `${m.itemCode} ${m.itemName} ${m.substance} ${m.supplier} ${m.casNo}`.toLowerCase().includes(needle)));
        $('#ms-body').innerHTML = `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
            <table class="w-full text-xs min-w-[980px]"><thead class="bg-slate-50 text-slate-600"><tr>
                <th class="px-2 py-2 text-left">품목</th><th class="px-2 py-2 text-left">제품·물질명</th><th class="px-2 py-2 text-left">공급처</th><th class="px-2 py-2 text-left">CAS 번호</th>
                <th class="px-2 py-2 text-left">개정</th><th class="px-2 py-2 text-left">다음 검토일</th><th class="px-2 py-2 text-center">신호어</th><th class="px-2 py-2 text-left">유해성</th><th class="px-2 py-2 text-center">파일</th></tr></thead>
            <tbody class="divide-y divide-slate-100">${rows.length === 0 ? `<tr><td colspan="9" class="p-10 text-center text-slate-400">${list.length ? '조건에 맞는 MSDS가 없습니다.' : '등록된 MSDS가 없습니다. [MSDS 등록]으로 추가하세요.'}</td></tr>` : rows.map(m => `
                <tr class="ms-row hover:bg-emerald-50/40 cursor-pointer" data-id="${esc(m.id)}">
                    <td class="px-2 py-1.5"><div class="font-bold text-slate-800">${esc(m.itemName || '')}</div><div class="text-[10px] text-slate-400 font-mono">${esc(m.itemCode || '')}</div></td>
                    <td class="px-2 py-1.5">${esc(m.substance || '')}</td><td class="px-2 py-1.5">${esc(m.supplier || '')}</td><td class="px-2 py-1.5 font-mono">${esc(m.casNo || '')}</td>
                    <td class="px-2 py-1.5 whitespace-nowrap">${esc(m.revNo || '')} ${esc(m.revDate || '')}</td><td class="px-2 py-1.5">${reviewBadge(m)}</td>
                    <td class="px-2 py-1.5 text-center">${m.signal && m.signal !== 'NONE' ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-black ${m.signal === 'DANGER' ? 'bg-rose-600 text-white' : 'bg-amber-400 text-white'}">${SIGNAL[m.signal]}</span>` : ''}</td>
                    <td class="px-2 py-1.5">${(m.ghs || []).map(g => `<span class="inline-block px-1 py-0.5 mr-0.5 mb-0.5 rounded border border-rose-200 text-rose-700 text-[10px]" title="${esc(g)}">◆ ${esc(GHS[g] || g)}</span>`).join('')}</td>
                    <td class="px-2 py-1.5 text-center font-bold ${files.get(`MSDS:${m.id}`) ? 'text-blue-600' : 'text-amber-600'}">${files.get(`MSDS:${m.id}`) ? `📎 ${files.get(`MSDS:${m.id}`)}` : '없음'}</td></tr>`).join('')}</tbody></table></div>`;
        container.querySelectorAll('.ms-row').forEach(tr => tr.addEventListener('click', () => openEditor(list.find(m => m.id === tr.dataset.id))));
        createIcons({ icons });
    };

    const openEditor = (orig) => {
        const m0 = orig || { revDate: localDateStr(), signal: 'WARNING', ghs: [], language: '한국어' };
        const inp = 'mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5';
        const modal = $('#ms-modal');
        modal.innerHTML = `<div class="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 space-y-4 text-xs">
            <div class="flex items-start justify-between"><h3 class="text-base font-black text-slate-900">${orig ? 'MSDS' : 'MSDS 등록'}</h3><button type="button" data-close class="p-1 rounded-lg hover:bg-slate-100"><i data-lucide="x" class="w-4 h-4"></i></button></div>
            <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                <label class="col-span-2"><span class="font-bold text-slate-600">품목 * (코드·이름 검색)</span><input id="m-item" value="${esc(m0.itemName || '')}" class="${inp}" /><span id="m-code" class="text-[10px] text-slate-400 font-mono">${esc(m0.itemCode || '')}</span></label>
                <label><span class="font-bold text-slate-600">공급처(제조사)</span><input id="m-supplier" value="${esc(m0.supplier || '')}" class="${inp}" /></label>
                <label class="col-span-2"><span class="font-bold text-slate-600">제품·물질명 (MSDS 표기)</span><input id="m-sub" value="${esc(m0.substance || '')}" class="${inp}" /></label>
                <label><span class="font-bold text-slate-600">CAS 번호</span><input id="m-cas" value="${esc(m0.casNo || '')}" placeholder="예: 64742-54-7" class="${inp} font-mono" /></label>
                <label><span class="font-bold text-slate-600">개정 번호</span><input id="m-rev" value="${esc(m0.revNo || '')}" class="${inp}" /></label>
                <label><span class="font-bold text-slate-600">개정(작성)일</span><input type="date" id="m-revdate" value="${esc(m0.revDate || '')}" class="${inp}" /></label>
                <label><span class="font-bold text-slate-600">다음 검토일</span><input type="date" id="m-review" value="${esc(m0.reviewDate || '')}" class="${inp}" /><span class="text-[10px] text-slate-400">비우면 개정일 + 3년</span></label>
                <label><span class="font-bold text-slate-600">신호어</span><select id="m-signal" class="${inp}">${Object.entries(SIGNAL).map(([k, l]) => `<option value="${k}" ${m0.signal === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label><span class="font-bold text-slate-600">언어</span><select id="m-lang" class="${inp}">${LANGS.map(l => `<option ${m0.language === l ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label><span class="font-bold text-slate-600">보관 위치</span><input id="m-place" value="${esc(m0.place || '')}" placeholder="예: 김포1C 창고동 게시판" class="${inp}" /></label>
            </div>
            <div><div class="font-bold text-slate-600 mb-1">유해성 그림문자 (GHS)</div>
                <div class="grid grid-cols-2 md:grid-cols-3 gap-1.5">${Object.entries(GHS).map(([k, l]) => `<label class="flex items-center gap-1.5 border border-slate-200 rounded-lg px-2 py-1"><input type="checkbox" data-ghs="${k}" ${(m0.ghs || []).includes(k) ? 'checked' : ''} /><span class="text-rose-600">◆</span>${esc(l)} <span class="text-[10px] text-slate-400">${k}</span></label>`).join('')}</div></div>
            <label class="block"><span class="font-bold text-slate-600">취급·보관 주의사항, 비고</span><textarea id="m-notes" rows="3" class="${inp}">${esc(m0.notes || '')}</textarea></label>
            <div id="m-att" class="border-t border-slate-100 pt-3"></div>
            <div class="flex flex-wrap justify-between gap-2 pt-1">
                <div>${orig && canDeleteQc(orig) ? '<button type="button" id="m-del" class="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold">삭제</button>' : ''}</div>
                <div class="flex gap-2"><button type="button" data-close class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">닫기</button>${canWrite ? `<button type="button" id="m-save" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black">${orig ? '저장' : '저장하고 파일 첨부'}</button>` : ''}</div>
            </div></div>`;
        modal.classList.remove('hidden');
        createIcons({ icons });
        const m = (s) => modal.querySelector(s);
        const close = () => { modal.classList.add('hidden'); modal.innerHTML = ''; };
        modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', close));
        if (!canWrite) modal.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
        const picked = { code: m0.itemCode || '', name: m0.itemName || '' };
        attachItemPicker(m('#m-item'), (it) => { picked.code = it.code; picked.name = it.name; m('#m-item').value = it.name; m('#m-code').textContent = it.code; if (!m('#m-supplier').value && it.supplier) m('#m-supplier').value = it.supplier; });
        m('#m-item').addEventListener('input', () => { picked.code = ''; m('#m-code').textContent = ''; });
        mountAttachmentPanel(m('#m-att'), { key: orig ? `MSDS:${orig.id}` : '', title: 'MSDS 파일 (PDF 등)', onChange: (n) => { if (orig) { files.set(`MSDS:${orig.id}`, n); render(); } } });
        m('#m-del')?.addEventListener('click', async () => {
            if (!confirm('이 MSDS와 첨부 파일을 삭제할까요? 되돌릴 수 없습니다.')) return;
            try { await removeAllAttachments(`MSDS:${orig.id}`); await deleteQc(orig.id); showToast('🗑️ MSDS를 삭제했습니다.'); close(); await load(); } catch (err) { alert(err.message); }
        });
        m('#m-save')?.addEventListener('click', async (ev) => {
            const itemName = m('#m-item').value.trim();
            if (!itemName) { alert('품목을 입력하세요.'); return; }
            ev.target.disabled = true;
            try {
                const saved = await saveQc('MSDS', {
                    ...m0, date: m('#m-revdate').value, itemCode: picked.code, itemName, supplier: m('#m-supplier').value.trim(), substance: m('#m-sub').value.trim(),
                    casNo: m('#m-cas').value.trim(), revNo: m('#m-rev').value.trim(), revDate: m('#m-revdate').value, reviewDate: m('#m-review').value,
                    signal: m('#m-signal').value, language: m('#m-lang').value, place: m('#m-place').value.trim(), notes: m('#m-notes').value.trim(),
                    ghs: [...modal.querySelectorAll('[data-ghs]:checked')].map(c => c.dataset.ghs)
                });
                showToast(orig ? '💾 MSDS를 저장했습니다.' : '✅ MSDS를 등록했습니다. MSDS 파일을 첨부하세요.');
                await load();
                if (!orig) openEditor(saved); else close();
            } catch (err) { alert(err.message); ev.target.disabled = false; }
        });
    };

    const exportExcel = async () => {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(list.map(m => ({
            품목코드: m.itemCode || '', 품목명: m.itemName || '', '제품·물질명': m.substance || '', 공급처: m.supplier || '', CAS: m.casNo || '', 개정번호: m.revNo || '',
            개정일: m.revDate || '', 다음검토일: msdsReviewDate(m), 신호어: SIGNAL[m.signal] || '', 유해성: (m.ghs || []).map(g => GHS[g] || g).join(', '), 언어: m.language || '',
            보관위치: m.place || '', 파일수: files.get(`MSDS:${m.id}`) || 0, 비고: m.notes || ''
        }))), 'MSDS대장');
        XLSX.writeFile(wb, `MSDS대장_${localDateStr()}.xlsx`);
    };

    const load = async () => {
        try { list = await listQc('MSDS'); } catch (err) { $('#ms-body').innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(err.message)}</div>`; return; }
        list.sort((a, b) => String(a.itemName).localeCompare(String(b.itemName)));
        files = await countAttachments(list.map(m => `MSDS:${m.id}`)).catch(() => new Map());
        render();
    };
    container.querySelectorAll('.ms-f').forEach(b => b.addEventListener('click', () => { statusF = b.dataset.f; render(); }));
    $('#ms-q').addEventListener('input', (e) => { q = e.target.value; render(); });
    $('#ms-new')?.addEventListener('click', () => openEditor(null));
    $('#ms-xlsx').addEventListener('click', () => exportExcel().catch(err => alert(`엑셀을 만들지 못했습니다: ${err.message}`)));
    load();
    createIcons({ icons });
};
