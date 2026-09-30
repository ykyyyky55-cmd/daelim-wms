// ==========================================
// 업무일지(ProductionLog.js) 줄 입력 창 · 지난 일지 참조
// ==========================================
// - 항목(목록)마다 칸 구성 LIST_DEFS: 다른 날짜 일지에 실제로 들어 있는 칸 그대로 (포장·원액·라벨·이동·입고·출고·구매발주·택배·특이사항·기타업무)
// - 칸마다 제안 목록 = 지난 일지(이 거점 먼저, 다른 거점 다음)에 쓴 값, 자주·최근 쓴 순. 품명은 품목마스터(코드 / 품명)도 함께.
// - 지난 일지에 있던 품명(업무명)을 고르면 그때의 규격·라인·카테고리·경로 등을 채운다(수량·LOT 제외).
// - 시간 × 인원 = 총시간, 공수 = 총시간 ÷ 7.5 (지난 일지와 같은 계산)
import { state, WORKLOG_SITES } from '../../services/db.js';
import { esc } from '../../services/html.js';

const MAN_DAY = 7.5;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// 공수 칸 (포장·원액·라벨·기타업무 공통)
const WORK_FIELDS = [
    { k: 'workHours', label: '작업시간(h)', type: 'number' },
    { k: 'workersCount', label: '인원', type: 'number' },
    { k: 'totalWorkHours', label: '총시간(h)', type: 'number', auto: true },
    { k: 'manHours', label: '공수', type: 'number', auto: true }
];

/**
 * @typedef {{ k: string, label: string, type?: 'text'|'number'|'textarea', auto?: boolean, required?: boolean, wide?: boolean, options?: string[] }} WlField
 * @typedef {{ title: string, fields: WlField[], stock?: boolean, lot?: boolean, scalar?: boolean, keepOnCopy?: string[] }} WlListDef
 */
/** @type {Record<string, WlListDef>} */
export const LIST_DEFS = {
    packaging: {
        title: '제품포장작업', stock: true, lot: true,
        fields: [{ k: 'item', label: '품명 (코드 / 품목명)', required: true, wide: true }, { k: 'spec', label: '규격' }, { k: 'qty', label: '수량(EA)', type: 'number', required: true }, { k: 'box', label: '박스', type: 'number' },
            ...WORK_FIELDS, { k: 'line', label: 'LINE' }, { k: 'lotNo', label: 'LOT 번호' }, { k: 'category', label: '카테고리' }, { k: 'workers', label: '작업자', wide: true }]
    },
    oilBlending: {
        title: '원액생산작업', stock: true, lot: true,
        fields: [{ k: 'item', label: '품명 (코드 / 원액명)', required: true, wide: true }, { k: 'spec', label: '단위' }, { k: 'qty', label: '생산수량(L)', type: 'number', required: true }, { k: 'packageType', label: '포장용기', options: ['TOTE', 'DRUM', 'PL', 'IBC'] },
            ...WORK_FIELDS, { k: 'line', label: 'LINE (BT)' }, { k: 'lotNo', label: 'LOT 번호' }, { k: 'category', label: '카테고리' }, { k: 'workers', label: '작업자', wide: true }]
    },
    labeling: {
        title: '라벨부착작업',
        fields: [{ k: 'item', label: '품명 (라벨·용기)', required: true, wide: true }, { k: 'spec', label: '규격' }, { k: 'qty', label: '수량(EA)', type: 'number', required: true }, { k: 'box', label: '박스', type: 'number' },
            ...WORK_FIELDS, { k: 'line', label: 'LINE' }, { k: 'lotNo', label: 'LOT 번호' }, { k: 'category', label: '카테고리' }, { k: 'workers', label: '작업자', wide: true }]
    },
    movement: {
        title: '이동제품', stock: true,
        fields: [{ k: 'item', label: '품명', required: true, wide: true }, { k: 'spec', label: '용량/규격' }, { k: 'unit', label: '단위', options: ['EA', 'BOX', 'TOTE', 'DM', 'PL', 'L', 'KG'] }, { k: 'qty', label: '수량', type: 'number', required: true },
            { k: 'box', label: '박스/용기' }, { k: 'vehicle', label: '차량' }, { k: 'driver', label: '운반자' }, { k: 'route', label: '이동 경로 (출발 -> 도착)' },
            { k: 'ledgerSkip', label: '수불부 건너뜀 사유 (이미 다른 곳에 기록된 이동이면)', wide: true }]
    },
    receiving: {
        title: '입고내역', stock: true,
        fields: [{ k: 'item', label: '품명', required: true, wide: true }, { k: 'spec', label: '규격' }, { k: 'qty', label: '수량', type: 'number', required: true }, { k: 'box', label: '단위/포장 (D/M 등)' },
            { k: 'partner', label: '거래처' }, { k: 'inspector', label: '확인자' }, { k: 'notes', label: '비고', wide: true }]
    },
    shipping: {
        title: '출고내역', stock: true,
        fields: [{ k: 'item', label: '품명', required: true, wide: true }, { k: 'spec', label: '규격' }, { k: 'qty', label: '수량', type: 'number', required: true }, { k: 'box', label: '박스/단위' },
            { k: 'partner', label: '거래처' }, { k: 'transport', label: '운송 (용차·택배 등)' }, { k: 'inspector', label: '확인자' }, { k: 'notes', label: '비고 (운송비 등)', wide: true }]
    },
    purchaseOrders: {
        title: '구매발주내역',
        fields: [{ k: 'item', label: '품명', required: true, wide: true }, { k: 'spec', label: '용량/규격' }, { k: 'qty', label: '수량', type: 'number', required: true }, { k: 'partner', label: '거래처' },
            { k: 'lotNo', label: 'LOT/NO' }, { k: 'site', label: '입고처 (LINE/구분)' }, { k: 'notes', label: '비고', wide: true }]
    },
    courier: {
        title: '택배출고현황',
        fields: [{ k: 'type', label: '구분 (택배·납품·용차 등)', required: true }, { k: 'count', label: '건수', type: 'number', required: true }, { k: 'notes', label: '비고', wide: true }]
    },
    otherNotes: {
        title: '특이사항 / 메모', scalar: true,
        fields: [{ k: 'text', label: '내용', type: 'textarea', required: true, wide: true }]
    },
    otherTasks: {
        title: '기타업무·공수',
        fields: [{ k: 'task', label: '업무명', required: true, wide: true }, ...WORK_FIELDS, { k: 'worker', label: '담당자', wide: true }]
    }
};

