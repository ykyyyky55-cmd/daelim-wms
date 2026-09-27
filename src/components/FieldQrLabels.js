import { state, rawSecurityCodeOf } from '../services/db.js';
import { normalizeLocationList, sitesOf, siteOf, buildingOf, locationLabel, RAW_LEDGER_REGIONS } from '../services/locations.js';
import { qrItemLabelElements, sheetsHtml, cellsPerSheet, fitLabelTexts, openLabelPrintWindow, writeLabelPrintWindow } from '../services/labelRender.js';
import { ROLL_PAPER, QR_LABEL_PAPERS, qrPaperOf } from '../services/qrPapers.js';
import { fieldQrUrl, rawQrValue } from '../services/fieldQr.js';
import { matchesQuery } from '../services/searchUtils.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';

// 현장 QR 라벨 (라벨 → 현장 QR 라벨): 위치 / 원료 탱크·드럼 / 사원증 QR을 폼텍 용지에 인쇄한다.
// 찍으면 현장 스캔 화면이 처리한다 (services/fieldQr.js 형식, components/FieldScanPanels.js).
const KINDS = {
    LOC: { label: '위치 (거점·건물)', icon: 'map-pin', help: '창고 입구·기둥·랙에 붙입니다. 찍으면 현재 위치가 정해지고, 거점이동 중이면 도착 위치가 됩니다.' },
    RAW: { label: '원료 탱크·드럼', icon: 'cylinder', help: '탱크·드럼에 붙입니다. 찍으면 그 지역의 원료 재고(L·kg)·비중·최근 전표를 보고 사용/입고를 바로 기록합니다.' },
    WKR: { label: '사원증', icon: 'id-card', help: '사원증 뒷면에 붙입니다. 공용 기기에서 찍으면 기록에 남는 작업자가 바뀝니다 (로그인 권한은 그대로).' }
};
const STORE_KEY = 'daelim_fieldqr_view';

