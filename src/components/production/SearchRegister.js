// ==========================================
// 제품생산/입고 → [검색 등록] 탭
// ==========================================
// ① [입고 등록] → 생산 제품을 QR·바코드 스캔 또는 코드·품명 검색으로 고르고 수량·LOT·위치·제조일을 넣는다
// ② 원액(원료)·부자재를 QR 또는 검색으로 골라 사용량을 넣는다 (포장사용기준서가 있으면 미리 채움)
// ③ [생산입고 반영] → 직접 등록 폼(api.fillForm)에 그대로 옮겨 기존 처리(자동 차감·수불부·업무일지·초중종물·수율표·IBC)를 모두 타고,
//    성공하면 완제품은 입력한 사용량을 1단위 기준으로 포장사용기준서(wms_product_boms)에 저장한다.
import { state, aliasMasterOf } from '../../services/db.js';
import { localDateStr, matchesQuery } from '../../services/searchUtils.js';
import { locationOptionsHtml } from '../../services/locations.js';
import { esc } from '../../services/html.js';
import { createIcons, icons } from '../../services/icons.js';
import { getBoms, loadBoms, saveBom } from '../../services/plans.js';
import { itemCodeOfScan, parseFieldQr, splitActValue, splitRawQrValue } from '../../services/fieldQr.js';
import { guessPackSlot } from '../PackUsageStandards.js';

const PRODUCT_CATS = ['완제품', '원액', '반제품'];
const RAW_CATS = ['원액', '원료'];
const r4 = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const r3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const prodTypeOf = (m) => (m.category === '원액' ? '원액' : m.category === '반제품' ? '반제품' : '완제품');
const unitOfType = (t) => (t === '원액' ? 'L' : t === '반제품' ? 'KG' : 'EA');
const matUnit = (m) => {
    if (!RAW_CATS.includes(m.category)) return 'EA';
    const u = String(m.unit || '').trim().toUpperCase();
    return u === 'KG' || u === 'G' ? u : 'L';
};

/** 스캔한 글자 → 품목 (품목 QR 링크·작업 QR·원료 탱크 QR·바코드·약칭) */
export const itemOfScan = (text) => {
    const f = parseFieldQr(text);
    let key = '';
    if (f?.type === 'ACT') key = splitActValue(f.value).code;
    else if (f?.type === 'RAW') key = splitRawQrValue(f.value).key;
    else if (!f) key = itemCodeOfScan(text);
    if (!key) return null;
    return state.master.find(m => m.code === key)
        || state.master.find(m => m.code.toLowerCase() === key.toLowerCase())
        || (f?.type === 'RAW' ? state.master.find(m => m.name === key) : null)
        || aliasMasterOf(key)
        || null;
};

// 코드·품명·규격 일부로 찾기: 코드 일치 → 코드·품명 시작 → 나머지
const searchPool = (pool, q, limit = 30) => {
    if (!q) return [];
    const lq = q.toLowerCase().replace(/\s+/g, '');
    const rank = (m) => {
        const code = String(m.code || '').toLowerCase();
        const name = String(m.name || '').toLowerCase().replace(/\s+/g, '');
        return code === lq ? 0 : code.startsWith(lq) || name.startsWith(lq) ? 1 : 2;
    };
    return pool.filter(m => matchesQuery(m, q, ['code', 'name', 'spec'])).sort((a, b) => rank(a) - rank(b)).slice(0, limit);
};

// 카메라 QR 스캐너 (html5-qrcode 저수준 API, 버튼 한 번에 바로 켬)
// 화면(본문)을 다시 그려도 끊기지 않게 본문 밖의 떠 있는 창(hostId)에 띄운다. 화면을 떠나면(host가 문서에서 빠지면) 스스로 끈다.
const createCamera = (hostId, onText, isAlive) => {
    let cam = null;
    let timer = null;
    let last = { text: '', at: 0 };
    const stop = async () => {
        clearInterval(timer);
        if (!cam) return;
        const c = cam;
        cam = null;
        try { await c.stop(); } catch { /* 이미 멈춤 */ }
        try { c.clear(); } catch { /* 없음 */ }
    };
    const start = async () => {
        const { Html5Qrcode } = await import('html5-qrcode');
        cam = new Html5Qrcode(hostId);
        const cfg = { fps: 10, qrbox: { width: 200, height: 200 } };
        const onDecoded = (text) => {
            // 같은 QR이 1.5초 안에 다시 읽히면 무시 (한 번 비추는 동안 여러 번 읽힘)
            const now = Date.now();
            if (text === last.text && now - last.at < 1500) return;
            last = { text, at: now };
            onText(text);
        };
        try { await cam.start({ facingMode: 'environment' }, cfg, onDecoded, () => {}); }
        catch { await cam.start({ facingMode: 'user' }, cfg, onDecoded, () => {}); }
        timer = setInterval(() => { if (!isAlive()) stop(); }, 1500);
    };
    return { start, stop, get on() { return !!cam; } };
};