// 복사(지난 일지 참조) 때 빼는 표시값: 재고 반영·수율표 연동·원래 값은 그 날짜 일지에만 해당한다
const COPY_DROP = ['stockDone', 'source', 'yieldSynced', 'qtyOriginal', 'unitOriginal', 'ledgerSkip'];

// 지난 일지들: 이 거점 먼저(최근 순), 다음 다른 거점
const pastLogs = (site, exceptDate) => {
    const of = (s) => (state[WORKLOG_SITES[s].stateKey] || []).filter(l => l.date && l.date !== exceptDate).sort((a, b) => b.date.localeCompare(a.date));
    return [...of(site), ...Object.keys(WORKLOG_SITES).filter(s => s !== site).flatMap(of)];
};
const rowsOf = (log, listKey) => (log[listKey] || []).map(r => (LIST_DEFS[listKey].scalar ? { text: String(r ?? '') } : r));

/** 칸 제안 목록: 지난 일지 값(자주·최근 순, 최대 200) */
const suggestionsFor = (logs, listKey, field) => {
    const score = new Map();
    logs.forEach((log, li) => rowsOf(log, listKey).forEach(r => {
        const v = String(r?.[field] ?? '').trim();
        if (!v || v === '0') return;
        const s = score.get(v) || { n: 0, last: li };
        s.n += 1; s.last = Math.min(s.last, li);
        score.set(v, s);
    }));
    return [...score.entries()].sort((a, b) => b[1].n - a[1].n || a[1].last - b[1].last).slice(0, 200).map(([v]) => v);
};
const PEOPLE_FIELDS = ['workers', 'worker', 'driver', 'inspector'];

/** 품명(업무명)으로 가장 최근 줄 찾기 */
const lastRowOf = (logs, listKey, keyField, value) => {
    const v = String(value || '').trim();
    if (!v) return null;
    for (const log of logs) {
        const r = rowsOf(log, listKey).slice().reverse().find(x => String(x?.[keyField] || '').trim() === v);
        if (r) return r;
    }
    return null;
};

const inputCls = 'mt-1 w-full border border-slate-300 rounded-lg px-2.5 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500';

