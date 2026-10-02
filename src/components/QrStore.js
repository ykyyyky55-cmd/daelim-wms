import { state } from '../services/db.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { matchesQuery } from '../services/searchUtils.js';
import { normalizeLocationList, locationLabel, siteOf, buildingOf } from '../services/locations.js';
import { QR_ACTIONS, itemActionQrUrl, fieldQrUrl } from '../services/fieldQr.js';
import { qrDataUrl } from '../services/qrCode.js';
import { qrItemLabelElements, sheetsHtml, cellsPerSheet, openLabelPrintWindow, writeLabelPrintWindow } from '../services/labelRender.js';
import { ROLL_PAPER, QR_LABEL_PAPERS, qrPaperOf } from '../services/qrPapers.js';
import { lastProdTab } from '../services/prodSites.js';

// 라벨 → QR코드 저장소 (탭 qrStore)
// 품목마스터의 모든 품목(완제품·원액·반제품·원료·부자재 …)에 대해 작업별 QR을 만들어 둔다 (저장 없이 품목마스터에서 바로 생성).
//   품목 QR: 현장 스캔에서 그 품목을 고름 · 입고/출고/생산투입/거점이동 QR: 그 작업이 골라진 채로 현장 스캔 · 생산입고 QR: 제품생산/입고 화면
//   + 위치(거점·창고) QR. 품명·코드 일부로 찾고, [진행]을 누르거나 QR을 찍으면 바로 그 작업 화면이 열린다.
// 종류(분류)·작업별로 골라 폼텍 라벨 용지·감열 롤에 일괄 인쇄한다 (현장 QR 라벨과 같은 렌더러).
const KEY = 'daelim_qr_store';
const KINDS = [['ALL', '전체'], ['완제품', '완제품'], ['원액', '원액'], ['반제품', '반제품'], ['원료', '원료'], ['부자재', '부자재'], ['ETC', '기타'], ['LOC', '위치']];
const ACTION_ICON = { ITEM: 'qr-code', IN: 'arrow-down-to-line', OUT: 'arrow-up-from-line', USE: 'flask-conical', MOVE: 'arrow-left-right', PROD: 'factory' };
const ACTION_CLS = { ITEM: 'bg-slate-800', IN: 'bg-blue-600', OUT: 'bg-rose-600', USE: 'bg-amber-600', MOVE: 'bg-violet-600', PROD: 'bg-emerald-600' };
/** 분류별로 쓸 수 있는 작업 */
const actionsOf = (cat) => {
    if (cat === '완제품') return ['ITEM', 'IN', 'OUT', 'MOVE', 'PROD'];
    if (cat === '원액' || cat === '반제품') return ['ITEM', 'IN', 'OUT', 'USE', 'MOVE', 'PROD'];
    return ['ITEM', 'IN', 'OUT', 'USE', 'MOVE'];
};
const kindOf = (cat) => (['완제품', '원액', '반제품', '원료', '부자재'].includes(cat) ? cat : 'ETC');
const PAGE = 60;

