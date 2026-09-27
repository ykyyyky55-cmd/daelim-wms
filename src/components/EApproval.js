import { state } from '../services/db.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import {
    getMySignature, saveMySignature, issueAutoSeal, listApprovals, approvalStatus, signDateText, canSign, isMine,
    SIGNATURE_KINDS, DOC_TYPE_LABEL
} from '../services/approvals.js';
import { makeRoundSeal, sealText, normalizeSignatureFile, canvasToSignature } from '../services/seal.js';

// 전자결재: 내 전자서명(자동 발급 원형 도장 · 도장 이미지 · 직접 그린 서명) + 결재 문서함
// 서명은 각 문서의 결재 칸(생산·구매계획, 요청서, 출하 전표, 업무일지, 수불부 인쇄)에서 빈 칸을 눌러 한다.
const FILTERS = [['ALL', '전체'], ['PARTIAL', '결재 진행 중'], ['DONE', '결재 완료'], ['MINE', '내가 서명한 문서']];

// 문서 키 → 그 문서를 여는 방법
const openTarget = (a) => {
    const [kind, ...rest] = String(a.key).split(':');
    if (kind === 'PLAN' || kind === 'PLANDAY') {
        const site = rest[rest.length - 1] === '전체' ? '' : rest[rest.length - 1];
        const t = a.type || '';
        const tab = t.startsWith('PURCH') ? 'purchPlan' : 'prodPlan';
        const view = t.endsWith('MONTH') ? 'month' : t === 'PROD_DAY' ? 'day' : 'week';
        const date = view === 'month' ? `${a.date}-01` : a.date;
        return { tab, before: () => { window.__pendingPlanOpen = { tab, view, date, site }; } };
    }
    if (kind === 'REQ') return { tab: a.type === 'PURCH_REQ' ? 'purchRequest' : 'prodRequest' };
    if (kind === 'LOG') {
        const site = rest[0];
        return { tab: site === 'HQ' ? 'hqLog' : 'gimpoLog', before: () => { if (site !== 'HQ') window.__gimpoInitialDate = rest[1]; } };
    }
    if (kind === 'LEDGER') return { tab: 'ledgerViewer', before: () => { window.__ledgerViewerKind = rest[0]; } };
    if (kind === 'SLIP') return { hint: '출하 전표는 환경설정 → 📄 전표 발행기 → [발행 이력]에서 열어 서명·재인쇄합니다.' };
    return null;
};