/**
 * @param {HTMLElement} host
 * @param {{ showToast: Function, fillForm: Function, submitForm: Function, defaultLocation: string }} api
 *   fillForm({ item, prodType, qty, lot, location, mfgDate, raws, subs }) — 직접 등록 폼을 채움
 *   submitForm(afterSuccess) — 직접 등록 폼 제출, 성공하면 afterSuccess() 뒤 화면을 다시 그림
 */
export const mountSearchRegister = (host, api) => {
    const { showToast } = api;
    const today = localDateStr();
    let step = 0; // 0 시작 · 1 제품 · 2 원액·부자재
    let prod = null; // { item, prodType, qty, lot, location, mfgDate }
    let mats = []; // { code, total, loc }
    let fromStandard = '';
    let matsTouched = false; // 기준서로 채운 뒤 사람이 고쳤는지 (안 고쳤으면 수량을 바꿀 때 다시 계산)
    let stdQty = 0;
    let saveStd = true;
    let camera = null;
    let scanHandler = null; // 지금 단계의 스캔 처리 (카메라가 읽은 글자를 넘김)
    // 원액생산 작업지시서 연결 (api.workOrders: 마스터·작업일지 관리자만). 연결하면 처리 뒤 지시서가 '생산 완료'가 된다
    let workOrder = null;
    let woUnlinked = [];
    const wo = api.workOrders || null;
    loadBoms().catch(() => {});

    host.innerHTML = `<div id="sr-body"></div>
        <div id="sr-cam-wrap" class="hidden fixed z-[60] bottom-3 right-3 w-64 max-w-[calc(100vw-1.5rem)] bg-slate-900 rounded-2xl p-2 shadow-2xl">
            <div class="flex items-center justify-between text-white text-[11px] font-bold mb-1 px-1"><span>📷 QR 카메라 — 제품·원액·부자재 QR을 비추세요</span><button type="button" id="sr-cam-x" class="px-1.5 text-base leading-none">&times;</button></div>
            <div id="sr-cam" class="rounded-lg overflow-hidden bg-black"></div>
        </div>`;
    const body = host.querySelector('#sr-body');
    const camWrap = host.querySelector('#sr-cam-wrap');
    const camLabel = () => { const b = host.querySelector('.sr-cam span'); if (b) b.textContent = camera?.on ? '카메라 끄기' : 'QR 카메라'; };
    const stopCameraUi = async () => { if (camera) { await camera.stop(); camera = null; } camWrap.classList.add('hidden'); camLabel(); };
    const toggleCamera = async () => {
        if (camera?.on) { await stopCameraUi(); return; }
        camWrap.classList.remove('hidden');
        camera = createCamera('sr-cam', (text) => scanHandler?.(text), () => host.isConnected);
        try { await camera.start(); }
        catch (err) { camera = null; camWrap.classList.add('hidden'); alert(`카메라를 켜지 못했습니다: ${err.message || err}`); }
        camLabel();
    };
    host.querySelector('#sr-cam-x').addEventListener('click', stopCameraUi);

    const autoLot = (t) => `LOT-${today.replace(/-/g, '')}-${t === '원액' ? 'B' : t === '반제품' ? 'S' : 'A'}${String(Math.floor(Math.random() * 90) + 10)}`;
    const productPool = () => state.master.filter(m => PRODUCT_CATS.includes(m.category));
    const matPool = () => {
        const isBlend = prod?.prodType === '원액';
        // 원액 생산 = 원료 투입, 완제품 = 원액·부자재 (원료를 직접 넣는 경우도 있어 함께 찾음)
        return state.master.filter(m => m.code !== prod?.item.code && (isBlend ? m.category === '원료' || m.category === '부자재' : RAW_CATS.includes(m.category) || m.category === '부자재' || m.category === '기타'));
    };
    const stopCamera = stopCameraUi;

    const card = (inner) => `<div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4 text-xs">${inner}</div>`;
    const stepBar = () => `<div class="flex items-center gap-1.5 text-[11px] font-black">
        ${[['1', '생산 제품'], ['2', '원액·부자재 사용량'], ['3', '생산입고 반영']].map(([n, l], i) => `<span class="px-2.5 py-1 rounded-full ${step === i + 1 || (i === 2 && step === 3) ? 'bg-blue-600 text-white' : step > i + 1 ? 'bg-blue-100 text-blue-700' : 'bg-slate-100 text-slate-500'}">${n}. ${l}</span>`).join('<span class="text-slate-300">›</span>')}
    </div>`;
    const scanBox = (id, placeholder) => `
        <div class="flex flex-wrap gap-2">
            <div class="relative flex-1 min-w-[220px]">
                <i data-lucide="scan-line" class="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"></i>
                <input id="${id}" type="search" autocomplete="off" placeholder="${esc(placeholder)}" class="w-full pl-9 pr-3 py-2.5 border-2 border-blue-300 rounded-xl text-sm font-bold focus:ring-2 focus:ring-blue-500 focus:outline-none" />
            </div>
            <button type="button" class="sr-cam px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 text-white font-black flex items-center gap-1.5"><i data-lucide="camera" class="w-4 h-4"></i><span>${camera?.on ? '카메라 끄기' : 'QR 카메라'}</span></button>
        </div>
        <div id="sr-hits" class="divide-y divide-slate-100 border border-slate-200 rounded-xl max-h-[45vh] overflow-y-auto empty:hidden"></div>`;

    const hitHtml = (m) => `<button type="button" class="sr-hit w-full text-left px-3 py-2 hover:bg-blue-50 flex items-center gap-2" data-code="${esc(m.code)}">
        <span class="px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 font-bold text-[10px] shrink-0">${esc(m.category || '-')}</span>
        <span class="font-mono font-bold text-blue-700 shrink-0">${esc(m.code)}</span><b class="truncate">${esc(m.name)}</b><span class="text-slate-400 shrink-0">${esc(m.spec || '')}</span></button>`;

    // 스캔 칸: Enter = 스캔(또는 첫 검색 결과), 글자 입력 = 검색 목록
    const bindScan = (inputId, pool, onPick) => {
        const input = host.querySelector(`#${inputId}`);
        const hits = host.querySelector('#sr-hits');
        const draw = () => {
            const list = searchPool(pool(), input.value.trim());
            hits.innerHTML = list.map(hitHtml).join('') || (input.value.trim() ? '<div class="p-4 text-center text-slate-400 font-bold">찾는 품목이 없습니다.</div>' : '');
            hits.querySelectorAll('.sr-hit').forEach(b => b.addEventListener('click', () => onPick(state.master.find(m => m.code === b.dataset.code))));
        };
        const takeText = (text) => {
            const m = itemOfScan(text);
            if (m) { input.value = ''; hits.innerHTML = ''; onPick(m); return; }
            input.value = text; draw();
            if (!hits.querySelector('.sr-hit')) showToast(`'${text}'에 맞는 품목을 찾지 못했습니다. 품명 일부로 검색하세요.`, 'warning');
        };
        input.addEventListener('input', draw);
        input.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            e.preventDefault();
            const v = input.value.trim();
            if (!v) return;
            const m = itemOfScan(v);
            if (m) { input.value = ''; hits.innerHTML = ''; onPick(m); return; }
            const first = hits.querySelector('.sr-hit') || (draw(), hits.querySelector('.sr-hit'));
            if (first) first.click();
        });
        scanHandler = takeText;
        host.querySelector('.sr-cam')?.addEventListener('click', toggleCamera);
        // 스마트폰은 입력 칸에 자동으로 커서를 두면 자판이 올라와 화면을 가리므로 PC에서만
        if (window.matchMedia('(min-width: 1024px)').matches) setTimeout(() => input.focus(), 30);
    };

    // ---------- 제품을 고르면 기본값과 포장사용기준서 사용량을 채운다 ----------
    const pickProduct = (m) => {
        if (!m) return;
        if (!PRODUCT_CATS.includes(m.category)) { showToast(`[${m.code}] ${m.name}은(는) ${m.category || '분류 없음'} 품목입니다. 완제품·원액·반제품을 고르세요.`, 'warning'); return; }
        const prodType = prodTypeOf(m);
        const keep = prod && prod.item.code === m.code;
        prod = keep ? prod : { item: m, prodType, qty: prodType === '원액' ? 1000 : 1, lot: autoLot(prodType), location: prod?.location || api.defaultLocation, mfgDate: prod?.mfgDate || today };
        if (!keep) { mats = []; fromStandard = ''; workOrder = null; woUnlinked = []; }
        render();
        setTimeout(() => host.querySelector('#sr-qty')?.select(), 30);
    };

    // ---------- 원액생산 작업지시서 ----------
    const woRowHtml = (o) => `<button type="button" class="sr-wo w-full text-left p-2.5 hover:bg-amber-50 flex flex-wrap items-center gap-x-2 gap-y-0.5" data-id="${esc(o.id)}">
        <span class="font-mono font-black text-amber-800">${esc(o.orderNo)}</span><span class="text-slate-500">${esc(o.mfgDate || '')}</span>
        <b class="text-slate-900">${esc(o.productName || '')}</b><span class="text-slate-400">${esc(o.revision || '')}</span>
        <span class="w-full text-[11px] text-slate-600">생산량 ${esc(o.prodQty)} ${esc(o.prodUnit || 'D/M')} ≈ ${(wo.liters(o) || 0).toLocaleString()} L · 원료 ${(o.materials || []).length}종${o.lotNo ? ` · LOT ${esc(o.lotNo)}` : ''}</span></button>`;
    const woSection = () => (wo && (!prod || prod.prodType === '원액') ? `
        <div class="p-3 rounded-xl border border-amber-200 bg-amber-50/60 space-y-2">
            <div class="font-black text-amber-900 flex items-center gap-1.5"><i data-lucide="flask-round" class="w-4 h-4"></i>원액생산 작업지시서에서 불러오기 🔒</div>
            <input id="sr-wo-q" type="search" autocomplete="off" placeholder="지시번호·제품명·LOT 일부로 검색" class="w-full bg-white border border-amber-300 rounded-lg px-2.5 py-1.5 font-bold" />
            <div id="sr-wo-list" class="divide-y divide-amber-100 bg-white border border-amber-200 rounded-lg max-h-[40vh] overflow-y-auto"><div class="p-3 text-slate-500 font-bold">작업지시서를 불러오는 중...</div></div>
        </div>` : '');
    const drawWoList = async () => {
        const listEl = host.querySelector('#sr-wo-list');
        if (!listEl) return;
        try { await wo.load(); } catch (e) { listEl.innerHTML = `<div class="p-3 text-rose-600 font-bold">작업지시서를 불러오지 못했습니다: ${esc(e.message)}</div>`; return; }
        if (!host.contains(listEl)) return;
        const q = host.querySelector('#sr-wo-q')?.value.trim() || '';
        const code = prod?.prodType === '원액' ? prod.item.code : '';
        const open = wo.open().sort((a, b) => String(b.mfgDate || '').localeCompare(String(a.mfgDate || '')));
        const list = q ? open.filter(o => matchesQuery(o, q, ['orderNo', 'productName', 'lotNo', 'revision']))
            : code ? open.filter(o => wo.productCode(o) === code) : open;
        listEl.innerHTML = list.slice(0, 40).map(woRowHtml).join('')
            || `<div class="p-3 text-slate-500">${q ? '검색 결과가 없습니다.' : code ? `이 원액(${esc(code)})으로 발행된 미완료 작업지시서가 없습니다. 위 칸에서 다른 작업지시서를 검색할 수 있습니다.` : '미완료 작업지시서가 없습니다.'}</div>`;
        listEl.querySelectorAll('.sr-wo').forEach(b => b.addEventListener('click', () => applyWorkOrder(open.find(o => o.id === b.dataset.id))));
    };
    const applyWorkOrder = (o) => {
        if (!o) return;
        const plan = wo.plan(o);
        const code = plan.productCode || (prod?.prodType === '원액' ? prod.item.code : '');
        const m = state.master.find(x => x.code === code);
        if (!m) { alert(`작업지시서 ${o.orderNo}에 생산 원액 품목이 연결되어 있지 않습니다.\n먼저 위에서 원액을 고른 뒤 불러오세요 (제조시방서에서 원액 품목을 연결하면 바로 불러와집니다).`); return; }
        const location = prod?.location || api.defaultLocation;
        prod = { item: m, prodType: '원액', qty: plan.liters || prod?.qty || 0, lot: o.lotNo || o.orderNo, location, mfgDate: o.mfgDate || today };
        mats = plan.rows.map(r => ({ code: r.code, total: r3(r.total), loc: location, rawCode: r.rawCode }));
        workOrder = o;
        woUnlinked = plan.unlinked;
        fromStandard = '';
        matsTouched = true;
        step = 2;
        render();
        showToast(`📋 작업지시서 ${o.orderNo}의 원료 ${plan.rows.length}종을 불러왔습니다. 사용량을 확인하고 처리하세요.`);
    };

    const loadStandard = () => {
        const b = getBoms()[prod.item.code];
        const qty = Number(prod.qty) || 0;
        mats = [];
        fromStandard = '';
        if (!b || (!(b.rawList || []).length && !(b.subList || []).length)) return;
        [...(b.rawList || []), ...(b.subList || [])].forEach(x => {
            if (!state.master.some(m => m.code === x.code)) return;
            mats.push({ code: x.code, total: r3((Number(x.rate) || 0) * qty), loc: prod.location, slot: x.slot });
        });
        fromStandard = b.meta?.template ? 'TEMPLATE' : 'CHECKED';
        matsTouched = false;
        stdQty = qty;
    };

    const addMat = (m) => {
        if (!m) return;
        if (m.code === prod.item.code) { showToast('생산 제품 자신은 투입할 수 없습니다.', 'warning'); return; }
        if (PRODUCT_CATS.includes(m.category) && m.category !== '원액') { showToast(`[${m.code}] ${m.name}은(는) ${m.category} 품목이라 투입할 수 없습니다.`, 'warning'); return; }
        if (prod.prodType === '원액' && m.category === '원액') { showToast('원액 생산에는 원료를 투입하세요.', 'warning'); return; }
        const ex = mats.find(x => x.code === m.code);
        matsTouched = true;
        if (!ex) mats.push({ code: m.code, total: '', loc: prod.location });
        render();
        const row = host.querySelector(`.sr-mat[data-code="${CSS.escape(m.code)}"] .sr-total`);
        row?.focus();
        row?.select();
        showToast(ex ? `[${m.code}] ${m.name} — 이미 있는 줄입니다. 사용량을 확인하세요.` : `➕ [${m.code}] ${m.name} 추가 — 사용량을 넣으세요.`);
    };

    const readStep1 = () => {
        const $ = (s) => host.querySelector(s);
        if (!$('#sr-qty')) return;
        prod.qty = Number($('#sr-qty').value) || 0;
        prod.lot = $('#sr-lot').value.trim();
        prod.location = $('#sr-loc').value;
        prod.mfgDate = $('#sr-date').value || today;
    };
    const readStep2 = () => {
        host.querySelectorAll('.sr-mat').forEach(row => {
            const x = mats.find(y => y.code === row.dataset.code);
            if (!x) return;
            x.total = row.querySelector('.sr-total').value;
            x.loc = row.querySelector('.sr-mloc').value;
        });
        const chk = host.querySelector('#sr-save-std');
        if (chk) saveStd = chk.checked;
    };

    // ---------- 그리기 ----------
    const render = () => {
        const u = prod ? unitOfType(prod.prodType) : 'EA';
        if (step === 0) {
            body.innerHTML = card(`
                <div class="flex items-center gap-2 border-b border-slate-100 pb-3"><i data-lucide="scan-search" class="w-5 h-5 text-blue-600"></i><h3 class="font-extrabold text-sm text-slate-900">검색 등록 — QR·검색으로 생산입고</h3></div>
                <ol class="list-decimal pl-5 space-y-1 text-slate-600">
                    <li>생산한 <b>제품</b>을 제품 QR로 찍거나 코드·품명으로 찾아 고르고 수량을 넣습니다.</li>
                    <li><b>원액·부자재</b>를 QR로 찍거나 검색해 고르고 사용량을 넣습니다 (포장사용기준서가 있으면 미리 채워집니다).</li>
                    <li><b>생산입고 반영</b>을 누르면 직접 등록과 똑같이 재고 입고·원부자재 자동 차감·수불부·업무일지·초중종물·수율표·IBC가 처리되고, 완제품은 입력한 사용량이 <b>포장사용기준서</b>에 1단위 기준으로 저장됩니다.</li>
                </ol>
                <button type="button" id="sr-start" class="w-full sm:w-auto sm:px-12 py-3.5 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-xl text-sm shadow-md flex items-center justify-center gap-2"><i data-lucide="package-plus" class="w-5 h-5"></i>입고 등록</button>`);
            host.querySelector('#sr-start').addEventListener('click', () => { step = 1; prod = null; mats = []; workOrder = null; woUnlinked = []; render(); });
        } else if (step === 1) {
            body.innerHTML = card(`
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">${stepBar()}<button type="button" id="sr-cancel" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">취소</button></div>
                <div class="font-black text-slate-800">생산 제품 — 제품 QR·바코드를 찍거나 코드·품명 일부를 입력하세요</div>
                ${scanBox('sr-prod-scan', '제품 QR 스캔 또는 코드·품명 검색 (예: 5W30 1L)')}
                ${woSection()}
                ${prod ? `
                <div class="p-3 rounded-xl border-2 border-blue-200 bg-blue-50/60 space-y-3">
                    <div class="flex flex-wrap items-center gap-2"><span class="px-2 py-0.5 rounded-full bg-blue-600 text-white font-black text-[11px]">${esc(prod.prodType)}</span><span class="font-mono font-bold text-blue-700">${esc(prod.item.code)}</span><b class="text-sm">${esc(prod.item.name)}</b><span class="text-slate-500">${esc(prod.item.spec || '')}</span></div>
                    <div class="grid grid-cols-2 lg:grid-cols-4 gap-2">
                        <label class="block"><span class="font-bold text-slate-700">생산 수량 (${u}) *</span><input id="sr-qty" type="number" min="0" step="any" inputmode="decimal" value="${esc(prod.qty)}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 text-sm font-black text-blue-700 text-right" /></label>
                        <label class="block"><span class="font-bold text-slate-700">생산 LOT *</span><input id="sr-lot" value="${esc(prod.lot)}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 font-mono font-bold" /></label>
                        <label class="block"><span class="font-bold text-slate-700">입고 창고</span><select id="sr-loc" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 font-bold bg-white">${locationOptionsHtml(state.locations, prod.location)}</select></label>
                        <label class="block"><span class="font-bold text-slate-700">제조일자</span><input id="sr-date" type="date" value="${esc(prod.mfgDate)}" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-2 font-bold" /></label>
                    </div>
                    <div class="flex justify-end"><button type="button" id="sr-next" class="px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black flex items-center gap-1.5">원액·부자재 입력 <i data-lucide="arrow-right" class="w-4 h-4"></i></button></div>
                </div>` : ''}`);
            host.querySelector('#sr-cancel').addEventListener('click', async () => { await stopCamera(); step = 0; prod = null; mats = []; workOrder = null; woUnlinked = []; render(); });
            bindScan('sr-prod-scan', productPool, pickProduct);
            if (host.querySelector('#sr-wo-list')) {
                host.querySelector('#sr-wo-q').addEventListener('input', drawWoList);
                drawWoList();
            }
            host.querySelector('#sr-next')?.addEventListener('click', async () => {
                readStep1();
                if (!(prod.qty > 0)) { alert('생산 수량을 넣으세요.'); return; }
                if (!prod.lot) { alert('생산 LOT를 넣으세요.'); return; }
                if (!mats.length || (fromStandard && !matsTouched && stdQty !== prod.qty)) loadStandard();
                step = 2;
                render();
            });
            host.querySelector('#sr-qty')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); host.querySelector('#sr-next')?.click(); } });
        } else if (step === 2) {
            const qty = Number(prod.qty) || 0;
            const isFinished = prod.prodType === '완제품';
            const rows = mats.map(x => {
                const m = state.master.find(y => y.code === x.code) || { code: x.code, name: x.code };
                const isRaw = RAW_CATS.includes(m.category);
                const mu = matUnit(m);
                const per = qty > 0 && x.total !== '' ? r4(Number(x.total) / qty) : '';
                return `<div class="sr-mat flex flex-wrap items-center gap-2 p-2.5 rounded-xl border ${isRaw ? 'border-blue-200 bg-blue-50/40' : 'border-emerald-200 bg-emerald-50/40'}" data-code="${esc(x.code)}">
                    <span class="px-1.5 py-0.5 rounded text-[10px] font-black ${isRaw ? 'bg-blue-600 text-white' : 'bg-emerald-600 text-white'}">${esc(isRaw ? m.category : '부자재')}</span>
                    ${x.rawCode ? `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 font-mono font-black text-[11px]" title="작업지시서 원료코드 (기록에는 원료명 대신 이 코드)">${esc(x.rawCode)}</span>` : ''}
                    <div class="flex-1 min-w-[160px]"><span class="font-mono font-bold text-slate-500">${esc(m.code)}</span> <b>${esc(m.name)}</b></div>
                    <label class="flex items-center gap-1 bg-white border border-slate-300 rounded-lg px-2 py-1"><span class="text-[10px] font-bold text-slate-500">사용량</span><input type="number" min="0" step="any" inputmode="decimal" value="${esc(x.total)}" class="sr-total w-24 text-right font-black text-sm focus:outline-none" /><span class="font-bold text-slate-500">${esc(mu)}</span></label>
                    <span class="sr-per text-[11px] font-bold text-slate-500 w-32">1${esc(unitOfType(prod.prodType))}당 ${per === '' ? '-' : per.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${esc(mu)}</span>
                    <select class="sr-mloc border border-slate-300 rounded-lg px-1.5 py-1 font-bold bg-white text-[11px] w-36">${locationOptionsHtml(state.locations, x.loc)}</select>
                    <button type="button" class="sr-del px-2.5 py-1.5 rounded-lg border border-rose-200 bg-rose-50 text-rose-600 font-black">삭제</button>
                </div>`;
            }).join('');
            body.innerHTML = card(`
                <div class="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-3">${stepBar()}<button type="button" id="sr-cancel" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">취소</button></div>
                <div class="p-3 rounded-xl bg-slate-900 text-white flex flex-wrap items-center gap-2">
                    <span class="px-2 py-0.5 rounded-full bg-blue-500 font-black text-[11px]">${esc(prod.prodType)}</span><span class="font-mono">${esc(prod.item.code)}</span><b class="text-sm">${esc(prod.item.name)}</b>
                    <span class="text-slate-300">${esc(prod.item.spec || '')}</span>
                    <span class="ml-auto font-black text-amber-300">${qty.toLocaleString()} ${esc(unitOfType(prod.prodType))}</span><span class="text-slate-300">LOT ${esc(prod.lot)} · ${esc(prod.location)} · ${esc(prod.mfgDate)}</span>
                    <button type="button" id="sr-back" class="px-2.5 py-1 rounded-lg bg-white/15 hover:bg-white/25 font-bold">← 제품 다시 선택</button>
                </div>
                ${workOrder ? `<div class="p-3 rounded-xl bg-amber-50 border border-amber-300 space-y-1">
                    <div class="flex flex-wrap items-center justify-between gap-2"><b class="text-amber-900">📋 작업지시서 <span class="font-mono">${esc(workOrder.orderNo)}</span> 연결됨 · ${esc(workOrder.productName || '')} ${esc(workOrder.revision || '')} · ${esc(workOrder.prodQty)} ${esc(workOrder.prodUnit || 'D/M')}</b>
                        <button type="button" id="sr-wo-unlink" class="px-2.5 py-1 rounded-lg bg-white border border-amber-300 font-bold">연결 해제</button></div>
                    <div class="text-[11px] text-amber-800">생산입고를 반영하면 이 작업지시서가 '생산 완료'로 바뀝니다. 입출고 이력·원료수불부에는 원료명 대신 원료코드가 남습니다.</div>
                    ${woUnlinked.length ? `<div class="text-[11px] font-bold text-rose-600">⚠ 재고 품목이 연결되지 않은 원료 ${woUnlinked.length}종은 차감되지 않습니다: ${esc(woUnlinked.join(', '))} (제조시방서에서 재고 연결)</div>` : ''}
                </div>` : ''}
                ${fromStandard ? `<div class="p-2.5 rounded-xl text-[11px] font-bold ${fromStandard === 'TEMPLATE' ? 'bg-amber-50 border border-amber-200 text-amber-800' : 'bg-emerald-50 border border-emerald-200 text-emerald-800'}">📋 포장사용기준서${fromStandard === 'TEMPLATE' ? '(기본 양식·미확인)' : ''}의 사용량을 생산 수량에 맞춰 채웠습니다. 실제 사용량으로 고치세요.</div>` : ''}
                <div class="font-black text-slate-800">원액·부자재 — QR을 찍거나 코드·품명으로 찾아 추가하고 사용량을 넣으세요</div>
                ${scanBox('sr-mat-scan', prod.prodType === '원액' ? '원료 QR 스캔 또는 코드·품명 검색' : '원액·부자재 QR 스캔 또는 코드·품명 검색 (예: 캡, 라벨, 아웃박스)')}
                <div id="sr-mats" class="space-y-1.5">${rows || '<div class="p-6 text-center text-slate-400 font-bold border border-dashed border-slate-300 rounded-xl">아직 넣은 원액·부자재가 없습니다.</div>'}</div>
                ${isFinished ? `<label class="flex items-start gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200 cursor-pointer"><input type="checkbox" id="sr-save-std" ${saveStd ? 'checked' : ''} class="mt-0.5 w-4 h-4 accent-amber-600" /><span><b class="text-amber-900">이 사용량을 포장사용기준서에 저장</b> <span class="text-slate-600">— 사용량 ÷ 생산 수량 = 제품 1${esc(unitOfType(prod.prodType))}당 기준으로 저장해 다음 생산입고와 생산계획 부족 계산에 쓰입니다 (확인됨으로 표시).</span></span></label>`
                    : `<p class="text-[11px] text-slate-500">${prod.prodType === '원액' ? '원액의 원료 배합은 보안 자료라 포장사용기준서에 저장하지 않습니다.' : '포장사용기준서는 완제품만 저장합니다.'}</p>`}
                <div class="flex flex-wrap justify-end gap-2 pt-1">
                    <button type="button" id="sr-submit" class="w-full sm:w-auto sm:px-10 py-3 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-700 hover:to-indigo-700 text-white font-extrabold rounded-xl text-sm shadow-md flex items-center justify-center gap-2"><i data-lucide="check-circle" class="w-5 h-5"></i><span id="sr-submit-text">생산입고 반영</span></button>
                </div>`);
            host.querySelector('#sr-cancel').addEventListener('click', async () => { if (mats.length && !confirm('입력한 내용을 버리고 처음으로 돌아갈까요?')) return; await stopCamera(); step = 0; prod = null; mats = []; workOrder = null; woUnlinked = []; render(); });
            host.querySelector('#sr-back').addEventListener('click', async () => { readStep2(); step = 1; render(); });
            bindScan('sr-mat-scan', matPool, (m) => { readStep2(); addMat(m); });
            host.querySelector('#sr-wo-unlink')?.addEventListener('click', () => {
                readStep2();
                const no = workOrder.orderNo;
                workOrder = null;
                woUnlinked = [];
                render();
                showToast(`작업지시서 ${no} 연결을 해제했습니다 (원료 줄은 그대로 둡니다).`);
            });
            const matsEl = host.querySelector('#sr-mats');
            matsEl.addEventListener('input', (e) => {
                const row = e.target.closest('.sr-mat');
                if (!row || !e.target.classList.contains('sr-total')) return;
                matsTouched = true;
                const m = state.master.find(y => y.code === row.dataset.code) || {};
                const v = e.target.value;
                row.querySelector('.sr-per').textContent = `1${unitOfType(prod.prodType)}당 ${qty > 0 && v !== '' ? r4(Number(v) / qty).toLocaleString(undefined, { maximumFractionDigits: 4 }) : '-'} ${matUnit(m)}`;
            });
            matsEl.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.classList.contains('sr-total')) { e.preventDefault(); host.querySelector('#sr-mat-scan')?.focus(); } });
            matsEl.addEventListener('click', (e) => {
                const del = e.target.closest('.sr-del');
                if (!del) return;
                readStep2();
                matsTouched = true;
                mats = mats.filter(x => x.code !== del.closest('.sr-mat').dataset.code);
                render();
            });
            host.querySelector('#sr-submit').addEventListener('click', submit);
        }
        createIcons({ icons });
    };

    // ---------- 생산입고 반영: 직접 등록 폼으로 옮겨 기존 처리를 그대로 탄다 ----------
    const submit = async () => {
        readStep2();
        const qty = Number(prod.qty) || 0;
        const rows = mats.map(x => ({ ...x, total: Number(x.total) || 0, item: state.master.find(m => m.code === x.code) })).filter(x => x.item);
        const empty = mats.filter(x => !(Number(x.total) > 0));
        if (!rows.some(x => x.total > 0) && !confirm('사용량을 넣은 원액·부자재가 없습니다. 차감 없이 제품만 입고할까요?')) return;
        if (empty.length && rows.some(x => x.total > 0) && !confirm(`사용량이 0이거나 비어 있는 ${empty.length}줄은 빼고 처리합니다. 진행할까요?`)) return;
        const used = rows.filter(x => x.total > 0);
        const raws = used.filter(x => RAW_CATS.includes(x.item.category));
        const subs = used.filter(x => !RAW_CATS.includes(x.item.category));
        const unit = unitOfType(prod.prodType);
        if (workOrder && !wo.isOpen(workOrder)) { alert(`작업지시서 ${workOrder.orderNo}는 이미 생산 완료되었거나 취소되었습니다. [연결 해제] 후 처리하세요.`); return; }
        // 작업지시서가 연결되어 있으면 직접 등록 폼 쪽에서 지시서 확인 창을 한 번 더 띄운다
        if (!workOrder && !confirm(`[${prod.item.code}] ${prod.item.name} ${qty.toLocaleString()} ${unit} 생산입고\n원액·원료 ${raws.length}종 · 부자재 ${subs.length}종을 차감합니다.${prod.prodType === '완제품' && saveStd && used.length ? '\n사용량은 포장사용기준서에 1단위 기준으로 저장합니다.' : ''}\n진행할까요?`)) return;
        await stopCamera();
        const perUnit = (x) => (qty > 0 ? x.total / qty : 0);
        api.fillForm({
            item: prod.item, prodType: prod.prodType, qty, lot: prod.lot, location: prod.location, mfgDate: prod.mfgDate,
            raws: raws.map(x => ({ code: x.code, rate: perUnit(x), total: x.total, loc: x.loc, rawCode: x.rawCode || '' })),
            subs: subs.map(x => ({ code: x.code, rate: perUnit(x), total: x.total, loc: x.loc })),
            workOrder,
            unlinked: woUnlinked
        });
        const btn = host.querySelector('#sr-submit');
        if (btn) { btn.disabled = true; host.querySelector('#sr-submit-text').textContent = '생산입고 처리 중...'; }
        const std = prod.prodType === '완제품' && saveStd && used.length && qty > 0 ? {
            code: prod.item.code,
            rawList: raws.map(x => ({ code: x.code, rate: r4(perUnit(x)), loc: x.loc, slot: 'raw' })),
            subList: subs.map(x => ({ code: x.code, rate: r4(perUnit(x)), loc: x.loc, slot: x.slot || getBoms()[prod.item.code]?.subList?.find(s => s.code === x.code)?.slot || guessPackSlot(x.item.name) }))
        } : null;
        const ok = await api.submitForm(async () => {
            if (!std) return;
            try {
                await saveBom(std.code, std.rawList, std.subList);
                showToast(`📦 [${std.code}] 포장사용기준서에 원액 ${std.rawList.length}종·부자재 ${std.subList.length}종 사용량(1단위 기준)을 저장했습니다.`);
            } catch (e) {
                alert(`생산입고는 처리되었지만 포장사용기준서에 저장하지 못했습니다: ${e.message}`);
            }
        });
        // 실패하면(확인 창 취소 포함) 입력 내용을 그대로 두고 다시 시도할 수 있게
        if (!ok && host.isConnected) render();
    };

    render();
    return { stop: stopCamera };
};
