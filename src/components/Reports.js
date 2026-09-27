import { canPerformAction } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { listReports, deleteReport, reportFileUrl, REPORT_KINDS, FILE_TYPE_LABEL } from '../services/reports.js';
import { fmtSize } from '../services/fileStore.js';

// 월간 실적 현황판 → 보고서: 만들어진 보고서 모음
// - 월례회의 자료(MEETING): 월례회의 자료 대화창에서 '보고서 메뉴에 저장'으로 들어온 PPT·PDF 보고서 파일 (내려받기·열기)
// - 검토 보고서(DOC): 본문 HTML을 앱 안에서 열람·인쇄 (예: ECOUNT ERP 연동 검토 보고서)
// 권한: 조회 VIEWER·경영자, 삭제 MANAGER (RLS 같은 규칙). 저장은 월례회의 자료 대화창에서(매니저 이상).
const FILTER_KEY = 'daelim_reports_filter';
const ymLabel = (ym) => (/^\d{4}-\d{2}$/.test(ym || '') ? `${ym.slice(0, 4)}년 ${Number(ym.slice(5, 7))}월` : (ym || ''));
const when = (s) => (s ? new Date(s).toLocaleString('ko-KR', { dateStyle: 'short', timeStyle: 'short' }) : '');

// 검토 보고서 본문을 인쇄·열람용 문서로 감싼다 (A4 세로)
const DOC_CSS = `
    @page { size: A4 portrait; margin: 14mm; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { margin: 0; font-family: 'Malgun Gothic', '맑은 고딕', 'Noto Sans KR', sans-serif; color: #111827; font-size: 10pt; line-height: 1.6; background: #fff; }
    .doc { max-width: 190mm; margin: 0 auto; padding: 6mm 2mm; }
    h1 { font-size: 18pt; color: #1e3a8a; margin: 0 0 1mm; } .byline { color: #64748b; font-size: 9pt; margin-bottom: 4mm; }
    h2 { font-size: 13pt; color: #1e3a8a; margin: 7mm 0 2mm; padding-left: 2.5mm; border-left: 1.4mm solid #1e3a8a; break-after: avoid; }
    h3 { font-size: 11pt; margin: 4mm 0 1.5mm; }
    p { margin: 1.5mm 0; } ul, ol { margin: 1.5mm 0; padding-left: 6mm; } li { margin: 0.8mm 0; }
    table { width: 100%; border-collapse: collapse; margin: 2mm 0; table-layout: fixed; }
    th, td { border: 0.3mm solid #94a3b8; padding: 1.4mm 2mm; font-size: 9pt; vertical-align: top; word-break: keep-all; overflow-wrap: anywhere; }
    th { background: #e8eef8; text-align: left; } tr { break-inside: avoid; }
    code { background: #f1f5f9; border-radius: 1mm; padding: 0 1mm; font-size: 8.5pt; }
    .lead { font-size: 10.5pt; background: #eef2ff; border: 0.3mm solid #c7d2fe; border-radius: 2mm; padding: 3mm 4mm; }
    .flow { display: flex; gap: 3mm; align-items: stretch; margin: 3mm 0; } .flow .box { flex: 1; border: 0.35mm solid #94a3b8; border-radius: 2mm; padding: 2.5mm 3mm; font-size: 9pt; }
    .flow .box b { display: block; font-size: 10pt; margin-bottom: 1mm; } .flow .box.main { border: 0.6mm solid #2563eb; background: #eff6ff; }
    .flow .arrow { align-self: center; color: #64748b; font-weight: 700; }
    .phase { border: 0.35mm solid #94a3b8; border-radius: 2mm; padding: 2.5mm 3.5mm; margin: 2mm 0; break-inside: avoid; } .phase.main { border: 0.6mm solid #2563eb; background: #eff6ff; }
    .phase b { color: #1e293b; } .gate { color: #475569; font-size: 9pt; margin: 0 0 0 8mm; }
    .small { font-size: 8.5pt; color: #64748b; }
    .bar { position: fixed; top: 8px; right: 8px; } .bar button { padding: 6px 12px; border-radius: 8px; border: 0; background: #1e3a8a; color: #fff; font-weight: 700; cursor: pointer; }
    @media print { .bar { display: none; } }`;
