import { canPerformAction } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { listReports, saveReport, deleteReport, reportFileUrl } from '../services/reports.js';
import { fmtSize } from '../services/fileStore.js';
import { openFileInViewer } from '../services/viewerOpen.js';
import { mountApprovalBox } from './approval/ApprovalBox.js';
import { removeAllAttachments } from '../services/attachments.js';

// ==========================================
// 월간 실적 현황판 → 품질회의: 달·사업장별 품질회의 자료(PDF 등) 모음
// ==========================================
// - 저장은 보고서 표 wms_reports(kind QMEETING, id QMEETING-<YYYY-MM>-<HQ|GIMPO>) + 버킷 wms-files reports/<id>/…
//   (services/reports.js saveReport: 같은 확장자 파일은 새 파일로 바뀐다). 업무 자료라 저장소·번들에 넣지 않는다.
// - 권한: 조회 VIEWER·경영자, 올리기·삭제 매니저 이상(MRP_PLANNING, RLS 같은 규칙)
// - 결재 칸은 보고서와 같은 문서 키 REPORT:<id> (작성·검토·승인)
const KIND = 'QMEETING';
const SITES = { HQ: '본사', GIMPO: '김포' };
const SITE_KEY = 'daelim_qmeeting_site';
const APPR_ROLES = ['작성', '검토', '승인'];
const MAX_FILE = 20 * 1024 * 1024;

const ymLabel = (ym) => (/^\d{4}-\d{2}$/.test(ym || '') ? `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월` : (ym || '날짜 없음'));
const when = (s) => (s ? new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');
const thisMonth = () => new Date().toISOString().slice(0, 7);
const extOf = (name = '') => (String(name).match(/\.([a-z0-9]{1,6})$/i)?.[1] || 'file').toLowerCase();
const isPdf = (f) => /pdf/i.test(f.mime || '') || extOf(f.name) === 'pdf';
const meetingId = (ym, site) => `${KIND}-${ym}-${site}`;
const defaultTitle = (ym, site) => `품질회의 ${ymLabel(ym)} 자료 (${SITES[site] || site})`;
// 파일 이름에서 달·사업장 짐작 (예: '품질회의 2026년9월 자료_(김포).pdf')
const guessFromName = (name = '') => {
    const m = name.match(/(20\d{2})\s*[년.\-_]\s*(\d{1,2})\s*월?/);
    const ym = m ? `${m[1]}-${String(Number(m[2])).padStart(2, '0')}` : '';
    const site = /김포/.test(name) ? 'GIMPO' : /본사|도창|방산/.test(name) ? 'HQ' : '';
    return { ym, site };
};
const isNarrow = () => window.matchMedia?.('(max-width: 767px)').matches;

/** 파일을 Blob으로 받는다 (서명 URL·dataURL 공용) */
const fetchBlob = async (f) => {
    const url = await reportFileUrl(f);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`파일을 불러오지 못했습니다 (${res.status}).`);
    return res.blob();
};

