import { state } from '../services/db.js';
import { listPackStandards, getPackStandard } from '../services/packStandards.js';
import { listItemImages, uploadItemImage, dataUrlToFile } from '../services/fileStore.js';
import { createIcons, icons } from '../services/icons.js';
import { esc } from '../services/html.js';

// 파일 저장소 → 품목 사진 → [포장작업표준서 사진 가져오기]
// 표준서(제품명·거래처)를 품목코드에 짝지어, 표준서 안의 사진(용기·라벨·인박스·아웃박스·파렛트·스티커·추가 사진)을 그 품목 사진으로 복사한다.
// 표준서 안의 사진은 그대로 둔다. 올린 사진 메모에 [표준서:<id>:<칸>] 표시를 남겨 다시 눌러도 같은 사진을 두 번 올리지 않는다.
// 표준서 제품명과 품목명이 정확히 같지 않으므로 이름 낱말(점도·용량 가중)로 비슷한 완제품을 추천하고 사람이 확인해 고른다.
const MAP_KEY = 'daelim_packstd_itemmap'; // 표준서 id → 고른 품목코드 (이 기기)
const SLOTS = { bottleImg: '용기', labelImg: '라벨', innerBoxImg: '인박스', outterBoxImg: '아웃박스', palletImg: '파렛트 적재', stickerImg: '스티커' };
const slotLabel = (id) => SLOTS[id] || (/^extraImg(\d+)$/.test(id) ? `추가 사진 ${id.replace('extraImg', '')}` : id);
const SLOT_ORDER = ['bottleImg', 'labelImg', 'innerBoxImg', 'outterBoxImg', 'palletImg', 'stickerImg'];
const tagOf = (stdId, slot) => `[표준서:${stdId}:${slot}]`;

const loadMap = () => { try { return JSON.parse(localStorage.getItem(MAP_KEY) || '{}'); } catch { return {}; } };
const saveMap = (m) => { try { localStorage.setItem(MAP_KEY, JSON.stringify(m)); } catch { } };
// 비교용: 소문자, 5W-30 → 5w30, 354ml → 0.354l, 글자·숫자·점 말고는 뺀다
const unify = (s) => String(s || '').toLowerCase()
    .replace(/(\d+)\s*w\s*-?\s*(\d+)/g, '$1w$2')
    .replace(/(\d+(?:\.\d+)?)\s*ml\b/g, (_, n) => `${Number(n) / 1000}l`)
    .replace(/(\d+(?:\.\d+)?)\s*(l|kg)\b/g, (_, n, u) => `${Number(n)}${u}`);
const norm = (s) => unify(s).replace(/[^0-9a-z가-힣.]/g, '');

// 표준서 제품명 → 추천 품목 (점수 높은 순 5개). 품목명 + 규격(용량)으로 비교하고, 낱개 품목을 박스 품목(-1, 'x 12개')보다 먼저.
const tokensOf = (text) => unify(text).split(/[\s()[\],/·_\-]+/).map(t => t.replace(/[^0-9a-z가-힣.]/g, '')).filter(t => t.length >= 2);
const isVol = (t) => /^\d+(\.\d+)?(l|kg)$/.test(t);
const weightOf = (t) => (/^\d+w\d+$/.test(t) || isVol(t) ? 3 : 1) * Math.min(t.length, 8);
const suggest = (product, pool) => {
    const toks = [...new Set(tokensOf(product))];
    const brand = toks[0]; // 첫 낱말(브랜드)은 두 배 (브랜드가 다른 품목이 높게 나오지 않게)
    const w = (t) => weightOf(t) * (t === brand ? 2 : 1);
    const total = toks.reduce((a, t) => a + w(t), 0) || 1;
    const vol = toks.find(isVol);
    return pool.map(m => {
        const n = norm(`${m.name} ${m.spec || ''}`);
        const hit = toks.filter(t => n.includes(t));
        let s = hit.reduce((a, t) => a + w(t), 0);
        if (vol && !n.includes(vol) && /\d(l|kg)/.test(n)) s -= weightOf(vol); // 용량이 다르면 감점 (1L 표준서에 4L 품목)
        if (/x\s*\d/i.test(m.spec || '') || /-\d+$/.test(m.code)) s -= 0.5;      // 박스 품목은 뒤로
        s -= Math.max(0, n.length - hit.join('').length) * 0.01;                  // 남는 글자가 적은(더 꼭 맞는) 품목 먼저
        return { m, s, pct: Math.max(0, Math.min(100, Math.round((hit.reduce((a, t) => a + w(t), 0) / total) * 100))) };
    }).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 5);
};

