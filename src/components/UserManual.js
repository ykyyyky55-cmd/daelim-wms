import { state } from '../services/db.js';
import { canAccessTab } from '../services/auth.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';
import { MANUALS } from '../data/manualContent.js';

// 지원 → 매뉴얼: 매뉴얼 목록(현재 사용자 매뉴얼) + 장(章)별 단계 설명·이미지·주의사항.
// 내용은 src/data/manualContent.js, 이미지는 public/manual/*.webp (scripts/capture_manual.mjs로 예시 데이터 화면을 캡처).
const STORE_KEY = 'daelim_manual_view';
const imgUrl = (file) => `${import.meta.env.BASE_URL}manual/${file}`;

// 본문 글자: **굵게**, `버튼·메뉴 이름` 만 지원 (나머지는 그대로 이스케이프)
const rich = (s) => esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b class="text-slate-900">$1</b>')
    .replace(/`(.+?)`/g, '<span class="px-1.5 py-0.5 rounded-md bg-slate-100 border border-slate-200 text-[0.92em] font-bold text-slate-800 whitespace-nowrap">$1</span>');

const chapterText = (c) => [c.title, c.summary, ...(c.sections || []).flatMap(s => [s.title, ...(s.steps || []).map(st => (typeof st === 'string' ? st : st.text)), ...(s.tips || []), ...(s.cautions || [])])].join(' ');

const figureHtml = (img, caption) => `
    <figure class="my-3">
        <button type="button" class="man-zoom block w-full rounded-xl overflow-hidden border border-slate-200 shadow-sm bg-slate-50 hover:shadow-md transition" data-src="${esc(imgUrl(img))}" data-caption="${esc(caption || '')}" title="크게 보기">
            <img src="${esc(imgUrl(img))}" alt="${esc(caption || '')}" loading="lazy" class="w-full h-auto block" />
        </button>
        ${caption ? `<figcaption class="mt-1.5 text-[11px] text-slate-500 text-center">${rich(caption)}</figcaption>` : ''}
    </figure>`;

const sectionHtml = (s) => `
    <section class="space-y-3">
        ${s.title ? `<h3 class="text-sm font-black text-slate-900 flex items-center gap-2 pt-2"><span class="w-1.5 h-4 rounded bg-blue-600"></span>${esc(s.title)}</h3>` : ''}
        ${s.text ? `<p class="text-sm text-slate-700 leading-relaxed">${rich(s.text)}</p>` : ''}
        ${s.image ? figureHtml(s.image, s.caption) : ''}
        ${s.steps?.length ? `<ol class="space-y-2.5">${s.steps.map((st, i) => {
            const o = typeof st === 'string' ? { text: st } : st;
            return `<li class="flex gap-3">
                <span class="shrink-0 w-6 h-6 rounded-full bg-blue-600 text-white text-xs font-black flex items-center justify-center mt-0.5">${i + 1}</span>
                <div class="min-w-0 flex-1 text-sm text-slate-700 leading-relaxed">${rich(o.text)}${o.image ? figureHtml(o.image, o.caption) : ''}</div>
            </li>`;
        }).join('')}</ol>` : ''}
        ${s.tips?.length ? `<div class="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-xs text-emerald-900 space-y-1">
            <div class="font-black flex items-center gap-1.5"><i data-lucide="lightbulb" class="w-3.5 h-3.5"></i>알아두면 좋아요</div>
            ${s.tips.map(t => `<div class="leading-relaxed">• ${rich(t)}</div>`).join('')}</div>` : ''}
        ${s.cautions?.length ? `<div class="p-3 rounded-xl bg-amber-50 border border-amber-300 text-xs text-amber-900 space-y-1">
            <div class="font-black flex items-center gap-1.5"><i data-lucide="triangle-alert" class="w-3.5 h-3.5"></i>주의사항</div>
            ${s.cautions.map(t => `<div class="leading-relaxed">• ${rich(t)}</div>`).join('')}</div>` : ''}
    </section>`;

