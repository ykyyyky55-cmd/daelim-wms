import {
    state, processStockAction, getSlipByDocNo, markSlipShipped, traceLot, SLIP_TYPES,
    rawLedgerStockSummary, latestRawSg, rawSecurityCodeOf
} from '../services/db.js';
import { parseFieldQr, splitRawQrValue, FIELD_QR_TYPES } from '../services/fieldQr.js';
import { siteOf, buildingOf, locationLabel, RAW_LEDGER_REGIONS, rawLedgerRegionOf, normalizeRawRegion, normalizeLegacyLocation } from '../services/locations.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';

// 현장 스캔 화면의 현장 QR 기능 (Scanner.js가 붙여 씀)
//  - 위치 QR: 현재 위치 지정(입출고 거점 자동 선택, 거점이동 중이면 도착 위치) + 그 위치 재고 목록
//  - 전표 QR: 출하 검수(전표 품목·수량과 스캔 대조) → 출고/이동 처리, 전표에 출고 완료 기록
//  - 원료 탱크·드럼 QR: 원료 재고(L·kg)·비중·최근 전표 + 사용/입고 바로 기록
//  - 사원증 QR: 현재 작업자 전환
//  - LOT: 생산·이동·출하 기록 추적
const EXTERNAL = '외부 거래처'; // SlipIssuer.js와 같은 값
const sameUnit = (a, b) => String(a || 'EA').toUpperCase() === String(b || 'EA').toUpperCase();
const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;

const vibrateError = () => { try { navigator.vibrate?.([220, 90, 220]); } catch { } };

// code 품목을 loc(거점 또는 '거점 / 건물')에서 qty만큼 꺼낼 재고 행 배분.
// 건물까지 지정하면 그 창고만, 거점만이면 그 거점의 모든 창고 (preferLoc → 건물 미지정 → 많은 순).
export const allocateStock = (code, loc, qty, preferLoc = '') => {
    const rows = state.inventory
        .filter(i => i.code === code && Number(i.quantity) > 0 && (buildingOf(loc) ? i.location === loc : siteOf(i.location) === loc))
        .sort((a, b) => (b.location === preferLoc) - (a.location === preferLoc)
            || (a.location === loc ? -1 : b.location === loc ? 1 : 0)
            || Number(b.quantity) - Number(a.quantity));
    let left = round3(qty);
    const parts = [];
    for (const r of rows) {
        if (left <= 0) break;
        const take = round3(Math.min(left, Number(r.quantity)));
        parts.push({ location: r.location, qty: take });
        left = round3(left - take);
    }
    return { parts, short: left > 0 ? left : 0 };
};

