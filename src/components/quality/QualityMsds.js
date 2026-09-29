import { createIcons, icons } from '../../services/icons.js';
import { esc } from '../../services/html.js';
import { localDateStr } from '../../services/searchUtils.js';
import { listQc, saveQc, deleteQc, GHS, msdsReviewDate, daysUntil, canWriteQc, canDeleteQc } from '../../services/quality.js';
import { countAttachments, removeAllAttachments, listAttachments, attachmentUrl } from '../../services/attachments.js';
import { attachItemPicker, btn, printA4, printTableHtml } from '../plans/planCommon.js';
import { mountAttachmentPanel } from '../AttachmentPanel.js';
import { state } from '../../services/db.js';
import { openFileInViewer, viewerTabOf, canUseViewer } from '../../services/viewerOpen.js';

// 제품 MSDS / 원료 MSDS 두 메뉴 (기록의 msdsType, 없으면 품목 분류로: 완제품 → 제품, 그 밖 → 원료)
const MSDS_TYPES = { PRODUCT: { label: '제품 MSDS', icon: 'package-check', pick: (m) => m.category === '완제품' }, RAW: { label: '원료 MSDS', icon: 'flask-conical', pick: (m) => m.category === '원료' || m.category === '원액' || m.category === '부자재' } };
const TYPE_KEY = 'daelim_msds_type';
const typeOfMsds = (m) => m.msdsType || (state.master.find(x => x.code === m.itemCode)?.category === '완제품' ? 'PRODUCT' : 'RAW');

// 품질관리 → MSDS관리: 물질안전보건자료 대장 (품목·공급처·개정일·다음 검토일·유해성 그림문자) + MSDS 파일 첨부(문서 키 MSDS:<id>)
// 다음 검토일이 지났거나 90일 안이면 표시하고, 파일이 없는 MSDS도 따로 거른다.
// '' = 아직 원본을 확인하지 않음(웹 검색 등록 등) — 수정 창이 '위험'으로 잘못 고르지 않게
const SIGNAL = { '': '미확인', DANGER: '위험', WARNING: '경고', NONE: '해당 없음' };
const LANGS = ['한국어', '영어', '한국어·영어', '기타'];
const STATUS_F = [['', '전체'], ['OVER', '검토일 지남'], ['SOON', '90일 안 검토'], ['NOFILE', '파일 없음'], ['OK', '정상']];

