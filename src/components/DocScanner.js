import { state, processStockAction } from '../services/db.js';
import { searchMasterItems, localDateStr } from '../services/searchUtils.js';
import { locationOptionsHtml } from '../services/locations.js';
import { preprocessImage, recognizeImage, parseSlipText } from '../services/docOcr.js';
import { createIcons, icons } from 'lucide';
import { esc } from '../services/html.js';

/**
 * 전표 스캔 등록 (무료 글자 인식)
 * 인쇄된 전표(거래명세서·납품서·출고전표 등)를 찍거나 올리면 글자를 읽어 품목·수량 후보를 채우고,
 * 사람이 확인·수정한 줄만 입고/출고로 등록한다. 자동 등록은 하지 않는다.
 */
export const renderDocScanner = (container, { showToast = () => {} } = {}) => {
    let img = null;          // 원본 이미지 (HTMLImageElement)
    let rotate = 0;
    let contrast = true;
    let ocrText = '';
    let rows = [];           // { id, text, code, qty, note, checked, how, qtyHow, status }
    const head = { type: 'IN', date: localDateStr(), partner: '', docNo: '', location: '김포공장', worker: state.currentGlobalWorker || '' };
    let busy = false;
    const $ = (s) => container.querySelector(s);
    const rid = () => `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e5)}`;
    const masterOf = (code) => state.master.find(m => m.code === code);

    container.innerHTML = `
    <div class="space-y-5 text-xs">
        <div class="bg-gradient-to-br from-slate-900 via-teal-950 to-slate-900 text-white p-5 sm:p-6 rounded-3xl shadow-lg">
            <span class="px-2.5 py-0.5 rounded-full text-[10px] font-black bg-teal-400/20 text-teal-200 border border-teal-300/40">무료 글자 인식 · 이미지는 이 기기 안에서만 처리</span>
            <h2 class="text-xl font-black mt-2 flex items-center gap-2"><i data-lucide="scan-text" class="w-5 h-5"></i><span>전표 스캔 등록</span></h2>
            <p class="text-xs text-slate-300 mt-1">인쇄된 거래명세서·납품서·출고전표를 찍거나 올리면 글자를 읽어 품목과 수량을 채웁니다. 내용을 확인·수정한 뒤 체크한 줄만 입고/출고로 등록합니다. (손글씨는 잘 읽지 못합니다)</p>
        </div>
        <div class="grid grid-cols-1 xl:grid-cols-[420px_1fr] gap-4">
            <!-- 1. 이미지 -->
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3 h-fit">
                <div class="font-black text-slate-800">① 전표 이미지</div>
                <div class="grid grid-cols-2 gap-2">
                    <label class="px-3 py-2.5 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-black flex items-center justify-center gap-1 cursor-pointer">
                        <i data-lucide="camera" class="w-4 h-4"></i>카메라로 찍기
                        <input type="file" id="ds-camera" accept="image/*" capture="environment" class="hidden" /></label>
                    <label class="px-3 py-2.5 bg-slate-700 hover:bg-slate-800 text-white rounded-xl font-black flex items-center justify-center gap-1 cursor-pointer">
                        <i data-lucide="image-up" class="w-4 h-4"></i>이미지 파일 선택
                        <input type="file" id="ds-file" accept="image/*" class="hidden" /></label>
                </div>
                <div id="ds-drop" class="border-2 border-dashed border-slate-300 rounded-xl p-2 text-center text-slate-400 min-h-[160px] flex items-center justify-center">
                    이미지를 여기로 끌어다 놓아도 됩니다. (JPG·PNG, 전표가 화면에 반듯하고 밝게 나오게 찍어 주세요)
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <button type="button" id="ds-rot" class="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-bold flex items-center gap-1" disabled><i data-lucide="rotate-cw" class="w-3.5 h-3.5"></i>90° 회전</button>
                    <label class="flex items-center gap-1 font-bold"><input type="checkbox" id="ds-contrast" checked />흑백·대비 보정</label>
                    <button type="button" id="ds-run" class="ml-auto px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-black flex items-center gap-1 disabled:opacity-40" disabled><i data-lucide="scan-text" class="w-4 h-4"></i>글자 읽기</button>
                </div>
                <div id="ds-progress" class="hidden">
                    <div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div id="ds-bar" class="h-full bg-teal-500 transition-all" style="width:0%"></div></div>
                    <div id="ds-progress-text" class="text-[11px] text-slate-500 mt-1"></div>
                </div>
                <details id="ds-text-box" class="hidden border border-slate-200 rounded-xl p-2">
                    <summary class="font-bold text-slate-600 cursor-pointer">읽은 글자 보기·고치기</summary>
                    <textarea id="ds-text" class="mt-2 w-full h-48 border border-slate-300 rounded-lg p-2 font-mono text-[11px]"></textarea>
                    <button type="button" id="ds-reparse" class="mt-1 px-2.5 py-1 bg-white border border-slate-300 rounded-lg font-bold">고친 글자로 다시 분석</button>
                </details>
            </div>
            <!-- 2. 확인·등록 -->
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div class="font-black text-slate-800">② 내용 확인 후 등록</div>
                <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                    <label class="block"><span class="font-bold text-slate-500">전표 종류</span>
                        <select id="ds-type" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"><option value="IN">입고 (받음)</option><option value="OUT">출고 (보냄)</option></select></label>
                    <label class="block"><span class="font-bold text-slate-500">전표 일자</span><input type="date" id="ds-date" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                    <label class="block"><span class="font-bold text-slate-500">거래처</span><input type="text" id="ds-partner" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                    <label class="block"><span class="font-bold text-slate-500">전표 번호</span><input type="text" id="ds-docno" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-mono font-bold" /></label>
                    <label class="block"><span class="font-bold text-slate-500">입고/출고 창고</span><select id="ds-loc" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${locationOptionsHtml(state.locations, head.location)}</select></label>
                    <label class="block"><span class="font-bold text-slate-500">작업자</span><input type="text" id="ds-worker" list="ds-worker-list" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" />
                        <datalist id="ds-worker-list">${(state.workers || []).map(w => `<option value="${esc(w.name)}"></option>`).join('')}</datalist></label>
                </div>
                <div class="overflow-auto border border-slate-200 rounded-xl max-h-[60vh]">
                    <table class="w-full">
                        <thead class="bg-slate-50 text-slate-600 font-bold sticky top-0 z-10"><tr>
                            <th class="p-2 w-8"><input type="checkbox" id="ds-all" class="w-4 h-4" /></th>
                            <th class="p-2 text-left">전표에서 읽은 줄</th><th class="p-2 text-left min-w-[240px]">품목 (검색해서 고르기)</th>
                            <th class="p-2 text-right w-28">수량</th><th class="p-2 text-center">단위</th><th class="p-2 text-left">상태</th><th class="p-2 w-10"></th>
                        </tr></thead>
                        <tbody id="ds-rows" class="divide-y divide-slate-100"></tbody>
                    </table>
                </div>
                <div class="flex flex-wrap items-center gap-2">
                    <button type="button" id="ds-add" class="px-2.5 py-1.5 bg-white border border-slate-300 rounded-lg font-bold">+ 줄 추가</button>
                    <span id="ds-summary" class="text-slate-500 font-bold"></span>
                    <button type="button" id="ds-submit" class="ml-auto px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-black flex items-center gap-1 disabled:opacity-40"><i data-lucide="check-circle" class="w-4 h-4"></i><span id="ds-submit-text">체크한 줄 입고 등록</span></button>
                </div>
            </div>
        </div>
    </div>`;
    createIcons({ icons });

    const syncHead = () => {
        $('#ds-type').value = head.type;
        $('#ds-date').value = head.date;
        $('#ds-partner').value = head.partner;
        $('#ds-docno').value = head.docNo;
        $('#ds-worker').value = head.worker;
    };
    syncHead();

    // ---------- 이미지 ----------
    const showImage = () => {
        const drop = $('#ds-drop');
        if (!img) return;
        const c = preprocessImage(img, { rotate, contrast });
        c.className = 'max-w-full max-h-[420px] mx-auto rounded-lg shadow';
        drop.innerHTML = '';
        drop.appendChild(c);
        $('#ds-rot').disabled = false;
        $('#ds-run').disabled = false;
    };
    const loadFile = (file) => {
        if (!file || !/^image\//.test(file.type)) { alert('이미지 파일(JPG·PNG)을 골라 주세요. PDF는 아직 지원하지 않습니다.'); return; }
        const url = URL.createObjectURL(file);
        const im = new Image();
        im.onload = () => { img = im; rotate = 0; showImage(); URL.revokeObjectURL(url); };
        im.onerror = () => alert('이미지를 열지 못했습니다.');
        im.src = url;
    };
    $('#ds-camera').addEventListener('change', (e) => { loadFile(e.target.files?.[0]); e.target.value = ''; });
    $('#ds-file').addEventListener('change', (e) => { loadFile(e.target.files?.[0]); e.target.value = ''; });
    const drop = $('#ds-drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('border-teal-500'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('border-teal-500'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('border-teal-500'); loadFile(e.dataTransfer.files?.[0]); });
    $('#ds-rot').addEventListener('click', () => { rotate = (rotate + 90) % 360; showImage(); });
    $('#ds-contrast').addEventListener('change', (e) => { contrast = e.target.checked; showImage(); });

    // ---------- 글자 읽기 ----------
    const setProgress = (m) => {
        const pct = Math.round((m.progress || 0) * 100);
        const label = { 'loading tesseract core': '인식 엔진 준비', 'initializing tesseract': '인식 엔진 준비', 'loading language traineddata': '한글 인식 자료 내려받는 중 (처음 한 번, 약 10MB)', 'initializing api': '준비', 'recognizing text': '글자 읽는 중' }[m.status] || m.status;
        $('#ds-bar').style.width = `${m.status === 'recognizing text' ? pct : Math.min(95, pct)}%`;
        $('#ds-progress-text').textContent = `${label}${pct ? ` ${pct}%` : ''}`;
    };
    $('#ds-run').addEventListener('click', async () => {
        if (!img || busy) return;
        busy = true;
        $('#ds-run').disabled = true;
        $('#ds-progress').classList.remove('hidden');
        setProgress({ status: 'loading tesseract core', progress: 0 });
        try {
            ocrText = await recognizeImage(preprocessImage(img, { rotate, contrast }), setProgress);
            $('#ds-text').value = ocrText;
            $('#ds-text-box').classList.remove('hidden');
            applyParse(ocrText);
            $('#ds-progress-text').textContent = `읽기 완료 · 품목 후보 ${rows.length}줄`;
            $('#ds-bar').style.width = '100%';
        } catch (e) {
            $('#ds-progress-text').textContent = `글자를 읽지 못했습니다: ${e.message || e}`;
        } finally {
            busy = false;
            $('#ds-run').disabled = false;
        }
    });
    $('#ds-reparse').addEventListener('click', () => { ocrText = $('#ds-text').value; applyParse(ocrText); });

    const applyParse = (text) => {
        const p = parseSlipText(text);
        if (p.date) head.date = p.date;
        if (p.partner) head.partner = p.partner;
        if (p.docNo) head.docNo = p.docNo;
        syncHead();
        rows = p.lines.map(l => ({
            id: rid(), text: l.text, code: l.item?.code || '', qty: l.qty || '', note: '',
            checked: !!(l.item && l.qty > 0 && l.score >= 0.9), how: l.how, qtyHow: l.qtyHow, status: ''
        }));
        renderRows();
        if (!rows.length) showToast('⚠️ 품목 줄을 찾지 못했습니다. 읽은 글자를 확인하거나 [+ 줄 추가]로 직접 넣어 주세요.');
    };

    // ---------- 확인 표 ----------
    const renderRows = () => {
        const tbody = $('#ds-rows');
        tbody.innerHTML = rows.length ? rows.map(r => {
            const m = masterOf(r.code);
            const tag = r.how === '코드' ? ['코드 일치', 'bg-emerald-100 text-emerald-700'] : r.how === '품명' ? ['품명 일치', 'bg-emerald-100 text-emerald-700'] : r.how === '유사' ? ['비슷함·확인', 'bg-amber-100 text-amber-800'] : r.code ? ['직접 선택', 'bg-slate-100 text-slate-600'] : ['품목 없음', 'bg-rose-100 text-rose-700'];
            return `<tr data-id="${r.id}" class="${r.status === 'done' ? 'bg-emerald-50/60' : ''}">
                <td class="p-2 text-center"><input type="checkbox" class="ds-chk w-4 h-4" ${r.checked ? 'checked' : ''} ${r.status === 'done' ? 'disabled' : ''} /></td>
                <td class="p-2 font-mono text-[11px] text-slate-500 max-w-[260px] truncate" title="${esc(r.text)}">${esc(r.text || '(직접 추가)')}</td>
                <td class="p-2 relative">
                    <input type="text" class="ds-item w-full border border-slate-300 rounded px-1.5 py-1 font-bold" value="${esc(m ? `[${m.code}] ${m.name}` : '')}" placeholder="코드·품목명 일부" autocomplete="off" ${r.status === 'done' ? 'disabled' : ''} />
                    <div class="ds-sg hidden absolute left-2 right-2 top-full z-20 max-h-56 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl"></div>
                    ${m?.spec && m.spec !== '-' ? `<div class="text-[10px] text-slate-400 mt-0.5">${esc(m.spec)}</div>` : ''}
                </td>
                <td class="p-2"><input type="number" min="0" step="any" class="ds-qty w-full border border-slate-300 rounded px-1.5 py-1 text-right font-black" value="${esc(r.qty)}" ${r.status === 'done' ? 'disabled' : ''} />
                    ${r.qtyHow === 'first' ? '<div class="text-[10px] text-amber-700 text-right">첫 숫자 · 확인</div>' : ''}</td>
                <td class="p-2 text-center font-bold text-slate-500">${esc(m?.unit || '-')}</td>
                <td class="p-2 whitespace-nowrap">${r.status === 'done' ? '<span class="px-1.5 py-0.5 rounded bg-emerald-600 text-white font-bold">등록됨</span>' : r.status ? `<span class="text-rose-600 font-bold" title="${esc(r.status)}">오류: ${esc(r.status.slice(0, 30))}</span>` : `<span class="px-1.5 py-0.5 rounded font-bold ${tag[1]}">${tag[0]}</span>`}</td>
                <td class="p-2 text-center">${r.status === 'done' ? '' : '<button type="button" class="ds-del text-slate-400 hover:text-rose-600 font-black px-1" title="줄 삭제">✕</button>'}</td>
            </tr>`;
        }).join('') : '<tr><td colspan="7" class="p-8 text-center text-slate-400 font-bold">전표 이미지를 올리고 [글자 읽기]를 누르세요.</td></tr>';
        updateSummary();
        tbody.querySelectorAll('tr[data-id]').forEach(tr => {
            const r = rows.find(x => x.id === tr.dataset.id);
            tr.querySelector('.ds-chk')?.addEventListener('change', (e) => { r.checked = e.target.checked; updateSummary(); });
            tr.querySelector('.ds-qty')?.addEventListener('input', (e) => { r.qty = e.target.value; r.qtyHow = ''; updateSummary(); });
            tr.querySelector('.ds-del')?.addEventListener('click', () => { rows = rows.filter(x => x !== r); renderRows(); });
            const inp = tr.querySelector('.ds-item');
            const sg = tr.querySelector('.ds-sg');
            if (!inp) return;
            let found = [];
            inp.addEventListener('input', () => {
                found = inp.value.trim() ? searchMasterItems(inp.value, 20) : [];
                sg.innerHTML = found.map((m, i) => `<button type="button" data-i="${i}" class="w-full text-left px-2 py-1.5 border-b border-slate-100 hover:bg-teal-50 flex gap-2"><span class="font-mono font-bold shrink-0">${esc(m.code)}</span><span class="font-bold truncate">${esc(m.name)}</span><span class="text-slate-400 truncate">${esc(m.spec && m.spec !== '-' ? m.spec : '')}</span></button>`).join('') || '<div class="p-2 text-slate-400">일치하는 품목이 없습니다.</div>';
                sg.classList.toggle('hidden', !inp.value.trim());
                sg.querySelectorAll('button').forEach(b => {
                    b.addEventListener('mousedown', (e) => e.preventDefault());
                    b.addEventListener('click', () => { r.code = found[Number(b.dataset.i)].code; r.how = ''; r.checked = Number(r.qty) > 0; renderRows(); });
                });
            });
            inp.addEventListener('blur', () => setTimeout(() => sg.classList.add('hidden'), 150));
        });
    };

    const updateSummary = () => {
        const ready = rows.filter(r => r.checked && r.status !== 'done' && r.code && Number(r.qty) > 0);
        $('#ds-summary').textContent = rows.length ? `${rows.length}줄 중 등록할 줄 ${ready.length}개${rows.some(r => r.checked && (!r.code || !(Number(r.qty) > 0)) && r.status !== 'done') ? ' (품목·수량이 빈 체크 줄은 건너뜀)' : ''}` : '';
        $('#ds-submit').disabled = ready.length === 0;
        $('#ds-all').checked = rows.length > 0 && rows.filter(r => r.status !== 'done').every(r => r.checked);
    };

    $('#ds-all').addEventListener('change', (e) => { rows.forEach(r => { if (r.status !== 'done') r.checked = e.target.checked; }); renderRows(); });
    $('#ds-add').addEventListener('click', () => { rows.push({ id: rid(), text: '', code: '', qty: '', note: '', checked: false, how: '', qtyHow: '', status: '' }); renderRows(); });
    $('#ds-type').addEventListener('change', (e) => { head.type = e.target.value; $('#ds-submit-text').textContent = `체크한 줄 ${head.type === 'IN' ? '입고' : '출고'} 등록`; });
    ['date', 'partner', 'docno', 'worker'].forEach(k => $(`#ds-${k}`).addEventListener('input', (e) => { head[k === 'docno' ? 'docNo' : k] = e.target.value.trim(); }));

    // ---------- 등록 ----------
    $('#ds-submit').addEventListener('click', async () => {
        head.location = $('#ds-loc').value;
        const ready = rows.filter(r => r.checked && r.status !== 'done' && r.code && Number(r.qty) > 0);
        if (!ready.length) return;
        const kind = head.type === 'IN' ? '입고' : '출고';
        const list = ready.slice(0, 15).map(r => `- [${r.code}] ${masterOf(r.code)?.name || ''} × ${r.qty}`).join('\n') + (ready.length > 15 ? `\n… 외 ${ready.length - 15}줄` : '');
        if (!confirm(`${head.location}에 ${ready.length}개 품목을 ${kind} 등록합니다.\n거래처: ${head.partner || '-'} / 전표일자: ${head.date || '-'}${head.docNo ? ` / 번호: ${head.docNo}` : ''}\n\n${list}\n\n진행할까요?`)) return;
        $('#ds-submit').disabled = true;
        let ok = 0;
        for (const r of ready) {
            try {
                await processStockAction({
                    type: head.type, code: r.code, qty: Number(r.qty), location: head.location,
                    worker: head.worker || state.currentGlobalWorker,
                    reason: `전표 스캔 ${kind}${head.partner ? ` · ${head.partner}` : ''}${head.date ? ` · 전표일 ${head.date}` : ''}${head.docNo ? ` · No.${head.docNo}` : ''}`
                });
                r.status = 'done';
                r.checked = false;
                ok++;
            } catch (e) {
                r.status = e.message || String(e);
            }
        }
        renderRows();
        const fail = ready.length - ok;
        showToast(`📄 전표 스캔 ${kind} ${ok}건 등록${fail ? `, ${fail}건 실패 (표의 오류 확인)` : ''}`);
    });

    renderRows();
};