export const renderUserManual = (container, { onSwitchTab }) => {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch { }
    let manual = MANUALS.find(m => m.id === saved.manual) || MANUALS[0];
    let chapterId = manual.chapters.some(c => c.id === saved.chapter) ? saved.chapter : manual.chapters[0].id;
    let query = '';
    const role = state.currentUser?.role || 'VIEWER';
    const persist = () => { try { localStorage.setItem(STORE_KEY, JSON.stringify({ manual: manual.id, chapter: chapterId })); } catch { } };

    container.innerHTML = `
    <section class="space-y-5">
        <div class="bg-white p-5 rounded-2xl border border-slate-200 shadow-sm">
            <div class="flex flex-wrap items-start justify-between gap-3">
                <div>
                    <div class="text-[11px] font-black text-blue-600 flex items-center gap-1"><i data-lucide="life-buoy" class="w-3.5 h-3.5"></i>지원 › 매뉴얼</div>
                    <h2 class="text-lg font-black text-slate-900 mt-1">매뉴얼</h2>
                    <p class="text-xs text-slate-500 mt-1">기능별로 단계별 사용 방법과 주의사항을 정리했습니다. 그림의 품목·수량은 모두 <b>예시 데이터</b>입니다.</p>
                </div>
                <button type="button" id="man-print" class="px-3.5 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm">
                    <i data-lucide="printer" class="w-4 h-4"></i><span>전체 인쇄 / PDF 저장</span>
                </button>
            </div>
            <div class="flex flex-wrap gap-2 mt-4" id="man-docs">
                ${MANUALS.map(m => `
                <button type="button" data-id="${esc(m.id)}" class="man-doc flex items-center gap-3 px-4 py-3 rounded-2xl border text-left transition ${m.id === manual.id ? 'bg-blue-600 border-blue-600 text-white shadow-md' : 'bg-white border-slate-200 hover:border-blue-400'}">
                    <i data-lucide="${esc(m.icon || 'book-open')}" class="w-6 h-6"></i>
                    <span><span class="block text-sm font-black">${esc(m.title)}</span><span class="block text-[11px] ${m.id === manual.id ? 'text-blue-100' : 'text-slate-500'}">${esc(m.desc)} · ${esc(m.updated)}</span></span>
                </button>`).join('')}
            </div>
        </div>

        <div class="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            <aside class="lg:col-span-4 xl:col-span-3 bg-white p-3 rounded-2xl border border-slate-200 shadow-sm lg:sticky lg:top-24 space-y-2">
                <div class="relative">
                    <input type="text" id="man-search" placeholder="매뉴얼 검색 (예: 출고, 라벨, 실사)" class="w-full bg-slate-50 border border-slate-200 rounded-xl pl-8 pr-3 py-2 text-xs focus:ring-2 focus:ring-blue-500 focus:outline-none" autocomplete="off" />
                    <i data-lucide="search" class="w-4 h-4 text-slate-400 absolute left-2.5 top-2.5"></i>
                </div>
                <nav id="man-toc" class="max-h-[70vh] overflow-y-auto space-y-3 pr-1"></nav>
            </aside>
            <article id="man-body" class="lg:col-span-8 xl:col-span-9 bg-white p-5 sm:p-7 rounded-2xl border border-slate-200 shadow-sm min-w-0"></article>
        </div>

        <div id="man-lightbox" class="hidden fixed inset-0 z-[70] bg-slate-950/85 p-4 flex flex-col items-center justify-center cursor-zoom-out">
            <img id="man-lightbox-img" alt="" class="max-w-full max-h-[85vh] rounded-lg shadow-2xl bg-white" />
            <div id="man-lightbox-cap" class="mt-3 text-xs text-white/80 text-center"></div>
        </div>
    </section>`;

    const $ = (s) => container.querySelector(s);
    const visibleChapters = () => manual.chapters.filter(c => !query || chapterText(c).toLowerCase().includes(query.toLowerCase()));

    const renderToc = () => {
        const list = visibleChapters();
        const parts = [];
        list.forEach(c => {
            let p = parts.find(x => x.name === c.part);
            if (!p) parts.push(p = { name: c.part, items: [] });
            p.items.push(c);
        });
        $('#man-toc').innerHTML = list.length === 0 ? '<div class="p-4 text-center text-xs text-slate-400">검색 결과가 없습니다.</div>' : parts.map(p => `
            <div>
                <div class="px-2 text-[10px] font-black text-slate-400 mb-1">${esc(p.name)}</div>
                ${p.items.map(c => `
                <button type="button" data-id="${esc(c.id)}" class="man-ch w-full flex items-center gap-2 px-2.5 py-2 rounded-xl text-left text-xs font-bold transition ${c.id === chapterId ? 'bg-blue-600 text-white shadow-xs' : 'text-slate-700 hover:bg-slate-100'}">
                    <i data-lucide="${esc(c.icon || 'file-text')}" class="w-4 h-4 shrink-0 ${c.id === chapterId ? 'text-white' : 'text-slate-400'}"></i>
                    <span class="truncate">${esc(c.title)}</span>
                </button>`).join('')}
            </div>`).join('');
        container.querySelectorAll('.man-ch').forEach(b => b.addEventListener('click', () => openChapter(b.dataset.id, true)));
    };

    const renderBody = () => {
        const all = manual.chapters;
        const idx = all.findIndex(c => c.id === chapterId);
        const c = all[idx];
        const prev = all[idx - 1], next = all[idx + 1];
        const canOpen = c.tab && canAccessTab(c.tab, role);
        $('#man-body').innerHTML = `
            <div class="flex flex-wrap items-start justify-between gap-3 border-b border-slate-100 pb-4 mb-4">
                <div class="min-w-0">
                    <div class="text-[11px] font-black text-slate-400">${esc(manual.title)} · ${esc(c.part)}</div>
                    <h2 class="text-xl font-black text-slate-900 flex items-center gap-2 mt-1"><i data-lucide="${esc(c.icon || 'file-text')}" class="w-6 h-6 text-blue-600"></i>${esc(c.title)}</h2>
                    ${c.menu ? `<div class="text-xs text-slate-500 mt-1">메뉴 위치: ${rich(c.menu)}</div>` : ''}
                    ${c.roles ? `<div class="text-xs text-slate-500 mt-0.5">사용 권한: ${esc(c.roles)}</div>` : ''}
                </div>
                ${c.tab ? `<button type="button" id="man-open-tab" ${canOpen ? '' : 'disabled'} class="px-3.5 py-2 rounded-xl text-xs font-black flex items-center gap-1.5 ${canOpen ? 'bg-blue-600 hover:bg-blue-700 text-white shadow-sm' : 'bg-slate-100 text-slate-400 cursor-not-allowed'}" title="${canOpen ? '' : '이 화면에 대한 권한이 없습니다'}">
                    <i data-lucide="external-link" class="w-4 h-4"></i>이 화면 열기</button>` : ''}
            </div>
            ${c.summary ? `<p class="text-sm text-slate-700 leading-relaxed mb-4">${rich(c.summary)}</p>` : ''}
            <div class="space-y-6">${(c.sections || []).map(sectionHtml).join('')}</div>
            <div class="flex items-center justify-between gap-2 mt-8 pt-4 border-t border-slate-100">
                ${prev ? `<button type="button" class="man-nav px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 flex items-center gap-1" data-id="${esc(prev.id)}"><i data-lucide="chevron-left" class="w-4 h-4"></i>${esc(prev.title)}</button>` : '<span></span>'}
                ${next ? `<button type="button" class="man-nav px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 flex items-center gap-1" data-id="${esc(next.id)}">${esc(next.title)}<i data-lucide="chevron-right" class="w-4 h-4"></i></button>` : '<span></span>'}
            </div>`;
        $('#man-open-tab')?.addEventListener('click', () => onSwitchTab(c.tab));
        container.querySelectorAll('.man-nav').forEach(b => b.addEventListener('click', () => openChapter(b.dataset.id, true)));
        bindZoom($('#man-body'));
        createIcons({ icons });
    };

    const bindZoom = (root) => root.querySelectorAll('.man-zoom').forEach(b => b.addEventListener('click', () => {
        $('#man-lightbox-img').src = b.dataset.src;
        $('#man-lightbox-cap').textContent = b.dataset.caption || '';
        $('#man-lightbox').classList.remove('hidden');
    }));
    $('#man-lightbox').addEventListener('click', () => $('#man-lightbox').classList.add('hidden'));

    const openChapter = (id, scroll) => {
        chapterId = id;
        persist();
        renderToc();
        renderBody();
        createIcons({ icons });
        if (scroll) $('#man-body').scrollIntoView({ behavior: 'smooth', block: 'start' });
    };

    container.querySelectorAll('.man-doc').forEach(b => b.addEventListener('click', () => {
        manual = MANUALS.find(m => m.id === b.dataset.id) || MANUALS[0];
        chapterId = manual.chapters[0].id;
        renderUserManual(container, { onSwitchTab });
        persist();
    }));
    $('#man-search').addEventListener('input', (e) => {
        query = e.target.value.trim();
        const list = visibleChapters();
        if (list.length && !list.some(c => c.id === chapterId)) chapterId = list[0].id;
        renderToc();
        renderBody();
        createIcons({ icons });
    });

    // 전체 인쇄: 새 창에 모든 장을 이어서 (브라우저 인쇄에서 PDF로 저장 가능)
    $('#man-print').addEventListener('click', () => {
        const w = window.open('', '_blank');
        if (!w) { alert('팝업이 차단되었습니다. 이 사이트의 팝업을 허용해 주세요.'); return; }
        const base = new URL(import.meta.env.BASE_URL, window.location.href).href;
        const styles = [...document.querySelectorAll('style')].map(s => s.outerHTML).join('');
        w.document.write(`<!DOCTYPE html><html lang="ko"><head><meta charset="utf-8"><base href="${esc(base)}"><title>${esc(manual.title)}</title>
            <script src="https://cdn.tailwindcss.com"><\/script>${styles}
            <style>body{font-family:'Noto Sans KR','Malgun Gothic',sans-serif;background:#fff} .ch{page-break-before:always} .ch:first-of-type{page-break-before:auto} figure{break-inside:avoid} button{pointer-events:none}</style></head>
            <body class="p-8 text-slate-800">
                <h1 class="text-3xl font-black mb-1">${esc(manual.title)}</h1>
                <p class="text-sm text-slate-500 mb-6">대림오일 스마트 WMS · ${esc(manual.updated)} · 그림의 품목·수량은 예시 데이터입니다.</p>
                <ol class="text-sm mb-8 columns-2">${manual.chapters.map((c, i) => `<li>${i + 1}. ${esc(c.title)}</li>`).join('')}</ol>
                ${manual.chapters.map((c, i) => `<div class="ch space-y-4 mb-10">
                    <h2 class="text-2xl font-black border-b-2 border-slate-800 pb-2">${i + 1}. ${esc(c.title)}</h2>
                    ${c.menu ? `<div class="text-xs text-slate-500">메뉴 위치: ${rich(c.menu)}${c.roles ? ` · 사용 권한: ${esc(c.roles)}` : ''}</div>` : ''}
                    ${c.summary ? `<p class="text-sm">${rich(c.summary)}</p>` : ''}
                    ${(c.sections || []).map(sectionHtml).join('')}
                </div>`).join('')}
                <script>window.onload = function () { setTimeout(function () { window.print(); }, 1500); };<\/script>
            </body></html>`);
        w.document.close();
    });

    renderToc();
    renderBody();
    createIcons({ icons });
};