export const reportDocHtml = (rep, { printBar = false } = {}) => `<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><title>${esc(rep.title)}</title><style>${DOC_CSS}</style></head>
    <body>${printBar ? '<div class="bar"><button onclick="window.print()">인쇄 / PDF로 저장</button></div>' : ''}<div class="doc">${rep.content?.html || ''}</div></body></html>`;

// 저장된 PDF 보고서(HTML)를 새 창에: 열자마자 인쇄 창을 띄우던 부분은 빼고 인쇄 버튼을 붙인다
const openHtmlReport = async (f, w) => {
    const url = await reportFileUrl(f);
    const html = url.startsWith('data:') ? decodeURIComponent(escape(atob(url.split(',')[1]))) : await (await fetch(url)).text();
    const bar = '<div class="no-print" style="position:fixed;top:8px;right:8px;z-index:10"><button onclick="window.print()" style="padding:6px 12px;border-radius:8px;border:0;background:#1e3a8a;color:#fff;font-weight:700;cursor:pointer">인쇄 / PDF로 저장</button></div><style>@media print{.no-print{display:none}}</style>';
    w.document.open();
    w.document.write(html.replace(/<script>window\.onload[\s\S]*?<\/script>/, '').replace('<body>', `<body>${bar}`));
    w.document.close();
};
const downloadFile = async (f) => {
    const url = await reportFileUrl(f);
    const blob = await (await fetch(url)).blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = f.name || 'report';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
};

