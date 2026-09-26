import { createIcons, icons } from 'lucide';
import { esc } from '../services/html.js';
import { localDateStr } from '../services/searchUtils.js';
import { listTodos, saveTodo, deleteTodos, newTodoId } from '../services/todos.js';
import {
    listChatUsers, listMessages, listRecentMessages, sendMessage, deleteMessage, chatFileUrl, subscribeChat,
    myChatId, dmRoom, dmPartner, isCloudChat, PAGE
} from '../services/chat.js';

/**
 * 화면 오른쪽 아래 떠 있는 버튼 → 팝업 창 두 개 (어느 탭에서나 열어 두고 쓴다)
 *  - 할일 메모장: 내 할일 추가·완료·별표·마감일·수정·삭제 (services/todos.js)
 *  - 채팅: 전체 대화 + 1:1, 접속자 표시, 파일 첨부(버튼·붙여넣기·끌어놓기), 안 읽은 수 (services/chat.js)
 * 창은 머리줄을 끌어 옮기고 오른쪽 아래 모서리로 크기를 바꾸며, 위치·크기는 기기별로 기억한다(daelim_float_<창>).
 */
const Z_BASE = 45; // 머리글(40) 위, 모달(50) 아래
const READ_KEY = 'daelim_chat_read';
const readMap = () => { try { return JSON.parse(localStorage.getItem(READ_KEY) || '{}'); } catch { return {}; } };
const setRead = (room, iso) => { const m = readMap(); if (!m[room] || m[room] < iso) { m[room] = iso; try { localStorage.setItem(READ_KEY, JSON.stringify(m)); } catch { /* 무시 */ } } };
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)}MB` : `${Math.max(1, Math.round(n / 1024))}KB`);
const hm = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const dayLabel = (iso) => { const d = new Date(iso); return `${d.getFullYear()}.${d.getMonth() + 1}.${d.getDate()} (${'일월화수목금토'[d.getDay()]})`; };
const linkify = (s) => esc(s).replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" class="underline break-all">$1</a>').replace(/\n/g, '<br>');

let teardown = null;
export const unmountFloatingTools = () => { if (teardown) { teardown(); teardown = null; } };

export const mountFloatingTools = (host, { showToast = () => {} } = {}) => {
    unmountFloatingTools();
    const root = document.createElement('div');
    root.id = 'floating-tools';
    root.className = 'no-print';
    host.appendChild(root);
    const cleanups = [];
    let zTop = Z_BASE;

    // ---------- 떠 있는 버튼 ----------
    root.innerHTML = `
        <div id="ft-dock" style="position:fixed;right:24px;bottom:88px;z-index:${Z_BASE - 1}" class="flex flex-col gap-2">
            <button type="button" id="ft-btn-chat" title="채팅" class="relative w-12 h-12 rounded-full bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl flex items-center justify-center">
                <i data-lucide="messages-square" class="w-5 h-5"></i>
                <span id="ft-chat-badge" class="hidden absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center border-2 border-white"></span>
            </button>
            <button type="button" id="ft-btn-todo" title="할일 메모장" class="relative w-12 h-12 rounded-full bg-amber-500 hover:bg-amber-600 text-white shadow-xl flex items-center justify-center">
                <i data-lucide="notebook-pen" class="w-5 h-5"></i>
                <span id="ft-todo-badge" class="hidden absolute -top-1 -right-1 min-w-[20px] h-5 px-1 rounded-full bg-slate-800 text-white text-[10px] font-black flex items-center justify-center border-2 border-white"></span>
            </button>
        </div>`;

    // ---------- 떠 있는 창 공통 ----------
    const makeWindow = (key, title, icon, color, def) => {
        const saveKey = `daelim_float_${key}`;
        let saved = (() => { try { return JSON.parse(localStorage.getItem(saveKey) || 'null'); } catch { return null; } })();
        const w = document.createElement('div');
        w.className = 'hidden flex-col bg-white border border-slate-300 rounded-2xl shadow-2xl overflow-hidden text-xs';
        w.style.cssText = `position:fixed;z-index:${Z_BASE};resize:both;min-width:280px;min-height:260px;max-width:96vw;max-height:92vh;`;
        w.innerHTML = `
            <div class="ft-head flex items-center gap-2 px-3 py-2 ${color} text-white cursor-move select-none" style="touch-action:none">
                <i data-lucide="${icon}" class="w-4 h-4"></i><span class="ft-title font-black text-sm flex-1 truncate">${title}</span>
                <button type="button" class="ft-close w-7 h-7 rounded-lg hover:bg-white/20 flex items-center justify-center" title="닫기"><i data-lucide="x" class="w-4 h-4"></i></button>
            </div>
            <div class="ft-body flex-1 min-h-0 flex flex-col"></div>`;
        root.appendChild(w);
        const place = () => {
            const mobile = window.innerWidth < 640;
            if (mobile) { Object.assign(w.style, { left: '8px', top: '64px', width: `${window.innerWidth - 16}px`, height: `${window.innerHeight - 72}px` }); return; }
            const s = saved || {};
            const width = Math.min(s.w || def.w, window.innerWidth - 16);
            const height = Math.min(s.h || def.h, window.innerHeight - 16);
            const x = Math.max(8, Math.min(s.x ?? (window.innerWidth - width - def.right), window.innerWidth - width - 8));
            const y = Math.max(8, Math.min(s.y ?? (window.innerHeight - height - 24), window.innerHeight - height - 8));
            Object.assign(w.style, { left: `${x}px`, top: `${y}px`, width: `${width}px`, height: `${height}px` });
        };
        const persist = () => {
            if (window.innerWidth < 640 || w.classList.contains('hidden')) return;
            const st = { x: w.offsetLeft, y: w.offsetTop, w: w.offsetWidth, h: w.offsetHeight };
            saved = st;
            try { localStorage.setItem(saveKey, JSON.stringify(st)); } catch { /* 무시 */ }
        };
        const front = () => { zTop += 1; w.style.zIndex = String(Math.min(zTop, 49)); };
        w.addEventListener('pointerdown', front);
        // 끌어 옮기기
        const head = w.querySelector('.ft-head');
        head.addEventListener('pointerdown', (e) => {
            if (e.target.closest('button') || window.innerWidth < 640) return;
            const sx = e.clientX - w.offsetLeft; const sy = e.clientY - w.offsetTop;
            head.setPointerCapture(e.pointerId);
            const move = (ev) => {
                w.style.left = `${Math.max(0, Math.min(ev.clientX - sx, window.innerWidth - 60))}px`;
                w.style.top = `${Math.max(0, Math.min(ev.clientY - sy, window.innerHeight - 40))}px`;
            };
            const up = () => { head.removeEventListener('pointermove', move); head.removeEventListener('pointerup', up); persist(); };
            head.addEventListener('pointermove', move);
            head.addEventListener('pointerup', up);
        });
        // 크기 바꾸기(CSS resize) 기억
        let rt = null;
        const ro = new ResizeObserver(() => { clearTimeout(rt); rt = setTimeout(persist, 300); });
        ro.observe(w);
        cleanups.push(() => ro.disconnect());
        const api = {
            el: w, body: w.querySelector('.ft-body'),
            isOpen: () => !w.classList.contains('hidden'),
            open: () => { place(); w.classList.remove('hidden'); w.classList.add('flex'); front(); api.onOpen?.(); },
            close: () => { w.classList.add('hidden'); w.classList.remove('flex'); api.onClose?.(); },
            setTitle: (t) => { w.querySelector('.ft-title').textContent = t; }
        };
        w.querySelector('.ft-close').addEventListener('click', () => api.close());
        const onResize = () => { if (api.isOpen()) place(); };
        window.addEventListener('resize', onResize);
        cleanups.push(() => window.removeEventListener('resize', onResize));
        return api;
    };

    // =====================================================================
    // 할일 메모장
    // =====================================================================
    const todoWin = makeWindow('todo', '할일 메모장', 'notebook-pen', 'bg-amber-500', { w: 360, h: 520, right: 580 }); // 처음에는 채팅 창 왼쪽에 (좁은 화면은 자동으로 안쪽)
    let todos = [];
    let todoFilter = 'OPEN';
    let todoLoaded = false;
    const today = () => localDateStr();
    const todoBadge = () => {
        const n = todos.filter(t => !t.done).length;
        const b = root.querySelector('#ft-todo-badge');
        b.textContent = n > 99 ? '99+' : String(n);
        b.classList.toggle('hidden', !n);
    };
    const sortTodos = (list) => list.slice().sort((a, b) => {
        if (a.done !== b.done) return a.done ? 1 : -1;
        if (a.done) return (b.doneAt || '').localeCompare(a.doneAt || '');
        if (a.starred !== b.starred) return a.starred ? -1 : 1;
        if ((a.dueDate || '9') !== (b.dueDate || '9')) return (a.dueDate || '9999').localeCompare(b.dueDate || '9999');
        return (a.createdAt || '').localeCompare(b.createdAt || '');
    });
    const dueBadge = (t) => {
        if (!t.dueDate) return '';
        const d = t.dueDate; const td = today();
        const cls = t.done ? 'bg-slate-100 text-slate-400' : d < td ? 'bg-rose-100 text-rose-700' : d === td ? 'bg-amber-100 text-amber-800' : 'bg-slate-100 text-slate-600';
        const label = d === td ? '오늘' : `${Number(d.slice(5, 7))}/${Number(d.slice(8))}`;
        return `<span class="px-1.5 py-0.5 rounded font-bold text-[10px] whitespace-nowrap ${cls}" title="마감 ${d}">${d < td && !t.done ? '⚠ ' : ''}${label}</span>`;
    };
    const drawTodos = () => {
        const open = todos.filter(t => !t.done);
        const done = todos.filter(t => t.done);
        const list = sortTodos(todoFilter === 'OPEN' ? open : todoFilter === 'DONE' ? done : todos);
        todoWin.body.innerHTML = `
            <div class="p-2.5 border-b border-slate-200 bg-amber-50 space-y-1.5">
                <div class="flex gap-1.5">
                    <input id="td-text" type="text" maxlength="500" placeholder="할일 입력 후 Enter" class="flex-1 min-w-0 border border-amber-300 rounded-lg px-2.5 py-2 font-bold bg-white" />
                    <button type="button" id="td-add" class="px-3 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-black">추가</button>
                </div>
                <div class="flex items-center gap-1.5 text-[11px]">
                    <label class="text-amber-900 font-bold">마감</label><input id="td-due" type="date" class="border border-amber-300 rounded-md px-1.5 py-0.5 bg-white" />
                    <label class="flex items-center gap-1 font-bold text-amber-900 ml-1"><input id="td-star" type="checkbox" />⭐ 중요</label>
                </div>
            </div>
            <div class="flex items-center gap-1 px-2.5 py-1.5 border-b border-slate-100 font-bold text-[11px]">
                ${[['OPEN', `할일 ${open.length}`], ['DONE', `완료 ${done.length}`], ['ALL', `전체 ${todos.length}`]].map(([k, t]) => `<button type="button" class="td-f px-2 py-1 rounded-md ${todoFilter === k ? 'bg-slate-800 text-white' : 'text-slate-500 hover:bg-slate-100'}" data-f="${k}">${t}</button>`).join('')}
                ${done.length ? '<button type="button" id="td-clear" class="ml-auto px-2 py-1 text-rose-600 hover:bg-rose-50 rounded-md">완료 지우기</button>' : ''}
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto divide-y divide-slate-100">
                ${!todoLoaded ? '<div class="p-6 text-center text-slate-400 font-bold">불러오는 중…</div>'
                    : list.map(t => `
                    <div class="td-row group flex items-start gap-2 px-2.5 py-2 hover:bg-slate-50" data-id="${esc(t.id)}">
                        <input type="checkbox" class="td-done mt-0.5 w-4 h-4 accent-emerald-600 cursor-pointer" ${t.done ? 'checked' : ''} />
                        <div class="flex-1 min-w-0">
                            <div class="td-text font-bold break-words cursor-text ${t.done ? 'line-through text-slate-400' : 'text-slate-800'}" title="눌러서 고치기">${esc(t.text)}</div>
                        </div>
                        ${dueBadge(t)}
                        <button type="button" class="td-star text-sm leading-none ${t.starred ? '' : 'opacity-25 hover:opacity-70'}" title="중요">⭐</button>
                        <button type="button" class="td-del text-slate-300 hover:text-rose-600 opacity-0 group-hover:opacity-100 font-black" title="삭제">✕</button>
                    </div>`).join('') || `<div class="p-6 text-center text-slate-400 font-bold">${todoFilter === 'DONE' ? '완료한 일이 없습니다.' : '할일이 없습니다. 위에 입력해 추가하세요.'}</div>`}
            </div>`;
        createIcons({ icons });
        bindTodos();
        todoBadge();
    };
    const persistTodo = async (t) => {
        try { const s = await saveTodo(t); const i = todos.findIndex(x => x.id === s.id); if (i >= 0) todos[i] = s; else todos.push(s); } catch (e) { alert(e.message); }
        drawTodos();
    };
    const bindTodos = () => {
        const $ = (s) => todoWin.body.querySelector(s);
        const add = () => {
            const text = $('#td-text').value.trim();
            if (!text) return;
            persistTodo({ id: newTodoId(), text, dueDate: $('#td-due').value, starred: $('#td-star').checked, done: false, createdAt: new Date().toISOString() })
                .then(() => todoWin.body.querySelector('#td-text')?.focus());
        };
        $('#td-add').addEventListener('click', add);
        $('#td-text').addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); add(); } });
        todoWin.body.querySelectorAll('.td-f').forEach(b => b.addEventListener('click', () => { todoFilter = b.dataset.f; drawTodos(); }));
        $('#td-clear')?.addEventListener('click', async () => {
            const ids = todos.filter(t => t.done).map(t => t.id);
            if (!confirm(`완료한 할일 ${ids.length}개를 지울까요?`)) return;
            try { await deleteTodos(ids); todos = todos.filter(t => !t.done); } catch (e) { alert(e.message); }
            drawTodos();
        });
        todoWin.body.querySelectorAll('.td-row').forEach(row => {
            const t = todos.find(x => x.id === row.dataset.id);
            row.querySelector('.td-done').addEventListener('change', (e) => persistTodo({ ...t, done: e.target.checked, doneAt: e.target.checked ? new Date().toISOString() : '' }));
            row.querySelector('.td-star').addEventListener('click', () => persistTodo({ ...t, starred: !t.starred }));
            row.querySelector('.td-del').addEventListener('click', async () => {
                try { await deleteTodos([t.id]); todos = todos.filter(x => x !== t); } catch (e) { alert(e.message); }
                drawTodos();
            });
            // 고치기: 글자를 누르면 입력 칸(내용)·마감일
            row.querySelector('.td-text').addEventListener('click', () => {
                const box = row.querySelector('.td-text').parentElement;
                box.innerHTML = `<textarea class="td-edit w-full border border-amber-400 rounded-md px-1.5 py-1 font-bold" rows="2" maxlength="500">${esc(t.text)}</textarea>
                    <div class="flex items-center gap-1 mt-1"><input type="date" class="td-edit-due border border-slate-300 rounded px-1 py-0.5 text-[11px]" value="${esc(t.dueDate)}" />
                    <button type="button" class="td-edit-ok px-2 py-0.5 bg-amber-500 text-white rounded font-black">저장</button><button type="button" class="td-edit-cancel px-2 py-0.5 text-slate-500">취소</button></div>`;
                const ta = box.querySelector('.td-edit');
                ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
                const ok = () => { const v = ta.value.trim(); if (!v) return; persistTodo({ ...t, text: v, dueDate: box.querySelector('.td-edit-due').value }); };
                box.querySelector('.td-edit-ok').addEventListener('click', ok);
                box.querySelector('.td-edit-cancel').addEventListener('click', drawTodos);
                ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ok(); } if (e.key === 'Escape') drawTodos(); });
            });
        });
    };
    const loadTodos = async () => {
        try { todos = await listTodos(); } catch (e) { showToast(`⚠️ ${e.message}`); todos = []; }
        todoLoaded = true;
        if (todoWin.isOpen()) drawTodos(); else todoBadge();
    };
    todoWin.onOpen = () => { drawTodos(); setTimeout(() => todoWin.body.querySelector('#td-text')?.focus(), 50); };

    // =====================================================================
    // 채팅
    // =====================================================================
    const chatWin = makeWindow('chat', '채팅', 'messages-square', 'bg-indigo-600', { w: 480, h: 600, right: 88 });
    const me = myChatId();
    let users = [];
    let online = new Set([me]);
    let room = 'ALL';
    let msgs = [];          // 지금 방의 메시지 (시간순)
    let hasMore = false;
    let pending = [];       // 보낼 첨부 파일
    let sending = false;
    const unread = {};      // room → 안 읽은 수
    const roomName = (r) => (r === 'ALL' ? '전체 대화' : (users.find(u => u.id === dmPartner(r))?.name || '1:1 대화'));
    const chatBadge = () => {
        const n = Object.values(unread).reduce((s, v) => s + v, 0);
        const b = root.querySelector('#ft-chat-badge');
        b.textContent = n > 99 ? '99+' : String(n);
        b.classList.toggle('hidden', !n);
        root.querySelector('#ft-btn-chat').title = `채팅 (접속 ${online.size}명)`;
    };
    const markRead = () => {
        const last = msgs[msgs.length - 1];
        setRead(room, last ? last.createdAt : new Date().toISOString());
        unread[room] = 0;
        chatBadge();
    };

    const roomsHtml = () => {
        const others = users.filter(u => u.id !== me)
            .sort((a, b) => (online.has(b.id) - online.has(a.id)) || (unread[dmRoom(me, b.id)] || 0) - (unread[dmRoom(me, a.id)] || 0) || a.name.localeCompare(b.name, 'ko'));
        const item = (r, label, sub, dot) => `
            <button type="button" class="ch-room w-full text-left px-2 py-1.5 rounded-lg flex items-center gap-1.5 ${room === r ? 'bg-indigo-600 text-white' : 'hover:bg-slate-100 text-slate-700'}" data-room="${esc(r)}">
                ${dot}
                <span class="flex-1 min-w-0"><span class="block font-bold truncate">${esc(label)}</span>${sub ? `<span class="block text-[10px] truncate ${room === r ? 'text-indigo-100' : 'text-slate-400'}">${esc(sub)}</span>` : ''}</span>
                ${unread[r] ? `<span class="min-w-[18px] h-[18px] px-1 rounded-full bg-rose-600 text-white text-[10px] font-black flex items-center justify-center">${unread[r]}</span>` : ''}
            </button>`;
        return item('ALL', '전체 대화', `접속 ${online.size}명`, '<i data-lucide="users" class="w-3.5 h-3.5 flex-shrink-0"></i>')
            + (others.length ? '<div class="px-2 pt-2 pb-1 text-[10px] font-black text-slate-400">1:1 대화</div>' : '')
            + others.map(u => item(dmRoom(me, u.id), u.name, u.dept, `<span class="w-2 h-2 rounded-full flex-shrink-0 ${online.has(u.id) ? 'bg-emerald-500' : 'bg-slate-300'}" title="${online.has(u.id) ? '접속 중' : '접속 안 함'}"></span>`)).join('');
    };

    const attHtml = (a, i, mine) => {
        const isImg = /^image\//.test(a.type);
        return isImg
            ? `<button type="button" class="ch-att block mt-1" data-i="${i}" title="${esc(a.name)} (${fmtSize(a.size)})"><img data-att="${i}" alt="${esc(a.name)}" class="max-w-[220px] max-h-[180px] rounded-lg border ${mine ? 'border-indigo-300' : 'border-slate-200'} bg-slate-100 min-w-[60px] min-h-[40px] object-contain" /></button>`
            : `<button type="button" class="ch-att mt-1 flex items-center gap-1.5 px-2 py-1.5 rounded-lg ${mine ? 'bg-indigo-500/60 hover:bg-indigo-500' : 'bg-white hover:bg-slate-50 border border-slate-200'} max-w-full" data-i="${i}">
                <i data-lucide="file-down" class="w-4 h-4 flex-shrink-0"></i><span class="truncate font-bold">${esc(a.name)}</span><span class="text-[10px] opacity-70 flex-shrink-0">${fmtSize(a.size)}</span></button>`;
    };
    const msgHtml = (m, prev) => {
        const mine = m.sender === me;
        const newDay = !prev || new Date(prev.createdAt).toDateString() !== new Date(m.createdAt).toDateString();
        const sameAuthor = !newDay && prev && prev.sender === m.sender && (new Date(m.createdAt) - new Date(prev.createdAt)) < 5 * 60000;
        return `${newDay ? `<div class="text-center my-2"><span class="px-2 py-0.5 rounded-full bg-slate-200 text-slate-600 text-[10px] font-bold">${dayLabel(m.createdAt)}</span></div>` : ''}
            <div class="ch-msg group flex ${mine ? 'justify-end' : 'justify-start'} ${sameAuthor ? 'mt-0.5' : 'mt-2'}" data-id="${esc(m.id)}">
                <div class="max-w-[82%] ${mine ? 'items-end' : 'items-start'} flex flex-col">
                    ${!mine && !sameAuthor ? `<span class="text-[10px] font-bold text-slate-500 mb-0.5 px-1">${esc(m.senderName || '알 수 없음')}</span>` : ''}
                    <div class="flex items-end gap-1 ${mine ? 'flex-row-reverse' : ''}">
                        <div class="px-2.5 py-1.5 rounded-2xl ${mine ? 'bg-indigo-600 text-white rounded-br-md' : 'bg-white border border-slate-200 text-slate-800 rounded-bl-md'} break-words min-w-0">
                            ${m.body ? `<div class="leading-relaxed">${linkify(m.body)}</div>` : ''}
                            ${(m.attachments || []).map((a, i) => attHtml(a, i, mine)).join('')}
                        </div>
                        <span class="text-[9px] text-slate-400 whitespace-nowrap">${hm(m.createdAt)}</span>
                        ${mine ? '<button type="button" class="ch-del opacity-0 group-hover:opacity-100 text-slate-300 hover:text-rose-600 text-[11px] font-black" title="삭제">✕</button>' : ''}
                    </div>
                </div>
            </div>`;
    };

    const drawChat = ({ keepScroll = false } = {}) => {
        const listEl = chatWin.body.querySelector('#ch-list');
        const prevBottom = listEl ? listEl.scrollHeight - listEl.scrollTop : 0;
        const draft = chatWin.body.querySelector('#ch-input')?.value || '';
        chatWin.setTitle(`채팅 · ${roomName(room)}`);
        chatWin.body.innerHTML = `
            <div class="flex flex-1 min-h-0">
                <div class="w-[132px] flex-shrink-0 border-r border-slate-200 bg-slate-50 overflow-y-auto p-1.5 space-y-0.5 max-[420px]:hidden" id="ch-rooms">${roomsHtml()}</div>
                <div class="flex-1 min-w-0 flex flex-col" id="ch-main">
                    <select id="ch-room-sel" class="hidden max-[420px]:block m-1.5 border border-slate-300 rounded-lg px-2 py-1 font-bold">
                        <option value="ALL">전체 대화</option>${users.filter(u => u.id !== me).map(u => `<option value="${esc(dmRoom(me, u.id))}" ${room === dmRoom(me, u.id) ? 'selected' : ''}>${online.has(u.id) ? '● ' : ''}${esc(u.name)}</option>`).join('')}
                    </select>
                    <div id="ch-list" class="flex-1 min-h-0 overflow-y-auto px-2.5 py-2 bg-slate-100/70">
                        ${hasMore ? '<div class="text-center"><button type="button" id="ch-more" class="px-2 py-1 text-[11px] font-bold text-indigo-600 hover:underline">이전 메시지 더 보기</button></div>' : ''}
                        ${msgs.map((m, i) => msgHtml(m, msgs[i - 1])).join('') || `<div class="h-full flex items-center justify-center text-slate-400 font-bold text-center p-4">${room === 'ALL' ? '전체 대화방입니다. 첫 메시지를 남겨 보세요.' : `${esc(roomName(room))}님과의 1:1 대화입니다.`}</div>`}
                    </div>
                    <div id="ch-pending" class="${pending.length ? '' : 'hidden'} flex flex-wrap gap-1 px-2 pt-1.5 border-t border-slate-200 bg-white">
                        ${pending.map((f, i) => `<span class="flex items-center gap-1 pl-2 pr-1 py-0.5 rounded-full bg-indigo-50 border border-indigo-200 text-indigo-800 font-bold max-w-[200px]"><i data-lucide="paperclip" class="w-3 h-3 flex-shrink-0"></i><span class="truncate">${esc(f.name || '붙여넣은 이미지')}</span><span class="text-[10px] opacity-70">${fmtSize(f.size)}</span><button type="button" class="ch-unpend w-4 h-4 rounded-full hover:bg-indigo-200 flex items-center justify-center" data-i="${i}">×</button></span>`).join('')}
                    </div>
                    <div class="flex items-end gap-1.5 p-2 border-t border-slate-200 bg-white">
                        <label class="w-9 h-9 flex-shrink-0 rounded-lg hover:bg-slate-100 text-slate-500 flex items-center justify-center cursor-pointer" title="파일 첨부 (${isCloudChat() ? '파일당 10MB' : '로컬 모드 2MB'}) · 붙여넣기·끌어놓기도 됩니다">
                            <i data-lucide="paperclip" class="w-4 h-4"></i><input type="file" id="ch-file" multiple class="hidden" /></label>
                        <textarea id="ch-input" rows="1" maxlength="4000" placeholder="메시지 입력 (Enter 보내기, Shift+Enter 줄바꿈)" class="flex-1 min-w-0 resize-none border border-slate-300 rounded-lg px-2.5 py-2 max-h-28">${esc(draft)}</textarea>
                        <button type="button" id="ch-send" class="w-9 h-9 flex-shrink-0 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white flex items-center justify-center disabled:opacity-50" ${sending ? 'disabled' : ''} title="보내기"><i data-lucide="${sending ? 'loader' : 'send'}" class="w-4 h-4 ${sending ? 'animate-spin' : ''}"></i></button>
                    </div>
                </div>
            </div>`;
        createIcons({ icons });
        bindChat();
        const el = chatWin.body.querySelector('#ch-list');
        el.scrollTop = keepScroll ? el.scrollHeight - prevBottom : el.scrollHeight;
        loadImages();
    };

    const loadImages = () => {
        chatWin.body.querySelectorAll('.ch-msg').forEach(node => {
            const m = msgs.find(x => x.id === node.dataset.id);
            node.querySelectorAll('img[data-att]').forEach(img => {
                const a = m?.attachments?.[Number(img.dataset.att)];
                if (!a) return;
                chatFileUrl(a).then(url => {
                    if (!url) return;
                    img.src = url;
                    img.onload = () => { const el = chatWin.body.querySelector('#ch-list'); if (el && el.scrollHeight - el.scrollTop - el.clientHeight < img.height + 80) el.scrollTop = el.scrollHeight; };
                }).catch(() => { img.alt = '이미지를 불러오지 못했습니다'; });
            });
        });
    };

    const addFiles = (files) => {
        const list = [...files].filter(Boolean);
        if (!list.length) return;
        const max = isCloudChat() ? 10 * 1024 * 1024 : 2 * 1024 * 1024;
        const big = list.filter(f => f.size > max);
        if (big.length) alert(`${big.map(f => f.name).join(', ')}: ${isCloudChat() ? '10MB' : '2MB'}를 넘는 파일은 보낼 수 없습니다.`);
        pending = [...pending, ...list.filter(f => f.size <= max)].slice(0, 10);
        drawChat({ keepScroll: true });
        chatWin.body.querySelector('#ch-input')?.focus();
    };

    const send = async () => {
        if (sending) return;
        const input = chatWin.body.querySelector('#ch-input');
        const text = input.value.trim();
        if (!text && !pending.length) return;
        sending = true;
        const files = pending;
        drawChat({ keepScroll: true });
        try {
            const m = await sendMessage(room, text, files);
            chatWin.body.querySelector('#ch-input').value = '';
            pending = [];
            if (m && !msgs.some(x => x.id === m.id)) msgs.push(m);
            markRead();
        } catch (e) { alert(e.message); }
        sending = false;
        drawChat();
        chatWin.body.querySelector('#ch-input')?.focus();
    };

    const openRoom = async (r) => {
        room = r;
        msgs = []; hasMore = false;
        drawChat();
        try { msgs = await listMessages(room); hasMore = msgs.length >= PAGE; } catch (e) { showToast(`⚠️ ${e.message}`); }
        drawChat();
        markRead();
        chatWin.body.querySelector('#ch-input')?.focus();
    };

    const bindChat = () => {
        const $ = (s) => chatWin.body.querySelector(s);
        chatWin.body.querySelectorAll('.ch-room').forEach(b => b.addEventListener('click', () => { if (b.dataset.room !== room) openRoom(b.dataset.room); }));
        $('#ch-room-sel').addEventListener('change', (e) => openRoom(e.target.value));
        $('#ch-more')?.addEventListener('click', async () => {
            try {
                const older = await listMessages(room, msgs[0]?.createdAt || '');
                hasMore = older.length >= PAGE;
                msgs = [...older.filter(o => !msgs.some(m => m.id === o.id)), ...msgs];
            } catch (e) { alert(e.message); }
            drawChat({ keepScroll: true });
        });
        const input = $('#ch-input');
        const grow = () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 112)}px`; };
        grow();
        input.addEventListener('input', grow);
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
        input.addEventListener('paste', (e) => {
            const files = [...(e.clipboardData?.files || [])];
            if (files.length) { e.preventDefault(); addFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `붙여넣은이미지_${Date.now()}_${i + 1}.png`, { type: f.type || 'image/png' })))); }
        });
        $('#ch-send').addEventListener('click', send);
        $('#ch-file').addEventListener('change', (e) => { addFiles(e.target.files); e.target.value = ''; });
        chatWin.body.querySelectorAll('.ch-unpend').forEach(b => b.addEventListener('click', () => { pending.splice(Number(b.dataset.i), 1); drawChat({ keepScroll: true }); }));
        chatWin.body.querySelectorAll('.ch-msg').forEach(node => {
            const m = msgs.find(x => x.id === node.dataset.id);
            node.querySelectorAll('.ch-att').forEach(b => b.addEventListener('click', async () => {
                const a = m.attachments[Number(b.dataset.i)];
                const w = window.open('', '_blank');
                try {
                    const url = await chatFileUrl(a);
                    if (a.data) {
                        // dataURL은 새 창에서 바로 못 여는 브라우저가 있어 내려받기로
                        w?.close();
                        const link = document.createElement('a'); link.href = url; link.download = a.name; link.click();
                    } else if (w) w.location.href = url; else window.location.href = url;
                } catch (e) { w?.close(); alert(e.message); }
            }));
            node.querySelector('.ch-del')?.addEventListener('click', async () => {
                if (!confirm('이 메시지를 삭제할까요? (첨부 파일도 지워집니다)')) return;
                try { await deleteMessage(m); msgs = msgs.filter(x => x.id !== m.id); drawChat({ keepScroll: true }); } catch (e) { alert(e.message); }
            });
        });
    };
    // 파일 끌어놓기
    chatWin.el.addEventListener('dragover', (e) => { if (e.dataTransfer?.types?.includes('Files')) { e.preventDefault(); chatWin.el.classList.add('ring-4', 'ring-indigo-300'); } });
    chatWin.el.addEventListener('dragleave', (e) => { if (!chatWin.el.contains(e.relatedTarget)) chatWin.el.classList.remove('ring-4', 'ring-indigo-300'); });
    chatWin.el.addEventListener('drop', (e) => {
        if (!e.dataTransfer?.files?.length) return;
        e.preventDefault(); chatWin.el.classList.remove('ring-4', 'ring-indigo-300');
        addFiles(e.dataTransfer.files);
    });

    chatWin.onOpen = () => { if (!msgs.length) openRoom(room); else { drawChat(); markRead(); } };

    // 실시간
    const unsub = subscribeChat({
        onInsert: (m) => {
            if (m.room === room && msgs.some(x => x.id === m.id)) return;
            const viewing = chatWin.isOpen() && m.room === room && document.visibilityState === 'visible';
            if (m.room === room) msgs.push(m);
            if (m.sender === me) { if (m.room === room && chatWin.isOpen()) drawChat(); return; }
            if (viewing) {
                const el = chatWin.body.querySelector('#ch-list');
                const atBottom = !el || el.scrollHeight - el.scrollTop - el.clientHeight < 80;
                drawChat({ keepScroll: !atBottom });
                markRead();
            } else {
                unread[m.room] = (unread[m.room] || 0) + 1;
                chatBadge();
                if (chatWin.isOpen()) drawChat({ keepScroll: true });
                const preview = m.body ? m.body.slice(0, 60) : `📎 파일 ${m.attachments.length}개`;
                showToast(`💬 ${m.senderName || '알 수 없음'}${m.room === 'ALL' ? '' : ' (1:1)'}: ${preview}`);
            }
        },
        onDelete: (id) => {
            if (!id || !msgs.some(x => x.id === id)) return;
            msgs = msgs.filter(x => x.id !== id);
            if (chatWin.isOpen()) drawChat({ keepScroll: true });
        },
        onPresence: (set) => {
            online = set.size ? set : new Set([me]);
            chatBadge();
            const roomsEl = chatWin.body.querySelector('#ch-rooms');
            if (chatWin.isOpen() && roomsEl) { roomsEl.innerHTML = roomsHtml(); createIcons({ icons }); roomsEl.querySelectorAll('.ch-room').forEach(b => b.addEventListener('click', () => { if (b.dataset.room !== room) openRoom(b.dataset.room); })); }
        }
    });
    cleanups.push(unsub);

    // 처음: 사용자 목록, 안 읽은 수, 할일
    (async () => {
        try { users = await listChatUsers(); } catch { users = []; }
        const read = readMap();
        const recent = await listRecentMessages();
        recent.forEach(m => { if (m.sender !== me && m.createdAt > (read[m.room] || '')) unread[m.room] = (unread[m.room] || 0) + 1; });
        // 처음 쓰는 기기는 지난 메시지를 모두 읽은 것으로 본다
        if (!Object.keys(read).length) { Object.keys(unread).forEach(r => { unread[r] = 0; }); recent.forEach(m => setRead(m.room, m.createdAt)); }
        chatBadge();
        if (chatWin.isOpen()) drawChat({ keepScroll: true });
    })();
    loadTodos();

    // 버튼
    root.querySelector('#ft-btn-chat').addEventListener('click', () => (chatWin.isOpen() ? chatWin.close() : chatWin.open()));
    root.querySelector('#ft-btn-todo').addEventListener('click', () => (todoWin.isOpen() ? todoWin.close() : todoWin.open()));
    // 다른 화면에서 열 때: window.__openFloating('chat' | 'todo')
    window.__openFloating = (k) => (k === 'chat' ? chatWin : todoWin).open();
    // 창을 보고 있지 않다가 다시 돌아오면 읽음 처리
    const onVis = () => { if (document.visibilityState === 'visible' && chatWin.isOpen()) markRead(); };
    document.addEventListener('visibilitychange', onVis);
    cleanups.push(() => document.removeEventListener('visibilitychange', onVis));

    createIcons({ icons });
    teardown = () => { cleanups.forEach(f => { try { f(); } catch { /* 무시 */ } }); root.remove(); delete window.__openFloating; };
};