export const renderQualityMsds = (container, { showToast = () => {} } = {}) => {
    const canWrite = canWriteQc();
    let list = [];
    let files = new Map();
    let q = '';
    let statusF = '';
    let tab = (() => { try { return localStorage.getItem(TYPE_KEY) === 'PRODUCT' ? 'PRODUCT' : 'RAW'; } catch { return 'RAW'; } })();
    let all = []; // 두 메뉴 전체 (list = 지금 메뉴)

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
                    <button type="button" id="ms-print" class="${btn('bg-white border border-slate-300 text-slate-700 hover:bg-slate-50')}"><i data-lucide="printer" class="w-4 h-4"></i>대장 출력</button>
                    <button type="button" id="ms-xlsx" class="${btn()}"><i data-lucide="file-spreadsheet" class="w-4 h-4"></i>엑셀</button>
                </div>
            </div>
            <div class="flex gap-1 bg-slate-100 p-1 rounded-xl w-fit" id="ms-tabs">${Object.entries(MSDS_TYPES).map(([k, t]) => `<button type="button" data-t="${k}" class="ms-tab px-4 py-2 rounded-lg text-xs font-black flex items-center gap-1.5"><i data-lucide="${t.icon}" class="w-4 h-4"></i>${t.label} <span class="ms-tab-n text-[10px] opacity-70"></span></button>`).join('')}</div>
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
        list = all.filter(m => typeOfMsds(m) === tab);
        container.querySelectorAll('.ms-tab').forEach(b => {
            b.className = `ms-tab px-4 py-2 rounded-lg text-xs font-black flex items-center gap-1.5 ${b.dataset.t === tab ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`;
            b.querySelector('.ms-tab-n').textContent = `(${all.filter(m => typeOfMsds(m) === b.dataset.t).length})`;
        });
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
                <th class="px-2 py-2 text-left">개정</th><th class="px-2 py-2 text-left">다음 검토일</th><th class="px-2 py-2 text-center">신호어</th><th class="px-2 py-2 text-left">유해성</th><th class="px-2 py-2 text-center">파일</th><th class="px-2 py-2 text-center">보기 · 출력</th></tr></thead>
            <tbody class="divide-y divide-slate-100">${rows.length === 0 ? `<tr><td colspan="9" class="p-10 text-center text-slate-400">${list.length ? '조건에 맞는 MSDS가 없습니다.' : '등록된 MSDS가 없습니다. [MSDS 등록]으로 추가하세요.'}</td></tr>` : rows.map(m => `
                <tr class="ms-row hover:bg-emerald-50/40 cursor-pointer" data-id="${esc(m.id)}">
                    <td class="px-2 py-1.5"><div class="font-bold text-slate-800">${esc(m.itemName || '')}</div><div class="text-[10px] text-slate-400 font-mono">${esc(m.itemCode || '')}</div></td>
                    <td class="px-2 py-1.5">${esc(m.substance || '')}</td><td class="px-2 py-1.5">${esc(m.supplier || '')}</td><td class="px-2 py-1.5 font-mono">${esc(m.casNo || '')}</td>
                    <td class="px-2 py-1.5 whitespace-nowrap">${esc(m.revNo || '')} ${esc(m.revDate || '')}</td><td class="px-2 py-1.5">${reviewBadge(m)}</td>
                    <td class="px-2 py-1.5 text-center">${m.signal && m.signal !== 'NONE' ? `<span class="px-1.5 py-0.5 rounded text-[10px] font-black ${m.signal === 'DANGER' ? 'bg-rose-600 text-white' : 'bg-amber-400 text-white'}">${SIGNAL[m.signal]}</span>` : ''}</td>
                    <td class="px-2 py-1.5">${(m.ghs || []).map(g => `<span class="inline-block px-1 py-0.5 mr-0.5 mb-0.5 rounded border border-rose-200 text-rose-700 text-[10px]" title="${esc(g)}">◆ ${esc(GHS[g] || g)}</span>`).join('')}</td>
                    <td class="px-2 py-1.5 text-center font-bold ${files.get(`MSDS:${m.id}`) ? 'text-blue-600' : m.sourceUrl ? 'text-sky-600' : 'text-amber-600'}">${files.get(`MSDS:${m.id}`) ? `📎 ${files.get(`MSDS:${m.id}`)}` : m.sourceUrl ? '🌐 웹' : '없음'}</td>
                    <td class="px-2 py-1.5 text-center whitespace-nowrap"><button type="button" class="ms-view px-2 py-1 rounded-md bg-slate-800 text-white font-bold" title="첨부 파일(없으면 웹 출처)을 엽니다">보기</button> <button type="button" class="ms-print1 px-2 py-1 rounded-md border border-slate-300 font-bold" title="MSDS 요약 A4 출력">출력</button></td></tr>`).join('')}</tbody></table></div>`;
        container.querySelectorAll('.ms-row').forEach(tr => {
            const m = list.find(x => x.id === tr.dataset.id);
            tr.addEventListener('click', (e) => { if (e.target.closest('button')) return; openEditor(m); });
            tr.querySelector('.ms-view').addEventListener('click', () => viewMsds(m));
            tr.querySelector('.ms-print1').addEventListener('click', () => printMsds(m));
        });
        createIcons({ icons });
    };

    // 보기: 첨부 파일(PDF 등)이 있으면 TOOL → 뷰어로, 없으면 웹 출처 링크를 새 창으로
    const viewMsds = async (m) => {
        try {
            const atts = await listAttachments(`MSDS:${m.id}`);
            const a = atts[0];
            if (a) {
                const url = await attachmentUrl(a);
                if (viewerTabOf(a.name, a.type) && canUseViewer()) { await openFileInViewer({ name: a.name, mime: a.type, url }); return; }
                window.open(url, '_blank', 'noopener');
                return;
            }
            if (m.sourceUrl) { window.open(m.sourceUrl, '_blank', 'noopener'); return; }
            alert('첨부 파일과 웹 출처가 없습니다. [MSDS 등록] 창에서 파일을 첨부하거나 출처 링크를 넣으세요.');
        } catch (e) { alert(e.message); }
    };
    // 출력: MSDS 요약 (게시·비치용 A4)
    const printMsds = (m) => printA4({
        title: `${MSDS_TYPES[typeOfMsds(m)].label} 요약`, subtitle: 'MATERIAL SAFETY DATA SHEET SUMMARY', approvals: ['작성', '검토'],
        meta: [['품목', `${m.itemName || ''} ${m.itemCode ? `(${m.itemCode})` : ''}`], ['공급처', m.supplier || '-'], ['개정', `${m.revNo || ''} ${m.revDate || ''}`.trim() || '-'], ['다음 검토일', msdsReviewDate(m) || '-']],
        bodyHtml: `<table class="grid"><colgroup><col style="width:34mm"><col></colgroup><tbody>
            <tr><th>제품·물질명</th><td>${esc(m.substance || '')}</td></tr>
            <tr><th>CAS 번호</th><td>${esc(m.casNo || '')}</td></tr>
            <tr><th>신호어</th><td><b>${esc(SIGNAL[m.signal] || '')}</b></td></tr>
            <tr><th>유해성 (GHS)</th><td>${(m.ghs || []).map(g => `◆ ${esc(GHS[g] || g)} (${esc(g)})`).join('<br>') || '해당 없음'}</td></tr>
            <tr><th>보관 위치</th><td>${esc(m.place || '')}</td></tr>
            <tr><th>언어</th><td>${esc(m.language || '')}</td></tr>
            <tr><th>출처</th><td style="word-break:break-all">${esc(m.sourceUrl || '')}</td></tr>
            <tr><th>취급·보관 주의사항</th><td style="height:40mm;vertical-align:top;white-space:pre-wrap">${esc(m.notes || '')}</td></tr>
        </tbody></table><p style="font-size:8pt;color:#555;margin-top:3mm">※ 전체 내용은 공급처 MSDS 원본(첨부 파일 또는 출처)을 따릅니다.</p>`
    });

    const openEditor = (orig) => {
        const m0 = orig || { revDate: localDateStr(), signal: 'WARNING', ghs: [], language: '한국어', msdsType: tab };
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
                <label><span class="font-bold text-slate-600">구분</span><select id="m-type" class="${inp}">${Object.entries(MSDS_TYPES).map(([k, t]) => `<option value="${k}" ${typeOfMsds(m0) === k ? 'selected' : ''}>${t.label}</option>`).join('')}</select></label>
                <label class="col-span-2"><span class="font-bold text-slate-600">웹 출처 (공급사·안전보건공단 MSDS 링크)</span><input id="m-url" value="${esc(m0.sourceUrl || '')}" placeholder="https://" class="${inp}" /></label>
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
        attachItemPicker(m('#m-item'), (it) => {
            picked.code = it.code; picked.name = it.name; m('#m-item').value = it.name; m('#m-code').textContent = it.code;
            if (!m('#m-supplier').value && (it.manufacturer || it.supplier)) m('#m-supplier').value = it.manufacturer || it.supplier;
            m('#m-type').value = it.category === '완제품' ? 'PRODUCT' : 'RAW';
        }, null, (it) => (MSDS_TYPES[m('#m-type').value]?.pick(it) ? 0 : 1));
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
                    msdsType: m('#m-type').value, sourceUrl: m('#m-url').value.trim(),
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
        try { all = await listQc('MSDS'); } catch (err) { $('#ms-body').innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(err.message)}</div>`; return; }
        all.sort((a, b) => String(a.itemName).localeCompare(String(b.itemName)));
        files = await countAttachments(all.map(m => `MSDS:${m.id}`)).catch(() => new Map());
        render();
    };
    container.querySelectorAll('.ms-f').forEach(b => b.addEventListener('click', () => { statusF = b.dataset.f; render(); }));
    container.querySelectorAll('.ms-tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.t; try { localStorage.setItem(TYPE_KEY, tab); } catch { /* 무시 */ } render(); }));
    $('#ms-print').addEventListener('click', () => printA4({
        title: `${MSDS_TYPES[tab].label} 대장`, subtitle: 'MSDS LIST', landscape: true, approvals: ['작성', '검토', '승인'],
        meta: [['구분', MSDS_TYPES[tab].label], ['건수', `${list.length}건`], ['출력일', localDateStr()]],
        bodyHtml: printTableHtml([
            { label: '품목코드', w: 24, get: (m) => m.itemCode || '' }, { label: '품목명', w: 52, get: (m) => m.itemName || '' }, { label: '제품·물질명', w: 46, get: (m) => m.substance || '' },
            { label: '공급처', w: 32, get: (m) => m.supplier || '' }, { label: 'CAS', w: 24, get: (m) => m.casNo || '' }, { label: '개정일', w: 20, get: (m) => m.revDate || '' },
            { label: '다음 검토', w: 20, get: (m) => msdsReviewDate(m) || '' }, { label: '신호어', w: 12, cls: 'c', get: (m) => SIGNAL[m.signal] || '' },
            { label: '원본', w: 14, cls: 'c', get: (m) => (files.get(`MSDS:${m.id}`) ? '파일' : m.sourceUrl ? '웹' : '없음') }
        ], list)
    }));
    $('#ms-q').addEventListener('input', (e) => { q = e.target.value; render(); });
    $('#ms-new')?.addEventListener('click', () => openEditor(null));
    $('#ms-xlsx').addEventListener('click', () => exportExcel().catch(err => alert(`엑셀을 만들지 못했습니다: ${err.message}`)));
    load();
    createIcons({ icons });
};