/**
 * 줄 입력·수정 창
 * @param {{ site: string, date: string, listKey: string, row?: Object|null, defaults?: Object, warnSynced?: boolean }} opts
 * @returns {Promise<{ row: Object, again: boolean } | null>} 취소하면 null
 */
export const openRowEditor = ({ site, date, listKey, row = null, defaults = {}, warnSynced = false }) => new Promise((resolve) => {
    const def = LIST_DEFS[listKey];
    const logs = pastLogs(site, date);
    const keyField = def.fields[0].k;
    const start = { ...defaults, ...(row ? (def.scalar ? { text: String(row) } : row) : {}) };
    const dl = (k) => `wl-dl-${listKey}-${k}`;
    const people = [...new Set((state.workers || []).map(w => w.name).filter(Boolean))];
    const listOptions = (f) => {
        const past = suggestionsFor(logs, listKey, f.k);
        let extra = f.options || [];
        if (PEOPLE_FIELDS.includes(f.k)) extra = [...extra, ...people];
        if (f.k === 'item') extra = [...extra, ...(state.master || []).map(m => `${m.code} / ${m.name}`)];
        return [...new Set([...past, ...extra])];
    };

    const box = document.createElement('div');
    box.className = 'fixed inset-0 z-[70] bg-slate-900/60 p-2 sm:p-4 flex items-start justify-center overflow-y-auto';
    box.innerHTML = `<form class="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4 text-xs overflow-hidden" novalidate>
        <div class="px-4 py-3 bg-slate-800 text-white flex items-center justify-between">
            <h3 class="font-black text-sm">${esc(def.title)} ${row ? '수정' : '추가'} <span class="font-normal text-slate-300">· ${esc(date)}</span></h3>
            <button type="button" class="re-x text-xl px-2" aria-label="닫기">&times;</button>
        </div>
        <div class="p-4 space-y-3">
            ${warnSynced ? '<p class="p-2.5 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 font-bold">이 일지는 이미 수불부에 반영되었습니다. 여기서 고친 수량은 재고·수불부에 자동으로 반영되지 않으니, 필요하면 입출고 화면에서 따로 맞춰 주세요.</p>' : ''}
            <p class="text-[11px] text-slate-500">칸을 누르면 지난 일지에 쓴 값이 제안됩니다. ${def.scalar ? '' : `지난 일지에 있던 ${esc(def.fields[0].label.split(' ')[0])}을 고르면 나머지 칸을 그때 값으로 채웁니다.`}</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                ${def.fields.map(f => `<label class="block ${f.wide || f.type === 'textarea' ? 'sm:col-span-2' : ''}">
                    <span class="font-bold text-slate-700">${esc(f.label)}${f.required ? ' <span class="text-rose-500">*</span>' : ''}${f.auto ? ' <span class="font-normal text-slate-400">(자동 계산, 고칠 수 있음)</span>' : ''}</span>
                    ${f.type === 'textarea'
                        ? `<textarea name="${f.k}" rows="3" class="${inputCls}">${esc(start[f.k] ?? '')}</textarea>`
                        : `<input name="${f.k}" ${f.type === 'number' ? 'type="number" step="any" inputmode="decimal"' : 'type="text" autocomplete="off"'} list="${dl(f.k)}" value="${esc(start[f.k] ?? '')}" class="${inputCls}" />`}
                </label>`).join('')}
            </div>
            <p class="re-msg text-rose-600 font-bold hidden"></p>
        </div>
        <div class="px-4 py-3 bg-slate-50 border-t border-slate-200 flex flex-wrap justify-end gap-2">
            <button type="button" class="re-x px-3 py-2 rounded-xl bg-white border border-slate-300 font-bold">취소</button>
            ${row ? '' : '<button type="button" class="re-again px-3 py-2 rounded-xl bg-slate-700 hover:bg-slate-800 text-white font-bold">저장 후 계속 추가</button>'}
            <button type="submit" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black">저장</button>
        </div>
        ${def.fields.filter(f => f.type !== 'textarea').map(f => `<datalist id="${dl(f.k)}">${listOptions(f).map(v => `<option value="${esc(v)}"></option>`).join('')}</datalist>`).join('')}
    </form>`;
    document.body.appendChild(box);
    const form = box.querySelector('form');
    const el = (k) => form.elements.namedItem(k);
    const touched = new Set(row && !def.scalar ? Object.keys(row).filter(k => row[k] !== '' && row[k] != null) : []); // 기본값(LOT 등)은 지난 줄 값으로 바꿀 수 있게 뺀다

    // 시간 × 인원 → 총시간 → 공수 (직접 고친 칸은 그대로 둠)
    const hasWork = def.fields.some(f => f.k === 'manHours');
    const recalc = (from) => {
        if (!hasWork) return;
        if (from !== 'totalWorkHours' && !(from === 'manHours')) {
            const h = Number(el('workHours').value), n = Number(el('workersCount').value);
            if (el('workHours').value !== '' && el('workersCount').value !== '') el('totalWorkHours').value = round2(h * n);
        }
        if (from !== 'manHours' && el('totalWorkHours').value !== '') el('manHours').value = round2(Number(el('totalWorkHours').value) / MAN_DAY);
    };
    // 박스: 지난 줄의 박스당 수량으로 (박스를 직접 고치지 않았을 때)
    let perBox = 0;
    const refBox = () => {
        if (!el('box') || !perBox || touched.has('box') || el('qty').value === '') return;
        el('box').value = Math.ceil(Number(el('qty').value) / perBox);
    };
    // 품명(업무명)을 고르면 그때 줄의 나머지 칸을 채운다 (수량·LOT·박스 제외, 이미 적은 칸은 그대로)
    const fillFrom = () => {
        const ref = lastRowOf(logs, listKey, keyField, el(keyField).value);
        const q0 = Number(ref?.qty) || 0, b0 = Number(ref?.box) || 0;
        perBox = q0 > 0 && b0 > 0 ? q0 / b0 : 0;
        if (!ref) {
            const code = String(el(keyField).value).split(' / ')[0].trim();
            const m = (state.master || []).find(x => x.code === code);
            if (m && el('spec') && !el('spec').value) el('spec').value = m.spec || '';
            if (m && el('category') && !el('category').value) el('category').value = m.subCategory || m.category || '';
            return;
        }
        def.fields.forEach(f => {
            if (f.k === keyField || ['qty', 'lotNo', 'box', 'count'].includes(f.k) || touched.has(f.k)) return;
            const v = ref[f.k];
            if (v != null && v !== '') el(f.k).value = v;
        });
        recalc();
        refBox();
    };
    form.addEventListener('input', (e) => {
        const k = e.target.name;
        if (!k) return;
        touched.add(k);
        if (['workHours', 'workersCount', 'totalWorkHours', 'manHours'].includes(k)) recalc(k);
        if (k === 'qty') refBox();
    });
    el(keyField).addEventListener('change', fillFrom);

    const close = (result) => { box.remove(); resolve(result); };
    const collect = () => {
        const msg = box.querySelector('.re-msg');
        const missing = def.fields.filter(f => f.required && String(el(f.k).value).trim() === '');
        if (missing.length) { msg.textContent = `${missing.map(f => f.label.split(' (')[0]).join(', ')}을(를) 입력하세요.`; msg.classList.remove('hidden'); return null; }
        const base = row && !def.scalar ? { ...row } : {};
        def.fields.forEach(f => {
            const v = String(el(f.k).value).trim();
            if (f.type === 'number') base[f.k] = v === '' ? 0 : Number(v);
            else if (v === '' && f.k === 'ledgerSkip') delete base[f.k];
            else base[f.k] = v;
        });
        return def.scalar ? base.text : base;
    };
    box.querySelectorAll('.re-x').forEach(b => b.addEventListener('click', () => close(null)));
    box.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(null); });
    form.addEventListener('submit', (e) => { e.preventDefault(); const r = collect(); if (r != null) close({ row: r, again: false }); });
    box.querySelector('.re-again')?.addEventListener('click', () => { const r = collect(); if (r != null) close({ row: r, again: true }); });
    if (row) { perBox = (Number(row.qty) > 0 && Number(row.box) > 0) ? Number(row.qty) / Number(row.box) : 0; }
    setTimeout(() => el(keyField).focus(), 50);
});