export const openPackStdImageImport = async ({ showToast = () => {}, onDone = () => {} } = {}) => {
    document.getElementById('psi-modal')?.remove();
    const el = document.createElement('div');
    el.id = 'psi-modal';
    el.className = 'fixed inset-0 z-[90] bg-slate-900/50 flex items-center justify-center p-3';
    el.innerHTML = `<div class="bg-white rounded-2xl shadow-2xl w-full max-w-6xl max-h-[94vh] flex flex-col">
        <div class="flex items-start justify-between gap-3 px-5 py-4 border-b border-slate-200">
            <div><h3 class="text-base font-black text-slate-900 flex items-center gap-2"><i data-lucide="book-marked" class="w-5 h-5 text-violet-600"></i>포장작업표준서 사진 → 품목 사진</h3>
                <p class="text-[11px] text-slate-500 mt-0.5">표준서마다 품목을 골라 짝을 지으면, 표준서의 사진(용기·라벨·인박스·아웃박스·파렛트·스티커)을 그 품목 사진으로 복사합니다. 표준서 안의 사진은 그대로 남고, 이미 올린 사진은 다시 올리지 않습니다.</p></div>
            <button type="button" class="psi-close text-slate-400 hover:text-slate-700 text-2xl leading-none">&times;</button>
        </div>
        <div class="px-5 py-3 border-b border-slate-100 flex flex-wrap items-center gap-2 text-xs">
            <input id="psi-q" placeholder="제품명·거래처 검색" class="flex-1 min-w-[180px] border border-slate-300 rounded-lg px-2.5 py-1.5" />
            <select id="psi-f" class="border border-slate-300 rounded-lg px-2 py-1.5"><option value="TODO">아직 안 올린 표준서</option><option value="DONE">올린 표준서</option><option value="ALL">전체</option></select>
            <button type="button" id="psi-checkall" class="px-2.5 py-1.5 rounded-lg border border-slate-300 font-bold">보이는 줄 중 품목 고른 것 모두 선택</button>
            <span id="psi-stat" class="ml-auto font-bold text-slate-500"></span>
        </div>
        <div class="flex-1 overflow-y-auto">
            <table class="w-full text-xs"><thead class="bg-slate-50 text-slate-600 sticky top-0 z-10"><tr>
                <th class="p-2 w-8"></th><th class="p-2 text-left">포장작업표준서 (제품명 · 거래처)</th><th class="p-2 text-left w-[46%]">짝지을 품목 (추천 · 일치율)</th><th class="p-2 text-center w-24">상태</th></tr></thead>
                <tbody id="psi-rows" class="divide-y divide-slate-100"><tr><td colspan="4" class="p-10 text-center text-slate-400">표준서와 품목 사진 목록을 불러오는 중…</td></tr></tbody></table>
        </div>
        <datalist id="psi-master"></datalist>
        <div class="flex flex-wrap items-center justify-end gap-2 px-5 py-3 border-t border-slate-200 bg-slate-50 rounded-b-2xl">
            <span id="psi-prog" class="mr-auto text-xs font-bold text-violet-700"></span>
            <button type="button" class="psi-close px-4 py-2 rounded-xl bg-white border border-slate-300 text-slate-700 text-xs font-bold">닫기</button>
            <button type="button" id="psi-run" class="px-4 py-2 rounded-xl bg-violet-600 hover:bg-violet-700 text-white text-xs font-black disabled:opacity-40">선택한 표준서 사진 올리기</button>
        </div></div>`;
    document.body.appendChild(el);
    createIcons({ icons });
    const $ = (s) => el.querySelector(s);
    let running = false, stop = false, changed = false;
    const close = () => {
        if (running) { if (!confirm('올리는 중입니다. 지금 올리는 표준서까지만 하고 멈출까요?')) return; stop = true; return; }
        el.remove(); if (changed) onDone();
    };
    el.querySelectorAll('.psi-close').forEach(b => b.addEventListener('click', close));

    let stds = [], images = [];
    try {
        [stds, images] = await Promise.all([listPackStandards(), listItemImages()]);
    } catch (e) { $('#psi-rows').innerHTML = `<tr><td colspan="4" class="p-6 text-rose-600">${esc(e.message)}</td></tr>`; return; }
    const pool = state.master.filter(m => m.category === '완제품');
    const poolAll = pool.length ? pool : state.master;
    $('#psi-master').innerHTML = poolAll.map(m => `<option value="${esc(m.code)}">${esc(m.name)}</option>`).join('');
    const map = loadMap();
    // 이미 올린 사진: 메모의 [표준서:id:칸] 표시로 찾는다 → 표준서별 장수·품목
    const done = new Map();
    images.forEach(r => (String(r.memo || '').match(/\[표준서:[^:\]]+:[^\]]+\]/g) || []).forEach(t => {
        const [, id] = t.slice(1, -1).split(':');
        const d = done.get(id) || { n: 0, code: r.code };
        d.n++; done.set(id, d);
    }));
    const sug = new Map(stds.map(s => [s.id, suggest(`${s.product || s.title}`, poolAll)]));
    const checked = new Set();
    // 1순위가 100%이고 다른 100% 후보가 같은 이름(박스 품목)뿐이면 미리 골라 둔다 (체크는 사람이)
    const autoPick = (id) => {
        const [a, ...rest] = sug.get(id) || [];
        if (!a || a.pct < 100) return '';
        return rest.some(x => x.pct >= 100 && x.m.name !== a.m.name) ? '' : a.m.code;
    };
    const codeOf = (id) => map[id] ?? done.get(id)?.code ?? autoPick(id);

    const draw = () => {
        const q = $('#psi-q').value.trim().toLowerCase(), f = $('#psi-f').value;
        const rows = stds.filter(s => (f === 'ALL' || (f === 'DONE' ? done.has(s.id) : !done.has(s.id)))
            && (!q || `${s.product} ${s.title} ${s.buyer}`.toLowerCase().includes(q)));
        $('#psi-stat').textContent = `표준서 ${stds.length}건 · 올린 표준서 ${done.size}건 · 짝 고른 것 ${stds.filter(s => codeOf(s.id)).length}건 · 선택 ${checked.size}건`;
        $('#psi-rows').innerHTML = rows.length === 0 ? '<tr><td colspan="4" class="p-8 text-center text-slate-400">해당하는 표준서가 없습니다.</td></tr>' : rows.map(s => {
            const code = codeOf(s.id);
            const cur = state.master.find(m => m.code === code);
            const list = sug.get(s.id) || [];
            const d = done.get(s.id);
            return `<tr class="${checked.has(s.id) ? 'bg-violet-50' : ''}">
                <td class="p-2 text-center"><input type="checkbox" data-id="${esc(s.id)}" class="psi-chk accent-violet-600" ${checked.has(s.id) ? 'checked' : ''} ${code ? '' : 'disabled'} /></td>
                <td class="p-2"><div class="font-bold text-slate-900">${esc(s.product || s.title)}</div><div class="text-[11px] text-slate-500">${esc([s.buyer, s.category].filter(Boolean).join(' · ') || '-')}</div></td>
                <td class="p-2 space-y-1">
                    <select data-id="${esc(s.id)}" class="psi-sel w-full border border-slate-300 rounded-lg px-2 py-1 font-bold">
                        <option value="">— 품목 고르기 —</option>
                        ${list.map(x => `<option value="${esc(x.m.code)}" ${x.m.code === code ? 'selected' : ''}>[${esc(x.m.code)}] ${esc(x.m.name)} · ${x.pct}%</option>`).join('')}
                        ${code && !list.some(x => x.m.code === code) ? `<option value="${esc(code)}" selected>[${esc(code)}] ${esc(cur?.name || '')}</option>` : ''}
                    </select>
                    <input list="psi-master" data-id="${esc(s.id)}" placeholder="추천에 없으면 품목코드 입력·선택" class="psi-in w-full border border-slate-200 rounded-lg px-2 py-1 font-mono text-[11px]" />
                    ${code && !cur ? '<div class="text-rose-600 text-[11px] font-bold">품목마스터에 없는 코드입니다</div>' : ''}
                    ${code && map[s.id] === undefined && !d ? '<div class="text-[11px] text-violet-700 font-bold">자동 추천 — 맞으면 체크하세요</div>' : ''}
                </td>
                <td class="p-2 text-center">${d ? `<span class="px-2 py-0.5 rounded-full bg-emerald-100 text-emerald-800 font-black">올림 ${d.n}장</span>` : '<span class="text-slate-400">대기</span>'}</td></tr>`;
        }).join('');
        el.querySelectorAll('.psi-sel').forEach(s => s.addEventListener('change', () => { setCode(s.dataset.id, s.value); }));
        el.querySelectorAll('.psi-in').forEach(i => i.addEventListener('change', () => {
            const m = state.master.find(x => x.code.toLowerCase() === i.value.trim().toLowerCase());
            if (!m) { alert('품목마스터에 없는 품목코드입니다.'); i.value = ''; return; }
            setCode(i.dataset.id, m.code);
        }));
        el.querySelectorAll('.psi-chk').forEach(c => c.addEventListener('change', () => { if (c.checked) checked.add(c.dataset.id); else checked.delete(c.dataset.id); draw(); }));
    };
    const setCode = (id, code) => {
        if (code) { map[id] = code; checked.add(id); } else { delete map[id]; checked.delete(id); }
        saveMap(map); draw();
    };
    $('#psi-q').addEventListener('input', draw);
    $('#psi-f').addEventListener('change', draw);
    $('#psi-checkall').addEventListener('click', () => {
        el.querySelectorAll('.psi-chk:not(:disabled)').forEach(c => checked.add(c.dataset.id));
        draw();
    });

    $('#psi-run').addEventListener('click', async () => {
        const ids = [...checked].filter(id => codeOf(id));
        if (!ids.length) { alert('품목을 고르고 체크한 표준서가 없습니다.'); return; }
        const pairs = ids.map(id => { const s = stds.find(x => x.id === id); const m = state.master.find(x => x.code === codeOf(id)); return `· ${s?.product || id} → [${m?.code}] ${m?.name || ''}`; });
        if (!confirm(`표준서 ${ids.length}건의 사진을 품목 사진으로 올립니다.\n${pairs.slice(0, 15).join('\n')}${pairs.length > 15 ? `\n… 외 ${pairs.length - 15}건` : ''}\n\n품목에 대표 사진이 없으면 첫 사진(용기)이 대표 사진이 됩니다.`)) return;
        running = true; stop = false;
        $('#psi-run').disabled = true;
        let upCount = 0, stdCount = 0;
        const errors = [];
        for (const id of ids) {
            if (stop) break;
            const s = stds.find(x => x.id === id);
            const code = codeOf(id);
            $('#psi-prog').textContent = `${stdCount + 1}/${ids.length} ${s?.product || id} 올리는 중… (지금까지 ${upCount}장)`;
            try {
                const doc = await getPackStandard(id);
                const dom = new DOMParser().parseFromString(doc?.content?.a4Html || '', 'text/html');
                const imgs = [...dom.querySelectorAll('img[id][src^="data:image"]')].filter(i => SLOTS[i.id] || /^extraImg\d+$/.test(i.id))
                    .sort((a, b) => (SLOT_ORDER.indexOf(a.id) + 1 || 99) - (SLOT_ORDER.indexOf(b.id) + 1 || 99));
                const have = new Set(images.filter(r => r.code === code).flatMap(r => String(r.memo || '').match(/\[표준서:[^\]]+\]/g) || []));
                let n = 0;
                for (const im of imgs) {
                    const tag = tagOf(id, im.id);
                    if (have.has(tag)) continue;
                    const label = slotLabel(im.id);
                    const file = await dataUrlToFile(im.getAttribute('src'), `${(s?.product || code).slice(0, 60)} - ${label}.jpg`);
                    const row = await uploadItemImage(code, file, { memo: `포장작업표준서 ${s?.product || ''}${s?.buyer ? ` (${s.buyer})` : ''} · ${label} ${tag}` });
                    images.push(row); n++; upCount++;
                }
                const d = done.get(id) || { n: 0, code };
                d.n += n; d.code = code; done.set(id, d);
                checked.delete(id); stdCount++; changed = true;
            } catch (e) {
                errors.push(`${s?.product || id}: ${e.message}`);
            }
        }
        running = false;
        $('#psi-run').disabled = false;
        $('#psi-prog').textContent = `완료: 표준서 ${stdCount}건 · 사진 ${upCount}장 올림${errors.length ? ` · 실패 ${errors.length}건` : ''}${stop ? ' (중간에 멈춤)' : ''}`;
        if (errors.length) alert(`일부 표준서를 올리지 못했습니다:\n${errors.slice(0, 10).join('\n')}`);
        showToast(`🖼️ 포장작업표준서 ${stdCount}건의 사진 ${upCount}장을 품목 사진으로 올렸습니다.`);
        draw();
        if (stop) { el.remove(); onDone(); }
    });
    draw();
};
