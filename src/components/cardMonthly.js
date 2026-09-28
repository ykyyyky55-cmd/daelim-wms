import { state } from '../services/db.js';
import { listCardSlips, scanPhotoUrls } from '../services/scanSlips.js';
import { saveDocument, isCloudFiles } from '../services/fileStore.js';
import { getApproval, signDoc, canSign } from '../services/approvals.js';
import { fillAssigneeSelect, readAssignee, assignTasks } from '../services/assign.js';
import { canPerformAction } from '../services/auth.js';
import { summaryCanvas, canvasesToFiles, createSharer, shareStamp } from '../services/scanShare.js';
import { localDateStr } from '../services/searchUtils.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { mountApprovalBox, approvalPrintHtml } from './approval/ApprovalBox.js';
import { openPrintWindow } from './slipPrint.js';

// ==========================================
// 전표관리 → 카드전표 탭 위: 월별 카드사용내역
//   카드전표(전표 스캔 등록 종류 CARD)를 달·일자별로 모아 금액·카드별 합계를 내고,
//   결재(doc_key CARD:<YYYY-MM>)를 받아 내역서 인쇄 / 제출용 PDF(내역표 + 영수증 한 장씩) / 엑셀 / 파일 저장소 제출을 한다.
// ==========================================

export const CARD_APPR_ROLES = ['담당', '팀장', '대표'];
const MONTH_KEY = 'daelim_card_month';
const won = (n) => `${(Number(n) || 0).toLocaleString('ko-KR')}원`;
const dow = (d) => '일월화수목금토'[new Date(`${d}T00:00:00`).getDay()] || '';
const ymOf = (d = new Date()) => localDateStr(d).slice(0, 7);
const shiftYm = (ym, k) => { const [y, m] = ym.split('-').map(Number); return ymOf(new Date(y, m - 1 + k, 1)); };
const ymText = (ym) => `${ym.slice(0, 4)}년 ${Number(ym.slice(5))}월`;
const itemsText = (r) => (r.items || []).map(it => `${it.name || it.code} ${it.qty}${it.unit}`).join(', ');

// 이미지 주소 → 그림 (서명 URL은 CORS 허용이라 캔버스에 그릴 수 있다)
const loadImg = (url) => new Promise((res) => {
    if (!url) { res(null); return; }
    const im = new Image();
    im.crossOrigin = 'anonymous';
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = url;
});

/**
 * @param host  붙일 곳
 * @param opts  { showToast, onEdit(rec) → 수정 창, onChanged() }
 * @returns { reload(), destroy() }
 */