export const renderReports = (container, { showToast }) => {
    let filter = 'ALL';
    try { filter = localStorage.getItem(FILTER_KEY) || 'ALL'; } catch { }
    let q = '';
    let list = [];
    let openId = window.__reportOpenId || '';
    window.__reportOpenId = null;
    const canDelete = canPerformAction('MRP_PLANNING');

    container.innerHTML = `
    <section class="space-y-5">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm space-y-4">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-indigo-600 flex items-center gap-1"><i data-lucide="bar-chart-3" class="w-3.5 h-3.5"></i>월간 실적 현황판 › 보고서</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1 flex items-center gap-2"><i data-lucide="folder-kanban" class="w-5 h-5 text-indigo-600"></i>보고서</h2>
                    <p class="text-xs text-slate-500 mt-1">만든 <b>월례회의 자료</b>(PPT·PDF 보고서)와 <b>검토 보고서</b>를 모아 봅니다. 월례회의 자료는 월간 실적 현황판의 <b>월례회의 자료</b>에서 '보고서 메뉴에 저장'을 켜고 만들면 여기에 들어옵니다.</p>
                </div>
                <button type="button" id="rp-make" class="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm"><i data-lucide="presentation" class="w-4 h-4"></i>월례회의 자료 만들기</button>
            </div>
            <div class="flex flex-wrap items-center gap-2 text-xs">
                <div class="flex gap-1 bg-slate-100 p-1 rounded-xl">${[['ALL', '전체'], ['MEETING', REPORT_KINDS.MEETING], ['DOC', REPORT_KINDS.DOC]].map(([k, l]) => `<button type="button" data-f="${k}" class="rp-f px-3 py-1.5 rounded-lg font-black">${l}</button>`).join('')}</div>
                <input type="search" id="rp-q" placeholder="보고서 이름·기간 검색" class="flex-1 min-w-[160px] border border-slate-300 rounded-lg px-2 py-1.5" />
                <button type="button" id="rp-reload" class="px-2.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 font-bold flex items-center gap-1"><i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i>새로고침</button>
            </div>
        </div>
        <div id="rp-list" class="grid grid-cols-1 lg:grid-cols-2 gap-4"></div>
        <div id="rp-view"></div>
    </section>`;
    const $ = (s) => container.querySelector(s);

    const renderList = () => {
        container.querySelectorAll('.rp-f').forEach(b => { b.className = `rp-f px-3 py-1.5 rounded-lg font-black ${b.dataset.f === filter ? 'bg-white shadow-sm text-indigo-700' : 'text-slate-600 hover:text-slate-900'}`; });
        const qq = q.trim().toLowerCase();
        const rows = list.filter(r => (filter === 'ALL' || r.kind === filter) && (!qq || `${r.title} ${r.summary} ${ymLabel(r.period)} ${r.scope}`.toLowerCase().includes(qq)));
        $('#rp-list').innerHTML = rows.length ? rows.map(r => {
            const files = r.files || [];
            const meeting = r.kind === 'MEETING';
            return `<article class="bg-white p-4 rounded-2xl border ${r.id === openId ? 'border-indigo-400 ring-2 ring-indigo-100' : 'border-slate-200'} shadow-sm space-y-2.5">
                <div class="flex items-start justify-between gap-2">
                    <div class="min-w-0">
                        <span class="inline-block px-2 py-0.5 rounded text-[10px] font-black ${meeting ? 'bg-indigo-100 text-indigo-700' : 'bg-teal-100 text-teal-700'}">${esc(REPORT_KINDS[r.kind] || r.kind)}</span>
                        <h3 class="text-sm font-black text-slate-900 mt-1">${esc(r.title)}</h3>
                        <p class="text-[11px] text-slate-500">${esc([r.summary, r.scope].filter(Boolean).join(' · '))}</p>
                    </div>
                    ${canDelete ? `<button type="button" class="rp-del text-slate-300 hover:text-rose-600 p-1" data-id="${esc(r.id)}" title="보고서 삭제"><i data-lucide="trash-2" class="w-4 h-4"></i></button>` : ''}
                </div>
                <div class="flex flex-wrap gap-2">
                    ${meeting ? (files.length ? files.map((f, i) => `<button type="button" class="rp-file px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 ${f.type === 'pptx' ? 'bg-orange-500 hover:bg-orange-600 text-white' : 'bg-rose-600 hover:bg-rose-700 text-white'}" data-id="${esc(r.id)}" data-i="${i}">
                            <i data-lucide="${f.type === 'pptx' ? 'download' : 'file-text'}" class="w-3.5 h-3.5"></i>${f.type === 'pptx' ? 'PPT 내려받기' : 'PDF 보고서 열기'}<span class="font-normal opacity-80">${fmtSize(f.size)}</span></button>`).join('')
                        : '<span class="text-[11px] text-slate-400">저장된 파일이 없습니다 (로컬 모드는 3MB 넘는 파일을 보관하지 않음)</span>')
                    : `<button type="button" class="rp-open px-3 py-1.5 rounded-lg bg-teal-600 hover:bg-teal-700 text-white text-xs font-bold flex items-center gap-1.5" data-id="${esc(r.id)}"><i data-lucide="book-open" class="w-3.5 h-3.5"></i>열기</button>
                       <button type="button" class="rp-print px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-900 text-white text-xs font-bold flex items-center gap-1.5" data-id="${esc(r.id)}"><i data-lucide="printer" class="w-3.5 h-3.5"></i>인쇄 · PDF</button>`}
                </div>
                <div class="text-[10px] text-slate-400">${meeting ? files.map(f => `${FILE_TYPE_LABEL[f.type] || f.type} ${esc(when(f.at))}${f.by ? ` · ${esc(f.by)}` : ''}`).join(' / ') : `등록 ${esc(when(r.createdAt))}${r.createdByName ? ` · ${esc(r.createdByName)}` : ''}`}</div>
            </article>`;
        }).join('') : `<div class="lg:col-span-2 p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">${list.length ? '조건에 맞는 보고서가 없습니다.' : '아직 보고서가 없습니다. 월간 실적 현황판 → 월례회의 자료에서 만들어 저장하세요.'}</div>`;
        createIcons({ icons });
        $('#rp-list').querySelectorAll('.rp-file').forEach(b => b.addEventListener('click', async () => {
            const r = list.find(x => x.id === b.dataset.id);
            const f = r?.files?.[Number(b.dataset.i)];
            if (!f) return;
            if (f.type === 'html') {
                const w = window.open('', '_blank');
                if (!w) { alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
                w.document.write('<p style="font-family:sans-serif;padding:20px">보고서를 여는 중입니다...</p>');
                try { await openHtmlReport(f, w); } catch (e) { w.close(); alert(`보고서를 열지 못했습니다: ${e.message}`); }
            } else {
                try { b.disabled = true; await downloadFile(f); } catch (e) { alert(`내려받지 못했습니다: ${e.message}`); } finally { b.disabled = false; }
            }
        }));
        $('#rp-list').querySelectorAll('.rp-open').forEach(b => b.addEventListener('click', () => { openId = openId === b.dataset.id ? '' : b.dataset.id; renderList(); renderView(); }));
        $('#rp-list').querySelectorAll('.rp-print').forEach(b => b.addEventListener('click', () => {
            const r = list.find(x => x.id === b.dataset.id);
            const w = window.open('', '_blank');
            if (!w) { alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
            w.document.write(reportDocHtml(r, { printBar: true }));
            w.document.close();
        }));
        $('#rp-list').querySelectorAll('.rp-del').forEach(b => b.addEventListener('click', async () => {
            const r = list.find(x => x.id === b.dataset.id);
            if (!r || !confirm(`'${r.title}' 보고서를 삭제할까요?${r.files?.length ? `\n저장된 파일 ${r.files.length}개도 함께 지워집니다.` : ''}`)) return;
            try { await deleteReport(r); showToast('🗑️ 보고서를 삭제했습니다.'); if (openId === r.id) openId = ''; await load(); } catch (e) { alert(e.message); }
        }));
    };

    // 검토 보고서 본문 보기 (스크립트 없이 iframe 안에 그림)
    const renderView = () => {
        const r = list.find(x => x.id === openId && x.kind === 'DOC');
        if (!r) { $('#rp-view').innerHTML = ''; return; }
        $('#rp-view').innerHTML = `
            <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
                <div class="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-slate-200 bg-slate-50">
                    <span class="text-xs font-black text-slate-700 flex items-center gap-1.5"><i data-lucide="book-open" class="w-4 h-4 text-teal-600"></i>${esc(r.title)}</span>
                    <button type="button" id="rp-view-close" class="text-xs font-bold text-slate-500 hover:text-slate-900">닫기 ✕</button>
                </div>
                <iframe id="rp-frame" class="w-full block bg-white" style="height:70vh;border:0" sandbox="allow-same-origin allow-popups allow-popups-to-escape-sandbox" title="${esc(r.title)}"></iframe>
            </div>`;
        const frame = $('#rp-frame');
        frame.srcdoc = reportDocHtml(r);
        frame.addEventListener('load', () => { try { frame.style.height = `${Math.max(400, frame.contentDocument.documentElement.scrollHeight + 16)}px`; } catch { } });
        $('#rp-view-close').addEventListener('click', () => { openId = ''; renderList(); renderView(); });
        createIcons({ icons });
        $('#rp-view').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    const load = async () => {
        $('#rp-list').innerHTML = '<div class="lg:col-span-2 p-10 text-center text-xs text-slate-400 bg-white rounded-2xl border border-slate-200">불러오는 중...</div>';
        try { list = await listReports(); } catch (e) { $('#rp-list').innerHTML = `<div class="lg:col-span-2 p-6 bg-rose-50 border border-rose-200 rounded-2xl text-sm text-rose-700 font-bold">${esc(e.message)}</div>`; return; }
        renderList();
        renderView();
    };

    container.querySelectorAll('.rp-f').forEach(b => b.addEventListener('click', () => { filter = b.dataset.f; try { localStorage.setItem(FILTER_KEY, filter); } catch { } renderList(); }));
    $('#rp-q').addEventListener('input', (e) => { q = e.target.value; renderList(); });
    $('#rp-reload').addEventListener('click', load);
    $('#rp-make').addEventListener('click', () => { window.__openMeetingDialog = true; window.__switchTab?.('analytics'); });
    load();
};
