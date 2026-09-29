// 메시지 접수 창 (FloatingTools의 📨 버튼): 받은 양식 메시지로 등록 · 양식으로 메시지 보내기
// 분석·초안·이동은 services/msgIntake.js
import { esc } from '../services/html.js';
import { createIcons, icons } from '../services/icons.js';
import { searchMasterItems } from '../services/searchUtils.js';
import { parseIntake, openIntake, composeIntake, intakeSummary, INTAKE_KINDS } from '../services/msgIntake.js';
import { fillAssigneeSelect, readAssignee } from '../services/assign.js';
import { sendMessage, dmRoom, myChatId } from '../services/chat.js';

const FIELD_LABEL = { partner: '업체', due: '납기·일자', dest: '도착지', to: '도착(이동처)', from: '출발지', method: '방법', site: '거점', purpose: '용도', note: '비고', requester: '담당(요청자)', planDate: '생산 예정일' };

/** 분석 결과 미리보기 HTML */
export const intakePreviewHtml = (p) => {
    const f = p.fields;
    const rows = Object.entries(FIELD_LABEL).filter(([k]) => f[k]).map(([k, l]) => `<tr><th class="text-left text-slate-500 font-bold pr-2 py-0.5 whitespace-nowrap align-top">${l}</th><td class="py-0.5 font-bold text-slate-800">${esc(f[k])}${k === 'due' ? (p.dueDate ? ` <span class="text-emerald-700">→ ${esc(p.dueDate)}</span>` : ' <span class="text-rose-600">(날짜 아님 · 등록 때 확인)</span>') : ''}</td></tr>`).join('');
    const items = f.items.map(it => `<li class="flex items-center gap-1.5"><span class="${it.code ? 'text-emerald-600' : 'text-amber-600'}">${it.code ? '✔' : '⚠'}</span>
        <span class="font-bold">${esc(it.name)}</span>${it.code ? `<span class="font-mono text-[10px] text-blue-600">${esc(it.code)}</span>` : '<span class="text-[10px] text-amber-700">품목마스터에 없음</span>'}
        <span class="ml-auto font-black">${esc(it.qty || '?')}${esc(it.unit || '')}</span></li>`).join('');
    return `<div class="rounded-xl border border-indigo-200 bg-white p-2.5 space-y-1.5">
        <div class="flex items-center gap-1.5"><i data-lucide="${p.def.icon}" class="w-4 h-4 text-indigo-600"></i><b class="text-indigo-900">${esc(p.def.label)}</b><span class="text-slate-400">→</span><span class="font-bold text-slate-700">${esc(p.def.target)}</span></div>
        <ul class="space-y-0.5">${items || '<li class="text-rose-600 font-bold">품목을 찾지 못했습니다.</li>'}</ul>
        ${rows ? `<table class="w-full">${rows}</table>` : ''}
    </div>`;
};

/**
 * @param body 창 본문
 * @param ctx { showToast, getQueue() → [{ key, p, source, from, at }], hideQueued(key), onClose() }
 */