export const mountCardMonthly = (host, { showToast = () => {}, onEdit = () => {} } = {}) => {
    let ym = (() => { try { return localStorage.getItem(MONTH_KEY) || ymOf(); } catch { return ymOf(); } })();
    if (window.__cardMonthOpen) { ym = window.__cardMonthOpen; window.__cardMonthOpen = null; }
    let recs = [];
    let urls = new Map();
    let loading = false;
    let error = '';
    let appr = null;
    const $ = (s) => host.querySelector(s);

    host.innerHTML = `
    <div class="border border-violet-200 bg-violet-50/60 rounded-2xl p-3 space-y-3">
        <div class="flex flex-wrap items-center gap-2">
            <div class="font-black text-violet-900 text-sm flex items-center gap-1"><i data-lucide="credit-card" class="w-4 h-4"></i>월별 카드사용내역</div>
            <span class="flex items-center gap-1">
                <button type="button" id="cm-prev" class="px-2 py-1 bg-white border border-slate-300 rounded-lg font-black">◀</button>
                <input type="month" id="cm-month" class="border border-slate-300 rounded-lg px-2 py-1 font-bold bg-white" />
                <button type="button" id="cm-next" class="px-2 py-1 bg-white border border-slate-300 rounded-lg font-black">▶</button>
            </span>
            <span class="ml-auto flex flex-wrap gap-1.5">
                <button type="button" id="cm-request" class="px-2.5 py-1.5 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-black flex items-center gap-1 disabled:opacity-40"><i data-lucide="stamp" class="w-3.5 h-3.5"></i>결재 올리기</button>
                <button type="button" id="cm-print" class="px-2.5 py-1.5 bg-slate-800 text-white rounded-lg font-bold flex items-center gap-1 disabled:opacity-40"><i data-lucide="printer" class="w-3.5 h-3.5"></i>내역서 인쇄</button>
                <button type="button" id="cm-pdf" class="px-2.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-bold flex items-center gap-1 disabled:opacity-40"><i data-lucide="download" class="w-3.5 h-3.5"></i>제출용 PDF</button>
                <button type="button" id="cm-share" class="px-2.5 py-1.5 bg-violet-600 hover:bg-violet-700 text-white rounded-lg font-bold flex items-center gap-1 disabled:opacity-40"><i data-lucide="share-2" class="w-3.5 h-3.5"></i>공유</button>
                <button type="button" id="cm-submit" class="px-2.5 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-bold flex items-center gap-1 disabled:opacity-40"><i data-lucide="send" class="w-3.5 h-3.5"></i>파일 저장소에 제출</button>
                <button type="button" id="cm-excel" class="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg font-bold flex items-center gap-1 disabled:opacity-40"><i data-lucide="file-spreadsheet" class="w-3.5 h-3.5"></i>엑셀</button>
            </span>
        </div>
        <div class="flex flex-wrap items-start gap-3">
            <div class="flex-1 min-w-[260px] space-y-1.5">
                <div id="cm-kpi" class="flex flex-wrap gap-1.5"></div>
                <div id="cm-appr-status" class="text-[11px] font-bold"></div>
            </div>
            <div id="cm-appr"></div>
        </div>
        <div id="cm-body"></div>
    </div>`;

    const total = () => recs.reduce((a, r) => a + (Number(r.amount) || 0), 0);
    const byCard = () => {
        const m = new Map();
        recs.forEach(r => m.set(r.card || '(카드 미기재)', (m.get(r.card || '(카드 미기재)') || 0) + (Number(r.amount) || 0)));
        return [...m];
    };

    const render = () => {
        $('#cm-month').value = ym;
        const has = recs.length > 0;
        ['#cm-print', '#cm-pdf', '#cm-share', '#cm-excel'].forEach(s => { $(s).disabled = !has || loading; });
        $('#cm-submit').disabled = !has || loading || !canPerformAction('WRITE_STOCK');
        $('#cm-request').disabled = !has || loading || !canSign();
        const noPhoto = recs.filter(r => !r.files?.length).length;
        const noAmount = recs.filter(r => !(Number(r.amount) > 0)).length;
        const chip = (t, cls) => `<span class="px-2 py-1 rounded-lg font-bold ${cls}">${t}</span>`;
        $('#cm-kpi').innerHTML = loading ? '' : chip(`${ymText(ym)} · ${recs.length}건`, 'bg-white text-slate-700 border border-slate-200')
            + chip(`합계 <b>${won(total())}</b>`, 'bg-violet-600 text-white')
            + byCard().map(([c, v]) => chip(`${esc(c)} <b>${won(v)}</b>`, 'bg-violet-100 text-violet-800')).join('')
            + (noPhoto ? chip(`⚠️ 영수증 사진 없음 ${noPhoto}건`, 'bg-amber-100 text-amber-800') : '')
            + (noAmount ? chip(`⚠️ 금액 없음 ${noAmount}건`, 'bg-rose-100 text-rose-700') : '');
        const body = $('#cm-body');
        if (loading) { body.innerHTML = '<div class="p-6 text-center text-slate-400 font-bold">불러오는 중…</div>'; return; }
        if (error) { body.innerHTML = `<div class="p-4 text-center text-rose-600 font-bold">${esc(error)}</div>`; return; }
        if (!has) { body.innerHTML = `<div class="p-6 text-center text-slate-400 font-bold">${ymText(ym)} 카드전표가 없습니다. 전표 스캔 등록에서 종류 '카드사용'으로 영수증을 올리세요.</div>`; return; }
        // 일자별 묶음
        const days = [...new Set(recs.map(r => r.date))];
        body.innerHTML = `<div class="overflow-x-auto border border-slate-200 rounded-xl bg-white"><table class="w-full min-w-[820px]">
            <thead class="bg-slate-50 text-slate-600 font-bold"><tr><th class="p-2 text-left w-20">영수증</th><th class="p-2 text-left">번호</th><th class="p-2 text-left">사용처</th><th class="p-2 text-left">카드</th><th class="p-2 text-left">용도</th><th class="p-2 text-left">품목</th><th class="p-2 text-right">금액</th><th class="p-2 w-14"></th></tr></thead>
            <tbody>${days.map(d => {
                const list = recs.filter(r => r.date === d);
                const sum = list.reduce((a, r) => a + (Number(r.amount) || 0), 0);
                return `<tr class="bg-violet-50"><td colspan="6" class="p-1.5 px-2 font-black text-violet-900">${esc(d)} (${dow(d)}) · ${list.length}건</td><td class="p-1.5 px-2 text-right font-black text-violet-900">${won(sum)}</td><td></td></tr>
                ${list.map(r => `<tr class="border-t border-slate-100" data-id="${esc(r.id)}">
                    <td class="p-1.5">${urls.get(r.id) ? `<button type="button" class="cm-img block"><img src="${esc(urls.get(r.id))}" class="w-16 h-16 object-cover rounded border border-slate-200" alt="영수증" /></button>` : '<span class="text-[10px] text-amber-700 font-bold">사진 없음</span>'}</td>
                    <td class="p-2 font-mono font-bold whitespace-nowrap">${esc(r.regNo)}${r.docNo ? `<div class="text-[10px] font-normal text-slate-500">No.${esc(r.docNo)}</div>` : ''}</td>
                    <td class="p-2 font-bold">${esc(r.partner || '-')}</td>
                    <td class="p-2">${esc(r.card || '-')}</td>
                    <td class="p-2">${esc(r.purpose || '-')}</td>
                    <td class="p-2 text-slate-600 max-w-[220px] truncate" title="${esc(itemsText(r))}">${esc(itemsText(r) || (r.action === 'NONE' ? '(재고 없음)' : '-'))}</td>
                    <td class="p-2 text-right font-black ${Number(r.amount) > 0 ? '' : 'text-rose-600'}">${won(r.amount)}</td>
                    <td class="p-2 text-right"><button type="button" class="cm-edit whitespace-nowrap px-2 py-1 bg-white border border-indigo-300 text-indigo-700 rounded font-bold">수정</button></td>
                </tr>`).join('')}`;
            }).join('')}</tbody>
            <tfoot><tr class="bg-slate-100 font-black"><td colspan="6" class="p-2 text-right">${ymText(ym)} 합계 (${recs.length}건)</td><td class="p-2 text-right">${won(total())}</td><td></td></tr></tfoot>
        </table></div>`;
        const recOf = (el) => recs.find(r => r.id === el.closest('tr[data-id]').dataset.id);
        body.querySelectorAll('.cm-img').forEach(b => b.addEventListener('click', () => window.open(urls.get(recOf(b).id), '_blank')));
        body.querySelectorAll('.cm-edit').forEach(b => b.addEventListener('click', () => onEdit(recOf(b))));
        sharer.schedule();
    };

    const load = async () => {
        loading = true;
        error = '';
        render();
        try {
            recs = await listCardSlips(ym);
            urls = await scanPhotoUrls(recs).catch(() => new Map());
        } catch (e) {
            error = e.message;
            recs = [];
        }
        loading = false;
        appr = mountApprovalBox($('#cm-appr'), apprDoc(), { showToast, onChange: renderApprStatus });
        render();
    };

    // ---------- 결재 올리기 ----------
    const apprDoc = () => ({ key: `CARD:${ym}`, type: 'CARD_MONTH', title: `카드사용내역 ${ymText(ym)}`, date: ym, roles: CARD_APPR_ROLES, label: '결재' });
    const renderApprStatus = (slots = {}) => {
        const el = $('#cm-appr-status');
        if (!el) return;
        const done = CARD_APPR_ROLES.filter(r => slots[r]);
        const state_ = done.length === CARD_APPR_ROLES.length ? ['결재 완료', 'text-emerald-700'] : done.length ? ['결재 진행 중', 'text-amber-700'] : ['결재 전', 'text-slate-500'];
        el.className = `text-[11px] font-bold ${state_[1]}`;
        el.innerHTML = `✍ ${state_[0]} · ${CARD_APPR_ROLES.map(r => (slots[r] ? `${r} ${esc(slots[r].name)} ✓` : `${r} 대기`)).join(' · ')}`;
    };
    const APPROVER_KEY = 'daelim_card_approvers'; // 이 기기에서 고른 결재자 (다음에 그대로)
    $('#cm-request').addEventListener('click', async () => {
        if (!recs.length) return;
        if (!canSign()) { alert('결재 올리기는 현장 작업자 이상만 할 수 있습니다.'); return; }
        const saved = (() => { try { return JSON.parse(localStorage.getItem(APPROVER_KEY) || '{}'); } catch { return {}; } })();
        const noPhoto = recs.filter(r => !r.files?.length).length;
        const noAmount = recs.filter(r => !(Number(r.amount) > 0)).length;
        const ov = document.createElement('div');
        ov.className = 'fixed inset-0 z-[9000] bg-slate-900/60 flex items-center justify-center p-3 text-xs';
        ov.innerHTML = `
            <div class="bg-white w-full max-w-md rounded-2xl shadow-2xl">
                <div class="px-4 py-3 border-b border-slate-200 font-black text-sm text-slate-800">결재 올리기 · 카드사용내역 ${esc(ymText(ym))}</div>
                <div class="p-4 space-y-2.5">
                    <div class="p-2 rounded-lg bg-violet-50 text-violet-900 font-bold">${recs.length}건 · 합계 ${won(total())}${byCard().length > 1 ? `<div class="font-normal">${byCard().map(([c, v]) => `${esc(c)} ${won(v)}`).join(' · ')}</div>` : ''}</div>
                    ${noPhoto || noAmount ? `<div class="p-2 rounded-lg bg-amber-50 text-amber-800 font-bold">⚠️ ${noAmount ? `금액 없음 ${noAmount}건 ` : ''}${noPhoto ? `영수증 사진 없음 ${noPhoto}건` : ''} — 올리기 전에 확인하세요.</div>` : ''}
                    <label class="block"><span class="font-bold text-slate-500">팀장 결재자</span>
                        <select id="cmr-lead" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"></select></label>
                    <label class="block"><span class="font-bold text-slate-500">대표 결재자</span>
                        <select id="cmr-ceo" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"></select></label>
                    <label class="block"><span class="font-bold text-slate-500">전달 메모 (선택)</span>
                        <input id="cmr-memo" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5" placeholder="예: 9월 법인카드 사용내역입니다." /></label>
                    <label class="flex items-center gap-1.5 font-bold text-slate-600"><input type="checkbox" id="cmr-sign" checked /> 담당 칸에 내 전자서명 (${esc(state.currentUser?.name || '')})</label>
                    <p class="text-[11px] text-slate-500">결재자에게 할일(결재 요청)과 1:1 메시지가 갑니다. 알림의 [열기]를 누르면 이 달의 카드사용내역이 열리고, 결재 칸을 눌러 서명합니다.</p>
                </div>
                <div class="flex justify-end gap-2 px-4 py-3 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
                    <button type="button" class="cmr-cancel px-3 py-2 bg-white border border-slate-300 rounded-lg font-bold">취소</button>
                    <button type="button" class="cmr-ok px-4 py-2 bg-rose-600 hover:bg-rose-700 text-white rounded-lg font-black disabled:opacity-40">결재 올리기</button>
                </div>
            </div>`;
        document.body.appendChild(ov);
        const q = (s) => ov.querySelector(s);
        await Promise.all([fillAssigneeSelect(q('#cmr-lead'), saved.lead?.id || '', saved.lead?.name || ''), fillAssigneeSelect(q('#cmr-ceo'), saved.ceo?.id || '', saved.ceo?.name || '')]);
        q('.cmr-cancel').addEventListener('click', () => ov.remove());
        q('.cmr-ok').addEventListener('click', async () => {
            const lead = readAssignee(q('#cmr-lead'));
            const ceo = readAssignee(q('#cmr-ceo'));
            if (!lead && !ceo) { alert('결재자를 한 명 이상 고르세요.'); return; }
            const btn = q('.cmr-ok');
            btn.disabled = true;
            btn.textContent = '올리는 중…';
            const msgs = [];
            try {
                const doc = apprDoc();
                const slots = await getApproval(doc.key, { refresh: true }).catch(() => ({}));
                if (q('#cmr-sign').checked && !slots['담당']) { await signDoc(doc, '담당'); msgs.push('담당 서명'); }
                const memo = q('#cmr-memo').value.trim();
                const lines = [`${recs.length}건 · 합계 ${won(total())}`, byCard().map(([c, v]) => `· ${c} ${won(v)}`).join('\n'), memo ? `메모: ${memo}` : ''];
                for (const [role, who] of [['팀장', lead], ['대표', ceo]]) {
                    if (!who) continue;
                    const res = await assignTasks({
                        ref: `CARD:${ym}:${role}`, assignee: who,
                        tasks: [{ part: '', label: '결재', text: `[결재 요청] 카드사용내역 ${ymText(ym)} · ${recs.length}건 · ${won(total())} (${role} 결재)`, dueDate: localDateStr() }],
                        title: `[결재 요청] 월별 카드사용내역 ${ymText(ym)} (${role})`, lines,
                        link: { tab: 'slipManage', set: { __slipManageCat: 'CARD', __cardMonthOpen: ym } }
                    });
                    msgs.push(res.ok ? `${role} ${who.name}` : `${role} 알림 실패(${res.message})`);
                }
                try { localStorage.setItem(APPROVER_KEY, JSON.stringify({ lead, ceo })); } catch { /* 무시 */ }
                ov.remove();
                await appr?.refresh();
                showToast(`📨 ${ymText(ym)} 카드사용내역을 결재 올렸습니다: ${msgs.join(' · ')}`);
            } catch (e) {
                alert(`결재를 올리지 못했습니다: ${e.message || e}`);
                btn.disabled = false;
                btn.textContent = '결재 올리기';
            }
        });
    });
    const setMonth = (v) => {
        if (!/^\d{4}-\d{2}$/.test(v)) return;
        ym = v;
        try { localStorage.setItem(MONTH_KEY, ym); } catch { /* 무시 */ }
        load();
    };
    $('#cm-prev').addEventListener('click', () => setMonth(shiftYm(ym, -1)));
    $('#cm-next').addEventListener('click', () => setMonth(shiftYm(ym, 1)));
    $('#cm-month').addEventListener('change', (e) => setMonth(e.target.value));

    // ---------- 제출용 PDF: 1쪽 내역표(+결재자) → 영수증 한 장씩 ----------
    const buildCanvases = async () => {
        const slots = await getApproval(`CARD:${ym}`).catch(() => ({}));
        const signed = CARD_APPR_ROLES.map(r => (slots[r] ? `${r} ${slots[r].name}(${String(slots[r].at || '').slice(0, 10)})` : `${r} -`)).join(' · ');
        const cover = summaryCanvas({
            title: `카드사용내역서 (${ymText(ym)})`,
            subtitle: '대림오일 WMS · 카드전표(영수증) 월별 취합',
            fields: [
                ['사용 월', ymText(ym)], ['건수', `${recs.length}건`], ['합계 금액', won(total())],
                ...byCard().map(([c, v]) => [`카드: ${c}`, won(v)]),
                ['작성자', state.currentUser?.name || ''], ['결재', signed]
            ],
            table: {
                head: ['No', '일자', '사용처', '카드', '용도', '금액', '번호'],
                widths: [5, 12, 24, 16, 16, 13, 16],
                align: ['center', 'center', 'left', 'left', 'left', 'right', 'left'],
                rows: [...recs.map((r, i) => [String(i + 1), `${r.date.slice(5)}(${dow(r.date)})`, r.partner || '-', r.card || '-', r.purpose || '-', (Number(r.amount) || 0).toLocaleString('ko-KR'), r.regNo]),
                    ['', '', '', '', '합계', total().toLocaleString('ko-KR'), '']]
            },
            note: `만든 시각 ${new Date().toLocaleString('ko-KR')} · 다음 쪽부터 영수증 (일자순)`
        });
        return [cover, ...(await receiptSheets())];
    };

    // ---------- 영수증 첨부: A4에 여러 장, 복사기로 복사한 모습 ----------
    // A4(210×297mm)를 200dpi로 그린다. 영수증은 가로 60mm(실제 영수증의 약 80%)로 3열에 놓고,
    // 가장 짧은 열 아래에 차례로 채운다(긴 영수증은 길게). 넘치면 다음 쪽.
    const MM = 200 / 25.4;
    const PAGE_W = Math.round(210 * MM), PAGE_H = Math.round(297 * MM);
    const MARGIN = 10 * MM, HEAD = 9 * MM, GAP = 5 * MM, CAP = 5.5 * MM, COLS = 3;
    const COL_W = (PAGE_W - MARGIN * 2 - GAP * (COLS - 1)) / COLS;
    const FONT = '"Malgun Gothic","Apple SD Gothic Neo","Noto Sans KR",sans-serif';
    // 복사본처럼: 흑백으로 바꾸고 종이(밝은 쪽 85% 지점)는 하얗게, 글자(어두운 2%)는 검게
    const copyLook = (im, w, h) => {
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(w));
        c.height = Math.max(1, Math.round(h));
        const x = c.getContext('2d');
        x.fillStyle = '#fff';
        x.fillRect(0, 0, c.width, c.height);
        x.drawImage(im, 0, 0, c.width, c.height);
        const d = x.getImageData(0, 0, c.width, c.height);
        const px = d.data;
        const hist = new Uint32Array(256);
        const n = c.width * c.height;
        for (let i = 0; i < px.length; i += 4) hist[Math.round(0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2])]++;
        const pct = (p) => { let a = 0; for (let v = 0; v < 256; v++) { a += hist[v]; if (a >= n * p) return v; } return 255; };
        const hi = Math.max(80, pct(0.85));
        const lo = Math.min(pct(0.02), hi - 60);
        for (let i = 0; i < px.length; i += 4) {
            let g = ((0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) - lo) * (255 / (hi - lo));
            g = g >= 225 ? 255 : g <= 40 ? 0 : g; // 옅은 얼룩은 지우고 글자는 진하게
            px[i] = px[i + 1] = px[i + 2] = Math.max(0, Math.min(255, Math.round(g)));
        }
        x.putImageData(d, 0, 0);
        return c;
    };
    const receiptSheets = async () => {
        const items = [];
        for (const [i, r] of recs.entries()) {
            const im = await loadImg(urls.get(r.id));
            const ratio = im ? im.naturalHeight / im.naturalWidth : 0.6;
            const maxH = PAGE_H - MARGIN * 2 - HEAD - CAP;
            const h = Math.min(COL_W * ratio, maxH);
            const w = im ? h / ratio : COL_W;
            items.push({ i, r, im, w, h });
        }
        const sheets = [];
        let page = null;
        let colY = [];
        const newPage = () => {
            const c = document.createElement('canvas');
            c.width = PAGE_W;
            c.height = PAGE_H;
            const x = c.getContext('2d');
            x.fillStyle = '#fff';
            x.fillRect(0, 0, PAGE_W, PAGE_H);
            page = { c, x };
            sheets.push(page);
            colY = Array(COLS).fill(MARGIN + HEAD);
        };
        newPage();
        for (const it of items) {
            const need = it.h + CAP + GAP;
            let col = colY.indexOf(Math.min(...colY));
            if (colY[col] + need - GAP > PAGE_H - MARGIN) { newPage(); col = 0; }
            const { x } = page;
            const left = MARGIN + col * (COL_W + GAP) + (COL_W - it.w) / 2;
            const top = colY[col];
            if (it.im) {
                x.drawImage(copyLook(it.im, it.w, it.h), left, top, it.w, it.h);
            } else {
                x.fillStyle = '#f1f5f9';
                x.fillRect(left, top, it.w, it.h);
                x.fillStyle = '#555';
                x.font = `bold ${Math.round(4 * MM)}px ${FONT}`;
                x.textAlign = 'center';
                x.textBaseline = 'middle';
                x.fillText('영수증 사진 없음', left + it.w / 2, top + it.h / 2);
                x.textAlign = 'left';
            }
            // 복사기 유리에 올린 종이 가장자리처럼 옅은 테두리
            x.strokeStyle = '#8a8a8a';
            x.lineWidth = Math.max(1, 0.25 * MM);
            x.strokeRect(left, top, it.w, it.h);
            // 아래에 번호·일자·사용처·금액
            x.fillStyle = '#111';
            x.textBaseline = 'top';
            x.font = `bold ${Math.round(2.9 * MM)}px ${FONT}`;
            const cap = `${it.i + 1}. ${it.r.date.slice(5)} ${it.r.partner || '-'} · ${won(it.r.amount)}`;
            let t = cap;
            while (t.length > 4 && x.measureText(t).width > COL_W) t = t.slice(0, -1);
            x.fillText(t === cap ? t : `${t}…`, MARGIN + col * (COL_W + GAP), top + it.h + 1.2 * MM);
            colY[col] = top + need;
        }
        // 쪽 머리말 (쪽 수는 다 채운 뒤에 알 수 있음)
        sheets.forEach(({ x }, k) => {
            x.fillStyle = '#333';
            x.textBaseline = 'top';
            x.font = `bold ${Math.round(3.4 * MM)}px ${FONT}`;
            x.fillText(`영수증 첨부 · 카드사용내역 ${ymText(ym)} (${recs.length}장)`, MARGIN, MARGIN - 2 * MM);
            x.textAlign = 'right';
            x.font = `${Math.round(3 * MM)}px ${FONT}`;
            x.fillText(`${k + 1} / ${sheets.length}쪽`, PAGE_W - MARGIN, MARGIN - 2 * MM);
            x.textAlign = 'left';
            x.strokeStyle = '#999';
            x.lineWidth = 1;
            x.beginPath();
            x.moveTo(MARGIN, MARGIN + HEAD - 3 * MM);
            x.lineTo(PAGE_W - MARGIN, MARGIN + HEAD - 3 * MM);
            x.stroke();
        });
        return sheets.map(s => s.c);
    };
    const pdfName = () => `카드사용내역_${ym}`;
    const sharer = createSharer({
        build: async (format) => canvasesToFiles(await buildCanvases(), { format, base: `card_${ym.replace('-', '')}_${shareStamp()}` }),
        key: () => (recs.length && !loading ? JSON.stringify([ym, recs.map(r => [r.id, r.amount, r.card, r.purpose, r.partner, r.files?.[0]?.path])]) : ''),
        showToast
    });
    $('#cm-share').addEventListener('click', (e) => sharer.onClick(e.currentTarget));
    const busy = async (btn, fn) => {
        btn.disabled = true;
        const label = btn.innerHTML;
        btn.textContent = '만드는 중…';
        try { await fn(); } catch (err) { alert(err.message || err); } finally { btn.innerHTML = label; btn.disabled = false; createIcons({ icons }); }
    };
    const download = (file) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file);
        a.download = file.name;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    };
    $('#cm-pdf').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const [pdf] = await canvasesToFiles(await buildCanvases(), { format: 'pdf', base: pdfName() });
        download(pdf);
        showToast(`💾 ${pdf.name} (내역표 + 영수증 ${recs.length}장)을 저장했습니다.`);
    }));
    $('#cm-submit').addEventListener('click', (e) => busy(e.currentTarget, async () => {
        const slots = await getApproval(`CARD:${ym}`, { refresh: true }).catch(() => ({}));
        const unsigned = CARD_APPR_ROLES.filter(r => !slots[r]);
        if (unsigned.length && !confirm(`결재가 끝나지 않았습니다 (${unsigned.join('·')} 미서명). 그대로 제출할까요?`)) return;
        const [pdf] = await canvasesToFiles(await buildCanvases(), { format: 'pdf', base: pdfName() });
        if (!isCloudFiles() && pdf.size > 2 * 1024 * 1024) throw new Error('로컬 모드는 2MB 이하만 저장할 수 있습니다.');
        const { doc } = await saveDocument({
            direction: 'ISSUED', date: localDateStr(), type: '기타', title: `카드사용내역 ${ymText(ym)}`, party: '',
            docNo: `CARD-${ym}`, assignee: state.currentUser?.name || '', memo: `${recs.length}건 · 합계 ${won(total())} · 결재 ${CARD_APPR_ROLES.map(r => (slots[r] ? `${r} ${slots[r].name}` : `${r} 미서명`)).join(', ')}`
        }, { newFiles: [pdf] });
        showToast(`📨 ${doc.regNo} · 카드사용내역 ${ymText(ym)}을 파일 저장소(접수·발행 문서)에 제출했습니다.`);
    }));

    // ---------- 내역서 인쇄 (결재란 + 표 + 영수증 A4 복사본 쪽) ----------
    $('#cm-print').addEventListener('click', async () => {
        const w = openPrintWindow();
        if (!w) return;
        const slots = await getApproval(`CARD:${ym}`, { refresh: true }).catch(() => ({}));
        const rows = recs.map((r, i) => `<tr><td class="c">${i + 1}</td><td class="c">${esc(r.date)} (${dow(r.date)})</td><td>${esc(r.partner || '-')}</td><td>${esc(r.card || '-')}</td><td>${esc(r.purpose || '-')}</td><td>${esc(itemsText(r))}</td><td class="r"><b>${(Number(r.amount) || 0).toLocaleString('ko-KR')}</b></td><td>${esc(r.regNo)}</td></tr>`).join('');
        // 영수증은 제출용 PDF와 같은 A4 복사본 쪽(한 쪽에 여러 장)을 그림으로 넣는다
        const sheets = (await receiptSheets()).map(c => c.toDataURL('image/jpeg', 0.85));
        const receipts = sheets.map(src => `<div class="sheet"><img src="${src}" alt="영수증 첨부" /></div>`).join('');
        w.document.open();
        w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>카드사용내역 ${esc(ym)}</title><style>
            @page { size: A4 portrait; margin: 10mm; }
            body { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 8.5pt; color: #111; margin: 0; }
            * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
            .head { display: flex; justify-content: space-between; align-items: flex-start; margin-bottom: 4mm; }
            h1 { font-size: 17pt; margin: 0; letter-spacing: 2px; } .sub { color: #555; margin-top: 1mm; }
            table.list { width: 100%; border-collapse: collapse; } .list th, .list td { border: 1px solid #666; padding: 1.3mm 1.6mm; }
            .list th { background: #eef2f7; } .list thead { display: table-header-group; } .list tr { page-break-inside: avoid; }
            .c { text-align: center; } .r { text-align: right; }
            .sum { margin: 3mm 0; font-size: 10pt; } .sum b { font-size: 12pt; }
            @page sheetpage { size: A4 portrait; margin: 0; }
            .sheet { page: sheetpage; page-break-before: always; break-before: page; }
            .sheet img { width: 210mm; height: 296mm; display: block; }
            @media screen { .sheet img { width: 100%; height: auto; border: 1px solid #ccc; margin-top: 6mm; } }
        </style></head><body>
            <div class="head"><div><h1>카드사용내역서</h1><div class="sub">${esc(ymText(ym))} · ${recs.length}건 · 작성 ${esc(state.currentUser?.name || '')} · 출력 ${esc(new Date().toLocaleString('ko-KR'))}</div></div>
                ${approvalPrintHtml(CARD_APPR_ROLES, slots, { title: '결재' })}</div>
            <div class="sum">합계 <b>${won(total())}</b> ${byCard().map(([c, v]) => ` · ${esc(c)} ${won(v)}`).join('')}</div>
            <table class="list"><thead><tr><th style="width:7mm">No</th><th style="width:24mm">일자</th><th>사용처</th><th style="width:26mm">카드</th><th style="width:24mm">용도</th><th>품목</th><th style="width:22mm">금액</th><th style="width:28mm">번호</th></tr></thead>
                <tbody>${rows}</tbody><tfoot><tr><th colspan="6" class="r">합계</th><th class="r">${total().toLocaleString('ko-KR')}</th><th></th></tr></tfoot></table>
            ${receipts}
            <script>window.onload = function () { setTimeout(function () { window.print(); }, 500); };<\/script>
        </body></html>`);
        w.document.close();
    });

    // ---------- 엑셀 ----------
    $('#cm-excel').addEventListener('click', async () => {
        const XLSX = await import('xlsx');
        const rows = recs.map((r, i) => ({ No: i + 1, 일자: r.date, 요일: dow(r.date), 사용처: r.partner, 카드: r.card, 용도: r.purpose, 금액: Number(r.amount) || 0, 품목: itemsText(r), 원본번호: r.docNo, 등록번호: r.regNo, 작업자: r.worker, 영수증: r.files?.length ? '있음' : '없음' }));
        rows.push({ No: '', 일자: '합계', 요일: '', 사용처: '', 카드: '', 용도: '', 금액: total() });
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), '카드사용내역');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(byCard().map(([c, v]) => ({ 카드: c, 금액: v }))), '카드별 합계');
        XLSX.writeFile(wb, `${pdfName()}.xlsx`);
        showToast(`📊 ${ymText(ym)} 카드사용내역 ${recs.length}건을 엑셀로 내보냈습니다.`);
    });

    createIcons({ icons });
    load();
    return { reload: load };
};