export const renderEApproval = (container, { showToast, onSwitchTab }) => {
    const me = state.currentUser || {};
    let filter = 'ALL';
    let q = '';
    let list = [];

    container.innerHTML = `
    <section class="space-y-5">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div class="text-[11px] font-black text-rose-600 flex items-center gap-1"><i data-lucide="stamp" class="w-3.5 h-3.5"></i>전자결재</div>
            <h2 class="text-lg font-black text-slate-900 mt-1">전자결재 · 전자서명</h2>
            <p class="text-xs text-slate-500 mt-1">계정마다 <b>원형 도장(이름+인)</b>이 자동으로 발급됩니다. 결재가 필요한 서류(생산·구매계획서, 생산·구매요청서, 출하 전표, 업무일지, 수불부 인쇄)의 결재 칸에서 <b>빈 칸을 누르면</b> 로그인한 사람의 서명이 찍히고, 서명 아래에 <b>서명한 날짜</b>가 표시됩니다. 인쇄물에도 그대로 찍힙니다.</p>
        </div>
        <div class="grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
            <article class="xl:col-span-5 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4" id="ea-sig"></article>
            <article class="xl:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
                <div class="flex flex-wrap items-center justify-between gap-2">
                    <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="inbox" class="w-4 h-4 text-rose-600"></i>결재 문서함</h3>
                    <button type="button" id="ea-reload" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-bold flex items-center gap-1"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>새로고침</button>
                </div>
                <div class="flex flex-wrap items-center gap-2 text-xs">
                    <div class="flex gap-1 bg-slate-100 p-1 rounded-xl">${FILTERS.map(([k, l]) => `<button type="button" data-f="${k}" class="ea-f px-3 py-1.5 rounded-lg font-black">${l}</button>`).join('')}</div>
                    <input type="search" id="ea-q" placeholder="문서 이름·번호·서명자 검색" class="flex-1 min-w-[160px] border border-slate-300 rounded-lg px-2 py-1.5" />
                </div>
                <div id="ea-list" class="space-y-2"></div>
            </article>
        </div>
    </section>`;
    const $ = (s) => container.querySelector(s);

    // ---------- 내 전자서명 ----------
    const renderSig = async () => {
        const host = $('#ea-sig');
        host.innerHTML = '<div class="p-6 text-center text-xs text-slate-400">불러오는 중...</div>';
        let sig = null;
        try { sig = await getMySignature({ refresh: true }); } catch (e) { host.innerHTML = `<div class="p-4 text-xs text-rose-600 font-bold">${esc(e.message)}</div>`; return; }
        // 처음 여는 사람은 자동 발급
        if (!sig) {
            try { sig = await issueAutoSeal(); showToast('🔴 원형 도장이 자동으로 발급되었습니다.'); } catch (e) { showToast(e.message, 'error'); }
        }
        const btn = (id, icon, label, cls) => `<button type="button" id="${id}" class="px-3 py-2 rounded-xl text-xs font-bold flex items-center gap-1.5 ${cls}"><i data-lucide="${icon}" class="w-4 h-4"></i>${label}</button>`;
        host.innerHTML = `
            <h3 class="text-sm font-black text-slate-900 flex items-center gap-2"><i data-lucide="stamp" class="w-4 h-4 text-rose-600"></i>내 전자서명</h3>
            <div class="flex flex-wrap items-center gap-5">
                <div class="w-40 h-40 rounded-2xl border-2 border-dashed border-slate-200 bg-[repeating-conic-gradient(#f8fafc_0_25%,#fff_0_50%)] bg-[length:16px_16px] flex items-center justify-center">
                    ${sig ? `<img src="${esc(sig.image)}" alt="내 전자서명" class="max-w-[140px] max-h-[140px] object-contain" />` : '<span class="text-xs text-slate-400">없음</span>'}
                </div>
                <div class="text-xs space-y-1">
                    <div><span class="text-slate-500 font-bold">이름</span> <b class="text-slate-900">${esc(me.name || '')}</b> ${me.title ? `<span class="text-slate-500">${esc(me.title)}</span>` : ''}</div>
                    <div><span class="text-slate-500 font-bold">종류</span> <b>${esc(SIGNATURE_KINDS[sig?.kind] || '-')}</b></div>
                    <div><span class="text-slate-500 font-bold">도장 글자</span> <b class="text-rose-600">${esc(sealText(me.name))}</b></div>
                    <div><span class="text-slate-500 font-bold">등록일</span> ${esc(sig?.updatedAt ? new Date(sig.updatedAt).toLocaleString('ko-KR') : '-')}</div>
                    ${canSign() ? '<div class="text-emerald-700 font-bold">✔ 결재 서명 가능</div>' : '<div class="text-amber-700 font-bold">조회 전용 계정은 서명할 수 없습니다 (현장 작업자 이상).</div>'}
                </div>
            </div>
            <div class="flex flex-wrap gap-2">
                ${btn('ea-auto', 'refresh-ccw', '원형 도장 다시 발급', 'bg-rose-600 hover:bg-rose-700 text-white')}
                ${btn('ea-upload', 'image-up', '도장 이미지 올리기', 'bg-white border border-slate-300 hover:bg-slate-50 text-slate-700')}
                ${btn('ea-draw', 'pen-line', '직접 그리기', 'bg-white border border-slate-300 hover:bg-slate-50 text-slate-700')}
                <input type="file" id="ea-file" accept="image/png,image/jpeg,image/webp" class="hidden" />
            </div>
            <div id="ea-pad" class="hidden space-y-2"></div>
            <ul class="text-[11px] text-slate-500 list-disc pl-4 space-y-0.5">
                <li>자동 도장은 계정 이름으로 만든 <b>빨간 원형 도장</b>입니다(오른쪽 줄부터 세로쓰기). 이름이 바뀌면 [다시 발급]을 누르세요.</li>
                <li>실제 도장을 흰 종이에 찍어 사진으로 올리면 흰 바탕을 지우고 도장 모양만 씁니다.</li>
                <li>서명을 바꿔도 <b>이미 서명한 문서의 서명은 그대로</b>입니다(서명 당시 모양으로 보관).</li>
                <li>도장 글꼴은 무료 명조체(나눔명조)로 전서체 느낌을 낸 것입니다. 회사 전서체 글꼴이나 등록 인감이 있으면 이미지로 올리세요.</li>
            </ul>`;
        createIcons({ icons });
        $('#ea-auto').addEventListener('click', async () => {
            if (sig && sig.kind !== 'AUTO' && !confirm('지금 등록된 서명 대신 자동 원형 도장을 쓸까요?')) return;
            try { await issueAutoSeal(); showToast('🔴 원형 도장을 다시 발급했습니다.'); renderSig(); } catch (e) { alert(e.message); }
        });
        $('#ea-upload').addEventListener('click', () => $('#ea-file').click());
        $('#ea-file').addEventListener('change', async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (!file) return;
            try {
                const image = await normalizeSignatureFile(file);
                await saveMySignature({ kind: 'IMAGE', image });
                showToast('🖼️ 도장 이미지를 등록했습니다.');
                renderSig();
            } catch (err) { alert(err.message); }
        });
        $('#ea-draw').addEventListener('click', () => openPad());
    };

    // 서명 그리기 판
    const openPad = () => {
        const pad = $('#ea-pad');
        pad.classList.remove('hidden');
        pad.innerHTML = `
            <div class="text-xs font-bold text-slate-600">아래 칸에 마우스·손가락으로 서명하세요.</div>
            <canvas id="ea-canvas" width="600" height="240" class="w-full max-w-[480px] h-auto aspect-[5/2] border-2 border-slate-300 rounded-xl bg-white touch-none cursor-crosshair"></canvas>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <label class="flex items-center gap-1 font-bold">색 <select id="ea-ink" class="border border-slate-300 rounded px-1 py-1"><option value="#111827">검정</option><option value="#1d4ed8">파랑</option><option value="#d61f26">빨강</option></select></label>
                <button type="button" id="ea-clear" class="px-3 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold">지우기</button>
                <button type="button" id="ea-pad-cancel" class="px-3 py-1.5 rounded-lg bg-white border border-slate-300 font-bold">닫기</button>
                <button type="button" id="ea-pad-save" class="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-black">이 서명으로 등록</button>
            </div>`;
        const cv = $('#ea-canvas');
        const ctx = cv.getContext('2d');
        ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.lineWidth = 6;
        let drawing = false, drawn = false, last = null;
        const pos = (e) => { const r = cv.getBoundingClientRect(); return { x: (e.clientX - r.left) * cv.width / r.width, y: (e.clientY - r.top) * cv.height / r.height }; };
        cv.addEventListener('pointerdown', (e) => { drawing = true; last = pos(e); cv.setPointerCapture(e.pointerId); ctx.strokeStyle = $('#ea-ink').value; ctx.beginPath(); ctx.arc(last.x, last.y, 2.5, 0, Math.PI * 2); ctx.fillStyle = ctx.strokeStyle; ctx.fill(); drawn = true; });
        cv.addEventListener('pointermove', (e) => { if (!drawing) return; const p = pos(e); ctx.beginPath(); ctx.moveTo(last.x, last.y); ctx.lineTo(p.x, p.y); ctx.stroke(); last = p; });
        const end = () => { drawing = false; };
        cv.addEventListener('pointerup', end); cv.addEventListener('pointercancel', end);
        $('#ea-clear').addEventListener('click', () => { ctx.clearRect(0, 0, cv.width, cv.height); drawn = false; });
        $('#ea-pad-cancel').addEventListener('click', () => { pad.classList.add('hidden'); pad.innerHTML = ''; });
        $('#ea-pad-save').addEventListener('click', async () => {
            if (!drawn) { alert('서명을 그려 주세요.'); return; }
            try {
                await saveMySignature({ kind: 'DRAW', image: canvasToSignature(cv) });
                showToast('✍️ 직접 그린 서명을 등록했습니다.');
                renderSig();
            } catch (err) { alert(err.message); }
        });
    };

    // ---------- 결재 문서함 ----------
    const loadList = async () => {
        $('#ea-list').innerHTML = '<div class="p-6 text-center text-xs text-slate-400">불러오는 중...</div>';
        try { list = await listApprovals({ limit: 500 }); } catch (e) { $('#ea-list').innerHTML = `<div class="p-4 text-xs text-rose-600 font-bold">${esc(e.message)}</div>`; return; }
        renderList();
    };
    const renderList = () => {
        container.querySelectorAll('.ea-f').forEach(b => { b.className = `ea-f px-3 py-1.5 rounded-lg font-black ${b.dataset.f === filter ? 'bg-white text-rose-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`; });
        const needle = q.trim().toLowerCase();
        const rows = list.filter(a => {
            const roles = a.roles || [];
            if (!roles.some(r => a.slots[r])) return false;   // 서명을 모두 취소한 문서는 숨김
            const st = approvalStatus(roles, a.slots);
            if (filter === 'PARTIAL' && st !== 'PARTIAL') return false;
            if (filter === 'DONE' && st !== 'DONE') return false;
            if (filter === 'MINE' && !roles.some(r => isMine(a.slots[r]))) return false;
            if (needle) {
                const text = [a.title, a.date, DOC_TYPE_LABEL[a.type], ...roles.map(r => a.slots[r]?.name || '')].join(' ').toLowerCase();
                if (!text.includes(needle)) return false;
            }
            return true;
        });
        $('#ea-list').innerHTML = rows.length === 0 ? '<div class="p-8 text-center text-xs text-slate-400">해당하는 결재 문서가 없습니다.</div>' : rows.map((a, i) => {
            const roles = a.roles || [];
            const st = approvalStatus(roles, a.slots);
            const target = openTarget(a);
            return `<div class="p-3 rounded-xl border ${st === 'DONE' ? 'border-rose-200 bg-rose-50/30' : 'border-slate-200'} flex flex-wrap items-center justify-between gap-3">
                <div class="min-w-0 text-xs">
                    <div class="flex items-center gap-1.5"><span class="px-1.5 py-0.5 rounded border text-[10px] font-bold bg-white text-slate-600 border-slate-200">${esc(DOC_TYPE_LABEL[a.type] || a.type || '문서')}</span>
                        <span class="px-1.5 py-0.5 rounded text-[10px] font-black ${st === 'DONE' ? 'bg-rose-600 text-white' : 'bg-amber-100 text-amber-800'}">${st === 'DONE' ? '결재 완료' : `진행 ${roles.filter(r => a.slots[r]).length}/${roles.length}`}</span></div>
                    <div class="mt-1 font-black text-slate-900 truncate">${esc(a.title || a.key)}</div>
                    <div class="text-[11px] text-slate-500">문서일 ${esc(a.date || '-')} · 최근 ${esc(a.updatedAt ? new Date(a.updatedAt).toLocaleString('ko-KR') : '-')}</div>
                </div>
                <div class="flex items-center gap-2">
                    <div class="flex border border-slate-300 rounded-lg overflow-hidden bg-white">${roles.map(r => {
                        const s = a.slots[r];
                        return `<div class="w-[62px] text-center border-r last:border-r-0 border-slate-200">
                            <div class="text-[10px] font-bold bg-slate-100 border-b border-slate-200 py-0.5">${esc(r)}</div>
                            <div class="h-[52px] flex flex-col items-center justify-center" title="${s ? esc(`${s.name} ${String(s.at || '').replace('T', ' ')}`) : '미서명'}">
                                ${s ? `<img src="${esc(s.sig)}" alt="" class="h-7 max-w-[54px] object-contain" /><span class="text-[9px] font-bold leading-none mt-0.5">${esc(s.name)}</span><span class="text-[8px] text-slate-500 leading-none">${esc(signDateText(s.at))}</span>` : '<span class="text-[10px] text-slate-300">-</span>'}
                            </div></div>`;
                    }).join('')}</div>
                    ${target ? `<button type="button" class="ea-open px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold" data-i="${i}">열기</button>` : ''}
                </div>
            </div>`;
        }).join('');
        container.querySelectorAll('.ea-open').forEach(b => b.addEventListener('click', () => {
            const t = openTarget(rows[Number(b.dataset.i)]);
            if (!t) return;
            if (t.hint) { alert(t.hint); return; }
            t.before?.();
            onSwitchTab(t.tab);
        }));
    };

    container.querySelectorAll('.ea-f').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; renderList(); }));
    $('#ea-q').addEventListener('input', (e) => { q = e.target.value; renderList(); });
    $('#ea-reload').addEventListener('click', () => loadList());
    renderSig();
    loadList();
    createIcons({ icons });
    // 자동 도장 글꼴을 미리 받아 둔다 (다시 발급할 때 바로 그리도록)
    makeRoundSeal(me.name || '', 32).catch(() => {});
};
