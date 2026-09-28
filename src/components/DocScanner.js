import { state, processStockAction, latestRawSg } from '../services/db.js';
import { searchMasterItems, localDateStr } from '../services/searchUtils.js';
import { locationOptionsHtml } from '../services/locations.js';
import { preprocessImage, recognizeBest, parseSlipText, parseReceiptText } from '../services/docOcr.js';
import { mountDocScanPanel, autoQuad, warpQuad } from './DocScanPanel.js';
import { summaryCanvas, canvasesToFiles, createSharer, shareStamp } from '../services/scanShare.js';
import { SCAN_SLIP_TYPES, saveScanSlip } from '../services/scanSlips.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';

// 전표 종류 목록은 전표관리와 함께 쓴다 (services/scanSlips.js)
const SLIP_TYPES = SCAN_SLIP_TYPES;

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
    // 전표관리 분류 탭의 [○○전표 스캔 등록]으로 들어오면 그 종류로 시작 (window.__docScanType)
    const startType = SCAN_SLIP_TYPES[window.__docScanType] ? window.__docScanType : 'IN';
    window.__docScanType = null;
    const head = { type: startType, date: localDateStr(), partner: '', docNo: '', location: '김포공장', worker: state.currentGlobalWorker || '' };
    let busy = false;
    const $ = (s) => container.querySelector(s);
    const rid = () => `r${Date.now().toString(36)}${Math.floor(Math.random() * 1e5)}`;
    const masterOf = (code) => state.master.find(m => m.code === code);
    // 단위: 품목 기본 단위로 등록하되, 기본 단위가 L·KG인 품목(원료·원액 등)은 전표에 적힌 단위(L/KG)로 입력하고 비중으로 환산
    const baseUnitOf = (code) => String(masterOf(code)?.unit || 'EA').toUpperCase();
    const convertible = (code) => ['L', 'KG'].includes(baseUnitOf(code));
    const defaultSg = (code) => latestRawSg(code, masterOf(code)?.name) || 1;
    const setItemUnit = (r) => {
        r.unit = convertible(r.code) && r.unitHint ? r.unitHint : baseUnitOf(r.code);
        r.sg = defaultSg(r.code);
    };
    const r3 = (n) => Math.round(n * 1000) / 1000;
    // 입력 수량 → 품목 기본 단위 수량
    const baseQty = (r) => {
        const q = Number(r.qty) || 0;
        const base = baseUnitOf(r.code);
        const sg = Number(r.sg) > 0 ? Number(r.sg) : 1;
        if (!r.unit || r.unit === base) return q;
        if (base === 'L' && r.unit === 'KG') return r3(q / sg);
        if (base === 'KG' && r.unit === 'L') return r3(q * sg);
        return q;
    };

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
                    <label class="flex items-center gap-1 font-bold" title="책상·바닥이 넓게 찍힌 사진에서 종이(전표·영수증) 부분만 잘라 읽습니다"><input type="checkbox" id="ds-crop" checked />종이만 자르기</label>
                    <button type="button" id="ds-run" class="ml-auto px-3 py-1.5 bg-teal-600 hover:bg-teal-700 text-white rounded-lg font-black flex items-center gap-1 disabled:opacity-40" disabled><i data-lucide="scan-text" class="w-4 h-4"></i>글자 읽기</button>
                </div>
                <div id="ds-progress" class="hidden">
                    <div class="h-2 bg-slate-100 rounded-full overflow-hidden"><div id="ds-bar" class="h-full bg-teal-500 transition-all" style="width:0%"></div></div>
                    <div id="ds-progress-text" class="text-[11px] text-slate-500 mt-1"></div>
                </div>
                <div id="ds-receipt-sum" class="hidden p-2 rounded-lg bg-violet-50 border border-violet-200 text-violet-900"></div>
                <details id="ds-text-box" class="hidden border border-slate-200 rounded-xl p-2">
                    <summary class="font-bold text-slate-600 cursor-pointer">읽은 글자 보기·고치기</summary>
                    <textarea id="ds-text" class="mt-2 w-full h-48 border border-slate-300 rounded-lg p-2 font-mono text-[11px]"></textarea>
                    <button type="button" id="ds-reparse" class="mt-1 px-2.5 py-1 bg-white border border-slate-300 rounded-lg font-bold">고친 글자로 다시 분석</button>
                </details>
                <div id="ds-scan-panel"></div>
            </div>
            <!-- 2. 확인·등록 -->
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div class="font-black text-slate-800">② 내용 확인 후 등록</div>
                <div class="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-2">
                    <label class="block"><span class="font-bold text-slate-500">전표 종류</span>
                        <select id="ds-type" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${Object.entries(SLIP_TYPES).map(([k, t]) => `<option value="${k}">${t.label}</option>`).join('')}</select></label>
                    <label id="ds-dir-box" class="block hidden"><span class="font-bold text-slate-500">재고</span>
                        <select id="ds-dir" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"><option value="IN">늘림 (+ 들어옴)</option><option value="OUT">줄임 (− 나감)</option></select></label>
                    <label class="block"><span class="font-bold text-slate-500">전표 일자</span><input type="date" id="ds-date" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                    <label class="block"><span class="font-bold text-slate-500">거래처</span><input type="text" id="ds-partner" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" /></label>
                    <label class="block"><span class="font-bold text-slate-500">전표 번호</span><input type="text" id="ds-docno" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-mono font-bold" /></label>
                    <label class="block"><span id="ds-loc-label" class="font-bold text-slate-500">입고 창고</span><select id="ds-loc" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${locationOptionsHtml(state.locations, head.location)}</select></label>
                    <label id="ds-to-box" class="block hidden"><span class="font-bold text-slate-500">도착 창고</span><select id="ds-to" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${locationOptionsHtml(state.locations, '')}</select></label>
                    <label class="block"><span class="font-bold text-slate-500">작업자</span><input type="text" id="ds-worker" list="ds-worker-list" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold" />
                        <datalist id="ds-worker-list">${(state.workers || []).map(w => `<option value="${esc(w.name)}"></option>`).join('')}</datalist></label>
                </div>
                <div id="ds-card-box" class="hidden border border-violet-200 bg-violet-50 rounded-xl p-3 space-y-2">
                    <div class="font-black text-violet-800 flex items-center gap-1"><i data-lucide="credit-card" class="w-4 h-4"></i>카드 사용 정보 <span class="font-normal text-violet-600">(월별 카드사용내역·영수증 제출에 쓰입니다)</span></div>
                    <div class="grid grid-cols-1 md:grid-cols-3 gap-2">
                        <label class="block"><span class="font-bold text-slate-500">결제 금액 (원)</span><input type="text" inputmode="numeric" id="ds-amount" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-black text-right bg-white" placeholder="0" /></label>
                        <label class="block"><span class="font-bold text-slate-500">카드</span><input type="text" id="ds-card" list="ds-card-list" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold bg-white" placeholder="예: 법인카드 1234" />
                            <datalist id="ds-card-list"></datalist></label>
                        <label class="block"><span class="font-bold text-slate-500">사용 용도</span><input type="text" id="ds-purpose" list="ds-purpose-list" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold bg-white" placeholder="예: 원료 구매, 식대, 주유" />
                            <datalist id="ds-purpose-list"></datalist></label>
                    </div>
                    <div class="flex flex-wrap items-center gap-2">
                        <button type="button" id="ds-card-only" class="px-3 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-black flex items-center gap-1 disabled:opacity-40"><i data-lucide="receipt" class="w-4 h-4"></i>재고 없이 카드 사용만 기록</button>
                        <span class="text-[11px] text-slate-500">식대·주유처럼 재고 품목이 아닌 영수증은 이 버튼으로 기록합니다. 재고 품목이 있으면 아래 표에서 체크한 뒤 등록하세요(카드 정보도 함께 저장).</span>
                    </div>
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
                    <span class="ml-auto flex gap-1">
                        <button type="button" id="ds-slip-save" class="px-2.5 py-2 bg-white border border-slate-300 rounded-xl font-bold flex items-center gap-1 disabled:opacity-40" title="전표 내용 요약 + 전표 사진을 PDF로 저장"><i data-lucide="download" class="w-4 h-4"></i>PDF 저장</button>
                        <button type="button" id="ds-slip-share" class="px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl font-black flex items-center gap-1 disabled:opacity-40" title="전표 내용 요약 + 전표 사진을 메신저·메일로 공유"><i data-lucide="share-2" class="w-4 h-4"></i>전표 공유</button>
                    </span>
                    <button type="button" id="ds-submit" class="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white rounded-xl font-black flex items-center gap-1 disabled:opacity-40"><i data-lucide="check-circle" class="w-4 h-4"></i><span id="ds-submit-text">체크한 줄 입고 등록</span></button>
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
        updateSlipButtons();
    };
    // 종이만 자르기: 책상·바닥이 넓게 찍히면 글자가 작아 못 읽으므로, 종이(전표·영수증) 부분만 반듯하게 펴서 읽는다
    let orig = null;     // 올린 원본 (문서 스캔 쪽에는 원본을 넘김 — 거기서 따로 자름)
    let cropped = null;  // 종이 부분만 편 그림 (못 찾으면 null)
    const useCrop = () => $('#ds-crop').checked && cropped;
    const applyCrop = () => { img = useCrop() ? cropped : orig; };
    const makeCrop = async (im) => {
        cropped = null;
        try {
            const q = autoQuad(im);
            if (!q) return;
            const c = warpQuad(im, q, 2600);
            const w = new Image();
            w.src = c.toDataURL('image/jpeg', 0.92);
            await w.decode();
            cropped = w;
        } catch (e) { console.warn('[전표 스캔] 종이 부분 찾기 실패', e); }
    };
    const loadFile = (file) => {
        if (!file || !/^image\//.test(file.type)) { alert('이미지 파일(JPG·PNG)을 골라 주세요. PDF는 아직 지원하지 않습니다.'); return; }
        const url = URL.createObjectURL(file);
        const im = new Image();
        im.onload = async () => {
            orig = im;
            rotate = 0;
            await makeCrop(im);
            applyCrop();
            if (cropped && $('#ds-crop').checked) showToast('✂ 종이 부분만 잘라 읽습니다. 잘못 잘렸으면 [종이만 자르기]를 끄세요.');
            showImage();
            scanPanel?.refresh();
            URL.revokeObjectURL(url);
        };
        im.onerror = () => alert('이미지를 열지 못했습니다.');
        im.src = url;
    };
    // 문서 스캔(저장·공유): 위 전표 이미지를 스캔 쪽으로 넘길 수 있게 현재 이미지·회전을 알려 준다
    const scanPanel = mountDocScanPanel($('#ds-scan-panel'), { getCurrent: () => ({ img: orig, rotate }), showToast });
    $('#ds-crop').addEventListener('change', () => {
        if (!orig) return;
        if ($('#ds-crop').checked && !cropped) showToast('⚠️ 이 사진에서는 종이 부분을 찾지 못했습니다. 원본 그대로 읽습니다.');
        applyCrop();
        showImage();
    });
    $('#ds-camera').addEventListener('change', (e) => { loadFile(e.target.files?.[0]); e.target.value = ''; });
    $('#ds-file').addEventListener('change', (e) => { loadFile(e.target.files?.[0]); e.target.value = ''; });
    const drop = $('#ds-drop');
    drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('border-teal-500'); });
    drop.addEventListener('dragleave', () => drop.classList.remove('border-teal-500'));
    drop.addEventListener('drop', (e) => { e.preventDefault(); drop.classList.remove('border-teal-500'); loadFile(e.dataTransfer.files?.[0]); });
    $('#ds-rot').addEventListener('click', () => { rotate = (rotate + 90) % 360; showImage(); });
    // 흑백·대비 보정: 표가 있는 전표에는 도움이 되지만 영수증(감열지)은 흐린 글자를 지우기도 해서 카드사용이면 기본으로 끈다
    let contrastTouched = false; // 사람이 직접 바꿨으면 종류를 바꿔도 그대로
    $('#ds-contrast').addEventListener('change', (e) => { contrast = e.target.checked; contrastTouched = true; showImage(); });
    const syncContrastDefault = () => {
        if (contrastTouched) return;
        const want = head.type !== 'CARD';
        if (contrast === want) return;
        contrast = want;
        $('#ds-contrast').checked = want;
        if (img) showImage();
    };

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
            const res = await recognizeBest(img, { rotate, contrast, receipt: head.type === 'CARD' }, setProgress);
            ocrText = res.text;
            $('#ds-text').value = ocrText;
            $('#ds-text-box').classList.remove('hidden');
            applyParse(ocrText, res.receipt || null);
            // 영수증은 여러 번 읽어 고른 값을 따로 보여 준다 (아래 '읽은 글자'는 그중 한 번의 결과)
            const rs = res.receipt;
            $('#ds-receipt-sum').classList.toggle('hidden', !rs);
            if (rs) {
                $('#ds-receipt-sum').innerHTML = `<b>💳 영수증에서 고른 값</b> (여러 번 읽어 가장 믿을 만한 값, 오른쪽 칸에 채움)<br>
                    사용처 <b>${esc(rs.partner || '못 찾음')}</b> · 금액 <b>${rs.amount ? `${rs.amount.toLocaleString('ko-KR')}원` : '못 찾음'}</b> · 카드 <b>${esc([rs.issuer, rs.last4].filter(Boolean).join(' ') || '못 찾음')}</b> · 일자 <b>${esc(rs.date || '못 찾음')}</b>${rs.approvalNo ? ` · 승인번호 ${esc(rs.approvalNo)}` : ''}
                    <div class="text-[10px] text-violet-700 mt-0.5">아래 '읽은 글자'는 여러 번 읽은 것 중 하나라 깨져 보일 수 있습니다. 못 찾은 값은 직접 넣어 주세요.</div>`;
            }
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

    // receipt: 영수증 여러 번 읽기로 고른 값(업체명·금액·카드·일자). 없으면(고친 글자로 다시 분석) 글자에서 바로 찾는다
    const applyParse = (text, receipt = null) => {
        const p = parseSlipText(text);
        const rc = head.type === 'CARD' ? (receipt || { ...parseReceiptText(text), date: p.date }) : null;
        if (rc?.date || p.date) head.date = rc?.date || p.date;
        // 카드 영수증은 영수증 규칙(맨 위 업체명 등)으로 사용처를 찾는다
        const rp = rc?.partner || '';
        if (rp || p.partner) head.partner = rp || p.partner;
        if (p.docNo) head.docNo = p.docNo;
        syncHead();
        // 카드 영수증은 메뉴·번호 줄이 대부분이라 품목마스터와 맞는 줄(재고 품목)만 표에 넣는다
        const lines = rc ? p.lines.filter(l => l.item) : p.lines;
        rows = lines.map(l => {
            const r = {
                id: rid(), text: l.text, code: l.item?.code || '', qty: l.qty || '', note: '', unitHint: l.unitHint || '',
                checked: !!(l.item && l.qty > 0 && l.score >= 0.9), how: l.how, qtyHow: l.qtyHow, status: ''
            };
            setItemUnit(r);
            return r;
        });
        renderRows();
        if (rc) fillCardAmount(rc);
        if (head.type === 'CARD') { if (!rows.length) showToast('💳 재고 품목과 맞는 줄이 없습니다. 재고와 관계없는 영수증이면 [재고 없이 카드 사용만 기록]을 누르세요 (재고 품목이 있으면 [+ 줄 추가]).'); }
        else if (!rows.length) showToast('⚠️ 품목 줄을 찾지 못했습니다. 읽은 글자를 확인하거나 [+ 줄 추가]로 직접 넣어 주세요.');
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
                <td class="p-2 text-center font-bold text-slate-500 whitespace-nowrap">${!m ? '-' : !convertible(r.code) ? esc(baseUnitOf(r.code)) : `
                    <select class="ds-unit border border-slate-300 rounded px-1 py-1 font-bold" ${r.status === 'done' ? 'disabled' : ''}>
                        ${['L', 'KG'].map(u => `<option value="${u}" ${r.unit === u ? 'selected' : ''}>${u}</option>`).join('')}
                    </select>
                    ${r.unit !== baseUnitOf(r.code) ? `<div class="mt-1 flex items-center gap-1 justify-center text-[10px] font-normal">비중
                        <input type="number" min="0" step="0.001" class="ds-sg-in w-14 border border-slate-300 rounded px-1 py-0.5 text-right" value="${esc(r.sg)}" ${r.status === 'done' ? 'disabled' : ''} /></div>
                        <div class="ds-conv text-[10px] text-teal-700 font-bold">= ${esc(baseQty(r).toLocaleString())} ${esc(baseUnitOf(r.code))}</div>` : ''}`}</td>
                <td class="p-2 whitespace-nowrap">${r.status === 'done' ? '<span class="px-1.5 py-0.5 rounded bg-emerald-600 text-white font-bold">등록됨</span>' : r.status ? `<span class="text-rose-600 font-bold" title="${esc(r.status)}">오류: ${esc(r.status.slice(0, 30))}</span>` : `<span class="px-1.5 py-0.5 rounded font-bold ${tag[1]}">${tag[0]}</span>`}</td>
                <td class="p-2 text-center">${r.status === 'done' ? '' : '<button type="button" class="ds-del text-slate-400 hover:text-rose-600 font-black px-1" title="줄 삭제">✕</button>'}</td>
            </tr>`;
        }).join('') : `<tr><td colspan="7" class="p-8 text-center text-slate-400 font-bold">${ocrText && head.type === 'CARD' ? '재고 품목과 맞는 줄이 없습니다. 재고와 관계없는 영수증이면 위의 [재고 없이 카드 사용만 기록]을 누르세요. 재고 품목이 있으면 [+ 줄 추가]로 넣으세요.' : '전표 이미지를 올리고 [글자 읽기]를 누르세요.'}</td></tr>`;
        updateSummary();
        tbody.querySelectorAll('tr[data-id]').forEach(tr => {
            const r = rows.find(x => x.id === tr.dataset.id);
            tr.querySelector('.ds-chk')?.addEventListener('change', (e) => { r.checked = e.target.checked; updateSummary(); });
            const showConv = () => { const c = tr.querySelector('.ds-conv'); if (c) c.textContent = `= ${baseQty(r).toLocaleString()} ${baseUnitOf(r.code)}`; };
            tr.querySelector('.ds-qty')?.addEventListener('input', (e) => { r.qty = e.target.value; r.qtyHow = ''; showConv(); updateSummary(); });
            tr.querySelector('.ds-unit')?.addEventListener('change', (e) => { r.unit = e.target.value; renderRows(); });
            tr.querySelector('.ds-sg-in')?.addEventListener('input', (e) => { r.sg = e.target.value; showConv(); });
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
                    b.addEventListener('click', () => { r.code = found[Number(b.dataset.i)].code; r.how = ''; r.checked = Number(r.qty) > 0; setItemUnit(r); renderRows(); });
                });
            });
            inp.addEventListener('blur', () => setTimeout(() => sg.classList.add('hidden'), 150));
        });
    };

    const updateSummary = () => {
        const ready = rows.filter(r => r.checked && r.status !== 'done' && r.code && baseQty(r) > 0);
        $('#ds-summary').textContent = rows.length ? `${rows.length}줄 중 등록할 줄 ${ready.length}개${rows.some(r => r.checked && (!r.code || !(Number(r.qty) > 0)) && r.status !== 'done') ? ' (품목·수량이 빈 체크 줄은 건너뜀)' : ''}` : '';
        $('#ds-submit').disabled = ready.length === 0;
        $('#ds-all').checked = rows.length > 0 && rows.filter(r => r.status !== 'done').every(r => r.checked);
        updateSlipButtons();
    };

    $('#ds-all').addEventListener('change', (e) => { rows.forEach(r => { if (r.status !== 'done') r.checked = e.target.checked; }); renderRows(); });
    $('#ds-add').addEventListener('click', () => { rows.push({ id: rid(), text: '', code: '', qty: '', note: '', unit: '', unitHint: '', sg: 1, checked: false, how: '', qtyHow: '', status: '' }); renderRows(); });
    // 종류에 따라 늘림/줄임 선택(기타)·도착 창고(이동)·창고 이름표를 바꾼다
    const slipType = () => SLIP_TYPES[head.type] || SLIP_TYPES.IN;
    const slipAction = () => slipType().action || $('#ds-dir').value;
    const syncTypeUi = () => {
        const t = slipType();
        const act = slipAction();
        $('#ds-dir-box').classList.toggle('hidden', !!t.action);
        $('#ds-to-box').classList.toggle('hidden', act !== 'MOVE');
        $('#ds-loc-label').textContent = act === 'MOVE' ? '출발 창고' : `${t.word} 창고`;
        $('#ds-submit-text').textContent = `체크한 줄 ${t.word} 등록`;
        $('#ds-card-box').classList.toggle('hidden', head.type !== 'CARD');
        syncContrastDefault();
        if (head.type === 'CARD' && ocrText) fillCardAmount(ocrText);
    };

    // ---------- 카드 사용 정보 (카드전표) ----------
    const CARD_PREF = 'daelim_card_pref'; // 이 기기에서 쓴 카드·용도 목록 (입력 도움)
    const cardPref = (() => { try { return JSON.parse(localStorage.getItem(CARD_PREF) || '{}'); } catch { return {}; } })();
    const fillCardLists = () => {
        $('#ds-card-list').innerHTML = (cardPref.cards || []).map(c => `<option value="${esc(c)}"></option>`).join('');
        $('#ds-purpose-list').innerHTML = [...new Set([...(cardPref.purposes || []), '원료 구매', '부자재 구매', '소모품 구매', '식대', '주유', '택배·운송', '수리·수선'])].map(c => `<option value="${esc(c)}"></option>`).join('');
    };
    const rememberCard = (card, purpose) => {
        const push = (arr, v) => (v ? [v, ...(arr || []).filter(x => x !== v)].slice(0, 10) : arr || []);
        cardPref.cards = push(cardPref.cards, card);
        cardPref.purposes = push(cardPref.purposes, purpose);
        if (card) cardPref.last = card;
        try { localStorage.setItem(CARD_PREF, JSON.stringify(cardPref)); } catch { /* 저장 공간 없음 */ }
        fillCardLists();
    };
    fillCardLists();
    if (cardPref.last) $('#ds-card').value = cardPref.last;
    const cardAmount = () => Number(String($('#ds-amount').value).replace(/[^\d.-]/g, '')) || 0;
    const cardInfo = () => (head.type === 'CARD' ? { amount: cardAmount(), card: $('#ds-card').value.trim(), purpose: $('#ds-purpose').value.trim() } : {});
    $('#ds-amount').addEventListener('input', (e) => {
        const n = cardAmount();
        e.target.value = n ? n.toLocaleString('ko-KR') : e.target.value.replace(/[^\d]/g, '');
    });
    // 영수증 글자 → 업체명(사용처)·결제 금액·카드(카드사 + 끝 4자리)를 빈 칸에 채운다
    let cardTyped = false; // 카드 칸을 사람이 직접 고쳤으면 덮어쓰지 않음
    $('#ds-card').addEventListener('input', () => { cardTyped = true; });
    const fillCardAmount = (textOrReceipt) => {
        const r = typeof textOrReceipt === 'string' ? parseReceiptText(textOrReceipt) : textOrReceipt;
        const found = [];
        if (r.partner && !head.partner) { head.partner = r.partner; $('#ds-partner').value = r.partner; found.push(`사용처 ${r.partner}`); }
        // 새로 읽은 영수증 금액으로 바꾼다 (앞 영수증 금액이 남아 있지 않게)
        if (r.amount) { $('#ds-amount').value = r.amount.toLocaleString('ko-KR'); found.push(`금액 ${r.amount.toLocaleString('ko-KR')}원`); }
        if ((r.issuer || r.last4) && !cardTyped) {
            // 이 기기에서 쓴 카드 중 끝 4자리가 같은 것이 있으면 그 이름으로
            const known = r.last4 && (cardPref.cards || []).find(c => c.includes(r.last4));
            const card = known || `${r.issuer || '카드'}${r.last4 ? ` ${r.last4}` : ''}`;
            $('#ds-card').value = card;
            found.push(`카드 ${card}`);
        }
        // 카드 영수증은 주문번호보다 승인번호가 대조에 쓰이므로 승인번호를 원본 번호로
        if (r.approvalNo && head.docNo !== r.approvalNo) { head.docNo = r.approvalNo; $('#ds-docno').value = r.approvalNo; found.push(`승인번호 ${r.approvalNo}`); }
        if (found.length) showToast(`💳 영수증에서 찾았습니다: ${found.join(' · ')}. 맞는지 확인하세요.`);
    };
    // 영수증 사진 (보정한 모습, 긴 변 1800px JPEG)
    const photoBlob = async () => {
        if (!img) return null;
        const p = preprocessImage(img, { rotate, contrast });
        const k = Math.min(1, 1800 / Math.max(p.width, p.height));
        const c = document.createElement('canvas');
        c.width = Math.round(p.width * k);
        c.height = Math.round(p.height * k);
        c.getContext('2d').drawImage(p, 0, 0, c.width, c.height);
        return new Promise(res => c.toBlob(res, 'image/jpeg', 0.8));
    };
    $('#ds-card-only').addEventListener('click', async (e) => {
        const info = cardInfo();
        head.location = $('#ds-loc').value;
        if (!info.amount && !confirm('결제 금액이 비어 있습니다. 금액 없이 기록할까요?')) { $('#ds-amount').focus(); return; }
        if (!img && !confirm('영수증 사진이 없습니다. 사진 없이 기록할까요?')) return;
        if (!confirm(`카드 사용을 기록합니다 (재고는 바꾸지 않음).\n일자 ${head.date || '-'} · 사용처 ${head.partner || '-'} · ${info.amount.toLocaleString('ko-KR')}원\n카드 ${info.card || '-'} · 용도 ${info.purpose || '-'}\n\n진행할까요?`)) return;
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
            const { rec, photoError } = await saveScanSlip({
                kind: 'CARD', action: 'NONE', date: head.date || localDateStr(), partner: head.partner, docNo: head.docNo,
                worker: head.worker || state.currentGlobalWorker || '', items: [], ...info
            }, { photo: await photoBlob() });
            rememberCard(info.card, info.purpose);
            showToast(`💳 카드 사용을 ${rec.regNo}로 기록했습니다.${photoError ? ` (사진은 올리지 못했습니다: ${photoError})` : ''}`);
        } catch (err) {
            alert(err.message);
        } finally {
            btn.disabled = false;
        }
    });

    $('#ds-type').addEventListener('change', (e) => { head.type = e.target.value; syncTypeUi(); });
    $('#ds-dir').addEventListener('change', syncTypeUi);
    syncTypeUi();
    ['date', 'partner', 'docno', 'worker'].forEach(k => $(`#ds-${k}`).addEventListener('input', (e) => { head[k === 'docno' ? 'docNo' : k] = e.target.value.trim(); }));

    // ---------- 등록 ----------
    $('#ds-submit').addEventListener('click', async () => {
        head.location = $('#ds-loc').value;
        const ready = rows.filter(r => r.checked && r.status !== 'done' && r.code && baseQty(r) > 0);
        if (!ready.length) return;
        const kind = slipType().word;
        const action = slipAction();
        const toLoc = $('#ds-to').value;
        if (action === 'MOVE' && (!toLoc || toLoc === head.location)) { alert('도착 창고를 출발 창고와 다르게 골라 주세요.'); return; }
        const effect = action === 'IN' ? '재고 늘림 (+)' : action === 'MOVE' ? `${head.location} → ${toLoc}` : '재고 줄임 (−)';
        const conv = (r) => (r.unit && r.unit !== baseUnitOf(r.code) ? ` ${r.unit} → ${baseQty(r)} ${baseUnitOf(r.code)} (비중 ${r.sg})` : ` ${baseUnitOf(r.code)}`);
        const list = ready.slice(0, 15).map(r => `- [${r.code}] ${masterOf(r.code)?.name || ''} × ${r.qty}${conv(r)}`).join('\n') + (ready.length > 15 ? `\n… 외 ${ready.length - 15}줄` : '');
        if (!confirm(`${action === 'MOVE' ? '' : `${head.location}에 `}${ready.length}개 품목을 ${kind} 등록합니다. (${effect})\n거래처: ${head.partner || '-'} / 전표일자: ${head.date || '-'}${head.docNo ? ` / 번호: ${head.docNo}` : ''}\n\n${list}\n\n진행할까요?`)) return;
        $('#ds-submit').disabled = true;
        let ok = 0;
        for (const r of ready) {
            try {
                const converted = r.unit && r.unit !== baseUnitOf(r.code);
                await processStockAction({
                    type: action, code: r.code, qty: baseQty(r), location: head.location,
                    ...(action === 'MOVE' ? { fromLoc: head.location, toLoc } : {}),
                    // 수불부 구분: 입고·출고·사용·이동은 기본 글자, 구매·카드사용·폐기·기타는 종류 이름
                    ledgerType: ['IN', 'OUT', 'USE', 'MOVE'].includes(head.type) ? '' : kind,
                    worker: head.worker || state.currentGlobalWorker,
                    at: head.date || '', // 입출고 이력·수불부를 등록한 날이 아니라 전표 일자로 기록
                    reason: `전표 스캔 ${kind}${head.partner ? ` · ${head.partner}` : ''}${head.date ? ` · 전표일 ${head.date}` : ''}${head.docNo ? ` · No.${head.docNo}` : ''}${converted ? ` · 전표 ${r.qty} ${r.unit} (비중 ${r.sg})` : ''}`
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
        // 전표관리에 보일 기록 한 건 (등록된 줄 + 전표 사진). 실패해도 재고 등록은 이미 끝났다.
        const done = ready.filter(r => r.status === 'done');
        if (!done.length) return;
        try {
            const photo = await photoBlob();
            const info = cardInfo();
            if (head.type === 'CARD') rememberCard(info.card, info.purpose);
            const { rec, photoError } = await saveScanSlip({
                ...info,
                kind: head.type, action, date: head.date || localDateStr(), partner: head.partner, docNo: head.docNo,
                fromLoc: action === 'IN' ? '' : head.location,
                toLoc: action === 'IN' ? head.location : action === 'MOVE' ? toLoc : '',
                worker: head.worker || state.currentGlobalWorker || '',
                items: done.map(r => {
                    const m = masterOf(r.code);
                    return { code: r.code, name: m?.name || '', spec: m?.spec && m.spec !== '-' ? m.spec : '', qty: Number(r.qty) || 0, unit: r.unit || baseUnitOf(r.code), baseQty: baseQty(r), baseUnit: baseUnitOf(r.code), sg: r.unit && r.unit !== baseUnitOf(r.code) ? Number(r.sg) || 1 : null, text: r.text || '' };
                })
            }, { photo });
            showToast(`🗂️ 전표관리에 ${rec.regNo}로 기록했습니다.${photoError ? ` (사진은 올리지 못했습니다: ${photoError})` : ''}`);
        } catch (e) {
            showToast(`⚠️ 재고 등록은 끝났지만 전표관리 기록을 남기지 못했습니다: ${e.message}`);
        }
    });

    // ---------- 전표 공유 (내용 요약 1쪽 + 전표 사진) ----------
    const slipRows = () => rows.filter(r => r.code || Number(r.qty) > 0);
    const slipCanvases = () => {
        head.location = $('#ds-loc').value;
        const kind = slipType().word;
        const action = slipAction();
        const list = slipRows();
        const done = list.filter(r => r.status === 'done').length;
        const summary = summaryCanvas({
            title: `전표 ${kind} 내용`,
            subtitle: '대림오일 WMS · 전표 스캔 (글자 읽기 후 확인한 내용)',
            fields: [
                ['구분', kind], ['전표 일자', head.date], ['거래처', head.partner], ['전표 번호', head.docNo],
                ...(action === 'MOVE' ? [['출발 창고', head.location], ['도착 창고', $('#ds-to').value]] : [[`${kind} 창고`, head.location]]),
                ['재고', action === 'IN' ? '늘림 (+)' : action === 'MOVE' ? '창고 이동' : '줄임 (−)'], ['작업자', head.worker || state.currentGlobalWorker || ''],
                ['품목', `${list.length}줄 (등록됨 ${done} · 미등록 ${list.length - done})`]
            ],
            table: {
                head: ['No', '품목코드', '품목명', '수량', '단위', '재고 반영', '상태'],
                widths: [5, 14, 37, 10, 7, 14, 10],
                align: ['center', 'left', 'left', 'right', 'center', 'right', 'center'],
                rows: list.map((r, i) => {
                    const m = masterOf(r.code);
                    const conv = m && r.unit && r.unit !== baseUnitOf(r.code) ? `${baseQty(r).toLocaleString()} ${baseUnitOf(r.code)}` : '';
                    return [String(i + 1), r.code || '-', m ? m.name : `(품목 없음) ${r.text || ''}`, (Number(r.qty) || 0).toLocaleString(), m ? (r.unit || baseUnitOf(r.code)) : '', conv, r.status === 'done' ? '등록됨' : '미등록'];
                })
            },
            note: `만든 시각 ${new Date().toLocaleString('ko-KR')}${img ? ' · 다음 쪽: 전표 사진' : ''}`
        });
        if (!img) return [summary];
        // 전표 사진 (보정한 모습, 긴 변 2000px 이하)
        const p = preprocessImage(img, { rotate, contrast });
        const k = Math.min(1, 2000 / Math.max(p.width, p.height));
        if (k >= 1) return [summary, p];
        const s = document.createElement('canvas');
        s.width = Math.round(p.width * k);
        s.height = Math.round(p.height * k);
        s.getContext('2d').drawImage(p, 0, 0, s.width, s.height);
        return [summary, s];
    };
    const slipKey = () => (slipRows().length || img ? JSON.stringify([head, $('#ds-loc').value, $('#ds-to').value, $('#ds-dir').value, rotate, contrast, img?.src || '', slipRows().map(r => [r.code, r.qty, r.unit, r.sg, r.status])]) : '');
    const slipBase = () => `slip_${shareStamp()}`;
    const sharer = createSharer({ build: (format) => canvasesToFiles(slipCanvases(), { format, base: slipBase() }), key: slipKey, showToast });
    const updateSlipButtons = () => {
        const on = !!slipKey();
        $('#ds-slip-share').disabled = !on;
        $('#ds-slip-save').disabled = !on;
        if (on) sharer.schedule();
    };
    $('#ds-slip-share').addEventListener('click', (e) => sharer.onClick(e.currentTarget));
    $('#ds-slip-save').addEventListener('click', async (e) => {
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
            const kind = slipType().word;
            const name = `전표_${kind}_${head.date || localDateStr()}${head.partner ? `_${head.partner}` : ''}`.replace(/[\\/:*?"<>|\s]+/g, '_');
            const [f] = await canvasesToFiles(slipCanvases(), { format: 'pdf', base: name });
            const a = document.createElement('a');
            a.href = URL.createObjectURL(f);
            a.download = f.name;
            document.body.appendChild(a);
            a.click();
            a.remove();
            setTimeout(() => URL.revokeObjectURL(a.href), 10000);
            showToast(`💾 ${f.name}을 이 기기에 저장했습니다.`);
        } catch (err) {
            alert(`PDF를 만들지 못했습니다: ${err.message || err}`);
        } finally {
            btn.disabled = !slipKey();
        }
    });
    // 내용이 바뀔 때마다 공유 파일을 미리 만들어 둔다 (누르는 즉시 공유 창을 열기 위해)
    ['#ds-loc', '#ds-to', '#ds-dir'].forEach(s => $(s).addEventListener('change', updateSlipButtons));
    ['#ds-type', '#ds-date', '#ds-partner', '#ds-docno', '#ds-worker'].forEach(s => $(s).addEventListener('input', updateSlipButtons));
    $('#ds-type').addEventListener('change', updateSlipButtons);
    $('#ds-rows').addEventListener('input', updateSlipButtons);
    $('#ds-rows').addEventListener('change', updateSlipButtons);

    renderRows();
};
