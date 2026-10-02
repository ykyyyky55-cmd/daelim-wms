// ==========================================
// 통합 검색 팝업 (헤더 뒤로가기 왼쪽 🔍, 단축키 Ctrl+K · /)
// ==========================================
// 검색 엔진·검색 문법·보안 제외 목록은 services/globalSearch.js. 여기서는 창·입력 방법·결과 열기를 맡는다.
// 입력 방법: 글자(초성 포함), 분류 칩, 기간 칩(오늘·7일·30일·이번 달·직접), QR·바코드 카메라 스캔, 음성(지원 브라우저), 최근 검색어.
// 결과: ↑↓ 로 고르고 Enter로 열기. 품목·재고·위치는 창 안에서 위치별 재고·최근 수불을 먼저 보여 준다.
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { localDateStr } from '../services/searchUtils.js';
import { locationLabel } from '../services/locations.js';
import { state } from '../services/db.js';
import { canAccessTab } from '../services/auth.js';
import { CATS, collectDocs, searchDocs, itemDetail, refreshRemote, dateRangeOf } from '../services/globalSearch.js';
import { parseFieldQr, itemCodeOfScan } from '../services/fieldQr.js';

const RECENT_KEY = 'daelim_gsearch_recent';
const loadRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const pushRecent = (q) => { q = String(q || '').trim(); if (!q) return; try { localStorage.setItem(RECENT_KEY, JSON.stringify([q, ...loadRecent().filter(x => x !== q)].slice(0, 10))); } catch { /* 무시 */ } };
const fmt = (n) => (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 });
const PERIODS = [['', '전체 기간'], ['오늘', '오늘'], ['7', '최근 7일'], ['30', '최근 30일'], ['이번달', '이번 달'], ['지난달', '지난달'], ['custom', '직접']];
const TIPS = [
    ['품목:엔진오일', '분류를 정해 찾기 (메뉴·품목·재고·수불·이력·전표·스케줄·요청·일정·위치·매뉴얼)'],
    ['ㅋㅁ', '초성만으로 찾기 (카밈)'],
    ['5w30 1L', '여러 낱말 모두 포함 · 공백·하이픈 무시'],
    ['@김포 출고', '위치·거점 지정'],
    ['이번달 RQ', '날짜 낱말 (오늘·어제·이번주·지난주·이번달·지난달·올해)'],
    ['9/1~9/28 입고', '날짜·기간 (9/28, 2026-09-28, 9/1~9/30)'],
    ['재고: >1000', '수량 조건 (>, <, >=, <=)']
];

let openState = null;
let keyBound = false;

