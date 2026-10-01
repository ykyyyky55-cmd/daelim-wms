// ==========================================
// 품질관리 › LOT 추적 (lotTrace) — LOT 하나의 생산·투입 원부자재·품질·이동·출하 이력
// ==========================================
// 모으기는 services/lotTrace.js. 다른 화면에서 열 때: window.__lotTraceKey = 'LOT번호' 후 탭 전환.
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { localDateStr } from '../services/searchUtils.js';
import * as XLSX from 'xlsx';
import { traceLotFull, recentLots } from '../services/lotTrace.js';
import { parseFieldQr } from '../services/fieldQr.js';

const fmt = (n) => (n === '' || n === null || n === undefined ? '' : (Number(n) || 0).toLocaleString('ko-KR', { maximumFractionDigits: 3 }));
const RECENT_KEY = 'daelim_lot_trace_recent';
const GROUP_CLS = { 생산: 'bg-blue-100 text-blue-700', 투입: 'bg-amber-100 text-amber-800', 품질: 'bg-emerald-100 text-emerald-700', 이동: 'bg-violet-100 text-violet-700', 출하: 'bg-rose-100 text-rose-700', 라벨: 'bg-slate-100 text-slate-600' };

export const renderLotTrace = (container, { showToast = () => {} } = {}) => {
    const initial = window.__lotTraceKey || '';
    window.__lotTraceKey = null;
    let res = null;
    let cam = null;
    const loadRecent = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
    const pushRecent = (l) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([l, ...loadRecent().filter(x => x !== l)].slice(0, 12))); } catch { /* 무시 */ } };

    container.innerHTML = `
    <section class="space-y-4">
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm p-4 sm:p-5 space-y-3">
            <div>
                <div class="text-[11px] font-black text-emerald-700 flex items-center gap-1"><i data-lucide="shield-check" class="w-3.5 h-3.5"></i>품질관리 › LOT 추적</div>
                <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="route" class="w-5 h-5 text-emerald-600"></i>LOT 추적 조회</h2>
                <p class="text-xs text-slate-500 mt-1">LOT 번호 하나로 <b>생산 · 사용한 원액·원부자재 · 품질 검사 · 이동 · 출하 거래처</b>를 한 화면에 모읍니다. 클레임·회수 대응에 쓰세요.</p>
            </div>
            <form id="lt-form" class="flex flex-wrap gap-2">
                <input id="lt-q" value="${esc(initial)}" placeholder="LOT 번호 (예: 261012, LOT-20260922-A1)" autocomplete="off" class="flex-1 min-w-[200px] bg-white text-slate-900 border border-slate-300 rounded-xl px-3 py-2.5 text-sm font-mono font-black focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                <button type="submit" class="px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-black flex items-center gap-1.5"><i data-lucide="search" class="w-4 h-4"></i>추적</button>
                <button type="button" id="lt-scan" class="px-3 py-2.5 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 rounded-xl text-sm font-bold flex items-center gap-1.5"><i data-lucide="scan-line" class="w-4 h-4"></i>QR 스캔</button>
            </form>
            <div id="lt-cam" class="hidden rounded-xl overflow-hidden bg-black max-w-sm"><div id="lt-cam-view"></div></div>
            <div id="lt-recent" class="flex flex-wrap gap-1.5 text-[11px]"></div>
        </div>
        <div id="lt-body"></div>
    </section>`;
    const $ = (s) => container.querySelector(s);

    const drawRecent = () => {
        const mine = loadRecent();
        const cand = recentLots(15).filter(x => !mine.includes(x.lot));
        $('#lt-recent').innerHTML = [
            ...mine.map(l => `<button type="button" data-lot="${esc(l)}" class="lt-chip px-2 py-1 rounded-full bg-blue-50 hover:bg-blue-100 text-blue-700 border border-blue-200 font-mono font-bold">🕘 ${esc(l)}</button>`),
            ...cand.map(x => `<button type="button" data-lot="${esc(x.lot)}" class="lt-chip px-2 py-1 rounded-full bg-slate-100 hover:bg-slate-200 text-slate-700 font-mono" title="${esc(`${x.date} ${x.name || ''}`)}">${esc(x.lot)}</button>`)
        ].join('') || '<span class="text-slate-400">최근 LOT이 없습니다.</span>';
        container.querySelectorAll('.lt-chip').forEach(b => b.addEventListener('click', () => { $('#lt-q').value = b.dataset.lot; run(); }));
    };

    const table = (head, rows, empty) => `<div class="overflow-x-auto"><table class="w-full text-xs"><thead class="bg-slate-50 text-slate-600"><tr>${head.map(h => `<th class="p-2 text-left whitespace-nowrap">${h}</th>`).join('')}</tr></thead>
        <tbody class="divide-y divide-slate-100">${rows.join('') || `<tr><td colspan="${head.length}" class="p-4 text-center text-slate-400">${empty}</td></tr>`}</tbody></table></div>`;
    const section = (title, icon, color, n, html) => `<div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2"><h3 class="text-sm font-black text-slate-800 flex items-center gap-1.5"><i data-lucide="${icon}" class="w-4 h-4 ${color}"></i>${title} <span class="text-slate-400 font-bold">${n}</span></h3>${html}</div>`;

    const draw = () => {
        const r = res;
        const shipQty = r.shipping.reduce((s, x) => s + (Number(x.qty) || 0), 0);
        const partners = [...new Set(r.shipping.map(s => s.partner).filter(Boolean))];
        const badQ = r.quality.filter(q => q.bad);
        const prodQty = r.production.reduce((m, p) => Math.max(m, Number(p.qty) || 0), 0);
        const kpi = (l, v, cls = 'text-slate-900', sub = '') => `<div class="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm"><div class="text-[11px] font-bold text-slate-500">${l}</div><div class="text-lg font-black ${cls} truncate">${v}</div>${sub ? `<div class="text-[10px] text-slate-400 truncate">${sub}</div>` : ''}</div>`;
        $('#lt-body').innerHTML = `
        <div class="space-y-4">
            <div class="flex flex-wrap items-center justify-between gap-2">
                <div class="text-sm font-black text-slate-900">LOT <span class="font-mono text-indigo-700">${esc(r.lot)}</span> ${r.mainItems.length ? `· ${esc([...new Set(r.mainItems.map(x => x.name))].join(', '))}` : ''} ${r.isRawLot ? '<span class="px-1.5 py-0.5 rounded bg-cyan-100 text-cyan-700 text-[10px]">원액 LOT</span>' : ''}</div>
                <div class="flex gap-2"><button type="button" id="lt-print" class="px-3 py-2 bg-slate-800 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"><i data-lucide="printer" class="w-4 h-4"></i>LOT 이력서 인쇄</button><button type="button" id="lt-xlsx" class="px-3 py-2 bg-emerald-600 text-white rounded-xl text-xs font-bold flex items-center gap-1.5"><i data-lucide="file-spreadsheet" class="w-4 h-4"></i>엑셀</button></div>
            </div>
            <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
                ${kpi('생산', r.production.length ? `${fmt(prodQty)}` : '기록 없음', 'text-blue-700', r.production[0] ? `${esc(r.production[0].date)} · ${r.production.length}건` : '')}
                ${kpi('투입 원부자재', `${r.usage.length + r.hiddenUsage}종`, 'text-amber-700', r.masked ? `원료 ${r.hiddenUsage}종 보안` : '')}
                ${kpi('품질 기록', `${r.quality.length}건`, badQ.length ? 'text-rose-600' : 'text-emerald-700', badQ.length ? `불합격·부적합 ${badQ.length}건` : r.quality.length ? '이상 없음' : '')}
                ${kpi('출하', `${fmt(shipQty)}`, 'text-rose-700', `${r.shipping.length}건 · 거래처 ${partners.length}곳`)}
                ${kpi('이동', `${r.moves.length}건`, 'text-violet-700', r.ibc.length ? `IBC ${r.ibc.length}개` : '')}
            </div>
            ${r.warnings.length ? `<div class="text-[11px] text-amber-700">일부 자료를 불러오지 못했습니다: ${esc(r.warnings.join(' / '))}</div>` : ''}
            ${!r.timeline.length && !r.ibc.length ? '<div class="p-8 bg-white rounded-2xl border border-slate-200 text-center text-sm text-slate-400 font-bold">이 LOT이 적힌 기록을 찾지 못했습니다. LOT 번호(일부만 넣어도 됨)를 확인하세요.</div>' : ''}
            <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
                <div class="xl:col-span-1 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                    <h3 class="text-sm font-black text-slate-800 mb-2 flex items-center gap-1.5"><i data-lucide="git-commit-vertical" class="w-4 h-4 text-indigo-600"></i>시간 순 이력</h3>
                    <ol class="relative border-l-2 border-slate-200 ml-2 space-y-2.5 max-h-[70vh] overflow-y-auto pr-1">${r.timeline.map(t => `<li class="ml-3"><span class="absolute -left-[7px] mt-1 w-3 h-3 rounded-full ${t.bad ? 'bg-rose-500' : 'bg-indigo-400'}"></span>
                        <div class="text-[10px] text-slate-400 font-mono">${esc(t.date)}</div><div class="text-xs"><span class="px-1.5 py-0.5 rounded text-[10px] font-black ${GROUP_CLS[t.group]}">${t.group}</span> <b class="${t.bad ? 'text-rose-600' : 'text-slate-800'}">${esc(t.title)}</b></div><div class="text-[11px] text-slate-500">${esc(t.sub)}</div></li>`).join('') || '<li class="ml-3 text-xs text-slate-400">없음</li>'}</ol>
                </div>
                <div class="xl:col-span-2 space-y-4">
                    ${section('생산', 'factory', 'text-blue-600', r.production.length, table(['일자', '출처', '품목', '수량', '장소', '내용'], r.production.map(p => `<tr><td class="p-2 font-mono whitespace-nowrap">${esc(p.date)}</td><td class="p-2">${esc(p.source)}</td><td class="p-2 font-bold">${esc(p.name)} <span class="text-slate-400 font-mono">${esc(p.code)}</span></td><td class="p-2 text-right font-black">${fmt(p.qty)}</td><td class="p-2">${esc(p.place || '')}</td><td class="p-2 text-slate-500">${esc(p.text || '')}${p.worker ? ` · ${esc(p.worker)}` : ''}</td></tr>`), '생산 기록이 없습니다.'))}
                    ${section('사용(투입) 원액·원부자재', 'flask-conical', 'text-amber-600', r.usage.length + r.hiddenUsage, `${r.masked ? `<div class="p-2 rounded-lg bg-slate-100 text-[11px] font-bold text-slate-600">🔒 원액 LOT의 원료 ${r.hiddenUsage}종 투입 내역은 배합 정보라 원액 작업지시서 권한자만 볼 수 있습니다.</div>` : ''}
                        ${table(['분류', '품목', '투입량', '출처', '내용'], r.usage.map(u => `<tr><td class="p-2">${esc(u.category)}</td><td class="p-2 font-bold">${esc(u.name)} <span class="text-slate-400 font-mono">${esc(u.code)}</span></td><td class="p-2 text-right font-black">${fmt(u.qty)} ${esc(u.unit)}</td><td class="p-2">${esc(u.source)}</td><td class="p-2 text-slate-500 max-w-[260px] truncate">${esc(u.text)}</td></tr>`), r.masked ? '표시할 원부자재가 없습니다.' : '투입 기록이 없습니다 (생산 입고 때 원부자재를 차감해야 남습니다).')}`)}
                    ${section('품질 기록', 'shield-check', 'text-emerald-600', r.quality.length, table(['일자', '종류', '품목', '결과', '내용'], r.quality.map(q => `<tr class="${q.bad ? 'bg-rose-50' : ''}"><td class="p-2 font-mono whitespace-nowrap">${esc(q.date)}</td><td class="p-2">${esc(q.kind)}</td><td class="p-2 font-bold">${esc(q.name)}</td><td class="p-2 font-black ${q.bad ? 'text-rose-600' : 'text-emerald-700'}">${esc(q.result)}</td><td class="p-2 text-slate-500">${esc(q.text)}</td></tr>`), '이 LOT의 검사·부적합·성적서 기록이 없습니다.'))}
                    ${section('출하', 'truck', 'text-rose-600', r.shipping.length, `${partners.length ? `<div class="text-[11px] font-bold text-rose-800">거래처: ${esc(partners.join(', '))}</div>` : ''}${table(['일자', '출처', '품목', '수량', '거래처·내용', '출발'], r.shipping.map(s => `<tr><td class="p-2 font-mono whitespace-nowrap">${esc(s.date)}</td><td class="p-2">${esc(s.source)}${s.also ? `<div class="text-[10px] text-slate-400">같은 기록: ${esc(s.also.join(', '))}</div>` : ''}</td><td class="p-2 font-bold">${esc(s.name)}</td><td class="p-2 text-right font-black">${fmt(s.qty)}</td><td class="p-2">${esc(s.partner || '')}${s.text ? ` <span class="text-slate-400">${esc(s.text)}</span>` : ''}</td><td class="p-2">${esc(s.place || '')}</td></tr>`), '출하 기록이 없습니다.')}`)}
                    ${r.moves.length ? section('이동', 'arrow-left-right', 'text-violet-600', r.moves.length, table(['일자', '품목', '수량', '경로'], r.moves.map(m => `<tr><td class="p-2 font-mono">${esc(m.date)}</td><td class="p-2 font-bold">${esc(m.name)}</td><td class="p-2 text-right">${fmt(m.qty)}</td><td class="p-2">${esc(m.from)} → ${esc(m.to)}</td></tr>`), '')) : ''}
                    ${r.ibc.length ? section('IBC (원액 토트)', 'cylinder', 'text-cyan-600', r.ibc.length, table(['토트', '원액', '위치', '충전', '남은 양', '상태'], r.ibc.map(t => `<tr><td class="p-2 font-mono">${esc(t.tote)}</td><td class="p-2 font-bold">${esc(t.name)}</td><td class="p-2">${esc(t.location || '')}</td><td class="p-2 text-right">${fmt(t.filled)}</td><td class="p-2 text-right">${fmt(t.remaining)}</td><td class="p-2">${esc(t.status)}</td></tr>`), '')) : ''}
                    ${r.labels.length ? section('라벨 발행', 'tag', 'text-slate-600', r.labels.length, table(['일자', '품목', '수량', '발행'], r.labels.map(l => `<tr><td class="p-2 font-mono">${esc(l.date)}</td><td class="p-2">${esc(l.name)}</td><td class="p-2">${esc(l.qty)}</td><td class="p-2">${esc(l.by)}</td></tr>`), '')) : ''}
                </div>
            </div>
        </div>`;
        $('#lt-print').addEventListener('click', printTrace);
        $('#lt-xlsx').addEventListener('click', exportXlsx);
        createIcons({ icons });
    };

    const run = async () => {
        const lot = $('#lt-q').value.trim();
        if (lot.length < 3) { showToast('LOT 번호를 3글자 이상 넣으세요.'); return; }
        $('#lt-body').innerHTML = '<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">기록을 모으는 중...</div>';
        try { res = await traceLotFull(lot); } catch (e) { $('#lt-body').innerHTML = `<div class="p-4 bg-rose-50 border border-rose-200 rounded-2xl text-xs font-bold text-rose-700">${esc(e.message)}</div>`; return; }
        pushRecent(lot); drawRecent(); draw();
    };

    const printTrace = () => {
        const r = res;
        const cell = 'border:1px solid #cbd5e1;padding:3px 5px;';
        const tbl = (head, rows) => `<table style="width:100%;border-collapse:collapse;font-size:10px;margin-bottom:8px"><thead style="background:#f1f5f9"><tr>${head.map(h => `<th style="${cell}">${h}</th>`).join('')}</tr></thead><tbody>${rows.map(rw => `<tr>${rw.map(c => `<td style="${cell}">${esc(String(c ?? ''))}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}" style="${cell}text-align:center;color:#94a3b8">없음</td></tr>`}</tbody></table>`;
        const w = window.open('', '_blank');
        if (!w) { showToast('⚠️ 팝업이 막혀 인쇄 창을 열지 못했습니다.'); return; }
        w.document.write(`<!doctype html><title>LOT 이력서 ${esc(r.lot)}</title><style>@page{size:A4;margin:12mm}body{font-family:'Malgun Gothic',sans-serif;color:#0f172a}h1{font-size:18px;margin:0 0 4px}h2{font-size:12px;margin:10px 0 4px;border-left:3px solid #4f46e5;padding-left:6px}</style>
            <h1>(주)대림오일 LOT 이력 추적서</h1><div style="font-size:11px;color:#475569;margin-bottom:8px">LOT <b>${esc(r.lot)}</b> · 품목 ${esc([...new Set(r.mainItems.map(x => x.name))].join(', ') || '-')} · 출력 ${new Date().toLocaleString('ko-KR')}</div>
            <h2>생산</h2>${tbl(['일자', '출처', '품목', '수량', '장소', '내용'], r.production.map(p => [p.date, p.source, p.name, fmt(p.qty), p.place, p.text]))}
            <h2>사용(투입) 원액·원부자재</h2>${r.masked ? `<div style="font-size:10px;color:#64748b">원료 ${r.hiddenUsage}종 투입 내역: 보안(원액 작업지시서 권한자만)</div>` : ''}${tbl(['분류', '품목', '투입량', '출처'], r.usage.map(u => [u.category, `${u.name} ${u.code}`, `${fmt(u.qty)} ${u.unit}`, u.source]))}
            <h2>품질 기록</h2>${tbl(['일자', '종류', '품목', '결과', '내용'], r.quality.map(q => [q.date, q.kind, q.name, q.result, q.text]))}
            <h2>출하</h2>${tbl(['일자', '출처', '품목', '수량', '거래처·내용'], r.shipping.map(s => [s.date, s.source, s.name, fmt(s.qty), `${s.partner || ''} ${s.text || ''}`]))}
            ${r.moves.length ? `<h2>이동</h2>${tbl(['일자', '품목', '수량', '경로'], r.moves.map(m => [m.date, m.name, fmt(m.qty), `${m.from} → ${m.to}`]))}` : ''}
            <script>setTimeout(()=>print(),200)<\/script>`);
        w.document.close();
    };
    const exportXlsx = () => {
        const r = res;
        const wb = XLSX.utils.book_new();
        const add = (name, rows) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows.length ? rows : [{ 내용: '없음' }]), name);
        add('시간순', r.timeline.map(t => ({ 일자: t.date, 구분: t.group, 내용: t.title, 상세: t.sub })));
        add('생산', r.production.map(p => ({ 일자: p.date, 출처: p.source, 품목코드: p.code, 품목: p.name, 수량: p.qty, 장소: p.place, 내용: p.text })));
        add('투입', r.usage.map(u => ({ 분류: u.category, 품목코드: u.code, 품목: u.name, 투입량: u.qty, 단위: u.unit, 출처: u.source })));
        add('품질', r.quality.map(q => ({ 일자: q.date, 종류: q.kind, 품목: q.name, 결과: q.result, 내용: q.text })));
        add('출하', r.shipping.map(s => ({ 일자: s.date, 출처: s.source, 품목: s.name, 수량: s.qty, 거래처: s.partner, 내용: s.text })));
        const file = `LOT추적_${r.lot.replace(/[\\/:*?"<>|]/g, '_')}_${localDateStr()}.xlsx`;
        XLSX.writeFile(wb, file);
        showToast(`📊 ${file}을 저장했습니다.`);
    };

    // QR 스캔 (LOT QR·품목 라벨 QR의 LOT)
    $('#lt-scan').addEventListener('click', async () => {
        if (cam) { try { await cam.stop(); cam.clear(); } catch { /* 무시 */ } cam = null; $('#lt-cam').classList.add('hidden'); return; }
        $('#lt-cam').classList.remove('hidden');
        try {
            const { Html5Qrcode } = await import('html5-qrcode');
            cam = new Html5Qrcode('lt-cam-view');
            const onText = async (text) => {
                try { await cam.stop(); cam.clear(); } catch { /* 무시 */ } cam = null; $('#lt-cam').classList.add('hidden');
                const f = parseFieldQr(text);
                const lotInText = String(text).match(/LOT[:\s]*([A-Za-z0-9-]{3,})/i)?.[1];
                $('#lt-q').value = f?.type === 'LOT' ? f.value : lotInText || String(text).trim();
                run();
            };
            const cfg = { fps: 10, qrbox: { width: 220, height: 220 } };
            try { await cam.start({ facingMode: 'environment' }, cfg, onText, () => {}); } catch { await cam.start({ facingMode: 'user' }, cfg, onText, () => {}); }
        } catch (e) { cam = null; $('#lt-cam').classList.add('hidden'); showToast(`⚠️ 카메라를 켜지 못했습니다: ${e.message || e}`); }
    });
    $('#lt-form').addEventListener('submit', (e) => { e.preventDefault(); run(); });
    drawRecent();
    createIcons({ icons });
    if (initial) run(); else $('#lt-body').innerHTML = '<div class="p-8 bg-white rounded-2xl border border-slate-200 text-center text-xs text-slate-400">LOT 번호를 넣거나, 위의 최근 LOT을 누르거나, 제품 라벨의 QR을 스캔하세요.</div>';
};
