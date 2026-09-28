import { createIcons, icons } from '../../services/icons.js';
import { esc } from '../../services/html.js';
import { state } from '../../services/db.js';
import { localDateStr } from '../../services/searchUtils.js';
import { locationOptionsHtml, locationLabel } from '../../services/locations.js';
import {
    listQc, saveQc, deleteQc, EQUIP_STATUS, EQUIP_LOG_KINDS, EQUIP_CATEGORIES, nextCheckDate, daysUntil, canWriteQc, canDeleteQc
} from '../../services/quality.js';
import { btn, fmtQty } from '../plans/planCommon.js';
import { mountAttachmentPanel } from '../AttachmentPanel.js';
import { removeAllAttachments } from '../../services/attachments.js';

// 품질관리 → 설비관리: 설비 대장(코드·위치·점검 주기) + 점검·수리·검교정 이력 + 점검 일정(다음 점검일 = 마지막 점검 + 주기)
// 설비마다 첨부(사진·설명서·검교정 성적서): 문서 키 EQUIP:<id>
const STATUS_CLS = { RUN: 'bg-emerald-100 text-emerald-800', STOP: 'bg-slate-200 text-slate-700', REPAIR: 'bg-amber-100 text-amber-800', DISPOSED: 'bg-slate-100 text-slate-400 line-through' };
const dueBadge = (d) => {
    const n = daysUntil(d);
    if (n === null) return '<span class="text-slate-300">-</span>';
    if (n < 0) return `<span class="px-1.5 py-0.5 rounded bg-rose-600 text-white text-[10px] font-black">${esc(d)} · ${-n}일 지남</span>`;
    if (n <= 7) return `<span class="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 text-[10px] font-black">${esc(d)} · ${n === 0 ? '오늘' : `${n}일 남음`}</span>`;
    return `<span class="text-slate-600">${esc(d)}</span> <span class="text-[10px] text-slate-400">${n}일 남음</span>`;
};

