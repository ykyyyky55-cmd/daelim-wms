import { state, getGimpoLogByDate, saveGimpoLog, processProductionInbound, aliasMasterOf, WORKLOG_SITES } from '../services/db.js';
import { canPerformAction } from '../services/auth.js';
import { parseFieldQr, itemCodeOfScan } from '../services/fieldQr.js';
import { localDateStr } from '../services/searchUtils.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';

// 생산업무 → 라인 스캔 집계 (탭 lineCount)
// 포장 라인에 설치한 고정식 스캐너(또는 핸디 스캐너)가 낱개 제품의 품목 QR·바코드를 읽으면 품목별로 1개씩 센다.
// 스캐너는 키보드처럼 글자 + Enter를 보내므로, 집계 중에는 입력 칸이 아닌 곳에 커서가 있어도 화면이 가로채 센다.
// 작업이 끝나면 [실적 올리기]로 ① 그날 거점 업무일지의 '1. 제품포장작업' 줄 또는 ② 제품생산/입고(재고·제품수불부 즉시 반영) 중 하나로 올린다.
// 같은 작업을 두 곳에 올리면 재고가 두 번 잡히므로 한 번에 하나만 고른다.
// 진행 중인 집계는 이 기기 localStorage(daelim_line_session)에 저장해 탭을 옮기거나 새로고침해도 이어서 센다.
const SESSION_KEY = 'daelim_line_session';
const PERBOX_KEY = 'daelim_line_perbox';   // 품목코드 → 박스 입수
const CODEMAP_KEY = 'daelim_line_codemap'; // 제품 바코드(EAN 등) → 품목코드
const LINES_KEY = 'daelim_line_names';     // 최근 쓴 LINE 이름