export const renderFieldQrLabels = (container, { showToast }) => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { }
    let kind = KINDS[saved.kind] ? saved.kind : 'LOC';
    let paperCode = saved.paper && qrPaperOf(saved.paper) ? saved.paper : '3108';
    let region = RAW_LEDGER_REGIONS.some(r => r.value === saved.region) ? saved.region : RAW_LEDGER_REGIONS[0].value;
    let rawShow = saved.rawShow === 'name' ? 'name' : 'code'; // 탱크 라벨 글자: 원료코드(보안) / 원료명
    let search = '';
    const selected = new Set();
    const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ kind, paper: paperCode, region, rawShow })); } catch { } };

    // ---------- 종류별 대상 목록 ----------
    const locationTargets = () => normalizeLocationList([...state.locations, ...state.inventory.map(i => i.location)])
        .map(loc => ({ key: loc, group: siteOf(loc), title: locationLabel(loc), sub: buildingOf(loc) ? '건물' : '거점 전체' }));

    const rawTargets = () => {
        const out = new Map();
        state.master.filter(m => m.category === '원료' || m.category === '원액').forEach(m => out.set(m.code, { code: m.code, name: m.name, category: m.category }));
        // 품목코드 없이 원료수불부에만 있는 원료
        state.rawLedger.filter(e => e.name && !e.code).forEach(e => { if (![...out.values()].some(x => x.name === e.name)) out.set(`@${e.name}`, { code: '', name: e.name, category: '원료' }); });
        return [...out.values()].map(r => {
            const rawCode = rawSecurityCodeOf(r.code, r.name);
            return { key: r.code || r.name, group: r.category, title: r.name, sub: [r.code || '코드 없음', rawCode ? `🔒 ${rawCode}` : ''].filter(Boolean).join(' · '), ...r, rawCode };
        }).sort((a, b) => a.title.localeCompare(b.title, 'ko'));
    };

    const workerTargets = () => (state.workers || []).filter(w => w.name)
        .map(w => ({ key: String(w.id ?? w.name), group: w.dept || '작업자', title: w.name, sub: w.role || w.dept || '' }));

    const targets = () => {
        const list = kind === 'LOC' ? locationTargets() : kind === 'RAW' ? rawTargets() : workerTargets();
        return search ? list.filter(t => matchesQuery({ title: t.title, sub: t.sub, group: t.group, key: t.key }, search, ['title', 'sub', 'group', 'key'])) : list;
    };

    // 라벨 한 장의 내용 (글자 3줄 + QR)
    const recordOf = (t) => {
        if (kind === 'LOC') return { c: `📍 위치 QR · ${siteOf(t.key)}`, n: buildingOf(t.key) || siteOf(t.key), s: buildingOf(t.key) ? `${siteOf(t.key)} / ${buildingOf(t.key)}` : '거점 전체', q: fieldQrUrl('LOC', t.key) };
        if (kind === 'RAW') {
            const regionLabel = RAW_LEDGER_REGIONS.find(r => r.value === region)?.site || region;
            const text = rawShow === 'code' && t.rawCode ? t.rawCode : t.name;
            return { c: `원료 탱크·드럼 · ${regionLabel}`, n: text, s: t.code ? `품목코드 ${t.code}` : '', q: fieldQrUrl('RAW', rawQrValue(t.code || t.name, region)) };
        }
        return { c: '사원증 · 작업자 QR', n: t.title, s: t.sub, q: fieldQrUrl('WKR', t.key) };
    };

    const paper = () => qrPaperOf(paperCode) || qrPaperOf('3108');
    const template = () => ({ paper: paper(), elements: qrItemLabelElements(paper(), { code: '{c}', category: '', name: '{n}', spec: '{s}', qr: '{q}' }) });

    const buildRecords = () => {
        const copies = Math.min(50, Math.max(1, parseInt(container.querySelector('#fq-copies')?.value, 10) || 1));
        const list = targets().filter(t => selected.has(t.key));
        return list.flatMap(t => Array(copies).fill(recordOf(t)));
    };

    container.innerHTML = `
    <section class="space-y-5">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4">
                <div>
                    <h2 class="text-lg font-black text-slate-900 flex items-center gap-2"><i data-lucide="qr-code" class="w-5 h-5 text-emerald-600"></i><span>현장 QR 라벨 발행</span></h2>
                    <p class="text-xs text-slate-500 mt-1">위치·원료 탱크/드럼·사원증 QR을 인쇄합니다. 현장 스캔 화면이나 스마트폰 기본 카메라로 찍으면 바로 처리됩니다.
                        출하 검수용 전표 QR은 <b>거래 출하 전표 발행기</b>에서 전표를 발행하면 자동으로 인쇄됩니다.</p>
                </div>
                <button type="button" id="fq-print" class="px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md">
                    <i data-lucide="printer" class="w-4 h-4"></i><span>선택한 라벨 인쇄</span>
                </button>
            </div>

            <div class="flex flex-wrap gap-2" id="fq-kinds">
                ${Object.entries(KINDS).map(([k, v]) => `
                <button type="button" data-kind="${k}" class="fq-kind px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 border transition ${k === kind ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-400'}">
                    <i data-lucide="${v.icon}" class="w-4 h-4"></i>${esc(v.label)}
                </button>`).join('')}
            </div>
            <p id="fq-help" class="text-xs text-emerald-800 bg-emerald-50 border border-emerald-200 rounded-xl p-2.5 font-medium"></p>

            <div class="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                <label class="block col-span-2"><span class="font-bold text-slate-600">라벨 용지</span>
                    <select id="fq-paper" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                        ${QR_LABEL_PAPERS.map(g => `<optgroup label="${esc(g.group)}">${g.items.map(([code, use]) => {
                            const p = qrPaperOf(code);
                            return p ? `<option value="${esc(code)}" ${code === paperCode ? 'selected' : ''}>${code === ROLL_PAPER.code ? '감열식 롤 라벨' : `폼텍 ${esc(code)}`} (${p.across * p.down}칸: ${p.w} x ${p.h} mm) - ${esc(use)}</option>` : '';
                        }).join('')}</optgroup>`).join('')}
                    </select></label>
                <label class="block"><span class="font-bold text-slate-600">장수 (대상마다)</span>
                    <input type="number" id="fq-copies" min="1" max="50" value="1" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-black text-right" /></label>
                <label class="block"><span class="font-bold text-slate-600">시작 칸 (쓰다 남은 용지)</span>
                    <input type="number" id="fq-offset" min="0" value="0" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-black text-right" /></label>
                <div id="fq-raw-opts" class="col-span-2 md:col-span-4 grid grid-cols-2 gap-3"></div>
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-5">
            <div class="lg:col-span-5 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div class="flex items-center gap-2">
                    <input type="text" id="fq-search" placeholder="검색 (이름·코드 일부)" class="flex-1 min-w-0 border border-slate-300 rounded-lg px-3 py-1.5 text-xs" autocomplete="off" />
                    <button type="button" id="fq-all" class="shrink-0 whitespace-nowrap px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold">전체 선택</button>
                    <button type="button" id="fq-none" class="shrink-0 whitespace-nowrap px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 rounded-lg text-xs font-bold">해제</button>
                </div>
                <div id="fq-count" class="text-xs font-bold text-slate-500"></div>
                <div id="fq-list" class="max-h-[60vh] overflow-y-auto space-y-3 pr-1"></div>
            </div>
            <div class="lg:col-span-7 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2">
                <div class="flex items-center justify-between text-xs"><span class="font-black text-slate-800">미리보기 (첫 장)</span><span id="fq-paper-info" class="text-slate-500"></span></div>
                <div id="fq-preview-wrap" class="bg-slate-200 rounded-xl p-3 overflow-hidden"><div id="fq-preview" style="transform-origin: top left"></div></div>
            </div>
        </div>
    </section>`;

    const $ = (s) => container.querySelector(s);

    const renderOptions = () => {
        $('#fq-help').textContent = KINDS[kind].help;
        $('#fq-raw-opts').innerHTML = kind !== 'RAW' ? '' : `
            <label class="block"><span class="font-bold text-slate-600">탱크 지역 (원료수불부 지역)</span>
                <select id="fq-region" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                    ${RAW_LEDGER_REGIONS.map(r => `<option value="${esc(r.value)}" ${r.value === region ? 'selected' : ''}>${esc(r.label)}</option>`).join('')}
                </select></label>
            <label class="block"><span class="font-bold text-slate-600">라벨에 표시할 이름</span>
                <select id="fq-rawshow" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">
                    <option value="code" ${rawShow === 'code' ? 'selected' : ''}>🔒 원료코드 (없으면 원료명)</option>
                    <option value="name" ${rawShow === 'name' ? 'selected' : ''}>원료명</option>
                </select></label>`;
        $('#fq-region')?.addEventListener('change', (e) => { region = e.target.value; persist(); renderPreview(); });
        $('#fq-rawshow')?.addEventListener('change', (e) => { rawShow = e.target.value; persist(); renderPreview(); });
    };

    const renderList = () => {
        const list = targets();
        const groups = new Map();
        list.forEach(t => { if (!groups.has(t.group)) groups.set(t.group, []); groups.get(t.group).push(t); });
        $('#fq-count').textContent = `대상 ${list.length.toLocaleString()}개 · 선택 ${list.filter(t => selected.has(t.key)).length.toLocaleString()}개`;
        $('#fq-list').innerHTML = list.length === 0
            ? `<div class="p-6 text-center text-xs text-slate-400">${kind === 'WKR' ? '작업자 명단이 없습니다. 환경설정에서 작업자를 등록하세요.' : '대상이 없습니다.'}</div>`
            : [...groups].map(([g, items]) => `
                <div>
                    <div class="text-[11px] font-black text-slate-500 mb-1">${esc(g)}</div>
                    <div class="space-y-1">${items.map(t => `
                        <label class="flex items-center gap-2 p-2 rounded-lg border ${selected.has(t.key) ? 'border-emerald-400 bg-emerald-50' : 'border-slate-200 bg-white'} cursor-pointer text-xs">
                            <input type="checkbox" class="fq-item rounded text-emerald-600" data-key="${esc(t.key)}" ${selected.has(t.key) ? 'checked' : ''} />
                            <span class="min-w-0 flex-1"><span class="font-bold text-slate-900">${esc(t.title)}</span>
                                <span class="block text-[11px] text-slate-500 truncate">${esc(t.sub)}</span></span>
                        </label>`).join('')}
                    </div>
                </div>`).join('');
        container.querySelectorAll('.fq-item').forEach(cb => cb.addEventListener('change', () => {
            if (cb.checked) selected.add(cb.dataset.key); else selected.delete(cb.dataset.key);
            renderList();
            renderPreview();
        }));
    };

    let previewSeq = 0;
    const renderPreview = async () => {
        const seq = ++previewSeq;
        const p = paper();
        const per = cellsPerSheet(p);
        const offset = p === ROLL_PAPER ? 0 : Math.min(per - 1, Math.max(0, parseInt($('#fq-offset').value, 10) || 0));
        const records = buildRecords();
        const pages = Math.ceil((records.length + offset) / per) || 0;
        $('#fq-paper-info').textContent = `${p === ROLL_PAPER ? '감열 롤' : `폼텍 ${p.code}`} · ${p.w}×${p.h}mm · ${per}칸 · 라벨 ${records.length}개 = 용지 ${pages}장`;
        const el = $('#fq-preview');
        if (records.length === 0) { el.innerHTML = '<div class="p-10 text-center text-xs text-slate-500">왼쪽에서 인쇄할 대상을 고르세요.</div>'; el.style.transform = ''; return; }
        const sheets = await sheetsHtml(template(), records.slice(0, per - offset), { startIndex: offset, outline: true });
        if (seq !== previewSeq) return;
        el.innerHTML = `<style>.fq-sheet .sheet{background:#fff}</style><div class="fq-sheet">${sheets[0] || ''}</div>`;
        fitLabelTexts(el);
        const wrapW = $('#fq-preview-wrap').clientWidth - 24;
        const sheetPx = p.sheetW * 3.7795;
        const scale = Math.min(1, wrapW / sheetPx);
        el.style.transform = `scale(${scale})`;
        el.style.height = `${p.sheetH * 3.7795 * scale}px`;
        el.style.width = `${sheetPx}px`;
        $('#fq-preview-wrap').style.height = `${p.sheetH * 3.7795 * scale + 24}px`;
    };

    const switchKind = (k) => {
        kind = k;
        selected.clear();
        search = '';
        $('#fq-search').value = '';
        container.querySelectorAll('.fq-kind').forEach(b => {
            const on = b.dataset.kind === kind;
            b.className = `fq-kind px-4 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 border transition ${on ? 'bg-emerald-600 text-white border-emerald-600' : 'bg-white text-slate-700 border-slate-200 hover:border-emerald-400'}`;
        });
        persist();
        renderOptions();
        renderList();
        renderPreview();
    };

    container.querySelectorAll('.fq-kind').forEach(b => b.addEventListener('click', () => switchKind(b.dataset.kind)));
    $('#fq-paper').addEventListener('change', (e) => { paperCode = e.target.value; persist(); renderPreview(); });
    $('#fq-copies').addEventListener('input', renderPreview);
    $('#fq-offset').addEventListener('input', renderPreview);
    $('#fq-search').addEventListener('input', (e) => { search = e.target.value.trim(); renderList(); });
    $('#fq-all').addEventListener('click', () => { targets().forEach(t => selected.add(t.key)); renderList(); renderPreview(); });
    $('#fq-none').addEventListener('click', () => { selected.clear(); renderList(); renderPreview(); });
    $('#fq-print').addEventListener('click', async () => {
        const records = buildRecords();
        if (records.length === 0) { alert('인쇄할 대상을 고르세요.'); return; }
        if (kind === 'RAW' && targets().some(t => selected.has(t.key) && !t.code)) {
            if (!confirm('품목코드가 없는 원료는 QR에 원료명이 들어갑니다. 계속할까요?')) return;
        }
        const w = openLabelPrintWindow();
        if (!w) return;
        const p = paper();
        const offset = p === ROLL_PAPER ? 0 : Math.min(cellsPerSheet(p) - 1, Math.max(0, parseInt($('#fq-offset').value, 10) || 0));
        const sheets = await sheetsHtml(template(), records, { startIndex: offset });
        writeLabelPrintWindow(w, `현장 QR 라벨 (${KINDS[kind].label})`, p, sheets);
        showToast(`🖨️ ${KINDS[kind].label} QR 라벨 ${records.length}개를 인쇄합니다.`);
    });

    renderOptions();
    renderList();
    renderPreview();
    createIcons({ icons });
};