export const renderIntakePanel = (body, ctx) => {
    let tab = 'in';
    let parsed = null;
    let kind = 'PROD';
    let form = { items: [{ name: '', qty: '', unit: '' }] };

    const draw = () => {
        const queue = ctx.getQueue();
        body.innerHTML = `
            <div class="flex gap-1 p-1.5 border-b border-slate-200 bg-slate-50 font-bold">
                <button type="button" class="it-tab flex-1 px-2 py-1.5 rounded-lg ${tab === 'in' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-white'}" data-t="in">📨 받은 메시지로 등록${queue.length ? ` <span class="ml-0.5 px-1.5 rounded-full bg-rose-600 text-white text-[10px]">${queue.length}</span>` : ''}</button>
                <button type="button" class="it-tab flex-1 px-2 py-1.5 rounded-lg ${tab === 'out' ? 'bg-indigo-600 text-white' : 'text-slate-600 hover:bg-white'}" data-t="out">✍ 양식으로 보내기</button>
            </div>
            <div class="flex-1 min-h-0 overflow-y-auto p-2.5 space-y-2.5">${tab === 'in' ? inHtml(queue) : outHtml()}</div>`;
        createIcons({ icons });
        body.querySelectorAll('.it-tab').forEach(b => b.addEventListener('click', () => { tab = b.dataset.t; draw(); }));
        if (tab === 'in') bindIn(queue); else bindOut();
    };

    // ---------- 받은 메시지로 등록 ----------
    const inHtml = (queue) => `
        <div class="space-y-1.5">
            <div class="text-[11px] text-slate-600">카톡·문자·메일로 받은 <b>[제품 생산 요청]</b> 같은 메시지를 붙여넣으면 알맞은 등록 화면(생산·원액·구매요청서, 출고요청서·이동전표)으로 이동해 내용을 채웁니다.</div>
            <textarea id="it-text" rows="7" class="w-full border border-slate-300 rounded-lg px-2 py-1.5 font-medium" placeholder="[제품 생산 요청]&#10;■ 업체명: …&#10;■ 제품명 및 수량:&#10;  1. … 2PLT&#10;■ 납기 요청일: …"></textarea>
            <div class="flex gap-1.5"><button type="button" id="it-parse" class="flex-1 px-3 py-2 bg-slate-800 hover:bg-slate-900 text-white rounded-lg font-black">분석</button>
                <button type="button" id="it-go" class="flex-1 px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black disabled:opacity-40" ${parsed ? '' : 'disabled'}>등록 화면으로 이동</button></div>
            <div id="it-preview">${parsed ? intakePreviewHtml(parsed) : ''}</div>
        </div>
        <div class="pt-1 border-t border-slate-200">
            <div class="font-black text-slate-700 mb-1">확인 대기 메시지 ${queue.length}건 <span class="font-normal text-[11px] text-slate-400">(앱 채팅 · 구글 챗)</span></div>
            ${queue.map(q => `<div class="rounded-xl border border-slate-200 p-2 mb-1.5" data-k="${esc(q.key)}">
                <div class="flex items-center gap-1 text-[11px] text-slate-500"><b class="text-indigo-800">${esc(q.p.def.label)}</b> · ${esc(q.from || '')} · ${esc(q.at ? new Date(q.at).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '')}</div>
                <div class="font-bold text-slate-800 truncate">${esc(intakeSummary(q.p))}</div>
                <div class="flex gap-1 mt-1"><button type="button" class="it-q-go px-2 py-1 bg-indigo-600 text-white rounded-md font-bold">등록하기</button>
                    <button type="button" class="it-q-view px-2 py-1 bg-white border border-slate-300 rounded-md font-bold">원문</button>
                    <button type="button" class="it-q-hide ml-auto px-2 py-1 text-slate-400 hover:text-slate-700 font-bold">숨기기</button></div>
            </div>`).join('') || '<div class="text-slate-400 text-center py-3">확인 대기 중인 요청 메시지가 없습니다.</div>'}
        </div>`;
    const bindIn = (queue) => {
        const $ = (s) => body.querySelector(s);
        const ta = $('#it-text');
        if (parsed) ta.value = parsed.text;
        const analyze = () => {
            parsed = parseIntake(ta.value, { loose: true });
            $('#it-preview').innerHTML = parsed ? intakePreviewHtml(parsed) : `<div class="p-2 rounded-lg bg-rose-50 text-rose-700 font-bold">요청 양식을 알아보지 못했습니다. 첫 줄에 <b>[제품 생산 요청]</b>·<b>[원액 생산 요청]</b>·<b>[구매 요청]</b>·<b>[출하 요청]</b>·<b>[이동 요청]</b> 중 하나가 있어야 합니다.</div>`;
            $('#it-go').disabled = !parsed;
            createIcons({ icons });
        };
        $('#it-parse').addEventListener('click', analyze);
        ta.addEventListener('paste', () => setTimeout(analyze, 0));
        $('#it-go').addEventListener('click', () => { if (!parsed) return; openIntake(parsed, { kind: 'paste' }); parsed = null; ctx.onClose(); });
        body.querySelectorAll('[data-k]').forEach(el => {
            const q = queue.find(x => x.key === el.dataset.k);
            el.querySelector('.it-q-go').addEventListener('click', () => { openIntake(q.p, q.source); ctx.hideQueued(q.key); ctx.onClose(); });
            el.querySelector('.it-q-view').addEventListener('click', () => { parsed = q.p; draw(); });
            el.querySelector('.it-q-hide').addEventListener('click', () => { ctx.hideQueued(q.key); draw(); });
        });
    };

    // ---------- 양식으로 보내기 ----------
    const outHtml = () => {
        const d = INTAKE_KINDS[kind];
        return `
        <div class="space-y-2">
            <label class="block"><span class="font-bold text-slate-600">양식</span>
                <select id="it-kind" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold">${Object.entries(INTAKE_KINDS).map(([k, v]) => `<option value="${k}" ${k === kind ? 'selected' : ''}>[${v.label}] → ${v.target}</option>`).join('')}</select></label>
            ${d.fields.map(([k, label]) => (k === 'items' ? `
                <div><div class="font-bold text-slate-600">${esc(label)}</div>
                    ${form.items.map((it, i) => `<div class="flex gap-1 mt-1 relative" data-i="${i}">
                        <input type="text" class="it-iname flex-1 min-w-0 border border-slate-300 rounded-md px-1.5 py-1 font-bold" value="${esc(it.name)}" placeholder="제품·품목 (검색)" autocomplete="off" />
                        <input type="text" inputmode="decimal" class="it-iqty w-16 border border-slate-300 rounded-md px-1.5 py-1 text-right font-black" value="${esc(it.qty)}" placeholder="수량" />
                        <input type="text" class="it-iunit w-14 border border-slate-300 rounded-md px-1.5 py-1" value="${esc(it.unit)}" placeholder="단위" list="it-units" />
                        <button type="button" class="it-idel text-slate-400 hover:text-rose-600 font-black px-1">✕</button>
                        <div class="it-sg hidden absolute left-0 right-24 top-full z-30 max-h-44 overflow-y-auto bg-white border border-slate-300 rounded-lg shadow-xl"></div>
                    </div>`).join('')}
                    <button type="button" id="it-iadd" class="mt-1 px-2 py-0.5 border border-dashed border-slate-400 rounded-md font-bold text-slate-600">+ 품목</button>
                    <datalist id="it-units">${['EA', 'BOX', 'PLT', 'L', 'KG', 'DRUM', 'PAIL', 'TOTE', 'IBC'].map(u => `<option value="${u}">`).join('')}</datalist>
                </div>` : `
                <label class="block"><span class="font-bold text-slate-600">${esc(label)}</span>
                    <div class="flex gap-1 mt-0.5"><input type="text" class="it-f flex-1 min-w-0 border border-slate-300 rounded-md px-1.5 py-1" data-k="${k}" value="${esc(form[k] || '')}" ${k === 'due' ? 'placeholder="날짜 또는 \'생산 후 조율\'"' : ''} />
                    ${k === 'due' ? '<input type="date" class="it-due-pick border border-slate-300 rounded-md px-1 py-1 w-[120px]" title="달력에서 고르기" />' : ''}</div></label>`)).join('')}
            <label class="block"><span class="font-bold text-slate-600">받는 사람</span>
                <select id="it-to" class="mt-0.5 w-full border border-slate-300 rounded-lg px-2 py-1.5 font-bold"><option value="">불러오는 중…</option></select></label>
            <div><div class="font-bold text-slate-600">보낼 내용 (미리보기)</div><pre id="it-pre" class="mt-0.5 whitespace-pre-wrap font-sans bg-slate-50 border border-slate-200 rounded-lg p-2 text-[11px]"></pre></div>
            <button type="button" id="it-send" class="w-full px-3 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg font-black">메시지 보내기</button>
            <p class="text-[11px] text-slate-500">받는 사람의 앱에 알림이 뜨고 [등록하기]를 누르면 ${esc(d.target)} 화면에 내용이 채워집니다.</p>
        </div>`;
    };
    const bindOut = () => {
        const $ = (s) => body.querySelector(s);
        const pre = () => { $('#it-pre').textContent = composeIntake(kind, form); };
        $('#it-kind').addEventListener('change', (e) => { kind = e.target.value; draw(); });
        body.querySelectorAll('.it-f').forEach(inp => inp.addEventListener('input', () => { form[inp.dataset.k] = inp.value; pre(); }));
        $('.it-due-pick')?.addEventListener('change', (e) => { form.due = e.target.value; body.querySelector('.it-f[data-k="due"]').value = e.target.value; pre(); });
        body.querySelectorAll('[data-i]').forEach(row => {
            const it = form.items[Number(row.dataset.i)];
            const nameInp = row.querySelector('.it-iname');
            const sg = row.querySelector('.it-sg');
            let found = [];
            nameInp.addEventListener('input', () => {
                it.name = nameInp.value; pre();
                if (nameInp.value.trim().length < 2) { sg.classList.add('hidden'); return; }
                found = searchMasterItems(nameInp.value, 12);
                sg.innerHTML = found.map((m, i) => `<button type="button" data-j="${i}" class="w-full text-left px-2 py-1 border-b border-slate-100 hover:bg-indigo-50"><span class="font-bold">${esc(m.name)}</span> <span class="font-mono text-[10px] text-blue-600">${esc(m.code)}</span></button>`).join('');
                sg.classList.toggle('hidden', !found.length);
                sg.querySelectorAll('button').forEach(b => {
                    b.addEventListener('mousedown', (e) => e.preventDefault());
                    b.addEventListener('click', () => { const m = found[Number(b.dataset.j)]; it.name = m.name; nameInp.value = m.name; if (!it.unit) { it.unit = m.unit || ''; row.querySelector('.it-iunit').value = it.unit; } sg.classList.add('hidden'); pre(); });
                });
            });
            nameInp.addEventListener('blur', () => setTimeout(() => sg.classList.add('hidden'), 150));
            row.querySelector('.it-iqty').addEventListener('input', (e) => { it.qty = e.target.value.replace(/[^\d.,]/g, ''); pre(); });
            row.querySelector('.it-iunit').addEventListener('input', (e) => { it.unit = e.target.value; pre(); });
            row.querySelector('.it-idel').addEventListener('click', () => { form.items.splice(Number(row.dataset.i), 1); if (!form.items.length) form.items.push({ name: '', qty: '', unit: '' }); draw(); });
        });
        $('#it-iadd')?.addEventListener('click', () => { form.items.push({ name: '', qty: '', unit: '' }); draw(); });
        const sel = $('#it-to');
        fillAssigneeSelect(sel).then(() => {
            sel.querySelectorAll('option').forEach(o => { if (o.value && String(o.value) === String(myChatId())) o.remove(); });
            sel.options[0].textContent = '전체 대화 (모든 직원)';
            sel.options[0].value = '';
        });
        $('#it-send').addEventListener('click', async (e) => {
            if (!form.items.some(it => it.name.trim())) { alert('품목을 1개 이상 넣으세요.'); return; }
            const to = readAssignee(sel);
            const text = composeIntake(kind, form);
            if (!confirm(`${to ? `${to.name}님에게` : '전체 대화에'} [${INTAKE_KINDS[kind].label}] 메시지를 보낼까요?`)) return;
            e.target.disabled = true;
            try {
                await sendMessage(to ? dmRoom(myChatId(), to.id) : 'ALL', text);
                ctx.showToast(`📨 [${INTAKE_KINDS[kind].label}] 메시지를 ${to ? `${to.name}님에게` : '전체 대화에'} 보냈습니다.`);
                form = { items: [{ name: '', qty: '', unit: '' }] };
                draw();
            } catch (err) { alert(err.message); e.target.disabled = false; }
        });
        pre();
    };

    draw();
    return { redraw: draw, setText: (text) => { tab = 'in'; parsed = parseIntake(text, { loose: true }); draw(); if (!parsed) { const ta = body.querySelector('#it-text'); if (ta) ta.value = text; } } };
};
