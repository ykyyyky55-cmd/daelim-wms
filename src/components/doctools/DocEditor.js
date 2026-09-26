import { createIcons, icons } from 'lucide';
import { esc } from '../../services/html.js';
import { renderGoogleDoc } from './GoogleEmbed.js';

/**
 * 문서(Docs) 뷰어·간단 편집기 — 이 브라우저 안에서만 처리
 * - 파일 편집기: .docx(mammoth로 읽기, 그림 포함)·.txt·.md·.html 열기 → 서식 편집(글자·문단·목록·정렬·표·그림·링크)
 *   저장: Word(.doc, 워드에서 열리는 HTML 형식) / HTML / 텍스트, 인쇄(→ PDF로 저장 가능)
 * - 구글 문서: 링크로 열기·편집, 공개 문서는 이 편집기로 가져오기 (GoogleEmbed.js)
 * 이전 .doc(97-2003 이진 형식)·.hwp는 읽지 못한다.
 */
const MODE_KEY = 'daelim_docedit_mode';
const DOC_STYLE = `
    body, .de-page { font-family: 'Malgun Gothic', '맑은 고딕', sans-serif; font-size: 11pt; line-height: 1.6; color: #111; }
    .de-page h1 { font-size: 20pt; font-weight: 800; margin: 12pt 0 6pt; }
    .de-page h2 { font-size: 16pt; font-weight: 800; margin: 10pt 0 5pt; }
    .de-page h3 { font-size: 13pt; font-weight: 700; margin: 8pt 0 4pt; }
    .de-page p { margin: 0 0 6pt; }
    .de-page ul { list-style: disc; padding-left: 24pt; margin: 0 0 6pt; }
    .de-page ol { list-style: decimal; padding-left: 24pt; margin: 0 0 6pt; }
    .de-page blockquote { border-left: 3pt solid #cbd5e1; padding-left: 10pt; color: #475569; margin: 6pt 0; }
    .de-page table { border-collapse: collapse; margin: 6pt 0; }
    .de-page td, .de-page th { border: 0.75pt solid #64748b; padding: 3pt 6pt; min-width: 40pt; vertical-align: top; }
    .de-page img { max-width: 100%; }
    .de-page a { color: #1d4ed8; text-decoration: underline; }
    .de-page hr { border: 0; border-top: 1pt solid #94a3b8; margin: 10pt 0; }
`;

let mammothLib = null;
const loadMammoth = async () => {
    if (!mammothLib) { const m = await import('mammoth'); mammothLib = m.default || m; }
    return mammothLib;
};