export const renderQualityMeeting = (container, { showToast }) => {
    let site = 'ALL';
    try { site = localStorage.getItem(SITE_KEY) || 'ALL'; } catch { /* 기본값 */ }
    let q = '';
    let list = [];
    let view = null; // { id, i } 펼쳐 보는 파일
    let viewUrl = '';
    const canEdit = canPerformAction('MRP_PLANNING');

    container.innerHTML = `
    <section class="space-y-5">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-indigo-600 flex items-center gap-1"><i data-lucide="bar-chart-3" class="w-3.5 h-3.5"></i>현황·보고 › 품질회의</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="clipboard-list" class="w-5 h-5 text-emerald-600"></i>품질회의</h2>
                    <p class="text-xs text-slate-500 mt-1">달마다 본사·김포 <b>품질회의 자료</b>(PDF 등)를 올려 두고 함께 봅니다. 자료마다 결재 칸이 있습니다.</p>
                </div>
                ${canEdit ? '<button type="button" id="qm-add" class="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm"><i data-lucide="upload" class="w-4 h-4"></i>회의 자료 올리기</button>' : ''}
            </div>
            <div id="qm-form" class="hidden"></div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl">${[['ALL', '본사+김포'], ['HQ', '본사'], ['GIMPO', '김포']].map(([k, l]) => `<button type="button" data-s="${k}" class="qm-s px-3 py-1.5 rounded-lg font-black">${l}</button>`).join('')}</div>
                <input type="search" id="qm-q" placeholder="제목·달·내용 검색" class="flex-1 min-w-[160px] border border-slate-300 rounded-lg px-2 py-1.5" />
                <button type="button" id="qm-reload" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold flex items-center gap-1"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>새로고침</button>
            </div>
        </div>
        <div id="qm-list" class="space-y-5"></div>
    </section>`;
    const $ = (s) => container.querySelector(s);

    const closeView = () => { if (viewUrl) URL.revokeObjectURL(viewUrl); viewUrl = ''; view = null; };

    // ---------- 올리기 창 ----------
    const openForm = (preset = {}) => {
        const box = $('#qm-form');
        const ym = preset.period || thisMonth();
        const st = preset.scope || 'GIMPO';
        box.className = 'border border-emerald-200 bg-emerald-50/50 rounded-xl p-4 space-y-3 text-xs';
        box.innerHTML = `
            <div class="font-black text-emerald-800 flex items-center gap-1.5"><i data-lucide="upload" class="w-4 h-4"></i>품질회의 자료 올리기</div>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label class="space-y-1"><span class="font-bold text-slate-600">회의 달</span><input type="month" id="qm-ym" value="${esc(ym)}" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-white" /></label>
                <label class="space-y-1"><span class="font-bold text-slate-600">사업장</span><select id="qm-site" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-white">${Object.entries(SITES).map(([k, l]) => `<option value="${k}" ${k === st ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                <label class="space-y-1"><span class="font-bold text-slate-600">제목</span><input type="text" id="qm-title" value="${esc(preset.title || defaultTitle(ym, st))}" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-white" /></label>
            </div>
            <label class="block space-y-1"><span class="font-bold text-slate-600">내용 요약 (선택)</span><textarea id="qm-summary" rows="2" placeholder="예: 수입검사·배합·포장·출하 불량률, 부적합 보고서, 고객 불만, 출장 보고" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 bg-white">${esc(preset.summary || '')}</textarea></label>
            <label class="block space-y-1"><span class="font-bold text-slate-600">파일 (PDF 권장, 여러 개 가능 · 파일당 20MB)</span><input type="file" id="qm-file" multiple accept=".pdf,.pptx,.xlsx,.xls,.docx,.hwp,.jpg,.jpeg,.png" class="w-full text-xs" /></label>
            <p class="text-[11px] text-slate-500">같은 달·사업장 자료가 이미 있으면 그 자료에 더하고, 확장자가 같은 파일은 새 파일로 바뀝니다.</p>
            <div class="flex justify-end gap-2">
                <button type="button" id="qm-cancel" class="px-3 py-1.5 rounded-lg bg-white border border-slate-300 font-bold">취소</button>
                <button type="button" id="qm-save" class="px-3.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold">저장</button>
            </div>`;
        createIcons({ icons });
        let titleEdited = Boolean(preset.title);
        const syncTitle = () => { if (!titleEdited) $('#qm-title').value = defaultTitle($('#qm-ym').value, $('#qm-site').value); };
        $('#qm-title').addEventListener('input', () => { titleEdited = true; });
        $('#qm-ym').addEventListener('change', syncTitle);
        $('#qm-site').addEventListener('change', syncTitle);
        $('#qm-file').addEventListener('change', (e) => {
            const f = e.target.files?.[0];
            if (!f || preset.period) return;
            const g = guessFromName(f.name);
            if (g.ym) $('#qm-ym').value = g.ym;
            if (g.site) $('#qm-site').value = g.site;
            syncTitle();
        });
        $('#qm-cancel').addEventListener('click', () => { box.className = 'hidden'; box.innerHTML = ''; });
        $('#qm-save').addEventListener('click', async () => {
            const period = $('#qm-ym').value;
            const scope = $('#qm-site').value;
            const title = $('#qm-title').value.trim() || defaultTitle(period, scope);
            const files = [...($('#qm-file').files || [])];
            if (!/^\d{4}-\d{2}$/.test(period)) { alert('회의 달을 고르세요.'); return; }
            const id = meetingId(period, scope);
            const old = list.find(r => r.id === id);
            if (!files.length && !old) { alert('올릴 파일을 고르세요.'); return; }
            const big = files.find(f => f.size > MAX_FILE);
            if (big) { alert(`${big.name}: 20MB를 넘는 파일은 올릴 수 없습니다.`); return; }
            const types = files.map(f => extOf(f.name));
            if (new Set(types).size < types.length) { alert('확장자가 같은 파일은 한 번에 하나만 올릴 수 있습니다.'); return; }
            const replacing = (old?.files || []).filter(f => types.includes(f.type));
            if (replacing.length && !confirm(`이미 있는 파일을 새 파일로 바꿉니다:\n${replacing.map(f => `· ${f.name}`).join('\n')}\n계속할까요?`)) return;
            const btn = $('#qm-save');
            btn.disabled = true; btn.textContent = '올리는 중...';
            try {
                await saveReport({ id, kind: KIND, title, period, scope, summary: $('#qm-summary').value.trim(), content: old?.content || {} },
                    files.map(f => ({ blob: f, name: f.name, type: extOf(f.name) })));
                showToast('✅ 품질회의 자료를 저장했습니다.');
                box.className = 'hidden'; box.innerHTML = '';
                await load();
            } catch (e) {
                alert(e.message);
                btn.disabled = false; btn.textContent = '저장';
            }
        });
    };

    // ---------- 목록 ----------
    const fileButtons = (r) => (r.files || []).map((f, i) => {
        const open = view && view.id === r.id && view.i === i;
        return `<div class="flex flex-wrap items-center gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-2.5 py-1.5">
            <i data-lucide="${isPdf(f) ? 'file-text' : 'file'}" class="w-4 h-4 ${isPdf(f) ? 'text-rose-600' : 'text-slate-500'}"></i>
            <span class="text-xs font-bold text-slate-800 break-all">${esc(f.name)}</span><span class="text-[10px] text-slate-400">${fmtSize(f.size)}</span>
            ${isPdf(f) ? `<button type="button" class="qm-view px-2.5 py-1 rounded-lg text-[11px] font-bold ${open ? 'bg-slate-700 text-white' : 'bg-rose-600 hover:bg-rose-700 text-white'}" data-id="${esc(r.id)}" data-i="${i}">${open ? '접기' : '보기'}</button>` : ''}
            <button type="button" class="qm-viewer px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-[11px] font-bold" data-id="${esc(r.id)}" data-i="${i}">뷰어에서 열기</button>
            <button type="button" class="qm-down px-2.5 py-1 rounded-lg bg-white border border-slate-300 hover:bg-slate-100 text-[11px] font-bold" data-id="${esc(r.id)}" data-i="${i}">내려받기</button>
        </div>`;
    }).join('');

    const card = (r) => `<article class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm space-y-3" data-card="${esc(r.id)}">
        <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
                <span class="inline-block px-2 py-0.5 rounded text-[10px] font-black ${r.scope === 'HQ' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'}">${esc(SITES[r.scope] || r.scope || '사업장 미지정')}</span>
                <h3 class="text-sm font-black text-slate-900 mt-1">${esc(r.title)}</h3>
                ${r.summary ? `<p class="text-[11px] text-slate-500 whitespace-pre-line">${esc(r.summary)}</p>` : ''}
            </div>
            ${canEdit ? `<div class="flex items-center gap-1 shrink-0">
                <button type="button" class="qm-edit text-slate-400 hover:text-emerald-700 p-1" data-id="${esc(r.id)}" title="파일 더하기·고치기"><i data-lucide="file-plus-2" class="w-4 h-4"></i></button>
                <button type="button" class="qm-del text-slate-300 hover:text-rose-600 p-1" data-id="${esc(r.id)}" title="자료 삭제"><i data-lucide="trash-2" class="w-4 h-4"></i></button></div>` : ''}
        </div>
        <div class="flex flex-col gap-2">${fileButtons(r) || '<span class="text-[11px] text-slate-400">저장된 파일이 없습니다 (로컬 모드는 3MB 넘는 파일을 보관하지 않음)</span>'}</div>
        ${view && view.id === r.id ? `<div class="qm-frame-wrap rounded-xl border border-slate-200 overflow-hidden bg-slate-100">${viewUrl ? `<iframe class="w-full block bg-white" style="height:80vh;border:0" src="${viewUrl}" title="${esc(r.title)}"></iframe>` : '<div class="p-8 text-center text-xs text-slate-400">불러오는 중...</div>'}</div>` : ''}
        <div class="text-[10px] text-slate-400">${(r.files || []).map(f => `${esc(extOf(f.name).toUpperCase())} ${esc(when(f.at))}${f.by ? ` · ${esc(f.by)}` : ''}`).join(' / ')}</div>
        <div class="qm-appr flex justify-end border-t border-slate-100 pt-2" data-id="${esc(r.id)}"></div>
    </article>`;

    const renderList = () => {
        container.querySelectorAll('.qm-s').forEach(b => { b.className = `qm-s px-3 py-1.5 rounded-lg font-black ${b.dataset.s === site ? 'bg-white shadow-sm text-emerald-700' : 'text-slate-600 hover:text-slate-900'}`; });
        const qq = q.trim().toLowerCase();
        const rows = list.filter(r => (site === 'ALL' || r.scope === site) && (!qq || `${r.title} ${r.summary} ${ymLabel(r.period)} ${SITES[r.scope] || ''} ${(r.files || []).map(f => f.name).join(' ')}`.toLowerCase().includes(qq)));
        const months = [...new Set(rows.map(r => r.period))];
        $('#qm-list').innerHTML = rows.length ? months.map(ym => `
            <div class="space-y-2">
                <h3 class="text-sm font-black text-slate-700 flex items-center gap-1.5"><i data-lucide="calendar" class="w-4 h-4 text-slate-400"></i>${esc(ymLabel(ym))}</h3>
                <div class="grid grid-cols-1 ${view ? '' : 'lg:grid-cols-2'} gap-4">${rows.filter(r => r.period === ym).sort((a, b) => String(a.scope).localeCompare(String(b.scope))).map(card).join('')}</div>
            </div>`).join('')
            : `<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">${list.length ? '조건에 맞는 자료가 없습니다.' : `아직 품질회의 자료가 없습니다.${canEdit ? ' 위의 <b>회의 자료 올리기</b>로 올리세요.' : ''}`}</div>`;
        createIcons({ icons });
        const L = $('#qm-list');
        L.querySelectorAll('.qm-appr').forEach(host => {
            const r = list.find(x => x.id === host.dataset.id);
            if (r) mountApprovalBox(host, { key: `REPORT:${r.id}`, type: 'REPORT', title: r.title, date: r.period, roles: APPR_ROLES }, { showToast });
        });
        const fileOf = (b) => { const r = list.find(x => x.id === b.dataset.id); return { r, f: r?.files?.[Number(b.dataset.i)] }; };
        L.querySelectorAll('.qm-view').forEach(b => b.addEventListener('click', async () => {
            const { r, f } = fileOf(b);
            if (!f) return;
            const same = view && view.id === r.id && view.i === Number(b.dataset.i);
            closeView();
            if (same) { renderList(); return; }
            // 스마트폰 브라우저는 페이지 안에 PDF를 못 띄우므로 뷰어 화면으로
            if (isNarrow()) { b.disabled = true; try { if (!(await openFileInViewer({ name: f.name, mime: 'application/pdf', blob: await fetchBlob(f) }))) window.open(await reportFileUrl(f), '_blank'); } catch (e) { alert(e.message); } finally { b.disabled = false; } return; }
            view = { id: r.id, i: Number(b.dataset.i) };
            renderList();
            try {
                const blob = await fetchBlob(f);
                if (!view || view.id !== r.id) return;
                viewUrl = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
                renderList();
                container.querySelector(`[data-card="${CSS.escape(r.id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            } catch (e) { alert(e.message); closeView(); renderList(); }
        }));
        L.querySelectorAll('.qm-viewer').forEach(b => b.addEventListener('click', async () => {
            const { f } = fileOf(b);
            if (!f) return;
            b.disabled = true;
            try {
                const blob = await fetchBlob(f);
                closeView();
                if (!(await openFileInViewer({ name: f.name, mime: f.mime, blob }))) window.open(await reportFileUrl(f), '_blank');
            } catch (e) { alert(e.message); } finally { b.disabled = false; }
        }));
        L.querySelectorAll('.qm-down').forEach(b => b.addEventListener('click', async () => {
            const { f } = fileOf(b);
            if (!f) return;
            b.disabled = true;
            try {
                const blob = await fetchBlob(f);
                const a = document.createElement('a');
                a.href = URL.createObjectURL(blob);
                a.download = f.name || 'file';
                document.body.appendChild(a); a.click(); a.remove();
                setTimeout(() => URL.revokeObjectURL(a.href), 10000);
            } catch (e) { alert(`내려받지 못했습니다: ${e.message}`); } finally { b.disabled = false; }
        }));
        L.querySelectorAll('.qm-edit').forEach(b => b.addEventListener('click', () => {
            const r = list.find(x => x.id === b.dataset.id);
            if (!r) return;
            openForm(r);
            $('#qm-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
        }));
        L.querySelectorAll('.qm-del').forEach(b => b.addEventListener('click', async () => {
            const r = list.find(x => x.id === b.dataset.id);
            if (!r || !confirm(`'${r.title}' 자료를 삭제할까요?${r.files?.length ? `\n저장된 파일 ${r.files.length}개도 함께 지워집니다.` : ''}`)) return;
            try {
                await deleteReport(r);
                await removeAllAttachments(`REPORT:${r.id}`).catch(e => console.warn('[품질회의] 첨부를 지우지 못했습니다:', e.message));
                if (view?.id === r.id) closeView();
                showToast('🗑️ 품질회의 자료를 삭제했습니다.');
                await load();
            } catch (e) { alert(e.message); }
        }));
    };

    const load = async () => {
        $('#qm-list').innerHTML = '<div class="p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">불러오는 중...</div>';
        try { list = await listReports({ kind: KIND }); } catch (e) { $('#qm-list').innerHTML = `<div class="p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(e.message)}</div>`; return; }
        renderList();
    };

    container.querySelectorAll('.qm-s').forEach(b => b.addEventListener('click', () => { site = b.dataset.s; try { localStorage.setItem(SITE_KEY, site); } catch { /* 기억만 못 함 */ } renderList(); }));
    $('#qm-q').addEventListener('input', (e) => { q = e.target.value; renderList(); });
    $('#qm-reload').addEventListener('click', () => { closeView(); load(); });
    $('#qm-add')?.addEventListener('click', () => { const box = $('#qm-form'); if (box.classList.contains('hidden')) openForm(); else { box.className = 'hidden'; box.innerHTML = ''; } });
    load();
};
