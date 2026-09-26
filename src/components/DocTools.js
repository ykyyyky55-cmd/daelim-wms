import { createIcons, icons } from 'lucide';
import { esc } from '../services/html.js';

/**
 * TOOL → 뷰어 및 편집기 (탭 docTools)
 * 엑셀 / 구글시트 / 문서(Docs) / PDF 를 브라우저 안에서 열어 보고 간단히 고친다.
 * 파일은 서버로 올리지 않는다(이 기기 안에서만 처리). 각 편집기는 처음 열 때 불러온다(코드 분할).
 *  - 엑셀: doctools/ExcelEditor.js (SheetJS)
 *  - 구글시트·구글문서: doctools/GoogleEmbed.js (링크로 열기·보기, 공개 시트는 엑셀 편집기로 가져오기)
 *  - 문서: doctools/DocEditor.js (.docx는 mammoth로 읽기, 서식 편집, Word(.doc)·HTML·TXT 저장·인쇄)
 *  - PDF: doctools/PdfEditor.js (pdf.js 보기, 글자·펜·형광펜·가리기, 회전·순서·삭제·합치기, pdf-lib로 저장)
 */
const TAB_KEY = 'daelim_doctools_tab';
const TABS = [
    { key: 'excel', label: '엑셀', icon: 'sheet', color: 'text-emerald-600', desc: 'xlsx·xls·csv 열기, 셀 편집, 시트·행·열 관리, 엑셀·CSV 저장' },
    { key: 'gsheet', label: '구글시트', icon: 'table-2', color: 'text-green-600', desc: '구글 시트 링크로 열기·편집(구글 로그인), 공개 시트는 엑셀 편집기로 가져오기' },
    { key: 'docs', label: '문서(Docs)', icon: 'file-text', color: 'text-blue-600', desc: 'Word(.docx)·텍스트 열기, 서식 편집, Word·HTML·TXT 저장·인쇄 / 구글 문서 링크 열기' },
    { key: 'pdf', label: 'PDF', icon: 'file-type', color: 'text-rose-600', desc: 'PDF 보기, 글자·펜·형광펜·가리기, 페이지 회전·순서·삭제·합치기, PDF 저장' }
];

// 지금 열린 편집기 (저장 안 한 변경 확인용)
let current = null;
const dirty = () => !!current?.isDirty?.();
const onBeforeUnload = (e) => { if (dirty() && document.querySelector('#doctools-root')) { e.preventDefault(); e.returnValue = ''; } };
window.addEventListener('beforeunload', onBeforeUnload);

// 다른 편집기에서 넘겨줄 값 (예: 구글시트 → 엑셀 편집기로 가져오기)
export const openInDocTools = (tab, payload) => { window.__docToolsPending = { tab, payload }; };

export const renderDocTools = (container, { showToast = () => {} } = {}) => {
    let tab = (() => { try { return localStorage.getItem(TAB_KEY) || 'excel'; } catch { return 'excel'; } })();
    if (window.__docToolsPending?.tab) tab = window.__docToolsPending.tab;
    if (!TABS.some(t => t.key === tab)) tab = 'excel';

    const draw = () => {
        const t = TABS.find(x => x.key === tab);
        container.innerHTML = `
        <section id="doctools-root" class="space-y-3">
            <div class="bg-white p-4 rounded-2xl border border-slate-200 shadow-sm">
                <div class="flex flex-wrap items-center gap-3">
                    <div class="min-w-0">
                        <h2 class="text-lg font-black text-slate-900 flex items-center gap-2"><i data-lucide="file-pen-line" class="w-5 h-5 text-indigo-600"></i>뷰어 및 편집기</h2>
                        <p class="text-xs text-slate-500 mt-0.5"><i data-lucide="shield-check" class="w-3.5 h-3.5 inline text-emerald-600"></i> 파일은 이 브라우저 안에서만 열고 고칩니다. 서버로 올라가지 않습니다.</p>
                    </div>
                    <div class="ml-auto flex flex-wrap bg-slate-100 p-1 rounded-xl border border-slate-200 text-xs font-bold">
                        ${TABS.map(x => `<button type="button" class="dt-tab px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${x.key === tab ? 'bg-white shadow-sm text-slate-900 font-black' : 'text-slate-500 hover:text-slate-800'}" data-tab="${x.key}"><i data-lucide="${x.icon}" class="w-4 h-4 ${x.color}"></i>${esc(x.label)}</button>`).join('')}
                    </div>
                </div>
                <div class="text-[11px] text-slate-500 mt-2">${esc(t.desc)}</div>
            </div>
            <div id="dt-body"><div class="bg-white rounded-2xl border border-slate-200 p-10 text-center text-slate-400 font-bold text-sm">불러오는 중…</div></div>
        </section>`;
        createIcons({ icons });
        container.querySelectorAll('.dt-tab').forEach(b => b.addEventListener('click', () => {
            if (b.dataset.tab === tab) return;
            if (dirty() && !confirm('저장하지 않은 변경 내용이 있습니다. 다른 편집기로 옮기면 사라집니다. 옮길까요?')) return;
            tab = b.dataset.tab;
            try { localStorage.setItem(TAB_KEY, tab); } catch { /* 무시 */ }
            draw();
        }));
        mount(container.querySelector('#dt-body'));
    };

    const mount = async (body) => {
        current = null;
        const pending = window.__docToolsPending?.tab === tab ? window.__docToolsPending.payload : null;
        window.__docToolsPending = null;
        const opts = { showToast, pending, openTab: (k, payload) => { openInDocTools(k, payload); tab = k; try { localStorage.setItem(TAB_KEY, k); } catch { /* 무시 */ } draw(); } };
        try {
            let mod;
            if (tab === 'excel') mod = (await import('./doctools/ExcelEditor.js')).renderExcelEditor;
            else if (tab === 'gsheet') mod = (await import('./doctools/GoogleEmbed.js')).renderGoogleSheet;
            else if (tab === 'docs') mod = (await import('./doctools/DocEditor.js')).renderDocEditor;
            else mod = (await import('./doctools/PdfEditor.js')).renderPdfEditor;
            if (!body.isConnected) return;
            current = mod(body, opts) || null;
        } catch (e) {
            console.error(e);
            body.innerHTML = `<div class="bg-rose-50 border border-rose-200 rounded-2xl p-6 text-rose-700 font-bold text-sm">편집기를 불러오지 못했습니다: ${esc(e.message)}<br><span class="font-normal">인터넷 연결을 확인한 뒤 새로고침하세요.</span></div>`;
        }
    };

    draw();
};

// 탭을 떠날 때 저장 안 한 변경 확인 (main.js의 탭 전환에서 부른다)
export const confirmLeaveDocTools = () => !dirty() || confirm('뷰어 및 편집기에 저장하지 않은 변경 내용이 있습니다. 이 화면을 떠날까요?');
export const resetDocToolsEditor = () => { current = null; };