export const createFieldScan = (container, { showToast, onSwitchTab, playBeep, hideOtherCards, showPlaceholder, onLocationPicked }) => {
    const card = container.querySelector('#scan-field-card');
    const ctxBar = container.querySelector('#scan-context-bar');
    let ctxLoc = '';          // 위치 QR로 정한 현재 위치
    let slipCheck = null;     // 출하 검수 중인 전표
    let active = null;        // 지금 보이는 카드 종류 (LOC | SLIP | RAW | LOT)

    const show = (kind, html) => {
        active = kind;
        hideOtherCards();
        card.innerHTML = html;
        card.classList.remove('hidden');
        card.querySelector('.fs-close')?.addEventListener('click', close);
        createIcons({ icons });
    };
    const close = () => {
        active = null;
        slipCheck = null;
        card.classList.add('hidden');
        card.innerHTML = '';
        showPlaceholder();
    };
    const header = (icon, color, title, sub = '') => `
        <div class="flex items-start justify-between gap-2 border-b border-slate-100 pb-3">
            <div class="min-w-0">
                <h3 class="text-base font-black text-slate-900 flex items-center gap-2">
                    <i data-lucide="${icon}" class="w-5 h-5 ${color}"></i><span>${title}</span>
                </h3>
                ${sub ? `<p class="text-xs text-slate-500 mt-0.5">${sub}</p>` : ''}
            </div>
            <button type="button" class="fs-close text-slate-400 hover:text-slate-600 p-1 min-w-11 min-h-11 inline-flex items-center justify-center" title="닫기">
                <i data-lucide="x" class="w-5 h-5"></i>
            </button>
        </div>`;

    // ---------- 상단 현재 위치·작업자 표시줄 ----------
    const renderContextBar = () => {
        if (!ctxBar) return;
        ctxBar.innerHTML = `
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border ${ctxLoc ? 'bg-emerald-50 border-emerald-300 text-emerald-800' : 'bg-slate-50 border-slate-200 text-slate-500'} font-bold">
                    <i data-lucide="map-pin" class="w-3.5 h-3.5"></i>
                    현재 위치: ${ctxLoc ? esc(locationLabel(ctxLoc)) : '위치 QR을 스캔하세요'}
                    ${ctxLoc ? '<button type="button" id="fs-ctx-clear" class="ml-1 text-emerald-600 hover:text-rose-600" title="위치 해제">&times;</button>' : ''}
                </span>
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl border bg-blue-50 border-blue-200 text-blue-800 font-bold">
                    <i data-lucide="user-check" class="w-3.5 h-3.5"></i>
                    작업자: ${esc(state.currentGlobalWorker || '-')}
                </span>
            </div>`;
        ctxBar.querySelector('#fs-ctx-clear')?.addEventListener('click', () => {
            ctxLoc = '';
            renderContextBar();
            showToast('📍 현재 위치를 해제했습니다.');
        });
        createIcons({ icons });
    };

    // ---------- 위치 QR ----------
    const handleLocation = (rawLoc) => {
        const loc = normalizeLegacyLocation(rawLoc); // 예전에 인쇄한 위치 QR(방산공장·김포1A동 등)도 새 위치로
        const known = state.locations.includes(loc) || state.inventory.some(i => i.location === loc);
        if (!known) {
            vibrateError();
            alert(`등록되지 않은 위치입니다: "${loc}"\n(환경설정 → 마스터 기준정보에서 거점·건물을 확인하세요)`);
            return;
        }
        playBeep();
        // 품목 작업 중 '거점이동'을 골랐다면 이 위치를 도착 위치로 쓴다
        const use = onLocationPicked(loc);
        if (use === 'DEST') {
            showToast(`📍 도착 위치를 '${locationLabel(loc)}'(으)로 지정했습니다.`);
            return;
        }
        ctxLoc = loc;
        renderContextBar();
        showToast(`📍 현재 위치: ${locationLabel(loc)}`);
        if (slipCheck && active === 'SLIP') { renderSlip(); return; } // 검수 중에는 카드 유지
        if (use === 'NONE') renderLocationStock(loc);
    };

    const renderLocationStock = (loc) => {
        const rows = state.inventory
            .filter(i => Number(i.quantity) !== 0 && (buildingOf(loc) ? i.location === loc : siteOf(i.location) === loc))
            .sort((a, b) => String(a.name).localeCompare(String(b.name), 'ko'));
        // 이 창고에서 할 수 있는 일 (고르면 그 작업으로 바로)
        const acts = [
            ['IN', 'package-plus', '입고', 'bg-emerald-600'], ['OUT', 'package-minus', '출고', 'bg-rose-600'], ['USE', 'factory', '생산투입', 'bg-amber-600'], ['MOVE', 'truck', '다른 곳으로 이동', 'bg-sky-600'],
            ['SLIP_MOVE', 'file-signature', '이동전표 발행', 'bg-indigo-600'], ['SLIP_OUT', 'file-output', '출고요청서 발행', 'bg-violet-600'], ['AUDIT', 'clipboard-check', '재고실사', 'bg-slate-700'], ['IBC', 'cylinder', 'IBC(공토트)', 'bg-teal-600']
        ];
        show('LOC', `
            ${header('map-pin', 'text-emerald-600', `위치: ${esc(locationLabel(loc))}`, '이 창고에서 할 일을 고르세요. 입고·출고·생산투입·이동은 고른 뒤 품목을 스캔하면 이 위치를 기준으로 처리합니다.')}
            <div class="grid grid-cols-4 gap-2" id="fs-loc-acts">
                ${acts.map(([k, ic, label, bg]) => `<button type="button" class="fs-act flex flex-col items-center justify-center gap-1 p-2 rounded-xl ${bg} text-white text-[11px] font-black active:scale-95 min-h-[64px]" data-act="${k}"><i data-lucide="${ic}" class="w-5 h-5"></i><span class="text-center leading-tight">${label}</span></button>`).join('')}
            </div>
            <div id="fs-loc-today" class="text-xs"></div>
            <div class="text-xs font-bold text-slate-600">보관 품목 ${rows.length.toLocaleString()}건</div>
            <div class="max-h-96 overflow-y-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs">
                    <thead class="bg-slate-100 text-slate-600 sticky top-0"><tr>
                        <th class="p-2 text-left">품목코드 / 품명</th>${buildingOf(loc) ? '' : '<th class="p-2 text-left">창고</th>'}<th class="p-2 text-right">재고</th></tr></thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.length === 0 ? '<tr><td colspan="3" class="p-6 text-center text-slate-400">보관 중인 품목이 없습니다.</td></tr>' : rows.map(r => `
                        <tr class="hover:bg-slate-50 cursor-pointer fs-loc-item" data-code="${esc(r.code)}">
                            <td class="p-2"><div class="font-mono font-bold text-blue-600">${esc(r.code)}</div><div class="font-bold text-slate-800">${esc(r.name)}</div></td>
                            ${buildingOf(loc) ? '' : `<td class="p-2 text-slate-500">${esc(buildingOf(r.location) || '건물 미지정')}</td>`}
                            <td class="p-2 text-right font-black ${Number(r.quantity) < 0 ? 'text-rose-600' : 'text-slate-900'}">${fmt(r.quantity)} <span class="text-[10px] text-slate-400">${esc(r.unit || 'EA')}</span></td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`);
        card.querySelectorAll('.fs-loc-item').forEach(tr => tr.addEventListener('click', () => {
            const input = container.querySelector('#scan-manual-code');
            if (input) input.value = tr.dataset.code;
            container.querySelector('#btn-search-scanned')?.click();
        }));
        card.querySelectorAll('.fs-act').forEach(b => b.addEventListener('click', () => runLocationAction(b.dataset.act, loc)));
        renderLocationToday(loc);
    };

    // 창고 작업 실행: 입출고·투입·이동은 스캔 작업을 골라 두고 품목 스캔을 기다린다
    const runLocationAction = (act, loc) => {
        if (['IN', 'OUT', 'USE', 'MOVE'].includes(act)) {
            const radio = container.querySelector(`input[name="scan-action"][value="${act}"]`);
            if (radio) { radio.checked = true; radio.dispatchEvent(new Event('change', { bubbles: true })); }
            const input = container.querySelector('#scan-manual-code');
            input?.focus();
            input?.scrollIntoView({ block: 'center', behavior: 'smooth' });
            showToast(`📍 ${locationLabel(loc)} · ${{ IN: '입고', OUT: '출고', USE: '생산투입', MOVE: '이동' }[act]}: 품목 QR·바코드를 스캔하세요.`);
            return;
        }
        if (act === 'SLIP_MOVE') { window.__slipDraft = { type: buildingOf(loc) ? 'WAREHOUSE' : 'TRANSFER', fromLoc: loc, toLoc: '', items: [], reason: `${locationLabel(loc)} 위치 QR에서 발행` }; onSwitchTab('slipIssue'); return; }
        if (act === 'SLIP_OUT') { window.__slipDraft = { type: 'RELEASE', fromLoc: siteOf(loc), toLoc: EXTERNAL, items: [], reason: `${locationLabel(loc)} 위치 QR에서 발행` }; onSwitchTab('slipIssue'); return; }
        if (act === 'AUDIT') { window.__auditLocation = loc; onSwitchTab('audit'); return; }
        if (act === 'IBC') { onSwitchTab('ibcTotes'); }
    };

    // 오늘 이 창고의 할 일: 일일 생산계획의 출고·이동 업무 + 오늘 발행되어 아직 출고 검수 전인 전표
    const renderLocationToday = async (loc) => {
        const host = card.querySelector('#fs-loc-today');
        if (!host) return;
        const hit = (l) => !!l && (buildingOf(loc) ? l === loc : siteOf(l) === siteOf(loc));
        const today = (() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
        try {
            const [{ loadWeek, weekStart }, { listSlipsRange }] = await Promise.all([import('../services/plans.js'), import('../services/db.js')]);
            const wk = await loadWeek('PROD_WEEK', weekStart(today)).catch(() => ({}));
            const tasks = Object.entries(wk.dayTasks || {}).filter(([k]) => k.split('|')[0] === today).flatMap(([, e]) => e.tasks || [])
                .filter(t => t.slip && (hit(t.slip.from) || hit(t.slip.to)));
            const seen = new Set();
            const uniq = tasks.filter(t => { const k = t.slipNo || t.id; if (seen.has(k)) return false; seen.add(k); return true; });
            const slips = (await listSlipsRange({ from: today, to: today }).catch(() => [])).filter(s => !s.shippedAt && (hit(s.fromLoc) || hit(s.toLoc)) && !uniq.some(t => t.slipNo === s.docNo));
            if (!card.contains(host)) return;
            if (!uniq.length && !slips.length) { host.innerHTML = '<div class="p-2 rounded-lg bg-slate-50 text-slate-400">오늘 이 창고의 출고·이동 업무가 없습니다.</div>'; return; }
            host.innerHTML = `<div class="rounded-xl border border-amber-200 bg-amber-50 p-2 space-y-1">
                <div class="font-black text-amber-900">오늘 이 창고의 업무 ${uniq.length + slips.length}건</div>
                ${uniq.map(t => `<div class="flex items-center gap-2 bg-white rounded-lg px-2 py-1.5 border border-amber-100">
                    <span class="px-1.5 rounded text-[10px] font-black ${t.sec === 'shipping' ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-700'}">${t.sec === 'shipping' ? '출고' : '이동'}</span>
                    <span class="flex-1 min-w-0 truncate font-bold">${esc(t.text || '')}</span>
                    ${t.slipNo ? `<button type="button" class="fs-today-slip px-2 py-1 rounded-md bg-slate-800 text-white font-bold" data-no="${esc(t.slipNo)}">검수</button>` : '<span class="text-[10px] text-slate-400">전표 발행 전</span>'}</div>`).join('')}
                ${slips.map(s => `<div class="flex items-center gap-2 bg-white rounded-lg px-2 py-1.5 border border-amber-100">
                    <span class="px-1.5 rounded text-[10px] font-black bg-indigo-100 text-indigo-700">전표</span>
                    <span class="flex-1 min-w-0 truncate font-bold">${esc(s.docNo)} · ${esc(locationLabel(s.fromLoc))} → ${esc(slipToText(s))} · ${s.items.length}품목</span>
                    <button type="button" class="fs-today-slip px-2 py-1 rounded-md bg-slate-800 text-white font-bold" data-no="${esc(s.docNo)}">검수</button></div>`).join('')}
            </div>`;
            host.querySelectorAll('.fs-today-slip').forEach(b => b.addEventListener('click', () => handleSlip(b.dataset.no)));
        } catch (e) { host.innerHTML = ''; console.warn('[위치 QR] 오늘 업무', e.message); }
    };

    // ---------- 전표 QR: 출하 검수 ----------
    const slipAction = (s) => (!s.toLoc || s.toLoc === EXTERNAL ? 'OUT' : 'MOVE');
    const slipToText = (s) => (!s.toLoc || s.toLoc === EXTERNAL ? (s.partner || EXTERNAL) : `${locationLabel(s.toLoc)}${s.partner ? ` (${s.partner})` : ''}`);

    const handleSlip = async (docNo) => {
        let slip;
        try {
            slip = await getSlipByDocNo(docNo);
        } catch (err) {
            vibrateError();
            alert(err.message);
            return;
        }
        if (!slip) {
            vibrateError();
            alert(`전표를 찾을 수 없습니다: ${docNo}`);
            return;
        }
        playBeep();
        // 이미 출고한 전표는 그때의 검수 기록(shipCheck)을 보여준다
        const past = Array.isArray(slip.shipCheck) ? slip.shipCheck : [];
        slipCheck = {
            slip,
            rows: slip.items.map((it, i) => {
                const p = past[i] && past[i].code === it.code ? past[i] : null;
                return { ...it, scanned: p ? Number(p.scanned) || 0 : 0, lots: new Set(p?.lots || []) };
            }),
            extras: []
        };
        renderSlip();
        if (!slip.shippedAt) showToast(`📄 전표 ${slip.docNo} 검수를 시작합니다. 품목 QR을 스캔하세요.`);
    };

    const rowStatus = (r) => {
        const s = round3(r.scanned), q = round3(r.qty);
        if (s === q) return { cls: 'bg-emerald-50', badge: '<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-100 text-emerald-700">✅ 일치</span>' };
        if (s > q) return { cls: 'bg-rose-50', badge: `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-700">⚠️ ${fmt(s - q)} 초과</span>` };
        if (s > 0) return { cls: 'bg-amber-50', badge: `<span class="px-2 py-0.5 rounded-full text-[10px] font-black bg-amber-100 text-amber-800">${fmt(q - s)} 남음</span>` };
        return { cls: '', badge: '<span class="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-500">대기</span>' };
    };

    const renderSlip = () => {
        const { slip, rows, extras } = slipCheck;
        const t = SLIP_TYPES[slip.type] || SLIP_TYPES.TRANSFER;
        const action = slipAction(slip);
        const allOk = rows.length > 0 && rows.every(r => round3(r.scanned) === round3(r.qty)) && extras.length === 0;
        const doneCount = rows.filter(r => round3(r.scanned) === round3(r.qty)).length;
        const shipped = !!slip.shippedAt;
        show('SLIP', `
            ${header('clipboard-check', 'text-amber-600', `출하 검수 · <span class="font-mono">${esc(slip.docNo)}</span>`,
                `${esc(t.label)} · ${esc(slip.date)} · ${esc(locationLabel(slip.fromLoc) || '-')} → ${esc(slipToText(slip))}`)}
            ${shipped ? `
                <div class="p-3 rounded-xl bg-slate-100 border border-slate-300 text-xs font-bold text-slate-700">
                    이미 출고 처리된 전표입니다. (${esc(new Date(slip.shippedAt).toLocaleString('ko-KR'))} · ${esc(slip.shippedBy || '-')})
                </div>` : `
                <div class="flex flex-wrap items-center justify-between gap-2 p-3 rounded-xl ${allOk ? 'bg-emerald-50 border border-emerald-300' : 'bg-amber-50 border border-amber-200'} text-xs font-bold">
                    <span class="${allOk ? 'text-emerald-800' : 'text-amber-900'}">${allOk ? '✅ 모든 품목이 전표와 일치합니다.' : `검수 진행: ${doneCount} / ${rows.length} 품목 일치 — 품목 QR을 스캔하세요 (한 번에 1씩, 수량 칸에서 직접 고칠 수 있음)`}</span>
                    <span class="text-slate-500">처리: ${action === 'OUT' ? '출고(-)' : '거점이동'}</span>
                </div>`}
            <div class="overflow-x-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs">
                    <thead class="bg-slate-100 text-slate-600"><tr>
                        <th class="p-2 text-left">품목</th><th class="p-2 text-right">전표 수량</th><th class="p-2 text-center">스캔 수량</th><th class="p-2 text-center">상태</th></tr></thead>
                    <tbody class="divide-y divide-slate-100">
                        ${rows.map((r, i) => {
                            const st = rowStatus(r);
                            return `<tr class="${st.cls}">
                                <td class="p-2"><div class="font-mono font-bold text-blue-600">${esc(r.code || '-')}</div><div class="font-bold text-slate-800">${esc(r.name)}</div>
                                    ${r.lots.size ? `<div class="text-[10px] font-mono text-indigo-700">LOT: ${esc([...r.lots].join(', '))}</div>` : ''}</td>
                                <td class="p-2 text-right font-black">${fmt(r.qty)} <span class="text-[10px] text-slate-400">${esc(r.unit || 'EA')}</span></td>
                                <td class="p-2 text-center">${shipped ? fmt(r.scanned) : `
                                    <div class="inline-flex items-center border border-slate-300 rounded-lg overflow-hidden bg-white">
                                        <button type="button" class="fs-q-minus px-2 py-1 font-bold hover:bg-slate-100" data-i="${i}">-</button>
                                        <input type="number" step="any" min="0" class="fs-q-input w-16 text-center font-black border-x border-slate-300 py-1" data-i="${i}" value="${round3(r.scanned)}" />
                                        <button type="button" class="fs-q-plus px-2 py-1 font-bold hover:bg-slate-100" data-i="${i}">+</button>
                                    </div>`}</td>
                                <td class="p-2 text-center">${st.badge}</td>
                            </tr>`;
                        }).join('')}
                    </tbody>
                </table>
            </div>
            ${extras.length ? `
                <div class="p-3 rounded-xl bg-rose-50 border border-rose-300 text-xs space-y-1">
                    <div class="font-black text-rose-800">❌ 전표에 없는 품목이 스캔되었습니다 (싣지 마세요)</div>
                    ${extras.map((x, i) => `<div class="flex items-center justify-between gap-2"><span><span class="font-mono font-bold">${esc(x.code)}</span> ${esc(x.name)} × ${x.count}</span>
                        <button type="button" class="fs-extra-del text-rose-700 font-bold underline" data-i="${i}">목록에서 지우기</button></div>`).join('')}
                </div>` : ''}
            ${shipped ? '' : `
                <button type="button" id="fs-slip-ship" class="w-full py-3 ${allOk ? 'bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700' : 'bg-slate-400 hover:bg-slate-500'} text-white font-black rounded-xl text-sm transition shadow-md flex items-center justify-center gap-2">
                    <i data-lucide="truck" class="w-4 h-4"></i>
                    <span>${allOk ? '검수 완료 → ' : ''}${action === 'OUT' ? '출고 처리' : '거점이동 처리'} (재고 반영 + 전표 출고 완료)</span>
                </button>`}`);

        const setQty = (i, v) => { rows[i].scanned = Math.max(0, round3(v)); renderSlip(); };
        card.querySelectorAll('.fs-q-minus').forEach(b => b.addEventListener('click', () => setQty(+b.dataset.i, rows[+b.dataset.i].scanned - 1)));
        card.querySelectorAll('.fs-q-plus').forEach(b => b.addEventListener('click', () => setQty(+b.dataset.i, rows[+b.dataset.i].scanned + 1)));
        card.querySelectorAll('.fs-q-input').forEach(inp => inp.addEventListener('change', () => setQty(+inp.dataset.i, Number(inp.value) || 0)));
        card.querySelectorAll('.fs-extra-del').forEach(b => b.addEventListener('click', () => { extras.splice(+b.dataset.i, 1); renderSlip(); }));
        card.querySelector('#fs-slip-ship')?.addEventListener('click', shipSlip);
    };

    // 검수 중 품목 스캔 → 전표 줄에 +1 (전표에 없으면 경고)
    const onItemScanned = (item, lot) => {
        if (!slipCheck || active !== 'SLIP' || slipCheck.slip.shippedAt) return false;
        const { rows, extras } = slipCheck;
        const row = rows.find(r => r.code === item.code && round3(r.scanned) < round3(r.qty)) || rows.find(r => r.code === item.code);
        if (!row) {
            vibrateError();
            const x = extras.find(e => e.code === item.code);
            if (x) x.count++;
            else extras.push({ code: item.code, name: item.name, count: 1 });
            showToast(`❌ [${item.code}] ${item.name} — 이 전표에 없는 품목입니다!`);
            renderSlip();
            return true;
        }
        row.scanned = round3(row.scanned + 1);
        if (lot) row.lots.add(lot);
        if (round3(row.scanned) > round3(row.qty)) {
            vibrateError();
            showToast(`⚠️ [${item.code}] 전표 수량(${fmt(row.qty)})을 넘었습니다.`);
        } else {
            playBeep();
            showToast(round3(row.scanned) === round3(row.qty) ? `✅ [${item.code}] ${fmt(row.qty)} ${row.unit} 일치` : `[${item.code}] ${fmt(row.scanned)} / ${fmt(row.qty)}`);
        }
        renderSlip();
        return true;
    };

    const shipSlip = async () => {
        const { slip, rows, extras } = slipCheck;
        const action = slipAction(slip);
        const diffs = rows.filter(r => round3(r.scanned) !== round3(r.qty));
        if (extras.length) { alert('전표에 없는 품목이 스캔되어 있습니다. 확인 후 목록에서 지운 다음 처리하세요.'); return; }
        if (rows.every(r => round3(r.scanned) === 0)) { alert('스캔한 품목이 없습니다.'); return; }
        const msg = diffs.length
            ? `전표와 수량이 다른 품목이 ${diffs.length}건 있습니다:\n${diffs.map(r => `· ${r.name}: 전표 ${fmt(r.qty)} / 스캔 ${fmt(r.scanned)}`).join('\n')}\n\n스캔한 수량대로 처리할까요?`
            : `전표 ${slip.docNo}를 ${action === 'OUT' ? '출고' : '거점이동'} 처리할까요?`;
        if (!confirm(msg)) return;
        if (!slip.fromLoc || slip.fromLoc === EXTERNAL) { alert('전표에 출발 거점이 없어 재고를 반영할 수 없습니다.'); return; }

        const btn = card.querySelector('#fs-slip-ship');
        if (btn) { btn.disabled = true; btn.textContent = '처리 중...'; }
        const check = rows.map(r => ({ code: r.code, name: r.name, unit: r.unit, qty: r.qty, scanned: round3(r.scanned), lots: [...r.lots] }));
        let claimed;
        try {
            claimed = await markSlipShipped(slip.docNo, check); // 두 번 출고 방지: 재고보다 먼저 잡는다
        } catch (err) {
            alert(err.message);
            renderSlip();
            return;
        }
        if (!claimed) {
            alert('이미 출고 처리된 전표입니다. (다른 기기에서 먼저 처리했을 수 있습니다)');
            slipCheck.slip = (await getSlipByDocNo(slip.docNo).catch(() => null)) || { ...slip, shippedAt: new Date().toISOString() };
            renderSlip();
            return;
        }

        const results = [];
        for (const r of rows) {
            const qty = round3(r.scanned);
            if (!(qty > 0)) continue;
            const m = state.master.find(x => x.code === r.code);
            if (!m) { results.push(`❌ ${r.name}: 품목 마스터에 없는 코드라 재고를 바꾸지 않았습니다.`); continue; }
            if (!sameUnit(r.unit, m.unit)) { results.push(`⚠️ ${r.name}: 전표 단위(${r.unit})가 재고 단위(${m.unit || 'EA'})와 달라 재고를 바꾸지 않았습니다. 입출고 화면에서 직접 처리하세요.`); continue; }
            const { parts, short } = allocateStock(r.code, slip.fromLoc, qty, ctxLoc);
            if (short > 0) { results.push(`❌ ${r.name}: ${locationLabel(slip.fromLoc)} 재고가 ${fmt(short)} ${r.unit} 부족해 처리하지 않았습니다.`); continue; }
            const reason = `[출하검수 ${slip.docNo}] ${slipToText(slip)}${r.lots.size ? ` LOT: ${[...r.lots].join(', ')}` : ''}`;
            try {
                for (const p of parts) {
                    await processStockAction(action === 'OUT'
                        ? { type: 'OUT', code: r.code, qty: p.qty, location: p.location, fromLoc: p.location, toLoc: p.location, reason, partner: slip.partner || '' }
                        : { type: 'MOVE', code: r.code, qty: p.qty, location: p.location, fromLoc: p.location, toLoc: slip.toLoc, reason, partner: slip.partner || '' });
                }
                results.push(`✅ ${r.name}: ${fmt(qty)} ${r.unit}`);
            } catch (err) {
                results.push(`❌ ${r.name}: ${err.message}`);
            }
        }
        slipCheck.slip = { ...slip, shippedAt: new Date().toISOString(), shippedBy: state.currentGlobalWorker, shipCheck: check };
        renderSlip();
        const failed = results.filter(x => !x.startsWith('✅'));
        playBeep();
        if (failed.length) alert(`전표 ${slip.docNo}는 출고 완료로 기록했지만, 일부 품목은 재고에 반영하지 못했습니다:\n\n${results.join('\n')}`);
        else showToast(`🚚 전표 ${slip.docNo} ${action === 'OUT' ? '출고' : '이동'} 처리 완료 (${results.length}품목)`);
    };

    // ---------- 원료 탱크·드럼 QR ----------
    const handleRaw = (value) => {
        const { key, region: rawRegion } = splitRawQrValue(value);
        const region = rawRegion ? normalizeRawRegion(rawRegion) : rawLedgerRegionOf(ctxLoc || ''); // 예전 QR의 '방산'·'김포2'도 본사·김포로
        const item = state.master.find(m => m.code === key);
        const name = item?.name || state.rawLedger.find(r => r.code === key || r.name === key)?.name || key;
        const code = item?.code || state.rawLedger.find(r => r.code === key || r.name === key)?.code || '';
        if (!item && !state.rawLedger.some(r => r.name === name)) {
            vibrateError();
            alert(`원료를 찾을 수 없습니다: "${key}"`);
            return;
        }
        playBeep();
        renderRaw({ code, name, region });
    };

    const renderRaw = ({ code, name, region }) => {
        const regionInfo = RAW_LEDGER_REGIONS.find(r => r.value === region);
        const site = regionInfo?.site || region;
        const sum = rawLedgerStockSummary('region', region).find(r => r.name === name);
        const stock = sum ? sum.stockQty : 0;
        const sg = latestRawSg(code, name);
        const rawCode = rawSecurityCodeOf(code, name);
        const recent = state.rawLedger.filter(e => e.name === name && rawLedgerRegionOf(e.location) === region)
            .slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 6);
        const item = state.master.find(m => m.code === code);
        const canWrite = !!item;
        show('RAW', `
            ${header('cylinder', 'text-sky-600', `원료 탱크·드럼 · ${esc(name)}`, `${esc(regionInfo?.label || region)}${code ? ` · 품목코드 ${esc(code)}` : ''}${rawCode ? ` · 🔒 원료코드 ${esc(rawCode)}` : ''}`)}
            <div class="grid grid-cols-3 gap-2 text-center">
                <div class="p-3 rounded-xl bg-sky-50 border border-sky-200"><div class="text-[11px] font-bold text-slate-500">현재고 (L)</div><div class="text-xl font-black text-sky-700">${fmt(stock)}</div></div>
                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200"><div class="text-[11px] font-bold text-slate-500">중량 (kg)</div><div class="text-xl font-black text-slate-800">${fmt(round3(stock * sg))}</div></div>
                <div class="p-3 rounded-xl bg-slate-50 border border-slate-200"><div class="text-[11px] font-bold text-slate-500">최신 비중</div><div class="text-xl font-black text-slate-800">${fmt(sg)}</div></div>
            </div>
            <div>
                <div class="text-xs font-bold text-slate-600 mb-1">최근 수불 전표</div>
                <div class="border border-slate-200 rounded-xl overflow-hidden">
                    <table class="w-full text-xs"><thead class="bg-slate-100 text-slate-600"><tr><th class="p-1.5 text-left">일자</th><th class="p-1.5 text-left">구분</th><th class="p-1.5 text-right">입고</th><th class="p-1.5 text-right">사용·출고</th><th class="p-1.5 text-right">재고</th></tr></thead>
                    <tbody class="divide-y divide-slate-100">${recent.length === 0 ? '<tr><td colspan="5" class="p-3 text-center text-slate-400">전표가 없습니다.</td></tr>' : recent.map(e => `
                        <tr><td class="p-1.5">${esc(e.date)}</td><td class="p-1.5">${esc(e.type)}</td><td class="p-1.5 text-right text-blue-700">${e.inQty ? fmt(e.inQty) : ''}</td>
                            <td class="p-1.5 text-right text-rose-600">${e.outQty ? fmt(e.outQty) : ''}</td><td class="p-1.5 text-right font-bold">${fmt(e.stockQty)}</td></tr>`).join('')}</tbody></table>
                </div>
            </div>
            ${canWrite ? `
                <form id="fs-raw-form" class="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                    <label class="block"><span class="font-bold text-slate-600">작업</span>
                        <select id="fs-raw-type" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold bg-white">
                            <option value="USE">사용 (생산투입 -)</option><option value="IN">입고 (+)</option></select></label>
                    <label class="block"><span class="font-bold text-slate-600">수량 (${esc(item.unit || 'L')})</span>
                        <input type="number" id="fs-raw-qty" min="0" step="any" required class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-black text-right bg-white" /></label>
                    <label class="block col-span-2 sm:col-span-1"><span class="font-bold text-slate-600">비고</span>
                        <input type="text" id="fs-raw-reason" placeholder="예: 블렌딩 투입" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-white" /></label>
                    <button type="submit" class="col-span-2 sm:col-span-1 py-2 bg-sky-600 hover:bg-sky-700 text-white rounded-lg font-black">기록</button>
                    <p class="col-span-2 sm:col-span-4 text-[11px] text-slate-500">${esc(site)} 재고와 원료수불부에 함께 기록됩니다.</p>
                </form>` : `
                <div class="p-3 rounded-xl bg-amber-50 border border-amber-200 text-xs text-amber-900 font-bold flex items-center justify-between gap-2">
                    <span>품목코드가 없는 원료라 여기서 기록할 수 없습니다.</span>
                    <button type="button" id="fs-raw-open-ledger" class="px-2.5 py-1 bg-white border border-amber-300 rounded-lg">원료수불부 열기</button>
                </div>`}`);
        card.querySelector('#fs-raw-open-ledger')?.addEventListener('click', () => onSwitchTab('rawLedger'));
        card.querySelector('#fs-raw-form')?.addEventListener('submit', async (e) => {
            e.preventDefault();
            const type = card.querySelector('#fs-raw-type').value;
            const qty = Number(card.querySelector('#fs-raw-qty').value);
            const note = card.querySelector('#fs-raw-reason').value.trim();
            if (!(qty > 0)) { alert('수량을 입력하세요.'); return; }
            const reason = `[탱크 QR] ${note || (type === 'USE' ? '원료 사용' : '원료 입고')}`;
            try {
                if (type === 'IN') {
                    const loc = ctxLoc && siteOf(ctxLoc) === site ? ctxLoc : site;
                    await processStockAction({ type: 'IN', code, qty, location: loc, fromLoc: loc, toLoc: loc, reason });
                } else {
                    const { parts, short } = allocateStock(code, site, qty, ctxLoc);
                    if (short > 0) throw new Error(`${site} 재고가 ${fmt(short)} 부족합니다.`);
                    for (const p of parts) await processStockAction({ type: 'USE', code, qty: p.qty, location: p.location, fromLoc: p.location, toLoc: p.location, reason });
                }
                playBeep();
                showToast(`✅ ${name} ${type === 'USE' ? '사용' : '입고'} ${fmt(qty)} 기록 완료`);
                renderRaw({ code, name, region });
            } catch (err) {
                alert(err.message || '기록 실패');
            }
        });
    };

    // ---------- 사원증 QR ----------
    const handleWorker = (value) => {
        const w = (state.workers || []).find(x => String(x.id) === value) || (state.workers || []).find(x => x.name === value);
        if (!w) {
            vibrateError();
            alert(`등록되지 않은 작업자입니다: "${value}"\n(환경설정의 작업자 명단을 확인하세요)`);
            return;
        }
        playBeep();
        state.currentGlobalWorker = `${w.name} (${w.role || w.dept || '작업자'})`;
        const sel = document.getElementById('global-worker-select');
        if (sel) sel.value = w.name;
        renderContextBar();
        showToast(`👤 현재 작업자가 '${w.name}'(으)로 바뀌었습니다. 이후 작업 기록에 이 이름이 남습니다.`);
    };

    // ---------- LOT 추적 ----------
    const showLotTrace = async (lot) => {
        show('LOT', `${header('route', 'text-indigo-600', `LOT 추적 · <span class="font-mono">${esc(lot)}</span>`)}<div class="p-6 text-center text-xs text-slate-400">기록을 찾는 중...</div>`);
        let res;
        try {
            res = await traceLot(lot);
        } catch (err) {
            card.querySelector('.p-6').textContent = err.message;
            return;
        }
        if (active !== 'LOT') return;
        const { events, shipped } = res;
        const prod = events.filter(e => e.type === 'PROD' || /생산 입고|생산입고|생산 완료/.test(e.text) && e.type === 'IN');
        const kindCls = (e) => (e.type === 'OUT' ? 'bg-rose-100 text-rose-700' : e.type === 'IN' || e.type === 'PROD' ? 'bg-blue-100 text-blue-700' : e.type === 'MOVE' ? 'bg-purple-100 text-purple-700' : 'bg-slate-100 text-slate-600');
        show('LOT', `
            ${header('route', 'text-indigo-600', `LOT 추적 · <span class="font-mono">${esc(lot)}</span>`, '이력 사유·수불부 비고·생산 실적에 이 LOT이 적힌 기록을 모았습니다.')}
            <button type="button" id="fs-lot-full" data-lot="${esc(lot)}" class="w-full py-2 rounded-xl bg-indigo-600 text-white text-xs font-black">🔎 품질·출하 거래처까지 전체 보기 (LOT 추적 화면)</button>
            <div class="grid grid-cols-3 gap-2 text-center text-xs">
                <div class="p-2.5 rounded-xl bg-slate-50 border border-slate-200"><div class="font-bold text-slate-500">전체 기록</div><div class="text-lg font-black">${events.length}</div></div>
                <div class="p-2.5 rounded-xl bg-blue-50 border border-blue-200"><div class="font-bold text-slate-500">생산·입고</div><div class="text-lg font-black text-blue-700">${prod.length}</div></div>
                <div class="p-2.5 rounded-xl bg-rose-50 border border-rose-200"><div class="font-bold text-slate-500">출고(출하)</div><div class="text-lg font-black text-rose-700">${shipped.length}</div></div>
            </div>
            ${shipped.length ? `<div class="p-3 rounded-xl bg-rose-50 border border-rose-200 text-xs">
                <div class="font-black text-rose-800 mb-1">출하 내역</div>
                ${shipped.map(e => `<div>· ${esc(e.date)} ${esc(e.name || e.code)} ${fmt(e.qty)} — ${esc(e.text)}</div>`).join('')}
            </div>` : ''}
            <div class="max-h-96 overflow-y-auto border border-slate-200 rounded-xl">
                <table class="w-full text-xs">
                    <thead class="bg-slate-100 text-slate-600 sticky top-0"><tr><th class="p-2 text-left">일자</th><th class="p-2 text-left">구분</th><th class="p-2 text-left">품목</th><th class="p-2 text-right">수량</th><th class="p-2 text-left">위치 / 내용</th></tr></thead>
                    <tbody class="divide-y divide-slate-100">
                        ${events.length === 0 ? '<tr><td colspan="5" class="p-6 text-center text-slate-400">이 LOT이 적힌 기록이 없습니다.</td></tr>' : events.map(e => `
                        <tr>
                            <td class="p-2 whitespace-nowrap">${esc(e.date)}</td>
                            <td class="p-2"><span class="px-1.5 py-0.5 rounded text-[10px] font-bold ${kindCls(e)}">${esc(e.kind)}</span></td>
                            <td class="p-2"><div class="font-mono text-blue-600">${esc(e.code)}</div><div class="font-bold">${esc(e.name)}</div></td>
                            <td class="p-2 text-right font-black">${fmt(e.qty)}</td>
                            <td class="p-2 text-slate-600">${e.from || e.to ? `<div>${esc(e.from || '-')}${e.to && e.to !== '-' ? ` → ${esc(e.to)}` : ''}</div>` : ''}<div class="text-[11px] text-slate-500">${esc(e.text)}${e.worker ? ` · ${esc(e.worker)}` : ''}</div></td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>`);
        // 품질·출하 거래처까지 보는 LOT 추적 화면 (components/LotTrace.js)
        document.getElementById('fs-lot-full')?.addEventListener('click', () => { window.__lotTraceKey = lot; onSwitchTab('lotTrace'); });
    };

    // 스캔한 글자가 현장 QR이면 처리하고 true
    const handle = (text) => {
        const q = parseFieldQr(text);
        if (!q) return false;
        if (q.type === 'LOC') handleLocation(q.value);
        else if (q.type === 'SLIP') handleSlip(q.value);
        else if (q.type === 'RAW') handleRaw(q.value);
        else if (q.type === 'WKR') handleWorker(q.value);
        else if (q.type === 'LOT') { playBeep(); showLotTrace(q.value); }
        return true;
    };

    // 다른 카드(품목·작업지시서)를 보일 때 숨김
    const hide = () => {
        card.classList.add('hidden');
        slipCheck = null;
        active = null;
    };

    renderContextBar();
    return { handle, onItemScanned, showLotTrace, hide, renderContextBar, ctxLocation: () => ctxLoc, typeLabel: (t) => FIELD_QR_TYPES[t] };
};