/**
 * 지난 일지 참조: 다른 날짜 일지에서 이 항목의 줄을 골라 복사
 * @returns {Promise<Array|null>} 복사할 줄 (취소하면 null)
 */
export const openCopyFromPast = ({ site, date, listKey }) => new Promise((resolve) => {
    const def = LIST_DEFS[listKey];
    const siteName = (s) => WORKLOG_SITES[s]?.name || s;
    // 이 거점의 이전 날짜 먼저 (가까운 순), 없으면 다른 거점
    const cands = [site, ...Object.keys(WORKLOG_SITES).filter(s => s !== site)].flatMap(s => (state[WORKLOG_SITES[s].stateKey] || [])
        .filter(l => l.date && l.date !== date && (l[listKey] || []).length)
        .sort((a, b) => (b.date < date) - (a.date < date) || Math.abs(new Date(a.date) - new Date(date)) - Math.abs(new Date(b.date) - new Date(date)))
        .map(l => ({ s, log: l })));
    if (!cands.length) { alert(`다른 날짜 일지에 ${def.title} 내용이 없습니다.`); resolve(null); return; }
    const show = def.fields.filter(f => !f.auto).slice(0, 5);
    const box = document.createElement('div');
    box.className = 'fixed inset-0 z-[70] bg-slate-900/60 p-2 sm:p-4 flex items-start justify-center overflow-y-auto';
    box.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-3xl my-4 text-xs overflow-hidden">
        <div class="px-4 py-3 bg-slate-800 text-white flex items-center justify-between"><h3 class="font-black text-sm">📋 지난 일지에서 ${esc(def.title)} 가져오기</h3><button type="button" class="cp-x text-xl px-2" aria-label="닫기">&times;</button></div>
        <div class="p-4 space-y-3">
            <label class="block"><span class="font-bold text-slate-700">참조할 일지</span>
                <select id="cp-date" class="${inputCls}">${cands.map((c, i) => `<option value="${i}">${esc(c.log.date)} (${esc(siteName(c.s))}) · ${(c.log[listKey] || []).length}줄</option>`).join('')}</select></label>
            <div class="flex items-center justify-between"><label class="flex items-center gap-1.5 font-bold"><input type="checkbox" id="cp-all" class="w-4 h-4" />전체 선택</label>
                <span class="text-[11px] text-slate-500">가져온 뒤 줄마다 ✏️로 수량 등을 고치세요.${def.lot ? ' LOT 번호는 비워서 가져옵니다.' : ''}</span></div>
            <div id="cp-rows" class="border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-[55vh] overflow-y-auto"></div>
        </div>
        <div class="px-4 py-3 bg-slate-50 border-t border-slate-200 flex justify-end gap-2">
            <button type="button" class="cp-x px-3 py-2 rounded-xl bg-white border border-slate-300 font-bold">취소</button>
            <button type="button" id="cp-ok" class="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-black">선택한 줄 가져오기</button>
        </div></div>`;
    document.body.appendChild(box);
    const $ = (s) => box.querySelector(s);
    const current = () => rowsOf(cands[Number($('#cp-date').value)].log, listKey);
    const draw = () => {
        $('#cp-all').checked = false;
        $('#cp-rows').innerHTML = current().map((r, i) => `<label class="flex items-start gap-2 p-2.5 hover:bg-slate-50 cursor-pointer">
            <input type="checkbox" class="cp-chk w-4 h-4 mt-0.5" data-i="${i}" />
            <span class="min-w-0">${show.map((f, j) => (r[f.k] === '' || r[f.k] == null) ? '' : `<span class="${j === 0 ? 'font-bold text-slate-900' : 'text-slate-500'}">${j ? ' · ' : ''}${esc(r[f.k])}</span>`).join('')}</span></label>`).join('');
    };
    draw();
    $('#cp-date').addEventListener('change', draw);
    $('#cp-all').addEventListener('change', (e) => box.querySelectorAll('.cp-chk').forEach(c => { c.checked = e.target.checked; }));
    const close = (v) => { box.remove(); resolve(v); };
    box.querySelectorAll('.cp-x').forEach(b => b.addEventListener('click', () => close(null)));
    $('#cp-ok').addEventListener('click', () => {
        const src = current();
        const picked = [...box.querySelectorAll('.cp-chk:checked')].map(c => src[Number(c.dataset.i)]);
        if (!picked.length) { alert('가져올 줄을 고르세요.'); return; }
        close(picked.map(r => {
            if (def.scalar) return r.text;
            const copy = { ...r };
            COPY_DROP.forEach(k => delete copy[k]);
            if (def.lot) copy.lotNo = '';
            return copy;
        }));
    });
});