/** 헤더·단축키에서 부르는 함수 */
export const openGlobalSearch = ({ onSwitchTab, showToast = () => {}, initial = '' } = {}) => {
    if (openState) { openState.focus(initial); return; }
    const switchTab = onSwitchTab || window.__switchTab;
    const today = localDateStr();
    let docs = [];
    let loadingRemote = true;
    let q = initial;
    let cats = [];
    let period = '';
    let custom = { from: '', to: '' };
    let sel = 0;
    let shown = [];
    let expanded = new Set();
    let detail = null; // 선택한 품목·위치 상세
    let cam = null;

    const wrap = document.createElement('div');
    wrap.id = 'gsearch';
    wrap.className = 'fixed inset-0 z-[90] bg-slate-900/50 flex items-start justify-center sm:p-6';
    wrap.innerHTML = `
    <div class="bg-white w-full h-full sm:h-auto sm:max-h-[88vh] sm:max-w-5xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div class="p-3 border-b border-slate-200 space-y-2">
            <div class="flex items-center gap-2">
                <div class="relative flex-1">
                    <i data-lucide="search" class="w-5 h-5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2"></i>
                    <input id="gs-q" type="search" autocomplete="off" enterkeyhint="search" placeholder="품목·코드·전표번호·거래처·위치·메뉴… (초성·'품목:'·'@김포'·'이번달' 가능)" class="w-full border-2 border-indigo-300 focus:border-indigo-500 rounded-xl pl-10 pr-3 py-2.5 text-sm font-bold outline-none" />
                </div>
                <button type="button" id="gs-scan" title="QR·바코드 스캔으로 찾기" class="tap-compact w-11 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center"><i data-lucide="scan-line" class="w-5 h-5"></i></button>
                <button type="button" id="gs-voice" title="말로 찾기" class="tap-compact w-11 h-11 rounded-xl bg-slate-100 hover:bg-slate-200 flex items-center justify-center hidden"><i data-lucide="mic" class="w-5 h-5"></i></button>
                <button type="button" id="gs-close" title="닫기 (Esc)" class="tap-compact w-11 h-11 rounded-xl text-slate-500 hover:bg-slate-100 flex items-center justify-center"><i data-lucide="x" class="w-5 h-5"></i></button>
            </div>
            <div id="gs-cam" class="hidden rounded-xl overflow-hidden bg-black max-w-sm mx-auto"><div id="gs-cam-view"></div></div>
            <div id="gs-cats" class="flex gap-1 overflow-x-auto pb-0.5 text-[11px]"></div>
            <div class="flex flex-wrap items-center gap-1 text-[11px]">
                <span class="font-bold text-slate-400 mr-1">기간</span>
                ${PERIODS.map(([k, l]) => `<button type="button" data-p="${k}" class="gs-period tap-compact px-2 py-1 rounded-lg font-bold">${l}</button>`).join('')}
                <span id="gs-custom" class="hidden items-center gap-1"><input type="date" id="gs-from" class="border border-slate-300 rounded px-1 py-0.5" />~<input type="date" id="gs-to" class="border border-slate-300 rounded px-1 py-0.5" /></span>
                <span id="gs-status" class="ml-auto text-slate-400"></span>
            </div>
        </div>
        <div class="flex-1 min-h-0 flex">
            <div id="gs-list" class="flex-1 min-w-0 overflow-y-auto p-2"></div>
            <aside id="gs-detail" class="hidden md:block w-[340px] shrink-0 border-l border-slate-200 overflow-y-auto p-3 bg-slate-50"></aside>
        </div>
        <div class="hidden sm:flex px-3 py-1.5 border-t border-slate-100 text-[10px] text-slate-400 gap-3"><span>↑↓ 이동</span><span>Enter 열기</span><span>Esc 닫기</span><span>Ctrl+K · / 어디서나 검색</span><span class="ml-auto">원액 작업지시서·배합·원료코드 등 보안 자료는 검색하지 않습니다</span></div>
    </div>`;
    document.body.appendChild(wrap);
    const $ = (s) => wrap.querySelector(s);
    const input = $('#gs-q');
    input.value = q;

    const close = async () => {
        if (cam) cam.stop();
        wrap.remove(); openState = null;
        document.removeEventListener('keydown', onKey, true);
    };
    const rangeOf = () => {
        if (period === 'custom') return [custom.from, custom.to];
        if (period === '7' || period === '30') { const d = new Date(); d.setDate(d.getDate() - Number(period) + 1); return [localDateStr(d), today]; }
        if (period) return dateRangeOf(period, today) || ['', ''];
        return ['', ''];
    };

    const paintChips = (counts = {}) => {
        const total = Object.values(counts).reduce((a, b) => a + b, 0);
        const chip = (k, label, n, on) => `<button type="button" data-c="${k}" class="gs-cat tap-compact shrink-0 px-2.5 py-1 rounded-full border font-bold whitespace-nowrap ${on ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-slate-600 border-slate-200 hover:border-slate-400'}">${label}${n !== undefined ? ` <span class="${on ? 'text-indigo-100' : 'text-slate-400'}">${n}</span>` : ''}</button>`;
        $('#gs-cats').innerHTML = chip('', '전체', q ? total : undefined, !cats.length)
            + Object.entries(CATS).filter(([k, c]) => k === 'MENU' || k === 'MANUAL' || k === 'LEDGER' || !c.tab || canAccessTab(c.tab)).map(([k, c]) => chip(k, c.label, q ? (counts[k] || 0) : undefined, cats.includes(k))).join('');
        wrap.querySelectorAll('.gs-cat').forEach(b => b.addEventListener('click', () => {
            const k = b.dataset.c;
            cats = !k ? [] : cats.includes(k) ? cats.filter(x => x !== k) : [...cats, k];
            run();
        }));
        wrap.querySelectorAll('.gs-period').forEach(b => { b.className = `gs-period tap-compact px-2 py-1 rounded-lg font-bold ${b.dataset.p === period ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`; });
        $('#gs-custom').classList.toggle('hidden', period !== 'custom');
        $('#gs-custom').classList.toggle('flex', period === 'custom');
    };

    const rowHtml = (d, i) => {
        const c = CATS[d.cat];
        return `<button type="button" data-i="${i}" class="gs-row w-full text-left px-2.5 py-2 rounded-xl flex items-start gap-2.5 ${i === sel ? 'bg-indigo-50 ring-1 ring-indigo-300' : 'hover:bg-slate-50'}">
            <span class="mt-0.5 w-7 h-7 shrink-0 rounded-lg bg-slate-100 flex items-center justify-center"><i data-lucide="${d.icon || c.icon}" class="w-4 h-4 text-slate-500"></i></span>
            <span class="min-w-0 flex-1">
                <span class="flex items-center gap-1.5"><span class="font-black text-slate-900 text-xs truncate">${esc(d.title || '')}</span>${d.badge ? `<span class="shrink-0 px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 text-[10px] font-bold">${esc(d.badge)}</span>` : ''}</span>
                <span class="block text-[11px] text-slate-500 truncate">${esc(d.sub || '')}</span>
                ${d.meta ? `<span class="block text-[11px] text-slate-700 font-bold truncate">${esc(d.meta)}</span>` : ''}
            </span>
            ${d.date ? `<span class="shrink-0 text-[10px] text-slate-400">${esc(d.date.slice(2).replace(/-/g, '.'))}</span>` : ''}
        </button>`;
    };

    const renderEmpty = () => {
        const recent = loadRecent();
        $('#gs-list').innerHTML = `<div class="p-3 space-y-4 text-xs">
            ${recent.length ? `<div><div class="font-black text-slate-500 mb-1.5">최근 검색</div><div class="flex flex-wrap gap-1.5">${recent.map(r => `<button type="button" class="gs-recent tap-compact px-2.5 py-1 rounded-full bg-slate-100 hover:bg-slate-200 font-bold">${esc(r)}</button>`).join('')}<button type="button" id="gs-recent-clear" class="tap-compact px-2 py-1 text-slate-400 underline">지우기</button></div></div>` : ''}
            <div><div class="font-black text-slate-500 mb-1.5">검색 방법</div><div class="grid sm:grid-cols-2 gap-1.5">${TIPS.map(([ex, d]) => `<button type="button" class="gs-tip tap-compact text-left p-2 rounded-lg border border-slate-200 hover:border-indigo-300"><code class="font-black text-indigo-700">${esc(ex)}</code><div class="text-[11px] text-slate-500">${esc(d)}</div></button>`).join('')}</div></div>
            <div class="text-[11px] text-slate-400">📷 스캔: 품목 QR·바코드·위치 QR·전표 QR을 비추면 그 품목·위치·전표를 찾습니다.${'webkitSpeechRecognition' in window || 'SpeechRecognition' in window ? ' 🎤 음성: 말로 검색어를 넣습니다.' : ''}</div>
        </div>`;
        wrap.querySelectorAll('.gs-recent').forEach(b => b.addEventListener('click', () => setQ(b.textContent)));
        wrap.querySelectorAll('.gs-tip').forEach(b => b.addEventListener('click', () => setQ(b.querySelector('code').textContent)));
        $('#gs-recent-clear')?.addEventListener('click', () => { try { localStorage.removeItem(RECENT_KEY); } catch { /* 무시 */ } renderEmpty(); });
        $('#gs-detail').innerHTML = '<div class="text-[11px] text-slate-400 p-4 text-center">결과를 고르면 여기에 자세히 보입니다.</div>';
        shown = [];
    };

    const run = () => {
        const [from, to] = rangeOf();
        const res = searchDocs(docs, q, { cats, from, to });
        paintChips(res.counts);
        $('#gs-status').textContent = loadingRemote ? '전표·요청서·스케줄 불러오는 중…' : '';
        if (!q.trim() && !from) { renderEmpty(); createIcons({ icons }); return; }
        // 분류별로 묶어 앞 8개씩 (더보기)
        const groups = {};
        res.hits.forEach(h => { (groups[h.cat] = groups[h.cat] || []).push(h); });
        const order = [...new Set(res.hits.map(h => h.cat))];
        shown = [];
        const html = order.map(cat => {
            const all = groups[cat];
            const lim = expanded.has(cat) || cats.length === 1 ? 100 : 8;
            const list = all.slice(0, lim);
            const start = shown.length;
            shown.push(...list);
            return `<div class="mb-2"><div class="px-2 py-1 text-[11px] font-black text-slate-500 flex items-center gap-1"><i data-lucide="${CATS[cat].icon}" class="w-3.5 h-3.5"></i>${CATS[cat].label} <span class="text-slate-400">${all.length}</span></div>
                ${list.map((d, j) => rowHtml(d, start + j)).join('')}
                ${all.length > lim ? `<button type="button" data-more="${cat}" class="gs-more tap-compact w-full py-1.5 text-[11px] font-bold text-indigo-600 hover:bg-indigo-50 rounded-lg">${CATS[cat].label} ${all.length - lim}건 더 보기</button>` : ''}</div>`;
        }).join('');
        if (sel >= shown.length) sel = Math.max(0, shown.length - 1);
        $('#gs-list').innerHTML = html || `<div class="p-8 text-center text-xs text-slate-400">찾은 결과가 없습니다.${loadingRemote ? ' (전표·요청서·스케줄을 불러오는 중)' : ''}<div class="mt-2">낱말을 줄이거나, 초성·코드 일부로 찾아 보세요.</div></div>`;
        wrap.querySelectorAll('.gs-row').forEach(b => {
            b.addEventListener('click', () => { sel = Number(b.dataset.i); if (window.matchMedia('(min-width: 768px)').matches && hasDetail(shown[sel]) && detail?.id !== shown[sel].id) { paintSel(); showDetail(shown[sel]); } else openDoc(shown[sel]); });
            b.addEventListener('mouseenter', () => { /* 마우스 올림만으로는 선택하지 않음 */ });
        });
        wrap.querySelectorAll('.gs-more').forEach(b => b.addEventListener('click', () => { expanded.add(b.dataset.more); run(); }));
        if (shown[sel]) showDetail(shown[sel]); else $('#gs-detail').innerHTML = '';
        createIcons({ icons });
    };
    const paintSel = () => wrap.querySelectorAll('.gs-row').forEach(b => { const on = Number(b.dataset.i) === sel; b.classList.toggle('bg-indigo-50', on); b.classList.toggle('ring-1', on); b.classList.toggle('ring-indigo-300', on); if (on) b.scrollIntoView({ block: 'nearest' }); });

    const hasDetail = (d) => d && ['ITEM', 'STOCK', 'LOC'].includes(d.cat);
    // 오른쪽 상세 (스마트폰은 목록을 누르면 바로 연다)
    const showDetail = (d) => {
        detail = d;
        const host = $('#gs-detail');
        const btn = (id, label, icon, cls = 'bg-white border border-slate-300 text-slate-700 hover:bg-slate-100') => `<button type="button" data-act="${id}" class="gs-act tap-compact w-full px-3 py-2 rounded-lg text-xs font-black flex items-center gap-1.5 ${cls}"><i data-lucide="${icon}" class="w-4 h-4"></i>${label}</button>`;
        let body = '';
        if (d.item && (d.cat === 'ITEM' || d.cat === 'STOCK')) {
            const x = itemDetail(d.item);
            const it = x.item || { code: d.item, name: d.title };
            const total = x.stock.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
            body = `<div class="space-y-3 text-xs">
                <div><div class="font-black text-slate-900 text-sm">${esc(it.name)}</div><div class="text-slate-500 font-mono">${esc(it.code)}</div>
                    <div class="text-[11px] text-slate-500">${esc([it.spec, it.category, it.subCategory, it.supplier].filter(v => v && v !== '-').join(' · '))}</div></div>
                <div class="p-2 rounded-lg bg-white border border-slate-200"><div class="font-black text-slate-600 mb-1">위치별 재고 <span class="text-indigo-700">${fmt(total)} ${esc(it.unit || '')}</span></div>
                    ${x.stock.length ? x.stock.map(i => `<div class="flex justify-between"><span>${esc(locationLabel(i.location))}</span><b>${fmt(i.quantity)}</b></div>`).join('') : '<div class="text-slate-400">재고 없음</div>'}</div>
                <div class="p-2 rounded-lg bg-white border border-slate-200"><div class="font-black text-slate-600 mb-1">최근 수불·입출고</div>
                    ${x.moves.length ? x.moves.map(mv => `<div class="flex gap-1.5 text-[11px] border-b border-slate-50 py-0.5"><span class="text-slate-400 shrink-0">${esc(String(mv.date).slice(5))}</span><span class="truncate flex-1">${esc(mv.kind)} ${esc(mv.note)}</span><b class="shrink-0">${esc(mv.qty)}</b></div>`).join('') : '<div class="text-slate-400">기록 없음</div>'}</div>
                <div class="space-y-1.5">${canAccessTab('inventory') ? btn('inv', '창고 재고 현황에서 보기', 'database') : ''}${canAccessTab('master') ? btn('master', '품목 마스터에서 보기', 'layout-grid') : ''}${btn('ledger', '수불부에서 보기', 'book-open-check')}${btn('q', '이 품목으로 전체 검색', 'search', 'bg-indigo-600 text-white')}</div>
            </div>`;
        } else if (d.cat === 'LOC') {
            const items = state.inventory.filter(i => i.location === d.location && Number(i.quantity) > 0).sort((a, b) => b.quantity - a.quantity);
            body = `<div class="space-y-3 text-xs"><div class="font-black text-slate-900 text-sm">📍 ${esc(d.title)}</div>
                <div class="p-2 rounded-lg bg-white border border-slate-200 max-h-80 overflow-y-auto">${items.length ? items.map(i => `<div class="flex justify-between gap-2 py-0.5"><span class="truncate">${esc(i.name)}</span><b class="shrink-0">${fmt(i.quantity)} ${esc(i.unit || '')}</b></div>`).join('') : '<div class="text-slate-400">재고 없음</div>'}</div>
                ${btn('inv', '창고 재고 현황에서 보기', 'database')}${btn('q', '이 위치로 전체 검색', 'search', 'bg-indigo-600 text-white')}</div>`;
        } else {
            body = `<div class="space-y-2 text-xs"><div class="font-black text-slate-900 text-sm">${esc(d.title || '')}</div>${d.badge ? `<div class="text-[11px] font-bold text-indigo-700">${esc(d.badge)}</div>` : ''}
                <div class="text-slate-600">${esc(d.sub || '')}</div><div class="font-bold text-slate-800">${esc(d.meta || '')}</div>
                ${d.cat === 'MANUAL' ? `<div class="text-[11px] text-slate-500 line-clamp-6">${esc(String(d.extra || '').slice(0, 300))}</div>` : ''}
                ${btn('open', '열기', 'external-link', 'bg-indigo-600 text-white')}</div>`;
        }
        host.innerHTML = body;
        host.querySelectorAll('.gs-act').forEach(b => b.addEventListener('click', () => act(b.dataset.act, d)));
        createIcons({ icons });
    };

    // 화면을 열고 그 화면의 검색칸에 넣는다
    const fillSearch = (text) => {
        let tries = 0;
        const t = setInterval(() => {
            const el = document.querySelector('#main-content input[type="search"], #main-content input[placeholder*="검색"]');
            if (el || ++tries > 20) {
                clearInterval(t);
                if (el) { el.value = text; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('keyup', { bubbles: true })); }
            }
        }, 150);
    };
    const go = (tab, search) => { if (!canAccessTab(tab)) { showToast('⚠️ 이 화면을 열 권한이 없습니다.'); return; } pushRecent(q); close(); switchTab(tab); if (search) fillSearch(search); };
    const act = (a, d) => {
        if (a === 'open') return openDoc(d, true);
        if (a === 'q') { cats = []; setQ(d.cat === 'LOC' ? `@${d.location}` : d.item || d.title); return; }
        if (a === 'inv') return go('inventory', d.cat === 'LOC' ? locationLabel(d.location) : d.item);
        if (a === 'master') return go('master', d.item);
        if (a === 'ledger') {
            const m = state.master.find(x => x.code === d.item);
            const tab = ['원료', '원액'].includes(m?.category) ? 'rawLedger' : m?.category === '완제품' ? 'productLedger' : 'ledger';
            return go(tab, d.item);
        }
    };
    const openDoc = (d, force = false) => {
        if (!d) return;
        if (!force && hasDetail(d) && window.matchMedia('(min-width: 768px)').matches) { showDetail(d); return; }
        if (!force && hasDetail(d)) { // 스마트폰: 상세를 목록 자리에 보여 준다
            $('#gs-detail').classList.remove('hidden'); $('#gs-detail').classList.add('fixed', 'inset-x-0', 'bottom-0', 'max-h-[70vh]', 'z-[91]', 'shadow-2xl', 'rounded-t-2xl');
            showDetail(d);
            if (!$('#gs-detail-close')) { $('#gs-detail').insertAdjacentHTML('afterbegin', '<button type="button" id="gs-detail-close" class="w-full py-1 text-xs font-bold text-slate-500">▼ 닫기</button>'); }
            $('#gs-detail-close').onclick = () => { $('#gs-detail').className = 'hidden md:block w-[340px] shrink-0 border-l border-slate-200 overflow-y-auto p-3 bg-slate-50'; };
            return;
        }
        pushRecent(q);
        const o = d.open || {};
        if (d.cat === 'MENU') return go(o.tab);
        if (d.cat === 'MANUAL') { try { localStorage.setItem('daelim_manual_view', JSON.stringify({ manual: o.manual, chapter: o.chapter })); } catch { /* 무시 */ } return go('manual'); }
        if (d.cat === 'SLIP') {
            const s = d.slip;
            if (s.type === 'RELEASE' && canAccessTab('shipRequest')) { window.__shipOpenDocNo = s.docNo; return go('shipRequest'); }
            if (canAccessTab('slipIssue')) { window.__slipOpenDocNo = s.docNo; return go('slipIssue'); }
            return go('slipManage', s.docNo);
        }
        if (d.cat === 'REQ') { window.__reqOpen = { id: d.req.id, type: d.req.type, month: d.req.month }; return go(d.req.tab); }
        if (d.cat === 'SCHED') {
            go('prodSchedule');
            let n = 0; const t = setInterval(() => { if (window.__openProdScheduleRow || ++n > 30) { clearInterval(t); setTimeout(() => window.__openProdScheduleRow?.(d.schedId), 400); } }, 200);
            return;
        }
        if (d.cat === 'CAL') { showToast(`🗓️ ${d.date} 일정: ${d.title}`); return go('calendar'); }
        if (o.tab) return go(o.tab, o.search);
        if (d.cat === 'ITEM' || d.cat === 'STOCK') return go('inventory', d.item);
        if (d.cat === 'LOC') return go('inventory', locationLabel(d.location));
    };

    const setQ = (text) => { q = text; input.value = text; sel = 0; expanded = new Set(); run(); input.focus(); };
    let deb = null;
    input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => { q = input.value; sel = 0; expanded = new Set(); run(); }, 120); });
    wrap.querySelectorAll('.gs-period').forEach(b => b.addEventListener('click', () => { period = period === b.dataset.p ? '' : b.dataset.p; run(); }));
    $('#gs-from').addEventListener('change', (e) => { custom.from = e.target.value; run(); });
    $('#gs-to').addEventListener('change', (e) => { custom.to = e.target.value; run(); });
    $('#gs-close').addEventListener('click', close);
    wrap.addEventListener('mousedown', (e) => { if (e.target === wrap) close(); });

    // 키보드
    const onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            if (!shown.length) return;
            e.preventDefault();
            sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length;
            paintSel(); showDetail(shown[sel]);
        } else if (e.key === 'Enter' && document.activeElement === input) {
            e.preventDefault();
            if (shown[sel]) openDoc(shown[sel], true); else pushRecent(q);
        }
    };
    document.addEventListener('keydown', onKey, true);

    // QR·바코드 스캔
    $('#gs-scan').addEventListener('click', async () => {
        if (cam) { cam.stop(); return; }
        $('#gs-cam').classList.remove('hidden');
        try {
            const { createQrCamera } = await import('../services/qrCamera.js');
            const onText = (text) => {
                const f = parseFieldQr(text);
                if (f?.type === 'LOC') setQ(`@${f.value}`);
                else if (f?.type === 'SLIP') setQ(f.value);
                else if (f?.type === 'LOT' && canAccessTab('lotTrace')) { window.__lotTraceKey = f.value; pushRecent(f.value); close(); switchTab('lotTrace'); }
                else if (f?.type === 'LOT') setQ(f.value);
                else if (f?.type === 'WKR') showToast('ℹ️ 사원증 QR은 검색하지 않습니다.');
                else { const code = f?.type === 'ACT' || f?.type === 'RAW' ? f.value.split(/[|:]/)[0] : itemCodeOfScan(text); setQ(code || text); }
            };
            cam = createQrCamera($('#gs-cam-view'), { onText, once: true, showToast, onStop: () => { cam = null; $('#gs-cam')?.classList.add('hidden'); } });
            await cam.start();
        } catch (e) { $('#gs-cam').classList.add('hidden'); cam = null; showToast(`⚠️ 카메라를 켜지 못했습니다: ${e.message || e}`); }
    });
    // 음성 (Chrome·안드로이드 등 지원 브라우저만)
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (SR) {
        $('#gs-voice').classList.remove('hidden');
        $('#gs-voice').addEventListener('click', () => {
            const r = new SR(); r.lang = 'ko-KR'; r.interimResults = false; r.maxAlternatives = 1;
            $('#gs-voice').classList.add('bg-rose-100', 'animate-pulse');
            r.onresult = (ev) => setQ(String(ev.results[0][0].transcript || '').replace(/[.。]$/, ''));
            r.onend = () => $('#gs-voice').classList.remove('bg-rose-100', 'animate-pulse');
            r.onerror = () => showToast('⚠️ 음성을 알아듣지 못했습니다.');
            r.start();
        });
    }

    openState = { focus: (t) => { if (t) setQ(t); input.focus(); } };
    createIcons({ icons });
    paintChips();
    renderEmpty();
    createIcons({ icons });
    setTimeout(() => input.focus(), 30);
    // 자료 모으기: 기기 자료는 바로, 클라우드(전표·요청서·스케줄)는 받는 대로
    collectDocs({ withRemote: false }).then(d => { docs = d; run(); });
    refreshRemote();
    collectDocs().then(d => { docs = d; loadingRemote = false; if (openState) run(); }).catch(() => { loadingRemote = false; });
    if (initial) run();
};

/** Ctrl+K · '/' 단축키 (한 번만 건다) */
export const bindGlobalSearchKeys = (opts) => {
    if (keyBound) return;
    keyBound = true;
    document.addEventListener('keydown', (e) => {
        const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement?.tagName || '') || document.activeElement?.isContentEditable;
        if (((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') || (e.key === '/' && !typing)) {
            e.preventDefault();
            openGlobalSearch(opts());
        }
    });
};