export const renderQrStore = (container, { showToast = () => {}, onSwitchTab = () => {} } = {}) => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { /* 기본값 */ }
    let kind = KINDS.some(([k]) => k === saved.kind) ? saved.kind : 'ALL';
    let acts = new Set(Array.isArray(saved.acts) && saved.acts.length ? saved.acts : ['ITEM']);
    let paperCode = saved.paper || '3108';
    let q = '';
    let shown = PAGE;
    const picked = new Set(); // 인쇄할 대상 (품목코드 또는 LOC:위치)
    const persist = () => { try { localStorage.setItem(KEY, JSON.stringify({ kind, acts: [...acts], paper: paperCode })); } catch { /* 기억만 못 함 */ } };

    const itemTargets = () => (state.master || []).filter(m => m.code).map(m => ({ key: m.code, code: m.code, title: m.name || m.code, sub: [m.code, m.spec].filter(Boolean).join(' · '), cat: m.category || '기타', kind: kindOf(m.category), acts: actionsOf(m.category) }));
    const locTargets = () => normalizeLocationList(state.locations || []).map(l => ({ key: `LOC:${l}`, loc: l, title: locationLabel(l), sub: buildingOf(l) ? `${siteOf(l)} / ${buildingOf(l)}` : '거점 전체', cat: '위치', kind: 'LOC', acts: ['LOC'] }));
    const targets = () => {
        const list = kind === 'LOC' ? locTargets() : itemTargets().filter(t => kind === 'ALL' || t.kind === kind);
        const needle = q.trim();
        return needle ? list.filter(t => matchesQuery({ title: t.title, sub: t.sub, code: t.code || '', cat: t.cat }, needle, ['title', 'sub', 'code', 'cat'])) : list;
    };
    const urlOf = (t, a) => (a === 'LOC' ? fieldQrUrl('LOC', t.loc) : itemActionQrUrl(a, t.code));
    const labelOf = (a) => (a === 'LOC' ? '위치' : QR_ACTIONS[a]);

    // 진행: 품목·작업을 골라 그 화면으로 (QR을 찍은 것과 같음)
    const go = (t, a) => {
        if (a === 'LOC') { window.__pendingScanCode = `LOC:${t.loc}`; onSwitchTab('scan'); return; }
        if (a === 'PROD') { window.__prodPrefill = { code: t.code }; onSwitchTab(lastProdTab()); return; } // 이 기기에서 마지막으로 연 제품생산/입고(본사·김포)
        window.__pendingScanCode = a === 'ITEM' ? t.code : `ACT:${a}:${t.code}`;
        onSwitchTab('scan');
    };

    container.innerHTML = `
    <section id="qs-root" class="space-y-4">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-emerald-700 flex items-center gap-1"><i data-lucide="tag" class="w-3.5 h-3.5"></i>전표·라벨 › QR코드 저장소</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="qr-code" class="w-5 h-5 text-emerald-600"></i>QR코드 저장소</h2>
                    <p class="text-xs text-slate-500 mt-1">품목마스터의 모든 품목(완제품·원액·반제품·원료·부자재)과 위치에 대해 <b>품목 · 입고 · 출고 · 생산투입 · 거점이동 · 생산입고</b> QR을 자동으로 만들어 둡니다. 품명·코드로 찾아 <b>[진행]</b>을 누르거나 QR을 찍으면(현장 스캔 또는 스마트폰 카메라) 그 품목·작업이 바로 열립니다. 종류·작업별로 골라 라벨로 일괄 인쇄합니다.</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    <button type="button" id="qs-print-picked" class="px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700"><i data-lucide="printer" class="w-4 h-4"></i>선택한 것 인쇄 <span id="qs-picked-n" class="text-emerald-700"></span></button>
                    <button type="button" id="qs-print-all" class="px-3 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm"><i data-lucide="printer" class="w-4 h-4"></i>이 종류 전체 일괄 인쇄</button>
                </div>
            </div>
            <div class="flex flex-wrap gap-1.5" id="qs-kinds"></div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="font-bold text-slate-600">QR 작업</span>
                <div class="flex flex-wrap gap-1" id="qs-acts"></div>
            </div>
            <div class="grid grid-cols-1 md:grid-cols-4 gap-2 text-xs">
                <input type="search" id="qs-q" placeholder="품명·코드 일부로 찾기 (예: 0W-20, 용기, 김포1A)" class="md:col-span-2 border border-slate-300 rounded-lg px-3 py-2 text-sm" autocomplete="off" />
                <select id="qs-paper" class="border border-slate-300 rounded-lg px-2 py-2 font-bold">
                    ${QR_LABEL_PAPERS.map(g => `<optgroup label="${esc(g.group)}">${g.items.map(([code, use]) => { const p = qrPaperOf(code); return p ? `<option value="${esc(code)}" ${code === paperCode ? 'selected' : ''}>${code === ROLL_PAPER.code ? '감열식 롤' : `폼텍 ${esc(code)}`} (${p.across * p.down}칸 ${p.w}×${p.h}mm) - ${esc(use)}</option>` : ''; }).join('')}</optgroup>`).join('')}
                </select>
                <div class="flex gap-2"><label class="flex items-center gap-1 font-bold text-slate-600">장수 <input type="number" id="qs-copies" min="1" max="50" value="1" class="w-14 border border-slate-300 rounded-lg px-1 py-1.5 text-right" /></label>
                    <label class="flex items-center gap-1 font-bold text-slate-600">시작 칸 <input type="number" id="qs-offset" min="0" value="0" class="w-14 border border-slate-300 rounded-lg px-1 py-1.5 text-right" /></label></div>
            </div>
            <div id="qs-count" class="text-xs font-bold text-slate-500"></div>
        </div>
        <div id="qs-list" class="grid grid-cols-1 md:grid-cols-2 2xl:grid-cols-3 gap-3"></div>
        <div id="qs-more-wrap" class="text-center"></div>
    </section>`;
    const $ = (s) => container.querySelector(s);

    const paintHead = () => {
        $('#qs-kinds').innerHTML = KINDS.map(([k, l]) => {
            const n = k === 'LOC' ? locTargets().length : itemTargets().filter(t => k === 'ALL' || t.kind === k).length;
            return `<button type="button" data-kind="${k}" class="px-3 py-1.5 rounded-full text-xs font-black border ${k === kind ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-white border-slate-300 text-slate-600 hover:border-slate-500'}">${l} <span class="opacity-70">${n}</span></button>`;
        }).join('');
        $('#qs-acts').innerHTML = kind === 'LOC' ? '<span class="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-bold">위치 QR (현장 스캔에서 위치 지정)</span>'
            : Object.entries(QR_ACTIONS).map(([a, l]) => `<button type="button" data-act="${a}" class="px-2.5 py-1 rounded-full font-bold border flex items-center gap-1 ${acts.has(a) ? `${ACTION_CLS[a]} border-transparent text-white` : 'bg-white border-slate-300 text-slate-600'}"><i data-lucide="${ACTION_ICON[a]}" class="w-3.5 h-3.5"></i>${l}</button>`).join('');
        $('#qs-picked-n').textContent = picked.size ? `(${picked.size})` : '';
    };

    const renderList = () => {
        const list = targets();
        $('#qs-count').textContent = `${list.length.toLocaleString()}개${list.length > shown ? ` 중 ${shown}개 표시` : ''} · QR을 누르면 크게, [진행]은 그 작업 화면으로`;
        const cards = list.slice(0, shown).map(t => {
            const show = kind === 'LOC' ? ['LOC'] : t.acts.filter(a => acts.has(a));
            return `<div class="bg-white p-3 rounded-2xl border ${picked.has(t.key) ? 'border-emerald-400 ring-2 ring-emerald-100' : 'border-slate-200'} shadow-sm space-y-2">
                <div class="flex items-start gap-2">
                    <input type="checkbox" data-pick="${esc(t.key)}" ${picked.has(t.key) ? 'checked' : ''} class="mt-1 w-4 h-4 accent-emerald-600" title="인쇄할 대상으로 선택" />
                    <div class="min-w-0 flex-1"><div class="text-sm font-black text-slate-900 truncate" title="${esc(t.title)}">${esc(t.title)}</div>
                        <div class="text-[11px] text-slate-500 truncate">${esc(t.sub)} · <span class="font-bold">${esc(t.cat)}</span></div></div>
                </div>
                <div class="flex flex-wrap gap-2">${show.length ? show.map(a => `
                    <div class="w-[92px] text-center">
                        <button type="button" data-zoom="${esc(t.key)}|${a}" class="block w-[92px] h-[92px] rounded-lg border border-slate-200 bg-white p-1" title="크게 보기"><img data-qr="${esc(t.key)}|${a}" alt="" class="w-full h-full" /></button>
                        <button type="button" data-go="${esc(t.key)}|${a}" class="mt-1 w-full py-1 rounded-md text-[11px] font-black text-white ${ACTION_CLS[a] || 'bg-slate-700'}">▶ ${esc(labelOf(a))}</button>
                    </div>`).join('') : '<div class="text-[11px] text-slate-400 py-6">위에서 고른 작업이 이 분류에는 없습니다.</div>'}</div>
            </div>`;
        });
        $('#qs-list').innerHTML = cards.join('') || '<div class="md:col-span-2 2xl:col-span-3 p-10 text-center text-sm text-slate-400 bg-white rounded-2xl border border-slate-200">해당하는 품목이 없습니다.</div>';
        $('#qs-more-wrap').innerHTML = list.length > shown ? `<button type="button" id="qs-more" class="px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold">더 보기 (${(list.length - shown).toLocaleString()}개 남음)</button>` : '';
        $('#qs-more')?.addEventListener('click', () => { shown += PAGE; renderList(); });
        // QR 그림은 화면에 들어올 때 만든다
        const io = new IntersectionObserver((entries) => entries.forEach(async (en) => {
            if (!en.isIntersecting) return;
            io.unobserve(en.target);
            const [key, a] = en.target.dataset.qr.split('|');
            const t = list.find(x => x.key === key);
            if (t) { try { en.target.src = await qrDataUrl(urlOf(t, a), { width: 180 }); } catch (e) { console.warn('[QR 저장소] QR 만들기 실패:', e.message); } }
        }), { rootMargin: '200px' });
        container.querySelectorAll('img[data-qr]').forEach(img => io.observe(img));
        createIcons({ icons });
    };

    const findRef = (ref) => { const [key, a] = ref.split('|'); return { t: (kind === 'LOC' ? locTargets() : itemTargets()).find(x => x.key === key), a }; };
    const zoom = async (t, a) => {
        const url = urlOf(t, a);
        const wrap = document.createElement('div');
        wrap.className = 'fixed inset-0 z-[80] bg-slate-900/70 flex items-center justify-center p-4';
        wrap.innerHTML = `<div class="bg-white rounded-2xl p-5 text-center space-y-3 max-w-sm w-full">
            <div class="text-xs font-black text-white inline-block px-2 py-0.5 rounded ${ACTION_CLS[a] || 'bg-slate-700'}">${esc(labelOf(a))} QR</div>
            <div class="text-base font-black text-slate-900">${esc(t.title)}</div><div class="text-xs text-slate-500">${esc(t.sub)}</div>
            <img alt="" class="w-64 h-64 mx-auto" id="qs-big" />
            <div class="text-[10px] text-slate-400 break-all">${esc(url)}</div>
            <div class="flex gap-2 justify-center"><button type="button" data-close class="px-4 py-2 rounded-lg border border-slate-300 font-bold text-sm">닫기</button>
                <button type="button" data-go class="px-4 py-2 rounded-lg text-white font-black text-sm ${ACTION_CLS[a] || 'bg-slate-700'}">▶ ${esc(labelOf(a))} 진행</button></div></div>`;
        document.body.appendChild(wrap);
        wrap.addEventListener('click', (e) => { if (e.target === wrap || e.target.closest('[data-close]')) wrap.remove(); });
        wrap.querySelector('[data-go]').addEventListener('click', () => { wrap.remove(); go(t, a); });
        wrap.querySelector('#qs-big').src = await qrDataUrl(url, { width: 512 });
    };

    // ---------- 인쇄 ----------
    const paper = () => qrPaperOf(paperCode) || qrPaperOf('3108');
    const template = () => ({ paper: paper(), elements: qrItemLabelElements(paper(), { code: '{c}', category: '', name: '{n}', spec: '{s}', qr: '{q}' }) });
    const recordsOf = (list) => {
        const copies = Math.min(50, Math.max(1, parseInt($('#qs-copies').value, 10) || 1));
        return list.flatMap(t => (kind === 'LOC' ? ['LOC'] : t.acts.filter(a => acts.has(a))).flatMap(a => Array(copies).fill({
            c: a === 'LOC' ? '📍 위치 QR' : `${labelOf(a)} QR · ${t.cat}`, n: t.title, s: t.sub, q: urlOf(t, a)
        })));
    };
    const print = async (list, label) => {
        const records = recordsOf(list);
        if (!records.length) { alert('인쇄할 QR이 없습니다. 대상과 QR 작업을 고르세요.'); return; }
        if (records.length > 300 && !confirm(`QR 라벨 ${records.length.toLocaleString()}개를 인쇄합니다. 계속할까요?`)) return;
        const w = openLabelPrintWindow();
        if (!w) return;
        const p = paper();
        const offset = p === ROLL_PAPER ? 0 : Math.min(cellsPerSheet(p) - 1, Math.max(0, parseInt($('#qs-offset').value, 10) || 0));
        const sheets = await sheetsHtml(template(), records, { startIndex: offset });
        writeLabelPrintWindow(w, `QR코드 저장소 · ${label}`, p, sheets);
        showToast(`🖨️ QR 라벨 ${records.length.toLocaleString()}개를 인쇄합니다.`);
    };

    // 이벤트는 이 화면의 틀(#qs-root)에 붙인다 (container는 다른 탭과 같이 쓰므로 여기에 붙이면 다시 열 때마다 쌓임)
    const root = $('#qs-root');
    root.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b || !root.contains(b)) return;
        if (b.dataset.kind) { kind = b.dataset.kind; shown = PAGE; picked.clear(); persist(); paintHead(); renderList(); }
        else if (b.dataset.act) { if (acts.has(b.dataset.act)) { if (acts.size > 1) acts.delete(b.dataset.act); } else acts.add(b.dataset.act); persist(); paintHead(); renderList(); }
        else if (b.dataset.go) { const { t, a } = findRef(b.dataset.go); if (t) go(t, a); }
        else if (b.dataset.zoom) { const { t, a } = findRef(b.dataset.zoom); if (t) zoom(t, a); }
    });
    root.addEventListener('change', (e) => {
        const c = e.target.closest('[data-pick]');
        if (!c) return;
        if (c.checked) picked.add(c.dataset.pick); else picked.delete(c.dataset.pick);
        paintHead();
        c.closest('.rounded-2xl').className = `bg-white p-3 rounded-2xl border ${c.checked ? 'border-emerald-400 ring-2 ring-emerald-100' : 'border-slate-200'} shadow-sm space-y-2`;
    });
    $('#qs-q').addEventListener('input', (e) => { q = e.target.value; shown = PAGE; renderList(); });
    // 스캐너(키보드 입력)로 찍으면 검색 칸에 들어간다 → QR 내용(ACT:… 링크)이면 바로 진행
    $('#qs-q').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const v = e.target.value.trim();
        if (/^https?:\/\/|^(ACT|LOC):/i.test(v)) { window.__pendingScanCode = v; onSwitchTab('scan'); return; }
        const list = targets();
        if (list.length === 1) { const t = list[0]; go(t, kind === 'LOC' ? 'LOC' : [...acts].find(a => t.acts.includes(a)) || 'ITEM'); }
    });
    $('#qs-paper').addEventListener('change', (e) => { paperCode = e.target.value; persist(); });
    $('#qs-print-picked').addEventListener('click', () => {
        const all = kind === 'LOC' ? locTargets() : itemTargets();
        print(all.filter(t => picked.has(t.key)), '선택');
    });
    $('#qs-print-all').addEventListener('click', () => print(targets(), `${KINDS.find(([k]) => k === kind)?.[1] || ''} 전체`));

    paintHead();
    renderList();
    createIcons({ icons });
};