export const renderDocEditor = (el, opts = {}) => {
    const { showToast = () => {}, pending = null } = opts;
    let mode = pending?.googleLink ? 'google' : pending?.buffer ? 'file' : ((() => { try { return localStorage.getItem(MODE_KEY); } catch { return null; } })() || 'file');
    let dirty = false;
    let fileName = '새 문서';
    let initialHtml = '<p><br></p>';
    let sub = null;

    const shell = () => {
        el.innerHTML = `
        <div class="space-y-3">
            <div class="flex bg-white border border-slate-200 p-1 rounded-xl w-fit text-xs font-bold shadow-sm">
                <button type="button" class="de-mode px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${mode === 'file' ? 'bg-blue-600 text-white' : 'text-slate-500'}" data-m="file"><i data-lucide="file-text" class="w-4 h-4"></i>파일 편집기 (Word·텍스트)</button>
                <button type="button" class="de-mode px-3 py-1.5 rounded-lg flex items-center gap-1.5 ${mode === 'google' ? 'bg-blue-600 text-white' : 'text-slate-500'}" data-m="google"><i data-lucide="globe" class="w-4 h-4"></i>구글 문서</button>
            </div>
            <div id="de-body"></div>
        </div>`;
        createIcons({ icons });
        el.querySelectorAll('.de-mode').forEach(b => b.addEventListener('click', () => {
            if (b.dataset.m === mode) return;
            if (mode === 'file' && dirty && !confirm('저장하지 않은 변경 내용이 있습니다. 구글 문서로 옮기면 사라집니다. 옮길까요?')) return;
            mode = b.dataset.m;
            try { localStorage.setItem(MODE_KEY, mode); } catch { /* 무시 */ }
            dirty = false;
            shell();
        }));
        const body = el.querySelector('#de-body');
        if (mode === 'google') sub = renderGoogleDoc(body, { ...opts, pending: pending?.googleLink ? pending : null });
        else drawFileEditor(body);
    };

    // ---------------- 파일 편집기 ----------------
    const drawFileEditor = (box) => {
        const tb = (cmd, icon, title, extra = '') => `<button type="button" class="de-cmd" data-cmd="${cmd}" ${extra} title="${esc(title)}"><i data-lucide="${icon}" class="w-4 h-4"></i></button>`;
        box.innerHTML = `
        <div class="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden" id="de-root">
            <div class="flex flex-wrap items-center gap-1.5 p-2 border-b border-slate-200 bg-slate-50 text-xs font-bold">
                <button type="button" id="de-new" class="de-btn"><i data-lucide="file-plus" class="w-4 h-4"></i>새 문서</button>
                <label class="de-btn cursor-pointer"><i data-lucide="folder-open" class="w-4 h-4"></i>열기<input type="file" id="de-open" accept=".docx,.txt,.md,.html,.htm" class="hidden" /></label>
                <button type="button" id="de-save-doc" class="de-btn !bg-blue-600 !text-white !border-blue-600 hover:!bg-blue-700"><i data-lucide="save" class="w-4 h-4"></i>Word 저장</button>
                <button type="button" id="de-save-html" class="de-btn"><i data-lucide="code" class="w-4 h-4"></i>HTML</button>
                <button type="button" id="de-save-txt" class="de-btn"><i data-lucide="file-type" class="w-4 h-4"></i>텍스트</button>
                <button type="button" id="de-print" class="de-btn"><i data-lucide="printer" class="w-4 h-4"></i>인쇄·PDF</button>
                <span class="ml-auto font-black text-slate-500 truncate max-w-[260px]" id="de-name" title="${esc(fileName)}"><i data-lucide="file-text" class="w-3.5 h-3.5 inline text-blue-600"></i> ${esc(fileName)}</span>
            </div>
            <div class="flex flex-wrap items-center gap-1 p-1.5 border-b border-slate-200 text-xs sticky top-0 bg-white z-10" id="de-toolbar">
                ${tb('undo', 'undo-2', '실행 취소 (Ctrl+Z)')}${tb('redo', 'redo-2', '다시 실행 (Ctrl+Y)')}
                <span class="de-sep"></span>
                <select id="de-block" class="border border-slate-300 rounded-md px-1.5 py-1 font-bold" title="문단 종류">
                    <option value="p">본문</option><option value="h1">제목 1</option><option value="h2">제목 2</option><option value="h3">제목 3</option><option value="blockquote">인용</option>
                </select>
                <select id="de-size" class="border border-slate-300 rounded-md px-1.5 py-1 font-bold" title="글자 크기">
                    <option value="">크기</option>${[['1', '8'], ['2', '10'], ['3', '12'], ['4', '14'], ['5', '18'], ['6', '24'], ['7', '36']].map(([v, t]) => `<option value="${v}">${t}pt</option>`).join('')}
                </select>
                <span class="de-sep"></span>
                ${tb('bold', 'bold', '굵게 (Ctrl+B)')}${tb('italic', 'italic', '기울임 (Ctrl+I)')}${tb('underline', 'underline', '밑줄 (Ctrl+U)')}${tb('strikeThrough', 'strikethrough', '취소선')}
                <label class="de-cmd relative cursor-pointer" title="글자 색"><i data-lucide="baseline" class="w-4 h-4"></i><input type="color" id="de-color" value="#dc2626" class="absolute inset-0 opacity-0 cursor-pointer" /></label>
                <label class="de-cmd relative cursor-pointer" title="형광펜"><i data-lucide="highlighter" class="w-4 h-4"></i><input type="color" id="de-hilite" value="#fde047" class="absolute inset-0 opacity-0 cursor-pointer" /></label>
                <span class="de-sep"></span>
                ${tb('insertUnorderedList', 'list', '글머리 기호')}${tb('insertOrderedList', 'list-ordered', '번호 목록')}
                ${tb('outdent', 'indent-decrease', '내어쓰기')}${tb('indent', 'indent-increase', '들여쓰기')}
                <span class="de-sep"></span>
                ${tb('justifyLeft', 'align-left', '왼쪽 정렬')}${tb('justifyCenter', 'align-center', '가운데 정렬')}${tb('justifyRight', 'align-right', '오른쪽 정렬')}${tb('justifyFull', 'align-justify', '양쪽 정렬')}
                <span class="de-sep"></span>
                <button type="button" class="de-cmd" id="de-link" title="링크"><i data-lucide="link" class="w-4 h-4"></i></button>
                <button type="button" class="de-cmd" id="de-table" title="표 넣기"><i data-lucide="table" class="w-4 h-4"></i></button>
                <label class="de-cmd relative cursor-pointer" title="그림 넣기"><i data-lucide="image-plus" class="w-4 h-4"></i><input type="file" id="de-img" accept="image/*" class="hidden" /></label>
                ${tb('insertHorizontalRule', 'minus', '가로줄')}${tb('removeFormat', 'remove-formatting', '서식 지우기')}
                <span class="ml-auto text-slate-400 font-bold" id="de-count"></span>
            </div>
            <div class="bg-slate-200/70 p-4 max-h-[72vh] overflow-auto" id="de-scroll">
                <div id="de-page" class="de-page bg-white mx-auto shadow-md outline-none" contenteditable="true" spellcheck="false" style="width:210mm;max-width:100%;min-height:297mm;padding:20mm 18mm;box-sizing:border-box">${initialHtml}</div>
            </div>
        </div>
        <style>${DOC_STYLE}
            #de-root .de-btn{display:inline-flex;align-items:center;gap:.3rem;padding:.35rem .6rem;border-radius:.6rem;border:1px solid #cbd5e1;background:#fff;color:#334155}#de-root .de-btn:hover{background:#f1f5f9}
            #de-root .de-cmd{display:inline-flex;align-items:center;justify-content:center;width:30px;height:28px;border-radius:.4rem;color:#334155}#de-root .de-cmd:hover{background:#e2e8f0}
            #de-root .de-sep{width:1px;height:20px;background:#cbd5e1;margin:0 2px}
        </style>`;
        createIcons({ icons });
        bindFile(box);
    };

    const page = () => el.querySelector('#de-page');
    const count = () => {
        const t = page()?.innerText || '';
        const chars = t.replace(/\s/g, '').length;
        const words = (t.trim().match(/\S+/g) || []).length;
        const c = el.querySelector('#de-count');
        if (c) c.textContent = `${chars.toLocaleString()}자 · ${words.toLocaleString()}단어${dirty ? ' · 저장 안 됨' : ''}`;
    };
    const setName = (n) => { fileName = n; const e = el.querySelector('#de-name'); if (e) { e.lastChild.textContent = ` ${n}`; e.title = n; } };
    const exec = (cmd, val = null) => { page()?.focus(); document.execCommand(cmd, false, val); dirty = true; count(); };

    const download = (blob, name) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob); a.download = name; a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    const baseName = () => fileName.replace(/\.[^.]+$/, '') || '문서';
    const fullHtml = (forWord) => `<!DOCTYPE html><html lang="ko"${forWord ? ' xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word" xmlns="http://www.w3.org/TR/REC-html40"' : ''}><head><meta charset="utf-8"><title>${esc(baseName())}</title>
        ${forWord ? '<!--[if gte mso 9]><xml><w:WordDocument><w:View>Print</w:View><w:Zoom>100</w:Zoom></w:WordDocument></xml><![endif]-->' : ''}
        <style>@page{size:A4;margin:20mm 18mm}${DOC_STYLE.replace(/\.de-page /g, '')}</style></head><body class="de-page">${page().innerHTML}</body></html>`;

    const loadFile = async (file) => {
        if (!file) return;
        if (dirty && !confirm('저장하지 않은 변경 내용이 있습니다. 다른 파일을 열까요?')) return;
        try {
            let html;
            if (/\.docx$/i.test(file.name)) html = await docxToHtml(await file.arrayBuffer());
            else if (/\.html?$/i.test(file.name)) {
                const doc = new DOMParser().parseFromString(await file.text(), 'text/html');
                doc.querySelectorAll('script, iframe, object, embed, style, link, meta').forEach(n => n.remove());
                doc.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => { if (/^on/i.test(a.name) || /javascript:/i.test(a.value)) n.removeAttribute(a.name); }));
                html = doc.body.innerHTML;
            } else if (/\.(doc|hwp|hwpx)$/i.test(file.name)) {
                alert('이전 Word(.doc)·한글(.hwp) 파일은 열 수 없습니다. 워드/한글에서 .docx로 저장한 뒤 여세요.');
                return;
            } else {
                const text = await file.text();
                html = text.split(/\r?\n/).map(l => `<p>${esc(l) || '<br>'}</p>`).join('');
            }
            page().innerHTML = html || '<p><br></p>';
            dirty = false;
            setName(file.name);
            count();
            showToast(`📄 ${file.name}을(를) 열었습니다.`);
        } catch (e) { alert(`파일을 열지 못했습니다: ${e.message}`); }
    };

    const docxToHtml = async (buffer) => {
        const mammoth = await loadMammoth();
        const res = await mammoth.convertToHtml({ arrayBuffer: buffer }, {
            styleMap: ["p[style-name='Title'] => h1:fresh", "p[style-name='Subtitle'] => h2:fresh", "p[style-name='제목'] => h1:fresh"]
        });
        if (res.messages?.some(m => m.type === 'warning')) showToast('ℹ️ 일부 서식(머리글·도형 등)은 단순하게 바뀌었습니다.');
        return res.value;
    };

    const bindFile = (box) => {
        const $ = (s) => box.querySelector(s);
        const pg = page();
        pg.addEventListener('input', () => { dirty = true; count(); });
        // 붙여넣기: 다른 사이트의 스크립트·스타일은 빼고 넣는다
        pg.addEventListener('paste', (e) => {
            const html = e.clipboardData?.getData('text/html');
            if (!html) return;
            e.preventDefault();
            const doc = new DOMParser().parseFromString(html, 'text/html');
            doc.querySelectorAll('script, style, meta, link, iframe, object').forEach(n => n.remove());
            doc.querySelectorAll('*').forEach(n => [...n.attributes].forEach(a => { if (/^on/i.test(a.name) || (a.name === 'class')) n.removeAttribute(a.name); }));
            document.execCommand('insertHTML', false, doc.body.innerHTML);
            dirty = true; count();
        });
        box.querySelectorAll('.de-cmd[data-cmd]').forEach(b => b.addEventListener('mousedown', (e) => { e.preventDefault(); exec(b.dataset.cmd); }));
        $('#de-block').addEventListener('change', (e) => { exec('formatBlock', e.target.value); e.target.value = 'p'; });
        $('#de-size').addEventListener('change', (e) => { if (e.target.value) exec('fontSize', e.target.value); e.target.value = ''; });
        // 색 고르기 창이 열리면 선택 영역이 풀리므로 미리 기억해 둔다
        let saved = null;
        const remember = () => { const s = window.getSelection(); if (s.rangeCount && pg.contains(s.anchorNode)) saved = s.getRangeAt(0).cloneRange(); };
        const restore = () => { if (!saved) return; const s = window.getSelection(); s.removeAllRanges(); s.addRange(saved); };
        ['#de-color', '#de-hilite'].forEach(id => {
            $(id).addEventListener('mousedown', remember);
            $(id).addEventListener('input', (e) => { restore(); exec(id === '#de-color' ? 'foreColor' : 'hiliteColor', e.target.value); });
        });
        $('#de-link').addEventListener('mousedown', (e) => {
            e.preventDefault(); remember();
            const url = (prompt('링크 주소 (https://…)', 'https://') || '').trim();
            if (!url || url === 'https://') return;
            if (!/^(https?:|mailto:)/i.test(url)) { alert('https:// 또는 mailto: 로 시작하는 주소만 넣을 수 있습니다.'); return; }
            restore(); exec('createLink', url);
        });
        $('#de-table').addEventListener('mousedown', (e) => {
            e.preventDefault(); remember();
            const spec = (prompt('표 크기 (행×열)', '3×3') || '').match(/(\d+)\s*[x×*,]\s*(\d+)/i);
            if (!spec) return;
            const rows = Math.min(50, Number(spec[1])); const cols = Math.min(20, Number(spec[2]));
            const cells = (tag) => Array.from({ length: cols }, () => `<${tag}><br></${tag}>`).join('');
            restore();
            exec('insertHTML', `<table><tbody>${Array.from({ length: rows }, () => `<tr>${cells('td')}</tr>`).join('')}</tbody></table><p><br></p>`);
        });
        $('#de-img').addEventListener('change', async (e) => {
            const f = e.target.files?.[0]; e.target.value = '';
            if (!f) return;
            if (f.size > 5 * 1024 * 1024) { alert('5MB 이하 그림만 넣을 수 있습니다.'); return; }
            const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(f); });
            restore();
            exec('insertHTML', `<img src="${url}" alt="${esc(f.name)}" />`);
        });
        $('#de-img').closest('label').addEventListener('mousedown', remember);
        // 파일
        $('#de-new').addEventListener('click', () => {
            if (dirty && !confirm('저장하지 않은 변경 내용이 있습니다. 새 문서를 만들까요?')) return;
            pg.innerHTML = '<p><br></p>'; dirty = false; setName('새 문서'); count();
        });
        $('#de-open').addEventListener('change', (e) => { const f = e.target.files?.[0]; e.target.value = ''; loadFile(f); });
        $('#de-save-doc').addEventListener('click', () => {
            download(new Blob(['﻿', fullHtml(true)], { type: 'application/msword' }), `${baseName()}.doc`);
            dirty = false; count();
            showToast('💾 Word 파일(.doc)로 저장했습니다. 워드에서 열어 .docx로 다시 저장할 수 있습니다.');
        });
        $('#de-save-html').addEventListener('click', () => { download(new Blob([fullHtml(false)], { type: 'text/html;charset=utf-8' }), `${baseName()}.html`); dirty = false; count(); });
        $('#de-save-txt').addEventListener('click', () => { download(new Blob(['﻿', pg.innerText], { type: 'text/plain;charset=utf-8' }), `${baseName()}.txt`); dirty = false; count(); });
        $('#de-print').addEventListener('click', () => {
            const w = window.open('', '_blank');
            if (!w) { alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
            w.document.write(fullHtml(false).replace('</body>', '<script>onload=()=>setTimeout(()=>print(),300)<\/script></body>'));
            w.document.close();
        });
        // 끌어놓기
        const root = $('#de-root');
        root.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files') && !e.target.closest('#de-page')) { e.preventDefault(); root.classList.add('ring-4', 'ring-blue-300'); } });
        root.addEventListener('dragleave', (e) => { if (!root.contains(e.relatedTarget)) root.classList.remove('ring-4', 'ring-blue-300'); });
        root.addEventListener('drop', (e) => {
            if (!e.dataTransfer?.files?.length || e.target.closest('#de-page')) return;
            e.preventDefault(); root.classList.remove('ring-4', 'ring-blue-300');
            loadFile(e.dataTransfer.files[0]);
        });
        count();
    };

    shell();
    // 구글 문서에서 가져온 .docx
    if (mode === 'file' && pending?.buffer) {
        docxToHtml(pending.buffer).then(html => {
            if (!page()) return;
            page().innerHTML = html || '<p><br></p>';
            setName(`${String(pending.name || '구글 문서').replace(/\.docx$/i, '')}.docx`);
            dirty = true; count();
            showToast(`📄 '${pending.name}'을(를) 가져왔습니다. [Word 저장]으로 파일로 받을 수 있습니다.`);
        }).catch(e => alert(`가져온 문서를 열지 못했습니다: ${e.message}`));
    }
    return { isDirty: () => mode === 'file' && dirty, sub };
};