const load = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v ?? d; } catch { return d; } };
const store = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { } };
const fmt = (n) => (Number(n) || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const hhmm = (ms) => { const m = Math.floor(ms / 60000); return `${Math.floor(m / 60)}시간 ${m % 60}분`; };
const timeOf = (t) => new Date(t).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

const newSession = (prev = {}) => ({
    site: prev.site || 'GIMPO', line: prev.line || '자동', date: localDateStr(), lot: '', worker: prev.worker || state.currentGlobalWorker || '',
    workersCount: prev.workersCount || 3, ignoreSec: prev.ignoreSec ?? 0, workHours: '',
    running: false, startedAt: null, activeMs: 0, resumedAt: null,
    counts: {}, recent: [], unknown: {}, mode: prev.mode || 'LOG'
});

// 스캔 글자 → 품목 (바코드 연결 → 품목코드 → 약칭 순)
const itemOfScan = (raw) => {
    const map = load(CODEMAP_KEY, {});
    const code = map[raw] || itemCodeOfScan(raw);
    if (!code) return null;
    return state.master.find(m => m.code.toLowerCase() === code.toLowerCase()) || aliasMasterOf(code) || null;
};

// 업무일지 포장 줄의 카테고리: 같은 품목의 최근 일지 줄 → 품목 중분류 → 기타
const categoryOf = (m) => {
    for (const k of ['gimpoLogs', 'hqLogs']) {
        for (const log of state[k] || []) {
            const r = (log.packaging || []).find(p => String(p.item || '').startsWith(`${m.code} /`) && p.category);
            if (r) return r.category;
        }
    }
    return m.subCategory || '기타';
};

export const renderLineCounter = (container, { showToast = () => {} } = {}) => {
    let S = load(SESSION_KEY, null) || newSession();
    const save = () => store(SESSION_KEY, S);
    const canPost = canPerformAction('PRODUCTION');
    const elapsed = () => S.activeMs + (S.running && S.resumedAt ? Date.now() - S.resumedAt : 0);
    const total = () => Object.values(S.counts).reduce((a, b) => a + b, 0);
    const lines = load(LINES_KEY, ['자동', '수동1', '수동2']);

    container.innerHTML = `
    <div id="lc-root" class="max-w-[1680px] mx-auto space-y-4">
        <div class="bg-white rounded-2xl border border-slate-200 p-5 flex flex-wrap items-start justify-between gap-3">
            <div>
                <h2 class="text-xl font-black text-slate-900 flex items-center gap-2"><i data-lucide="scan-barcode" class="w-6 h-6 text-indigo-600"></i>라인 스캔 집계</h2>
                <p class="text-xs text-slate-500 mt-1">포장 라인의 고정식·핸디 스캐너로 낱개 제품의 품목 QR·바코드를 읽어 품목별로 셉니다. 끝나면 업무일지 포장 실적 또는 제품생산/입고로 올립니다.</p>
            </div>
            <div class="flex items-center gap-2">
                <span id="lc-state" class="px-3 py-1.5 rounded-full text-xs font-black"></span>
                <button type="button" id="lc-toggle" class="px-4 py-2 rounded-xl text-white text-sm font-black flex items-center gap-1.5"></button>
                <button type="button" id="lc-reset" class="px-3 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-bold">새 집계</button>
            </div>
        </div>

        <div class="grid grid-cols-2 md:grid-cols-4 xl:grid-cols-8 gap-3 bg-white rounded-2xl border border-slate-200 p-4 text-xs">
            <label class="block"><span class="font-bold text-slate-600">거점 (업무일지)</span>
                <select id="lc-site" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5">${Object.values(WORKLOG_SITES).map(s => `<option value="${s.key}">${esc(s.name)}</option>`).join('')}</select></label>
            <label class="block"><span class="font-bold text-slate-600">LINE</span>
                <input id="lc-line" list="lc-lines" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /><datalist id="lc-lines">${lines.map(l => `<option value="${esc(l)}">`).join('')}</datalist></label>
            <label class="block"><span class="font-bold text-slate-600">작업일자</span><input id="lc-date" type="date" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
            <label class="block"><span class="font-bold text-slate-600">LOT 번호</span><input id="lc-lot" placeholder="예) 260928" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-mono" /></label>
            <label class="block"><span class="font-bold text-slate-600">작업자</span><input id="lc-worker" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
            <label class="block"><span class="font-bold text-slate-600">인원</span><input id="lc-wc" type="number" min="1" step="1" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
            <label class="block"><span class="font-bold text-slate-600">작업시간(h) <span class="font-normal text-slate-400">빈칸 = 집계 시간</span></span><input id="lc-hours" type="number" min="0" step="0.1" class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
            <label class="block"><span class="font-bold text-slate-600">같은 코드 무시(초)</span><input id="lc-ignore" type="number" min="0" step="0.1" title="고정식 스캐너가 같은 제품을 두 번 읽는 경우에만. 같은 품목이 연달아 지나가면 0으로 두세요." class="mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5" /></label>
        </div>

        <div class="grid grid-cols-1 xl:grid-cols-3 gap-4">
            <div class="xl:col-span-2 space-y-4">
                <div class="bg-white rounded-2xl border border-slate-200 p-4">
                    <div class="flex flex-wrap items-end gap-4">
                        <div><div class="text-[11px] font-bold text-slate-500">총 수량</div><div id="lc-total" class="text-4xl font-black text-indigo-700 font-mono">0</div></div>
                        <div><div class="text-[11px] font-bold text-slate-500">품목</div><div id="lc-items" class="text-2xl font-black text-slate-800">0</div></div>
                        <div><div class="text-[11px] font-bold text-slate-500">집계 시간</div><div id="lc-time" class="text-2xl font-black text-slate-800">0분</div></div>
                        <div><div class="text-[11px] font-bold text-slate-500">시간당</div><div id="lc-rate" class="text-2xl font-black text-slate-800">-</div></div>
                        <div class="flex-1 min-w-[220px]"><div class="text-[11px] font-bold text-slate-500">스캔 입력 <span class="font-normal text-slate-400">(스캐너가 여기로 입력, 직접 입력 후 Enter도 됨)</span></div>
                            <input id="lc-input" autocomplete="off" class="mt-1 w-full border-2 border-indigo-300 rounded-xl px-3 py-2 text-sm font-mono font-bold" placeholder="품목 QR·바코드" /></div>
                    </div>
                    <div id="lc-last" class="mt-3 text-sm font-bold min-h-[1.5rem]"></div>
                </div>
                <div class="bg-white rounded-2xl border border-slate-200 overflow-x-auto">
                    <table class="w-full text-xs">
                        <thead class="bg-slate-50 text-slate-600 border-b border-slate-200"><tr>
                            <th class="p-2.5 text-left">품목</th><th class="p-2.5 text-left">규격</th><th class="p-2.5 text-right">수량(EA)</th>
                            <th class="p-2.5 text-right">박스 입수</th><th class="p-2.5 text-right">박스</th><th class="p-2.5 text-center">고치기</th></tr></thead>
                        <tbody id="lc-rows" class="divide-y divide-slate-100"></tbody>
                    </table>
                </div>
                <div class="bg-white rounded-2xl border border-slate-200 p-4 space-y-3 text-xs">
                    <div class="font-black text-slate-800 text-sm">실적 올리기</div>
                    <label class="flex items-start gap-2"><input type="radio" name="lc-mode" value="LOG" class="mt-0.5 accent-indigo-600" />
                        <span><b>업무일지 포장 줄</b> — 그날 거점 업무일지 '1. 제품포장작업'에 품목별 줄을 넣습니다. 월간 실적 현황판에 잡히고, 재고는 일지 화면의 수불부 반영으로 한 번만 들어갑니다.</span></label>
                    <label class="flex items-start gap-2"><input type="radio" name="lc-mode" value="INBOUND" class="mt-0.5 accent-indigo-600" />
                        <span><b>제품생산/입고</b> — 완제품 입고로 바로 처리해 창고 재고·제품수불부가 늘어납니다. 이 작업은 업무일지에 적지 마세요(재고가 두 번 잡힘). 월간 실적 현황판(업무일지 기준)에는 잡히지 않습니다.</span></label>
                    <div class="flex flex-wrap items-center gap-2">
                        <button type="button" id="lc-post" class="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-black flex items-center gap-1.5 disabled:opacity-40" ${canPost ? '' : 'disabled'}><i data-lucide="upload" class="w-4 h-4"></i>실적 올리기</button>
                        ${canPost ? '' : '<span class="text-slate-400">실적 올리기는 작업자(OPERATOR) 이상</span>'}
                    </div>
                </div>
            </div>
            <div class="space-y-4">
                <div class="bg-white rounded-2xl border border-slate-200 p-4 text-xs">
                    <div class="font-black text-slate-800 mb-2">모르는 코드 <span class="font-normal text-slate-400">— 제품 바코드를 품목에 연결하면 다음부터 셉니다</span></div>
                    <div id="lc-unknown" class="space-y-2"></div>
                    <datalist id="lc-master">${state.master.filter(m => m.category === '완제품').map(m => `<option value="${esc(m.code)}">${esc(m.name)}</option>`).join('')}</datalist>
                </div>
                <div class="bg-white rounded-2xl border border-slate-200 p-4 text-xs">
                    <div class="font-black text-slate-800 mb-2">최근 스캔</div>
                    <div id="lc-recent" class="space-y-1 font-mono max-h-[420px] overflow-y-auto"></div>
                </div>
                <div class="rounded-2xl border border-indigo-200 bg-indigo-50 p-4 text-[11px] text-indigo-900 space-y-1">
                    <div class="font-black">스캐너 설정</div>
                    <div>· 스캐너를 USB(키보드 입력)·블루투스로 이 PC·태블릿에 연결하고, 읽은 뒤 <b>Enter</b>를 보내도록 둡니다(대부분 기본값).</div>
                    <div>· 집계 중에는 이 화면이 스캔을 가로채므로 다른 칸에 커서가 있어도 셉니다(수량·입수 칸 입력 중일 때 제외).</div>
                    <div>· 같은 품목이 연달아 지나가므로 '같은 코드 무시'는 0으로 두고, 한 제품을 두 번 읽는 경우에만 0.3~1초로 올립니다.</div>
                    <div>· 위치·작업자 QR은 세지 않고, LOT QR을 찍으면 LOT 번호에 넣습니다.</div>
                </div>
            </div>
        </div>
    </div>`;
    createIcons({ icons });
    const $ = (s) => container.querySelector(s);

    const beep = (ok = true) => {
        try {
            const ctx = new (window.AudioContext || window.webkitAudioContext)();
            const osc = ctx.createOscillator(); const gain = ctx.createGain();
            osc.connect(gain); gain.connect(ctx.destination);
            osc.frequency.value = ok ? 880 : 220;
            gain.gain.setValueAtTime(0.15, ctx.currentTime);
            gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.12);
            osc.start(); osc.stop(ctx.currentTime + 0.12);
            setTimeout(() => ctx.close?.(), 300);
        } catch { }
    };

    // ---- 설정 칸 ----
    const fields = [['#lc-site', 'site'], ['#lc-line', 'line'], ['#lc-date', 'date'], ['#lc-lot', 'lot'], ['#lc-worker', 'worker'], ['#lc-wc', 'workersCount'], ['#lc-hours', 'workHours'], ['#lc-ignore', 'ignoreSec']];
    const fillFields = () => {
        fields.forEach(([sel, k]) => { $(sel).value = S[k] ?? ''; });
        container.querySelectorAll('input[name="lc-mode"]').forEach(r => { r.checked = r.value === S.mode; });
    };
    fields.forEach(([sel, k]) => $(sel).addEventListener('change', (e) => {
        S[k] = ['workersCount', 'ignoreSec'].includes(k) ? Number(e.target.value) || 0 : e.target.value.trim();
        save();
    }));
    container.querySelectorAll('input[name="lc-mode"]').forEach(r => r.addEventListener('change', () => { S.mode = r.value; save(); }));

    // ---- 화면 ----
    const renderStatus = () => {
        const st = $('#lc-state'), bt = $('#lc-toggle');
        if (S.running) {
            st.className = 'px-3 py-1.5 rounded-full text-xs font-black bg-emerald-100 text-emerald-800';
            st.textContent = '● 집계 중';
            bt.className = 'px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-white text-sm font-black flex items-center gap-1.5';
            bt.innerHTML = '⏸ 일시정지';
        } else {
            st.className = 'px-3 py-1.5 rounded-full text-xs font-black bg-slate-100 text-slate-600';
            st.textContent = S.startedAt ? '⏸ 일시정지' : '대기';
            bt.className = 'px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-black flex items-center gap-1.5';
            bt.innerHTML = S.startedAt ? '▶ 이어서 집계' : '▶ 집계 시작';
        }
    };
    const renderTime = () => {
        const ms = elapsed();
        $('#lc-time').textContent = hhmm(ms);
        const h = ms / 3600000;
        $('#lc-rate').textContent = h > 0.02 ? `${fmt(Math.round(total() / h))} EA` : '-';
    };
    const renderRows = () => {
        const perBox = load(PERBOX_KEY, {});
        const codes = Object.keys(S.counts).filter(c => S.counts[c] > 0);
        $('#lc-total').textContent = fmt(total());
        $('#lc-items').textContent = codes.length;
        $('#lc-rows').innerHTML = codes.length === 0
            ? '<tr><td colspan="6" class="p-8 text-center text-slate-400">스캔한 제품이 없습니다. [집계 시작]을 누르고 라인을 가동하세요.</td></tr>'
            : codes.map(c => {
                const m = state.master.find(x => x.code === c) || { code: c, name: c };
                const pb = Number(perBox[c]) || 0;
                const q = S.counts[c];
                return `<tr>
                    <td class="p-2.5"><div class="font-mono font-bold text-blue-600">${esc(c)}</div><div class="font-bold text-slate-900">${esc(m.name)}</div></td>
                    <td class="p-2.5 text-slate-600">${esc(m.spec || '-')}</td>
                    <td class="p-2.5 text-right"><input type="number" min="0" step="1" data-code="${esc(c)}" value="${q}" class="lc-qty w-24 text-right border border-slate-300 rounded px-1.5 py-1 font-black font-mono" /></td>
                    <td class="p-2.5 text-right"><input type="number" min="0" step="1" data-code="${esc(c)}" value="${pb || ''}" placeholder="입수" class="lc-pb w-16 text-right border border-slate-300 rounded px-1.5 py-1 font-mono" /></td>
                    <td class="p-2.5 text-right font-mono font-bold">${pb ? `${fmt(Math.floor(q / pb))}${q % pb ? `<span class="text-[10px] text-slate-400"> +${q % pb}</span>` : ''}` : '-'}</td>
                    <td class="p-2.5 text-center whitespace-nowrap"><button type="button" data-code="${esc(c)}" class="lc-minus px-2 py-1 rounded border border-slate-300 font-black">−1</button>
                        <button type="button" data-code="${esc(c)}" class="lc-del px-2 py-1 rounded border border-rose-200 text-rose-600 font-bold">삭제</button></td></tr>`;
            }).join('');
        container.querySelectorAll('.lc-qty').forEach(i => i.addEventListener('change', () => { S.counts[i.dataset.code] = Math.max(0, Math.round(Number(i.value) || 0)); save(); renderRows(); }));
        container.querySelectorAll('.lc-pb').forEach(i => i.addEventListener('change', () => { const pbm = load(PERBOX_KEY, {}); pbm[i.dataset.code] = Math.max(0, Number(i.value) || 0); store(PERBOX_KEY, pbm); renderRows(); }));
        container.querySelectorAll('.lc-minus').forEach(b => b.addEventListener('click', () => { S.counts[b.dataset.code] = Math.max(0, (S.counts[b.dataset.code] || 0) - 1); save(); renderRows(); }));
        container.querySelectorAll('.lc-del').forEach(b => b.addEventListener('click', () => {
            if (!confirm(`${b.dataset.code} 품목의 집계(${S.counts[b.dataset.code]}개)를 지울까요?`)) return;
            delete S.counts[b.dataset.code]; save(); renderRows();
        }));
        renderTime();
    };
    const renderSide = () => {
        $('#lc-recent').innerHTML = S.recent.length === 0 ? '<div class="text-slate-400 font-sans">아직 없습니다.</div>'
            : S.recent.map(r => `<div class="flex gap-2 ${r.ok ? 'text-slate-700' : 'text-rose-600'}"><span class="text-slate-400">${timeOf(r.t)}</span><span class="truncate">${esc(r.text)}</span></div>`).join('');
        const unk = Object.entries(S.unknown);
        $('#lc-unknown').innerHTML = unk.length === 0 ? '<div class="text-slate-400">없음</div>'
            : unk.map(([raw, n]) => `<div class="p-2 rounded-lg border border-rose-200 bg-rose-50 space-y-1.5">
                <div class="flex justify-between gap-2"><span class="font-mono font-bold text-rose-700 break-all">${esc(raw)}</span><span class="font-black text-rose-700 whitespace-nowrap">${n}회</span></div>
                <div class="flex gap-1"><input list="lc-master" data-raw="${esc(raw)}" placeholder="품목코드 입력·선택" class="lc-link-in flex-1 min-w-0 border border-slate-300 rounded px-1.5 py-1 font-mono bg-white" />
                    <button type="button" data-raw="${esc(raw)}" class="lc-link px-2 py-1 rounded bg-indigo-600 text-white font-bold">연결</button>
                    <button type="button" data-raw="${esc(raw)}" class="lc-unk-del px-2 py-1 rounded border border-slate-300 font-bold">무시</button></div></div>`).join('');
        container.querySelectorAll('.lc-link').forEach(b => b.addEventListener('click', () => {
            const raw = b.dataset.raw;
            const code = container.querySelector(`.lc-link-in[data-raw="${CSS.escape(raw)}"]`).value.trim();
            const m = state.master.find(x => x.code.toLowerCase() === code.toLowerCase());
            if (!m) { alert('품목마스터에 없는 품목코드입니다.'); return; }
            const map = load(CODEMAP_KEY, {}); map[raw] = m.code; store(CODEMAP_KEY, map);
            // 모르는 코드로 읽힌 횟수만큼 그 품목에 더한다
            if (confirm(`'${raw}' → [${m.code}] ${m.name} 로 연결했습니다.\n지금까지 읽힌 ${S.unknown[raw]}개를 이 품목 수량에 더할까요?`)) S.counts[m.code] = (S.counts[m.code] || 0) + S.unknown[raw];
            delete S.unknown[raw]; save(); renderRows(); renderSide();
        }));
        container.querySelectorAll('.lc-unk-del').forEach(b => b.addEventListener('click', () => { delete S.unknown[b.dataset.raw]; save(); renderSide(); }));
    };
    const pushRecent = (text, ok) => { S.recent.unshift({ t: Date.now(), text, ok }); S.recent = S.recent.slice(0, 40); };
    const setLast = (html, ok) => { $('#lc-last').innerHTML = `<span class="${ok ? 'text-emerald-700' : 'text-rose-600'}">${html}</span>`; };

    // ---- 스캔 처리 ----
    let lastRaw = '', lastAt = 0;
    const handleScan = (raw) => {
        raw = String(raw || '').trim();
        if (!raw) return;
        const q = parseFieldQr(raw);
        if (q?.type === 'LOT') { S.lot = q.value; $('#lc-lot').value = q.value; save(); beep(); setLast(`LOT 번호: ${esc(q.value)}`, true); return; }
        if (q) { beep(false); setLast('위치·전표·작업자 QR은 세지 않습니다.', false); return; }
        if (!S.running) {
            if (S.startedAt) { beep(false); setLast('⏸ 일시정지 중입니다. [이어서 집계]를 누르세요.', false); return; }
            start(); // 처음 읽으면 자동으로 집계 시작
        }
        const now = Date.now();
        if (S.ignoreSec > 0 && raw === lastRaw && now - lastAt < S.ignoreSec * 1000) return;
        lastRaw = raw; lastAt = now;
        const m = itemOfScan(raw);
        if (!m) {
            S.unknown[raw] = (S.unknown[raw] || 0) + 1;
            pushRecent(`✗ ${raw}`, false); save();
            beep(false); setLast(`❌ 모르는 코드: ${esc(raw)} (오른쪽에서 품목에 연결)`, false);
            renderSide();
            return;
        }
        S.counts[m.code] = (S.counts[m.code] || 0) + 1;
        pushRecent(`${m.code} ${m.name}`, true); save();
        beep(); setLast(`[${esc(m.code)}] ${esc(m.name)} → ${fmt(S.counts[m.code])}`, true);
        renderRows(); renderSide();
    };

    const start = () => {
        if (!S.startedAt) S.startedAt = Date.now();
        S.running = true; S.resumedAt = Date.now();
        save(); renderStatus(); $('#lc-input').focus();
    };
    const pause = () => {
        S.activeMs = elapsed(); S.running = false; S.resumedAt = null;
        save(); renderStatus(); renderTime();
    };
    $('#lc-toggle').addEventListener('click', () => (S.running ? pause() : start()));
    $('#lc-reset').addEventListener('click', () => {
        if (total() > 0 && !confirm(`집계한 ${fmt(total())}개를 지우고 새로 시작할까요?\n(아직 올리지 않았다면 먼저 [실적 올리기]를 하세요)`)) return;
        S = newSession(S); save(); fillFields(); renderStatus(); renderRows(); renderSide(); setLast('', true);
    });
    $('#lc-input').addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault(); e.stopPropagation();
        handleScan(e.target.value); e.target.value = '';
    });

    // 이 화면에서는 입력 칸 밖(버튼·빈 곳)으로 온 스캐너 글자도 가로챈다(버튼에 Enter가 가서 눌리는 것도 막음).
    // 수량·설정 칸을 고치는 중이면 그대로 둔다. 시작 전이면 첫 제품에서 자동 시작, 일시정지 중이면 안내만 한다.
    let buf = '', bufAt = 0;
    const onKey = (e) => {
        if (!document.body.contains(container) || !container.querySelector('#lc-root')) { window.removeEventListener('keydown', onKey, true); clearInterval(timer); return; }
        const t = e.target;
        if (t === $('#lc-input') || (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable))) return;
        if (e.ctrlKey || e.altKey || e.metaKey) return;
        const now = Date.now();
        if (now - bufAt > 300) buf = '';
        bufAt = now;
        if (e.key === 'Enter') { if (buf) { e.preventDefault(); e.stopPropagation(); handleScan(buf); buf = ''; } return; }
        if (e.key.length === 1) { buf += e.key; e.preventDefault(); }
    };
    window.addEventListener('keydown', onKey, true);
    const timer = setInterval(() => {
        if (!document.body.contains(container) || !container.querySelector('#lc-root')) { clearInterval(timer); window.removeEventListener('keydown', onKey, true); return; }
        if (S.running) renderTime();
    }, 5000);

    // ---- 실적 올리기 ----
    $('#lc-post').addEventListener('click', async () => {
        const codes = Object.keys(S.counts).filter(c => S.counts[c] > 0);
        if (!codes.length) { alert('올릴 집계가 없습니다.'); return; }
        if (!S.date) { alert('작업일자를 넣으세요.'); return; }
        const site = WORKLOG_SITES[S.site] || WORKLOG_SITES.GIMPO;
        const perBox = load(PERBOX_KEY, {});
        const sum = total();
        const hours = Number(S.workHours) > 0 ? Number(S.workHours) : Math.round(elapsed() / 360000) / 10;
        const wc = Number(S.workersCount) || 1;
        const summary = codes.map(c => `· [${c}] ${state.master.find(m => m.code === c)?.name || c}: ${fmt(S.counts[c])} EA`).join('\n');

        if (S.mode === 'INBOUND') {
            if (!S.lot) { alert('제품생산/입고는 LOT 번호가 필요합니다.'); $('#lc-lot').focus(); return; }
            if (!confirm(`${site.location}에 완제품 ${codes.length}품목 ${fmt(sum)} EA를 생산 입고합니다 (LOT ${S.lot}).\n${summary}\n\n창고 재고·제품수불부가 바로 늘어납니다. 이 작업은 업무일지에 적지 마세요.`)) return;
            const done = [];
            try {
                for (const c of codes) {
                    const m = state.master.find(x => x.code === c);
                    await processProductionInbound({
                        prodType: '완제품', prodItemCode: c, prodQty: S.counts[c], packaging: m?.spec || '', unit: m?.unit || 'EA',
                        lotNo: S.lot, mfgDate: S.date, location: site.location, worker: S.worker,
                        notes: `[라인 스캔 집계] LINE ${S.line || '-'} · ${S.date}`
                    });
                    done.push(c);
                    delete S.counts[c]; save();
                }
            } catch (e) {
                alert(`${done.length}품목까지 입고하고 멈췄습니다: ${e.message}\n남은 품목은 화면에 그대로 있습니다.`);
                renderRows(); return;
            }
            showToast(`🏭 ${done.length}품목 ${fmt(sum)} EA를 생산 입고했습니다.`);
        } else {
            const log = getGimpoLogByDate(S.date, S.site);
            if (log.isSyncedToLedger && !confirm(`${S.date} ${site.name} 업무일지는 이미 수불부에 반영되어, 지금 넣는 줄은 재고에 들어가지 않고 실적 현황판에만 잡힙니다.\n재고도 늘리려면 취소하고 '제품생산/입고'로 올리세요.\n\n그래도 업무일지에 넣을까요?`)) return;
            if (!confirm(`${S.date} ${site.name} 업무일지 '제품포장작업'에 ${codes.length}줄(${fmt(sum)} EA)을 넣습니다.\n${summary}\n\n작업시간 ${hours}h × ${wc}명 (품목 수량 비율로 나눔)`)) return;
            log.packaging = log.packaging || [];
            codes.forEach(c => {
                const m = state.master.find(x => x.code === c) || { code: c, name: c };
                const q = S.counts[c];
                const pb = Number(perBox[c]) || 0;
                const h = Math.round((hours * q / sum) * 100) / 100;
                const tot = Math.round(h * wc * 100) / 100;
                log.packaging.push({
                    item: `${m.code} / ${m.name}`, spec: m.spec || '', qty: q, box: pb ? Math.floor(q / pb) : 0,
                    workHours: h, workersCount: wc, totalWorkHours: tot, line: S.line || '', lotNo: S.lot || '',
                    category: categoryOf(m), manHours: Math.round((tot / 7.5) * 100) / 100, workers: S.worker || '',
                    source: 'line-scan'
                });
            });
            saveGimpoLog(log, S.site);
            showToast(`📒 ${site.name} 업무일지(${S.date})에 포장 ${codes.length}줄을 넣었습니다.`);
        }
        const ln = [S.line, ...lines.filter(l => l !== S.line)].filter(Boolean).slice(0, 10);
        store(LINES_KEY, ln);
        S = newSession(S); save(); fillFields(); renderStatus(); renderRows(); renderSide(); setLast('실적을 올렸습니다. 다음 작업은 [집계 시작]을 누르세요.', true);
    });

    fillFields(); renderStatus(); renderRows(); renderSide();
    if (S.running) $('#lc-input').focus();
};