export const renderQualityEquipment = (container, { showToast = () => {} } = {}) => {
    const canWrite = canWriteQc();
    let view = 'list';
    let equips = [];
    let logs = [];
    let q = '';
    let statusF = '';

    container.innerHTML = `
    <section class="space-y-4">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-3">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-emerald-700 flex items-center gap-1"><i data-lucide="shield-check" class="w-3.5 h-3.5"></i>품질관리 › 설비관리</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="cog" class="w-5 h-5 text-emerald-600"></i>설비관리</h2>
                    <p class="text-xs text-slate-500 mt-1">생산·시험 설비를 대장으로 관리하고 정기점검·수리·검교정 이력을 남깁니다. 다음 점검일은 <b>마지막 점검(정기점검·예방정비·검교정) + 점검 주기</b>로 계산합니다.</p>
                </div>
                <div class="flex flex-wrap gap-2">
                    ${canWrite ? `<button type="button" id="eq-new" class="${btn('bg-emerald-600 hover:bg-emerald-700 text-white')}"><i data-lucide="plus" class="w-4 h-4"></i>설비 등록</button>
                    <button type="button" id="eq-log-new" class="${btn('bg-white border border-slate-300 hover:bg-slate-50 text-slate-700')}"><i data-lucide="wrench" class="w-4 h-4"></i>점검·수리 기록</button>` : ''}
                    <button type="button" id="eq-xlsx" class="${btn()}"><i data-lucide="file-spreadsheet" class="w-4 h-4"></i>엑셀</button>
                </div>
            </div>
            <div id="eq-kpi" class="grid grid-cols-2 md:grid-cols-4 gap-3"></div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl">${[['list', '설비 대장'], ['logs', '점검·수리 이력'], ['due', '점검 일정']].map(([k, l]) => `<button type="button" data-v="${k}" class="eq-v px-3 py-1.5 rounded-lg font-black">${l}</button>`).join('')}</div>
                <input type="search" id="eq-q" placeholder="설비 코드·이름·위치 검색" class="border border-slate-300 rounded-lg px-2 py-1 w-52" />
                <select id="eq-status" class="border border-slate-300 rounded-lg px-1.5 py-1"><option value="">상태 전체</option>${Object.entries(EQUIP_STATUS).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select>
            </div>
        </div>
        <div id="eq-body"></div>
    </section>
    <div id="eq-modal" class="hidden fixed inset-0 z-50 bg-slate-900/60 flex items-center justify-center p-3"></div>`;
    const $ = (s) => container.querySelector(s);
    const eqName = (id) => equips.find(e => e.id === id)?.name || '(삭제된 설비)';
    const withNext = () => equips.map(e => ({ ...e, next: nextCheckDate(e, logs) }));

    const renderKpi = () => {
        const list = withNext().filter(e => e.status !== 'DISPOSED');
        const over = list.filter(e => (daysUntil(e.next) ?? 1) < 0).length;
        const soon = list.filter(e => { const n = daysUntil(e.next); return n !== null && n >= 0 && n <= 7; }).length;
        const ym = localDateStr().slice(0, 7);
        const card = (l, v, cls = 'text-slate-900') => `<div class="p-3 rounded-xl border border-slate-200 bg-slate-50/50"><div class="text-[11px] font-bold text-slate-500">${l}</div><div class="text-xl font-black ${cls}">${v}</div></div>`;
        $('#eq-kpi').innerHTML = card('관리 설비', `${list.length}대`) + card('점검 지남', `${over}대`, over ? 'text-rose-600' : 'text-slate-900')
            + card('7일 안 점검', `${soon}대`, soon ? 'text-amber-600' : 'text-slate-900') + card('이번 달 고장 수리', `${logs.filter(l => l.logKind === 'REPAIR' && String(l.date).startsWith(ym)).length}건`);
    };

    const matches = (e) => (!statusF || e.status === statusF) && (!q.trim() || `${e.code} ${e.name} ${e.location} ${e.category} ${e.maker} ${e.manager}`.toLowerCase().includes(q.trim().toLowerCase()));

    const renderList = () => {
        const rows = withNext().filter(matches);
        $('#eq-body').innerHTML = `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
            <table class="w-full text-xs min-w-[900px]"><thead class="bg-slate-50 text-slate-600"><tr>
                <th class="px-2 py-2 text-left">설비 코드</th><th class="px-2 py-2 text-left">설비명</th><th class="px-2 py-2 text-left">분류</th><th class="px-2 py-2 text-left">위치</th>
                <th class="px-2 py-2 text-left">제조사·모델</th><th class="px-2 py-2 text-right">주기(일)</th><th class="px-2 py-2 text-left">다음 점검</th><th class="px-2 py-2 text-center">상태</th><th class="px-2 py-2 text-left">담당</th></tr></thead>
            <tbody class="divide-y divide-slate-100">${rows.length === 0 ? `<tr><td colspan="9" class="p-10 text-center text-slate-400">${equips.length ? '조건에 맞는 설비가 없습니다.' : '등록된 설비가 없습니다. [설비 등록]으로 추가하세요.'}</td></tr>` : rows.map(e => `
                <tr class="eq-row hover:bg-emerald-50/40 cursor-pointer" data-id="${esc(e.id)}">
                    <td class="px-2 py-1.5 font-mono font-bold text-emerald-700">${esc(e.code || '')}</td><td class="px-2 py-1.5 font-bold text-slate-800">${esc(e.name)}</td>
                    <td class="px-2 py-1.5">${esc(e.category || '')}</td><td class="px-2 py-1.5">${esc(e.location ? locationLabel(e.location) : '')}</td>
                    <td class="px-2 py-1.5">${esc([e.maker, e.model].filter(Boolean).join(' · '))}</td><td class="px-2 py-1.5 text-right">${esc(e.cycleDays || '')}</td>
                    <td class="px-2 py-1.5">${e.status === 'DISPOSED' ? '' : dueBadge(e.next)}</td>
                    <td class="px-2 py-1.5 text-center"><span class="px-1.5 py-0.5 rounded text-[10px] font-black ${STATUS_CLS[e.status] || ''}">${esc(EQUIP_STATUS[e.status] || '-')}</span></td>
                    <td class="px-2 py-1.5">${esc(e.manager || '')}</td></tr>`).join('')}</tbody></table></div>`;
        container.querySelectorAll('.eq-row').forEach(tr => tr.addEventListener('click', () => openEquip(equips.find(e => e.id === tr.dataset.id))));
    };

    const renderLogs = () => {
        const ids = new Set(equips.filter(matches).map(e => e.id));
        const rows = logs.filter(l => ids.has(l.equipId) || (!q && !statusF));
        $('#eq-body').innerHTML = `<div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
            <table class="w-full text-xs min-w-[860px]"><thead class="bg-slate-50 text-slate-600"><tr>
                <th class="px-2 py-2 text-left">일자</th><th class="px-2 py-2 text-left">설비</th><th class="px-2 py-2 text-left">구분</th><th class="px-2 py-2 text-left">내용</th>
                <th class="px-2 py-2 text-left">결과</th><th class="px-2 py-2 text-right">정지시간(h)</th><th class="px-2 py-2 text-right">비용(원)</th><th class="px-2 py-2 text-left">작업자</th></tr></thead>
            <tbody class="divide-y divide-slate-100">${rows.length === 0 ? '<tr><td colspan="8" class="p-10 text-center text-slate-400">점검·수리 기록이 없습니다.</td></tr>' : rows.map(l => `
                <tr class="eq-log hover:bg-emerald-50/40 cursor-pointer" data-id="${esc(l.id)}">
                    <td class="px-2 py-1.5 whitespace-nowrap">${esc(l.date)}</td><td class="px-2 py-1.5 font-bold">${esc(eqName(l.equipId))}</td>
                    <td class="px-2 py-1.5"><span class="px-1.5 py-0.5 rounded text-[10px] font-black ${l.logKind === 'REPAIR' ? 'bg-rose-100 text-rose-700' : 'bg-sky-100 text-sky-800'}">${esc(EQUIP_LOG_KINDS[l.logKind] || '')}</span></td>
                    <td class="px-2 py-1.5">${esc(l.desc || '')}</td><td class="px-2 py-1.5">${esc(l.result || '')}</td>
                    <td class="px-2 py-1.5 text-right">${fmtQty(l.downHours)}</td><td class="px-2 py-1.5 text-right">${fmtQty(l.cost)}</td><td class="px-2 py-1.5">${esc(l.worker || '')}</td></tr>`).join('')}</tbody></table></div>`;
        container.querySelectorAll('.eq-log').forEach(tr => tr.addEventListener('click', () => openLog(logs.find(l => l.id === tr.dataset.id))));
    };

    const renderDue = () => {
        const rows = withNext().filter(e => e.status !== 'DISPOSED' && e.next && matches(e)).sort((a, b) => a.next.localeCompare(b.next));
        const noCycle = equips.filter(e => e.status !== 'DISPOSED' && !nextCheckDate(e, logs) && matches(e));
        $('#eq-body').innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div class="lg:col-span-2 bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2">
                <h3 class="text-sm font-black text-slate-800">다음 점검 순서</h3>
                ${rows.length === 0 ? '<div class="p-8 text-center text-xs text-slate-400">점검 주기가 있는 설비가 없습니다.</div>' : rows.map(e => `
                    <div class="flex flex-wrap items-center justify-between gap-2 p-2.5 rounded-xl border border-slate-200 text-xs">
                        <div><b class="text-slate-800">${esc(e.name)}</b> <span class="font-mono text-slate-400">${esc(e.code || '')}</span><div class="text-[11px] text-slate-500">${esc(e.location ? locationLabel(e.location) : '')} · 주기 ${esc(e.cycleDays)}일 · 담당 ${esc(e.manager || '-')}</div></div>
                        <div class="flex items-center gap-2">${dueBadge(e.next)}${canWrite ? `<button type="button" data-check="${esc(e.id)}" class="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold">점검 기록</button>` : ''}</div>
                    </div>`).join('')}
            </div>
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-2 text-xs">
                <h3 class="text-sm font-black text-slate-800">점검 주기 미설정 (${noCycle.length})</h3>
                ${noCycle.length ? noCycle.map(e => `<div class="p-2 rounded-lg bg-slate-50">${esc(e.name)} <span class="text-slate-400 font-mono">${esc(e.code || '')}</span></div>`).join('') : '<div class="text-slate-400">없음</div>'}
            </div></div>`;
        container.querySelectorAll('[data-check]').forEach(b => b.addEventListener('click', () => openLog(null, b.dataset.check)));
    };

    const render = () => {
        container.querySelectorAll('.eq-v').forEach(b => { b.className = `eq-v px-3 py-1.5 rounded-lg font-black ${b.dataset.v === view ? 'bg-white text-emerald-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`; });
        renderKpi();
        if (view === 'logs') renderLogs(); else if (view === 'due') renderDue(); else renderList();
        createIcons({ icons });
    };

    const modalShell = (title, body, footer) => {
        const modal = $('#eq-modal');
        modal.innerHTML = `<div class="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto p-5 space-y-4 text-xs">
            <div class="flex items-start justify-between"><h3 class="text-base font-black text-slate-900">${esc(title)}</h3><button type="button" data-close class="p-1 rounded-lg hover:bg-slate-100"><i data-lucide="x" class="w-4 h-4"></i></button></div>
            ${body}<div class="flex flex-wrap justify-between gap-2 pt-1">${footer}</div></div>`;
        modal.classList.remove('hidden');
        modal.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { modal.classList.add('hidden'); modal.innerHTML = ''; }));
        if (!canWrite) modal.querySelectorAll('input, select, textarea').forEach(el => { el.disabled = true; });
        createIcons({ icons });
        return modal;
    };
    const closeModal = () => { $('#eq-modal').classList.add('hidden'); $('#eq-modal').innerHTML = ''; };
    const inp = 'mt-1 w-full border border-slate-300 rounded-lg px-2 py-1.5';

    // ---------- 설비 등록·수정 ----------
    const openEquip = (orig) => {
        const e = orig || { status: 'RUN', cycleDays: 30, installDate: localDateStr() };
        const myLogs = orig ? logs.filter(l => l.equipId === orig.id) : [];
        const modal = modalShell(orig ? `설비 · ${orig.name}` : '설비 등록', `
            <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                <label><span class="font-bold text-slate-600">설비 코드</span><input id="e-code" value="${esc(e.code || '')}" placeholder="예: EQ-FIL-01" class="${inp} font-mono" /></label>
                <label class="col-span-2"><span class="font-bold text-slate-600">설비명 *</span><input id="e-name" value="${esc(e.name || '')}" class="${inp}" /></label>
                <label><span class="font-bold text-slate-600">분류</span><select id="e-cat" class="${inp}">${EQUIP_CATEGORIES.map(c => `<option ${e.category === c ? 'selected' : ''}>${c}</option>`).join('')}</select></label>
                <label class="col-span-2"><span class="font-bold text-slate-600">위치 (거점·창고)</span><select id="e-loc" class="${inp}"><option value="">(선택 안 함)</option>${locationOptionsHtml(state.locations || [], e.location || '')}</select></label>
                <label><span class="font-bold text-slate-600">제조사</span><input id="e-maker" value="${esc(e.maker || '')}" class="${inp}" /></label>
                <label><span class="font-bold text-slate-600">모델·규격</span><input id="e-model" value="${esc(e.model || '')}" class="${inp}" /></label>
                <label><span class="font-bold text-slate-600">설치(도입)일</span><input type="date" id="e-install" value="${esc(e.installDate || '')}" class="${inp}" /></label>
                <label><span class="font-bold text-slate-600">점검 주기 (일)</span><input type="number" min="0" id="e-cycle" value="${esc(e.cycleDays ?? '')}" class="${inp} text-right" /></label>
                <label><span class="font-bold text-slate-600">상태</span><select id="e-status" class="${inp}">${Object.entries(EQUIP_STATUS).map(([k, l]) => `<option value="${k}" ${e.status === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label><span class="font-bold text-slate-600">담당자</span><input id="e-manager" value="${esc(e.manager || '')}" class="${inp}" /></label>
                <label class="col-span-2 md:col-span-3"><span class="font-bold text-slate-600">점검 항목·비고</span><textarea id="e-notes" rows="3" class="${inp}" placeholder="예: 노즐 누유 확인, 충진량 캘리브레이션, 벨트 장력">${esc(e.notes || '')}</textarea></label>
            </div>
            ${orig ? `<div class="border-t border-slate-100 pt-3 space-y-2"><div class="flex items-center justify-between"><b class="text-slate-700">점검·수리 이력 (${myLogs.length})</b>${canWrite ? '<button type="button" id="e-addlog" class="px-2.5 py-1 rounded-lg bg-slate-800 text-white font-bold">+ 이력 추가</button>' : ''}</div>
                ${myLogs.slice(0, 8).map(l => `<div class="flex justify-between gap-2 p-2 rounded-lg bg-slate-50"><span>${esc(l.date)} · <b>${esc(EQUIP_LOG_KINDS[l.logKind] || '')}</b> · ${esc(l.desc || '')}</span><span class="text-slate-400">${esc(l.worker || '')}</span></div>`).join('') || '<div class="text-slate-400">기록 없음</div>'}</div>` : ''}
            <div id="e-att" class="border-t border-slate-100 pt-3"></div>`,
        `<div>${orig && canDeleteQc(orig) ? '<button type="button" id="e-del" class="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold">삭제</button>' : ''}</div>
         <div class="flex gap-2"><button type="button" data-close class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">닫기</button>${canWrite ? '<button type="button" id="e-save" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black">저장</button>' : ''}</div>`);
        const m = (s) => modal.querySelector(s);
        mountAttachmentPanel(m('#e-att'), { key: orig ? `EQUIP:${orig.id}` : '', title: '첨부 (사진·설명서·검교정 성적서)' });
        m('#e-addlog')?.addEventListener('click', () => openLog(null, orig.id));
        m('#e-del')?.addEventListener('click', async () => {
            if (!confirm(`'${orig.name}' 설비를 삭제할까요? 점검 이력은 남습니다.`)) return;
            try { await removeAllAttachments(`EQUIP:${orig.id}`); await deleteQc(orig.id); showToast('🗑️ 설비를 삭제했습니다.'); closeModal(); await load(); } catch (err) { alert(err.message); }
        });
        m('#e-save')?.addEventListener('click', async (ev) => {
            const name = m('#e-name').value.trim();
            if (!name) { alert('설비명을 입력하세요.'); return; }
            ev.target.disabled = true;
            try {
                const saved = await saveQc('EQUIP', {
                    ...e, date: m('#e-install').value, code: m('#e-code').value.trim(), name, category: m('#e-cat').value, location: m('#e-loc').value,
                    maker: m('#e-maker').value.trim(), model: m('#e-model').value.trim(), installDate: m('#e-install').value, cycleDays: Number(m('#e-cycle').value) || 0,
                    status: m('#e-status').value, manager: m('#e-manager').value.trim(), notes: m('#e-notes').value.trim()
                });
                showToast(orig ? '💾 설비를 저장했습니다.' : '✅ 설비를 등록했습니다.');
                await load();
                if (!orig) openEquip(saved); else closeModal();
            } catch (err) { alert(err.message); ev.target.disabled = false; }
        });
    };

    // ---------- 점검·수리 이력 ----------
    const openLog = (orig, equipId = '') => {
        const l = orig || { date: localDateStr(), logKind: 'CHECK', equipId, worker: state.currentUser?.name || '', result: '이상 없음' };
        const modal = modalShell(orig ? '점검·수리 기록' : '점검·수리 기록 추가', `
            <div class="grid grid-cols-2 md:grid-cols-3 gap-3">
                <label class="col-span-2"><span class="font-bold text-slate-600">설비 *</span><select id="l-eq" class="${inp}"><option value="">(설비 선택)</option>${equips.filter(e => e.status !== 'DISPOSED' || e.id === l.equipId).map(e => `<option value="${esc(e.id)}" ${e.id === l.equipId ? 'selected' : ''}>${esc(e.name)}${e.code ? ` (${esc(e.code)})` : ''}</option>`).join('')}</select></label>
                <label><span class="font-bold text-slate-600">일자 *</span><input type="date" id="l-date" value="${esc(l.date)}" class="${inp}" /></label>
                <label><span class="font-bold text-slate-600">구분</span><select id="l-kind" class="${inp}">${Object.entries(EQUIP_LOG_KINDS).map(([k, v]) => `<option value="${k}" ${l.logKind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></label>
                <label><span class="font-bold text-slate-600">결과</span><input id="l-result" list="l-results" value="${esc(l.result || '')}" class="${inp}" /><datalist id="l-results"><option value="이상 없음"></option><option value="조치 완료"></option><option value="부품 교체"></option><option value="외부 수리 의뢰"></option><option value="추가 점검 필요"></option></datalist></label>
                <label><span class="font-bold text-slate-600">작업자</span><input id="l-worker" value="${esc(l.worker || '')}" class="${inp}" /></label>
                <label><span class="font-bold text-slate-600">설비 정지시간 (h)</span><input type="number" min="0" step="0.1" id="l-down" value="${esc(l.downHours ?? '')}" class="${inp} text-right" /></label>
                <label><span class="font-bold text-slate-600">비용 (원)</span><input type="number" min="0" id="l-cost" value="${esc(l.cost ?? '')}" class="${inp} text-right" /></label>
                <label class="col-span-2 md:col-span-3"><span class="font-bold text-slate-600">내용</span><textarea id="l-desc" rows="3" class="${inp}">${esc(l.desc || '')}</textarea></label>
            </div>
            <div id="l-att" class="border-t border-slate-100 pt-3"></div>`,
        `<div>${orig && canDeleteQc(orig) ? '<button type="button" id="l-del" class="px-3 py-2 rounded-lg bg-rose-50 hover:bg-rose-100 text-rose-700 font-bold">삭제</button>' : ''}</div>
         <div class="flex gap-2"><button type="button" data-close class="px-3 py-2 rounded-lg bg-white border border-slate-300 font-bold">닫기</button>${canWrite ? '<button type="button" id="l-save" class="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-black">저장</button>' : ''}</div>`);
        const m = (s) => modal.querySelector(s);
        mountAttachmentPanel(m('#l-att'), { key: orig ? `EQUIP:${orig.id}` : '', title: '첨부 (점검표·수리 사진·견적서)' });
        m('#l-del')?.addEventListener('click', async () => {
            if (!confirm('이 기록을 삭제할까요?')) return;
            try { await removeAllAttachments(`EQUIP:${orig.id}`); await deleteQc(orig.id); showToast('🗑️ 기록을 삭제했습니다.'); closeModal(); await load(); } catch (err) { alert(err.message); }
        });
        m('#l-save')?.addEventListener('click', async (ev) => {
            const eq = m('#l-eq').value;
            const date = m('#l-date').value;
            if (!eq || !date) { alert('설비와 일자를 입력하세요.'); return; }
            ev.target.disabled = true;
            try {
                const kind = m('#l-kind').value;
                await saveQc('EQUIP_LOG', {
                    ...l, equipId: eq, date, logKind: kind, result: m('#l-result').value.trim(), worker: m('#l-worker').value.trim(),
                    downHours: Number(m('#l-down').value) || 0, cost: Number(m('#l-cost').value) || 0, desc: m('#l-desc').value.trim()
                });
                // 고장 수리를 기록하면 설비 상태도 맞춘다 (결과가 '외부 수리 의뢰'면 수리 중)
                const e = equips.find(x => x.id === eq);
                if (e && kind === 'REPAIR') {
                    const status = /의뢰|진행|대기/.test(m('#l-result').value) ? 'REPAIR' : 'RUN';
                    if (e.status !== status && e.status !== 'DISPOSED') await saveQc('EQUIP', { ...e, status });
                }
                showToast('💾 점검·수리 기록을 저장했습니다.');
                closeModal();
                await load();
            } catch (err) { alert(err.message); ev.target.disabled = false; }
        });
    };

    const exportExcel = async () => {
        const XLSX = await import('xlsx');
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(withNext().map(e => ({
            설비코드: e.code || '', 설비명: e.name, 분류: e.category || '', 위치: e.location || '', 제조사: e.maker || '', 모델: e.model || '', 설치일: e.installDate || '',
            '점검주기(일)': e.cycleDays || '', 다음점검일: e.next || '', 상태: EQUIP_STATUS[e.status] || '', 담당: e.manager || '', 비고: e.notes || ''
        }))), '설비대장');
        XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(logs.map(l => ({
            일자: l.date, 설비: eqName(l.equipId), 구분: EQUIP_LOG_KINDS[l.logKind] || '', 내용: l.desc || '', 결과: l.result || '', '정지시간(h)': l.downHours || 0, '비용(원)': l.cost || 0, 작업자: l.worker || ''
        }))), '점검수리이력');
        XLSX.writeFile(wb, `설비관리_${localDateStr()}.xlsx`);
    };

    const load = async () => {
        try { [equips, logs] = await Promise.all([listQc('EQUIP'), listQc('EQUIP_LOG')]); } catch (err) { $('#eq-body').innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(err.message)}</div>`; return; }
        equips.sort((a, b) => String(a.code || a.name).localeCompare(String(b.code || b.name)));
        render();
    };
    container.querySelectorAll('.eq-v').forEach(b => b.addEventListener('click', () => { view = b.dataset.v; render(); }));
    $('#eq-q').addEventListener('input', (ev) => { q = ev.target.value; render(); });
    $('#eq-status').addEventListener('change', (ev) => { statusF = ev.target.value; render(); });
    $('#eq-new')?.addEventListener('click', () => openEquip(null));
    $('#eq-log-new')?.addEventListener('click', () => openLog(null));
    $('#eq-xlsx').addEventListener('click', () => exportExcel().catch(err => alert(`엑셀을 만들지 못했습니다: ${err.message}`)));
    load();
    createIcons({ icons });
};
